# 31 通用回槽来源限制（423）

按加槽方式、出处、持有者和触发者拦截正向回槽，支持全队与属性目标并保留开场、跑条等独立来源。

- 首发 APK 版本：**未核实（v17 已含；源补丁于 2026-09-24 出现，不能把日期当 APK 编号）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`battle-rules/content.py、gauge.py、provenance.py；共用 423/424 解析和说明消费者`。
- 修的问题或错误码：旧客户端遇到 423/424 可能在 AbilityValues.parseAt109 报 C7050；早期循环缺 AVM2 label 导致 VerifyError #1021 和开战黑屏，最终源已修复。
- 依赖：原生词条解析/说明框架；与 damage-type-conversion 共用 content.py；gauge-effect-guard 性能补丁另列
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:7-10；VerifyError #1021 原因和 v3 修复`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:12-43；423 来源筛选和保留行为`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py:9-75；最终规则与入账守门`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\provenance.py:101-121；来源快照与上下文恢复`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/addSkillPoint](pcode/boot_ffc6--MemberImpl_addSkillPoint.pcode.txt)；body `60573`；code SHA-256 `17616e77a698088c7c5eccebfdfb6aae6b8a1690bd259e2dfc29b11d0f32ecff`。
- [MemberImpl/reserveSkillPoint](pcode/boot_ffc6--MemberImpl_reserveSkillPoint.pcode.txt)；body `60198`；code SHA-256 `6fe9817a84ad66ca0cdeaed697b1e984f3953b78dcea0ef76e6de6b35e16c1f2`。
- [MemberImpl/reserveFixedSkillPoint](pcode/boot_ffc6--MemberImpl_reserveFixedSkillPoint.pcode.txt)；body `60199`；code SHA-256 `9f3fd6bcafcc769b93d53cc7033e2aaa516f578872a4519419a9819fc1aa0a61`。
- [MemberImpl/applyInitialSkillPointRatio](pcode/boot_ffc6--MemberImpl_applyInitialSkillPointRatio.pcode.txt)；body `60553`；code SHA-256 `45aa616e249da0d1f7906ec9b148fad7664130d2c90adcf39a18bfc7cdffe87c`。
- [MemberImpl/move](pcode/boot_ffc6--MemberImpl_move.pcode.txt)；body `60211`；code SHA-256 `254bfe6d69423f5c40c6f47256d92ed4dd4b370e8503eae12d9659241a05dac5`。
- [MemberImpl/wfAllowsGauge](pcode/boot_ffc6--MemberImpl_wfAllowsGauge.pcode.txt)；body `92444`；code SHA-256 `c0767e932272aed7021d42cba1bd0a3d46e6f7a6848d93cc3a46af018bfefae4`。
- [MemberAbilityTotalizerImpl/wfBlocksGauge](pcode/boot_ffc6--MemberAbilityTotalizerImpl_wfBlocksGauge.pcode.txt)；body `92443`；code SHA-256 `c00c039ed5450963581587afefb79a4e0e8185bba082a0f95677263e9a510e37`。
- [MemberImpl$/wfGaugeFromAddress](pcode/boot_ffc6--MemberImpl__wfGaugeFromAddress.pcode.txt)；body `92445`；code SHA-256 `7014ebb423883d75b41b1ae2500889f6376b579520e957ac859bd45481f17436`。
- [MemberImpl$/wfGaugeFromAction](pcode/boot_ffc6--MemberImpl__wfGaugeFromAction.pcode.txt)；body `92446`；code SHA-256 `8a388cec98cec7c6d1722010b889c9e53b67a32911ac1b745df57839760e2c90`。
- [InstantAbilityAddress/<ctor>](pcode/boot_ffc6--InstantAbilityAddress__ctor_.pcode.txt)；body `44967`；code SHA-256 `0cc2af56cd2dccbeb11bd1a15f8d276c662dd103ad3b3f1a2294f0d054f2e4e0`。
- [InstantAbility/<ctor>](pcode/boot_ffc6--InstantAbility__ctor_.pcode.txt)；body `51841`；code SHA-256 `2443e534a28afc075bbbbc5f65090458114422da74425dce893a5495a00868bb`。
- [AbilitySlotImpl/applyInstant](pcode/boot_ffc6--AbilitySlotImpl_applyInstant.pcode.txt)；body `51426`；code SHA-256 `2e0ad12bc7b99ee1adf36fba1bebb62883b95684a430bb77fde4af08c912807c`。
- [MemberImpl/applyInstantAbility](pcode/boot_ffc6--MemberImpl_applyInstantAbility.pcode.txt)；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`。
- [ActionEvaluator/evalCommand](pcode/boot_ffc6--ActionEvaluator_evalCommand.pcode.txt)；body `52284`；code SHA-256 `740d1da65f427f1fd65adb18261d71d333a8e0b8ebe5142299abf266121e9b14`。
- [AbilityValues$/parseAt109](pcode/boot_ffc6--AbilityValues__parseAt109.pcode.txt)；body `39060`；code SHA-256 `3e42c85d4ee45ce33be9a7aec70e350a2303ce3cb7132dd0e8183c02310516eb`。
- [MemberAbilityTotalizerImpl/addDuringContent](pcode/boot_ffc6--MemberAbilityTotalizerImpl_addDuringContent.pcode.txt)；body `51979`；code SHA-256 `a05011f9959b625d0744ca20bf2c65dec54440e9652f13cdd43a9cc8bc723138`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch.py](source/patch.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\patch.py`；2,198 B；SHA-256 `2bb80662023229a11274161fe856332e8fb7ea1608efe26f3f734784acd68596`。
- [content.py](source/content.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\content.py`；5,593 B；SHA-256 `f28fe969f3441726702622c508a8191876f4f73d36bca791669251958d346ade`。
- [damage.py](source/damage.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\damage.py`；5,910 B；SHA-256 `772e9db3cf672465af5cca619e020c570a4eafe76f392cf5f3639fcbdc40dfe8`。
- [gauge.py](source/gauge.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py`；4,614 B；SHA-256 `b0eb2ab4904858e94d438fe9a8927c9fbee6d1aa68fea3b89ccc2c49bb1dc4f2`。
- [provenance.py](source/provenance.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\provenance.py`；6,970 B；SHA-256 `d1f385c253e72f6f7958b131f58292379cf3845353ea6cad26b43a92cb6c2213`。
- [core.py](source/core.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\core.py`；6,290 B；SHA-256 `7cf5d9ddbda00f976887e58308c641b143d5dfc959a3c587bf75e750e222b33a`。
- [verify.py](source/verify.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\verify.py`；2,027 B；SHA-256 `d5cdbb3af58e7aa57d7bf4d68fa15a2c53823843b8e22dfe3fe564318fd495b0`。
- [baseline.json](source/baseline.json) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\baseline.json`；6,213 B；SHA-256 `d89bb9ec2dd691fe37e0639f6c452a33b499537080c2f0fea3986c3b7a7adca1`。
- [build_apk.py](source/build_apk.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\build_apk.py`；4,913 B；SHA-256 `935a001df9ba303987e32dc162797693b1bd63c29269eeed300f5b8e3a6980df`。
- [gauge_effect_guard.py](source/gauge_effect_guard.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py`；2,220 B；SHA-256 `cc04de50dadc741906f44d3d08d3d34d80c703092205970d205994fef1b4f3d7`。

## 未收与限制

- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
