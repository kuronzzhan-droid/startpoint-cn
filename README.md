# StarPoint CN

世界弹射物语(World Flipper)CN(雷霆 Leiting)版本的服务端模拟器。

> 🎮 **本分支(`release/modes-20260714`)是自制内容发布分支**,在上游服务端基础上加入:
> 「深渊连战」roguelike 活动(Rush 700099) · 15 把深渊武器 · 八位自制/改造角色；当前增量链尾为 1.4.312。

> ⚠️ **本分支 `custom/characters-1.4.407` 尚不可直接合并 / 部署**
>
> 它只补齐了**服务端侧**数据:自制/改造角色累计 13 名(新增 129997 克劳斯、139997 莉莉丝、
> 139998 拉姆斯、149997 墨斯伊克、179999 罗尔夫)、深渊限定池 990001、两条兑换条目、
> CN 客户端券抽 execType 3/4。
>
> **对应的客户端资源不在本仓**。本仓自带的增量链 `assets/asset-patch/active/` 停在 **1.4.323**,
> 不含上述 5 名角色的美术/技能/语音资源。完整客户端内容(链尾 **1.4.407**)只发布在工具仓的
> [Patch Overlay](https://github.com/kuronzzhan-droid/startpoint-cn-mod-tools/releases/tag/overlay-1.4.407),
> 而 overlay 是给**上游 dev 架构**的 Content Sync 用的,本仓服务端没有那条装载路径,装不了。
>
> 后果:直接部署本分支会出现「服务端有角色行、客户端没有资源」——抽到这 5 名角色会
> 数据不足 / 崩溃。要么先把 1.4.323→1.4.407 回灌进 `assets/asset-patch/active/`,
> 要么等本仓接上 Content Sync。**两件事都还没做**,所以本分支只作为服务端数据的存档与评审用。

## 我该下载什么?

| 你是谁 | 需要什么 |
|---|---|
| **想进别人的服玩** | 不用下载本仓库。只向服主要他**按本服地址重签的完整五合一 APK**和账号说明；不要混用旧 APK。角色/模式资源由所连接服务器下发到 1.4.312 |
| **想自己开服**(玩全部内容,含八位自制/改造角色) | **三步**:① 下载 [deploy.ps1](deploy.ps1) 运行(自动装 Git/Node → clone → 构建 → 起服 → 自检)→ ② 自备基础 CDN ~11GB 放入 `.cdn\cn\`(唯一手工环节,脚本会指引)→ ③ 按 [保姆级部署攻略](docs/部署攻略.md) 下载并校验[完整五合一基座 APK](https://github.com/kuronzzhan-droid/startpoint-cn/releases/download/client-base-v2.0/WorldFlipper-abyss-v2.apk),只改成自己的服务器地址后重签。技术参考/存量服升级/救援见 [docs/self-host-modes.md](docs/self-host-modes.md);mod 增量内容(1.4.54→**1.4.312** 现役态)已随仓库自带,clone 即得 |
| **想改数据 / 做自己的 mod** | 数据修改工具链:[mod-tools/](mod-tools/)(独立仓 [startpoint-cn-mod-tools](https://github.com/kuronzzhan-droid/startpoint-cn-mod-tools),带全套文档与《新角色制作心得》) |

## 功能状态

已实现(部分端点沿用国际服设计,对 CN 的通用性尚未验证):

- 账号:设备自动绑定(`device_id`)、Web 管理面板
- 时间系统:全局 / 按存档时间偏移(默认 2024-08-14,规避 CDN 报错)
- 关卡:主线 / 部分活动·Boss / 单人战斗结算
- Gacha:角色·武器卡池、兑换、C3032 动画修复、抽卡种子验证
- 多人联机(NPC 协战):Phase 2 — 建房 + NPC 招募 / 召唤 / 结算
- 系统:狂热激战 · 体力 · 商店 · 漫画 · 邮件群发
- 养成:升级 / 突破 / 魔晶板 / EX / 羁绊;武装:觉醒 / 熔解;编队 · 图鉴 · 教程

⚠️ 已知失效 / 注意:

- 存档导入 / 导出:已修复 —— 采用 MergedPlayerData 快照格式(仅管理面板备份/恢复,非游戏客户端 load）。
- 漫画资源**不随项目分发**,需自行导入。
- 多个端点沿用国际服(global)设计,不保证对 CN 客户端通用。

> 端点状态见 [docs](./docs/README.md) · [端点实现状态](./docs/reference/routes-status.md)

## 环境需求

- Node.js ≥ 20 · 打补丁后的 CN 客户端 APK(见"客户端改造")
- 一份 CN CDN 资源,放入 `.cdn/cn/`

### CDN 路径清单文件(PathFile)

客户端经 EntityLists 的"路径清单文件"获取全部资源路径。**服务端对它使用了两套命名且不做归一处理**:

- `src/routes/cn/asset.ts` 的 version_info → `EntityLists/PathFile`
- `src/cn-server.ts` → `EntityLists/10939-android_medium.csv`

不同来源的 CDN 该文件名 / 位置可能不同(内容一致)。请确保 `.cdn/cn/EntityLists/` 下**同时存在** `PathFile` 与 `10939-android_medium.csv`(复制一份改名即可),否则按命中端点不同可能出现资源 404。

## 快速启动

### 前置

```bash
cd starpoint-cn
npm install
cp .env.example .env
```

### 本地局域网（开发/测试）

`.env.example` 的局域网区块默认激活，`cp .env.example .env` 后可直接启动：

```bash
# 生产模式（build + 启动）
bash scripts/start-cn.sh

# 开发模式（热重载，无需 build）
npm run debug:cn
```

如果客户端在**另一台设备**上，需编辑 `.env`：
- `CN_LISTEN_HOST`=`你的 LAN IP`（如 `192.168.x.x`）
- `CDN_BASE_URL`=`http://你的LAN_IP:8001/patch/cn`

### 公网云服务器

1. 按 [`docs/deployment.md`](./docs/deployment.md) 配置 nginx 反向代理 + 防火墙
2. 编辑 `.env`，激活公网区块：

```bash
CN_LISTEN_HOST="127.0.0.1"                        # 仅监听本地
CDN_BASE_URL="https://<你的域名>/patch/cn"        # 公网域名 + HTTPS
SESSION_PUBLIC_HOST="<你的域名>"                  # 联机 TCP 公网地址
```

3. 启动：

```bash
bash scripts/start-cn.sh
```

### 两种部署方式 `.env` 对比

| 配置项 | 局域网 | 公网 |
|--------|--------|------|
| `CN_LISTEN_HOST` | `0.0.0.0` / LAN IP | `127.0.0.1` |
| `CDN_BASE_URL` | `http://<LAN_IP>:8001/patch/cn` | `https://<域名>/patch/cn` |
| `SESSION_HOST` | `0.0.0.0` | `127.0.0.1` |
| `SESSION_PUBLIC_HOST` | 不设 | 公网域名 |
| 前置层 | 无 | nginx + SSL + 防火墙 |

### `.env` 加载说明

- `npm run dev:cn` 与 `bash scripts/start-cn.sh` 经 `node --env-file=.env` **会**加载 `.env`。
- `npm run debug:cn`(ts-node-dev)无 `--env-file`、代码也未引入 dotenv,因此**不会**自动读 `.env`;调试时需自行 export 环境变量,否则走代码默认值。

## 关键配置(.env)

- `CN_LISTEN_HOST` / `CN_LISTEN_PORT` — HTTP 绑定地址 + 联机 TCP 房间显示 IP;客户端在别的设备时设为你的 LAN IP(默认端口 8001)。
- `CDN_BASE_URL` — `http://<你的LAN_IP>:<端口>/patch/cn`。
- `CN_RES_VERSION` — 须与客户端 resourceVersion 一致(当前 1.4.54)。
- `DROP_MULTIPLIER` / `NPC_*` — 测试与联机调参。
- `QUEST_FINISH_STRICT` — 结算严格模式，默认关闭。关闭时缺少开战登记也能结算（重启/多进程/客户端没调 `/start`），开启则恢复旧的 400 行为。

## 客户端改造

> **要玩完整自制内容,只做“免登录 + 重定向”不够。** 深渊武器门控、赛瑞斯双形态和
> 通用像素缩放都是必需客户端补丁；漏掉像素 P-code 会让杰拉德、基诺维等像素小人异常放大。

新手请直接走 [保姆级攻略的完整五合一基座路线](docs/部署攻略.md#2-把完整客户端基座指向你自己的服务器):
核对固定 SHA256,用 `repoint_build.py` 只换成自己的 `IPv4:端口`并重签。以下只记录官方
APK 的最小连接改造,**不能作为完整内容发行包**。详见 [`client-patch/`](./client-patch/README.md):

- **免登录** — `pinball/config/core/DevConfig.as`:`sdkDummy = false` → `true`
- **重定向到本服** — `pinball/config/gbits/DevConfig_gf_android.as`:域名 → 你的服务器,`"https"` → `"http"`

用 FFDec 导出 APK 的 AS3 后执行:

```bash
bash client-patch/apply.sh <AS3_导出目录> <你的LAN_IP>:8001
```

再用 FFDec 回封、重打包签名。完整 APK / 反编译说明见本地环境文档 `docs/setup/`。

## Web 管理面板(`http://<CN_LISTEN_HOST>:<端口>/`)

`/` 时间设置 · `/player` 账号·存档·玩家 · `/player/:id` 玩家详情 · `/mail` 群发邮件

> 面板对写入端点做**结构安全校验**(拒绝未知字段 / 类型错误 / 超 2³¹ 的非法值并明确报错),但不限制游戏平衡数值;重要操作仍建议先用「下载 JSON」导出备份。
> 若误发非法邮件导致客户端在邮件界面崩溃,可用玩家详情页的**清空邮件箱**恢复。

## FAQ

- `H404` = 该功能 / 端点尚未实现。

## 致谢 / 相关项目

- [wdfp-extractor](https://github.com/ScripterSugar/wdfp-extractor) — 资源提取
- [wfax](https://github.com/blead/wfax) — 资源转换 / 修改
- 上游 [Duosion/starpoint](https://github.com/Duosion/starpoint) — 全球服模拟器基础
- [starview](https://github.com/duosii/starview) — APK 打补丁工具(基础;本仓库最小补丁见 [`client-patch/`](./client-patch/README.md))
- [wf-2.1.125-cn-decompiled](https://github.com/dennis96292/wf-2.1.125-cn-decompiled) — CN 客户端反编译参考
