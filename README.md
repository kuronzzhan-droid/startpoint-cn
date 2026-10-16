# StarPoint CN · 测试服整合仓库

《世界弹射物语》国服(雷霆)非官方服务端 [Ku1o/startpoint-cn-kulo](https://github.com/Ku1o/startpoint-cn-kulo) 的个人整合仓库,包含测试服的服务端改动、补丁链、客户端 APK 补丁和平衡/设计文档。

**当前状态:与测试服一致,补丁链尾 1.4.219(172 条),客户端 APK v33。** 上游项目原 README 见 [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md)。

## 内容导航

| 想找什么 | 在哪里 |
|---|---|
| 服务端源码(测试服现状) | [`src/`](src)、[`tests/`](tests);基于 kulo `df99b73c`,加上我方修复与角色超限 Lv120 服务端 |
| 服务端资源表 | [`assets/`](assets)(含碧 169978、凉月、超限表 `character_overlimit.json` 等) |
| 客户端补丁链清单 | [`assets/asset-patch/manifest.json`](assets/asset-patch/manifest.json),链尾 1.4.219 |
| 补丁 zip 下载 | Release [snapshot-1.4.218-20261016](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/snapshot-1.4.218-20261016)(104 个,截至 1.4.218)+ [patches-1.4.219](https://github.com/kuronzzhan-droid/startpoint-cn/releases/tag/patches-1.4.219)(1.4.219 一个);kulo main 已有的包直接在仓库里 |
| 客户端 APK 补丁(v17→v33,101 个) | [`apk-patches/`](apk-patches),[总索引](apk-patches/README.md) 列出每个补丁的作用、首发版本、改动方法、修的问题 |
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

其余服务端修复(结算幂等、联机 TCP 加固、兑换校验等)作者已自行合入 kulo main。

## 分支

- `main`:当前测试服状态(本页)。
- `snapshot/1.4.218-20261016`:1.4.218 时的冻结快照,保留作历史。
- 其它 `codex/*`、`claude/*`、`feat/*` 等为历史工作分支。

## 不包含

`.env`、`config/`、数据库、APK、`.so`、签名材料、准入密钥和任何密码。测试服专用开关(单人分数缩放、NPC 复制队伍、共享测试密码)只以默认关闭的代码形式存在。补丁源里的测试服地址已替换为占位符。
