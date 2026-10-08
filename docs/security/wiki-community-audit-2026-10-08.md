# 星见图鉴 Wiki 社区 API 安全审计与修复报告

[English version](wiki-community-audit-2026-10-08.en.md)

- 作者：kuronzzhan-droid（PARADOX）
- 日期：2026-10-08 审计，2026-10-09 修复上线
- 对象：星见图鉴 Wiki（https://wf-mod-wiki.pages.dev）的社区 API，部署在 Cloudflare Pages Functions，数据库是 D1
- 修复提交：[`bdfb6b18`](https://github.com/kuronzzhan-droid/startpoint-cn/commit/bdfb6b18b5f84ab0fc27f4836487e8752fb5321e)

## 摘要

我对自己维护的游戏 Wiki 的社区后端做了一次白盒安全审计。社区后端负责配队分享、点赞、评分、排行和管理员后台。

没有发现越权、注入或会话劫持类漏洞。发现两个需要修复的问题：

| 编号 | 级别 | 问题 | 状态 |
|---|---|---|---|
| 1 | 中（CVSS 3.1：5.3） | 限流计数在请求被拒后仍然写库；匿名请求可以耗尽 D1 免费套餐的每日写入额度，让社区功能停服到第二天 | 已修复 |
| 2 | 中（加固） | 静态站缺少 Content-Security-Policy 等安全响应头，一旦以后出现 XSS 就没有第二道防线 | 已修复 |

两个问题都已在 2026-10-09 修复并上线。本报告在修复之后发布。

## 范围与方法

- **代码**：`mod-tools/wiki-community/` 后端和 `mod-tools/wiki/` 前端。重点是认证、权限、SQL、输入校验、文件上传、限流和前端渲染。
- **方法**：
  - 逐行审阅源码；
  - 在本机内存 SQLite 上，用项目自带的请求处理函数复现问题（Turnstile 验证码用本地替身，不联网）；
  - 修复后跑完整测试套件，并在本机用线上发布包整站回归。
- **边界**：没有对生产环境做任何攻击性测试。上线后的验证只是正常浏览，加上检查响应头。

## 发现 1：限流计数本身消耗写入额度，可被用来让社区停服

**级别**：中，CVSS 3.1 5.3（`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`），CWE-770

### 原因

限流用一张 D1 表按"IP + 时间窗口"计数，写法是先加一、再判断：

```js
const row = await db.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
  ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, expires).first();
if (row.count > max) fail(429, 'rate_limited', ...);
```

所以**已经超限、返回 429 的请求也会写一行数据库**。不需要验证码就能走到这段代码的接口有：

- 查询队伍码（完全匿名的 GET）；
- 登录接口：IP 计数在验证码校验之前。Origin 检查只能防浏览器跨站请求，脚本可以随意填写 Origin；
- 在线心跳、角色浏览量：需要访客 cookie，但这个 cookie 可以无限免费领取。

### 影响

D1 免费套餐每天限 10 万行写入。用完以后，点赞、评分、排行和管理员编辑全部不可用，直到第二天额度重置。静态的图鉴页面不受影响。攻击者不需要账号，也不需要过验证码，单机持续发请求就能做到。

### 复现（本机内存数据库）

```
GET /game-codes（无验证码）：1000 次请求，404×300、429×700，写入 1001 行
POST /auth/login（验证码之前）：200 次请求，403×20、429×180，写入 200 行
```

被拒绝的 700 次和 180 次请求照样写了库。

### 修复

1. **桶满后不再写**：SQLite 的 UPSERT 支持 `DO UPDATE ... WHERE`。条件不满足时不更新、不返回行，返回空就表示超限：

   ```js
   const row = await db.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
     ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE community_limits.count<? RETURNING count`)
     .bind(key, expires, max).first();
   if (!row) fail(429, 'rate_limited', ...);
   ```

   登录的 IP 计数和邮箱计数也做同样修改。

2. **免验证码接口统一改为按小时限流**：每次放行仍要写一行计数，所以查队伍码、在线心跳、角色浏览量从每分钟 300 次或 120 次，改为每 IP 每小时 120 次。
3. **前端降级**：角色浏览量在被限流时，改为只读显示累计次数，不再显示"暂不可用"。

### 验证

- 同一复现脚本在修复后的结果：1000 次查队伍码请求写入 121 行（120 次放行加 1 次例行清理）；200 次登录请求写入 20 行。
- 新增和扩展了三条回归测试："桶满后的请求不写任何行"、"登录 IP 桶满时不写库"、"浏览量被限流时改为只读"。前两条在旧代码上失败，在新代码上通过。
- 后端测试 288 项通过、5 项跳过（与修改前一致），前端测试 732 项全部通过。

## 发现 2：静态站缺少 CSP 和安全响应头

**级别**：中（纵深防御加固）

### 现状

站点的 `_headers` 只配置了媒体文件缓存，没有 Content-Security-Policy、X-Frame-Options 等安全头。

审计时前端没有 XSS：所有 API 数据都通过 `textContent` 渲染，全站没有 `innerHTML`、`insertAdjacentHTML`、`document.write`、`eval` 或 `new Function`。但后端只过滤控制字符，不过滤尖括号。以后只要有一处渲染改成 `innerHTML`，就会出现一条提权路径：

- 普通管理员在配队备注里写入脚本；
- 站长打开后台时脚本执行；
- 脚本用同源请求调用账号管理接口，创建副站长或重置密码。

同源脚本可以绕过 Origin 检查，SameSite=Strict 的 cookie 也拦不住它。

### 修复

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' https: data: blob:; media-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

- 只放行 Turnstile 需要的脚本和框架来源（Cloudflare 官方文档要求的两项）。
- `img-src https:` 给外链赞助图片用；`data:` 给 CSS 遮罩图标用；`blob:` 给后台上传预览用。
- `media-src data:` 给放置战斗里解锁音频用的静音片段。最初的草案漏了这一项，逐个检查战斗模块的资源用法时才发现。

### 验证

- 本机整站回归：图鉴、角色详情、语音、放置战斗、分享海报、后台登录、公告、赞助位和攻略图片上传，都没有触发 CSP 拦截。
- 反向探针：注入的内联脚本、内联事件和 `eval` 全部被拦。
- 上线后：响应头生效；各页面控制台没有违规；Turnstile 验证码正常显示。

## 审计中确认没有问题的部分

- **SQL**：全部参数绑定；`LIKE` 已转义通配符。
- **会话**：32 字节随机 token，库里只存 SHA-256；cookie 设置为 `__Host-`、HttpOnly、SameSite=Strict、Secure，有效期 8 小时。每次请求都核对账号启用状态和密码版本；改密码、停用、重置都会撤销旧会话，签发会话时也核对版本，避免并发竞态。
- **登录**：账号不存在时做假派生、返回统一错误，防止探测账号；有 IP 和邮箱两层限流；Turnstile 校验 action 和 hostname。
- **权限**：站长、副站长、普通管理员三级，在路由层和 SQL `WHERE` 条件里各检查一次。
- **CSRF**：所有写操作检查 Origin 和 `Sec-Fetch-Site`。
- **上传**：逐字节解析 PNG、JPEG、WebP 结构，拒绝 SVG 和动图；返回图片时带 `nosniff` 和 `CSP: sandbox`。
- **私有内容**：被隐藏或移入个人空间的配队，不会通过攻略引用泄露出去。
- **错误处理**：不向访客返回 SQL、密钥或原始异常。

## 时间线

| 日期 | 事件 |
|---|---|
| 2026-10-08 | 完成审计，在本机复现发现 1 |
| 2026-10-08 | 完成修复和回归测试，本机整站 CSP 回归 |
| 2026-10-09 | 修复上线，公网验收 |
| 2026-10-09 | 修复代码推送到 GitHub，发布本报告 |

## 给使用 Cloudflare D1 的开发者的经验

1. **限流本身也有成本。** 在按行计费、有额度上限的数据库里，"先计数再判断"会把限流器变成放大器。桶满后要停止写入，或者把限流放到数据库前面，比如 WAF 规则或内存计数。
2. **免验证码的接口，每次放行都要算成本。** 能直接匿名访问的接口，阈值应当按"每天最多能写多少行"来定，不能只看每分钟的请求数。
3. **CSP 越早上越便宜。** 页面里没有内联脚本时，严格 CSP 几乎零成本。上线前用整站回归加反向探针，确认规则既不误拦、也确实在拦。

## 说明

本次审计、修复和验证是在 AI 助手 Claude（Anthropic）的协助下完成的。所有结论都经过本地复现或自动化测试验证，上线后的检查只做了正常浏览。
