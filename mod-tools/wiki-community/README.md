# Wiki 编队社区后台

这是 Wiki 专用的 Pages Functions + D1 模块，与游戏存档、游戏管理员密码、MOD 发布链隔离。
当前实现为**管理员创建和修改，游客浏览与点赞**。公开 `POST /teams` 固定拒绝，不能重新开启旧版游客投稿。

副本攻略、推荐队伍关联和图片上传的完整契约见 [副本攻略接口](DUNGEONS.md)。
新增 `GET /dungeons/:id`、管理员同路径读写及图片上传/删除，复用现有账号权限和审计。
只关联公开队伍，移除引用不删除原盘；攻略最多 30000 字，图片采用 D1 BLOB 独立保存，不嵌入正文或静态包。
图片只在攻略引用后公开，单图 512 KiB；存储配额全站 256 MiB / 管理员 64 MiB / 副本 8 MiB，上传每小时 20 次。
部署前按现有流程增量执行 `migrations/0007-dungeon-guides.sql`；这不会替换账户、队伍或游戏码数据。

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
| `GET /config` | 配置、元素、伤害类型、玩法分区 sections；`canSubmit:false,publishing:'admin'` |
| `GET /teams` | 大全公开盘子 `{items,nextCursor}`；支持 q、character、section、category、element、damage、code、sort、cursor |
| `GET /teams/:id` | 单个公开盘子 `{team}`，含 likedToday |
| `POST /teams` | 始终 403 submission_disabled |
| `POST /teams/:id/like` | `{turnstileToken}` → `{id,likes,likedToday,nextLikeAt}` |
| `GET /admin/me` | 验证后的管理员；密码模式含 role/enabled/revision/mustChangePassword |
| `GET /admin/login` | 验证后重定向 `/#community/admin` |
| `GET /admin/teams` | 授权列表，额外含 status/revision/visibility/createdBy，支持 status、scope 筛选 |
| `GET /admin/teams/:id` | 授权单盘 `{team}`；其他管理员的私盘返回 404 |
| `POST /admin/teams` | 管理员创建 → 201 `{team}`，按 visibility 保存并记录审计 |
| `PATCH /admin/teams/:id` | 管理员修改；必须传 expectedRevision，避免覆盖并发编辑 |
| `GET /admin/teams/:id/game-code` | 当前阵容码 `{gameCode,active,teamRevision}` |
| `POST /admin/teams/:id/game-code` | 管理员生成/复用，必须传 expectedRevision |
| `POST /admin/teams/:id/game-code/revoke` | 管理员停用，必须传 expectedRevision |
| `GET /game-codes/:code` | 供已接入的游戏服务读取 `{title,active:true,team}` |
| `GET /aliases` | 游客读取角色/武器黑话 `{items:[{kind,id,aliases,revision}]}`，不含修改者 |
| `GET /admin/aliases/:kind/:id` | 管理员读取单项 `{kind,id,aliases,revision}`；未编辑过为空数组、revision=0 |
| `PATCH /admin/aliases/:kind/:id` | 管理员编辑 `{aliases,expectedRevision}`，返回直接记录；支持清空 |
| `GET /ratings/characters/:id` | `{average,voters,myScore,ratedToday,nextVoteAt}`；未有评分 average=null；nextVoteAt 为毫秒时间戳 |
| `POST /ratings/characters/:id` | `{score,turnstileToken}`，验证动作 rate_character，成功返回同一记录格式 |

创建和编辑内容：`title` 最多 80 字符、`author` 最多 40（标题与署名须单行）、`notes` 最多 2000（支持多行），`team`
含 main/unison/weapon/soul 四个长度为 3 的数组，空槽为 `""`。三主位必填，角色不能重复，
魂珠必须被可信目录允许。`element` 为 `auto`、目录的中文属性、或 `universal`（宇宙）。
`damageTypes` 至少一种，可多选 skill/ability/powerflip/direct；GET 的 `damage` 逗号分隔且取 AND。
新建必须指定一个 `category`：萌新启航、原版毕业队、MOD毕业队、最新最潮盘、玩具盘。
旧记录空分类保留，编辑时可保留空值或指定分类；已经分类的队伍不能改回空值。
GET 的 `category` 省略表示全部，`uncategorized` 表示未分类，其余使用上述中文分类；与属性、伤害和状态取 AND。
玩法 `section` 是独立字段：空值表示其他，`abyss` 为深渊，`abyss-ex` 为深渊EX，`fantasy` 为幻想，`five-boss` 为五重，`original` 为原版。
新建请求省略 section 时默认为空；编辑省略时保留原值，显式空值可改回其他。旧盘不会根据分类、标题或阵容自动猜测玩法。
GET 的 `section` 省略或空值表示全部，`general` 仅查看其他，其余使用上述玩法标识；与其他筛选取 AND。
分页游标绑定这些筛选条件，改变分类或玩法后必须从第一页载入。仅改变这些元数据不会改变阵容指纹或撤销游戏码。
默认 latest，popular 按累计赞、创建时间排序。队伍 ID 和游戏码是不同标识。

公开列表 `q` 是单个搜索关键词，最多 80 个 Unicode 字符，去首尾空格并做 NFC 规范化，不接受换行或控制字符。
在队名、攻略备注或主位/合击角色姓名（含版本）中做字面包含匹配；不把 `%`、`_` 当通配符，也不搜索作者或游戏码。
角色名来自同批已脱敏 Wiki 的可信目录；不会读取管理员黑话或让客户端任意提交角色匹配集。
搜索与其他筛选取 AND，在数据库分页前执行，游标绑定关键词。私盘、待审核和已删除队伍始终不进入公开搜索。
管理员列表原有 `q` 队名、作者和有效游戏码搜索口径保持不变。此功能不新增数据库表、字段或迁移。

`visibility` 为 `public`（配队大全）或 `private`（个人空间）。新建省略时兼容旧客户端，默认 public；编辑省略时保持原值。
创建者 `createdBy` 由已验证的登录身份写入，客户端传入无效；旧盘创建者为空，不根据署名或历史隐藏状态猜测。
游客只能查看和点赞 `visibility=public,status=approved` 的盘子。普通管理员可以管理全部公开空间的盘子及本人私盘；
站长、副站长可以管理所有私盘。只有创建者、站长或副站长可以把公开空间盘子移入个人空间。
管理员列表 `scope=all` 默认返回可见全集，`public` 查看公开空间，`mine` 查看本人私盘；`private` 查看全体私盘，仅站长/副站长可用。
其他管理员私盘的读取、编辑及队伍码管理均返回 404；重复阵容冲突不返回该私盘的 ID 或状态。
`code=has` 仅查看有当前有效码的盘子，`none` 仅查看没有有效码的盘子；省略时不限。此筛选在数据库分页之前执行。
分页游标同时绑定空间、队伍码条件和管理员身份，不能跨账号或改变筛选后继续使用。

个人空间的盘子保存后可以显式生成公开游戏码；知道码的玩家可查询其阵容，但它仍不出现在配队大全，备注与创建者不随游戏码公开。
切换保存空间不会撤销已发布的码；管理员可单独停用码。原有 `status=hidden` 表示隐藏停用，仍会永久撤码，不等于个人空间。

黑话独立于导出的角色/武器数据，默认完全留空，不自动填入示例。`kind` 仅允许 character 或 weapon，ID 必须仍被可信目录收录。
普通管理员、副站长和站长都可以编辑；游客只能读取。每项最多 12 个黑话，每个最多 32 个 Unicode 字符，去首尾空格、NFC 规范化并忽略大小写去重；单项不接受空值、换行或控制字符。
提交空数组可清空，记录及递增版本保留。并发修改要求 expectedRevision，与审计写入同事务；公开接口不返回管理员身份。
黑话属于纯文本，前端展示必须使用 textContent，不能作为 HTML 或脚本执行；清空后公开列表不再包含该项，便于搜索同步移除。

角色评分只接受 0–5 的整数，0 分计入平均分及人数。每个签名访客 Cookie 对同一角色在北京时间每天只能提交一次，次日提交覆盖旧分，
同一访客始终只占一票。平均分保留两位小数；GET 只返回当前访客自己的 myScore，没有评分时为 null，不泄漏其他访客标识或单独分数。
为防同日清 Cookie 重投，另用 HMAC(IP + 角色 + 北京日期) 占位，IP 原文不入库；同一网络当天对同一角色只能提交一次，
但可评价其他角色。因此共享 IP 的玩家可能互相占用额度，且匿名机制不能保证跨设备、跨网络的真实一人一票。
GET 发现同 IP 已占位时也返回 ratedToday=true，当前浏览器没有自己的评分则 myScore=null。重复 POST 返回 409 already_rated，顶层附上相同记录字段。
每天占位和最新评分写入同一事务；保留当日及前一天的占位以避免跨午夜在途请求绕过限制。管理员登录不免除验证码、每日限制或频率限制。

阵容指纹固定第一列队长；第二、三列整体交换视为相同阵容。主位、合击、武器、魂珠配对保留。
标题、备注、署名、分类、玩法变化不改变指纹。重复返回 409 duplicate + existingId/status；隐藏盘不泄漏正文。
修改冲突返回 409 edit_conflict。点赞重复为 409 already_liked，包含当前赞数和次日可赞时间。

## 生产配置与部署边界

部署前必须准备独立 D1，并用 `schema.sql` 初始化。`catalog.mjs` 由
`wf_wiki_community_catalog.py` 从已脱敏 Wiki 数据生成，只接受站内收录 ID，不能信客户端传来的角色属性。

已有数据库升级分类和玩法功能时，先备份并执行 `PRAGMA table_info(community_teams)` 检查：
若没有 `category` 列，在部署新版 Worker 前执行一次 `migrations/0001-team-category.sql`。
若没有 `section` 列，再执行一次 `migrations/0002-team-section.sql`。
若没有 `visibility` 和 `created_by` 列，再执行一次 `migrations/0003-team-visibility.sql`；这两个字段应在同一迁移中追加。
黑话功能需执行 `migrations/0004-wiki-aliases.sql`，只追加两张独立表及索引，可安全重复执行，不预填内容。
角色评分需执行 `migrations/0005-character-ratings.sql`，只追加评分/每日占位两表及索引，可安全重复执行，不预填分数。
已有对应列时不要重复执行 ALTER；新库使用当前 `schema.sql` 即可。
迁移只追加默认空值列及索引，保留队伍、赞数、审计、队伍码和管理员账号。
本地 SQLite 适配器在下次启动时自动检测并事务执行同一迁移，重复启动不会重置已填分类。

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

配队公告：`GET /api/community/announcement` 返回纯文字 `text`、`revision`、`updatedAt`，未设置时为空；公开读取缓存 30 秒，不轮询。
已登录管理员可 `GET/PATCH /api/community/admin/announcement`，保存提交 `{text, expectedRevision}`，正文最多 500 字，留空撤下。
并发编辑返回 409 并保留输入，保存与独立审计原子提交；首次部署需应用 `0012-community-announcement.sql`。

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

### 2026-10-02 低频汇总

- 公共角色评分列表及手排榜共用一份每日持久快照，按北京时间换日后首次访问汇总；同日其他访客复用。
  投票立即保存，个人评分详情仍返回本人的即时提交结果，图鉴和公共榜在下一次汇总时反映变化。
  公共结果附 `asOf`、`nextRefreshAt`、`refreshDay`、`stale`；汇总失败保留有明确标记的旧榜，并退避重试。
  日期、角色目录和评分规则共同隔离缓存，管理员私有接口与可撤销队伍码不进入该缓存。
- 在线心跳每 30 分钟一次，统计含义为“近 30 分钟活跃访客”，多标签合并且后台暂停。
  公开统计最多边缘缓存 30 分钟；不代表实时在线人数，也不保证跨设备识别同一个人。
- 过期限流记录全站每 30 分钟清理一批，最多 1000 条，通过持久抢占和过期索引避免每次请求删除。
  **每次请求仍立即计数并执行原限流阈值**，并未把防刷判断推迟到 30 分钟，也未取消计数写入费用。
- 角色关联队伍使用索引，并在概览滚动接近对应区域时才加载；队伍权限和可见性仍实时检查。
- 上线前增量应用 `0013-daily-ranking-snapshot.sql`、`0014-limit-maintenance.sql`、`0015-team-character-index.sql`。
  三份迁移只新增派生缓存、维护表、关系表、索引和触发器，保留原票、队伍、账号及队伍码。
  静态 `_headers` 仅对文件名为内容 SHA-256 的 `/media/*` 设置一年缓存，HTML/脚本/API 不延长缓存。
  这是降低用量的实现，不是 Cloudflare 费用硬上限；不修改套餐或自动付费设置。

### 角色查看次数和相关配队

`GET /api/community/characters/:id/views` 返回 `{characterId, views, windowSeconds:1800}`，
只读、不建访客 cookie，`views` 是累计查看次数。实际角色页面先通过 `/config` 建立访客身份，再以 `{}`
为正文 `POST` 同一路径，响应同上；缺少有效身份时返回 428 `visitor_required`，客户端可刷新配置后重试一次。
同一匿名访客、同一角色连续 30 分钟最多计一次；刷新页面、概览与详细面板切换、多标签同时请求不会多计。
重复查看不会把计数窗口顺延，不可见或未收录角色返回 404。此数不是独立人数，不能追溯功能上线前的查看。

计数与窗口声明在一个事务中提交；去重仅保存按角色隔离的 HMAC 访客标识和最后计数时间，不存原始 IP、UA。
累计次数独立保存，不随去重记录过期删除。每次新计数最多清除 100 条过期去重记录；单角色 GET 不清理、不写库。
POST 要求同源 JSON，每个网络每分钟最多 120 次，限流表复用现有 HMAC IP 标识。
现有库上线前须执行增量 `migrations/0010-character-views.sql`；本地 SQLite 按当前 `schema.sql` 自动补齐。

`GET /api/community/views/characters` 匿名批量返回 `{items:[{id,views}],asOf,nextRefreshAt}`，两时间均为 UTC ISO。
包含全部当前公开角色，无累计记录时 `views:0`，未知或移除的角色不返回；不建立 cookie、不计数、不读访客去重表。
仅按总计表生成半小时快照，UTC 每小时整点/半点后首次访问更新，边缘使用相同边界缓存；没有后台轮询。
复用已有 `community_daily_ranking_snapshots` 的 JSON/租约结构，`character-views:v1:<角色集合哈希>` 键与日榜键隔离；
只维护派生快照，不改角色累计次数、票或访客记录，无新增迁移。暖新实例只按主键读取一条快照，不重扫角色总计。
同实例并发合并，跨实例通过 30 秒租约避免重复聚合；失败保留 60 秒冷却。尚无当前快照时返回 503
`views_refreshing` 和 `Retry-After`，客户端保留未知状态，不能将不可用当作零次。

`GET /api/community/teams?character=:id` 可与原筛选、排序组合，只匹配主位或合击槽里的完整角色 ID，
不匹配名字、备注、武器或魂珠。返回仍为 `{items,nextCursor}`，每页 24 支，翻页必须保留同一个 `character`；
无效或不在当前图鉴的筛选 ID 返回 400 `invalid_character`。公开列表始终仅包含公开且使用中的队伍，
私有队伍即使单独公开了游戏队伍码，也不会出现在相关配队中。管理员列表可选相同过滤，原权限保持。

### 参与人数和在线人数

`GET /api/community/stats` 匿名读取，不建立访客 cookie，返回
`{ratingVoters, tierVoters, totalVoters, onlineVisitors, asOf, presenceWindowSeconds:1800, participationAsOf, participationStale}`。
`asOf` 为在线统计采样时间，`participationAsOf` 为参与人数最近成功汇总时间，均为 UTC ISO。
评分和手排分别统计当前图鉴有效票的独立访客；同人评多个角色只计一次，评分 0 分仍计票，
空手排或只包含已移出图鉴角色的手排不计参与。`totalVoters` 对两个来源再去重，不能直接相加。

参与人数持久快照按当前角色 ID 集合的哈希保存。评分/手排的增删改通过数据库触发器推进修订号；
修订号未变化时只按主键读快照，不扫描投票表。变化后每份快照最多每 60 秒尝试刷新一次，
30 秒数据库租约保证不同 Worker 实例不会一起重算；发布前核对修订号和租约，避免并发投票覆盖。
刷新中返回旧快照并标记 `participationStale:true`；尚无快照则返回可重试错误，不伪造零人数。
在线人数继续使用 `last_seen` 索引单独统计；禁止用角色全集 JSON 交叉查询反复扫描投票。

Cloudflare 边缘将公开 `/stats` 缓存 30 分钟，`/ratings/characters` 和 `/tier-rankings` 缓存至北京时间换日；
同一 Worker 的相同冷缓存请求合并加载。个人评分、管理员、队伍及可撤销游戏码不使用此缓存。
参与人数需要下一次请求触发刷新，缓存和心跳会增加可见延迟；页面显示定时更新而非即时统计。
公共 GET 可以维护内部参与人数快照，不修改玩家票、在线记录或其他业务资料。
现有库部署前需执行 `migrations/0011-participation-snapshots.sql`；迁移可重复执行，保留原数据。
本地 SQLite 适配器按 `schema.sql` 自动补齐，不能用空库替换已有库。

前端先通过 `/config` 建立身份，再每 30 分钟 `POST /api/community/presence`，正文为 `{}`；
心跳要求同源 JSON，无有效访客 cookie 时返回 428 `visitor_required`，不另发 cookie。
同访客每 30 分钟最多更新一次，活跃人数指最近 30 分钟有心跳的访客，不能作为实时在线人数或登录人数。
支持 Web Locks 与 localStorage 的同源多标签共用发送间隔和公开统计；后台页面暂停心跳，
关闭发送页后其他可见页可接替。缺少这些浏览器能力时按每页 30 分钟降级，不保证请求去重。
共享存储仅保存公开统计和调度时间，不存账号、令牌或访客标识。

统计请求失败后按 30/60/120/240 分钟退避，成功后恢复；每日额度错误按 UTC 重置时间等待，
旧服务未返回重置时间时至少等 1 小时。保留并标记上次成功数据，不把错误当零人数。
服务端 `/stats` 和 `/presence` 数据库异常后暂停 5 分钟；识别到每日额度耗尽则暂停到 UTC 次日。
暂停标记使用内存与边缘缓存，不依赖 D1；返回 503 和 `Retry-After`。输入错误、身份校验、
单 IP 限流和快照刷新竞争不触发全站暂停。游戏码与其他业务不受这道统计熔断器主动拦截。
这是减少统计故障重试的软保护，不是账户费用硬上限，跨边缘节点也不是全局唯一探测器。
若在同一域名替换数据库绑定，需同时更改非秘密配置 `COMMUNITY_STATS_CACHE_NAMESPACE`
（默认 `v1`），使旧数据库的边缘暂停标记失效；各实例按域名和该版本共享标记。

只存带域隔离 HMAC 的访客标识和最后心跳时间，不存原始 IP、UA 或页面浏览轨迹。
请求复用哈希 IP 限流桶，每分钟最多 300 次；每次有效心跳最多清除 100 条过期在线记录。
在线表及索引由 `migrations/0009-presence.sql` 创建，部署既有库时只做增量迁移。

### 从夯到拉动态排行

`GET /api/community/tier-rankings` 匿名读取两套独立榜单，不生成访客 cookie；前端可选手动排行或角色评分榜，
各自按角色属性切换总榜与六属性榜。返回 `rankings.placement` 和 `rankings.rating` 两个有序数组，
每条为 `{id, average, voters, rankScore, row}`，不再混合两个来源。
`GET /api/community/tier-rankings/me` 读取自己的提交状态；`POST /api/community/tier-rankings` 接收
`{rows, turnstileToken}`，验证码 action 为 `submit_tier_ranking`。拖拽只保存到本机，玩家显式验证、提交后才计票。

五档按 5、4、3、2、1 分，四条档间线分别为 4.5、3.5、2.5、1.5 分。
角色评分仍为 0–5 分。两榜分别按 `(实际票数 × 真实均分 + 5 × 中间分) / (实际票数 + 5)` 修正排序分；
手排中间分为 3，角色评分为 2.5。5 个中间分仅是排序参考权重，不增加真实投票人数。
`formula` 返回 `{method:'bayesian', priorVoters:5, placementPrior:3, ratingPrior:2.5, tierMethod:'raw-average', minimumTierVoters:3}`。
`average` 保留真实均分（两位），`voters` 保留真实票数；`rankScore` 使用未舍入的均分计算。
满 3 票的角色按该来源真实均分分档（在数据库未舍入均分处计算，不能使用两位展示值重算）；
档内按排序分降序，同分按该来源票数降序，最后按公开角色 ID 稳定排序。
少于 3 票的角色返回 `row:'provisional'`，统一放在全部正式档位之后的“票数不足·暂定”区，
保留真实均分、人数与详情，不认定其为夯或拉完了。第三票进入分档，撤回至不足 3 票时回到暂定区。
五档及四条分界线仍采用每半分一个中心的最近档位；恰好两档中间时取低档（如 4.75 为夯↔顶级，1.25 为拉完了）。
不强制按比例填满各档；某档无人符合时留空。无该来源投票的角色不进入对应榜单，属性筛选不改变分档或分数。
图鉴评分排序使用同一角色评分修正分，支持升降序，无票置后；评分汇总和个人评分接口也返回 `rankScore`（无票为 `null`）。
每个角色每位访客只保留一票；整榜按北京时间每天提交一次，下次提交替换全榜，未摆放角色不计票，空榜撤回旧手排票。
每日网络 claim 防止同一 IP 清 cookie 后重复提交，且不存储原始 IP；公共接口不返回身份信息。

现有数据库上线前需执行增量迁移 `migrations/0008-tier-rankings.sql`，不改原角色评分表。
每位访客保存一份 JSON，整榜提交使用固定三句事务，避免按几百个角色逐项写入。

匿名访客使用 HMAC 签名 HttpOnly / SameSite=Strict cookie，生产额外要求 Secure。
数据库唯一键 `(team_id,visitor_id,北京时间日期)` 保证每日每盘一次；触发器与插入同事务计数。
清 cookie 或更换设备会成为新访客，不能声称绝对“一人一次”。IP 只辅助限频，不原文存储。
后台校验 Turnstile 的 success、本站 hostname 和 action=`like_team`；失败、超时、重复 token 均不写点赞。
Turnstile 服务端负责生产 token 的单次有效性。应用不缓存人机验证成功状态。

管理员写入、点赞和角色评分分别按每 IP 每小时 120 次限制，游戏码读取每 IP 每分钟 300 次。
响应 429 带 Retry-After。限频键是带私密盐与时间窗口的 HMAC，过期键由请求触发的 30 分钟维护门控分批清理。
IP 共用、代理与设备重置仍存在，不将 IP 视为用户身份。
审计保存管理员标识/邮箱、时间、操作、队伍 ID 和修改前后内容；管理操作与审计用 D1 batch 同事务。

游戏码使用密码学随机 12 位大写 32 字母表（60 bit），只有管理员能生成。
相同阵容有效码复用，改阵容或隐藏停用在同事务永久撤销旧码；仅改备注、标题或保存空间仍可复用。
恢复公开或改回原阵容不会自动恢复旧码，须管理员显式重新生成。隐藏、停用码查询返回 404。
公开查询只返回已脱敏阵容和标题。游戏端必须明确配置该 HTTPS 只读接口，且缓存不超过 10 秒；
仅 Wiki 有码不等于灰服或现有 APK 已支持导入，接入与实机验收单独报告。

可用 D1 控制台/Wrangler 查询审计，禁止直接在前端暴露管理员查询或数据库 secret：

```sql
SELECT actor_email, action, team_id, created_at FROM community_audit ORDER BY created_at DESC LIMIT 100;
```

### 可编辑赞助广告位

默认关闭，未配置时不占页面空间。站长、副站长在管理页展开“赞助广告设置”，填写标题、简短说明、图片地址和跳转链接，
可显式预览、保存草稿或启用；普通管理员不能读取草稿或修改广告。图片可留空，启用需要标题与 HTTPS 跳转链接。
仅接受 HTTPS PNG/JPG/WebP 图片地址或本站 `/media/<64位哈希>.扩展名`，不接受脚本或 HTML 广告代码；预览不会自动打开广告目标。

`GET /api/community/sponsorship` 匿名读取已启用的素材；关闭时清空所有公开素材字段，不发访客 cookie。
`GET/PATCH /api/community/admin/sponsorship` 使用现有管理员身份、同源检查和写入限频，PATCH 带 `expectedRevision` 防止覆盖他人的更新；
配置与审计同事务保存。现有库增量执行 `migrations/0016-sponsorship.sql`，不会创建默认广告或更改队伍资料。

访客滚动接近页脚才请求配置，单页只加载一次，不统计点击或曝光、不自动轮播、不轮询。
边缘缓存与浏览器会话缓存均在每半小时边界失效，避免两层缓存叠加延迟；保存后最多约 30 分钟再新开或重新载入页面可见新配置。
已打开页面不会自动换广告。广告明确标注“广告 · 赞助”，链接含 `sponsored noopener noreferrer`；后台管理页不展示广告。

## 官方实现依据（2026-09-29 核对）

- [Cloudflare Access JWT 验证与固定 JWKS](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access 应用 token 字段](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Turnstile 服务端必需校验](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Pages D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)
- [Pages Functions 路由](https://developers.cloudflare.com/pages/functions/routing/)
- [Pages Functions 免费额度](https://developers.cloudflare.com/pages/functions/pricing/)和[D1 额度](https://developers.cloudflare.com/d1/platform/pricing/)

免费层有请求、读写行与存储额度；用量达到上限可能暂不可用，不承诺无限免费，也不自动升级付费计划。

现有库中 section 的旧 CHECK 若未包含 original，应在同一事务执行 migrations/0006-original-section.sql。该迁移只更换 section 列并重建其索引，不替换父表，不删除队伍或关联记录；本地适配器自动检测，重复启动不会重跑。

独立深渊EX分区上线前，若 `sqlite_master` 中 `community_teams` 的 CHECK 未包含 `abyss-ex`，在同一事务执行 `migrations/0017-abyss-ex-section.sql`。它只扩充分区约束并重建分区索引，原分区值、点赞、队伍码和关联记录保持不变；已有 `abyss` 队伍不会根据标题自动归入EX，管理员可按实际用途修改。新的 `schema.sql` 已包含EX，本地适配器会检测旧约束并迁移；部署现有正式库需先备份、执行增量迁移，再发布Worker。
