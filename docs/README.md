# StarPoint CN 文档索引

> tracked 持久知识库。环境/敏感(搭建、连接、APK)见本地环境文档(需自行准备,不随本仓库分发)。

## 架构与协议

- [运行架构与排错入口](./architecture.md)：先定位模块、状态归属、资源来源和验证层级。
- 协议: [多人联机](./protocol/multi-battle.md) · [抽卡 C3032](./protocol/gacha-c3032.md) · [种子验证](./protocol/seed-verification.md)

## 游戏系统
- [狂热激战](./systems/rush-event.md) · [体力](./systems/stamina.md) · [商店](./systems/shop.md) · [漫画](./systems/comic.md) · [邮件](./systems/mail.md) · [存档与校验](./systems/save-validation.md)

## 新人指南
- [新手入门与私服特色](./新手入门与私服特色.md)

## 客户端补丁
- [V51 客户端恢复游戏内“数据继承”入口](./client-takeover-entry.md)
- [数据继承服务端说明](./account-takeover-server.md)

## CDN
- [机制总览](./cdn/overview.md) · [客户端流程](./cdn/client-flow.md) · [排查手册](./cdn/debugging.md)

## 参考与状态

- [CN 协议与资源格式历史样例](./reference/cn-protocol-legacy.md)：兼容与复现参考，固定版本和包数不作为当前登记。
- [端点实现状态](./reference/routes-status.md) · [路由抓包索引](./routes/README.md)
- [已知问题](./status/known-issues.md) · [变更日志](./status/changelog.md) · [测试进度](./status/test-progress.md)

## 性能与运维
- [服务器固定四小时日志](./development/SERVER-FOUR-HOUR-LOGS-20261005.md)
- [幻想装备共斗准备拦截与倒计时保护](./development/MULTI-EQUIPMENT-READY-GATE-20261005.md)
- [四核服务器 CPU 优化实施记录](./development/MULTICORE-CPU-OPTIMIZATION-20261002.md)
- [多人共斗断线排查与修复记录](./development/MULTIPLAYER-DISCONNECT-INVESTIGATION-20261003.md)
- [云服运行日志复盘与第二轮优化](./development/RUNTIME-LOG-FOLLOWUP-20261003.md)
- [PR #15 上线后六小时日志复盘](./development/RUNTIME-LOG2-FOLLOWUP-20261003.md)
- [五重决战共斗掉线与 H400 修复](./development/FIVE-BOSS-DISCONNECT-H400-FIX-20261004.md)
- [五重决战 staging 新日志复查与续战修复](./development/FIVE-BOSS-STAGING-LOG-FOLLOWUP-20261004.md)
- [多人稳定性、五重、幻想与 AI 续战改进总记录](./development/MULTIPLAYER-STABILITY-CONSOLIDATED-20261004.md)
- [多人房间 H400 与登录任务恢复循环修复](./development/MULTIPLAYER-H400-LOGIN-LOOP-FIX-20261004.md)
- [幻想装备与魂珠准备页不可出战门禁](./development/FANTASY-EQUIPMENT-PARTY-GATE-20261004.md)
- [SQLite 单写线程实施记录](./development/SQLITE-WRITER-THREAD-20261003.md)

## 贡献流程

开发、验证、生成物和交付步骤见[开发与交付流程](./development/branch-workflow.md)；按问题定位先读[运行架构总览](./architecture.md)。

### 实现一个端点
1. 用 mitmproxy 抓取游戏客户端与官方服务器之间的流量(连接方式需自行搭建)。
2. 用 [msgpack-converter](https://ref45638.github.io/msgpack-converter/) 解码 MsgPack 请求/响应体。CN 主 API(`*.wdfp.*`)走 base64(msgpack);其余端点走纯 JSON。
3. 在 `src/routes/cn/`(CN 专属)或 `src/routes/api/`(双服共享)实现端点。
4. 更新 [端点实现状态](./reference/routes-status.md),并在 [路由抓包索引](./routes/README.md) 补充对应抓包记录。

### What's Left
所有已发现路由及其实现状态见 [端点实现状态](./reference/routes-status.md);各路由的 client↔server 数据细节见 [路由抓包索引](./routes/README.md)。

### Project Structure(要点)
- `src/routes/cn/` — CN 专属端点(asset / load / leitingAuth / versionCheck 等)。
- `src/routes/api/` — 双服共享 API 路由。
- `src/data/` — SQLite 数据层、共享连接、领域模块、初始化和玩家存档快照。
- `src/cn-server.ts` — CN 入口;`src/server.ts` — 全局入口。
- 当前模块分层、启动链路、状态/线程归属、协议编码与资源来源见[运行架构与排错入口](./architecture.md)。

### Scripts(要点)
- `scripts/start-cn.sh` — 一键构建并以生产方式重启 CN 服务。
- `scripts/cdn_download.py` — 下载官方 CDN 副本。
- `scripts/converter.py` — 将游戏资源转换为服务器可读格式(`in/` → `out/`)。
- `scripts/mitm-redirect-traffic.py` — mitmproxy 脚本,把游戏流量重定向到本服务。
