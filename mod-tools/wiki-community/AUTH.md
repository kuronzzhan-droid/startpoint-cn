# Wiki 邮箱密码管理员

邮箱只作 Wiki 登录名，不会注册真实邮箱，不与游戏后台账号或游戏存档共用。
没有公开注册接口。新站由指定站长设置自己的密码；之后由站长创建副站长及普通管理员，副站长可以创建普通管理员。

## 权限和使用

| 身份 | 配队管理 | 账号管理 |
| --- | --- | --- |
| 站长 owner | 创建、修改、隐藏配队和管理队伍码 | 创建副站长/普通管理员，停用、恢复及重置其密码 |
| 副站长 deputy | 同上 | 仅创建、停用、恢复和重置普通管理员；不能管理站长、自己或其他副站长 |
| 普通管理员 editor | 同上 | 只能修改自己的密码 |
| 游客 | 浏览与验证后点赞 | 无 |

唯一站长受数据库唯一索引约束；不能停用、删除或通过 API 改角色。账号最多 50 个，无删除接口，角色只在创建时选择。
为他人设置的密码是临时密码，首次登录后必须先修改，才能管理配队或账号。
停用或重置会立即撤销该账号所有登录；恢复账号不会恢复旧登录。修改自己的密码同样撤销所有旧会话，再签发当前会话。
登录有效期为八小时，刷新页面不延长。密码为 16 至 128 个字符，空格不删改；密码不会在账号列表、审计或日志中显示。

## 本机首次设置和密钥

本机 CLI 必须传 `--owner-email`，可传 `--deputy-email`。首次站长设置只接受配置的站长邮箱，大小写和两侧空白规范化。
副站长邮箱仅在站长的账号管理页预填；站长仍须亲自设置临时密码后创建。
本机仅监听 loopback，允许省略首次设置口令。验证码标识为本地测试，仅模拟一次有效校验，不是生产 Turnstile。

指定持久 SQLite 路径后，会在数据库旁生成 `<数据库路径>.secrets.json`，保存三个独立随机私密密钥：访客签名、IP 限流及密码 pepper。
新文件以 `mode:0600` 创建；Windows 应另外用当前用户和 SYSTEM 的 ACL 限制访问。
数据库和密钥必须在静态网站目录以外；密钥/数据库符号链接文件拒绝加载，损坏密钥拒绝自动重置。
旧版只有配队/点赞而没有密码账号的数据库可首次补充密钥，原有数据保留。
数据库已存在密码账号却缺少密钥时拒绝启动，必须恢复配套密钥。数据库和密钥应一起私密备份；不要把它们放进 Git 或公开网站。
重启保留账号和登录状态。内存测试库使用临时密钥，不创建磁盘账号或秘密文件。

## 生产配置

沿用 README 的 D1、Turnstile、允许域名及 Cookie/IP 私密密钥，并增加：

| 配置 | 含义 |
| --- | --- |
| `COMMUNITY_AUTH_MODE=password` | 明确选择密码模式；此模式不会回退 Access 或裸邮箱请求头 |
| `COMMUNITY_OWNER_EMAIL` | 唯一允许首次初始化站长的邮箱登录名，不在公开配置中输出 |
| `COMMUNITY_PASSWORD_PEPPER` | 独立、至少 32 字符的随机私密密钥，不复用 Cookie/IP 密钥 |
| `COMMUNITY_OWNER_BOOTSTRAP_TOKEN` | 首次初始化的随机口令，至少 32 字符，生产必须匹配；创建站长后移除 |
| `COMMUNITY_INITIAL_DEPUTY_EMAIL` | 可选的副站长预填建议，仅站长可读，账号已存在后自动不再提示 |

先执行幂等 `schema.sql` 以创建账户、会话和审计表，已有配队/点赞不改变。
首次设置须同时匹配站长邮箱和初始化口令，且数据库尚无站长；删除初始化口令后仍能正常登录。
生产必须 HTTPS；登录 cookie 为随机 32 字节 token，`__Host-`、HttpOnly、SameSite=Strict、Secure，路径 `/`。
数据库仅保存 token 的 SHA-256，每次请求重新检查账号启用状态、密码版本及会话期限。
所有写操作检查同源 Origin，不能把跨站请求伪装成管理操作。

切换密码模式时，应调整或移除旧 `/api/community/admin/*` 的 Access 邮箱名单门禁，否则新建的管理员会被外层 Access 拦截。
不要把生产密码模式和旧 Access 策略同时宣称为可直接登录。代码默认仍为 `access`，兼容原 Access 单独部署。
真实 Cloudflare 绑定、秘密配置、验证码、公网登录和权限仍须部署后单独验收，本机通过不代表线上完成。

## API

前缀 `/api/community`。认证成功直接返回 `{id,email,role,enabled,revision,mustChangePassword}`，不回显密码或其摘要。

| 接口 | 请求和权限 |
| --- | --- |
| `GET /config` | 追加 authMode、needsSetup、bootstrapAvailable；不公开站长/副站长邮箱 |
| `POST /auth/bootstrap` | `{email,password,bootstrapToken?}`；唯一站长初始化，成功 201 并登录 |
| `POST /auth/login` | `{email,password,turnstileToken}`；生产验证码 action=`admin_login` 且 hostname 一致 |
| `GET /auth/me` | 当前账号，临时密码会话也可读取 |
| `POST /auth/logout` | `{}`；撤销当前会话并清 cookie |
| `POST /auth/password` | `{currentPassword,newPassword}`；验证原密码，更新后撤销旧会话并重新登录 |
| `GET /admin/users` | `{items,deputySuggestion?}`；站长看到全部，副站长只看到自己及普通管理员 |
| `POST /admin/users` | `{email,password,role?}`；默认 editor，仅站长可指定 deputy；成功 201 |
| `PATCH /admin/users/:id` | `{expectedRevision,enabled?,password?}`；密码重置为临时密码，启停/重置都会撤销会话 |

账号列表项同认证对象。修改冲突 409 `edit_conflict`，邮箱重复 409 `email_exists`，临时密码未修改 403 `password_change_required`。
该受限状态只允许 `/auth/me`、`/auth/password`、`/auth/logout`；不允许任何 `/admin/*`。
创建、修改、审计使用同事务；改密码和签发登录均核验版本，防止并发重置后仍用旧密码获得新会话。
`community_auth_audit` 只记录 actor/target/action/time，无密码、哈希、会话 token 或初始化口令。

## 密码存储及限制

采用 WebCrypto PBKDF2-SHA256，16 字节随机盐、固定 100,000 次迭代；对派生值再用独立 pepper 进行 HMAC-SHA256，只保存 HMAC 结果。
这是针对当前 Workers 默认 PBKDF2 100k 上限的明确限制，**低于 OWASP 的 600k 建议**；不能将本实现称为达到该迭代建议。
提升上限的 [workerd PR #7550](https://github.com/cloudflare/workerd/pull/7550) 在 2026-09-29 核对时尚未合并；
[OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)同时介绍后置 pepper。
代码不在运行时降级迭代数。后续应随实际部署平台支持更新格式和迁移，不能丢弃 pepper 强行重新生成密码资料。

登录按 HMAC 后的 IP 每 15 分钟 20 次、邮箱每 15 分钟 8 次限流，持久存储限频计数。
IP 桶先于验证码，邮箱桶只在验证码通过后扣减，二者均先于密码派生；未知账号同样做哑派生并返回统一登录失败信息。
无效初始化口令和已完成初始化的请求不消耗登录邮箱额度；成功完成初始化后不能再用初始化接口创建账号。
限流不能消除共享 IP 影响或分布式攻击；验证码、长密码和独立秘密共同使用。具体请求 CPU 成本和云端执行兼容仍需实测。
