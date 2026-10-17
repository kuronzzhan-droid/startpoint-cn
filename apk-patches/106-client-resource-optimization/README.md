# 106 资源 IO 批任务与完成阶段优化

约束异步打开与批任务在途数，修复重入、取消和重复完成生命周期；将 decode/deliver/上传/恢复纳入需求调度及所有者失效，保留原生同步调用不可抢占的边界。

- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。
- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。
- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。
- 改动位置：23 个既有目标方法；见下方方法清单。
- 修的问题或错误码：本条行为见上文；未新增错误码。
- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。
- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。

## 最终采用证据

输入 APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`；输入 SWF SHA-256：`3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`。
上游来源：`D:\WF\startpoint-cn-kulo` 的 `origin/main` 提交 `224aa2a663b7756fc8a34c0f37f1ae61ad81800c` 下 `client-patch/client-resource-optimization/`，先用 git show 导出到本工作区再使用。
最终 v34 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。
本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。

## 合成与保留逻辑

23 个主 ABC 方法：11 个指定单方法 body 移植、12 个可逆 hook。donor 中的同名游戏类仅为方法编译依赖，绝不以 donor 类定义替换游戏类；游戏签名、traits 与类布局保留。

## 最终 P-code

以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。

- `pinball.asset.file::BitmapTextureRestoreHandler/uploadPng|1`；body `5368`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_BitmapTextureRestoreHandler_uploadPng_1.pcode.txt)；code SHA-256 `bb2abb9782aeb52d6cf1f8a8a144cf0ac572435ec63ac13f2972a90edab6a7d6`。
- `pinball.asset.file::BitmapTextureRestoreHandler/restoreHandler|1`；body `5369`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_BitmapTextureRestoreHandler_restoreHandler_1.pcode.txt)；code SHA-256 `fda26c886cab279b72178d8f3b3925b5b155058b92ed5164df74d1244b105572`。
- `pinball.asset.file::BitmapTextureRestoreHandler/<ctor>`；body `5371`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_BitmapTextureRestoreHandler_ctor_.pcode.txt)；code SHA-256 `ab1a336b892a94192c39f0e9d1b451da016ef1bd62e2eb2ed4ab2c9fa654d3cb`。
- `pinball.asset.file._FileReader::OpenHandler/execute|1`；body `5381`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file._FileReader_OpenHandler_execute_1.pcode.txt)；code SHA-256 `5851aa79469b40c293146cb4ce2042ba4055bf0495817888756b7a8b7784897b`。
- `pinball.asset.file._FileReader::OpenHandler/<ctor>`；body `5382`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file._FileReader_OpenHandler_ctor_.pcode.txt)；code SHA-256 `56eb35c84f0c9ae577c3699e3dc976bec871832e1b7a04e776942e129f9eb3e3`。
- `pinball.asset.file::FileStreamWithCounter/openAsync|1`；body `5425`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_FileStreamWithCounter_openAsync_1.pcode.txt)；code SHA-256 `b67806d22f927ad258d0919486b6f967c5dd952686f29cd784d274325c8d2677`。
- `pinball.asset.file::FileStreamWithCounter/open|1`；body `5426`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_FileStreamWithCounter_open_1.pcode.txt)；code SHA-256 `720dddc15dcb4e318cbfed8619ee71bad959a85285300a25700b2bda3e86e291`。
- `pinball.asset.file::FileStreamWithCounter/close|1`；body `5427`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_FileStreamWithCounter_close_1.pcode.txt)；code SHA-256 `3550f1470d5663ed94c53a3fef684e00563cf55edb442a27fd3e95280f90d568`。
- `pinball.asset.file::FileStreamWithCounter/_openAsync|1`；body `5440`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_FileStreamWithCounter__openAsync_1.pcode.txt)；code SHA-256 `631eea2bb3be3432265cd4b0fa70e6cbd654539ea348af06ce27270e7aa5b896`。
- `pinball.asset.file::FileStreamWithCounter/_close|1`；body `5441`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_FileStreamWithCounter__close_1.pcode.txt)；code SHA-256 `3455a46cf36421ddc78929a119c30d69e03a4969786006adae861be3f135949f`。
- `pinball.asset.file::ReadAtfTextureFileHandler/uploadAtf|1`；body `5478`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_ReadAtfTextureFileHandler_uploadAtf_1.pcode.txt)；code SHA-256 `d935409512feebed6e8b4dbb77594c185bf8916e8aa522091cd4265ddb61ce48`。
- `pinball.asset.file::ReadAtfTextureFileHandler/<ctor>`；body `5480`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_ReadAtfTextureFileHandler_ctor_.pcode.txt)；code SHA-256 `575b96131bbc35d45c844387137cd4a33590f883b5c68ff5227529578b4df849`。
- `pinball.asset.file::ReadPngTextureFileHandler/_uploadPng|1`；body `5485`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_ReadPngTextureFileHandler__uploadPng_1.pcode.txt)；code SHA-256 `77022a02a0e73053bf8330f6a9ed158e9f07d527a1eab5b0daa4e7ce364630de`。
- `pinball.asset.file::ReadPngTextureFileHandler/<ctor>`；body `5486`；[最终 P-code](pcode/boot_ffc6--pinball.asset.file_ReadPngTextureFileHandler_ctor_.pcode.txt)；code SHA-256 `129a18c16502aab6423e7c4295e81cec4455086c2dc9ff3fd3ec2966d441ae6e`。
- `pinball.asset.view::ViewAssetCache$/disposeDownloadedTexture|1`；body `5937`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_disposeDownloadedTexture_1.pcode.txt)；code SHA-256 `f36ccad31b43e424950dea81d5a9b1b6d1ab7da7606bb30b88655dc69474aa09`。
- `pinball.asset.view::ViewAssetCache/startOtherLoad|1`；body `5946`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_startOtherLoad_1.pcode.txt)；code SHA-256 `9299d31efe2d539a8b7c42779170b32e160ef5116fb3ca4b9e04ca597aaede7b`。
- `pinball.asset.view::ViewAssetCache/readTextureHandler|1`；body `5962`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_readTextureHandler_1.pcode.txt)；code SHA-256 `ad33ce37796ac4753c98fdf1eff0070bb6b563aed5c13f3e6bde5a05c85f15a1`。
- `pinball.asset.view::ViewAssetCache/readTexture|1`；body `5963`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_readTexture_1.pcode.txt)；code SHA-256 `58da791ad1207eecc7db9e46569adf68aec61997498dde8a1ec18514250c2a6f`。
- `pinball.asset.view::ViewAssetCache/downloadTexture|1`；body `5987`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_downloadTexture_1.pcode.txt)；code SHA-256 `06a9fcd694508931ce56a41788b6a1797a95a6a658ffa906077821aee63a8d06`。
- `pinball.asset.view::ViewAssetCache/dispose|1`；body `5989`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_dispose_1.pcode.txt)；code SHA-256 `c0c5271510a343214e191d03c833071830138ea8ee6e2819a858c0e47feebacc`。
- `pinball.asset.view::ViewAssetCache/addGroup|1`；body `5993`；[最终 P-code](pcode/boot_ffc6--pinball.asset.view_ViewAssetCache_addGroup_1.pcode.txt)；code SHA-256 `833072337d92ba7598d69669afc5abf6ddadfb0b7d17f9c3a5b60683f57933c8`。
- `pinball.common.task::MultiTask/startNextTask|1`；body `26437`；[最终 P-code](pcode/boot_ffc6--pinball.common.task_MultiTask_startNextTask_1.pcode.txt)；code SHA-256 `311bc5721d1fc89999e8b2a42a4d3657074649d0d114f29fc93260461ab218a4`。
- `pinball.common.task::MultiTask/_startNextTask|1`；body `26441`；[最终 P-code](pcode/boot_ffc6--pinball.common.task_MultiTask__startNextTask_1.pcode.txt)；code SHA-256 `311bc5721d1fc89999e8b2a42a4d3657074649d0d114f29fc93260461ab218a4`。

新增 helper ABC：`cn.optimize.resources.ResourceRuntime`。

## 补丁源与构建脚本

源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。

- [build_assets.py](source/client-patch/client-resource-optimization/build_assets.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/build_assets.py`；2,312 B；SHA-256 `6d40b6e0996f2c313065e0274e752303efc147cb46e69612ff8fa0c783505013`。
- [Boot.as](source/client-patch/client-resource-optimization/donor/flash/Boot.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/flash/Boot.as`；120 B；SHA-256 `e7148db81bdf7511eeb38e2ee67bb25f2dd2ae163464c832fd59a369e815917e`。
- [IntMap.as](source/client-patch/client-resource-optimization/donor/haxe/ds/IntMap.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/haxe/ds/IntMap.as`；97 B；SHA-256 `857f2ba3aa0487dfdcc1f5ecbbd7f7432ca3302da0952fd0df167cc7baf4c8f1`。
- [IMap.as](source/client-patch/client-resource-optimization/donor/haxe/IMap.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/haxe/IMap.as`；40 B；SHA-256 `cfc8bb7be97881f3589218ff1af3e14043a36b5826e065defd0136cb720352fe`。
- [OpenHandler.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/_FileReader/OpenHandler.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/_FileReader/OpenHandler.as`；596 B；SHA-256 `385491844cb73468632eac1965aa322269431e0164b1f2c7d22d505e32acca7b`。
- [BitmapTextureRestoreHandler.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/BitmapTextureRestoreHandler.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/BitmapTextureRestoreHandler.as`；879 B；SHA-256 `c5d4e6f72e7dff81f862456831e170c91434ec643f171dcdcfe72f3092502277`。
- [FileReader.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/FileReader.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/FileReader.as`；389 B；SHA-256 `04b9b85b386418bf1d8d271a62f87c6fa24c67cc3d88a967493f146de922a8a6`。
- [FileStreamWithCounter.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/FileStreamWithCounter.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/FileStreamWithCounter.as`；2,224 B；SHA-256 `957a64e6dd865346985a45b74b3a3e9c2f2515f198ff5f49d22a23f8a002949d`。
- [PngLoadHandler.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/PngLoadHandler.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/PngLoadHandler.as`；940 B；SHA-256 `e2486c67966a7f54787285be6f7e6851e645119dac0cadccc139ce5b6d935d97`。
- [ReadAtfTextureFileHandler.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/ReadAtfTextureFileHandler.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/ReadAtfTextureFileHandler.as`；779 B；SHA-256 `12dc1b278ed2fb24b26711284027940f713f6dc54e1a862153c3e3fd93a80619`。
- [ReadPngTextureFileHandler.as](source/client-patch/client-resource-optimization/donor/pinball/asset/file/ReadPngTextureFileHandler.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/file/ReadPngTextureFileHandler.as`；722 B；SHA-256 `0d7e6e2fb4e17fbb7fd98703f94e9a38469adee58255bf3aae357ec9f4ad610f`。
- [WaitInOrderImpl.as](source/client-patch/client-resource-optimization/donor/pinball/asset/WaitInOrderImpl.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/asset/WaitInOrderImpl.as`；487 B；SHA-256 `6a2eea68e5fd2a2f8f6607567235423ca8366433426f89370bf22901cc7b6cfd`。
- [MultiTask.as](source/client-patch/client-resource-optimization/donor/pinball/common/task/MultiTask.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/common/task/MultiTask.as`；726 B；SHA-256 `79fe55daa0dff504c4e73d01fc94daa1ef8b0582665a2c37cb3db0e1182ce85a`。
- [ProgressManager.as](source/client-patch/client-resource-optimization/donor/pinball/common/task/ProgressManager.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/common/task/ProgressManager.as`；496 B；SHA-256 `18968881c2f80103d2e62c286f7774dbf8ab89ee22ee325731a220458a70f7cb`。
- [ActivityUtil.as](source/client-patch/client-resource-optimization/donor/pinball/context/activity/ActivityUtil.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/context/activity/ActivityUtil.as`；167 B；SHA-256 `79b45879160ba57429825f512c6f46e6ed9551f6a2cdd0c09a75f47af004e31b`。
- [ClientError.as](source/client-patch/client-resource-optimization/donor/pinball/error/ClientError.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/pinball/error/ClientError.as`；140 B；SHA-256 `09eab3d67e40991c46df5cc891c7ab7a5f7b1a711e995d5dce2f4644c2f07768`。
- [Starling.as](source/client-patch/client-resource-optimization/donor/starling/core/Starling.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/starling/core/Starling.as`；108 B；SHA-256 `4367f6128e581ed2499dd98c52c1d68f048c4a97ee9e0e8f96ff04091cec953c`。
- [Texture.as](source/client-patch/client-resource-optimization/donor/starling/textures/Texture.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/donor/starling/textures/Texture.as`；918 B；SHA-256 `008fe05490b453e42ca969a3d3b5db9bbf9d6d165ed2a63cf25188d066afb6f3`。
- [method-pins.json](source/client-patch/client-resource-optimization/method-pins.json) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/method-pins.json`；7,179 B；SHA-256 `69c148bfc61a8303439ebe364c692b1c96276132bb86f239819cc573f67c34fe`。
- [patch_swf.py](source/client-patch/client-resource-optimization/patch_swf.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/patch_swf.py`；9,651 B；SHA-256 `4725d625cf1d5ef3372492a0840e10d879a630db4e3461dbd08ab6f16b5c35fe`。
- [run_air_harness.py](source/client-patch/client-resource-optimization/run_air_harness.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/run_air_harness.py`；4,768 B；SHA-256 `826a41fb6b652c5e13136db0aa0cf2033a06e168a910b1dbe3ffe36b082fc494`。
- [ResourceRuntime.as](source/client-patch/client-resource-optimization/src/cn/optimize/resources/ResourceRuntime.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/src/cn/optimize/resources/ResourceRuntime.as`；22,433 B；SHA-256 `2df60ae4a55090259956adf953cfb25369d2f118c202a3c034b355efebe701d4`。
- [FixtureClock.as](source/client-patch/client-resource-optimization/tests/FixtureClock.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/tests/FixtureClock.as`；189 B；SHA-256 `ec256acaafa1cda22710ba6c06016decb091d185fda4ae8bdb476f8168481a9a`。
- [Hello.as](source/client-patch/client-resource-optimization/tests/Hello.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/tests/Hello.as`；363 B；SHA-256 `705da30cf5d0b0b0025ea74977779f147138c0ffc6d35b2faec2fc72146d550f`。
- [RuntimeHarness.as](source/client-patch/client-resource-optimization/tests/RuntimeHarness.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-resource-optimization/tests/RuntimeHarness.as`；20,782 B；SHA-256 `c13126a2b0b340aab0715779ba8434d59e04df4c7b5bd3d9f30b9a0eb81cf234`。

## 验证与安装边界

单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。
交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。
