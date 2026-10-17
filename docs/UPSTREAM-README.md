# StarPoint CN

StarPoint CN 是《世界弹射物语》国服（雷霆）客户端的非官方服务端实现。本仓库在[上游项目](https://github.com/dontbealarmed/startpoint-cn)基础上继续维护云服务器部署、管理后台、联机、活动内容、任务成就、客户端兼容和运行性能。

> `main` 是唯一长期开发与整合分支；正式交付使用 `release-YYYY.MM.DD-N` 标签固定包源提交。推送代码不代表上传覆盖包或部署云服。自动测试和服务端构建通过不代表所有客户端流程都已完成人工验收。

## 支持边界

当前开发与验收基线包括：

- Android CN 派生客户端及累计补丁，public/LAN 输入分别从[平台工作入口](./client-patch/AGENTS.md)定位；
- iOS 独立平台补丁，实际输入与验收层级从同一入口定位对应登记；
- 官方 CN 1.4.54 CDN 基础资源，以及仓库清单中明确启用的增量补丁；
- Node.js 24 LTS 或更高版本；
- SQLite 本地状态，默认存放在 `.database/`。

项目不分发客户端 APK、官方 CDN、漫画资源、签名凭据或云服环境文件，也不保证兼容来源不明的客户端、损坏的 CDN 和未经验证的游戏逻辑修改。

本机与局域网可以直接运行。公网云服需要自行配置防火墙、nginx/反向代理、HTTPS 和 Cloudflare；HTTP 游戏服务与联机 TCP 服务默认监听 `8001`、`8003`。完整步骤见[云服务器部署说明](./docs/deployment.md)。

## 当前状态

服务端已经覆盖账号与存档、主要养成、主线与部分活动、单人和多人战斗、任务成就与称号、抽卡、商店、邮件、NPC 协力、管理后台及资源更新流程。部分旧端点、特殊活动和客户端边缘流程仍需要继续验证。

- [完整文档入口](./docs/README.md)：按系统、协议和操作目标查找文档
- [运行架构与排错入口](./docs/architecture.md)：服务如何运行、状态归谁管理、按症状从哪里查起
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

Windows 也可以使用仓库根目录的 `start-cn-production.bat`。从 Git 获取源码后，首次运行先执行 `npm ci` 和 `npm run build`，生成本地 `out/`；该 BAT 使用已有产物，不自动编译。云服覆盖包已包含对应运行产物。首次运行前请按实际网络环境修改 `.env`：局域网真机需要填写服务器 LAN 地址，云服应填写 Cloudflare/CDN 公网地址和联机公网地址。

上述启动脚本将 stdout/stderr 合并到 `.logs/cn-server-YYYYMMDD-HH00.log`，按北京时间
00/04/08/12/16/20 点切分，每四小时一份，同一时段重启追加、不覆盖。当前文件与游戏
PID 见 `.logs/cn-server-current.json`。生产 BAT 保留 7 天，普通日志入口保留 30 天，
调试入口保留 3 天。直接运行游戏 JS 不自动轮转，详见
[四小时日志说明](docs/development/SERVER-FOUR-HOUR-LOGS-20261005.md)。

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
| `npm run test:server-logs` | 验证四小时轮转、日志分析与进程退出，自动清理临时数据 |
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

历史 Android 基础适配涉及以下修改；制作或调整累计客户端前，先从[平台工作入口](./client-patch/AGENTS.md)选择当前登记输入及方法：

1. 在 `pinball/config/core/DevConfig.as` 启用 SDK Dummy，跳过官方登录；
2. 在 `pinball/config/gbits/DevConfig_gf_android.as` 将 API 地址改为本服务地址。

仓库保留基础适配脚本和说明，但不提供已签名 APK。以下命令用于匹配旧输入的基础适配，不作为累计客户端的默认起点：

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

正常开发与整合在 `main` 进行。普通协作者从最新 `main` 建立临时分支并向 `main` 提交 PR；仓库所有者在任务授权和保护规则允许时可验证后直接推送。正式交付标签按 `Asia/Singapore` 真实日期每日递增编号，标签只固定已有提交，不额外增加代码 commit。Git 保存源码及编译输入，不跟踪生成的 `out/`；服务端改动通过实际暂存输入的隔离编译检查，云服打包从固定提交生成并核验运行产物。覆盖包不包含 `.env`、数据库、日志、密钥或本地工作目录。详见[运行产物流程](docs/development/runtime-artifacts.md)。

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
