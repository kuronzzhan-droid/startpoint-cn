# 103 编队刷新重复能力汇总复用

在同次 PartyTranslator.translate 内，满血、普通阈值且输入等价时复用第一次能力汇总；其他分支仍执行原计算。没有跨次缓存。

- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。
- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。
- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。
- 改动位置：1 个既有目标方法；见下方方法清单。
- 修的问题或错误码：本条行为见上文；未新增错误码。
- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。
- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。

## 最终采用证据

输入 APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`；输入 SWF SHA-256：`3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`。
上游来源：`D:\WF\startpoint-cn-kulo` 的 `origin/main` 提交 `224aa2a663b7756fc8a34c0f37f1ae61ad81800c` 下 `client-patch/party-refresh-performance/`，先用 git show 导出到本工作区再使用。
最终 v34 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。
本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。

## 合成与保留逻辑

本条与 #105 共用 PartyTranslator/translate。归档最终 P-code 显示两条顺序合成后的方法，不能把本条最终方法再整方法覆盖 #105。

## 最终 P-code

以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。

- `pinball.scene.character.translator::PartyTranslator/translate|1`；body `66996`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.translator_PartyTranslator_translate_1.pcode.txt)；code SHA-256 `f8afab6e8406ac92c6862fa1982854ca60be8202081c0c2a99b6b46d2e7793ed`。

新增 helper ABC：无。

## 补丁源与构建脚本

源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。

- [patch_swf.py](source/client-patch/party-refresh-performance/patch_swf.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/patch_swf.py`；5,883 B；SHA-256 `a348c218b12fc32635fa8a70d5a4bbce1afa7b7e75e0dfcdaff65997ffbea2a1`。
- [reader-fingerprints.json](source/client-patch/party-refresh-performance/reader-fingerprints.json) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/reader-fingerprints.json`；9,792 B；SHA-256 `051f8d7da4527a5aed4595b95cc77c8210287439971d5acd5bff52222a6941e4`。
- [Option.as](source/client-patch/party-refresh-performance/tests/fixtures/haxe/ds/Option.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/fixtures/haxe/ds/Option.as`；328 B；SHA-256 `f6944e1f45aa7027b54d0957446b0676b22de889e13fce9e7f4a9f9ec0b90b07`。
- [AbilitySummarizer.as](source/client-patch/party-refresh-performance/tests/fixtures/pinball/common/data/ability/summary/AbilitySummarizer.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/fixtures/pinball/common/data/ability/summary/AbilitySummarizer.as`；1,491 B；SHA-256 `0c297bd6cdb673640c63cf0a626bd0588a47746f305712dd8f71ac581122d4e7`。
- [BattleCharacterLogic.as](source/client-patch/party-refresh-performance/tests/fixtures/pinball/common/data/character/BattleCharacterLogic.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/fixtures/pinball/common/data/character/BattleCharacterLogic.as`；532 B；SHA-256 `e56b9203dabc4f72634c32b3549b2f4b6126684b3f3bec557aee91db5b3a8719`。
- [Decimal_Impl_.as](source/client-patch/party-refresh-performance/tests/fixtures/pinball/common/math/_Decimal/Decimal_Impl_.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/fixtures/pinball/common/math/_Decimal/Decimal_Impl_.as`；235 B；SHA-256 `5be6197a6d7b0f12640f2de792a81aa647624d47249bffd5553f3561117c03c0`。
- [harness-app.xml](source/client-patch/party-refresh-performance/tests/harness-app.xml) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/harness-app.xml`；364 B；SHA-256 `1dde7d679accf262ae37e3e983beaea9ec0e6d8d45a09d52c271b24b2ad13636`。
- [run_tests.py](source/client-patch/party-refresh-performance/tests/run_tests.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/run_tests.py`；5,052 B；SHA-256 `f6b66135655c99aa725b6cf919f72d3bc194e5a3dce61a48e6af4ff1898f44c6`。
- [RuntimeHarness.as](source/client-patch/party-refresh-performance/tests/RuntimeHarness.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/RuntimeHarness.as`；5,193 B；SHA-256 `866bf54a1d7f58d52ff6bd80c62f1f194db58171e35a6a49780cf2dd8273f74c`。
- [SegmentProbe.as](source/client-patch/party-refresh-performance/tests/SegmentProbe.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/SegmentProbe.as`；249 B；SHA-256 `b2d9358e69f3e99b94e9d035a5d6a499a0c1f07635ccbd7789ffff0c827339f6`。
- [test_patch.py](source/client-patch/party-refresh-performance/tests/test_patch.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-refresh-performance/tests/test_patch.py`；2,881 B；SHA-256 `42de798a24b53e5742240e6e8a41f1f3aa737f3ce8654ff552274c9192c5bd57`。

## 验证与安装边界

单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。
交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。
