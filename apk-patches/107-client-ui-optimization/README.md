# 107 客户端 UI 差量更新与动画池修复

同路径动画池保留有剩余对象的桶，dispose 清理索引；列表复用可比较且未改变的 view，patch/dispose 失效快照；稳定隐藏 cell 与页面省帧，待完成动画及可见边缘继续推进。

- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。
- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。
- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。
- 改动位置：8 个既有目标方法；见下方方法清单。
- 修的问题或错误码：本条行为见上文；未新增错误码。
- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。
- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。

## 最终采用证据

输入 APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`；输入 SWF SHA-256：`3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`。
上游来源：`D:\WF\startpoint-cn-kulo` 的 `origin/main` 提交 `224aa2a663b7756fc8a34c0f37f1ae61ad81800c` 下 `client-patch/client-ui-optimization/`，先用 git show 导出到本工作区再使用。
最终 v34 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。
本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。

## 合成与保留逻辑

合成 CharacterTable/updateCells（原 #62）：先同步 z/alpha，再由 R4 shouldUpdateCell 决定执行原 update 或继续循环；旧远屏 guard 字节保留但不再截断完成敏感状态。合成 CharacterTableView/present 与 applyPatch（原 #67）：加入 R4 增量呈现/失效 hook，同时保留 v33 无效日志参数求值跳过。原 #60 每帧三格 draw 上限不变。

## 最终 P-code

以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。

- `pinball.scene.character.cell::PixelArtCharacterAnimationPool/getOrCreate|1`；body `65850`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.cell_PixelArtCharacterAnimationPool_getOrCreate_1.pcode.txt)；code SHA-256 `da09aa208ad779ce16beb70bb8db1d85eaabddf2973e05e86fc771964888adc8`。
- `pinball.scene.character.cell::PixelArtCharacterAnimationPool/dispose|1`；body `65851`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.cell_PixelArtCharacterAnimationPool_dispose_1.pcode.txt)；code SHA-256 `6c6fcfd4272a41c382b0b3ebb8cd7725cf99ee7151667ebe64473c925108efb1`。
- `pinball.scene.character.characterTable::CharacterTable/updateCells|1`；body `66116`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.characterTable_CharacterTable_updateCells_1.pcode.txt)；code SHA-256 `b5a950adfe6ed6fb927c84b70c1d506597687224a555c246d996731a96df0ac5`。
- `pinball.scene.character.characterTable::CharacterTableView/present|1`；body `66173`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.characterTable_CharacterTableView_present_1.pcode.txt)；code SHA-256 `c788aeb78ab02d128fccdf9dcc1f9a0a15688d7a049685da292f76c9100f3fe9`。
- `pinball.scene.character.characterTable::CharacterTableView/dispose|1`；body `66179`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.characterTable_CharacterTableView_dispose_1.pcode.txt)；code SHA-256 `213e8a7bfb373006f77e58bda72dc160301b730212a30df5a6a16fd6df381f42`。
- `pinball.scene.character.characterTable::CharacterTableView/applyPatch|1`；body `66180`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.characterTable_CharacterTableView_applyPatch_1.pcode.txt)；code SHA-256 `cb0c28c4d27e12f75beea00da5b6debf08f6e4d96ccf6cd21305227396284f83`。
- `pinball.scene.character.partyCarousel.page::PartyCarouselPageView/draw|1`；body `66662`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.partyCarousel.page_PartyCarouselPageView_draw_1.pcode.txt)；code SHA-256 `9a6358a47e9b0af4fa04e31bf06fc1d56cff83e932e72acfb96e33d6b49212b4`。
- `pinball.scene.character.partyCarousel.page::PartyCarouselPageView/dispose|1`；body `66663`；[最终 P-code](pcode/boot_ffc6--pinball.scene.character.partyCarousel.page_PartyCarouselPageView_dispose_1.pcode.txt)；code SHA-256 `5160bff75843dd234010b2bc5e5ea985b544e43a6bed16e1229bfc7ab40e764a`。

新增 helper ABC：`cn.optimize.ui.UiOptimization`。

## 补丁源与构建脚本

源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。

- [patch_swf.py](source/client-patch/client-ui-optimization/patch_swf.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/patch_swf.py`；9,008 B；SHA-256 `41b0890010ed71278b3935eb7f6f7290d42d266d4ed216d702017ae9b57b768b`。
- [UiOptimization.as](source/client-patch/client-ui-optimization/src/cn/optimize/ui/UiOptimization.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/src/cn/optimize/ui/UiOptimization.as`；10,508 B；SHA-256 `7a3add11f7fa6a911681813a5fea5be5662be04d2fa9e16284eddf072db646c8`。
- [Option.as](source/client-patch/client-ui-optimization/tests/fixtures/haxe/ds/Option.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/fixtures/haxe/ds/Option.as`；377 B；SHA-256 `0712a2341672cdb02d0a63d87cf677c8ce7dda6c1e83e71b72e14bb3c2ec8735`。
- [StringMap.as](source/client-patch/client-ui-optimization/tests/fixtures/haxe/ds/StringMap.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/fixtures/haxe/ds/StringMap.as`；442 B；SHA-256 `d2f7dcece972139e3a31e9d93d99f434f0a29bb6406bc5ee961856dc073453ea`。
- [CharacterCellViewDataSourceKind.as](source/client-patch/client-ui-optimization/tests/fixtures/pinball/scene/character/cell/CharacterCellViewDataSourceKind.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/fixtures/pinball/scene/character/cell/CharacterCellViewDataSourceKind.as`；760 B；SHA-256 `79af29eb1492969812cf6150fbdcacecf69eba1d1a76e550f4b7d7ad9201978b`。
- [CharacterCellViewDataSourceKindTools.as](source/client-patch/client-ui-optimization/tests/fixtures/pinball/scene/character/cell/CharacterCellViewDataSourceKindTools.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/fixtures/pinball/scene/character/cell/CharacterCellViewDataSourceKindTools.as`；231 B；SHA-256 `ab52ce44250f47b4166fc88402f0e31aa826c0465469e23de6e3ffef1235bfca`。
- [harness-app.xml](source/client-patch/client-ui-optimization/tests/harness-app.xml) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/harness-app.xml`；352 B；SHA-256 `212af02b47206d788dc7bf32ba1f6fd703f90bd5f1dd1db3df90bca3806096dc`。
- [run_tests.py](source/client-patch/client-ui-optimization/tests/run_tests.py) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/run_tests.py`；8,082 B；SHA-256 `eb1c077331a86094ac3ce654a0243056f839a45173eb49bcedaa612565ba7941`。
- [RuntimeHarness.as](source/client-patch/client-ui-optimization/tests/RuntimeHarness.as) ← `D:\WF\startpoint-cn-kulo@224aa2a663b7756fc8a34c0f37f1ae61ad81800c:client-patch/client-ui-optimization/tests/RuntimeHarness.as`；27,980 B；SHA-256 `a995ccfa15dc6a7d671972d900f82ccf0ffb6e36bbb52c48697426ab697a5298`。
- [compose_conflicts.py](source/task-adapters/compose_conflicts.py) ← `D:\WF\v34-r4-20261016\scripts\compose_conflicts.py`；5,363 B；SHA-256 `412ee87251f01f4945ed61d1e04e5783ca071b373a23841a56a2b7af2dcc6e08`。

## 验证与安装边界

单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。
交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。
