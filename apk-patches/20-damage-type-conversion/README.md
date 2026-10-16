# 20 普通伤害类型完整转换（424 与 DSL 标记）

让技能、能力、直击与 PF1–3 的来源标志、增伤池和 PF 档位一并转换，供角色规则及单段 DSL 指定分类。

- 首发 APK 版本：**未核实（v17 已含；2026-09-24 客户端规则补丁已出现）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`Environment/getBuffTargetAs、ImpactSourceContent$/NormalAttack、MemberImpl$/wfConvertNormalAttack、MemberAbilityTotalizerImpl/wfResolveDamageType；共用 content.py`。
- 修的问题或错误码：旧 getBuffTargetAs 丢弃 101/102/104/131–133，导致 PF3 等标记最终仍按技能结算；仅改通用增伤池无法正确覆盖统计、耐性、计数与独立乘区。
- 依赖：与 gauge-gain-rules 共用 423/424 解析和说明消费者；不依赖 wf_damage_type_override.py，后者仅核验器
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:55-78；完整转换、边界及 getter 通路`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\damage.py:10-95；最终 P-code 生成源`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\wf_damage_type_override.README.md:4-21；检测器与 canonical 源位置及原有方法哈希`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\wf_damage_type_override.README.md:23-40；分类语义和交互`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [Environment/getBuffTargetAs](pcode/boot_ffc6--Environment_getBuffTargetAs.pcode.txt)；body `52614`；code SHA-256 `3534ccee67770f7f2f581051c53c7b13f35f0bb75a80a13fe4390d0a2bf5cfa1`。
- [ImpactSourceContent$/NormalAttack](pcode/boot_ffc6--ImpactSourceContent__NormalAttack.pcode.txt)；body `58980`；code SHA-256 `9377796ffd220380cded6ada63de54f50534596bb67bd8586f4a57cd15caf50a`。
- [MemberImpl$/wfConvertNormalAttack](pcode/boot_ffc6--MemberImpl__wfConvertNormalAttack.pcode.txt)；body `92442`；code SHA-256 `d75e6f800238961f51ba118216857f320303362ec5a6bfec1c87054bbac39bc0`。
- [MemberAbilityTotalizerImpl/wfResolveDamageType](pcode/boot_ffc6--MemberAbilityTotalizerImpl_wfResolveDamageType.pcode.txt)；body `92441`；code SHA-256 `13482a0345ec249255960ba143f1abf5c85843ecbf27273f383795e4d9555c75`。
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

## 未收与限制

- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
