# StarPoint CN · 测试服整合仓库

《世界弹射物语》国服(雷霆)非官方服务端 [Ku1o/startpoint-cn-kulo](https://github.com/Ku1o/startpoint-cn-kulo) 的个人整合仓库,包含测试服的服务端改动、补丁链、客户端 APK 补丁和平衡/设计文档。

**当前状态:补丁链与资源表同步到测试服 1.4.348(2026-10-31),补丁链尾 1.4.348,客户端 APK v34。已合并 kulo main `224aa2a6`。**

**灰拉取正式服内容请看 [docs/mod/灰拉取说明.md](docs/mod/灰拉取说明.md);测试服专用设置见 [docs/mod/测试服专用设置.md](docs/mod/测试服专用设置.md)。** 上游项目原 README 见 [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md)。

## 内容导航

| 想找什么 | 在哪里 |
|---|---|
| 服务端源码(测试服现状) | [`src/`](src)、[`tests/`](tests);kulo main `224aa2a6` + 我方改动(分类补丁见 [docs/mod/kulo-patches/](docs/mod/kulo-patches)) |
| 服务端资源表 | [`assets/`](assets)(含碧 169978、凉月、超限表 `character_overlimit.json` 等) |
| 客户端补丁链清单 | [`assets/asset-patch/manifest.json`](assets/asset-patch/manifest.json),链尾 1.4.348 |
| 补丁 zip 下载 | Release [snapshot-1.4.218-20261016](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/snapshot-1.4.218-20261016)(104 个,截至 1.4.218)+ [patches-1.4.219](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.219) + [patches-1.4.224](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.224)(1.4.220–1.4.224)+ [patches-1.4.225](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.225)+ [patches-1.4.226](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.226)+ [patches-1.4.227](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.227)+ [patches-1.4.228](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.228)+ [patches-1.4.229](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.229)+ [patches-1.4.230](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.230)+ [patches-1.4.231](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.231)+ [patches-1.4.232](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.232)+ [patches-1.4.233](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.233)+ [patches-1.4.234](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.234)+ [patches-1.4.235](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.235)+ [patches-1.4.236](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.236)+ [patches-1.4.237](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.237)+ [patches-1.4.238](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.238)+ [patches-1.4.239](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.239)+ [patches-1.4.240](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.240)+ [patches-1.4.241](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.241)+ [patches-1.4.242](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.242)+ [patches-1.4.243](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.243)+ [patches-1.4.244](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.244)+ [patches-1.4.245](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.245)+ [patches-1.4.246](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.246)+ [patches-1.4.247](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.247)+ [patches-1.4.248](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.248)+ [patches-1.4.249](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.249)+ [patches-1.4.250](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.250)+ [patches-1.4.251](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.251)+ [patches-1.4.252](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.252)+ [patches-1.4.253](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.253)+ [patches-1.4.254](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.254)+ [patches-1.4.255](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.255)+ [patches-1.4.256](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.256)+ [patches-1.4.257](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.257)+ [patches-1.4.258](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.258)+ [patches-1.4.259](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.259)+ [patches-1.4.260](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.260)+ [patches-1.4.261](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.261)+ [patches-1.4.262](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.262)+ [patches-1.4.263](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.263)+ [patches-1.4.264](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.264)+ [patches-1.4.265](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.265)+ [patches-1.4.266](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.266)+ [patches-1.4.267](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.267)+ [patches-1.4.268](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.268)+ [patches-1.4.269](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.269)+ [patches-1.4.270](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.270)+ [patches-1.4.271](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.271)+ [patches-1.4.272](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.272)+ [patches-1.4.273](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.273)+ [patches-1.4.274](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.274)+ [patches-1.4.275](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.275)+ [patches-1.4.276](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.276)+ [patches-1.4.277](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.277)+ [patches-1.4.278](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.278)+ [patches-1.4.279](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.279)+ [patches-1.4.280](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.280)+ [patches-1.4.281](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.281)+ [patches-1.4.282](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.282)+ [patches-1.4.283](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.283)+ [patches-1.4.284](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.284)+ [patches-1.4.285](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.285)+ [patches-1.4.348](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.348)(1.4.286–1.4.348);kulo main 已有的包直接在仓库里 |
| 客户端 APK 补丁(v17→v34,111 个) | [`apk-patches/`](apk-patches):[v17→v33 总索引](apk-patches/README.md)、[v34 新增 102–111](apk-patches/ADDITIONS-v34.md);x86 构建脚本在 `apk-patches/_build-x86/`,v34 重建在 `apk-patches/_build-v34/` |
| 角色平衡改动说明 | [`docs/mod/平衡/`](docs/mod/平衡) |
| 角色设计稿与台词稿 | [`docs/mod/设计/`](docs/mod/设计) |
| 交付说明与盘点报告 | [`docs/mod/报告/`](docs/mod/报告) |
| 工具链(补丁构建、推送前自检、代码地图) | [startpoint-cn-mod-tools · kulo-toolchain-1.4.218](https://github.com/kuronzzhan-droid/startpoint-cn-mod-tools/tree/snapshot/1.4.218-20261016/kulo-toolchain-1.4.218) |

## 补丁链怎么用

1. 从两个 Release 下载 zip,放进服务端 `assets/asset-patch/active/`。
2. `manifest.json` 引用的其余 zip 已在仓库 `assets/asset-patch/active/` 里。
3. 标 `local_test_only` 的条目是测试服专用内容。

## 已交给上游(kulo)的改动

| PR | 内容 | 状态 |
|---|---|---|
| [#40](https://github.com/Ku1o/startpoint-cn-kulo/pull/40) | 角色超限 Lv120 服务端支持 | 草稿,待作者评审 |
| [#41](https://github.com/Ku1o/startpoint-cn-kulo/pull/41) | 进程级未捕获异常兜底(改服务端启动,需作者同意) | 草稿 |
| [#42](https://github.com/Ku1o/startpoint-cn-kulo/pull/42) | `/load` 无变化时跳过写事务 | 草稿 |
| [#43](https://github.com/Ku1o/startpoint-cn-kulo/pull/43) | APK 补丁归档(文档) | 草稿 |
| [#45](https://github.com/Ku1o/startpoint-cn-kulo/pull/45) | 分享包 1.4.136→1.4.220 服务端数据 | 草稿 |

其余服务端修复(结算幂等、联机 TCP 加固、兑换校验等)作者已自行合入 kulo main。

## 分支

- `main`:当前测试服状态(本页)。
- `snapshot/1.4.218-20261016`:1.4.218 时的冻结快照,保留作历史。
- 其它 `codex/*`、`claude/*`、`feat/*` 等为历史工作分支。

## 不包含

`.env`、`config/`、数据库、APK、`.so`、签名材料、准入密钥和任何密码。测试服专用开关(单人分数缩放、NPC 复制队伍、共享测试密码)只以默认关闭的代码形式存在。补丁源里的测试服地址已替换为占位符。
