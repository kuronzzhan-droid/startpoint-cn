# 可选战斗转发子进程

`MULTI_BATTLE_RELAY_PROCESS` 默认关闭。启用时，TCP session server 在通过准入检查、识别战斗首帧后移交真实 socket；父进程以代理对象继续处理握手、房间、屏障、租约、Leave、AI、Finalize 与结算。

成员快照包含所有当前有效战斗连接。`sid: null` 表示 socket 仍由父进程持有。只有源连接同 generation 的所有成员均有可写子进程句柄时，子进程才本地处理 Broadcast/Send。混合房间原帧交回父进程统一转发与确认，不部分转发或重复 ack；因此混合房间仍受主线程卡顿影响。异代 native 成员不会影响同代子进程转发。控制帧所在 TCP chunk 的后续帧按原顺序交回父进程。

Heartbeat/Measurement 可本地响应；活动汇报刷新原有租约、在线状态和统计。子进程退出会关闭其持有的连接，现有房间逻辑处理 Leave 和重连。最多自动重启 `MULTI_BATTLE_RELAY_MAX_RESTARTS` 次（默认 5）；不可用期间及超出上限后，新连接走 native 路径。已有 native 连接不被迁移或关闭。停止服务同时停止子进程。

首包之后的 UTF-8 解码器若仍持有半个多字节字符，该连接保留 native，避免移交丢失尚未解码的字节。移交同步或异步失败均关闭原 socket 和 proxy；创建子进程失败没有 exit 事件时，close 仍会释放停止等待。

配置包含可选开关、`MULTI_BATTLE_RELAY_ACTIVITY_MS`（默认 250 ms）、重启上限及双向 IPC 条数/字节/年龄预算；沿用既有 TCP 收发缓冲与背压限制。状态快照应用确认、控制门禁、续战与测量口径见[第一阶段说明](MULTIPLAYER-PHASE1-STATE-IPC-20261011.md)。回退为关闭开关并按正常流程重启服务。无需数据库 schema、客户端准入、APK/IPA 或 CDN 变更。

针对性测试：`multi-battle-relay-mixed.test.cjs` 覆盖真实 TCP/正式桥接的双向混合转发、ack 去重、generation 筛选、控制帧顺序、替换 socket、启动失败、子进程退出和 native 降级；`multi-battle-relay-recovery.test.cjs` 在启用模式下复用五重决战 deadline/Leave/Finalize 现有用例；`multi-battle-relay-process.test.cjs` 比较人为主线程阻塞时的转发行为。

2026-10-10 在 Windows/Node.js 24 隔离运行上述三套件，混合专项 9 项、恢复 2 项和阻塞比较 2 项通过。混合专项包含真实创建子进程失败的 error/close 收尾、真实 TCP server 上同步发送故障注入后的连接计数释放，以及首包 Unicode 半字节分段的 native 回退。使用真实 loopback TCP socket 和正式子进程 IPC 移交，未操作既有监听服务。人为主线程阻塞 1 秒的比较中，阻塞区间 native 转发 p99 约 909.5 ms，子进程转发约 0.5 ms；这只说明合成阻塞下的隔离效果，不能推断当前服务负载存在该瓶颈。

后续隔离协议验收覆盖 OFF/ON 下的握手、屏障、换场、成员退出与重连、旧连接替换及代际隔离；12 房间、36 连接在两种模式下分别持续运行 30 分钟，逐帧检查未发现丢失、重复、乱序或跨房投递。成员快照仍通过异步 IPC 更新；上述结果只覆盖所执行的控制流程和负载范围。

这些是隔离协议模拟，不证明真机游戏画面、移动网络、公网端口或现有生产负载收益。启用前仍需按部署环境确认收益和连接行为。该功能只隔离战斗稳态流量，不完成实时 Hub 或持久化单写者重构，也不修复客户端断线重连或 APP 重启后的双端同步恢复。
