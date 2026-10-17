# 多人重构第二阶段：命令边界首批（历史记录）

本文件保留首批实现和当时的验证边界。后续 TCP、场景屏障、租约及大厅已迁入独立实时进程，当前实现与验证见 [第二阶段实时所有者](MULTIPLAYER-PHASE2-REALTIME-OWNER-20261011.md)。以下 embedded 状态及未完成项目均描述首批快照。

首批完成可序列化命令入口和独立进程通信基础，当时运行入口仍是唯一 embedded 房间所有者。该批没有迁移生产 TCP、大厅、场景屏障和重连租约，不能仅凭该批进程实验宣称主业务阻塞已与实际战斗隔离。

## 已收束的边界

- `room.ts` 的 prepare、restore、summon、share、disband 和 `social.ts` 的 token 查询，改用状态投影及命令，HTTP 不直接修改房间对象。
- 普通开局的实时检查、play 预占、持久化后的 commit/cancel、结算后返回和放弃事件，由注册的 battle handler 执行。玩家事务、支付回执和奖励仍在原业务层。
- `/load` 的原局恢复判定由实时所有者生成结果投影，保留原存档清理与模式15进度规则。
- `lobby.ts` 的建房、选房和列表，以及 `five-boss-battle.ts` 的事务内实时校验仍使用现有 embedded 状态；它们是后续迁移范围。

## 命令与结果

`command-protocol.ts` 仅接受可序列化 JSON。命令包含 protocol、commandId、kind、payload、相对 timeoutMs 和可选 owner/room identity。实际修改必须在 handler 排队后核对房间实例、战局、代际、场景和版本；JSON 类型或发送成功不能替代授权和状态核验。

`command-gateway.ts` / `command-executor.ts` 区分未受理拒绝、应用完成、处理中和结果未知。相同 ID、相同内容重放已保留结果，内容碰撞拒绝。超时不会自动生成新 ID 重做；必须查原 ID。已开始操作的预算保持到应用结束，条数、字节、等待年龄、结果缓存和重复等待者都有限。

结果默认保留五分钟，ID 含签发时间；结果过期后拒绝原 ID，不能因缓存清理而再次执行。owner epoch 变化必须显式重新绑定。本机制是进程内有限保留的命令对账，不是跨崩溃持久 exactly-once；奖励防重仍依靠原持久回执。

`command-process.ts` / `command-process-child.ts` 通过显式 trusted bootstrap 装载同一 executor，默认不加载 TCP 或游戏数据库。启动失败、发送失败、断开、子进程退出和无效结果都明确失败，无自动 embedded 回退。timeout 后仍占用 pending 预算，直到真实结果或 IPC 关闭。

## 返回与旧局隔离

纯 room query 在一个 owner 内同步生成拷贝，不额外排队后重新查找房号。修改命令始终带查询时捕获的身份，避免排队期间房号复用使旧请求取得新实例的授权。

prepare/restore 只有收到明确未执行的 `stale` 才允许重查一次；新投影必须是同实例、同代际，不能追到下一局或替换房间。unknown、busy 和过期不作为新命令重做，也不伪装为房间不存在。旧协议的模式15闭锁、restore blocked 和 prepare quest mismatch 等已知不可用分支仍保留原 raising_state=9。

合法原局支付与实时状态更新分开。结算后事件必须有原实例、原战局、原 play、玩家和代际绑定；快照缺失时不能用当前房间代际补充旧局身份。无法证实绑定时仍按原合法事务支付和返回持久回执，但不修改当前房间。迟到的 abort 同样不能清除下一局屏障。

## 本地验证

2026-10-11 当前组合 TypeScript 编译成功，输出仅位于隔离任务目录。完整联机套件 56 个文件、350 次测试执行均通过，失败、跳过和取消均为零；其中仓库原五王集成文件 56 项通过。V2 合成存档兼容脚本通过。测试包括原第一阶段的真实回环 TCP/混合转发与返回，以及新增命令深拷贝、重复 ID、未知结果对账、预算、epoch、进程 kill 和真实 HTTP 旧局支付隔离。

独立 observer 在父进程合成阻塞期间完成的是测试 bootstrap 的命令，不是生产 TCP 转发、场景屏障或租约。该实验不提供公网 TCP 延迟、帧时间或五重云服稳定性结论。第一阶段 Measurement RTT/抖动统计继续保留。

## 启用独立实时所有者前仍需完成

1. 收束建房、选房、招募、AI、大厅连接和同一 TCP listener 上的 lounge 状态；消除父端可写房间镜像。
2. 将 TCP 准入、编队、装备、角色资格及内容查询改成业务层提供的版本化事实，避免 child 自行执行玩家事务。
3. 将五王事务内 live guard 拆成 Prepare/Claim token、业务事务与幂等 Commit/Cancel。不可用旧投影替代目前事务内的实时身份核验。
4. 将屏障、租约、timer、TCP fan-out 和全部房间连接交给同一个实时进程，补实际业务阻塞和慢消费者验收。
5. 为 busy/unknown 制定经过旧客户端验证的响应方式；目前内部错误可能成为 HTTP 500，不能按现状直接启用生产 remote 模式。
6. 保持原奖励、内容、活动进度和存档，再分别验证云服五重完整换场及续战返回。客户端 Resume 为独立后续阶段。

当前没有生产 remote 开关，也没有活动连接切换方案。复用 command process 时需提供经过验证的 domain bootstrap，不能直接 fork 旧 TCP 并同时保留父端房间权威。
