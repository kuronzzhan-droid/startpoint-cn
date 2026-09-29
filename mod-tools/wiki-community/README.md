# Wiki 编队社区后台

这是 Wiki 专用的 Pages Functions + D1 模块，与游戏存档、游戏管理员密码、MOD 发布链隔离。
当前实现为**管理员创建和修改，游客浏览与点赞**。公开 `POST /teams` 固定拒绝，不能重新开启旧版游客投稿。

## 本地预览与检查

Node.js 24 使用内建 `node:sqlite`，无需安装新依赖。显式指定静态站目录、数据库路径和端口：

```powershell
node mod-tools/wiki-community/local-server.mjs --site D:/WF/out/MOD角色Wiki-20260929/site --db D:/WF/out/MOD角色Wiki-20260929/community-local.sqlite --port 8877 --owner-email owner@example.test --deputy-email deputy@example.test
node --test mod-tools/wiki-community/tests/*.test.mjs
```

只能监听 `127.0.0.1`。HTTP Host 也必须是对应端口的 localhost/127.0.0.1。
数据库应放在静态站目录之外；正式本地目录与浏览器联调测试库分开，测试数据不可导入生产。
修改中的前端需由 Wiki 原有流程复制到站点目录。静态文件支持 MIME、懒加载分包和音频 Range。

本机默认使用真实邮箱登录名及密码账号；邮箱仅作登录名，不会创建邮箱或发送邮件。
站长第一次打开后台时自行设置密码，再创建管理员；密码不要写入命令、源码或聊天记录。
上面示例邮箱须替换成使用者实际指定值，`--deputy-email` 仅预填建议，不会直接创建账号。
账号权限、密钥持久化和生产配置详见 [邮箱密码管理员说明](AUTH.md)。

本地配置返回 `development:true`，页面必须明确显示“本地测试验证”：

- `GET /api/community/development-challenge?action=like_team` 或 `admin_login` 返回一次性本地 token，五分钟过期。
- 密码模式关闭 `development-admin-login`；仅旧 Access 专项测试以显式 `authMode:'access'` 启动时保留固定测试管理员。
- 生产 Functions 入口不引用 `development.mjs`。设置任何环境开发旗标都不能打开这些接口。

## API

全部接口前缀为 `/api/community`，JSON 错误统一 `{error,message,...}`。
写请求必须带与当前请求地址完全一致的 `Origin`；前端使用同源 fetch 和 cookie。

| 接口 | 权限与结果 |
| --- | --- |
| `GET /config` | 配置、元素、伤害类型；`canSubmit:false,publishing:'admin'` |
| `GET /teams` | 公开盘子 `{items,nextCursor}`；支持 element、damage、sort、cursor |
| `GET /teams/:id` | 单个公开盘子 `{team}`，含 likedToday |
| `POST /teams` | 始终 403 submission_disabled |
| `POST /teams/:id/like` | `{turnstileToken}` → `{id,likes,likedToday,nextLikeAt}` |
| `GET /admin/me` | 验证后的管理员；密码模式含 role/enabled/revision/mustChangePassword |
| `GET /admin/login` | 验证后重定向 `/#community/admin` |
| `GET /admin/teams` | 管理员列表，额外含 status/revision，支持 status 筛选 |
| `POST /admin/teams` | 管理员创建 → 201 `{team}`，立即公开并记录审计 |
| `PATCH /admin/teams/:id` | 管理员修改；必须传 expectedRevision，避免覆盖并发编辑 |
| `GET /admin/teams/:id/game-code` | 当前阵容码 `{gameCode,active,teamRevision}` |
| `POST /admin/teams/:id/game-code` | 管理员生成/复用，必须传 expectedRevision |
| `POST /admin/teams/:id/game-code/revoke` | 管理员停用，必须传 expectedRevision |
| `GET /game-codes/:code` | 供已接入的游戏服务读取 `{title,active:true,team}` |

创建和编辑内容：`title` 最多 80 字符、`author` 最多 40（标题与署名须单行）、`notes` 最多 2000（支持多行），`team`
含 main/unison/weapon/soul 四个长度为 3 的数组，空槽为 `""`。三主位必填，角色不能重复，
魂珠必须被可信目录允许。`element` 为 `auto`、目录的中文属性、或 `universal`（宇宙）。
`damageTypes` 至少一种，可多选 skill/ability/powerflip/direct；GET 的 `damage` 逗号分隔且取 AND。
默认 latest，popular 按累计赞、创建时间排序。队伍 ID 和游戏码是不同标识。

阵容指纹固定第一列队长；第二、三列整体交换视为相同阵容。主位、合击、武器、魂珠配对保留。
标题、备注、署名、分类变化不改变指纹。重复返回 409 duplicate + existingId/status；隐藏盘不泄漏正文。
修改冲突返回 409 edit_conflict。点赞重复为 409 already_liked，包含当前赞数和次日可赞时间。

## 生产配置与部署边界

部署前必须准备独立 D1，并用 `schema.sql` 初始化。`catalog.mjs` 由
`wf_wiki_community_catalog.py` 从已脱敏 Wiki 数据生成，只接受站内收录 ID，不能信客户端传来的角色属性。

| 配置 | 用途 |
| --- | --- |
| `COMMUNITY_DB` | D1 绑定，只有 Wiki 数据 |
| `COMMUNITY_COOKIE_SECRET` | 至少 32 字符的随机私密签名密钥 |
| `COMMUNITY_IP_SALT` | 另一个至少 32 字符随机私密密钥，用于 HMAC 限频键 |
| `TURNSTILE_SECRET` | Turnstile 私密服务端验证密钥 |
| `TURNSTILE_SITE_KEY` | 前端公开组件 site key |
| `COMMUNITY_ALLOWED_HOSTNAMES` | 允许域名逗号分隔，不写 scheme/path |
| `ACCESS_TEAM_DOMAIN` | 固定的 `团队名.cloudflareaccess.com` |
| `ACCESS_AUD` | 管理员 Access 应用的 AUD |
| `ADMIN_EMAILS` | 已验证管理员邮箱白名单，逗号分隔 |
| `COMMUNITY_AUTH_MODE` | 默认 `access`，设 `password` 使用站内邮箱密码管理；额外配置见 AUTH.md |

私密密钥通过 Cloudflare secret 配置，不写进本文件、前端、Git 或部署日志。
**仅 Access 模式**：Cloudflare Access 应用保护 `/api/community/admin/*`，配置允许的管理员邮箱及登录方式。
登录页通过 Access 后才会进入 handler；服务端仍验证 RS256 签名、固定域名 JWKS、app 类型、
iss/aud/exp、存在时的 nbf、sub、email 白名单，不信任裸邮箱头。管理员无权限通过 API 增加管理员。
该模式增加/移除管理员须由站点所有者修改 Access 策略和 `ADMIN_EMAILS` 配置。首次实际登录与云端权限需上线实测。
切换成密码模式后，由站内账号管理授权；不能继续用旧 Access 邮箱名单拦住管理路径，详见 AUTH.md。

Pages Functions 以此目录为项目工作目录，`functions/api/community/[[path]].js` 为入口；
生产打包仅由 Functions 引入 handler 所依赖的模块，不能把 SQLite adapter、开发 server、tests、README 当静态文件外发。
`_routes.json` 复制到最终静态输出根目录，仅 API 触发 Functions。现有 Wiki 精确打包器还需显式支持这一个路由配置，
不能直接扩大静态文件白名单。绑定/密钥未配置时返回 503，数据库不可用也不伪装提交成功。
启用云资源、绑定、公开部署都属于后续明确的站点部署步骤，本模块的本地测试不证明生产已启用。

### 仅本地构建 Functions

在本目录运行以下命令。`<仓外构建目录>` 必须预先创建，且不得指向静态站输出目录：

```powershell
npx --offline --yes wrangler@4.143.0 pages functions build functions --project-directory . --outdir "<仓外构建目录>" --output-routes-path "<仓外构建目录>/_routes.json" --output-config-path "<仓外构建目录>/worker-config.json" --metafile "<仓外构建目录>/bundle-meta.json" --compatibility-date 2026-09-29 --fallback-service ASSETS --minify
node verify-build.mjs "<仓外构建目录>"
```

须设置 `WRANGLER_SEND_METRICS=false`，已有 npm 缓存不足时 `--offline` 会失败，不会改为联网安装。
`--minify` 会移除默认 bundle 内的构建机绝对路径注释，不输出 sourcemap。
验证器检查生产模块闭包、路由范围、本地测试接口不可达，以及编译后 Worker 的 ASSETS 回退。
它禁止网络请求，使用本地 SQLite 与 ASSETS 替身执行实际编译脚本；这不等于线上 Cloudflare 验收。
只有 `index.js` 是 Worker 脚本；`bundle-meta.json`、`worker-config.json`、`verification.json` 都是仓外审计资料，
包含或可能包含构建信息，绝不能加入公开静态包。部署时由现有精确打包/Functions 流程接入 Worker，
不要把整个构建目录作为网站文件夹上传。

## 点赞、防刷与维护

匿名访客使用 HMAC 签名 HttpOnly / SameSite=Strict cookie，生产额外要求 Secure。
数据库唯一键 `(team_id,visitor_id,北京时间日期)` 保证每日每盘一次；触发器与插入同事务计数。
清 cookie 或更换设备会成为新访客，不能声称绝对“一人一次”。IP 只辅助限频，不原文存储。
后台校验 Turnstile 的 success、本站 hostname 和 action=`like_team`；失败、超时、重复 token 均不写点赞。
Turnstile 服务端负责生产 token 的单次有效性。应用不缓存人机验证成功状态。

管理员写入和点赞按每 IP 每小时 120 次限制，游戏码读取每 IP 每分钟 300 次。
响应 429 带 Retry-After。限频键是带私密盐与时间窗口的 HMAC，过期键在后续成功限频操作中清理。
IP 共用、代理与设备重置仍存在，不将 IP 视为用户身份。
审计保存管理员标识/邮箱、时间、操作、队伍 ID 和修改前后内容；管理操作与审计用 D1 batch 同事务。

游戏码使用密码学随机 12 位大写 32 字母表（60 bit），只有管理员能生成。
相同阵容有效码复用，改阵容或隐藏在同事务永久撤销旧码；仅改备注或标题仍可复用。
恢复公开或改回原阵容不会自动恢复旧码，须管理员显式重新生成。隐藏、停用码查询返回 404。
公开查询只返回已脱敏阵容和标题。游戏端必须明确配置该 HTTPS 只读接口，且缓存不超过 10 秒；
仅 Wiki 有码不等于灰服或现有 APK 已支持导入，接入与实机验收单独报告。

可用 D1 控制台/Wrangler 查询审计，禁止直接在前端暴露管理员查询或数据库 secret：

```sql
SELECT actor_email, action, team_id, created_at FROM community_audit ORDER BY created_at DESC LIMIT 100;
```

## 官方实现依据（2026-09-29 核对）

- [Cloudflare Access JWT 验证与固定 JWKS](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access 应用 token 字段](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Turnstile 服务端必需校验](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Pages D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)
- [Pages Functions 路由](https://developers.cloudflare.com/pages/functions/routing/)
- [Pages Functions 免费额度](https://developers.cloudflare.com/pages/functions/pricing/)和[D1 额度](https://developers.cloudflare.com/d1/platform/pricing/)

免费层有请求、读写行与存储额度；用量达到上限可能暂不可用，不承诺无限免费，也不自动升级付费计划。
