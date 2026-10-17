# 五重换场无限等待、掉线不通知队友的修复与每场联机战斗摘要

日期：2026-10-06

原始调查基线：`staging` `3995738e`。下文复现耗时属于该调查记录；当前整合版本的
构建与测试结果以对应验证回执为准。

## 一、五重换场（LevelNext）可能无限等待

### 现象

五重第二场景开始时，已经加载完的队友停在转换画面一直等，本地战斗计时继续增长，
最终只能退出，表现为“掉线/卡住”。

### 根因

五重连接通过首轮 BattleStart 后，服务端有意取消 25 秒普通心跳租约（五重客户端战斗中
可能长时间静默，见 `FIVE-BOSS-STAGING-LOG-FOLLOWUP-20261004.md`）。之后换场屏障只有
两种收口方式：

- 成员发了 `LevelNext`：它自己的 60 秒 loading 租约会兜底；
- 成员 socket 关闭：8 秒缺席宽限后转 AI。

如果某成员 socket 还开着、却既不发 `LevelNext` 也不发 `SceneReady`（应用卡死或切到
后台、移动网络半开连接、客户端停在其他界面），没有任何计时器会结束等待，其余成员
在换场屏障上无限等待。

### 修复

`SessionManager.beginBattleLevelNext()` 在本轮换场屏障建立时登记一个截止计时器
`BATTLE_LEVEL_NEXT_DEADLINE_MS`（默认 90 秒，最小 10 秒）：

- 到期时仍在线、但本轮既没有 `LevelNext` 也没有 `SceneReady` 的成员被断开，断线原因
  记为新的 `level_next_timeout`；
- 断开后走原有关闭路径：8 秒缺席宽限、转 AI、`Leave` 在 BattleStart 之后发布；
- 已发 `LevelNext` 的成员仍由自己的 loading 租约负责，不受这个计时器影响；
- 屏障已释放、房间换代、结算或解散后计时器失效。

到期后先用 `setImmediate()` 让已经到达的 `LevelNext` / `SceneReady` 经过一轮 I/O，
再进入房间命令队列核验当前计时器、场景与成员状态，避免主线程忙导致已到达消息尚未
处理时误断。默认截止加缺席宽限约为 98 秒；90 秒是换场等待上限，不是网络掉线证明，
仍在上一场景战斗超过该上限的成员也可能被退出，可按实际设备情况调大阈值。

普通共斗、首轮屏障、五重战斗中的静默容忍都不变。

### 复现与验证

`tests/multi-battle-sim.test.cjs` 用真实 TCP 起会话服务器，三名模拟玩家走完五重首轮
屏障、约 30 帧/秒互发战斗帧，然后两人换场、第三人保持连接但静默：

- 截止时间设为 10 分钟（等同修复前）时，18 秒内两名换场玩家仍收不到 BattleStart；
- 默认逻辑下约 11 秒（10 秒截止 + 1 秒宽限）放行，两人收到 BattleStart 和第三人的
  `Leave`，第三人的连接被关闭。

## 二、五重队友中途掉线要通知其余成员（恢复 Leave）

### 客户端实际行为（反编译 CN 客户端核实）

依据旧 CN 客户端反编译（`pinball/scene/battle/state/BattleScenePlayingStateImpl`、
`derailleur/BattleDerailleur`、`context/socket/battle/BattleSocketContact`、
`battle/BattleConstants`）：

- 联机战斗是帧同步。每个客户端在没有其他广播时至少每 8 帧广播一次 Heartbeat（其他人都离开后放宽到 100 帧），
  每 600 帧发一次 Measurement。
- 对每名队友维护“可处理帧”。队友的帧不再到达时，静止计数每帧 +1。落后超过 48 帧开始
  减速（每 24 帧一级，每级减速 4%，即卡顿）；到第 8 级（约 240 帧）就调用
  `isolateAsForceAbort()`：本机提示 `battle_message_disconnected`（与队友通信断开）、
  关闭 battle socket，转为单人继续，之后照常提交 `/finish`。
- 双 Boss（五重沿用）第一轮里，达到第 8 级只写日志“双boss battle之间帧数过大断线”，
  不会自我隔离，等于一直卡住。
- 客户端只在两种情况下主动关闭 battle socket：收到 `Finalized`（结算确认）后，或离开
  战斗场景/自我隔离时。没有自动重连。
- 收到服务器 `Leave(connectionId)` 后，客户端把该队友标为已离开，不再等他的帧。

### 原问题

`20261004` 的修复为避免“误报通信断开”，让已进入战斗的五重连接关闭时一律不广播
`Leave`。按上面的客户端逻辑，这会让一名队友真实掉线（网络断开、应用被杀，或者他自己
因为卡顿先隔离了）之后，其余人一直等他的帧：先卡顿，几秒后各自也“通信断开”，或者在
第一轮直接卡死。当时日志里“同一房间多名成员在很短时间内先后 FIN、几分钟后又成功
/finish”，就是这种连锁自我隔离。

### 修复

- battle 连接收到 `Finalize` 时记 `finalizeSent`；
- 五重连接关闭时，只有已 `Finalize` 的（正常结束）不发 `Leave`；
- 其他中途关闭按普通共斗处理：场景已开始就立即向其余成员广播 `Leave`，加载阶段则
  进入原有的缺席宽限再转 AI。

普通共斗行为不变。

### 验证

`tests/multi-battle-sim.test.cjs` 第二项：真实 TCP 下三人五重战斗中一人断开，另外两人
约 5 ms 内收到该成员的 `Leave`；另一人先发 Finalize 并收到 `Finalized` 后再断开，
不再产生 `Leave`。`tests/multi-barrier-recovery.test.js` 相应用例改为同样的语义。

### 仍然存在、服务端无法消除的卡顿

帧同步下全房间的速度取决于最慢的一台设备：模拟器 18–22 fps 时其他人会被拖慢，严重时
触发上面的自我隔离。这需要客户端侧（性能、模拟器设置或真机）解决。`[MULTI-BATTLE]`
里的 `lineSpeedWarnings` 和 `maxInboundGapMs` 可以帮助定位需要进一步检查的成员。

## 三、每场多人战斗一行摘要 `[MULTI-BATTLE]`

为测试服收集联机数据新增 `src/multi/battle-telemetry.ts`。房间进入 `BATTLE` 时开始，
离开 `BATTLE`（结算、返回、解散）时输出一行 JSON：

| 字段 | 含义 |
|---|---|
| `room` / `battle` / `category` / `quest` / `fiveBoss` | 房间与关卡 |
| `end` | 结束方式，例如 `settling:finish_received`、`disbanded:<原因>` |
| `durationMs` | 战斗时长 |
| `realMembers` / `aiMembers` | 开战时真人与 AI 数 |
| `barriers` | 首轮与换场屏障各自等待了多久 |
| `seatsExpired` | 被转 AI 的缺席席位数 |
| `loopLagMaxMs` | 战斗期间服务器主线程最长卡顿 |
| `loopStalledSeconds` | 战斗期间主线程卡顿 ≥200 ms 的秒数 |
| `members[]` | 每名真人：battle 连接次数、入站包数、广播数、SceneReady/LevelNext/Finalize 次数、客户端线路警告（LineSpeedWarning）次数、最长入站静默、转发给他的帧数、发送背压次数与最长时长、按原因统计的断线 |

读法：

- `loopLagMaxMs` 高：服务器本身卡，所有人的转发都会延迟，查同时段 `[PERF]`/`[WORK-PERF]`；
- 单人 `lineSpeedWarnings` 多或 `maxInboundGapMs` 很长，其他人正常：检查该玩家网络、设备性能和前后台状态；
- `maxBackpressureMs` 高：服务器发给该玩家的下行堵塞（玩家下行或服务器出口）；
- `disconnects` 区分服务器主动断开（`*_timeout`、`send_*`）和客户端/网络断开
  （`peer_fin`、`socket_error`）；
- `barriers` 里 `next_scene` 等待很长：换场慢或有人卡住。

最长入站静默包含最后一个包到连接关闭或战斗结束的尾段，没有收到首包的连接则从连接
建立时算起。连接关闭后停止累计该段，重连从新连接建立时重新计时，避免把离线后的
时间算作仍在线的静默。

开销：每个入站包和每次转发只更新一个已存在对象的计数器；主线程延迟直方图只在有战斗
时启用；不写数据库、不逐包记日志。`MULTI_BATTLE_TELEMETRY=false` 可关闭。

最近 100 条（`MULTI_BATTLE_TELEMETRY_RECENT`）同时保存在内存，可通过管理接口
`GET /api/server/diagnostics/battles` 读取。

## 四、改动文件

- `src/multi/state/SessionManager.ts`：换场截止计时器；五重中途掉线恢复 `Leave`；屏障等待、席位过期、连接计数上报
- `src/multi/tcp/disconnect-diagnostics.ts`：新增断线原因 `level_next_timeout`
- `src/multi/five-boss/connection-diagnostic.ts`：新增诊断事件 `level_next_timeout`
- `src/multi/battle-telemetry.ts`：新增
- `src/multi/coordinator/embedded.ts`：进入/离开 `BATTLE` 时开始/结束摘要
- `src/multi/tcp/battle.ts`：记录 `finalizeSent`；`battle.ts`、`relay.ts`、`reliable-send.ts`、`server.ts`：计数上报
- `src/routes/web_api/diagnostics.ts`：`GET /battles`
- `.env.example`：新增两个变量说明
- 测试：`tests/multi-battle-sim.test.cjs`、`tests/multi-battle-telemetry.test.cjs`，
  `tests/multi-barrier-recovery.test.js` 新增两项，已加入 `npm run test:multiplayer-connectivity`

## 五、回退

服务端代码与对应 `out/` 一起回退即可；无数据库变更。只想关闭摘要可设
`MULTI_BATTLE_TELEMETRY=false`；只想放宽换场截止可调大 `BATTLE_LEVEL_NEXT_DEADLINE_MS`。
