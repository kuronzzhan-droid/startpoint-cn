# 10 深渊关卡详情与摘要

在列表与编队页展示封锁属性和关卡详情，并保留最终四角曲线的详情按钮。

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`QuestTranslator/translateFormattedQuestNumber`；`PartySelectTopPanelView/baseRun`；`cn.ui.AbyssDetails/*`。
- 修的问题或错误码：未发现专用错误码
- 依赖：quest-element-resistance
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

原AS之后由startup-cache脚本替换attach为圆角按钮，由abyss-records脚本将openDetails委托纪录helper；原AS单独不能代表v33完整最终类。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\README.md:5-24`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py:53-73`
- `D:\WF\apkp1016\research\final_coverage_check.json（最终 attach 曲线按钮核验）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [QuestTranslator/translateFormattedQuestNumber](pcode/boot_ffc6--QuestTranslator_translateFormattedQuestNumber.pcode.txt)；body `71715`；code SHA-256 `af669ba5cbb13cb958e65a00946d0fad5be92f8ba2c24778cd2345716abf229d`。
- [PartySelectTopPanelView/baseRun](pcode/boot_ffc6--PartySelectTopPanelView_baseRun.pcode.txt)；body `78230`；code SHA-256 `e74bd779ee14e7770dfa25b01dd83a49bc15403231067068b22abfe8ad2f0362`。
- [AbyssDetails$/isAbyss](pcode/cn.ui.AbyssDetails--AbyssDetails__isAbyss.pcode.txt)；body `0`；code SHA-256 `41bcfc4e0b063d4a1a194c6b7c0c21ab8d34626d64235a716cdebd258c28892e`。
- [AbyssDetails$/rawSubtitle](pcode/cn.ui.AbyssDetails--AbyssDetails__rawSubtitle.pcode.txt)；body `1`；code SHA-256 `472f7e8623f2ee2cbbc2747c8de10d6784bb929bb35282c8fea64b4007bcb928`。
- [AbyssDetails$/elements](pcode/cn.ui.AbyssDetails--AbyssDetails__elements.pcode.txt)；body `2`；code SHA-256 `9c75c105a9da1d99bca695e33e743485ea86d549d4a70c3e97bc1874cfeba7c5`。
- [AbyssDetails$/summaryForQuest](pcode/cn.ui.AbyssDetails--AbyssDetails__summaryForQuest.pcode.txt)；body `3`；code SHA-256 `6afec7e29ec4e5ae22dca94e94f750943428798513ba8a29e1912b2e4757d5f1`。
- [AbyssDetails$/escape](pcode/cn.ui.AbyssDetails--AbyssDetails__escape.pcode.txt)；body `4`；code SHA-256 `ac714f6bd71c0f2bf49a86b01852870530832ba68d69dc34e6bc51b2f0b02ef6`。
- [AbyssDetails$/detailsHtml](pcode/cn.ui.AbyssDetails--AbyssDetails__detailsHtml.pcode.txt)；body `5`；code SHA-256 `5019ab91fe22182ecbc0b35d48cbd99f9805c0bf517dfc92db56c78a89cd3dde`。
- [anonymous-method-8](pcode/cn.ui.AbyssDetails--anonymous-method-8.pcode.txt)；body `6`；code SHA-256 `1aa65465ac1022a67f67d485ed82892f1265b4d5d26574844141e1d4f2b815aa`。
- [AbyssDetails$/attach](pcode/cn.ui.AbyssDetails--AbyssDetails__attach.pcode.txt)；body `7`；code SHA-256 `7f38aef909a00815deb6e8828d17ead178f2c8612a4c6e1ee5aea12dcc76d27d`。
- [anonymous-method-10](pcode/cn.ui.AbyssDetails--anonymous-method-10.pcode.txt)；body `8`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [AbyssDetails$/openDetails](pcode/cn.ui.AbyssDetails--AbyssDetails__openDetails.pcode.txt)；body `9`；code SHA-256 `e4e50796a8508b022a9c3a4942ba205e1377a782308b56bb9de77d827d907218`。
- [AbyssDetails$/<cinit>](pcode/cn.ui.AbyssDetails--AbyssDetails___cinit_.pcode.txt)；body `10`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [AbyssDetails/<ctor>](pcode/cn.ui.AbyssDetails--AbyssDetails__ctor_.pcode.txt)；body `11`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.ui.AbyssDetails--anonymous-method-0.pcode.txt)；body `12`；code SHA-256 `84abbac93fc429c844e6208fe70e38f5c7067a94b0312e00ac0c1861e074303a`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_swf.py](source/build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\build_swf.py`；8,634 B；SHA-256 `d94d88d8adf6dd374b175f825a160c52ff1d62f07c6ff2bc0ce3970efc8efdfb`。
- [build.py](source/build.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\build.py`；4,719 B；SHA-256 `23c76ffb75c4ab21b6aaeda3e6d2f143683480a2178f3b1c4980aea6e007517a`。
- [AbyssDetails.as](source/AbyssDetails.as) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\src\cn\ui\AbyssDetails.as`；7,929 B；SHA-256 `029a4a8aa42beaaa01be105b7a7a39da63e357a9824fee37d92212d8a9909eb5`。
- [startup-cache--build_swf.py](source/startup-cache--build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py`；6,471 B；SHA-256 `d5dcfb6826b8f3cb462b44860c18f51aae78883c77aa26573c38425c771a3468`。
- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\patch_swf.py`；3,012 B；SHA-256 `0a3f03adf1b71c4affcd7c53b6629af0627a9a6ab2602ae27fb920239a2c2205`。
