# 结论来源索引

调查日期：2026-10-16。所有原始路径只读；本文件中的 `research` 路径指本次新生成的核验记录，不冒认为历史原始文档。

## 全局构建与实际产物证据

- `D:\WF\perf-v30-20261015\build-v33x86.ps1:8-15`：锁定最终原 v33 哈希并追加 x86/ANE。
- `D:\WF\perf-v30-20261015\FEASIBILITY-x86.md:180-198`：E3 和 v33-x86 最终产物/历史设备记录、缓存限制。此次未复测。
- `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v33-voiceready.build-report.json`：v32l 输入、V1/V2/V3、输出 SWF。
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json`：最终 B1/B2/B3/B5。
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json`：最终 P1/P2/P3。
- `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json`：perf2 输入、O1–O7 和 bundle 四成员。
- `D:\WF\perf-v30-20261015\out\世界弹射测试服-v30-perf2.build-report.json` 与 `tools/perf2_patches.py:221-237`：P1/S1/S2/B1/C1 顺序和方法哈希。
- `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json`、同目录 v25/v26/v27 报告：从 v17 重建及逐版本新增/替换。
- `C:\Users\12101\Downloads\世界弹射测试服-v17.apk`、`世界弹射测试服-v33.apk`、`世界弹射测试服-v33-x86.apk`：本次只读在内存解析，未复制；对应 `_checks` 记录文件哈希、逐方法哈希和成员比较。

## 01 九尾 PF 弹射前连击快照

- 对应目录：[01-pf-initial-combo](01-pf-initial-combo/README.md)。
- 首发/最终版结论：v10；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\README.md:3-31`
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:8-13`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\slot.py` → `01-pf-initial-combo\source\slot.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\pcode.py` → `01-pf-initial-combo\source\pcode.py`。
- 最终方法体实证：
  - `boot_ffc6:BallImpl/resolveCollisionForPrimaryOrSummons`；body `59837`；code SHA-256 `fde02ea9a9645500b28a7990bb0404d300dc4ee3184fd7bab10f3942fdd1bf52`；已收文本。
  - `boot_ffc6:ActionEvaluationResolver/<ctor>`；body `52225`；code SHA-256 `f04f8ade940fe81b9221c9b0e5fdd848e213dd89eca0c6623ac31b3fb8dc2140`；已收文本。

## 02 能力与队长技文案覆盖

- 对应目录：[02-panel-description-override](02-panel-description-override/README.md)。
- 首发/最终版结论：v11（v14 泛化与安全取表）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:19-33`
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:85-108`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\kyubi-panel-override\pcode.py` → `02-panel-description-override\source\pcode.py`。
- 最终方法体实证：
  - `boot_ffc6:AbilityLogic/getDescriptions`；body `7341`；code SHA-256 `3e396ebe35c717c1e064f14bf2b9708672ab7352f0a5271c48e5397e875a3e27`；已收文本。
  - `boot_ffc6:AbilityLogic/getDescriptionWithSimplify`；body `7342`；code SHA-256 `229ef6943988233f9f13b8201dc12d8180bf571ba041e16b96a0aad42dde26a9`；已收文本。
  - `boot_ffc6:LeaderAbilityLogic/getDescriptions`；body `7678`；code SHA-256 `3e396ebe35c717c1e064f14bf2b9708672ab7352f0a5271c48e5397e875a3e27`；已收文本。
  - `boot_ffc6:LeaderAbilityLogic/getDescriptionWithSimplify`；body `7679`；code SHA-256 `229ef6943988233f9f13b8201dc12d8180bf571ba041e16b96a0aad42dde26a9`；已收文本。

## 03 冲刺参数能力422

- 对应目录：[03-dash-parameter-422](03-dash-parameter-422/README.md)。
- 首发/最终版结论：v12；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:8`
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:244-248`
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:39-43`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\dash-parameter\abcpatch.py` → `03-dash-parameter-422\source\abcpatch.py`。
- 最终方法体实证：
  - `boot_ffc6:AbilityValues$/parseAt109`；body `39060`；code SHA-256 `3e42c85d4ee45ce33be9a7aec70e350a2303ce3cb7132dd0e8183c02310516eb`；已收文本。
  - `boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues`；body `13253`；code SHA-256 `7a5349a32a8335817281b9bb9b52f345dec5c26aa56333e27209472fe0aed46f`；完整文本超过上限未收。
  - `boot_ffc6:BattleAbilityTotalizerImpl/addDuringContent`；body `51465`；code SHA-256 `8d64bbf5744ba5a257ee6f81e46eec7995868d8eb62f6df6583411bcfde0d4bc`；已收文本。
  - `boot_ffc6:BallImpl/update`；body `59818`；code SHA-256 `7b51eee71693ca74a1f69feacc7220cbcf60fb27b2c617e9b6cf9a367c7594bd`；已收文本。
  - `boot_ffc6:BallImpl/findEscapeTarget`；body `59973`；code SHA-256 `eff8bb9bf1840c36e2e9b3076759397f31a492ee31de4e8d0323eb671801facc`；已收文本。
  - `boot_ffc6:BallImpl/tryEscape`；body `59819`；code SHA-256 `0a8f0df53ce4171c79c2e29b1a5ebfd6777211a65c5353f1e3777a3feda5c2c7`；已收文本。
  - `boot_ffc6:BallImpl/canEscapeNow`；body `60011`；code SHA-256 `487e8f3e1fbc2be41fc00aaddb468f5db239fb7eb014fbe796720f85dea5f268`；已收文本。

## 04 Fever 槽百分比增减724

- 对应目录：[04-fever-ratio-724](04-fever-ratio-724/README.md)。
- 首发/最终版结论：v12；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:8`
  - `D:\WF\out\newchars-v14-20260908\BUILD.md:244-248`
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:26-43`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\kyubi-fever-ratio\abcpatch.py` → `04-fever-ratio-724\source\abcpatch.py`。
- 最终方法体实证：
  - `boot_ffc6:AbilityValues$/parseAt47`；body `39030`；code SHA-256 `9c32845d494c25b0f15009205b38e0cbdd2d4ab1b65ddfaa91e89a3b4deb0943`；完整文本超过上限未收。
  - `boot_ffc6:InstantAbilitySource$/resolveInstantContent`；body `14488`；code SHA-256 `b920769d365cae73818ed25a5ef2e243714122e218ed2061f7657d36acc38056`；完整文本超过上限未收。
  - `boot_ffc6:AbilitySlotImpl/applyInstantBattle`；body `51424`；code SHA-256 `0c6c80690b2862bbbd44a962a5225296e5c1ffac862cd1f9a8e6b9e513560d25`；已收文本。

## 05 夏日白晒伤能力减抗

- 对应目录：[05-summer-bai-sunburn](05-summer-bai-sunburn/README.md)。
- 首发/最终版结论：v15；Lens 0910 移植前作者具体构建名需核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\README.md:24-33`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\build_swf.py` → `05-summer-bai-sunburn\source\build_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:ConditionSlot/getOneSideTotalAbilityDamageResistance`；body `56724`；code SHA-256 `ca835a8afbbae9802a6d0a6f118e1b2075f9f0c8795dbb1b6fd61ee1e9f5d420`；已收文本。

## 06 夏日白Fever语音路由

- 对应目录：[06-summer-bai-voice](06-summer-bai-voice/README.md)。
- 首发/最终版结论：v15；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\README.md:24-33`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\build_swf.py` → `06-summer-bai-voice\source\build_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:SquadManagerImpl/invokeActionSkill`；body `59726`；code SHA-256 `22ddd65155caa3a2110ec8abc5cc7c6e501f688c5d7847c8fcfa21ae1295293f`；已收文本。
  - `boot_ffc6:HudMemberStatus/update`；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolveFollowingPathCollection`；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`；已收文本。

## 07 129992四条准备音轮换

- 对应目录：[07-gerald-129992-ready-voice](07-gerald-129992-ready-voice/README.md)。
- 首发/最终版结论：v16；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\README.md:24-33`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0910\build_swf.py` → `07-gerald-129992-ready-voice\source\build_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:HudMemberStatus/update`；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolveFollowingPathCollection`；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`；已收文本。

## 08 能力汇总描述缓存

- 对应目录：[08-ability-summary-description-cache](08-ability-summary-description-cache/README.md)。
- 首发/最终版结论：v17以前；原性能阶段称 R8，具体发布APK编号未核实；R8 算法经 R10 去诊断后，由 v17 原样继承到 v33。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-diagnostic\patch_swf.py:86-88`
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py:85-101`
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\README.md:10-12`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py` → `08-ability-summary-description-cache\source\build.py`。
- 最终方法体实证：
  - `boot_ffc6:AbilitySummarizer$/summaryAbilities`；body `15140`；code SHA-256 `26d392cb941fbc9a1d7134d4e12aaaa4260179786930513be49f7d1c962ec03c`；已收文本。

## 09 深渊续战跨关复用角色

- 对应目录：[09-abyss-autostart](09-abyss-autostart/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-autostart\README.md:20-30`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-autostart\build_apk.py` → `09-abyss-autostart\source\build_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:RushEventAutoStartQuestGroup/getDuplicatedCharacterIdsForEachQuest`；body `24599`；code SHA-256 `a5feea4824f2dfe2406d3bd1982e31cf50fe835698911fec8ce731a56284767d`；已收文本。

## 10 深渊关卡详情与摘要

- 对应目录：[10-abyss-details](10-abyss-details/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\README.md:5-24`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py:53-73`
  - `D:\WF\apkp1016\research\final_coverage_check.json（最终 attach 曲线按钮核验）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\build_swf.py` → `10-abyss-details\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\build.py` → `10-abyss-details\source\build.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-detail-ui\src\cn\ui\AbyssDetails.as` → `10-abyss-details\source\AbyssDetails.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py` → `10-abyss-details\source\startup-cache--build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\patch_swf.py` → `10-abyss-details\source\patch_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:QuestTranslator/translateFormattedQuestNumber`；body `71715`；code SHA-256 `af669ba5cbb13cb958e65a00946d0fad5be92f8ba2c24778cd2345716abf229d`；已收文本。
  - `boot_ffc6:PartySelectTopPanelView/baseRun`；body `78230`；code SHA-256 `e74bd779ee14e7770dfa25b01dd83a49bc15403231067068b22abfe8ad2f0362`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/isAbyss`；body `0`；code SHA-256 `41bcfc4e0b063d4a1a194c6b7c0c21ab8d34626d64235a716cdebd258c28892e`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/rawSubtitle`；body `1`；code SHA-256 `472f7e8623f2ee2cbbc2747c8de10d6784bb929bb35282c8fea64b4007bcb928`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/elements`；body `2`；code SHA-256 `9c75c105a9da1d99bca695e33e743485ea86d549d4a70c3e97bc1874cfeba7c5`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/summaryForQuest`；body `3`；code SHA-256 `6afec7e29ec4e5ae22dca94e94f750943428798513ba8a29e1912b2e4757d5f1`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/escape`；body `4`；code SHA-256 `ac714f6bd71c0f2bf49a86b01852870530832ba68d69dc34e6bc51b2f0b02ef6`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/detailsHtml`；body `5`；code SHA-256 `5019ab91fe22182ecbc0b35d48cbd99f9805c0bf517dfc92db56c78a89cd3dde`；已收文本。
  - `cn.ui.AbyssDetails:anonymous-method-8`；body `6`；code SHA-256 `1aa65465ac1022a67f67d485ed82892f1265b4d5d26574844141e1d4f2b815aa`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/attach`；body `7`；code SHA-256 `7f38aef909a00815deb6e8828d17ead178f2c8612a4c6e1ee5aea12dcc76d27d`；已收文本。
  - `cn.ui.AbyssDetails:anonymous-method-10`；body `8`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/openDetails`；body `9`；code SHA-256 `e4e50796a8508b022a9c3a4942ba205e1377a782308b56bb9de77d827d907218`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails$/<cinit>`；body `10`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.ui.AbyssDetails:AbyssDetails/<ctor>`；body `11`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.ui.AbyssDetails:anonymous-method-0`；body `12`；code SHA-256 `84abbac93fc429c844e6208fe70e38f5c7067a94b0312e00ac0c1861e074303a`；已收文本。

## 11 深渊装备与能力魂副本门控

- 对应目录：[11-abyss-equipment-mode-gate](11-abyss-equipment-mode-gate/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\README.md:11-44；ID、Single/Multi白名单及Lv120例外`
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\patch.py:29-82；最终门控源字符串`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\patch.py` → `11-abyss-equipment-mode-gate\source\patch.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\build_apk.py` → `11-abyss-equipment-mode-gate\source\build_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleCharacterLogic/getAvailableAbilities`；body `92420`；code SHA-256 `9a0fcbbeae31de6293028b437a0716e2d959524544370cf2f7bfa58aef59fd9f`；已收文本。

## 12 深渊纪录保持者昵称

- 对应目录：[12-abyss-record-holder](12-abyss-record-holder/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\README.md:3-11`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\patch_swf.py` → `12-abyss-record-holder\source\patch_swf.py`。
- 最终方法体实证：
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/responseText`；body `1`；code SHA-256 `bd6bdb780750710767f9f6b05cfb6d8bc5f3b12c0285a5364032036e29fd9bf7`；已收文本。

## 13 深渊本期最快纪录展示

- 对应目录：[13-abyss-records](13-abyss-records/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\README.md:1-40`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\patch_swf.py` → `13-abyss-records\source\patch_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\src\cn\ui\AbyssRecordDetails.as` → `13-abyss-records\source\AbyssRecordDetails.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\patch_swf.py` → `13-abyss-records\source\abyss-record-holder--patch_swf.py`。
- 最终方法体实证：
  - `cn.ui.AbyssDetails:AbyssDetails$/openDetails`；body `9`；code SHA-256 `e4e50796a8508b022a9c3a4942ba205e1377a782308b56bb9de77d827d907218`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/formatTime`；body `0`；code SHA-256 `16f6ce4add4ca83d2870f3a1b7b217d99d557ebe3a168bf31706acc79b84b66a`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/responseText`；body `1`；code SHA-256 `bd6bdb780750710767f9f6b05cfb6d8bc5f3b12c0285a5364032036e29fd9bf7`；已收文本。
  - `cn.ui.AbyssRecordDetails:anonymous-method-4`；body `2`；code SHA-256 `f199ce0fe19d0460945228a83f128659c1926af516ca140b1c9657c861fa7628`；已收文本。
  - `cn.ui.AbyssRecordDetails:anonymous-method-5`；body `3`；code SHA-256 `dc36e7c5312991305894e715b2110f511ec8fc3ee7a4b8f3258aad2a26cadded`；已收文本。
  - `cn.ui.AbyssRecordDetails:anonymous-method-6`；body `4`；code SHA-256 `8e728287a9c6352b245d09ce42124084635aba595b668dcceb3058d0be0c5766`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/open`；body `5`；code SHA-256 `39e929fac668eb3611ba416d514a69dfd6179c0719c907bbf93b977dbc4df5fb`；已收文本。
  - `cn.ui.AbyssRecordDetails:anonymous-method-8`；body `6`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/show`；body `7`；code SHA-256 `c4086a61cd284d04b647013927af1fbb06226930445c4b8aeee3c5bfaaf263c6`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails$/<cinit>`；body `8`；code SHA-256 `dee51013bf04e5bd8544837c46f8000e71eee934c53224a90b60150e2e48415c`；已收文本。
  - `cn.ui.AbyssRecordDetails:AbyssRecordDetails/<ctor>`；body `9`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.ui.AbyssRecordDetails:anonymous-method-0`；body `10`；code SHA-256 `ba12d940b8c361ceaf9219504957833f53a7d8bf369fd693ddd5d181b06b1af3`；已收文本。

## 14 标题和游戏内数据继承入口

- 对应目录：[14-account-takeover-entry](14-account-takeover-entry/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:72-91；两方法最终载荷与原生点击逻辑`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\build_apk.py` → `14-account-takeover-entry\source\build_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:MenuTopScene/createMenuListData`；body `77056`；code SHA-256 `628e347f457027585c6e34dc8a57651736f4ed6b1c2be611c1ede2c39e854098`；已收文本。
  - `boot_ffc6:TitleMenuDialogContentView/setupContents`；body `37085`；code SHA-256 `77dcedbfbea53661d3755c303efa7ab2bc8093983c8e6068fb11f439b159db92`；已收文本。

## 15 杰拉尔特克托斩铁准备音扩展

- 对应目录：[15-author-ready-voices](15-author-ready-voices/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\author-content-1043\README.md:12-16`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\author-content-1043\build_swf.py` → `15-author-ready-voices\source\build_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:HudMemberStatus/update`；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`；已收文本。
  - `boot_ffc6:CharacterVoiceLogic/createVoicePathMap`；body `84274`；code SHA-256 `a3f3aa721b20af0547543fb26a0ab4227104248b6aee01289e66fea765dc14d7`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolveFollowingPathCollection`；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`；已收文本。

## 16 可用能力描述缓存

- 对应目录：[16-available-ability-description-cache](16-available-ability-description-cache/README.md)。
- 首发/最终版结论：v17以前；原性能阶段称 R8，具体发布APK编号未核实；R8 算法经 R10 去诊断后，由 v17 原样继承到 v33。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-diagnostic\patch_swf.py:86-88`
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py:85-101`
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\README.md:10-12`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py` → `16-available-ability-description-cache\source\build.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleCharacterLogic/getAvailableAbilities`；body `92420`；code SHA-256 `9a0fcbbeae31de6293028b437a0716e2d959524544370cf2f7bfa58aef59fd9f`；已收文本。

## 17 觉醒任务完成即时刷新

- 对应目录：[17-awake-page-refresh](17-awake-page-refresh/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\awake-page-refresh\README.md:3-17`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\awake-page-refresh\patch_swf.py` → `17-awake-page-refresh\source\patch_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterAwakeScene/applyMissionProgress`；body `67207`；code SHA-256 `25e561de470dab606fa46acc94bb8093d91dc56636f9cabe6273f69e4035e89b`；已收文本。

## 18 编队轮播仅更新当前队伍

- 对应目录：[18-character-carousel-current-only](18-character-carousel-current-only/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\character-carousel\README.md:1-60`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\character-carousel\repack_apk_with_unique.py` → `18-character-carousel-current-only\source\repack_apk_with_unique.py`。
- 最终方法体实证：
  - `boot_ffc6:PartyCarousel/update`；body `66361`；code SHA-256 `335ad9078b65f3819cd64ee926e9f5a52bb89561d2ad5c2723ef9d2f9fc2a20f`；已收文本。

## 19 客户端准入与握手续期

- 对应目录：[19-client-admission](19-client-admission/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\README.md:9-17`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py` → `19-client-admission\source\build.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\src\cn\admission\ClientAdmission.as` → `19-client-admission\source\ClientAdmission.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\author-public-release\prepare_admission.py` → `19-client-admission\source\prepare_admission.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\src\cn\admission\AdmissionSession.as` → `19-client-admission\source\AdmissionSession.as`。
- 最终方法体实证：
  - `cn.admission.ClientAdmission:ClientAdmission$/now`；body `0`；code SHA-256 `97e276a3ed4c4fcccf2b212f6619f2e4f4395eea003ef18b5cc3f9a3c9d58df8`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-3`；body `1`；code SHA-256 `204e6fe8400868d544fb7174a2eef145bf6eadec596da4df794a628ec54abfc5`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-5`；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-4`；body `3`；code SHA-256 `734c611a87932cbcc0c59e64b4e4e80f9b71836e975e2adc64c2b0868478e5b3`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/state`；body `4`；code SHA-256 `ec68b8009829286f1f9bdc695f8bafce6a5bd67bf11d243ccc9ab1f769818f77`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/observe`；body `5`；code SHA-256 `625bb69a6ae976ddf2a25be4da89f606e7461b3cc92ca6ca7bc3a0cd36d23b26`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/refreshSession`；body `6`；code SHA-256 `e3229ea5ad3242195002b91605d8ca95609c338745d89a5a2fe4ba014274639d`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/hold`；body `7`；code SHA-256 `4040161e4de3d334425aeb06f082dc7d0de7c6b7dfdab97392f63883eb2890ad`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-10`；body `8`；code SHA-256 `1097b3d7d90c1d791d8c7feca61fb01e5a8b03f0a2e2b440cc8d489c6e9a9849`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/failQueue`；body `9`；code SHA-256 `cb6a9cf05f3f396cd8040e7eda9e9d416eb4614af4126648e45c567f96ae82bd`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-12`；body `10`；code SHA-256 `c4457758bebbe6c31cc233c87cdf2be9fe6b6336b7978e7fa57801a6e1ab2f07`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/beforeQueue`；body `11`；code SHA-256 `8b0ffcd1ec5f48f50d1c5bbaeb34389e435adb2e2784643ee799dbf239b680ba`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/queueCanceled`；body `12`；code SHA-256 `73c00264be42f8e06a4b59e4ace306826a569ceaa90f761decbe8644f3b15686`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/attach`；body `13`；code SHA-256 `9990f6e9b864e9cfc9aaa24fe58033a46b121a59e30e3e9965c4b01a529eb273`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-17`；body `14`；code SHA-256 `e7a2b7b56f85f2f362f04108193b378fcce556c63a23e87e5e1658a1622d7589`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-16`；body `15`；code SHA-256 `79b15135679a0a3668a7cb632cb772c8d99e70d995c816d72c2ce80c6303ebf8`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/beforeSocketConnect`；body `16`；code SHA-256 `fba17aa746758d590f96197d1b6805b91dad7c6d74ec3af6bd0b71047f142e2a`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/socketClosed`；body `17`；code SHA-256 `a90a66d4c36102e4715300ab178262ed2d8a16c7c16ce6a264702a385d822b01`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/socket`；body `18`；code SHA-256 `745c492994c401a9ada5850c6e01368081e1875b463c1732a8dcd6f46cdf7250`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-21`；body `19`；code SHA-256 `24ab556fa66be165ff3c23f843e14881aecdfe6e25cfdf08a6ddcbcf34f5ab53`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/inspect`；body `20`；code SHA-256 `74ffc49d4fa2df67792dce63f054bc9ca8a0d90183dfcc4f217676037ef2e778`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/forwardAdmission`；body `21`；code SHA-256 `2e438fb4728cdda6cd095102159b2845f00cbea21b7cdd4ef2201a7149b27f33`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/cancelLoad`；body `22`；code SHA-256 `1c78967f567b3419e35d719fcb4374d22d206c33a007dc83a637b7a40e18b7a3`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-25`；body `23`；code SHA-256 `bdcc34080cbb66c7305a88091d42be4538542a51a04561466af9168f3c7f8b97`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-26`；body `24`；code SHA-256 `8230620bee3081b3b611d822f717fa089590b3e9511ea8d38680064ffa6bcfb6`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-28`；body `25`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-27`；body `26`；code SHA-256 `6baf8e462ba41c179b27a07f1287bb7eacf1add34f90414dae8fee545f545f9d`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-29`；body `27`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/load`；body `28`；code SHA-256 `8e98d09dc0c9a26faee11ee52b453b50b0ff8f6f3a2be21ffc419f6c3161be86`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-31`；body `29`；code SHA-256 `b98010f3f8065a40a3dc203c1fba8d9fd7001365b6e2a116eb78aa2f8e36c2a4`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/transport`；body `30`；code SHA-256 `7263a26a1637526c79986ceea8c0101fb31087ab29a27f76d7ec1ba9a4d3c422`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-33`；body `31`；code SHA-256 `2c29176684a3c7eb585190e92927323e52959c75174b26397a57aaee78ff28a2`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-34`；body `32`；code SHA-256 `8f52e784449ba13884bfdf07a18b8b6cb8c7a3d4d2f20bea65bb70055524adc8`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-35`；body `33`；code SHA-256 `7193f08c0ba9ad156a157a0e33c7d07b6a4f5447e6cae8d1a0a8f3e00c327ba1`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/sendAbsolute`；body `34`；code SHA-256 `5b2c44179255fa8e12571fea2577ec5571d1931692f3057ebdc54b3bd49510d0`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/hmac`；body `35`；code SHA-256 `40fbb309abb2da2cef9bbc933c47f2ecf6c85d0f6d171d74a39c41aa12192ece`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/sha`；body `36`；code SHA-256 `7af259c42ff5b9dbcf2ac92aa0a7dede800b3c715f65b4b0411266a7cc8ccf8a`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-39`；body `37`；code SHA-256 `db5e9acbd42a04201faf2252c3fa3289e7f07ced4ac8f981eefb6586851064b8`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/show`；body `38`；code SHA-256 `bfc76919e096d193bfd884cc1be9c17f64583cbb5b2c4d7bda00f15f8e8877fb`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/block`；body `39`；code SHA-256 `35e0d6f62087471395c7644b3d82ba84806ee84d175bfb03ced61e1d1600239a`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/raise`；body `40`；code SHA-256 `8802f50f4aa50e131dfc03dde2c7f1c49bf7031d9df50547771b53c8f034770e`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/<cinit>`；body `41`；code SHA-256 `b113e3feae083e22979f60af0ec362c92b534e08fb9a245846943c4aa1746a7c`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission/<ctor>`；body `42`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-0`；body `43`；code SHA-256 `0c518f21f1ac3db375294c0697fd152da8181f234b3ec07d11905e4b178a0925`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/token|get`；body `0`；code SHA-256 `9b62153c2b2e87cab37852381d51f2fe002818808f527b7d911ecbe4bbca1023`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/session|get`；body `1`；code SHA-256 `136b6d49c5216377e22719f8633702f001771019f7ec31d2cf6c04a025a3193c`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/busy|get`；body `2`；code SHA-256 `b652db1dd1bfc14672523c7b3b9a47b2c694c54d1c0d6442ad3e5c2ad38f2cf3`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/observe`；body `3`；code SHA-256 `bb85d851c1f0c80f70301679c495a02b399d482e3c4b20df9a30293ad53e19d9`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/usable`；body `4`；code SHA-256 `43f3ac3686c8f01969c9b0821195d0d37389fee6b0e1f722e78ed3b73889ab9c`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/allowRetry`；body `5`；code SHA-256 `8d4210d49db5161e1e78fa79cfc84bb38684193b1c1cd8c42cd3a9942d5c160d`；已收文本。
  - `cn.admission.AdmissionSession:anonymous-method-8`；body `6`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/background`；body `7`；code SHA-256 `6d11e9ba59c6a576291585bac57d74fd71aa5c656f5e86116976e03384c12fbf`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/ensure`；body `8`；code SHA-256 `6b35a294d9c7da6093a2287c6662061deffa6ba9743edc3deb77ae3c1befc6b4`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/clearGrant`；body `9`；code SHA-256 `c1d7797ed736bd4738d26d038ae9ecf456fd37f38f9594409d3011f94b047a9e`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/changed`；body `10`；code SHA-256 `f7615ae9e1492affa9b468b7534351d995e8ac809bff91d52ee9d16dd165d717`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/issued`；body `11`；code SHA-256 `a4c3259c6dcb6581236eada1f26159e9b640ddca22c8ff47799275eaab04ed4a`；已收文本。
  - `cn.admission.AdmissionSession:anonymous-method-14`；body `12`；code SHA-256 `e675bd8ed467ada7a01b62e6694049da3dd63ec79a137e3917c1f57fd2799e3d`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/renew`；body `13`；code SHA-256 `b331ed6aba78427495b8e9de63cd8a69e737c6bcc18e3cf818eef64f021c8ea7`；已收文本。
  - `cn.admission.AdmissionSession:anonymous-method-16`；body `14`；code SHA-256 `529c4a5fcf539c2ff10a91d8b677abf67a8c142adbd01f84922f9497ff599dd3`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/handshake`；body `15`；code SHA-256 `7dbd4f2995f8e24bc892f8085cf721ab1def3a8d20fb161e1f40e4b249298914`；已收文本。
  - `cn.admission.AdmissionSession:anonymous-method-18`；body `16`；code SHA-256 `bdac41bb049b25e728223bbbf545b92be1b706014d649c87368a560de7002504`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/rebind`；body `17`；code SHA-256 `95bf7fc4b82046d13d1a7ae53e24899ff3238b436e47df51a02f6a41ff235a42`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/finish`；body `18`；code SHA-256 `77bd39065f7e5411418c5ae5e6b8f74bb8a9f4166d7d826785d39381e1fd5ff3`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession/<ctor>`；body `19`；code SHA-256 `65a6e7e557cd9c3193405e3764a9b7ccd8f4271a0db63f827867aab5bea77869`；已收文本。
  - `cn.admission.AdmissionSession:AdmissionSession$/<cinit>`；body `20`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.admission.AdmissionSession:anonymous-method-0`；body `21`；code SHA-256 `9a881061c2aae37b9a9ddb0c9bdf7dfb48ec72889d83f62283564996de7769f8`；已收文本。

## 20 普通伤害类型完整转换（424 与 DSL 标记）

- 对应目录：[20-damage-type-conversion](20-damage-type-conversion/README.md)。
- 首发/最终版结论：未核实（v17 已含；2026-09-24 客户端规则补丁已出现）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:55-78；完整转换、边界及 getter 通路`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\damage.py:10-95；最终 P-code 生成源`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\wf_damage_type_override.README.md:4-21；检测器与 canonical 源位置及原有方法哈希`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\wf_damage_type_override.README.md:23-40；分类语义和交互`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\patch.py` → `20-damage-type-conversion\source\patch.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\content.py` → `20-damage-type-conversion\source\content.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\damage.py` → `20-damage-type-conversion\source\damage.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py` → `20-damage-type-conversion\source\gauge.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\provenance.py` → `20-damage-type-conversion\source\provenance.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\core.py` → `20-damage-type-conversion\source\core.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\verify.py` → `20-damage-type-conversion\source\verify.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\baseline.json` → `20-damage-type-conversion\source\baseline.json`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\build_apk.py` → `20-damage-type-conversion\source\build_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:Environment/getBuffTargetAs`；body `52614`；code SHA-256 `3534ccee67770f7f2f581051c53c7b13f35f0bb75a80a13fe4390d0a2bf5cfa1`；已收文本。
  - `boot_ffc6:ImpactSourceContent$/NormalAttack`；body `58980`；code SHA-256 `9377796ffd220380cded6ada63de54f50534596bb67bd8586f4a57cd15caf50a`；已收文本。
  - `boot_ffc6:MemberImpl$/wfConvertNormalAttack`；body `92442`；code SHA-256 `d75e6f800238961f51ba118216857f320303362ec5a6bfec1c87054bbac39bc0`；已收文本。
  - `boot_ffc6:MemberAbilityTotalizerImpl/wfResolveDamageType`；body `92441`；code SHA-256 `13482a0345ec249255960ba143f1abf5c85843ecbf27273f383795e4d9555c75`；已收文本。
  - `boot_ffc6:AbilityValues$/parseAt109`；body `39060`；code SHA-256 `3e42c85d4ee45ce33be9a7aec70e350a2303ce3cb7132dd0e8183c02310516eb`；已收文本。
  - `boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues`；body `13253`；code SHA-256 `7a5349a32a8335817281b9bb9b52f345dec5c26aa56333e27209472fe0aed46f`；完整文本超过上限未收。
  - `boot_ffc6:MemberAbilityTotalizerImpl/addDuringContent`；body `51979`；code SHA-256 `a05011f9959b625d0744ca20bf2c65dec54440e9652f13cdd43a9cc8bc723138`；已收文本。

## 21 ModDualForm特殊动画切换

- 对应目录：[21-dual-form-animation](21-dual-form-animation/README.md)。
- 首发/最终版结论：v17以前；具体编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch-manifest-pure-pcode.json:8-29`
  - `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch_pcode.py:239-330`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch_pcode.py` → `21-dual-form-animation\source\patch_pcode.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\pcode_tools.py` → `21-dual-form-animation\source\pcode_tools.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch-manifest-pure-pcode.json` → `21-dual-form-animation\source\patch-manifest-pure-pcode.json`。
- 最终方法体实证：
  - `boot_ffc6:MemberView/draw`；body `60616`；code SHA-256 `f32bfe1956a9d8b906987ad12d8b349c908f5cbf7b4ac8f76a8a7ae9b7b1bc8e`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolvePathCollection`；body `92329`；code SHA-256 `4be465684a1346a539ccdcc65221ea64a875fdc0e3ebcd93bb16d47b185b7e93`；已收文本。

## 22 空更新兼容与账号切换偏好保留

- 对应目录：[22-empty-update-and-preferences](22-empty-update-and-preferences/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\README.md:1-50`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py` → `22-empty-update-and-preferences\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\src\cn\asset\EmptyUpdate.as` → `22-empty-update-and-preferences\source\EmptyUpdate.as`。
- 最终方法体实证：
  - `boot_ffc6:AssetGetPathRealRemote/successHandler`；body `47777`；code SHA-256 `1b4ba31b15628d5eab11d6b6f535327277d2d8e507f564da8153871e17bbeb28`；已收文本。
  - `cn.asset.EmptyUpdate:EmptyUpdate$/normalize`；body `0`；code SHA-256 `d63a38e092207419f21092ef1fd670c1fa68e36444525f7b2393d1fcf5116a1e`；已收文本。
  - `cn.asset.EmptyUpdate:EmptyUpdate$/empty`；body `1`；code SHA-256 `a5ba2f7ce1c194aa907d67f12d5c645ed33f35b557f370ab225e5755db216c14`；已收文本。
  - `cn.asset.EmptyUpdate:EmptyUpdate$/<cinit>`；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.asset.EmptyUpdate:EmptyUpdate/<ctor>`；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.asset.EmptyUpdate:anonymous-method-0`；body `4`；code SHA-256 `d0dce5d8c73a9148a052376abb9845c39f0347fcba75264049e27b270ded94e1`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-2`；body `0`；code SHA-256 `bd6a7565cfed4142fc5b0a699b31d018c8ccacf19c2bc4f3a19fb28cfb722e0f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-3`；body `1`；code SHA-256 `4ff73de7e1851205d648dc81bb4d16c19fba4719b0e63908fc434fcbbc34cca0`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/title`；body `2`；code SHA-256 `803bf50e692ea1f93a972c08760f8649e0668bfe4751d00f0968552db63f6eb4`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/readStoredRecord`；body `3`；code SHA-256 `3011006461044d70b121708baec9a4363beafabd85bd5e3596a7ace6d0b39aa4`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/start`；body `4`；code SHA-256 `8cf30674fac365ca39f39a63ffd1e84888a17dbd98b88bd3562ab380136bfde1`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/attach`；body `5`；code SHA-256 `29fafac5c6c566d51efd5c4a1a9f62982314a984292efe77fa5b17a1723e4c9b`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/socket`；body `6`；code SHA-256 `9607b48cf6a34d9143e33f421e7638ce221a32badb7d518f6ccb9d6d012f4df5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/dispose`；body `7`；code SHA-256 `b688df737b5709ff041b4a2ccc81d5f4d515a98196b2ecf460342536ba6d690f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-10`；body `8`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-11`；body `9`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-12`；body `10`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-13`；body `11`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-14`；body `12`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/show`；body `13`；code SHA-256 `fb190df232e18a890598a6538a36990016b5f8ceed4260a443e60fdf1a077584`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/detachBackGuard`；body `14`；code SHA-256 `ef6630e6c1a3cc740802234dcff735068d6b0b603d533dc5b72b822a36753a78`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/guardBack`；body `15`；code SHA-256 `918432dfc55d64b14363b02889d361bdc2ce2c065c725f15fc924d2a8eb62998`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/clearLiveSession`；body `16`；code SHA-256 `1b62491b67aef18ed65f966970f2ace7214678f574a5cff5d3cf9af845228868`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/findEntry`；body `17`；code SHA-256 `c46784a6f1de8d73f578d00ab814dca465678db93d0b6d2405bb6a6287936212`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/loadAccounts`；body `18`；code SHA-256 `27019d04bf6d591bd53ee9ca2e6fecb4c4632bf509b1f528127801fc4e1f8002`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/persistAccounts`；body `19`；code SHA-256 `90399b76f7d0fa1593b054123860151537c08513191813cd409d87c29cc68454`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/storageStatus`；body `20`；code SHA-256 `061341abe1b924cb7bd3bb8bba59949a4eb0d323bf723942795c71e0e55691c7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-23`；body `21`；code SHA-256 `81e34c90a350c6a43354af20f5d245dddc1d266d0a8c6fb7771f346ef4031569`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/resumeEntry`；body `22`；code SHA-256 `785dcd6ff95295a35dfed3a795f6ebdc646f987fddd0a1579fcb70ffde5f1ff5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/invalidateEntry`；body `23`；code SHA-256 `6bcb6523745137640ba59a9fda2d7bbfe319e8aa6f999bca339c82d8da792c6f`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/accept`；body `24`；code SHA-256 `d5ba21746d0e2d10e448f4b85a463160f6c261709e7226fa9334987197b0f518`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/switchAccount`；body `25`；code SHA-256 `ea8ac8549f7c4239f0d0c76685861ca5357ff110ef05d53d35993d3161fe1002`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/removeEntry`；body `26`；code SHA-256 `c0faa766888c21206bd9df439383a076309e52840aed20c00979f57997f6ac86`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/continueGame`；body `27`；code SHA-256 `b68897a92a08bd3adee9708b7c3a4a6e3a31cd2459559917f144638219f87d1e`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/navigate`；body `28`；code SHA-256 `9ddc02859d364a94ac9ae624f6217b833aa3005c94f4f5d9c565904d7c1c870c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-31`；body `29`；code SHA-256 `7fecea38dd3896bf87e351c0f03212063b0ed353d273a2195a0aab61d2b2f8c2`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-32`；body `30`；code SHA-256 `8d9076abf1c292288254240faf1e45b57c12d1877eff5ad2b02d8e174b556651`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/detectLocalSave`；body `31`；code SHA-256 `fd580e57b0855836ac6df4f9870e03c9ba86454c92a4fe114be61e3930e6e447`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-34`；body `32`；code SHA-256 `97aa21983897fc990c30c4a69395436a7cba733bc0147e26cd774d14a90edf13`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-35`；body `33`；code SHA-256 `45644a0b3482a3000188042a7f43468db9acadec94be747ff3526d0d4cdb5b5c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-36`；body `34`；code SHA-256 `ee8b4daf99e9d1a96b24f4a1f4df38e74a55bd7560086f1e5f5f9dd04d6754bf`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-37`；body `35`；code SHA-256 `3abbfe05707156b6d1d4bd902f16b6e5f9a10836b973f00e4d57a7e6197925e0`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-38`；body `36`；code SHA-256 `610e0b45ac711297858b377ca2756302784234c86f82053ebba810e5e0f5c2d5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/request`；body `37`；code SHA-256 `5a89ee133b9ea7f4d97cdfe39d09675480b32d021110e9a58ef45a433b28c315`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/cancelNetwork`；body `38`；code SHA-256 `ea7bb63812fc4e12a85994b9e8077f753173637f8fce9915d1ab3abca74e04cc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-41`；body `39`；code SHA-256 `e85edae24999d4281d6c29833b707d87a87faa5765e71a9795c9b2410bad9785`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-42`；body `40`；code SHA-256 `d77582a5e73db9aaee5c985b62abe0bd5e2b0cb6301619fb2a5b635e04242b43`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/submit`；body `41`；code SHA-256 `9f4fc36de1908a5a032e7535817bb615213f7b38269395be3c54a0d7a9d7ffc4`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-44`；body `42`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-45`；body `43`；code SHA-256 `0d0eced91e1e96790ed0aed5cd51afc8ae43a24497af0a48552a6b87b4f3153f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-46`；body `44`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-47`；body `45`；code SHA-256 `216e5ddc4034c8bb8d3063d58c54220b8ed2c6343f5a6a2e0555606d45da3dbc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-48`；body `46`；code SHA-256 `575f08740cfa89112e68efa5872ae18e76b67c796f8e298340709c36aeb96ed0`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-49`；body `47`；code SHA-256 `f908ec72ff40a13cdf6d873c6a54564c919b56b8c3e2616d87aa38d6fe3215d7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-50`；body `48`；code SHA-256 `8da3fa085fe7c5e9bbc511925d3365e3d74ef4ea64b2ea149e6b23c7716f6009`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-51`；body `49`；code SHA-256 `b45d878e8649a852e9286daa5142951e70eb016a83b5ff577da8a613e5f2bff2`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-52`；body `50`；code SHA-256 `9bf13cf33328f7a01e3a811a97782463228dcbf2f187dda63bdcb0c2728fb09e`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-53`；body `51`；code SHA-256 `051f279231f1009b4bf9a2a63a75f5921c2f671db98879ced2a37f0ffd665d61`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-54`；body `52`；code SHA-256 `a010875f9cd0c61f307b83476eb6985ed95776a0091b1c87e261a61b462e172d`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-55`；body `53`；code SHA-256 `7390cfcd0761681db5df96bd733889a32352e7eadc4a15e32715ce3f307c7783`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-56`；body `54`；code SHA-256 `193335d671cb1d17fb3582038efc4bde269da02417ed22318099b1c66dd2e31c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-57`；body `55`；code SHA-256 `c7835be95ad5b21a3790acb5c2ac873847276217388b960cfce37bacca61fa88`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-58`；body `56`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-59`；body `57`；code SHA-256 `3fb57d7fbdef07fc874e9833703993c800e985a69dbd15c9b14d2302d504ee2b`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-60`；body `58`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-61`；body `59`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-62`；body `60`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-63`；body `61`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-64`；body `62`；code SHA-256 `240d4eefbbb3c79029e1fd538a59b603947a6603f6e6f98193e45dde300a6da7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-65`；body `63`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/render`；body `64`；code SHA-256 `8c5b13b79a33ec3ca51ae28695bdca9dc90f22e29c8f1e9444fbd7bf1bb40d9a`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/expiryLabel`；body `65`；code SHA-256 `00bab8214b964c4d66f81c2506ef7b7355739dceb9fa55500db7087ad2fc916e`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/wrappedLabel`；body `66`；code SHA-256 `ccb0c76428177e31d51333a53c45fe7b41e07bccd83c2dd63bea66c066276e52`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-69`；body `67`；code SHA-256 `871e799be5250427914150faffdeeeb84fb5294430e01a1c6aa50079478f6620`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-70`；body `68`；code SHA-256 `eb40bef7a0aea2f69bd09fa75ecdc8c80e8e88269f2525c7c2cf87c446144d2d`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/accountRow`；body `69`；code SHA-256 `4dbd55b18cc9e9b4caf0e38954d97db01cabec3a0d50ad50828b3f5d50baafbd`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/resize`；body `70`；code SHA-256 `5ad84a0574cad13f67ca23215ba62f4f4c0f472b945b48f55e551a47aa3ef4da`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-73`；body `71`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-74`；body `72`；code SHA-256 `0197753d0e9812b3f45bcb8f999a18ce4b1d339812f5ea145bd96cefe7724c3d`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/tabs`；body `73`；code SHA-256 `4068318d6e65a9465852904f333d0b8829c11b8bf644650299c1ab6c3a6bdea5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/playerCard`；body `74`；code SHA-256 `169790c429217a91e7422472a06e62f633b62cb44d9fed683fe7e4ca8a19adff`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-77`；body `75`；code SHA-256 `851e464025009e602002998346d59cd5bfc301855adca0fbc5902019dcf51512`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-78`；body `76`；code SHA-256 `4418daba7d453a3ce3c22830c5dbf1cac5caf7002078807adb4fb95bc7d3b127`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-79`；body `77`；code SHA-256 `175996617a13da655722071ef237c96f77c2dcc8eca0d254b489d7c540c7e4f9`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-80`；body `78`；code SHA-256 `44cca709b4544cffee7ed8e47d3be804ed31d0f233cd5094f4d0da910787d57a`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/input`；body `79`；code SHA-256 `065e4c969c2c6071f46e7df8e1fe80260920d4ea9ea5e327c64092e07a321fbd`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-82`；body `80`；code SHA-256 `98b32818b9107c82c4bdb413e21fb328f3a20ead723c88f1c1e1a6ccb8775a46`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/checkbox`；body `81`；code SHA-256 `34c53e9f53372d02f38ca8640010d7a70d000390c076041e3c4bea8a8ae2e311`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-84`；body `82`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/button`；body `83`；code SHA-256 `da3d7b0dfe4a1246f652407a9efdc0f2d78e9d8cbbbd2eeb8b6206f0535e8d47`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-86`；body `84`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/link`；body `85`；code SHA-256 `ba91dc18405531df9326e3cdcfdd156e52940b11ef19c31e02d22abb7edd62ae`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/label`；body `86`；code SHA-256 `1459c3b464ff6e800621e2e30832f500a1cad39eee9ce5c50fedbb678ad10cdb`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/rounded`；body `87`；code SHA-256 `3027be937c36d30681bbe37e269ee7c3958c5a8e788effd72861e9a877956de2`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/line`；body `88`；code SHA-256 `17248c1be261d0720a07c50ca5f74adf4faf11b7b6c07cae067ea19b458908ab`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/badge`；body `89`；code SHA-256 `93e2db8d9953fef8391b9c5a9a0c46d90d435cc687f37be62c87e44326e0712c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/<cinit>`；body `90`；code SHA-256 `13b3c1289ac932eda376540011233d08a3397e22ce849253e9e4b5331dc35a57`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin/<ctor>`；body `91`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-0`；body `92`；code SHA-256 `6c73681b8c49cc4aec2b71ff2f72b1beffb2b73827b1d01b2632a2b74a1346d0`；已收文本。

## 23 幻想装备缩略图预加载

- 对应目录：[23-fantasy-equipment-thumbnail-preload](23-fantasy-equipment-thumbnail-preload/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:59-61；Android 幻想队伍/装备图标缓存和生命周期修复`
- 已收源与构建文件：
- 最终方法体实证：
  - `boot_ffc6:GlobalAssetPathCollectionBuilder/leadingLogicLoadedHandler`；body `92264`；code SHA-256 `351374e5297daca7743cb3b774a16e032ad205822181785b7d6c254625a812f2`；已收文本。

## 24 幻想连战多人阶段准入与战斗路由

- 对应目录：[24-fantasy-rush-multi-routing](24-fantasy-rush-multi-routing/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:51-61；Android V51 已有幻想活动路由/战斗门控并受后继方法保护`
  - `D:\WF\startpoint-cn-kulo\client-patch\ios-five-in-one\README.md:8-10；跨端文档描述第5/10/15阶段房主/访客流程，仅作用途交叉来源`
- 已收源与构建文件：
- 最终方法体实证：
  - `boot_ffc6:AdventEventQuestLogic/isViewable`；body `91897`；code SHA-256 `8798d2e905f224a0af773692342b2e40a8c869bad76520b7aec0ab605b47a9d4`；已收文本。
  - `boot_ffc6:AdventEventQuestLogic/isSelectable`；body `91898`；code SHA-256 `fa30506f61f35800ca78a3c9070406adf9322ea7df3e5f06d4476a8f096bca7b`；已收文本。
  - `boot_ffc6:AdventEventQuestLogic/isRequiredHostClearFromOtherQuest`；body `91899`；code SHA-256 `93d440800eca6bf9d9281c98dbfb1132f2e4853bb124b1b73b8c292e75846765`；已收文本。
  - `boot_ffc6:BossBattleModeSelectScene/prepareScene`；body `91926`；code SHA-256 `a68d3be29d63c16ea97129b04e080ce9b56c9d50fa5aaa8210839c92cf58afcf`；已收文本。
  - `boot_ffc6:BossBattleModeSelectScene/isFantasyRushBossQuest`；body `91927`；code SHA-256 `498f61fe586f70bf4169bd100373135748e0cde9de7b03148d9a1d8c10c89848`；已收文本。
  - `boot_ffc6:BossBattleModeSelectScene/startFantasyRushMultiBattle`；body `91928`；code SHA-256 `f6034f2437ce5ea49cf919a4f5e89d3bd1cf4dbe24ed66056f4c437379119284`；已收文本。
  - `boot_ffc6:SingleQuestStartFlow/start`；body `91951`；code SHA-256 `bcba39e333edb74276821d1b37ba89eed26e6e6378daccf5e39634be6b621525`；已收文本。
  - `boot_ffc6:PartySelectScene/run`；body `91975`；code SHA-256 `e7e852be6d1763117e4a1adf4be9d4a9d7fe043789525c650fa23e1d1a0f5570`；已收文本。
  - `boot_ffc6:RushEventQuestSelectScene/startQuest`；body `92050`；code SHA-256 `a48f031b6b87320a16c11ebf44194036dfdaa13310e1d7ce42591bbcc0f27100`；已收文本。
  - `boot_ffc6:RushEventQuestSelectScene/selectQuest`；body `92051`；code SHA-256 `4caa158cb310699932c3b816cab07537c0a80e7ce6610c861c77458bd832d912`；已收文本。
  - `boot_ffc6:MultiBattleRoomPrepareFlow/sceneChangeToRoom`；body `92034`；code SHA-256 `a366ee6fae39650e5796c50eb9260f9897ad11f410fabaf60958310c3a857124`；已收文本。
  - `boot_ffc6:MultiBattleRoomPrepareFlow/createRoomNotFoundDialog`；body `92040`；code SHA-256 `46614ab0ff0cc8024bcd42740c25a87edd36a84c07474e629d1f8cbf5fb45c23`；已收文本。

## 25 幻想连战多人结算及房间返回

- 对应目录：[25-fantasy-rush-result-return](25-fantasy-rush-result-return/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:51-61；Android 已有结算返回、后继保留`
  - `D:\WF\startpoint-cn-kulo\client-patch\ios-five-in-one\README.md:8-10；阶段边界与房主/访客返回用途交叉来源`
- 已收源与构建文件：
- 最终方法体实证：
  - `boot_ffc6:RushEventClearRewardDialog/isFantasyRushMultiBoundary`；body `92027`；code SHA-256 `b7cfdf3e1f68a165c20fd9489fdd79ba38d2e6842381591d9b6fedfb2632bac6`；已收文本。
  - `boot_ffc6:RushEventClearRewardDialog/prepare`；body `92020`；code SHA-256 `5d7d494c8e26583e4cd57fd9f4f697e75ed844f007d8f5eceb9b7347945c51dd`；已收文本。
  - `boot_ffc6:RushEventClearRewardDialog/completeAnimation`；body `92028`；code SHA-256 `7170673e44810492c9e71df0b37a2e0d449aeaf07449196cb27efc8037627159`；已收文本。
  - `boot_ffc6:RushEventClearRewardDialog/buttonClicked`；body `92029`；code SHA-256 `79b8a9a2bd998dfc8d1cac0d70de095f1a1f93501f81e1213d392be727743897`；已收文本。
  - `boot_ffc6:MultiBattleRoomScene/releaseOpenMultiRoom`；body `92123`；code SHA-256 `d5b821ff85589b2c487578c9c78fcfb994ccc9c2f30123cd40c63d826a2d0bec`；已收文本。
  - `boot_ffc6:MultiBattleRoomScene/BackChangeSceneHandler`；body `92170`；code SHA-256 `aaa3efba659d97818783b8c4ddc315cf0e5be1b6736ace521719074797f9d512`；已收文本。
  - `boot_ffc6:CooperationRoomSocketContact/disband`；body `92201`；code SHA-256 `c7935d4a4e56433f8786272af58181783f59809b2c3bec13f04ddc8d26d14333`；已收文本。
  - `boot_ffc6:CooperationRoomSocketContact/applyDisbanded`；body `92204`；code SHA-256 `df4212688f576811207ec47b4ccb6092b71a8f7ed5ede87d49cfaaedfe7e9099`；已收文本。
  - `boot_ffc6:CooperationRoomSocketContact/<ctor>`；body `92207`；code SHA-256 `fe543cc8ab0437439839e6f8279fd128b6804febde07c7ad95e349cfb7bd2ea0`；已收文本。
  - `boot_ffc6:QuestResultScene/isFantasyRushMultiContinue`；body `92218`；code SHA-256 `00bfca84e55d28ddce405e043f1535340d82b46abab71cc0fca61741306902bd`；已收文本。
  - `boot_ffc6:QuestResultScene/retryQuest`；body `92220`；code SHA-256 `f7bae59bbdb490df9ca1b5f6df7800efa170c1b6d85d7fef3c7732591a8f59df`；已收文本。
  - `boot_ffc6:QuestResultScene/finishQuestResult`；body `92253`；code SHA-256 `b144c1e4dfd056de5a80ca59dc0cdbef7371379d18e199a8dd891b9952dfd1ac`；已收文本。
  - `boot_ffc6:QuestAbortTransitionRouter/resolve`；body `92268`；code SHA-256 `4c6a45128864164527a3c5d004034ba4251b75611a0731df4ee325077be6cbe5`；已收文本。

## 26 幻想能力魂图标异步纹理加载

- 对应目录：[26-fantasy-soul-async-texture](26-fantasy-soul-async-texture/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:59-61；Android 已有队伍/装备图标缓存和生命周期修复`
  - `D:\WF\startpoint-cn-kulo\client-patch\ios-fantasy-soul\README.md:1-3；明确移植 Android 已有策略与问题码`
- 已收源与构建文件：
- 最终方法体实证：
  - `boot_ffc6:PartyCarouselAbilitySoulView/present`；body `92077`；code SHA-256 `7a5338b2abf272abb008d136064ddc8ae56254ed14655e3f0e286c191e08e369`；已收文本。
  - `boot_ffc6:PartyCarouselAbilitySoulView/fantasySoulTextureLoadCompleted`；body `92078`；code SHA-256 `3c83174b5f677e48f5438185416ceac9547e69a3a7e3cfe3fc2f83e418526dc1`；已收文本。

## 27 五重联机手动开局 Auto 锁及暂停状态

- 对应目录：[27-fiveboss-manual-auto-lock](27-fiveboss-manual-auto-lock/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:40-43；最终范围`
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py:246-285；定点插入锁初始化、切换守门与暂停菜单`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py` → `27-fiveboss-manual-auto-lock\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json` → `27-fiveboss-manual-auto-lock\source\method-plan.json`。
- 最终方法体实证：
  - `boot_ffc6:BattleScene/preparation`；body `28963`；code SHA-256 `45b02faa310bc154d58ce2e1faf3271204c39e9ce5d67b174d1c1c717ff4c160`；已收文本。
  - `boot_ffc6:BattleScene/changeAutoplayMode`；body `29002`；code SHA-256 `b73d7228d948edd41a830651a7c8a835fa13b2c0f73142ae61b9dcd976c86e3c`；已收文本。
  - `boot_ffc6:BattlePauseMenu/prepare`；body `32286`；code SHA-256 `22967194267098e2e0b666eb95c149e133a9cdd44a46866bf6efe61227904334`；已收文本。

## 28 五重随机地图与联机房号种子

- 对应目录：[28-fiveboss-random-map-seed](28-fiveboss-random-map-seed/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:39-43；三地图方法与六helper、房号种子和普通分支`
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json:319-373；三 replace_methods 与六 new_methods 精确类方法`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py` → `28-fiveboss-random-map-seed\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json` → `28-fiveboss-random-map-seed\source\method-plan.json`。
- 最终方法体实证：
  - `boot_ffc6:BothBossTool$/mapBoss`；body `50988`；code SHA-256 `4f7be710e2c1d4a1e57a818f9176d4e7bfeecd0a4c9ebf4d7db1dfde6755d8cb`；已收文本。
  - `boot_ffc6:BothBossTool$/bothBossMap`；body `50998`；code SHA-256 `85ae58d54e427ea926fd838dc3cacf8d2c316a858fac8c96d6d51321f8597f4e`；已收文本。
  - `boot_ffc6:BothBossTool$/bothBossMapSingle`；body `50999`；code SHA-256 `b7affd6ee25203b61f8137a1f3d082b98f9a707d8a09a57c673cc87d0644e60c`；已收文本。
  - `boot_ffc6:BothBossTool$/isRandomMapQuest`；body `92434`；code SHA-256 `e84bc0b0fe0b4b3e90dba190809ba2a78af89a981e68babba8aec7a696bfa7eb`；已收文本。
  - `boot_ffc6:BothBossTool$/isConditionalRow`；body `92435`；code SHA-256 `7db4961886739d9c8695feace54846431831a2bea366d8aefa0a4cfe8de848ec`；已收文本。
  - `boot_ffc6:BothBossTool$/mapSeed`；body `92436`；code SHA-256 `b5942a1f7195ca7d566fc7aa8805814d450a8b45d51b1f736336329b3a93709e`；已收文本。
  - `boot_ffc6:BothBossTool$/singleMapSeed`；body `92437`；code SHA-256 `1f51b372b44a7fed9ef03abf84eb8fd950284cf8d7f5a6d98caccaf557395581`；已收文本。
  - `boot_ffc6:BothBossTool$/randomIndex`；body `92438`；code SHA-256 `730d28453db5beaf32c3483afd615930af4fe9b0819483fa9081d32fd70aac89`；已收文本。
  - `boot_ffc6:BothBossTool$/pickCandidate`；body `92439`；code SHA-256 `2d5831ea25c4c78fb546c04ed0e6c7cfd709b41a4c32b1cfce7890ef92ea37de`；已收文本。

## 29 5900101 禁五星铁钢替代觉醒材料

- 对应目录：[29-fiveboss-weapon-no-steel](29-fiveboss-weapon-no-steel/README.md)。
- 首发/最终版结论：v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:11-15；单方法最终限制`
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\fix_weapon_steel.py:20-38；5900101 返回 Option.None 分支`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\fix_weapon_steel.py` → `29-fiveboss-weapon-no-steel\source\fix_weapon_steel.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\package_steel_fix.py` → `29-fiveboss-weapon-no-steel\source\package_steel_fix.py`。
- 最终方法体实证：
  - `boot_ffc6:OwnedEquipmentLogic/getUseableAwakingCrystal`；body `19690`；code SHA-256 `fe1599d83a31b5229bbe7532248035500177e33b63f889aa66c72f15979f722f`；已收文本。

## 30 无效回槽演出提前拒绝与规则筛选优化

- 对应目录：[30-gauge-effect-guard](30-gauge-effect-guard/README.md)。
- 首发/最终版结论：未核实（v17 已含；源候选日期 2026-09-25，资源版本 1.4.1044 不是 APK 版本）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:45-53；问题原因及两方法性能补丁`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py:19-40；仅正向、恢复上下文`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_perf_overlay.py:13-59；两方法限定和原指令可还原检查`
  - `D:\WF\out\月兔回槽性能与狮子PF点火-20260925\增量包\改动说明.md:5-14；原始问题与未做原队伍实测的边界`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py` → `30-gauge-effect-guard\source\gauge_effect_guard.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_perf_overlay.py` → `30-gauge-effect-guard\source\gauge_perf_overlay.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py` → `30-gauge-effect-guard\source\gauge.py`。
  - `D:\WF\out\月兔回槽性能与狮子PF点火-20260925\build-apk.py` → `30-gauge-effect-guard\source\build-apk.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/applyInstantAbility`；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`；已收文本。
  - `boot_ffc6:MemberAbilityTotalizerImpl/wfBlocksGauge`；body `92443`；code SHA-256 `c00c039ed5450963581587afefb79a4e0e8185bba082a0f95677263e9a510e37`；已收文本。

## 31 通用回槽来源限制（423）

- 对应目录：[31-gauge-gain-rules](31-gauge-gain-rules/README.md)。
- 首发/最终版结论：未核实（v17 已含；源补丁于 2026-09-24 出现，不能把日期当 APK 编号）；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:7-10；VerifyError #1021 原因和 v3 修复`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:12-43；423 来源筛选和保留行为`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py:9-75；最终规则与入账守门`
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\provenance.py:101-121；来源快照与上下文恢复`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\patch.py` → `31-gauge-gain-rules\source\patch.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\content.py` → `31-gauge-gain-rules\source\content.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\damage.py` → `31-gauge-gain-rules\source\damage.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py` → `31-gauge-gain-rules\source\gauge.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\provenance.py` → `31-gauge-gain-rules\source\provenance.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\core.py` → `31-gauge-gain-rules\source\core.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\verify.py` → `31-gauge-gain-rules\source\verify.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\baseline.json` → `31-gauge-gain-rules\source\baseline.json`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\build_apk.py` → `31-gauge-gain-rules\source\build_apk.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py` → `31-gauge-gain-rules\source\gauge_effect_guard.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/addSkillPoint`；body `60573`；code SHA-256 `17616e77a698088c7c5eccebfdfb6aae6b8a1690bd259e2dfc29b11d0f32ecff`；已收文本。
  - `boot_ffc6:MemberImpl/reserveSkillPoint`；body `60198`；code SHA-256 `6fe9817a84ad66ca0cdeaed697b1e984f3953b78dcea0ef76e6de6b35e16c1f2`；已收文本。
  - `boot_ffc6:MemberImpl/reserveFixedSkillPoint`；body `60199`；code SHA-256 `9f3fd6bcafcc769b93d53cc7033e2aaa516f578872a4519419a9819fc1aa0a61`；已收文本。
  - `boot_ffc6:MemberImpl/applyInitialSkillPointRatio`；body `60553`；code SHA-256 `45aa616e249da0d1f7906ec9b148fad7664130d2c90adcf39a18bfc7cdffe87c`；已收文本。
  - `boot_ffc6:MemberImpl/move`；body `60211`；code SHA-256 `254bfe6d69423f5c40c6f47256d92ed4dd4b370e8503eae12d9659241a05dac5`；已收文本。
  - `boot_ffc6:MemberImpl/wfAllowsGauge`；body `92444`；code SHA-256 `c0767e932272aed7021d42cba1bd0a3d46e6f7a6848d93cc3a46af018bfefae4`；已收文本。
  - `boot_ffc6:MemberAbilityTotalizerImpl/wfBlocksGauge`；body `92443`；code SHA-256 `c00c039ed5450963581587afefb79a4e0e8185bba082a0f95677263e9a510e37`；已收文本。
  - `boot_ffc6:MemberImpl$/wfGaugeFromAddress`；body `92445`；code SHA-256 `7014ebb423883d75b41b1ae2500889f6376b579520e957ac859bd45481f17436`；已收文本。
  - `boot_ffc6:MemberImpl$/wfGaugeFromAction`；body `92446`；code SHA-256 `8a388cec98cec7c6d1722010b889c9e53b67a32911ac1b745df57839760e2c90`；已收文本。
  - `boot_ffc6:InstantAbilityAddress/<ctor>`；body `44967`；code SHA-256 `0cc2af56cd2dccbeb11bd1a15f8d276c662dd103ad3b3f1a2294f0d054f2e4e0`；已收文本。
  - `boot_ffc6:InstantAbility/<ctor>`；body `51841`；code SHA-256 `2443e534a28afc075bbbbc5f65090458114422da74425dce893a5495a00868bb`；已收文本。
  - `boot_ffc6:AbilitySlotImpl/applyInstant`；body `51426`；code SHA-256 `2e0ad12bc7b99ee1adf36fba1bebb62883b95684a430bb77fde4af08c912807c`；已收文本。
  - `boot_ffc6:MemberImpl/applyInstantAbility`；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`；已收文本。
  - `boot_ffc6:ActionEvaluator/evalCommand`；body `52284`；code SHA-256 `740d1da65f427f1fd65adb18261d71d333a8e0b8ebe5142299abf266121e9b14`；已收文本。
  - `boot_ffc6:AbilityValues$/parseAt109`；body `39060`；code SHA-256 `3e42c85d4ee45ce33be9a7aec70e350a2303ce3cb7132dd0e8183c02310516eb`；已收文本。
  - `boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues`；body `13253`；code SHA-256 `7a5349a32a8335817281b9bb9b52f345dec5c26aa56333e27209472fe0aed46f`；完整文本超过上限未收。
  - `boot_ffc6:MemberAbilityTotalizerImpl/addDuringContent`；body `51979`；code SHA-256 `a05011f9959b625d0744ca20bf2c65dec54440e9652f13cdd43a9cc8bc723138`；已收文本。

## 32 稻穗能力攻击视觉与预载

- 对应目录：[32-inaho-visuals](32-inaho-visuals/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\author-unified-damage\README.md:7-10`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\final_coverage_check.json（本次最终 helper 逐方法核验）`
- 已收源与构建文件：
- 最终方法体实证：
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals$/preload`；body `0`；code SHA-256 `c7b3e8879db4e421c24d024a8a8728d2691947607e54f84ad3b835acaf619d16`；已收文本。
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals$/shot`；body `1`；code SHA-256 `5e96be34ca2b05298be3f4e942f7da7d70596b0c8ced94f34a936f1836eef507`；已收文本。
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals$/hit`；body `2`；code SHA-256 `059ed57a965af38e53d3eff5019be03a4dca66e7193efe2ea6cbb3a6004476fc`；已收文本。
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals$/isInaho`；body `3`；code SHA-256 `b528f1bff2ea9f0d9315a4a3e6cd921a54f0332578694ff1c9dd67b9a4c7e17e`；已收文本。
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals$/<cinit>`；body `4`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.mod.InahoAbilityVisuals:InahoAbilityVisuals/<ctor>`；body `5`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.mod.InahoAbilityVisuals:anonymous-method-0`；body `6`；code SHA-256 `816387a1f6f4239c71c0ecf7912975bd138d6189b26f38c23063cc64a796f5b5`；已收文本。
  - `boot_ffc6:MemberImpl/applyInstantAbility`；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`；已收文本。
  - `boot_ffc6:ActionEvaluator/addImpactToSubject`；body `52295`；code SHA-256 `2cd4d6fee6d01e91a67829603085af9270298c361b492fa6dedab72c707e9a02`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolvePathCollection`；body `92329`；code SHA-256 `4be465684a1346a539ccdcc65221ea64a875fdc0e3ebcd93bb16d47b185b7e93`；已收文本。

## 33 普通深渊EX幻想独立编队

- 对应目录：[33-independent-rush-party](33-independent-rush-party/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\README.md:1-30`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\build_swf.py` → `33-independent-rush-party\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\src\cn\mod\IndependentRushParty.as` → `33-independent-rush-party\source\IndependentRushParty.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py` → `33-independent-rush-party\source\patch_set_edit_c8601.py`。
- 最终方法体实证：
  - `cn.mod.IndependentRushParty:IndependentRushParty$/setEventId`；body `0`；code SHA-256 `baa6c62433e510eacee4bdb8d3cf0882235d13ab3ca4e49abc9ef2c575f6be5f`；已收文本。
  - `cn.mod.IndependentRushParty:IndependentRushParty$/getEventId`；body `1`；code SHA-256 `ecc2cf8144dbd0c3fb6d0dff689064a57148cb13d49263f88dba8fac1cf0595c`；已收文本。
  - `cn.mod.IndependentRushParty:IndependentRushParty$/category`；body `2`；code SHA-256 `5cfa51adb717da8391a74dd4b004480ce83e9d1ae93d20abd196a39b2ee47184`；已收文本。
  - `cn.mod.IndependentRushParty:IndependentRushParty$/<cinit>`；body `3`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.mod.IndependentRushParty:IndependentRushParty/<ctor>`；body `4`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.mod.IndependentRushParty:anonymous-method-0`；body `5`；code SHA-256 `65bb9a4ab560f23ed321a6778500f5d6c01cf44a18b5b465c6229d0f316c8439`；已收文本。
  - `boot_ffc6:RushEventLoadingTask/summaryRemoteInput`；body `38717`；code SHA-256 `6a29188afd89a123f1009b58048b88f23516801651fdffe22098fba2ecb9f8e5`；已收文本。
  - `boot_ffc6:EventRushPartyRealRemote/<ctor>`；body `48429`；code SHA-256 `6665250af7d41be817e9b39eaa2ad43b1105c04eb1a345ae6a37eb69d3a64a26`；已收文本。
  - `boot_ffc6:RushEventPartyGroupHolder/getPartyCategory`；body `20866`；code SHA-256 `10161f4b71a03f945aae0ef41029ca52df18e59e40d6b942498bccbdf6773e04`；已收文本。
  - `boot_ffc6:PartyGroupEditSceneView/refreshPartyCategory`；body `77565`；code SHA-256 `52fb8029eaaee239942cbfcfdd7fee9b9c51c3b35e3007e77566c36765899a3b`；已收文本。

## 34 常驻文件夹物品来源修复

- 对应目录：[34-item-source-folders](34-item-source-folders/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\README.md:3-18`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\patch_swf.py` → `34-item-source-folders\source\patch_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\src\cn\ui\ItemSourceFolderGate.as` → `34-item-source-folders\source\ItemSourceFolderGate.as`。
- 最终方法体实证：
  - `boot_ffc6:ItemHowToGetQuestSearcher/getAvailableQuestLogic`；body `75737`；code SHA-256 `60091e604c925ebdaf7d7cd88c020859789ee74b72514cbc8c0c6ecc52c4ced5`；已收文本。
  - `cn.ui.ItemSourceFolderGate:ItemSourceFolderGate$/allow`；body `0`；code SHA-256 `9753dbaa99f15f5a9178818b3c31a1bbd69cb510b3cc846f0b3bb9170b570d2a`；已收文本。
  - `cn.ui.ItemSourceFolderGate:ItemSourceFolderGate$/<cinit>`；body `1`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.ui.ItemSourceFolderGate:ItemSourceFolderGate/<ctor>`；body `2`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.ui.ItemSourceFolderGate:anonymous-method-0`；body `3`；code SHA-256 `154e49820801a489ebb2388ddc5ccde375319ed31d03924bd1b21cc90e4181e1`；已收文本。

## 35 排行榜本人资料路由

- 对应目录：[35-leaderboard-self-profile](35-leaderboard-self-profile/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:18-23`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_self_profile_lan_apk.py` → `35-leaderboard-self-profile\source\build_self_profile_lan_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:RushEventRankingPartyScene/copyPlayedParty`；body `71000`；code SHA-256 `e44d600bf617c0b100dbc4b2aebadb9f977a72d9b0a4f651719f9627f4cdef00`；已收文本。

## 36 空账号记录恢复与原子替换写入

- 对应目录：[36-local-record-recovery](36-local-record-recovery/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\README.md:7-23`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\build.py` → `36-local-record-recovery\source\build.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\src\cn\storage\LocalRecordIO.as` → `36-local-record-recovery\source\LocalRecordIO.as`。
- 最终方法体实证：
  - `boot_ffc6:AccountLocalStore_Impl_$/get`；body `29386`；code SHA-256 `16a02778ee23e4f6fdf43350ef9e735b689669bb75f6710ad04d3fe3110b547c`；已收文本。
  - `boot_ffc6:AccountLocalStore_Impl_$/saveAccountData`；body `29390`；code SHA-256 `47dc813287972f40c4a72c57dbbeb2ea6e71a2324a88dd654802f4c3032fd5d0`；已收文本。
  - `boot_ffc6:DeviceLocalStore_Impl_$/writeFile`；body `29456`；code SHA-256 `a248484cb9a33d4667109fb1a8e542a9d5a05252b28e3ea48f277c2f17875423`；已收文本。
  - `cn.storage.LocalRecordIO:LocalRecordIO$/writeBinaryFile`；body `0`；code SHA-256 `2486d1077a319688498241af0ec4b088b6b0fea257febfbdd0bed4a6945c4b65`；已收文本。
  - `cn.storage.LocalRecordIO:LocalRecordIO$/<cinit>`；body `1`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.storage.LocalRecordIO:LocalRecordIO/<ctor>`；body `2`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.storage.LocalRecordIO:anonymous-method-0`；body `3`；code SHA-256 `154e49820801a489ebb2388ddc5ccde375319ed31d03924bd1b21cc90e4181e1`；已收文本。

## 37 八岐大蛇阶段血量弱点与同步运行时

- 对应目录：[37-orochi-boss-runtime](37-orochi-boss-runtime/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\README.md:7-15`
  - `D:\WF\apkp1016\research\early_r8_boss.json:boss.exact_main_hooks`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\build_public_android.py:1-6,18-39`
  - `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\prepare_ios.py:131-149（仅 owner 范围旁证，非 Android 应用顺序）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\build_public_android.py` → `37-orochi-boss-runtime\source\build_public_android.py`。
- 最终方法体实证：
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/integer`；body `0`；code SHA-256 `edf97da5d5bffd1e12613ea05be0dec2f2ab84712ac765b7c35c721095cbcc2f`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/profile`；body `1`；code SHA-256 `7eb9ddb25dfb14622f8661294ff673ad9ebd8928da058bba3b4f1c636fbeec78`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/create`；body `2`；code SHA-256 `34b8c8e5dc860c47eb2bdc052f298949ebbae004e5c2c6b019bbc45e9f44331d`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/reset`；body `3`；code SHA-256 `790acc11361669af09525245dfb01f406eb44855b7ef82855e0d6b3d9600f20b`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/currentSegmentMaximum`；body `4`；code SHA-256 `7d2d7ed7522c92ef16ed3784a2cb4bc4dab23cd078d2bc29ca43f16624a016f4`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/currentSegmentComplete`；body `5`；code SHA-256 `189fa25c1512c6fed2eebee5acc6c77cba8822e5cace81b3dbb88e62d5ea6885`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/complete`；body `6`；code SHA-256 `935b1839567246600555d0b18384ba672eec48df19be70e45b685fdaa00b9d63`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/remaining`；body `7`；code SHA-256 `9b8150a996a0dd7dfa574b595e8921ae2af6885a587f23730f8f97983f66a2b5`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/accept`；body `8`；code SHA-256 `14669b70ba5eef235f09db03c11829669dc96acbe8f27a22546b521a8e87d3a9`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/advanceSegment`；body `9`；code SHA-256 `edb57f18091bb6356a0ce359624112157195d6a45e9f8cbe804676ec6e0e32dd`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/targets`；body `10`；code SHA-256 `d52724eb72a1997235ea70d289a27a261b31998c047d3b3db2cf473332a8dffe`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/tick`；body `11`；code SHA-256 `bdea24437d773d8bb43549b04566a63d0d9e078e91db8b7fa660d199a610e8f3`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/snapshot`；body `12`；code SHA-256 `45e949c987335e23af313d175d6a8170e0344240b8dc70789b3392411f61c3c8`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/restore`；body `13`；code SHA-256 `cebc74e8c09b19bb91d2f9921c3d63fb0ce8a8fee272fdaa96e73488db16a5f6`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime$/<cinit>`；body `14`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.boss.BossMechanicsRuntime:BossMechanicsRuntime/<ctor>`；body `15`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.boss.BossMechanicsRuntime:anonymous-method-0`；body `16`；code SHA-256 `88c053ef50955c035114ba76dadfa367a9919ff8b8c411833b3c9a8a6f357566`；已收文本。
  - `boot_ffc6:OrochiExValues/<ctor>`；body `92450`；code SHA-256 `41e2e27ed7206a7e712b7ddfb2fd8a68a9491bacd9c9f3da7cbd3456732c1755`；已收文本。
  - `boot_ffc6:OrochiEx/ensurePhase4Ledger`；body `92481`；code SHA-256 `e636af5a929a6d259eaae4630e89ca8468d7236009002845dca2e87220d1e0e7`；已收文本。
  - `boot_ffc6:OrochiEx/resolvePhase4Break`；body `92488`；code SHA-256 `3d354b593e4fcda48d464533e7378799c7ad91179647b1ff0f3376441ff3aa88`；已收文本。
  - `boot_ffc6:OrochiEx/updatePhase4Extension`；body `92489`；code SHA-256 `485da7950c4ccbf716c757392019122a7fe9c50c82708b104c37c90f51f69e0d`；已收文本。
  - `boot_ffc6:OrochiEx/reinitialize`；body `92493`；code SHA-256 `9746c5ad87816d480b112a479083fbb37bf04c5e302d5dd8922a7215faab0b2f`；已收文本。
  - `boot_ffc6:OrochiEx/getSynchronizeKind`；body `92526`；code SHA-256 `3ce9520e3211b40669016a43de0fd950bc982f29dfcbf0f9d90315d2de5c6260`；已收文本。
  - `boot_ffc6:OrochiEx/changePhase`；body `92559`；code SHA-256 `1ca1a185adbec74ea6803ae4cfe60e1620fd0f1ef4dcfe97f6b9f3ff93c5cdbc`；已收文本。
  - `boot_ffc6:OrochiEx/applySynchronizeKind`；body `92564`；code SHA-256 `2efb7a8f2676390a87a2a3bbdef27d52bd29d40fd53f2389cfc77ee8df582eaf`；已收文本。
  - `boot_ffc6:OrochiEx/subtractHealthPoint`；body `92566`；code SHA-256 `9755480bf06a7a5e401f5951f9ec41a372c2e62cea560d9e7bf271541b2430bf`；已收文本。
  - `boot_ffc6:OrochiEx/ensurePhaseDamageLedger`；body `92591`；code SHA-256 `a085f7fe75c3f1456d2cdb05cda4452d2fa4d86640147281f7b9015865c661c9`；已收文本。
  - `boot_ffc6:OrochiEx/<ctor>`；body `92579`；code SHA-256 `5f6b45d97a1fed23669c25faa46794deb6d16f62d40b2fc323c9f325c96ee039`；已收文本。
  - `boot_ffc6:OrochiEx/willRemoveUniqueState`；body `92469`；code SHA-256 `2a1a7d3128f19cb89d478c83dbe69ee3d79bad6134d51daecf58fc6816ffe6a7`；已收文本。
  - `boot_ffc6:OrochiEx/updateWeakPointCountdownPosition`；body `92470`；code SHA-256 `1ece3d2e7b10baf2ce82e598cb059ca95a9b7e20887c1250bf309e1cfadd39d1`；已收文本。
  - `boot_ffc6:OrochiEx/updateWeakPointCountdown`；body `92471`；code SHA-256 `485a19874d075b3ee741eb793fdbab482aacf12803b6ddc3cd5da273335ddd25`；已收文本。
  - `boot_ffc6:OrochiEx/updateUniqueState`；body `92472`；code SHA-256 `525c1b49eb9d28795367d227ac422eebcaac4399e9bfbb9666c986e45556ccbf`；已收文本。
  - `boot_ffc6:OrochiEx/updateTrialCondition`；body `92473`；code SHA-256 `02212353e29928a227c693aeb1ad64297ea09e3ee4a7ec965fd72fbb1d194d07`；已收文本。
  - `boot_ffc6:OrochiEx/isPhase2TrialGuardReleased`；body `92474`；code SHA-256 `cc0bf64a782325cc60aa7d3657d17b6a60a1131ad580a762bb8a87bfbc825fb6`；已收文本。
  - `boot_ffc6:OrochiEx/isPhase2TrialStunRunning`；body `92475`；code SHA-256 `ae0bee4df90a968fd018e0cada9905ddd387e536a7372c370b02af7ed67e671e`；已收文本。
  - `boot_ffc6:OrochiEx/canAdvanceFromPhase2`；body `92476`；code SHA-256 `c6b3929cb480976b82748a43e354dbda0d46221a7dec9a2064d64c76ccd33d9b`；已收文本。
  - `boot_ffc6:OrochiEx/update`；body `92477`；code SHA-256 `a092937706f8ac6665ce0a83c857f54de6c4df0fd93aed070934444fbf4821a5`；已收文本。
  - `boot_ffc6:OrochiEx/hasPhase4HealthMode`；body `92478`；code SHA-256 `195868905a7cf59d0b060dd858076ff93447d692cec99135e50086d08878816f`；已收文本。
  - `boot_ffc6:OrochiEx/phase4HealthRaw`；body `92479`；code SHA-256 `e94ea1d7ea4f3390194951ce156abfd4ee20022ec76eaea4b16f4556a3700231`；已收文本。
  - `boot_ffc6:OrochiEx/phase4Profile`；body `92480`；code SHA-256 `42dfb2e755682cf1365464d5902023e93b49aef51f0b38bf7f31162769c65a3f`；已收文本。
  - `boot_ffc6:OrochiEx/phase4DamageRate`；body `92482`；code SHA-256 `3a1f53d85f2d85a76d29f173b5f89c42ebd28860ed0dfb8aa3908b00567ca6d3`；已收文本。
  - `boot_ffc6:OrochiEx/isPhase4AttackRunning`；body `92483`；code SHA-256 `5b5f3b9a3dba84237e3175b8d5e813181020b6b684695b64c2b389dd7326c6be`；已收文本。
  - `boot_ffc6:OrochiEx/countBrokenWeakPoints`；body `92484`；code SHA-256 `358fc2bad0dd52e3113d9e48630a458432720ecf960214b4c5754764fcc1e36e`；已收文本。
  - `boot_ffc6:OrochiEx/resetAllWeakPoints`；body `92485`；code SHA-256 `1d41aba8473a93ae61e2688b69bf5c23e7eafe60ab2dc9c0a2ff9732fc2e1e89`；已收文本。
  - `boot_ffc6:OrochiEx/enterPhase4AwakeState`；body `92486`；code SHA-256 `c4ad77a5770d83f89b5dc8f8b4ef8c15741591358321f2206dbfa18a0125212f`；已收文本。
  - `boot_ffc6:OrochiEx/startPhase4Reset`；body `92487`；code SHA-256 `6fcc9ff7d9831e682e3a3ba9c6e1f3b82129372402279660ce6ac922ced7f08a`；已收文本。
  - `boot_ffc6:OrochiEx/resolveUniqueStateGroupKeyFromOwnerKind`；body `92490`；code SHA-256 `5db4ca3d81b709bff215ca555853ef64a41fea62e09e90469e0a8eef06154b68`；已收文本。
  - `boot_ffc6:OrochiEx/resolveUniqueStateGroupKey`；body `92491`；code SHA-256 `d83cbbce5a4095bffe56658b98d3be1f307ba1b14180cf20ac43b0ed83da4295`；已收文本。
  - `boot_ffc6:OrochiEx/resolveCollision`；body `92492`；code SHA-256 `d3ea97c8f672f072c308bfa1b7e20e75da4e96a11ffbb3892dc8c03c035c77a5`；已收文本。
  - `boot_ffc6:OrochiEx/once`；body `92494`；code SHA-256 `951584dbaae5e3471b7b3c8ce6f4c6415a4c1dc9868761afd955bfcb10ff6298`；已收文本。
  - `boot_ffc6:OrochiEx/numUniqueStateFrames`；body `92495`；code SHA-256 `dc4ac528c3eed95c9c1d9fa1e38399c80f8472f677c322e2ed77946307030ee0`；已收文本。
  - `boot_ffc6:OrochiEx/numNormalStateFrames`；body `92496`；code SHA-256 `04f3a97fd2b6dc3f6b20a7b05082f1ba22e5d048348c91ee04d144574d707dfc`；已收文本。
  - `boot_ffc6:OrochiEx/numIdleStateFrames`；body `92497`；code SHA-256 `cdb719272bd3fce4d128134ff0cfffa605a9d27c420382f78b34331d0e260e9a`；已收文本。
  - `boot_ffc6:OrochiEx/numAttackStateFrames`；body `92498`；code SHA-256 `d257fee65c5a14bb0d52787e1709a457cdc60765448caed73818b7b0d51b4c76`；已收文本。
  - `boot_ffc6:OrochiEx/moveUniqueState`；body `92499`；code SHA-256 `e81b92f78055771191100a2c21a365aaf3710fcb7e219ef7820474d004c5de18`；已收文本。
  - `boot_ffc6:OrochiEx/move`；body `92500`；code SHA-256 `2d2ad36165bbf997321c09e4ce180fd2b317eafb3df24a9d24ac53c54ec5bccd`；已收文本。
  - `boot_ffc6:OrochiEx/matchTrial`；body `92501`；code SHA-256 `ee0681681fe323f91fe4c3249d6e000143363b8c98c92aa440dc3212ad94f9df`；已收文本。
  - `boot_ffc6:OrochiEx/loop`；body `92502`；code SHA-256 `511b9bd85ba7ed58e2ceb8e03575212daa4b3bef06dae3b4417b5914a828acd4`；已收文本。
  - `boot_ffc6:OrochiEx/isTrialGaugeVisible`；body `92503`；code SHA-256 `d585616625656f7803c9407d288dca461830151e2b66e2009440e239c604ef48`；已收文本。
  - `boot_ffc6:OrochiEx/isLinkConditionEffectVisible`；body `92504`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`；已收文本。
  - `boot_ffc6:OrochiEx/isInvincible`；body `92505`；code SHA-256 `f0962643573d1de38f10ee7aad5d132cd67f97a5a30eacc5bd33cda4df6927c0`；已收文本。
  - `boot_ffc6:OrochiEx/isHealthPointGaugeVisible`；body `92506`；code SHA-256 `ca8b4ba43041466cdd88bd130f8a1824a7bf3b96001bdf62a01e4d6a44df79e6`；已收文本。
  - `boot_ffc6:OrochiEx/isGenericDeathEffect`；body `92507`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`；已收文本。
  - `boot_ffc6:OrochiEx/isContemporizing`；body `92508`；code SHA-256 `ca2fa85333efd90732cdbdb46a7fe5d32bfd7c847b36903022a32b404fb6dcd3`；已收文本。
  - `boot_ffc6:OrochiEx/isChargingSpecialAttack`；body `92509`；code SHA-256 `7df64c4ae27ef6d6ea6da686e7b0bcf3b83e85513b555c85f8d8245c7c5e8a08`；已收文本。
  - `boot_ffc6:OrochiEx/initialize`；body `92510`；code SHA-256 `6ae503cc170a73e44214bbc52ca28521db9b71b8c2c4f5c44b501e428cbd7178`；已收文本。
  - `boot_ffc6:OrochiEx/init`；body `92511`；code SHA-256 `108f66137272f086c09e35ca675ebc054663e912db1f7129ac5efc3b7a8f6a68`；已收文本。
  - `boot_ffc6:OrochiEx/incrementFunnelSpawnCount`；body `92512`；code SHA-256 `f3f70deaca6e853279769895600e46c900985792ce4ef99fcfbdf4eca27e4e7c`；已收文本。
  - `boot_ffc6:OrochiEx/hasPinched`；body `92513`；code SHA-256 `e14f063642ed90ce68708e85bad060693fbaa28010127676118bbc81afa8c525`；已收文本。
  - `boot_ffc6:OrochiEx/gotoTrialStunIfPossible`；body `92514`；code SHA-256 `28be89f0d2931d581f3c789f194e4e1f1aa1202c3327b3f23613c880fb3ea286`；已收文本。
  - `boot_ffc6:OrochiEx/gotoTrialStun`；body `92515`；code SHA-256 `2232a87e6eebd62d54f79c2e1bcea3d0bdc0c1bf20b0e77270f72d7e157c7dd8`；已收文本。
  - `boot_ffc6:OrochiEx/gotoSkillChainStunIfPossible`；body `92516`；code SHA-256 `81b47d70b51b8fa32c4b13a60101081a93df1cf06556d206b3ffd21b91602d78`；已收文本。
  - `boot_ffc6:OrochiEx/gotoNextState`；body `92517`；code SHA-256 `4208c1a297a715745ad92e7568e7d6813a9a6bffaca652c44fbe00b96e84f77d`；已收文本。
  - `boot_ffc6:OrochiEx/gotoNextPhaseIfPossible`；body `92518`；code SHA-256 `14a808e8f3ec478164b42bd6f8f0c50606f1e0190ba4b0de18f6a715b07345d6`；已收文本。
  - `boot_ffc6:OrochiEx/getWeakPointCountdownY`；body `92519`；code SHA-256 `153a987248bcbeee11e08159e5d9fdefd7a8e84ac38f837a2e2ae98f00f14ae1`；已收文本。
  - `boot_ffc6:OrochiEx/getWeakPointCountdownX`；body `92520`；code SHA-256 `dcf83a40950a05cbd14674e74bf46ab8dbb0cd10944b32e0357e14057d009b90`；已收文本。
  - `boot_ffc6:OrochiEx/getWeakPointCountdownAnimation`；body `92521`；code SHA-256 `a92f5c15a7f3397b0910e98dffd75a9b12513e8beddcc88ff93bff0947eab163`；已收文本。
  - `boot_ffc6:OrochiEx/getTrialNameOfChallenging`；body `92522`；code SHA-256 `bae64dcef22daf250c3242ff5bfe46a6aa836cd8f74e9932b83c9bbcdfa02acc`；已收文本。
  - `boot_ffc6:OrochiEx/getTrialKindOfChallenging`；body `92523`；code SHA-256 `1e2452f8540df0ea98973220b467cdb9692ddee0f16b96c1a7d2c7f2e58839c3`；已收文本。
  - `boot_ffc6:OrochiEx/getTrialIdOfChallenging`；body `92524`；code SHA-256 `e4e54d656e8f586a86dc13808464610e8ee0fd242048f8c27c00c83ba118278d`；已收文本。
  - `boot_ffc6:OrochiEx/getTrialGauge`；body `92525`；code SHA-256 `33909bbfdccab8498877fe988cf2d79cc8ed1ce05c6754bb60d1e06e21ae3a26`；已收文本。
  - `boot_ffc6:OrochiEx/getScriptContext`；body `92527`；code SHA-256 `3955430267c7daaf757f4cc0f0ff5f3270daf5903d8ad872c796cef0e761f18b`；已收文本。
  - `boot_ffc6:OrochiEx/getRemainingFramesOfUniqueStateGroup`；body `92528`；code SHA-256 `62320b753e31aac9702e912ab36f7162ea0d420fd18c24f1016acfb8418aa661`；已收文本。
  - `boot_ffc6:OrochiEx/getRealMaximumHealthPoint`；body `92529`；code SHA-256 `069dad8533adcd86dd8c395926f482f76d5607aa27bf83501fe0b915516b9c91`；已收文本。
  - `boot_ffc6:OrochiEx/getRealHealthPointRatio`；body `92530`；code SHA-256 `5064bdc75a0a082ea140339ca0ddb7bbd4cdb98d1cea5cf9d162745de79a7895`；已收文本。
  - `boot_ffc6:OrochiEx/getRealCurrentHealthPoint`；body `92531`；code SHA-256 `7b200c0758b7725a45a342ad2b3bd5759283e1c28a087f1c544a276a6e0e41f5`；已收文本。
  - `boot_ffc6:OrochiEx/getPhaseIconRefreshIndex`；body `92532`；code SHA-256 `eb2e3cb02375ba5a360c536082f5d4fcf90ca3129dc1b8de4e3c56f0c643e47d`；已收文本。
  - `boot_ffc6:OrochiEx/getNextPhaseChangeThreshold`；body `92533`；code SHA-256 `d479ffc97d37be3aeed5bdd3b4d323649a0299af04adcd9b829a62992d3b0692`；已收文本。
  - `boot_ffc6:OrochiEx/getLinkConditionEffectCurrentFrame`；body `92534`；code SHA-256 `69eedd7aa98da5862c8e5de196299b58bdf66a5dbed7e17ebb51659e40f15336`；已收文本。
  - `boot_ffc6:OrochiEx/getInitialState`；body `92535`；code SHA-256 `b50449eb971ab1eb55cf4d32ead190e2d9f293ecc5ed51436857ef48efe6c0d6`；已收文本。
  - `boot_ffc6:OrochiEx/getEnemyCount`；body `92536`；code SHA-256 `f3ad9eb56e11200c747758c56041cb3a97602ec54153b935e6bad75743f4f6aa`；已收文本。
  - `boot_ffc6:OrochiEx/getDebugStatus`；body `92537`；code SHA-256 `145c810f6038f005c9019993936a8d8169ffcf3217f69dd3baeef992a918061f`；已收文本。
  - `boot_ffc6:OrochiEx/getCurrentFrameWeakPointCountdownAnimation`；body `92538`；code SHA-256 `6445ba04d63450744c62b9225f0e27a44307cc320cab4cd45afe317aae933998`；已收文本。
  - `boot_ffc6:OrochiEx/getConditionIconVisible`；body `92539`；code SHA-256 `6de1229675e25aa935a4316b2e6d1cc72d20140728aa0783d7c1054ae799695a`；已收文本。
  - `boot_ffc6:OrochiEx/getConditionIconBaseY`；body `92540`；code SHA-256 `de6b89aa3b0a38cfd7aefa0bd4e89896296f1b6d19159890f849aabcc7556ab6`；已收文本。
  - `boot_ffc6:OrochiEx/getAttackValues`；body `92541`；code SHA-256 `106b12452c0ed41dec096bab86f0a20a97e412f04ad0ef4adb4f1d0e633fd90a`；已收文本。
  - `boot_ffc6:OrochiEx/getAnimationLabel`；body `92542`；code SHA-256 `2d6c9e11e219f62f095ca7a9865e7b9ec75da1d2a39a33917412535032f36aac`；已收文本。
  - `boot_ffc6:OrochiEx/getActionSubjects`；body `92543`；code SHA-256 `2d6e46be4139b6f111ba3aa181a8c3e8351f2d50cb7e5ea6ea120de8c86407d8`；已收文本。
  - `boot_ffc6:OrochiEx/generateAttackAnimationLabel`；body `92544`；code SHA-256 `739fe81befa4e1311e33cfec432bb9435c8534535199742ec266ce47a24d4a3b`；已收文本。
  - `boot_ffc6:OrochiEx/forwardDamageFromHead`；body `92545`；code SHA-256 `9c53f45d311696991d78c94fb7ed04bab189c85126d12a65994ece39b7f4ad23`；已收文本。
  - `boot_ffc6:OrochiEx/exitUniqueState`；body `92546`；code SHA-256 `3520c279d89a0f8692216b9ad4cdac3f455a01038e67c0b6a8468daf5d4f0b75`；已收文本。
  - `boot_ffc6:OrochiEx/executeAction`；body `92547`；code SHA-256 `1d4108c09c24d1c5a0c9408091defaea6cf19c689ab837a59f9bb0daa854ecd6`；已收文本。
  - `boot_ffc6:OrochiEx/enterWinceState`；body `92548`；code SHA-256 `ca862387625f56fedf996560ce49dda8ac4250e87b0addae5bdc091f52a331ed`；已收文本。
  - `boot_ffc6:OrochiEx/startPhase1Trial2Masked`；body `92549`；code SHA-256 `2d6af5312a8e9fbe642974ec8fb56ac6b541a9e8eb7038cd9c03996fa730d964`；已收文本。
  - `boot_ffc6:OrochiEx/tryStartPhase1Trial`；body `92550`；code SHA-256 `0da23e82bcd372028d33377d9fa807528d0997923ef7815ff298f41d52f65e53`；已收文本。
  - `boot_ffc6:OrochiEx/enterUniqueState`；body `92551`；code SHA-256 `441339a33b2e20fe6f0da6574a46337773638cbfc8cff143a0ea68d099418b7d`；已收文本。
  - `boot_ffc6:OrochiEx/enterStunState`；body `92552`；code SHA-256 `ce447cdb581fd0ae2852f3a5a66861a2f3b630a8e25e78e5d5d00baf49bd3ea3`；已收文本。
  - `boot_ffc6:OrochiEx/enterDeadState`；body `92553`；code SHA-256 `723f09a6a64f37a5ac201a8d66f0e1fe59a58f5cf43d5ac84b14a7cdb60b8f3c`；已收文本。
  - `boot_ffc6:OrochiEx/dispelAllConditions`；body `92554`；code SHA-256 `1e59ef99a398ad1cb33d3bd40eb12fefc736cd44991b62d51c7c62f368d753ed`；已收文本。
  - `boot_ffc6:OrochiEx/dieIfPossible`；body `92555`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`；已收文本。
  - `boot_ffc6:OrochiEx/createTargetAttack`；body `92556`；code SHA-256 `84230d22a5a081c16547036af4b9d13de1a694e58ce52cc2b89861d9d53ca887`；已收文本。
  - `boot_ffc6:OrochiEx/changeState`；body `92557`；code SHA-256 `796d7c3b75be72f407a9a729027d1449239da6b36ee85994b3c88d1c936c8297`；已收文本。
  - `boot_ffc6:OrochiEx/configurePhase4WeakPointKind`；body `92558`；code SHA-256 `6c0c6c5154ea75cec37886ce841b82abbcf8e030b4c7acad51c2cd4d01c507d3`；已收文本。
  - `boot_ffc6:OrochiEx/canRemoveOnContinue`；body `92560`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`；已收文本。
  - `boot_ffc6:OrochiEx/canEnterWinceStateFromUniqueState`；body `92561`；code SHA-256 `6cba9f46fd9acc6080106b8671490c85d057554ba7d6177e0fb757a9e20007d1`；已收文本。
  - `boot_ffc6:OrochiEx/canEnterStunStateFromUniqueState`；body `92562`；code SHA-256 `9b92a8fadf5fee15c721ce3c05f0b8f4a53f746e685ec7641eadaf84801f300f`；已收文本。
  - `boot_ffc6:OrochiEx/backtrackUniqueState`；body `92563`；code SHA-256 `ec3ab737e3ba3660a75adb903b9dfb94dc30ffa2c30b36a472ff8afdbb93f7a8`；已收文本。
  - `boot_ffc6:OrochiEx/applyConditionChanges`；body `92565`；code SHA-256 `4b612aed5aafab33cc88a72edf7e48d45ad0afdb5a53c4aa07569592548fa508`；已收文本。
  - `boot_ffc6:OrochiEx/applyAttack`；body `92567`；code SHA-256 `b26fc55076a3b1a5acce32b20b35fd41a35178b09fd73bb953625474414194dc`；已收文本。
  - `boot_ffc6:OrochiEx/afterAddition`；body `92568`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`；已收文本。
  - `boot_ffc6:OrochiEx/_state`；body `92569`；code SHA-256 `f77330aefefcde1b43e3898794cd05b8b4e0646722a192aa7ddcbc6e12fb740e`；已收文本。
  - `boot_ffc6:OrochiEx/_changeState`；body `92570`；code SHA-256 `4a701be9510e8d71511c0125e898271beada23403b595ce80fc0db80012316f1`；已收文本。
  - `boot_ffc6:OrochiEx/showCutin`；body `92587`；code SHA-256 `5e6b5f76cbcdd8a3f0dcfa78096fc8fcd323cd04163ba44afd94a1e808a2485b`；已收文本。
  - `boot_ffc6:OrochiEx/scoutOut`；body `92588`；code SHA-256 `63bc6ff7daf625f3672a3cd2078809707b4031dc9af72b94d6dbadcc2b06799d`；已收文本。
  - `boot_ffc6:OrochiEx/hasUnifiedPhaseHealthMode`；body `92589`；code SHA-256 `b613bca595a3265d253b82a8024609acdff9d405ed0e1ce1f65267ba8c41a8b6`；已收文本。
  - `boot_ffc6:OrochiEx/unifiedPhaseHealthPoint`；body `92590`；code SHA-256 `62983fb2c3c4617b15ce1ca2e0a73b045b5cceb8aca9bda04e46ac3ed40c835e`；已收文本。
  - `boot_ffc6:OrochiEx/unifiedPhaseDamage`；body `92592`；code SHA-256 `389284ec7545d425db1b3c014136cc9c5f884f4827579e71c7e70d851173dd76`；已收文本。
  - `boot_ffc6:OrochiEx/acceptUnifiedPhaseDamage`；body `92593`；code SHA-256 `e5db0f61378c7d2f3544763c39e38c677b047dfc7826ae2afaf07ca47d98deef`；已收文本。
  - `boot_ffc6:OrochiEx/isUnifiedPhaseComplete`；body `92594`；code SHA-256 `e44f988ef27deb0379ae125b6e4cda26605c86bd803b690e2fe2557644daa4e7`；已收文本。
  - `boot_ffc6:OrochiEx$/<cinit>`；body `92580`；code SHA-256 `a97687d77bd5812dbf56fcbc27f918b697e26cfb805ed6a7a8495346e29f3526`；已收文本。
  - `boot_ffc6:OrochiEx$/next`；body `92571`；code SHA-256 `f9ea40e20e977ecc7b6c4f4be7c3922a212ff8b29c3efd3cff779fc0b4cc1c18`；已收文本。
  - `boot_ffc6:OrochiEx$/back`；body `92572`；code SHA-256 `38b6f2fcb324450172de98065d4c73f84eabbbf42f94daf2222c0acc5f43a6b3`；已收文本。
  - `boot_ffc6:OrochiEx$/getNextStateName`；body `92573`；code SHA-256 `f228ab09009e09ae9166dc82e3a2e69caa116edb12a6627119830f516512ccdc`；已收文本。
  - `boot_ffc6:OrochiEx$/isIdleable`；body `92574`；code SHA-256 `df91636e6268b10879dac7e59c1feacee03a7b804c5d12d04f1430063a43f295`；已收文本。
  - `boot_ffc6:OrochiEx$/isAttack`；body `92575`；code SHA-256 `0ab66b9a82c535e2a36a6b362ec46848f0019afc595fb23210da6d4172677c42`；已收文本。
  - `boot_ffc6:OrochiEx$/isSkill`；body `92576`；code SHA-256 `1ca1e46a9c5edf5463663a0f4c7fddff4dabe5aec6bfcb2775c0464bf1a65277`；已收文本。
  - `boot_ffc6:OrochiEx$/_equals`；body `92577`；code SHA-256 `646b1e4a5003baddd41a0089e1f286ad77cd03229298a97fb60f0641b153c62d`；已收文本。
  - `boot_ffc6:OrochiEx$/_toString`；body `92578`；code SHA-256 `3d4156578cad8ebeca3aa4caebc79428ea55dd2ae9369c629d13bfde525add98`；已收文本。
  - `boot_ffc6:OrochiExSource/<ctor>`；body `92585`；code SHA-256 `67b88a122c30bc7e27ca630c8bf3f6132b550f4ce18b7cc0602f37cb9eff6f11`；已收文本。
  - `boot_ffc6:OrochiExSource/dynamicWeakPointSource`；body `92582`；code SHA-256 `dfb103ca3a8107bb28e7f4fc217165d313c6d72152eac134a57ae7a8ce01ff3b`；已收文本。
  - `boot_ffc6:OrochiExSource/resolvePathCollection`；body `92583`；code SHA-256 `6f245e5ba92f0f16a8e813ab1d87d9105055838c66ca16b25fabb026c95417d2`；已收文本。
  - `boot_ffc6:OrochiExSource/resolveEnemyActions`；body `92584`；code SHA-256 `c6c6f0716a2f228f25c3d7cf6507876b8b168e647a8fdc4c5eb3ca5de9060665`；已收文本。
  - `boot_ffc6:OrochiExSource$/<cinit>`；body `92586`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`；已收文本。
  - `boot_ffc6:OrochiExValues$/<cinit>`；body `92451`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`；已收文本。
  - `boot_ffc6:OrochiExValues$/init`；body `92448`；code SHA-256 `b0885e8a619be441b7c3df8ce589d4be35353eb60b17a1a9f166e50e1de89ed3`；已收文本。
  - `boot_ffc6:OrochiExValues$/_new`；body `92449`；code SHA-256 `b4fed9eca204cbfe429785b2466fda013ded719d4e44dfcc8b143898be701d0d`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind/<ctor>`；body `92466`；code SHA-256 `7979072a95c57c395e3c40246f53d8ecd3d89ff1c967d87f9dd114c2cf51751d`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind/toString`；body `92453`；code SHA-256 `7b0a4ae6426e151cef7cfc66d964d9a8e28302e9d5aacefdc7bf55a346ba4978`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/<cinit>`；body `92467`；code SHA-256 `8f9a01801d79bf8673b27a7a918a5245f2a95ea09ef8a7373d5986ed429cedc8`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/Conductor`；body `92454`；code SHA-256 `66cca0f18a09746bc4724e8e0559bfa7447daff68b8863798050d92fc08f6b72`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/registerBossMechanics`；body `92455`；code SHA-256 `f8a49b52685cfa2f5893f716e5abf29004a8a71d6babfc6fae0d252cb161f655`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/BossMechanics`；body `92456`；code SHA-256 `29665f2f83e8be2dda60a1fa17158ea327e9995fd8aced862653727eeb1f69f2`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/GeneralBoss`；body `92457`；code SHA-256 `01352bab3abbc6e8e5dc3bba13ab485ecabed4011b14bf577a4ec15a5299a39b`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/GeneralEnemy`；body `92458`；code SHA-256 `476014a4caa147b69dcb05b2131023f17e5636af477ad20d243e9e0a4095e068`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/GeneralFunnel`；body `92459`；code SHA-256 `623231711fcb05ef7cbee7e512054413d53425bc26b4be0573b1032a57cfd8e3`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/Kraken`；body `92460`；code SHA-256 `ecb5ec20b72066eedc58b402a9d2ae674450a36e7a60d7dc76e28ca391d289d8`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/Orochi`；body `92461`；code SHA-256 `1fc680cacb141e84e0cb30c120b73bff13a337ecd7a0a14ef944bcf52f869642`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/OrochiEx`；body `92462`；code SHA-256 `d8f0489675d7700be7d58ddc4a67e5bc3115613dd3e3eebd111d8f1983a44592`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/OrochiExHead`；body `92463`；code SHA-256 `8c1f8ad1bac55b3da8d1013e21ecd6c3d91958449741aee6daf2d35c035baa26`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/Tentacle`；body `92464`；code SHA-256 `7d8717e706b2a912bd8fb6452510bbc0be47394e41bea9c730124bf2eef49fd1`；已收文本。
  - `boot_ffc6:EnemySynchronizeOwnerKind$/TouyakirenCeo`；body `92465`；code SHA-256 `85c8b7acfd55fd1020f7263301eea0de942b89a363778a07f23e873b118baf53`；已收文本。
  - `boot_ffc6:ZoneSourceValues/resolveOrochiExsAction`；body `15656`；code SHA-256 `430d93a9cad247dc0b4d1e56b21c6c5558ca3f7128465b7a390be1dd5a962e04`；已收文本。
  - `boot_ffc6:ZoneSource/get_bossGroupName`；body `15641`；code SHA-256 `3f0e8c912aeebd0c9529a15cd6f6c8acf27ef0d03a74691e5208f23523d09250`；已收文本。

## 38 编队切换空引用修复

- 对应目录：[38-party-carousel-f1009](38-party-carousel-f1009/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\README.md:9-18`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\patch_swf.py` → `38-party-carousel-f1009\source\patch_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\build_apk.py` → `38-party-carousel-f1009\source\build_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:PartyCarousel/changeIndex`；body `66403`；code SHA-256 `fbba333b70b8b6517019079caab12747dc06915491f3f54891e8a8b86946fe43`；已收文本。
  - `boot_ffc6:CharacterCellButtonProcessor/beginTouch`；body `65893`；code SHA-256 `d304073b7f4d0970b3ebfab1248525861b3257da086f76b6e08e72401f9c4220`；已收文本。

## 39 队伍派生缓存与完整键

- 对应目录：[39-party-derived-cache](39-party-derived-cache/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\README.md:3-23`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\patch_swf.py` → `39-party-derived-cache\source\patch_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\src\cn\loading\PartyDerivedCache.as` → `39-party-derived-cache\source\PartyDerivedCache.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py` → `39-party-derived-cache\source\build.py`。
- 最终方法体实证：
  - `boot_ffc6:BattlePartyLogic/getUnitedCharacters`；body `20565`；code SHA-256 `46c807a5ff5b1b02e4435417d1e026b33683909b726c0f1b7095148e325f2e7c`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/snapshot`；body `0`；code SHA-256 `bd361676756a4fc1d6c3e65a699b9b37732e6a55718145370bf5a5f926417a95`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/key`；body `1`；code SHA-256 `0e20ed5e5d87414d24757452a535aa523aa01956c519f70d4849247b67b77d59`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/begin`；body `2`；code SHA-256 `562021a3d33aa12f7f8d738a07b8a5edbb413d3b2b0154dc4eb095ebd693eb01`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/reset`；body `3`；code SHA-256 `b65025645dc8b3d7bd720079e88aa72e70112014ccce751465417e6cd817e1b5`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/metrics`；body `4`；code SHA-256 `2e0aad34bcdf8e5b092629dc38581a01b1102e9d61aa6e414d4b7c17f55106eb`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/checkpoint`；body `5`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/finish`；body `6`；code SHA-256 `7f99c45b1479003ff8c7f3b4dee642b02d895dd1e79dd336c8b30ab9619e4181`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/find`；body `7`；code SHA-256 `2c7efbd3346b4386af60766d46d5c883a9754ce2ec473e2a5eec54aec47b4ab0`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/createEntry`；body `8`；code SHA-256 `7009e21431fa1ed9baea9ad5066f5df0475e56ca02ed605e2c96dc94eae2e383`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-11`；body `9`；code SHA-256 `ee1a1e0c31bc7bccd32fcb51676bd376aac128a53694e0055a88b61b4d16169f`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/get`；body `10`；code SHA-256 `60e29ffa9b4d0bcd122e357f5066d1ce855028661fbe2d9f2d534fe7d341e2a6`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-13`；body `11`；code SHA-256 `6a0c9ab58aaa42809013ab4163b77f78e7e73b11aab2926248ea50eb1ede7d92`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/enqueue`；body `12`；code SHA-256 `dad97231604a644e4d93468b44a73ebfb5742ff90f07394845a02eec00f71119`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/runOne`；body `13`；code SHA-256 `778548493f9a3bde6a42406bff86df5c33e02a6910c7b3ba799197c5b9ad2021`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/defer`；body `14`；code SHA-256 `ed74fba30a6d83ddb3682017536f2936fd8f8444f1bacf21bc3e734ba8e0e452`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/tick`；body `15`；code SHA-256 `76675f7bda88b0d027db17936133eb63ed2f99be1ad8d5d18be85507f9bd3d3f`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/<cinit>`；body `16`；code SHA-256 `10fe9e763de10a0b148654e1539db1391cec9e1a8cf60e610681ad3972f53cfa`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache/<ctor>`；body `17`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-0`；body `18`；code SHA-256 `e14877b7d93d62f8847ca6b5b8c358591f3adb25303e005a20cb51fbda04c07f`；已收文本。

## 40 角色派生分批预计算

- 对应目录：[40-party-precompute-batching](40-party-precompute-batching/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\README.md:7-23`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\patch_swf.py` → `40-party-precompute-batching\source\patch_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\src\cn\loading\PartyDerivedCache.as` → `40-party-precompute-batching\source\PartyDerivedCache.as`。
- 最终方法体实证：
  - `boot_ffc6:LoadingSceneBase/gotoNextScene`；body `76049`；code SHA-256 `beba3cc4411150a78609dd8ae4f4d9f7e6ca3ffb255dab80cc3c5c08c4731316`；已收文本。
  - `boot_ffc6:LoadingSceneBase/startNextSceneAssetLoadWithDetail`；body `76042`；code SHA-256 `1db5b17c44379920f3886404a86433c169ee46d850bb7ee3ad7bda4d05d690da`；已收文本。
  - `boot_ffc6:BattleScene/leaveHandler`；body `28971`；code SHA-256 `f07dd5bd29f06da66b08ffb4fae263583372bc1d22053a23178d39c9b0a70577`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/snapshot`；body `0`；code SHA-256 `bd361676756a4fc1d6c3e65a699b9b37732e6a55718145370bf5a5f926417a95`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/key`；body `1`；code SHA-256 `0e20ed5e5d87414d24757452a535aa523aa01956c519f70d4849247b67b77d59`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/begin`；body `2`；code SHA-256 `562021a3d33aa12f7f8d738a07b8a5edbb413d3b2b0154dc4eb095ebd693eb01`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/reset`；body `3`；code SHA-256 `b65025645dc8b3d7bd720079e88aa72e70112014ccce751465417e6cd817e1b5`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/metrics`；body `4`；code SHA-256 `2e0aad34bcdf8e5b092629dc38581a01b1102e9d61aa6e414d4b7c17f55106eb`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/checkpoint`；body `5`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/finish`；body `6`；code SHA-256 `7f99c45b1479003ff8c7f3b4dee642b02d895dd1e79dd336c8b30ab9619e4181`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/find`；body `7`；code SHA-256 `2c7efbd3346b4386af60766d46d5c883a9754ce2ec473e2a5eec54aec47b4ab0`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/createEntry`；body `8`；code SHA-256 `7009e21431fa1ed9baea9ad5066f5df0475e56ca02ed605e2c96dc94eae2e383`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-11`；body `9`；code SHA-256 `ee1a1e0c31bc7bccd32fcb51676bd376aac128a53694e0055a88b61b4d16169f`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/get`；body `10`；code SHA-256 `60e29ffa9b4d0bcd122e357f5066d1ce855028661fbe2d9f2d534fe7d341e2a6`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-13`；body `11`；code SHA-256 `6a0c9ab58aaa42809013ab4163b77f78e7e73b11aab2926248ea50eb1ede7d92`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/enqueue`；body `12`；code SHA-256 `dad97231604a644e4d93468b44a73ebfb5742ff90f07394845a02eec00f71119`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/runOne`；body `13`；code SHA-256 `778548493f9a3bde6a42406bff86df5c33e02a6910c7b3ba799197c5b9ad2021`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/defer`；body `14`；code SHA-256 `ed74fba30a6d83ddb3682017536f2936fd8f8444f1bacf21bc3e734ba8e0e452`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/tick`；body `15`；code SHA-256 `76675f7bda88b0d027db17936133eb63ed2f99be1ad8d5d18be85507f9bd3d3f`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache$/<cinit>`；body `16`；code SHA-256 `10fe9e763de10a0b148654e1539db1391cec9e1a8cf60e610681ad3972f53cfa`；已收文本。
  - `cn.loading.PartyDerivedCache:PartyDerivedCache/<ctor>`；body `17`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.loading.PartyDerivedCache:anonymous-method-0`；body `18`；code SHA-256 `e14877b7d93d62f8847ca6b5b8c358591f3adb25303e005a20cb51fbda04c07f`；已收文本。

## 41 玩家账号登录界面

- 对应目录：[41-player-login](41-player-login/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\player-login\README.md:1-90`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\player-login\build_swf.py` → `41-player-login\source\build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\player-login\src\cn\account\PlayerLogin.as` → `41-player-login\source\PlayerLogin.as`。
  - `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py` → `41-player-login\source\startup-cache--build_swf.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py` → `41-player-login\source\build.py`。
- 最终方法体实证：
  - `cn.account.PlayerLogin:anonymous-method-2`；body `0`；code SHA-256 `bd6a7565cfed4142fc5b0a699b31d018c8ccacf19c2bc4f3a19fb28cfb722e0f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-3`；body `1`；code SHA-256 `4ff73de7e1851205d648dc81bb4d16c19fba4719b0e63908fc434fcbbc34cca0`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/title`；body `2`；code SHA-256 `803bf50e692ea1f93a972c08760f8649e0668bfe4751d00f0968552db63f6eb4`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/readStoredRecord`；body `3`；code SHA-256 `3011006461044d70b121708baec9a4363beafabd85bd5e3596a7ace6d0b39aa4`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/start`；body `4`；code SHA-256 `8cf30674fac365ca39f39a63ffd1e84888a17dbd98b88bd3562ab380136bfde1`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/attach`；body `5`；code SHA-256 `29fafac5c6c566d51efd5c4a1a9f62982314a984292efe77fa5b17a1723e4c9b`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/socket`；body `6`；code SHA-256 `9607b48cf6a34d9143e33f421e7638ce221a32badb7d518f6ccb9d6d012f4df5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/dispose`；body `7`；code SHA-256 `b688df737b5709ff041b4a2ccc81d5f4d515a98196b2ecf460342536ba6d690f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-10`；body `8`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-11`；body `9`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-12`；body `10`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-13`；body `11`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-14`；body `12`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/show`；body `13`；code SHA-256 `fb190df232e18a890598a6538a36990016b5f8ceed4260a443e60fdf1a077584`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/detachBackGuard`；body `14`；code SHA-256 `ef6630e6c1a3cc740802234dcff735068d6b0b603d533dc5b72b822a36753a78`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/guardBack`；body `15`；code SHA-256 `918432dfc55d64b14363b02889d361bdc2ce2c065c725f15fc924d2a8eb62998`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/clearLiveSession`；body `16`；code SHA-256 `1b62491b67aef18ed65f966970f2ace7214678f574a5cff5d3cf9af845228868`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/findEntry`；body `17`；code SHA-256 `c46784a6f1de8d73f578d00ab814dca465678db93d0b6d2405bb6a6287936212`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/loadAccounts`；body `18`；code SHA-256 `27019d04bf6d591bd53ee9ca2e6fecb4c4632bf509b1f528127801fc4e1f8002`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/persistAccounts`；body `19`；code SHA-256 `90399b76f7d0fa1593b054123860151537c08513191813cd409d87c29cc68454`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/storageStatus`；body `20`；code SHA-256 `061341abe1b924cb7bd3bb8bba59949a4eb0d323bf723942795c71e0e55691c7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-23`；body `21`；code SHA-256 `81e34c90a350c6a43354af20f5d245dddc1d266d0a8c6fb7771f346ef4031569`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/resumeEntry`；body `22`；code SHA-256 `785dcd6ff95295a35dfed3a795f6ebdc646f987fddd0a1579fcb70ffde5f1ff5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/invalidateEntry`；body `23`；code SHA-256 `6bcb6523745137640ba59a9fda2d7bbfe319e8aa6f999bca339c82d8da792c6f`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/accept`；body `24`；code SHA-256 `d5ba21746d0e2d10e448f4b85a463160f6c261709e7226fa9334987197b0f518`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/switchAccount`；body `25`；code SHA-256 `ea8ac8549f7c4239f0d0c76685861ca5357ff110ef05d53d35993d3161fe1002`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/removeEntry`；body `26`；code SHA-256 `c0faa766888c21206bd9df439383a076309e52840aed20c00979f57997f6ac86`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/continueGame`；body `27`；code SHA-256 `b68897a92a08bd3adee9708b7c3a4a6e3a31cd2459559917f144638219f87d1e`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/navigate`；body `28`；code SHA-256 `9ddc02859d364a94ac9ae624f6217b833aa3005c94f4f5d9c565904d7c1c870c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-31`；body `29`；code SHA-256 `7fecea38dd3896bf87e351c0f03212063b0ed353d273a2195a0aab61d2b2f8c2`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-32`；body `30`；code SHA-256 `8d9076abf1c292288254240faf1e45b57c12d1877eff5ad2b02d8e174b556651`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/detectLocalSave`；body `31`；code SHA-256 `fd580e57b0855836ac6df4f9870e03c9ba86454c92a4fe114be61e3930e6e447`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-34`；body `32`；code SHA-256 `97aa21983897fc990c30c4a69395436a7cba733bc0147e26cd774d14a90edf13`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-35`；body `33`；code SHA-256 `45644a0b3482a3000188042a7f43468db9acadec94be747ff3526d0d4cdb5b5c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-36`；body `34`；code SHA-256 `ee8b4daf99e9d1a96b24f4a1f4df38e74a55bd7560086f1e5f5f9dd04d6754bf`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-37`；body `35`；code SHA-256 `3abbfe05707156b6d1d4bd902f16b6e5f9a10836b973f00e4d57a7e6197925e0`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-38`；body `36`；code SHA-256 `610e0b45ac711297858b377ca2756302784234c86f82053ebba810e5e0f5c2d5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/request`；body `37`；code SHA-256 `5a89ee133b9ea7f4d97cdfe39d09675480b32d021110e9a58ef45a433b28c315`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/cancelNetwork`；body `38`；code SHA-256 `ea7bb63812fc4e12a85994b9e8077f753173637f8fce9915d1ab3abca74e04cc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-41`；body `39`；code SHA-256 `e85edae24999d4281d6c29833b707d87a87faa5765e71a9795c9b2410bad9785`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-42`；body `40`；code SHA-256 `d77582a5e73db9aaee5c985b62abe0bd5e2b0cb6301619fb2a5b635e04242b43`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/submit`；body `41`；code SHA-256 `9f4fc36de1908a5a032e7535817bb615213f7b38269395be3c54a0d7a9d7ffc4`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-44`；body `42`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-45`；body `43`；code SHA-256 `0d0eced91e1e96790ed0aed5cd51afc8ae43a24497af0a48552a6b87b4f3153f`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-46`；body `44`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-47`；body `45`；code SHA-256 `216e5ddc4034c8bb8d3063d58c54220b8ed2c6343f5a6a2e0555606d45da3dbc`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-48`；body `46`；code SHA-256 `575f08740cfa89112e68efa5872ae18e76b67c796f8e298340709c36aeb96ed0`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-49`；body `47`；code SHA-256 `f908ec72ff40a13cdf6d873c6a54564c919b56b8c3e2616d87aa38d6fe3215d7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-50`；body `48`；code SHA-256 `8da3fa085fe7c5e9bbc511925d3365e3d74ef4ea64b2ea149e6b23c7716f6009`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-51`；body `49`；code SHA-256 `b45d878e8649a852e9286daa5142951e70eb016a83b5ff577da8a613e5f2bff2`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-52`；body `50`；code SHA-256 `9bf13cf33328f7a01e3a811a97782463228dcbf2f187dda63bdcb0c2728fb09e`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-53`；body `51`；code SHA-256 `051f279231f1009b4bf9a2a63a75f5921c2f671db98879ced2a37f0ffd665d61`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-54`；body `52`；code SHA-256 `a010875f9cd0c61f307b83476eb6985ed95776a0091b1c87e261a61b462e172d`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-55`；body `53`；code SHA-256 `7390cfcd0761681db5df96bd733889a32352e7eadc4a15e32715ce3f307c7783`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-56`；body `54`；code SHA-256 `193335d671cb1d17fb3582038efc4bde269da02417ed22318099b1c66dd2e31c`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-57`；body `55`；code SHA-256 `c7835be95ad5b21a3790acb5c2ac873847276217388b960cfce37bacca61fa88`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-58`；body `56`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-59`；body `57`；code SHA-256 `3fb57d7fbdef07fc874e9833703993c800e985a69dbd15c9b14d2302d504ee2b`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-60`；body `58`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-61`；body `59`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-62`；body `60`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-63`；body `61`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-64`；body `62`；code SHA-256 `240d4eefbbb3c79029e1fd538a59b603947a6603f6e6f98193e45dde300a6da7`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-65`；body `63`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/render`；body `64`；code SHA-256 `8c5b13b79a33ec3ca51ae28695bdca9dc90f22e29c8f1e9444fbd7bf1bb40d9a`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/expiryLabel`；body `65`；code SHA-256 `00bab8214b964c4d66f81c2506ef7b7355739dceb9fa55500db7087ad2fc916e`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/wrappedLabel`；body `66`；code SHA-256 `ccb0c76428177e31d51333a53c45fe7b41e07bccd83c2dd63bea66c066276e52`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-69`；body `67`；code SHA-256 `871e799be5250427914150faffdeeeb84fb5294430e01a1c6aa50079478f6620`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-70`；body `68`；code SHA-256 `eb40bef7a0aea2f69bd09fa75ecdc8c80e8e88269f2525c7c2cf87c446144d2d`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/accountRow`；body `69`；code SHA-256 `4dbd55b18cc9e9b4caf0e38954d97db01cabec3a0d50ad50828b3f5d50baafbd`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/resize`；body `70`；code SHA-256 `5ad84a0574cad13f67ca23215ba62f4f4c0f472b945b48f55e551a47aa3ef4da`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-73`；body `71`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-74`；body `72`；code SHA-256 `0197753d0e9812b3f45bcb8f999a18ce4b1d339812f5ea145bd96cefe7724c3d`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/tabs`；body `73`；code SHA-256 `4068318d6e65a9465852904f333d0b8829c11b8bf644650299c1ab6c3a6bdea5`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/playerCard`；body `74`；code SHA-256 `169790c429217a91e7422472a06e62f633b62cb44d9fed683fe7e4ca8a19adff`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-77`；body `75`；code SHA-256 `851e464025009e602002998346d59cd5bfc301855adca0fbc5902019dcf51512`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-78`；body `76`；code SHA-256 `4418daba7d453a3ce3c22830c5dbf1cac5caf7002078807adb4fb95bc7d3b127`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-79`；body `77`；code SHA-256 `175996617a13da655722071ef237c96f77c2dcc8eca0d254b489d7c540c7e4f9`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-80`；body `78`；code SHA-256 `44cca709b4544cffee7ed8e47d3be804ed31d0f233cd5094f4d0da910787d57a`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/input`；body `79`；code SHA-256 `065e4c969c2c6071f46e7df8e1fe80260920d4ea9ea5e327c64092e07a321fbd`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-82`；body `80`；code SHA-256 `98b32818b9107c82c4bdb413e21fb328f3a20ead723c88f1c1e1a6ccb8775a46`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/checkbox`；body `81`；code SHA-256 `34c53e9f53372d02f38ca8640010d7a70d000390c076041e3c4bea8a8ae2e311`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-84`；body `82`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/button`；body `83`；code SHA-256 `da3d7b0dfe4a1246f652407a9efdc0f2d78e9d8cbbbd2eeb8b6206f0535e8d47`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-86`；body `84`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/link`；body `85`；code SHA-256 `ba91dc18405531df9326e3cdcfdd156e52940b11ef19c31e02d22abb7edd62ae`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/label`；body `86`；code SHA-256 `1459c3b464ff6e800621e2e30832f500a1cad39eee9ce5c50fedbb678ad10cdb`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/rounded`；body `87`；code SHA-256 `3027be937c36d30681bbe37e269ee7c3958c5a8e788effd72861e9a877956de2`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/line`；body `88`；code SHA-256 `17248c1be261d0720a07c50ca5f74adf4faf11b7b6c07cae067ea19b458908ab`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/badge`；body `89`；code SHA-256 `93e2db8d9953fef8391b9c5a9a0c46d90d435cc687f37be62c87e44326e0712c`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin$/<cinit>`；body `90`；code SHA-256 `13b3c1289ac932eda376540011233d08a3397e22ce849253e9e4b5331dc35a57`；已收文本。
  - `cn.account.PlayerLogin:PlayerLogin/<ctor>`；body `91`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.account.PlayerLogin:anonymous-method-0`；body `92`；code SHA-256 `6c73681b8c49cc4aec2b71ff2f72b1beffb2b73827b1d01b2632a2b74a1346d0`；已收文本。
  - `boot_ffc6:TitleMenuDialogContentView/setupContents`；body `37085`；code SHA-256 `77dcedbfbea53661d3755c303efa7ab2bc8093983c8e6068fb11f439b159db92`；已收文本。
  - `boot_ffc6:MenuTopScene/createMenuListData`；body `77056`；code SHA-256 `628e347f457027585c6e34dc8a57651736f4ed6b1c2be611c1ede2c39e854098`；已收文本。
  - `boot_ffc6:DevConfig/getSaveDataKey`；body `91815`；code SHA-256 `18cef2072e7760043f1430a73565f662b544a7d1346632e001953dc2fe3fb4d4`；已收文本。

## 42 游戏服务器地址重指向

- 对应目录：[42-private-server-route](42-private-server-route/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:24-29`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_self_profile_public_apk.py` → `42-private-server-route\source\build_self_profile_public_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:DevConfig_gf_android/<ctor>`；body `91893`；code SHA-256 `aee7494661c43707178b8d042fe0c853dea722eddf3cb7483dd1893dfb244c00`；已收文本。

## 43 个人资料关注按钮可见性修复

- 对应目录：[43-profile-follow-visibility](43-profile-follow-visibility/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:14-18,83-95`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_profile_follow_lan_rootfix_apk.py` → `43-profile-follow-visibility\source\build_profile_follow_lan_rootfix_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:PlayerProfileView/refreshFollowRelationButtons`；body `78965`；code SHA-256 `31bd383995f6ff26867e53ca9d51fd3d55da1fb4eb86936e6d56a6387aa80af6`；已收文本。
  - `boot_ffc6:OtherProfileLogic/applyButton`；body `79102`；code SHA-256 `d5bb4ff4652ef7484c3d2f697e2c1fde41e6bef54ee664960acfe8741c7c825c`；已收文本。

## 44 关卡属性耐性入口

- 对应目录：[44-quest-element-resistance](44-quest-element-resistance/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\README.md:14-18`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\build_channel.py` → `44-quest-element-resistance\source\build_channel.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\build_apk.py` → `44-quest-element-resistance\source\build_apk.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\src\cn\rules\QuestElementResistance.as` → `44-quest-element-resistance\source\QuestElementResistance.as`。
- 最终方法体实证：
  - `boot_ffc6:BattleQuestBaseImpl/getInitialEnemyConditions`；body `21496`；code SHA-256 `36116b39b8e406997d649d04c5d127c9cddca89c2ec6a848fbb8dfdd647e3416`；已收文本。
  - `cn.rules.QuestElementResistance:QuestElementResistance$/parse`；body `0`；code SHA-256 `17f628f2111e65e0857c51fc837669a933be8ec2557ef2a85ef19c6ddf91cd7d`；已收文本。
  - `cn.rules.QuestElementResistance:QuestElementResistance$/apply`；body `1`；code SHA-256 `ef924e6c2b73679d06650fb71f9159ca0ce2372d2485195abc6c24c682341bc8`；已收文本。
  - `cn.rules.QuestElementResistance:QuestElementResistance$/<cinit>`；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.rules.QuestElementResistance:QuestElementResistance/<ctor>`；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.rules.QuestElementResistance:anonymous-method-0`；body `4`；code SHA-256 `65bb9a4ab560f23ed321a6778500f5d6c01cf44a18b5b465c6229d0f316c8439`；已收文本。

## 45 角色像素按frame.scale显示

- 对应目录：[45-render-frame-scale](45-render-frame-scale/README.md)。
- 首发/最终版结论：v17以前；具体编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\README.md:3-24`
  - `D:\WF\out\q1056\rv4p\client-patch\offline-android\base-lock.json:103-129`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`
- 已收源与构建文件：
  - `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\build_render_scale_apk.py` → `45-render-frame-scale\source\build_render_scale_apk.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\patch_memberview_site2.py` → `45-render-frame-scale\source\patch_memberview_site2.py`。
  - `D:\WF\out\q1056\rv4p\client-patch\offline-android\render_scale_pcode.py` → `45-render-frame-scale\source\render_scale_pcode.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberView/<ctor>`；body `60618`；code SHA-256 `bad0f9ea0fb66f638029fb96c26b2c67b9df352f43265aed6603610eaafc1b35`；已收文本。
  - `boot_ffc6:PixelArtCharacterView/spriteSheetLoadCompleted`；body `92300`；code SHA-256 `05389cca6b968bcc6097e3cb4054636a1ffc132cff35f500449a9c285e669317`；已收文本。
  - `boot_ffc6:CharacterCellView/drawWithAdvanceFlag`；body `65790`；code SHA-256 `beedce9917da57caa8d1d65576cc86ea91a18540a14cca0979e3fcd1cda03fc5`；已收文本。

## 46 通用Rush原生排行榜

- 对应目录：[46-rush-native-leaderboard](46-rush-native-leaderboard/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\README.md:22-58`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\patch.py` → `46-rush-native-leaderboard\source\patch.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_apk.py` → `46-rush-native-leaderboard\source\build_apk.py`。
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_navigation_apk.py` → `46-rush-native-leaderboard\source\build_navigation_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:RushEventTopScene/run`；body `71069`；code SHA-256 `92018c3f00aa31ce271987b8f00fab9c07dd57c60cd158064c514ebf52b1ce9d`；已收文本。
  - `boot_ffc6:RushEventTopScene/buttonClicked`；body `71083`；code SHA-256 `ff1399e1d817506365d54528bbb528ec90710b6081a2336e86ac6e7edecdceb4`；已收文本。
  - `boot_ffc6:RushEventTopView/run`；body `71087`；code SHA-256 `64c20d3f9cba4969835d634d5acae79326dfbc8ca883556d8ec0bf1d956db9a9`；已收文本。
  - `boot_ffc6:RushEventRankingPartyScene/preparation`；body `70995`；code SHA-256 `290e64aaab3a904ad5dc4566dcdc79548cb2dc653c5a1390e0d07ea449368a11`；已收文本。
  - `boot_ffc6:RushEventRankingPartyScene/run`；body `70993`；code SHA-256 `778d46660d1ca60f0e3ffbbd1e40ac4f166cbdb15ae567da33c4e42b7a49d351`；已收文本。
  - `boot_ffc6:RushEventRankingPartyScene/buttonClicked`；body `71002`；code SHA-256 `9f1f3c2d5510b4d96e6370957a25a792ee847e085a144548934179eb32ef7a53`；已收文本。
  - `boot_ffc6:RushEventRankingPartyScene/copyPlayedParty`；body `71000`；code SHA-256 `e44d600bf617c0b100dbc4b2aebadb9f977a72d9b0a4f651719f9627f4cdef00`；已收文本。
  - `boot_ffc6:RushEventRankingPartyScene/afterTransition`；body `71003`；code SHA-256 `52dc974bbe75f7597e6160539574f2fc1949096d17f93553a880646b35bc85b7`；已收文本。
  - `boot_ffc6:RushEventRankingPartyView/run`；body `71012`；code SHA-256 `40f0a147bbd0b4051806625c59269e0e113a777b1030be101aec2014ddd148c2`；已收文本。
  - `boot_ffc6:RushEventRankingPartyListView/createListCell`；body `71023`；code SHA-256 `046c2ba2f8755a08affa59456220138a29d36ce4cd62f7edd07f12f6dc33e231`；已收文本。
  - `boot_ffc6:RushEventRankingPartyListCellContentView/run`；body `71042`；code SHA-256 `795e4692235094e46b9b04d0cd39508047f3fc6be9d10d1d37d82476f5dd0d0b`；已收文本。
  - `boot_ffc6:RushEventRankingPartyListCellContentView/apply`；body `71047`；code SHA-256 `6d23b6d82f3c00abe461e557fc4e23b322e3ff58ca1df89df9a37fef2e596e6a`；已收文本。
  - `boot_ffc6:RushEventRankingPartyListCellContentView/resizeWidth`；body `71043`；code SHA-256 `da79dca455460c5aa3c34c784209bc43d0c88fd18a33b20ab6fb3e53aec23153`；已收文本。
  - `boot_ffc6:EventRushRewardRealRemote/<ctor>`；body `48465`；code SHA-256 `36411b6694c06c1578848c535b0fe243de22ae3bdb643d27d8e30bbb3be17b20`；已收文本。
  - `boot_ffc6:EventRushRewardRealRemote/successHandler`；body `48463`；code SHA-256 `a558b9711da96a1308e26b52d355d5f9f540d642ff2f448767e8d2feb8fe6384`；已收文本。

## 47 跳过渠道SDK正式登录

- 对应目录：[47-sdk-dummy](47-sdk-dummy/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\README.md:9-18`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`
- 已收源与构建文件：
- 最终方法体实证：
  - `boot_ffc6:DevConfig$/<cinit>`；body `91829`；code SHA-256 `ad5151cd172ed8b225a6542c4cfd9eef684164fee1a102804b18fecab6a21187`；已收文本。
  - `boot_ffc6:ChannelSDKDummy/startLoginServer`；body `7174`；code SHA-256 `167fe9b72ae4454ada8b7ab0081343983a6cc5f5c9469bf15e0272bda3464b8d`；已收文本。

## 48 特殊SET编辑标题C8601修复

- 对应目录：[48-set-edit-title-c8601](48-set-edit-title-c8601/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py:19-75`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py` → `48-set-edit-title-c8601\source\patch_set_edit_c8601.py`。
- 最终方法体实证：
  - `boot_ffc6:PartyGroupEditSceneView/refreshPartyCategory`；body `77565`；code SHA-256 `52fb8029eaaee239942cbfcfdd7fee9b9c51c3b35e3007e77566c36765899a3b`；已收文本。

## 49 活动商品成员索引与最终快扫

- 对应目录：[49-shop-event-product-index](49-shop-event-product-index/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v30-perf2 S1；v17 索引接入保留，productIds 方法最终由 S1 改写。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\README.md:14-22`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py:28-123`
  - `D:\WF\perf-v30-20261015\REPORT.md:307-385`
  - `D:\WF\perf-v30-20261015\REPORT.md:458-480`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\patch_swf.py` → `49-shop-event-product-index\source\patch_swf.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py` → `49-shop-event-product-index\source\perf2_patches.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_apply.py` → `49-shop-event-product-index\source\perf2_apply.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_core.py` → `49-shop-event-product-index\source\perf2_core.py`。
  - `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py` → `49-shop-event-product-index\source\build_perf2_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:ShopProductRepository/getAllProducts`；body `25379`；code SHA-256 `d876a9c9842dd16661c24188b71c718219f74d316843d328e93273dad906ad2c`；已收文本。
  - `boot_ffc6:ShopProductRepository/existsEventItemInQuestEvent`；body `25381`；code SHA-256 `bc3956a4e87ea5c6878008d0ec2dde0524030064e5ba9062cb92a9090ccb63cb`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/eventKey`；body `0`；code SHA-256 `060577dad26bcf7e5a1f295841a7fbda571b3f927b972001413df09af597a70b`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/productIds`；body `1`；code SHA-256 `a7bdffc161992fc7829e8b467685a35db8bc3c4d998c569c5eee56185e4d8b2a`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/hasProductsOrBox`；body `2`；code SHA-256 `8a3702c553e281fb673a5f8092b7ee1fd86bf434a426ed7ee9cdb6b6917ed354`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/sideStoryExists`；body `3`；code SHA-256 `69a0cb3068196578dfcd3289fbb9905fa1dab91285eb495a957c905a8cdf70da`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/shopTopExists`；body `4`；code SHA-256 `8d9a436a9e936ed6ca8199570db0e44ab22c8605ddb668492353db1ea83cd1d8`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen$/<cinit>`；body `5`；code SHA-256 `3f53edde9e8f5e3717157140d1de36723d14de92e557ccbaada2b93905f55f9f`；已收文本。
  - `cn.shop.ShopFirstOpen:ShopFirstOpen/<ctor>`；body `6`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.shop.ShopFirstOpen:anonymous-method-0`；body `7`；code SHA-256 `7bbd992deb307d33a9aa565267e37d0031b92079e037272afd778d3ef176231f`；已收文本。

## 50 商店与文件夹存在性短路

- 对应目录：[50-shop-existence-short-circuit](50-shop-existence-short-circuit/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\README.md:24-36`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\patch_swf.py` → `50-shop-existence-short-circuit\source\patch_swf.py`。
- 最终方法体实证：
  - `boot_ffc6:ShopTopScene/existsExchangeableEvents`；body `81069`；code SHA-256 `e313a96606a3092109dc5c01e28d0e03b41fedfc298cf3206dbaaaa37913bf2d`；已收文本。
  - `boot_ffc6:EventItemExchangeTopScene/getListSource`；body `72076`；code SHA-256 `465163db1e7254f58e75572a423d5a59a5d5b7511f7daed41d0d2e9720c47446`；已收文本。

## 51 标题CNtips_b隐藏

- 对应目录：[51-title-cntips-hide](51-title-cntips-hide/README.md)。
- 首发/最终版结论：v17 以前；具体 APK 编号未核实；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:34-48`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_title_cntips_apk.py` → `51-title-cntips-hide\source\build_title_cntips_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:TitleView/refreshHealth`；body `82390`；code SHA-256 `fedd34ccb3e026ff9f9c176ef305f22a0c351417aed8a01b1fbe028563090a68`；已收文本。

## 52 测试服独立包与准入身份

- 对应目录：[52-testserver-v17-identity](52-testserver-v17-identity/README.md)。
- 首发/最终版结论：v17；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3a2d10f4-784b-4e40-914d-69525c153b6e\scratchpad\apk\make_test_apk.py:1-19,59-98,125-148`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3a2d10f4-784b-4e40-914d-69525c153b6e\scratchpad\apk\make_test_apk.py` → `52-testserver-v17-identity\source\make_test_apk.py`。
- 最终方法体实证：
  - `cn.admission.ClientAdmission:ClientAdmission$/now`；body `0`；code SHA-256 `97e276a3ed4c4fcccf2b212f6619f2e4f4395eea003ef18b5cc3f9a3c9d58df8`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-3`；body `1`；code SHA-256 `204e6fe8400868d544fb7174a2eef145bf6eadec596da4df794a628ec54abfc5`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-5`；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-4`；body `3`；code SHA-256 `734c611a87932cbcc0c59e64b4e4e80f9b71836e975e2adc64c2b0868478e5b3`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/state`；body `4`；code SHA-256 `ec68b8009829286f1f9bdc695f8bafce6a5bd67bf11d243ccc9ab1f769818f77`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/observe`；body `5`；code SHA-256 `625bb69a6ae976ddf2a25be4da89f606e7461b3cc92ca6ca7bc3a0cd36d23b26`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/refreshSession`；body `6`；code SHA-256 `e3229ea5ad3242195002b91605d8ca95609c338745d89a5a2fe4ba014274639d`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/hold`；body `7`；code SHA-256 `4040161e4de3d334425aeb06f082dc7d0de7c6b7dfdab97392f63883eb2890ad`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-10`；body `8`；code SHA-256 `1097b3d7d90c1d791d8c7feca61fb01e5a8b03f0a2e2b440cc8d489c6e9a9849`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/failQueue`；body `9`；code SHA-256 `cb6a9cf05f3f396cd8040e7eda9e9d416eb4614af4126648e45c567f96ae82bd`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-12`；body `10`；code SHA-256 `c4457758bebbe6c31cc233c87cdf2be9fe6b6336b7978e7fa57801a6e1ab2f07`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/beforeQueue`；body `11`；code SHA-256 `8b0ffcd1ec5f48f50d1c5bbaeb34389e435adb2e2784643ee799dbf239b680ba`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/queueCanceled`；body `12`；code SHA-256 `73c00264be42f8e06a4b59e4ace306826a569ceaa90f761decbe8644f3b15686`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/attach`；body `13`；code SHA-256 `9990f6e9b864e9cfc9aaa24fe58033a46b121a59e30e3e9965c4b01a529eb273`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-17`；body `14`；code SHA-256 `e7a2b7b56f85f2f362f04108193b378fcce556c63a23e87e5e1658a1622d7589`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-16`；body `15`；code SHA-256 `79b15135679a0a3668a7cb632cb772c8d99e70d995c816d72c2ce80c6303ebf8`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/beforeSocketConnect`；body `16`；code SHA-256 `fba17aa746758d590f96197d1b6805b91dad7c6d74ec3af6bd0b71047f142e2a`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/socketClosed`；body `17`；code SHA-256 `a90a66d4c36102e4715300ab178262ed2d8a16c7c16ce6a264702a385d822b01`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/socket`；body `18`；code SHA-256 `745c492994c401a9ada5850c6e01368081e1875b463c1732a8dcd6f46cdf7250`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-21`；body `19`；code SHA-256 `24ab556fa66be165ff3c23f843e14881aecdfe6e25cfdf08a6ddcbcf34f5ab53`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/inspect`；body `20`；code SHA-256 `74ffc49d4fa2df67792dce63f054bc9ca8a0d90183dfcc4f217676037ef2e778`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/forwardAdmission`；body `21`；code SHA-256 `2e438fb4728cdda6cd095102159b2845f00cbea21b7cdd4ef2201a7149b27f33`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/cancelLoad`；body `22`；code SHA-256 `1c78967f567b3419e35d719fcb4374d22d206c33a007dc83a637b7a40e18b7a3`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-25`；body `23`；code SHA-256 `bdcc34080cbb66c7305a88091d42be4538542a51a04561466af9168f3c7f8b97`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-26`；body `24`；code SHA-256 `8230620bee3081b3b611d822f717fa089590b3e9511ea8d38680064ffa6bcfb6`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-28`；body `25`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-27`；body `26`；code SHA-256 `6baf8e462ba41c179b27a07f1287bb7eacf1add34f90414dae8fee545f545f9d`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-29`；body `27`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/load`；body `28`；code SHA-256 `8e98d09dc0c9a26faee11ee52b453b50b0ff8f6f3a2be21ffc419f6c3161be86`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-31`；body `29`；code SHA-256 `b98010f3f8065a40a3dc203c1fba8d9fd7001365b6e2a116eb78aa2f8e36c2a4`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/transport`；body `30`；code SHA-256 `7263a26a1637526c79986ceea8c0101fb31087ab29a27f76d7ec1ba9a4d3c422`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-33`；body `31`；code SHA-256 `2c29176684a3c7eb585190e92927323e52959c75174b26397a57aaee78ff28a2`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-34`；body `32`；code SHA-256 `8f52e784449ba13884bfdf07a18b8b6cb8c7a3d4d2f20bea65bb70055524adc8`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-35`；body `33`；code SHA-256 `7193f08c0ba9ad156a157a0e33c7d07b6a4f5447e6cae8d1a0a8f3e00c327ba1`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/sendAbsolute`；body `34`；code SHA-256 `5b2c44179255fa8e12571fea2577ec5571d1931692f3057ebdc54b3bd49510d0`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/hmac`；body `35`；code SHA-256 `40fbb309abb2da2cef9bbc933c47f2ecf6c85d0f6d171d74a39c41aa12192ece`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/sha`；body `36`；code SHA-256 `7af259c42ff5b9dbcf2ac92aa0a7dede800b3c715f65b4b0411266a7cc8ccf8a`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-39`；body `37`；code SHA-256 `db5e9acbd42a04201faf2252c3fa3289e7f07ced4ac8f981eefb6586851064b8`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/show`；body `38`；code SHA-256 `bfc76919e096d193bfd884cc1be9c17f64583cbb5b2c4d7bda00f15f8e8877fb`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/block`；body `39`；code SHA-256 `35e0d6f62087471395c7644b3d82ba84806ee84d175bfb03ced61e1d1600239a`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/raise`；body `40`；code SHA-256 `8802f50f4aa50e131dfc03dde2c7f1c49bf7031d9df50547771b53c8f034770e`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission$/<cinit>`；body `41`；code SHA-256 `b113e3feae083e22979f60af0ec362c92b534e08fb9a245846943c4aa1746a7c`；已收文本。
  - `cn.admission.ClientAdmission:ClientAdmission/<ctor>`；body `42`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.admission.ClientAdmission:anonymous-method-0`；body `43`；code SHA-256 `0c518f21f1ac3db375294c0697fd152da8181f234b3ec07d11905e4b178a0925`；已收文本。

## 53 强化充能速度固有上限

- 对应目录：[53-charge-cap-unique](53-charge-cap-unique/README.md)。
- 首发/最终版结论：v18；v25 max-first 最终修订。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v20.build-report.json:174-175；v20 修正公式`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:298-312；最终 max-first P-code`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `53-charge-cap-unique\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/getStatModifierSkillGaugeCharging`；body `60305`；code SHA-256 `37fbc1b1aac0037ec9b75147e2bd7411d301be0a37e526e2a2d2075ad0fcda1f`；已收文本。

## 54 凯尔队长直击固有参数倍率

- 对应目录：[54-kyle-direct-multiplier](54-kyle-direct-multiplier/README.md)。
- 首发/最终版结论：v18；v21 参数化；最终随 v28 组合源继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v21.build-report.json:163-167；v21 参数化公式`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:266-284；最终公式和队长限制`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `54-kyle-direct-multiplier\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/scheduleDirectAttack`；body `60192`；code SHA-256 `223640cd78b631640313859bb39410d270696644f058435cd1258c88c9f30576`；已收文本。

## 55 凯尔 PF 追加命中标记静音

- 对应目录：[55-kyle-pf-marker-silence](55-kyle-pf-marker-silence/README.md)。
- 首发/最终版结论：v18；v25 修订；v28 源体与 v33 相同。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发能力与 v17 基线`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:285-296；最终只保留 PF marker 分支`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\build\kyle_pf_marker.py:2-3；数据标记用途`
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\build\kyle_pf_marker.py:14-25；marker 数据编码和作用范围`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `55-kyle-pf-marker-silence\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:EnemyImpl/applyAttack`；body `53486`；code SHA-256 `989cd6d4d05f0e88c4073ad3d6107bff66c2e8438247e14097b6144ed56e957e`；已收文本。

## 56 凯尔队长四段以上直击合并结算

- 对应目录：[56-kyle-direct-merge](56-kyle-direct-merge/README.md)。
- 首发/最终版结论：v20；v25 仅凯尔队长最终修订。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v20.build-report.json:174-175；v20 首次 merge_min_segments=4`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:336-366；最终队长限定、补计数和韧性/Fever恢复`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `56-kyle-direct-merge\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/scheduleDirectAttack`；body `60192`；code SHA-256 `223640cd78b631640313859bb39410d270696644f058435cd1258c88c9f30576`；已收文本。

## 57 Boss 韧性击晕条常显

- 对应目录：[57-boss-stun-gauge](57-boss-stun-gauge/README.md)。
- 首发/最终版结论：v22；v22 原行为保持。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v22.build-report.json:2-13；v22 新增 boss-stun-gauge-v1`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:367-371；最终 kind=3 return true`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `57-boss-stun-gauge\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:EnemyImpl/isBattleDebugToughnessPointGaugeVisible`；body `53155`；code SHA-256 `f09ff17192f74bd8dc64a8bcac3263e5c5aba324b13b6cb1d4af2263874ddc82`；已收文本。

## 58 hidden_ 固有图标与翻页计数过滤

- 对应目录：[58-hidden-unique-icons](58-hidden-unique-icons/README.md)。
- 首发/最终版结论：v23；v25 同步翻页计数最终修订。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v23.build-report.json:2-14；v23 首发`
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:372-431；最终过滤和计数同源`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `58-hidden-unique-icons\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/getConditionsIncludingOuterEnvironments`；body `60430`；code SHA-256 `582e23ac1290798c11380451f6c0cdb7a894eb1719e3ef82dd01f3e34787af31`；已收文本。
  - `boot_ffc6:MemberImpl/getTotalConditions`；body `60292`；code SHA-256 `405cc8b1a873c66be00b5dc4b84c7e6b0acfbe84e2f673644fcbf6a9614cb7d5`；已收文本。

## 59 自动倍速重复写盘跳过

- 对应目录：[59-autospeed-store-skip](59-autospeed-store-skip/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:438-444`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `59-autospeed-store-skip\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:MiscDataLogic/setAutoSpeedLevel`；body `19909`；code SHA-256 `c21ad66afd1e438cbfefeee33c3a7b1d37f9d66807b70cae51f51d07b8164502`；已收文本。

## 60 角色表每帧最多应用三格

- 对应目录：[60-character-apply-throttle](60-character-apply-throttle/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:528-535`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `60-character-apply-throttle\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterTableView/draw`；body `66178`；code SHA-256 `e4f6b5269662be8323bb6f91cd00e124eb4e0cc7f33c619284279a603a7fc6fb`；已收文本。

## 61 屏外角色格绘制计算跳过

- 对应目录：[61-character-offscreen-draw-skip](61-character-offscreen-draw-skip/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:536-548`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `61-character-offscreen-draw-skip\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterCellView/drawWithAdvanceFlag`；body `65790`；code SHA-256 `beedce9917da57caa8d1d65576cc86ea91a18540a14cca0979e3fcd1cda03fc5`；已收文本。

## 62 远屏角色格动画更新跳过

- 对应目录：[62-character-offscreen-playhead-skip](62-character-offscreen-playhead-skip/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:549-562`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `62-character-offscreen-playhead-skip\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterTable/updateCells`；body `66116`；code SHA-256 `917156e5da4c81f2d395de7a76739eee259217f906fad883120ed91a8326fb8b`；已收文本。

## 63 角色可见集合与排序优化

- 对应目录：[63-character-rank-map-sort](63-character-rank-map-sort/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:563-605`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `63-character-rank-map-sort\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterTable/applyCharacters`；body `66148`；code SHA-256 `cc8f9aff1df3b621da06717d1cb401d93942ef2a6607978659544d97bdd85945`；已收文本。

## 64 五重首轮600帧宽限

- 对应目录：[64-five-boss-round1-grace](64-five-boss-round1-grace/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:614-626`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `64-five-boss-round1-grace\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleScenePlayingStateImpl/proceedBattles`；body `63135`；code SHA-256 `c0dc1c45f6587c6ae0017873763fd4047043537bbca406b92750f30d15860713`；已收文本。

## 65 149999四拍准备音轮换

- 对应目录：[65-gerald-149999-ready-voice](65-gerald-149999-ready-voice/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:445-495`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes.HudMemberStatus/update,CharacterVoiceLogic/createVoicePathMap,BattleCharacterLogic/resolveFollowingPathCollection`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `65-gerald-149999-ready-voice\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:HudMemberStatus/update`；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`；已收文本。
  - `boot_ffc6:BattleCharacterLogic/resolveFollowingPathCollection`；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`；已收文本。
  - `boot_ffc6:CharacterVoiceLogic/createVoicePathMap`；body `84274`；code SHA-256 `a3f3aa721b20af0547543fb26a0ab4227104248b6aee01289e66fea765dc14d7`；已收文本。

## 66 主城MSAA关闭

- 对应目录：[66-home-msaa-off](66-home-msaa-off/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:525-527`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `66-home-msaa-off\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:HomeView/<ctor>`；body `74852`；code SHA-256 `2b945c18710679255987f8b4aadb7f7483fdf89fc32d04e6db850baf269ef581`；已收文本。

## 67 编队与角色页无效日志求值跳过

- 对应目录：[67-party-ui-log-skip](67-party-ui-log-skip/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:519-612`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `67-party-ui-log-skip\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterTableView/present`；body `66173`；code SHA-256 `4d056fc151a6fe4d85a32ef408dc6ba7e79c9f41d1d8a3b80d12fff393091530`；已收文本。
  - `boot_ffc6:PartyCarouselPageView/apply`；body `66664`；code SHA-256 `6a70058f30d894e6ca6f3618609bd6fb3f748f73ab8784d76f7f01e0940b5ae3`；已收文本。
  - `boot_ffc6:CharacterTableView/applyPatch`；body `66180`；code SHA-256 `ef807c15a01668ec1b6ad0f3b64a368a8ce22965b3f614c68a8d7defee8c8591`；已收文本。
  - `boot_ffc6:CharacterScene/viewDidChange`；body `65499`；code SHA-256 `23cfe3a3d1f7ba64782551339141867b32a06a1ae575db8701a0ab4a5e479e02`；已收文本。

## 68 战斗日志仅保存快照

- 对应目录：[68-reproduce-snapshot-only](68-reproduce-snapshot-only/README.md)。
- 首发/最终版结论：v25；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:432-437`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `68-reproduce-snapshot-only\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:ReproduceFileRecordImpl/saveLog`；body `30917`；code SHA-256 `0796011b5ae3d02da88f76ddf37f768dd128df02d551834499305c3daf8f71e4`；已收文本。

## 69 图集超限递归分页

- 对应目录：[69-atlas-overflow-spill](69-atlas-overflow-spill/README.md)。
- 首发/最终版结论：v26；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:730-810`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `69-atlas-overflow-spill\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleStartProductionViewService/setupTextureAtlas`；body `38042`；code SHA-256 `7448e38e05aaeb9e4ff5f7b967ba8bd752e4373e819987fac8ba5da2debfe5e9`；已收文本。

## 70 本地资源加载GC四次减一次

- 对应目录：[70-local-loading-view-gc](70-local-loading-view-gc/README.md)。
- 首发/最终版结论：v26；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:627-632`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `70-local-loading-view-gc\source\wf_hitfx_silence.v28.py`。
- 最终方法体实证：
  - `boot_ffc6:LocalLoading/startChild`；body `38428`；code SHA-256 `77eb5495b8bd1c332701e4ed63920b5a792385ce776aeeb2145648ef28c6a598`；已收文本。

## 71 战斗图集合成分帧

- 对应目录：[71-battle-pack-slicer](71-battle-pack-slicer/README.md)。
- 首发/最终版结论：v27；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:633-654`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `71-battle-pack-slicer\source\wf_hitfx_silence.v28.py`。
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\src\cn\loading\BattlePackSlicer.as` → `71-battle-pack-slicer\source\BattlePackSlicer.as`。
- 最终方法体实证：
  - `boot_ffc6:BattleStartProductionViewService/prepare`；body `38045`；code SHA-256 `8eb9f901d73b20499ad2b97b3d7a72beab1eda5e0a9a98d480f7196320744c59`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer$/cls`；body `0`；code SHA-256 `a3e677a1c802473dbd619b5553c5fd68c7c0224f49ba78097694ad493f609308`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer$/start`；body `1`；code SHA-256 `da6b1a666d9644190ece4d3d1d614b800124b6ac2d35cc91955e64a8ac68cd5f`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/layer`；body `2`；code SHA-256 `8dfb780606e30bec6dd2b8d162193f3338baaba1de29154b0484c19c994fa169`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/newPage`；body `3`；code SHA-256 `dc4178f06c385b65758d47617da1935633570e8d6e0085265ca8135837a1747c`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/tick`；body `4`；code SHA-256 `6665e013c3efe3bc2579a89ea520ba40e90d2a6e30473d0bc2181644d55d2d4d`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/progress`；body `5`；code SHA-256 `23a77227a14a30753f2661aab87a536c3ef4e78920f84b2e0170afe967206338`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/packStep`；body `6`；code SHA-256 `e9c8879bf9e6cc3973e69815ee5e6175e875c479048ba8bd3fd2545377e5fa48`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/build`；body `7`；code SHA-256 `0512a7dd91952f85dea98b07d5e0d5f66542298558a1543d4abe7cae03d32f46`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/markLost`；body `8`；code SHA-256 `4c3ad09a1b7ce8a2ecebb28a99eccb5a2d8d329e994a62076e77897a45253049`；已收文本。
  - `cn.loading.BattlePackSlicer:anonymous-method-11`；body `9`；code SHA-256 `e5b5e4ff4f59b1bab0e521f78fe35113a640b885e5fee558118ac3592a8b7d24`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/drawStep`；body `10`；code SHA-256 `7706ddef0eab2b6499d1bce80627d6bac27e9c58e3b3d822c3ffbd88828fb7b4`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/map`；body `11`；code SHA-256 `ca868ee5b6ce68e7ea3970c9e19f4e3e27b759f9a6ae4f8b06f559f022989ed0`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/colorStep`；body `12`；code SHA-256 `138b4e2b5113b7e17ac6715deb3f11c5801345b5787594bbd410982b68b450fe`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/finish`；body `13`；code SHA-256 `993c0f2ed05bb88937dc9289a1f5014e19d34e823811b75549466690cfdd715a`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/stop`；body `14`；code SHA-256 `14114c129e4b392df2ac4d18dd2d33b44cbd06173d8bfe75279759b756bcb884`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/disposeAll`；body `15`；code SHA-256 `96d6ac7a17fd63d60f4679c1ca94f15a623694fda47327d9c46172fa8e51d636`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/abort`；body `16`；code SHA-256 `0c8f89b4efb9cab8bca11e71f508daee100c5894727b2d264650b097598be48b`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/fallback`；body `17`；code SHA-256 `145473185bf4ce42a1280bea911ca7c95aaea2bed281e45121983040b7778730`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/dumpStat`；body `18`；code SHA-256 `eac2a10b7d844a9a69a2f03b801a4c23f26ef6799d7de1163baf6c098e13b85f`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer$/active`；body `19`；code SHA-256 `abb54b1c3cbe42b50347f37336002a766b617e850ec9244c9fe35851accabc0f`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer/<ctor>`；body `20`；code SHA-256 `2d41a635ebdbaec17c25790d6f1710791abcc1d85000843df87a3a81dca420ae`；已收文本。
  - `cn.loading.BattlePackSlicer:BattlePackSlicer$/<cinit>`；body `21`；code SHA-256 `5bcaf4c4a3b43361e34bc3e4f5d9a001731074ca1073f8a7ccd325715ddcb78b`；已收文本。
  - `cn.loading.BattlePackSlicer:anonymous-method-0`；body `22`；code SHA-256 `1719c0768f2363ec9f8ebd4afaa61bffd019f7f04428410ecf85015c699c9e62`；已收文本。

## 72 转场GC去重

- 对应目录：[72-transition-gc-dedupe](72-transition-gc-dedupe/README.md)。
- 首发/最终版结论：v28；v17 已含且 v33 保留；具体修订编号未核实。
- 用途、位置、问题及依赖的原始依据：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:663-707`
  - `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
  - `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
  - `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- 已收源与构建文件：
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py` → `72-transition-gc-dedupe\source\wf_hitfx_silence.v28.py`。
  - `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\src\cn\loading\GcGate.as` → `72-transition-gc-dedupe\source\GcGate.as`。
- 最终方法体实证：
  - `boot_ffc6:LogicSceneTransition/deactivatePreviousScene`；body `31072`；code SHA-256 `96ee8a34ddee66156b98761c766815eeec8a24f4ca1dc350a4b7f42b924c40bd`；已收文本。
  - `boot_ffc6:ProductionLoading/resetAssets`；body `37884`；code SHA-256 `88f4837fd4a910380176d6fd9072c5236ea43dce3140a33ea6864346040330ce`；已收文本。
  - `cn.loading.GcGate:GcGate$/skip`；body `0`；code SHA-256 `a00223b7235ef27c13a66128ea077eba6f97da6225b702781cd0f3a87de5589b`；已收文本。
  - `cn.loading.GcGate:GcGate$/reset`；body `1`；code SHA-256 `c9ad1a6cdcf04b416ceac9b98f1740986e68e7a99be7544a1bb98a8682a85a4a`；已收文本。
  - `cn.loading.GcGate:GcGate$/<cinit>`；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`；已收文本。
  - `cn.loading.GcGate:GcGate/<ctor>`；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`；已收文本。
  - `cn.loading.GcGate:anonymous-method-0`；body `4`；code SHA-256 `52740a7b374657cecba183b68c1302d20c8510d24260a33589c73afd78cbc408`；已收文本。

## 73 联机停帧有限宽限

- 对应目录：[73-coop-bounded-grace](73-coop-bounded-grace/README.md)。
- 首发/最终版结论：v29-coop；v29-coop。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\coop-fix-20261014\REPORT.md:92-125`
  - `D:\WF\coop-fix-20261014\REPORT.md:274-288`
- 已收源与构建文件：
  - `D:\WF\coop-fix-20261014\client\patch_coop_grace.py` → `73-coop-bounded-grace\source\patch_coop_grace.py`。
  - `D:\WF\coop-fix-20261014\client\build_coop_apk.py` → `73-coop-bounded-grace\source\build_coop_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleDerailleur/getDeferralLevel`；body `62884`；code SHA-256 `84e04501423fa23b0caeb53235652347b2d0d780ce526e1d7793a027951cb570`；已收文本。

## 74 主表 key 下标字典缓存

- 对应目录：[74-master-index-dictionary](74-master-index-dictionary/README.md)。
- 首发/最终版结论：v30-perf；v30-perf。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py:18-25`
  - `D:\WF\perf-v30-20261015\REPORT.md:307-385`
  - `D:\WF\perf-v30-20261015\REPORT.md:458-480`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py` → `74-master-index-dictionary\source\perf2_patches.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_apply.py` → `74-master-index-dictionary\source\perf2_apply.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_core.py` → `74-master-index-dictionary\source\perf2_core.py`。
  - `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py` → `74-master-index-dictionary\source\build_perf2_apk.py`。
  - `D:\WF\perf-v30-20261015\tools\patch_perf.py` → `74-master-index-dictionary\source\patch_perf.py`。
- 最终方法体实证：
  - `boot_ffc6:MasterBinaryMap/getIndex`；body `5759`；code SHA-256 `c0afa6d54379daa2b32406e40218f4f556b7569179fe39db5146f2b710f4cfbe`；已收文本。

## 75 进战跳过状态全量日志

- 对应目录：[75-battle-skip-status-dump](75-battle-skip-status-dump/README.md)。
- 首发/最终版结论：v30-perf2；v30-perf2。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py:139-152`
  - `D:\WF\perf-v30-20261015\REPORT.md:307-385`
  - `D:\WF\perf-v30-20261015\REPORT.md:458-480`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py` → `75-battle-skip-status-dump\source\perf2_patches.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_apply.py` → `75-battle-skip-status-dump\source\perf2_apply.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_core.py` → `75-battle-skip-status-dump\source\perf2_core.py`。
  - `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py` → `75-battle-skip-status-dump\source\build_perf2_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:Restore/saveBattleRestore`；body `30966`；code SHA-256 `3dfc4482e515bf04da80ded65dab05ffda5a5c6e086a908b27b236f557d832fb`；已收文本。

## 76 编队翻页只建队员

- 对应目录：[76-party-flip-cached-members](76-party-flip-cached-members/README.md)。
- 首发/最终版结论：v30-perf2；v30-perf2。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py:155-218`
  - `D:\WF\perf-v30-20261015\REPORT.md:307-385`
  - `D:\WF\perf-v30-20261015\REPORT.md:458-480`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py` → `76-party-flip-cached-members\source\perf2_patches.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_apply.py` → `76-party-flip-cached-members\source\perf2_apply.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_core.py` → `76-party-flip-cached-members\source\perf2_core.py`。
  - `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py` → `76-party-flip-cached-members\source\build_perf2_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterUseCaseBase/getListCharactersInParties`；body `67041`；code SHA-256 `11161e17fbe198e02a7d2757ed4a72ecc37f65355895b5023da8af94c5f924d1`；已收文本。

## 77 兑换入口恢复灰显

- 对应目录：[77-shop-entry-greyout](77-shop-entry-greyout/README.md)。
- 首发/最终版结论：v30-perf2；v30-perf2。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py:126-136`
  - `D:\WF\perf-v30-20261015\REPORT.md:307-385`
  - `D:\WF\perf-v30-20261015\REPORT.md:458-480`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\tools\perf2_patches.py` → `77-shop-entry-greyout\source\perf2_patches.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_apply.py` → `77-shop-entry-greyout\source\perf2_apply.py`。
  - `D:\WF\perf-v30-20261015\tools\perf2_core.py` → `77-shop-entry-greyout\source\perf2_core.py`。
  - `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py` → `77-shop-entry-greyout\source\build_perf2_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:ShopTopScene/listCellEnabledResolver`；body `81061`；code SHA-256 `4c1d46648cfb44800021200cdf2a52e3d477919380f0c475544103f888ee73f1`；已收文本。

## 78 超限结晶突破按钮过滤

- 对应目录：[78-overlimit-crystal-buttons](78-overlimit-crystal-buttons/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:88-144`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:78-83`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `78-overlimit-crystal-buttons\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `78-overlimit-crystal-buttons\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:OwnedOverLimitLogic/getAwakingCrystalToOverLimit`；body `18063`；code SHA-256 `2e584914a2f67e60a268e62502f8e7af84a6a6e1e38af444b8de79c446470b34`；已收文本。

## 79 五星 101–120 内置经验表

- 对应目录：[79-overlimit-experience](79-overlimit-experience/README.md)。
- 首发/最终版结论：v31；v31。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py:70-83`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `79-overlimit-experience\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 80 超限全身台座路径

- 对应目录：[80-overlimit-full-pedestal](80-overlimit-full-pedestal/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:220-273`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:123-128`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `80-overlimit-full-pedestal\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `80-overlimit-full-pedestal\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:GeneralCharacterLogic/getPedestalImagePath`；body `17568`；code SHA-256 `1c5905b65f624a24c01cf58adeeb90c300a9e9ae965577c4b295c093f0be117d`；已收文本。

## 81 超限半身台座路径

- 对应目录：[81-overlimit-half-pedestal](81-overlimit-half-pedestal/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:220-277`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:138-143`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `81-overlimit-half-pedestal\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `81-overlimit-half-pedestal\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:GeneralCharacterLogic/getHalfPedestalImagePath`；body `17588`；code SHA-256 `0dc8e515702c2c3c77cca60549da8e063eec0785f89a57e503b5ddf41be6a28a`；已收文本。

## 82 五星内置等级上限表扩展

- 对应目录：[82-overlimit-level-cap](82-overlimit-level-cap/README.md)。
- 首发/最终版结论：v31；v31。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py:40-67`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `82-overlimit-level-cap\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 83 超限角色最大突破次数门控

- 对应目录：[83-overlimit-max-step](83-overlimit-max-step/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:38-85`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:48-53`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `83-overlimit-max-step\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `83-overlimit-max-step\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:GeneralCharacterLogic/get_maxOverLimitStep`；body `17542`；code SHA-256 `a1b57b4034b60def3d9b1a328b7ceb321157f45e5243c246353d733a7643ebab`；已收文本。

## 84 超限模式禁止重复角色突破

- 对应目录：[84-overlimit-no-dupes](84-overlimit-no-dupes/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:144-166`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:93-98`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `84-overlimit-no-dupes\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `84-overlimit-no-dupes\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:OwnedOverLimitLogic/getOverLimitState`；body `18061`；code SHA-256 `98f9c7121ac212729daaf7a0e9b740e2de275dcc26e2536ad4d8e1d63d023fd0`；已收文本。

## 85 超限结晶持有列表过滤

- 对应目录：[85-overlimit-owned-crystals](85-overlimit-owned-crystals/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:88-138`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:63-68`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `85-overlimit-owned-crystals\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `85-overlimit-owned-crystals\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:OwnedOverLimitLogic/getOwnAwakingCrystalToOverLimit`；body `18060`；code SHA-256 `2be9af1fa92ed8bb56a5ee90b9eb511f7f94c6941f38a223e406207e17be61b2`；已收文本。

## 86 超限台座图集追加

- 对应目录：[86-overlimit-pedestal-atlas](86-overlimit-pedestal-atlas/README.md)。
- 首发/最终版结论：v31；v31。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py:47-138`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `86-overlimit-pedestal-atlas\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 87 PF Lv4 弹板渐变和红光

- 对应目录：[87-pf-lv4-color](87-pf-lv4-color/README.md)。
- 首发/最终版结论：v32；v32f。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:294-374`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json:113-118`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py` → `87-pf-lv4-color\source\pflv4_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_pflv4_apk.py` → `87-pf-lv4-color\source\build_pflv4_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleFlipperView/draw`；body `58431`；code SHA-256 `379ac4029668dbf388a33ee321940f77837f1911d14c3f06f19f66c553377375`；已收文本。

## 88 PF Lv4 DSL 选择

- 对应目录：[88-pf-lv4-dsl](88-pf-lv4-dsl/README.md)。
- 首发/最终版结论：v32；v32f。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:127-158`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json:29-34`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py` → `88-pf-lv4-dsl\source\pflv4_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_pflv4_apk.py` → `88-pf-lv4-dsl\source\build_pflv4_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:MemberImpl/startPowerFlip`；body `60180`；code SHA-256 `0aaa43db85c048dda9784925de22fccc38068f638449fcb59938420f12fc2d6b`；已收文本。

## 89 PF Lv4 充能状态与提示

- 对应目录：[89-pf-lv4-ready](89-pf-lv4-ready/README.md)。
- 首发/最终版结论：v32；v32f。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:161-292`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json:58-63`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:40-56`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py` → `89-pf-lv4-ready\source\pflv4_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_pflv4_apk.py` → `89-pf-lv4-ready\source\build_pflv4_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleFlipperImpl/update`；body `58371`；code SHA-256 `850b7356ba86f981b98d73d4d3619484acf2e7b2b0ff9f4ee8814113b7e9b8f0`；已收文本。

## 90 Fever 结束跳过未开箭头

- 对应目录：[90-fever-arrow-close](90-fever-arrow-close/README.md)。
- 首发/最终版结论：v32g；v32l（B2 未变，B3/B5 最后改于 v32k）。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:413-437`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:80-85`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py` → `90-fever-arrow-close\source\feveritems_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py` → `90-fever-arrow-close\source\build_feveritems_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:YakumonoManagerImpl/deactivate`；body `61868`；code SHA-256 `be565848a5c9bccb1030b57a98799a4fde637418f8601d76009fc45aa3422e9b`；已收文本。

## 91 Fever 箭头换随机道具

- 对应目录：[91-fever-arrow-items](91-fever-arrow-items/README.md)。
- 首发/最终版结论：v32g；v32l（B2 未变，B3/B5 最后改于 v32k）。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:331-410`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:28-33`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py` → `91-fever-arrow-items\source\feveritems_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py` → `91-fever-arrow-items\source\build_feveritems_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:YakumonoManagerImpl/activate`；body `61871`；code SHA-256 `fd64527e90a488f108d36e1efc3b4164cecc10c2b0d575eade511a92d4def037`；已收文本。

## 92 Fever 道具 following 预载

- 对应目录：[92-fever-items-preload](92-fever-items-preload/README.md)。
- 首发/最终版结论：v32g；v32l（B2 未变，B3/B5 最后改于 v32k）。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:440-475`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:123-128`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py` → `92-fever-items-preload\source\feveritems_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py` → `92-fever-items-preload\source\build_feveritems_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleQuestBaseImpl/resolvePathCollectionForDashPanel`；body `21430`；code SHA-256 `6143a756bc032bd52230fa2d42efa799c0ba7b57796759a0848e7a70befceb98`；已收文本。

## 93 Fever 道具 leading DSL 预载

- 对应目录：[93-fever-items-leading-dsl](93-fever-items-leading-dsl/README.md)。
- 首发/最终版结论：v32j；v32l（B2 未变，B3/B5 最后改于 v32k）。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:478-526`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:159-164`
  - `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`
- 已收源与构建文件：
  - `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py` → `93-fever-items-leading-dsl\source\feveritems_patches.py`。
  - `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py` → `93-fever-items-leading-dsl\source\build_feveritems_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleQuestBaseImpl/leadingResolvePathCollection`；body `21446`；code SHA-256 `ae7218d15898f9b2ebe0d995b070d0088be70548bac6b6176588d5d4c7ebe391`；已收文本。

## 94 技能准备 alt 语音图鉴

- 对应目录：[94-generic-ready-gallery](94-generic-ready-gallery/README.md)。
- 首发/最终版结论：v33；v33。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py:177-217`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v33-voiceready.build-report.json:46-51`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py` → `94-generic-ready-gallery\source\voice_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_voice_apk.py` → `94-generic-ready-gallery\source\build_voice_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:CharacterVoiceLogic/createVoicePathMap`；body `84274`；code SHA-256 `a3f3aa721b20af0547543fb26a0ab4227104248b6aee01289e66fea765dc14d7`；已收文本。

## 95 通用技能准备 alt 预载

- 对应目录：[95-generic-ready-preload](95-generic-ready-preload/README.md)。
- 首发/最终版结论：v33；v33。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py:132-174`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v33-voiceready.build-report.json:30-35`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py` → `95-generic-ready-preload\source\voice_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_voice_apk.py` → `95-generic-ready-preload\source\build_voice_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:BattleCharacterLogic/resolveFollowingPathCollection`；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`；已收文本。

## 96 通用技能准备语音轮换

- 对应目录：[96-generic-ready-rotation](96-generic-ready-rotation/README.md)。
- 首发/最终版结论：v33；v33。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py:77-129`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v33-voiceready.build-report.json:14-19`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\voice_patches.py` → `96-generic-ready-rotation\source\voice_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_voice_apk.py` → `96-generic-ready-rotation\source\build_voice_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:HudMemberStatus/update`；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`；已收文本。

## 97 x86_64 同版 AIR 运行时

- 对应目录：[97-x86-air-runtime](97-x86-air-runtime/README.md)。
- 首发/最终版结论：v33-x86；v33-x86。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\FEASIBILITY-x86.md:172-198`
  - `D:\WF\perf-v30-20261015\E3-PLAN.md:94-109`
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1:8-15`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1` → `97-x86-air-runtime\source\build-v33x86.ps1`。
  - `D:\WF\perf-v30-20261015\build-e3.ps1` → `97-x86-air-runtime\source\build-e3.ps1`。
  - `D:\WF\perf-v30-20261015\tools\build_x86.py` → `97-x86-air-runtime\source\build_x86.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 98 ANE Android-x64 平台补全

- 对应目录：[98-x86-ane-platforms](98-x86-ane-platforms/README.md)。
- 首发/最终版结论：v33-x86；v33-x86。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\E3-PLAN.md:7-23`
  - `D:\WF\perf-v30-20261015\E3-PLAN.md:111-122`
  - `D:\WF\perf-v30-20261015\FEASIBILITY-x86.md:194-198`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\work\x86stubs\src\ane_x64_patch.py` → `98-x86-ane-platforms\source\ane_x64_patch.py`。
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1` → `98-x86-ane-platforms\source\build-v33x86.ps1`。
  - `D:\WF\perf-v30-20261015\build-e3.ps1` → `98-x86-ane-platforms\source\build-e3.ps1`。
  - `D:\WF\perf-v30-20261015\tools\build_x86.py` → `98-x86-ane-platforms\source\build_x86.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 99 x86_64 SDK 与壳兼容桩

- 对应目录：[99-x86-native-stubs](99-x86-native-stubs/README.md)。
- 首发/最终版结论：v33-x86；v33-x86。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\X86-STUBS-PLAN.md:28-52`
  - `D:\WF\perf-v30-20261015\build-e3.ps1:10-16`
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1:13-16`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libentryexpro.c` → `99-x86-native-stubs\source\libentryexpro.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libexecgame.c` → `99-x86-native-stubs\source\libexecgame.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libfakedyn.c` → `99-x86-native-stubs\source\libfakedyn.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libfakedyn_x86.c` → `99-x86-native-stubs\source\libfakedyn_x86.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libgetuiext3.c` → `99-x86-native-stubs\source\libgetuiext3.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libsecsdk.c` → `99-x86-native-stubs\source\libsecsdk.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libsobot.c` → `99-x86-native-stubs\source\libsobot.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libtracepath.c` → `99-x86-native-stubs\source\libtracepath.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libuptsmaddon.c` → `99-x86-native-stubs\source\libuptsmaddon.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libuptsmaddonmi.c` → `99-x86-native-stubs\source\libuptsmaddonmi.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\gen\libwordfilter.c` → `99-x86-native-stubs\source\libwordfilter.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\src\stub.c` → `99-x86-native-stubs\source\stub.c`。
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1` → `99-x86-native-stubs\source\build-v33x86.ps1`。
  - `D:\WF\perf-v30-20261015\build-e3.ps1` → `99-x86-native-stubs\source\build-e3.ps1`。
  - `D:\WF\perf-v30-20261015\tools\build_x86.py` → `99-x86-native-stubs\source\build_x86.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 100 x86_64 SocketHelper JNI 实现

- 对应目录：[100-x86-sockethelper](100-x86-sockethelper/README.md)。
- 首发/最终版结论：v33-x86；v33-x86。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\perf-v30-20261015\E3-PLAN.md:68-92`
  - `D:\WF\perf-v30-20261015\E3-PLAN.md:111-122`
  - `D:\WF\perf-v30-20261015\build-e3.ps1:10-16`
- 已收源与构建文件：
  - `D:\WF\perf-v30-20261015\work\x86stubs\src\SocketHelper_e3.c` → `100-x86-sockethelper\source\SocketHelper_e3.c`。
  - `D:\WF\perf-v30-20261015\work\x86stubs\src\SocketHelper.c` → `100-x86-sockethelper\source\SocketHelper.c`。
  - `D:\WF\perf-v30-20261015\build-v33x86.ps1` → `100-x86-sockethelper\source\build-v33x86.ps1`。
  - `D:\WF\perf-v30-20261015\build-e3.ps1` → `100-x86-sockethelper\source\build-e3.ps1`。
  - `D:\WF\perf-v30-20261015\tools\build_x86.py` → `100-x86-sockethelper\source\build_x86.py`。
- 最终方法体实证：
  - 非 SWF 方法项；实际 APK 成员证据见 `_checks/v32_actual_check.json` 或 `_checks/x86_actual_check.json`，身份脚本见原构建源。

## 101 悖论之核双道具次数限制

- 对应目录：[101-overlimit-paradox-core-item](101-overlimit-paradox-core-item/README.md)。
- 首发/最终版结论：v31；v31，后续原样继承。
- 用途、位置、问题及依赖的原始依据：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py:170-217`
  - `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:108-113`
- 已收源与构建文件：
  - `D:\WF\out\角色超限-120\apk\overlimit_patches.py` → `101-overlimit-paradox-core-item\source\overlimit_patches.py`。
  - `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py` → `101-overlimit-paradox-core-item\source\build_overlimit_apk.py`。
- 最终方法体实证：
  - `boot_ffc6:OwnedCharacterLogic/getPossibleOverLimitCountByItem`；body `17768`；code SHA-256 `7fa65be8a2181e01a0a17b400d74fecbd0565c2600be4e78a7be8d96a94e837e`；已收文本。

## 待核实与未构建计划的来源

- StartupCache：`D:\WF\startpoint-cn-kulo\client-patch\startup-cache\native\cn\startpoint\StartupCache.java:16-20,124-131`；`FEASIBILITY-x86.md:191-198`；本次 `_checks/startup_cache_dex_check.json`。
- 幻想装备准备页：`D:\WF\startpoint-cn-kulo\client-patch\fantasy-equipment-party-gate\README.md:9-28`；本次实际 v33 指定方法与基线比较。
- Boss/R8 缺失源：`client-patch/orochi-boss/README.md:7-15`、`build_public_android.py:1-6,18-39`；`r10-public-release/build.py:85-101`；本次 `_checks/early_r8_boss.json`。
- O5 零核调整（超限突破不再消耗悖论之核）、凉月觉醒入口、O8 超限台座：用户本次补充明确为“已规划未构建”；其中零核调整与正式补丁 101 的已构建双道具规则不同。
