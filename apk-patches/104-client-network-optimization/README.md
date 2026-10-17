# 104 独立管理网络请求的超时预算

每次初始请求获得独立预算，重试共享该请求的已耗时截止；耗尽时进入原 timeout 路径。以单次 AIR Timer 替代按 60 FPS 计数的 HTTP 等待；完成与错误移除时取消 Timer。

- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。
- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。
- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。
- 改动位置：4 个既有目标方法；见下方方法清单。
- 修的问题或错误码：本条行为见上文；未新增错误码。
- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。
- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。

## 最终采用证据

输入 APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`；输入 SWF SHA-256：`3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`。
上游来源：`D:\WF\startpoint-cn-kulo` 的 `origin/main` 提交 `224aa2a663b7756fc8a34c0f37f1ae61ad81800c` 下 `client-patch/client-network-optimization/`，先用 git show 导出到本工作区再使用。
最终 v34 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。
本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。

## 合成与保留逻辑

4 个目标方法均直接通过 v33 方法锁；源模块历史提交为 66aac625，归档源码以本次 origin/main 导出为准。

## 最终 P-code

以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。

- `pinball.context.remote::RemoteEventListenerManager/removeListeners|1`；body `29656`；[最终 P-code](pcode/boot_ffc6--pinball.context.remote_RemoteEventListenerManager_removeListeners_1.pcode.txt)；code SHA-256 `6acb353fe43291526536b171b06225d2ae4b7cf7734f063f7e0e8edc8e8aa0a0`。
- `pinball.context.remote::RemoteEventListenerManager/addEventListeners|1`；body `29665`；[最终 P-code](pcode/boot_ffc6--pinball.context.remote_RemoteEventListenerManager_addEventListeners_1.pcode.txt)；code SHA-256 `b6256f2fabec6e445ac33006d68ed8bd49d50cbb675c2cfae37490ac5139d9c9`。
- `pinball.context.remote::RequestQueue/startRequest|1`；body `29697`；[最终 P-code](pcode/boot_ffc6--pinball.context.remote_RequestQueue_startRequest_1.pcode.txt)；code SHA-256 `eed578b10355d3a829f0ce943f639c4e57f1b9acf2c420ad42b6e068e252591e`。
- `pinball.context.remote::RequestQueue/requestErrorHandler|1`；body `29702`；[最终 P-code](pcode/boot_ffc6--pinball.context.remote_RequestQueue_requestErrorHandler_1.pcode.txt)；code SHA-256 `0a08e8e03365815fec4bb794e2a388907200ef8e91f0b02185273f81759ef198`。

新增 helper ABC：`cn/optimize/network/RequestTimer`、`cn/optimize/network/NetworkBudget`。

## 补丁源与构建脚本

源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。

- [patch_swf.py](source/client-patch/client-network-optimization/patch_swf.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/patch_swf.py`；8,566 B；SHA-256 `30f2a65e637afd8ecb3cf5942624c9f6745bdcec3175c267923ed5da8f5cbc1c`。
- [run_air_tests.py](source/client-patch/client-network-optimization/run_air_tests.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/run_air_tests.py`；4,246 B；SHA-256 `7f2a788ff288ff6817099c5e2f279004c5dcf82f38ebb514c415eb4a0fc66162`。
- [NetworkBudget.as](source/client-patch/client-network-optimization/src/cn/optimize/network/NetworkBudget.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/src/cn/optimize/network/NetworkBudget.as`；1,917 B；SHA-256 `621491e01afec6722ed8033927a7032d31fa4e86f8849f470320ad5ea5899a10`。
- [RequestTimer.as](source/client-patch/client-network-optimization/src/cn/optimize/network/RequestTimer.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/src/cn/optimize/network/RequestTimer.as`；1,381 B；SHA-256 `41c1b4f1e077934d5f158c0687e614968beba0078f960274400f1be1af08892a`。
- [harness-app.xml](source/client-patch/client-network-optimization/tests/harness-app.xml) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/harness-app.xml`；356 B；SHA-256 `4822beee7206f8f02fde5684839912aa0ea5ba027397ef54dd4c7197848ac2eb`。
- [Option.as](source/client-patch/client-network-optimization/tests/haxe/ds/Option.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/haxe/ds/Option.as`；330 B；SHA-256 `15615e72ed51a1a9271b97420c0af6efdaa0efd1684b8be2910a951e5d4bf384`。
- [RemoteError.as](source/client-patch/client-network-optimization/tests/pinball/context/remote/RemoteError.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/pinball/context/remote/RemoteError.as`；200 B；SHA-256 `d088377d6fb48096fb746705c5e678d8549e58a3b802bb6993976ad173ae76fb`。
- [RemoteErrorKind.as](source/client-patch/client-network-optimization/tests/pinball/context/remote/RemoteErrorKind.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/pinball/context/remote/RemoteErrorKind.as`；634 B；SHA-256 `eba2a63a7e9c63d81cb49c76d46779f6de90ae755c433c7ffc587ca8435bca63`。
- [RemoteEventListenerManager.as](source/client-patch/client-network-optimization/tests/pinball/context/remote/RemoteEventListenerManager.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/pinball/context/remote/RemoteEventListenerManager.as`；1,663 B；SHA-256 `a25a6c9c9ed81260409a714995eb2dca5b6f87a8dac8afc7214696180257c33f`。
- [QueueProbe.as](source/client-patch/client-network-optimization/tests/QueueProbe.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/QueueProbe.as`；604 B；SHA-256 `d4ec71e1766cfeba7ab1c22dc1eeff40e48cd8d829efdc1f3b40ca8453129df6`。
- [RuntimeHarness.as](source/client-patch/client-network-optimization/tests/RuntimeHarness.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-network-optimization/tests/RuntimeHarness.as`；5,648 B；SHA-256 `5352002743048d693c1d1d48c8b0da7027ce88eb685e35a0d29e1bcda3ab3c65`。

## 验证与安装边界

单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。
交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。
