# 102 编队动画等待存活性修复

保留原 #18 的当前队伍更新与按需初始化；仅在原 join/remove waiter 等待期间，额外推进已初始化、非当前且仍有入退场动画的容器。每个容器每帧最多推进一次，不初始化隐藏容器；原完成条件与回调保持。

- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。
- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。
- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。
- 改动位置：1 个既有目标方法；见下方方法清单。
- 修的问题或错误码：本条行为见上文；未新增错误码。
- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。
- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。

## 最终采用证据

输入 APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`；输入 SWF SHA-256：`3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`。
上游来源：`D:\WF\startpoint-cn-kulo` 的 `origin/main` 提交 `224aa2a663b7756fc8a34c0f37f1ae61ad81800c` 下 `client-patch/party-animation-liveness/`，先用 git show 导出到本工作区再使用。
最终 v34 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。
本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。

## 合成与保留逻辑

合成 PartyCarousel/update（原 #18）；其 v33 代码指纹本就与上游补丁的单方法锁一致，使用上游可逆插入，不以整方法回退覆盖 #18。

## 最终 P-code

以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。

- `pinball.scene.character.partyCarousel::PartyCarousel/update|1`；body `66361`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.partyCarousel_PartyCarousel_update_1.pcode.txt)；code SHA-256 `f46c81b67a4f8a2fef0d06ce7c40eebd6bedce963f72be14b6ccd3094ab341c2`。

新增 helper ABC：无。

## 补丁源与构建脚本

源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。

- [patch_swf.py](source/client-patch/party-animation-liveness/patch_swf.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-animation-liveness/patch_swf.py`；8,452 B；SHA-256 `464b1bee045ce1a2802ce1beb48e65197b46e67d14e358a172856262a24583ea`。
- [run_air_harness.py](source/client-patch/party-animation-liveness/run_air_harness.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-animation-liveness/run_air_harness.py`；6,435 B；SHA-256 `6dbd8efe518967ad24a33174c9d5035192de2fe794e1811e35b05fc88cacc345`。
- [harness-app.xml](source/client-patch/party-animation-liveness/tests/harness-app.xml) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-animation-liveness/tests/harness-app.xml`；365 B；SHA-256 `85181259d7e9b022e1a53dac786f31b3d8bd373d3f0d1ad039aa64ea3a981327`。
- [RuntimeHarness.as](source/client-patch/party-animation-liveness/tests/RuntimeHarness.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/party-animation-liveness/tests/RuntimeHarness.as`；9,656 B；SHA-256 `259fd00c8ef1fe66a21f936470ebfe56f60edf5367dc5b06a5db0617543679df`。

## 验证与安装边界

单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。
交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。
