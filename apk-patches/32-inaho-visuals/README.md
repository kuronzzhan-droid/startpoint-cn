# 32 稻穗能力攻击视觉与预载

保留稻穗弹道与命中特效及六项必要资源预载

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`cn.mod.InahoAbilityVisuals/*`；`MemberImpl/applyInstantAbility`；`ActionEvaluator/addImpactToSubject`；`BattleCharacterLogic/resolvePathCollection`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

仅收最终 v33 的 InahoAbilityVisuals helper 逐方法 P-code 与主 ABC 接入方法。当前仓库 AS 已改为后期 C8016 v3 条件预载（多 needsInahoPreload 方法），与实包 7 方法、无条件六次预载不符，未收该后期 AS 或 builder。最终实包的六次无条件预载已经覆盖两种能力伤害；不能将后期未采纳版本误称最终源码。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\author-unified-damage\README.md:7-10`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\apkp1016\research\final_coverage_check.json（本次最终 helper 逐方法核验）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [InahoAbilityVisuals$/preload](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals__preload.pcode.txt)；body `0`；code SHA-256 `c7b3e8879db4e421c24d024a8a8728d2691947607e54f84ad3b835acaf619d16`。
- [InahoAbilityVisuals$/shot](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals__shot.pcode.txt)；body `1`；code SHA-256 `5e96be34ca2b05298be3f4e942f7da7d70596b0c8ced94f34a936f1836eef507`。
- [InahoAbilityVisuals$/hit](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals__hit.pcode.txt)；body `2`；code SHA-256 `059ed57a965af38e53d3eff5019be03a4dca66e7193efe2ea6cbb3a6004476fc`。
- [InahoAbilityVisuals$/isInaho](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals__isInaho.pcode.txt)；body `3`；code SHA-256 `b528f1bff2ea9f0d9315a4a3e6cd921a54f0332578694ff1c9dd67b9a4c7e17e`。
- [InahoAbilityVisuals$/<cinit>](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals___cinit_.pcode.txt)；body `4`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [InahoAbilityVisuals/<ctor>](pcode/cn.mod.InahoAbilityVisuals--InahoAbilityVisuals__ctor_.pcode.txt)；body `5`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.mod.InahoAbilityVisuals--anonymous-method-0.pcode.txt)；body `6`；code SHA-256 `816387a1f6f4239c71c0ecf7912975bd138d6189b26f38c23063cc64a796f5b5`。
- [MemberImpl/applyInstantAbility](pcode/boot_ffc6--MemberImpl_applyInstantAbility.pcode.txt)；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`。
- [ActionEvaluator/addImpactToSubject](pcode/boot_ffc6--ActionEvaluator_addImpactToSubject.pcode.txt)；body `52295`；code SHA-256 `2cd4d6fee6d01e91a67829603085af9270298c361b492fa6dedab72c707e9a02`。
- [BattleCharacterLogic/resolvePathCollection](pcode/boot_ffc6--BattleCharacterLogic_resolvePathCollection.pcode.txt)；body `92329`；code SHA-256 `4be465684a1346a539ccdcc65221ea64a875fdc0e3ebcd93bb16d47b185b7e93`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

