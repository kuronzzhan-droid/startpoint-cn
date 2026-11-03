# StarPoint CN

StarPoint CN 是《世界弹射物语》国服（雷霆）客户端的非官方服务端实现。本仓库在[上游项目](https://github.com/dontbealarmed/startpoint-cn)基础上继续维护云服务器部署、管理后台、联机、活动内容、任务成就、客户端兼容和运行性能。

> `staging` 是日常开发、集成测试和云服覆盖包的交付分支；`main` 只接收经过观察验证的稳定更新。自动测试和服务端构建通过不代表所有客户端流程都已完成人工验收。

## 支持边界

当前开发与验收基线包括：

- Android 官方 CN 1.8.1 客户端，仅修改登录跳过和服务器地址；
- 可选的 iOS 1.8.4 私服客户端补丁；
- 官方 CN 1.4.54 CDN 基础资源，以及仓库清单中明确启用的增量补丁；
- Node.js 24 LTS 或更高版本；
- SQLite 本地状态，默认存放在 `.database/`。

项目不分发客户端 APK、官方 CDN、漫画资源、签名凭据或云服环境文件，也不保证兼容来源不明的客户端、损坏的 CDN 和未经验证的游戏逻辑修改。

本机与局域网可以直接运行。公网云服需要自行配置防火墙、nginx/反向代理、HTTPS 和 Cloudflare；HTTP 游戏服务与联机 TCP 服务默认监听 `8001`、`8003`。完整步骤见[云服务器部署说明](./docs/deployment.md)。

## 当前状态

服务端已经覆盖账号与存档、主要养成、主线与部分活动、单人和多人战斗、任务成就与称号、抽卡、商店、邮件、NPC 协力、管理后台及资源更新流程。部分旧端点、特殊活动和客户端边缘流程仍需要继续验证。

- [完整文档入口](./docs/README.md)：按系统、协议和操作目标查找文档
- [端点实现状态](./docs/reference/routes-status.md)：查看路由族与端点覆盖情况
- [测试进度](./docs/status/test-progress.md)：区分自动回归与客户端人工验收
- [已知问题](./docs/status/known-issues.md)：当前限制与待处理问题
- [变更记录](./docs/status/changelog.md)：历史功能与修复记录
- [新手入门与私服特色](./docs/新手入门与私服特色.md)：面向玩家的功能介绍

## 最短启动

准备好官方 CN CDN 后：

```bash
npm ci
cp .env.example .env
bash scripts/start-cn.sh
```

Windows 也可以使用仓库根目录的 `start-cn-production.bat`。首次运行前请按实际网络环境修改 `.env`：局域网真机需要填写服务器 LAN 地址，云服应填写 Cloudflare/CDN 公网地址和联机公网地址。

`.env.example` 列出全部运行参数及安全默认值。3 Mbps 上行云服建议保留以下 `/load` 压缩配置：

```env
CN_LOAD_HTTP_COMPRESSION="gzip"
CN_LOAD_HTTP_GZIP_LEVEL=1
CN_LOAD_HTTP_COMPRESSION_LOG=false
```

压缩异常时将模式改为 `off` 并重启即可单独撤回，不影响其他服务端优化。

## CDN 与增量补丁

基础 CDN 放入 `CDN_DIR/cn/`，默认即 `.cdn/cn/`。客户端通过 `EntityLists` 路径清单获取资源；不同来源的 CDN 可能分别提供 `PathFile` 或 `10939-android_medium.csv`，部署前应确认客户端实际请求的清单文件存在。

资源目标版本不再读取 `CN_RES_VERSION`，而是根据 CDN 差分包与 `assets/asset-patch/manifest.json` 中启用的补丁自动计算。补丁文件不随普通源码覆盖包重复分发，发布前应检查当前云服的补丁链和清单是否一致。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm ci` | 按锁文件安装服务端依赖 |
| `npm run typecheck` | 只执行 TypeScript 类型检查 |
| `npm run build` | 编译服务端并生成旧管理页面所需 CSS |
| `npm run dev:cn` | 构建后使用 `.env` 启动 CN 服务 |
| `npm run debug:cn` | 使用 TypeScript 热重载启动 CN 服务 |
| `bash scripts/start-cn.sh` | Linux/macOS 前台构建并启动 CN 服务 |
| `npm run build:admin` | 安装并构建 React 管理后台到 `web/dist/` |
| `npm run dev:admin` | 启动 React 管理后台开发服务器 |

`node out/cn-server.js` 只适合已经完成构建的直接启动场景。生产环境应继续使用现有进程管理方式，并在覆盖文件或修改 `.env` 后明确重启服务。

## 管理后台

React 管理后台构建后位于 `/admin/`。旧管理页面仍保留 `/player`、`/player/:id`、`/mail` 和 `/seeds` 等入口，用于兼容现有运维流程。

```bash
npm run build:admin
```

管理入口受 `ADMIN_PANEL_PASSWORD` 保护；未配置或留空时会拒绝登录。公网访问应通过 HTTPS，并按实际代理配置决定是否启用 `ADMIN_COOKIE_SECURE`。导入存档、批量邮件和账号清理等写操作前应先备份数据库。

## 客户端补丁

Android 客户端连接本服务至少需要完成两项修改：

1. 在 `pinball/config/core/DevConfig.as` 启用 SDK Dummy，跳过官方登录；
2. 在 `pinball/config/gbits/DevConfig_gf_android.as` 将 API 地址改为本服务地址。

仓库提供补丁脚本和说明，但不提供已签名 APK：

```bash
bash client-patch/apply.sh <AS3_EXPORT_DIR> <SERVER_HOST>:8001
```

Android 与 iOS 的详细流程见[客户端补丁说明](./client-patch/README.md)。

## 项目结构

- `src/routes/`：CN、通用游戏 API 与管理后台 API
- `src/multi/`：多人房间、NPC 队友、战斗结算与 TCP 会话
- `src/data/`：SQLite 数据层、领域模块、初始化与存档快照
- `src/lib/`：任务、校验、缓存、兼容和运行时公共逻辑
- `admin/`：React 管理后台源码
- `assets/`：服务端业务表、CDN 派生表与资源补丁清单
- `client-patch/`：Android/iOS 客户端补丁工具和说明
- `tools/`：回归测试、资源检查、发布及独立辅助工具
- `docs/`：架构、协议、系统、运维、状态和路由文档

## 开发与交付

正常开发在 `staging` 进行；稳定发布由 `staging` 经过验证后合并到 `main`。服务端 TypeScript 改动需要同时验证并交付对应 `out/` 产物，云服覆盖包只包含运行必需文件，不包含 `.env`、数据库、日志、密钥或本地工作目录。

具体分支、同步与整合包规则见[开发与交付流程](./docs/development/branch-workflow.md)。私有仓库边界见[私有仓库说明](./PRIVATE_REPOSITORY.md)。

## 附带工具

- [魂珠图标转换工具](./tools/soul-icon-converter/README.md)：Windows 下批量转换魂珠图标并预览装备格效果；与服务端运行链路分离。

## 相关项目

- [DontBeAlarmed/startpoint-cn](https://github.com/dontbealarmed/startpoint-cn)：本仓库的 CN 服务端上游
- [Duosion/starpoint](https://github.com/Duosion/starpoint)：全球服服务端基础
- [wdfp-extractor](https://github.com/ScripterSugar/wdfp-extractor)：资源提取
- [wfax](https://github.com/blead/wfax)：资源转换与修改
- [starview](https://github.com/duosii/starview)：APK 补丁工具
- [wf-2.1.125-cn-decompiled](https://github.com/dennis96292/wf-2.1.125-cn-decompiled)：CN 客户端反编译参考

本项目采用 [GPL-3.0](./LICENSE) 许可证。
