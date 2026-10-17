# 多人 TCP 延迟探针

`multiplayer-latency-probe.cjs` 使用正式 TCP JSON/NUL 协议，测量独立的 Measurement echo 和同房业务转发。它是合成协议客户端，不是 Android/iOS 游戏设备；不会创建玩家、发现房间、读取登录凭据、启动服务或修改配置。

探针只能使用专用测试房间及测试身份。正式握手可能替换同一 `connection_id` 的已有连接，因此 CLI 必须显式指定 `--acknowledge-test-identities`，且连接前显示该提示。不要填入正在游戏中的玩家身份。探针会向房间发送合成业务载荷，房间所有真人座位应由测试探针占用，不能混入真实游戏客户端。公网执行须另外明确授权目标与测试范围。

## 使用

需要与当前源码对应的编译产物，默认从仓库 `out/multi/latency-statistics.js` 加载；隔离验证可用 `STARPOINT_TEST_OUT_DIR` 指向隔离 `out`。工具不会自行构建。

将私有测试配置保存在仓库外的任务目录，示例如下，所有身份和地址都是占位符：

```json
{
  "host": "<TEST_SERVER_HOST>",
  "port": 8003,
  "room": "<DEDICATED_TEST_ROOM>",
  "connectionIds": ["<TEST_CONNECTION_A>", "<TEST_CONNECTION_B>"],
  "route": "parent",
  "phase": "stable-battle",
  "samples": 600,
  "intervalMs": 1000,
  "timeoutMs": 5000,
  "payloadBytes": 256,
  "sceneReady": false
}
```

需要登录会话认证时，可以增加与 `connectionIds` 等长的 `sessionTokens` 数组，填入对应测试账号的有效会话。不要提交私有配置或令牌。无需更改服务端准入策略。

```powershell
node tools/multiplayer-latency-probe.cjs --config '<PRIVATE_TEST_CONFIG.json>' --acknowledge-test-identities --output '<NEW_REPORT.json>'
```

输出文件必须尚不存在；省略 `--output` 时打印报告。退出码 0 表示所有预期样本按期收到且无重复、未知/非法投递或乱序，2 表示测量完成但收包检查不完整，1 表示配置、连接或协议阶段失败。报告不包含地址、连接身份或会话令牌。无参数调用会退出，不默认连接本地或生产地址。

`sceneReady=true` 会发送现有 SceneReady 并等 BattleStart 屏障，只用于准备好的专用测试房间；测量已开始的测试战斗时保持 false。工具不会发送换层或奖励结算请求。连接数量为 2–8，载荷至多 4096 字节，样本至多 3600，运行预算至多一小时，并限制未完成样本数量。

## 统计含义

- `measurements[].rttMs`：在同一本端 `performance.now()` 时钟上，以唯一正整数 ID 匹配 Measurement echo，计算从本端写入队列前到本端解析回复的时间。服务器第三参数不参与相减。`[1,[3,0,0,...]]` 是数据/Heartbeat 泛用 ACK，计入 `genericIgnored`，不作为 RTT 样本。
- `jitterMs`：按接收顺序，相邻成功且按期匹配的 RTT 的绝对差。不等同于跨设备单向抖动。
- `businessDeliveries[].deliveryWaitMs`：同一探针进程中，源 socket 写入队列前到目标 socket 解析业务帧的等待时间。所有 socket 共享单调时钟，不能把跨设备时间戳直接相减，也不能称其为设备之间的单向网络延迟。业务帧携带本次 run、源、精确序号和载荷，并交替走 Broadcast 与 Send(null)，每个源到目标分别核对。
- `receiveIntervalMs` 与 `receiveIntervalVariationMs`：每条源到目标流的相邻唯一业务收包间隔，以及相邻间隔的绝对差。它们包含发送节奏、TCP 合包和本端事件循环影响；`schedulerLatenessMs` 单列计划发送时刻到实际调度的迟到。
- `success` 是按期匹配数；`timeout` 是超过观察期限的请求数；`late` 是其中随后收到回复的数量，所以 `timeout` 包含 `late`。迟到样本存入单独分布，不混入成功 RTT/等待及其变化分布。最后额外观察至多 250ms；更晚回复不再观测。超时不代表 TCP 包丢失。
- `duplicate`、`unmatched`、`mismatched` 分别表示已确认样本的重复回复、未保留 ID 的回复、echo 时间不符。pending 与近期 ID 都有界；超过近期 ID 保留窗口的回复只能计为 unmatched。`sequenceGapObservations` 只是暂时看到序号跳跃，不直接等同丢失；最终按期匹配和超时记录反映收包完成度。

成功收包率可按 `success / sent` 计算，迟到率按 `late / sent`，观察超时率按 `timeout / sent`。RTT 和每条业务流各有自己的分母，不能合并成一个网络丢包率。

固定桶输出 p50/p95/p99，采用桶上界并用实际最大值封顶，标明分辨率、溢出数、样本数及预计 p99 尾部样本数量。600 样本只约有 6 个样本位于最高 1%；小样本 p99 只作描述，不能建立生产 SLA。量化对照应匹配设备/网络、实际运行源码、路由、阶段、人数和负载，逐轮报告。

## 路由与证据边界

`route` 必须显式提供 `parent`、`allchild` 或 `mixed`，`phase` 也必须显式提供。CLI 报告始终将 route 标为外部提供、探针未独立验证。应结合服务器 bridge 的 proxy 数、成员快照确认及 child 的实际业务 route 计数核实；child-local Measurement/Heartbeat 的低 RTT 不证明 mixed 业务转发没有等待父进程。

服务端 `serverControlDelayMs` 是独立指标，使用同一服务端本地单调时钟衡量处理或确认跨度。例如 `relay-control` 从父进程收到转发开始，到该批处理结束，未包含父收到消息之前的 IPC 等待；它不是玩家 TCP RTT。

现有游戏客户端尚未因本工具增加逐次 RTT 上报。真实玩家的回调消费、逻辑推进、渲染帧耗时、短断网/重启恢复，需要客户端可测量入口和实机验收。本地合成探针与正常 TCP 重传不能证明游戏同步恢复。

可导入 `runProbe(config, hooks)` 供隔离测试使用；`beforeConnect` 和 `afterHandshake` 是测试钩子，用于建立混合连接并核验服务器实际连接归属，CLI 不从配置读取或执行这些函数。
