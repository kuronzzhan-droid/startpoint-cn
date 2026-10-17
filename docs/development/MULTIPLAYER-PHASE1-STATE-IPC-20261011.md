# 多人状态契约、续战与 IPC 第一阶段

本阶段保留现有 TCP 数组协议、战斗内容及持久化奖励规则。新增状态均为进程内数据，不新增数据库字段，不迁移或重置玩家进度。当前客户端仍不具备完整战中 Resume；本阶段不提供世界快照、追帧或断线后的无缝恢复。

## 身份与状态

房号用于查找，`lifecycle.instanceId` 标识具体房间实例。内部命令捕获实例、lobby generation、battle session 和 scene epoch；旧实例或旧局的命令不得作用于复用房号后的新房间。战斗 ID 包含实例 UUID。原始真人名单、player/viewer 身份和个人 play 独立保留，不根据当前 socket 或显示名单重新推断。

普通 HTTP start 在房间队列内预占个人 play，同一局的不同 play 不得覆盖已占位的记录。同 play 并发采用引用计数，失败仅释放自己的占位，成功提交固定绑定。五重 start 在持久化事务副作用前再次检查捕获的房间及冻结 run，避免排队期间切换到另一局。

连接替换增加个人 connection epoch。SceneReady/LevelNext 使用同局当前连接；下一场由 LevelNext 开启新的 scene epoch，每个原连接须先进入该场再 Ready。已知座位的替换连接绑定当前场，允许完成加载，不要求重放上一个连接的 LevelNext。现有数组不携带显式场景序号：正常旧协议的依据是每条 TCP 流的顺序，不能区分所有同连接的迟到重复 LevelNext。完整协议 Resume 仍需客户端配合。

个人状态为 LOADING、READY、ACTIVE、FINALIZED、SETTLED、RETURNED 或 RETIRED。结束状态不能被旧 Ready 或 Finalize 回退。Finalize ACK 是信号确认，不等同于 HTTP 奖励结算。活动契约不按创建时间过期；返回后旧契约保留 15 分钟并限制每房最多 8 局。既有结算快照另有原来的 TTL，两个机制不应混称为持久恢复。

`/load` 仅为身份匹配的当前战斗提供原有恢复入口。已结束、已回大厅或属于旧局但仍待个人结算的精确 play 保留结算记录，不向客户端广告为可重放战斗；孤儿和伪造身份仍按原有模式规则处理，Mode15 的进度保留规则不变。

## 续战资格

返回名单冻结本局参与者。未提交结果的成员默认等待最多 180 秒（`REMATCH_RESULT_WAIT_MAX_MS`）；第一次个人结算提交进入自己的 60 秒返回窗口（`REMATCH_RECONNECT_GRACE_MS`）。如果五重仍在等其他人的结果，房间首次实际开放返回时，已结算但尚未返回的成员至少再有完整返回窗口。该开窗只发生一次，后续 Notify10、他人活动和重复结算不续期。

RETURNED 由成功进入大厅并接纳成员记录确认，原 socket 仍在线或被批量推进 generation 不算返回证明。已返回成员再次断开时，只开启他自己的重连窗口。房主返回不把未结算队友的快照推进为 LOBBY。

Notify10 与 AI 招募在异步取队伍前后都扣除预留真人席位。清理仅在当前实例、当前 generation 的 LOBBY 执行，保护房主，日志只统计实际成功删除。返回名单到期后仍遵循原房间、模式与 AI 规则，不重新开放已结束内容。

## IPC 应用边界

双向 IPC 限制包括消息条数、字节与单调时钟年龄：

| 配置 | 默认值 |
| --- | --- |
| `MULTI_BATTLE_RELAY_IPC_MAX_MESSAGES` | 512 |
| `MULTI_BATTLE_RELAY_IPC_MAX_BYTES` | 8388608 |
| `MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS` | 15000 |

Node 发送回调只释放传输槽位。预算中的消息必须等对端应用 ACK 后才释放。发送错误、应用错误或期限超出显式关闭本次 child 持有的连接，已有 native 连接保留；未确认帧不跨崩溃自动重放。

成员快照包含实例/run/scene/version，child 应用确认后还需父进程 activate 才能本地转发。控制未完成时，同房业务统一交回父进程；完成边界涵盖异步握手和分 tick 消费。父端再次检查帧身份，旧消息拒绝后仍完成应用 ACK，避免预算泄漏。父状态变化至 child 收到新快照仍有异步窗口，不保证跨进程瞬时线性化。

## 测量口径

[专用 TCP 探针](../../tools/multiplayer-latency-probe.md)记录匹配 ID 的 Measurement RTT、相邻成功 RTT 差值抖动、超时、迟到、重复和业务逐源/目标投递。generic ACK 不算 RTT。探针是合成协议客户端，不是手机帧率或移动网络实测。

服务端 `serverControlDelayMs` 记录收到控制后的本进程等待/处理及 member-sync 确认。IPC diagnostics 的 `sendQueueWaitMs` 是入队到发送尝试；`applicationAckRttMs` 是同发起进程入队到应用 ACK，包含排队、对端处理与回程，不是 TCP RTT。成功分位数必须与 fault、pending、oldestAge 和超时一起看。统计采用固定内存直方图，分位数为桶上界，报告含样本量、溢出和方法说明。

测试入口为 `npm run test:multiplayer-connectivity`。专项包含真实 TCP 的 OFF/ON 五幕、最终证明、慢成员与 Leave；真实 HTTP 的房主先回、Notify10、队友晚结算、load/restore 与回执重放；以及混合连接、IPC 控制门禁、故障关闭及三种 TCP 测量路径。隔离回归不替代 Android/iOS 画面、移动网络和云服验收。
