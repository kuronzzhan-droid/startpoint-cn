# 11 深渊装备与能力魂副本门控

限制 8000101–8000115 的装备/能力魂只在精确副本白名单中生效，并允许直接装备强化等级至少 120 的例外。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleCharacterLogic.getAvailableAbilities；getAvailableAbilitiesWithCond 不改`。
- 修的问题或错误码：强力深渊装备需要限制适用模式；直接装备需要解包 abilitySoulAbility，能力魂不能获得直接装备等级例外。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\README.md:11-44；ID、Single/Multi白名单及Lv120例外`
- `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\patch.py:29-82；最终门控源字符串`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleCharacterLogic/getAvailableAbilities](pcode/boot_ffc6--BattleCharacterLogic_getAvailableAbilities.pcode.txt)；body `92420`；code SHA-256 `9a0fcbbeae31de6293028b437a0716e2d959524544370cf2f7bfa58aef59fd9f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch.py](source/patch.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\patch.py`；23,582 B；SHA-256 `b0b4b110860595a7c5bf21f88028f8d11718f508da192217c5a4569c5ce2f36b`。
- [build_apk.py](source/build_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-mode-equipment\build_apk.py`；41,289 B；SHA-256 `58a0853ac1910e58a82bac3f99419bdccdf07bbabd7272cb5a67ce4984a538a9`。
