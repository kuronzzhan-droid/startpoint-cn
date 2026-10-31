# 123 能力弹道命中路径及六槽队伍预载数据化

- 首发层：v35b第二轮，本地离线候选。
- capability：`ability-visuals-v1`；仅登记草稿。
- 固定输入：run1/v35a.swf；方法body SHA与header均锁定。
- 提供指令构造源及最终P-code，不使用整类回编。

## 数据接口

custom_ability_string：`ability_visual_fire_dragon` = `|battle/effect/ability_damage/inaho_midautumn_wip/moonlight_shot_gold_jade|battle/effect/ability_damage/inaho_midautumn_wip/moonlight_hit|||`。槽顺序：launch、shot、hit、skill、total_ability、total_powerflip。shot/hit控制原32的运行时视觉，其余四槽沿原用途参与预载。

## 采用与验证证据

- 最终SWF SHA256：`cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b`。
- [完整说明](../../README.md)；[统一验收](../../verify-report.json)；[全包保持性](../../framework-report.json)。
- [统一构建入口](../../build.py)；[本组说明](../../visuals/notes.md)。

## 最终 P-code

- [BattleCharacterLogic/resolvePathCollection](pcode/BattleCharacterLogic__resolvePathCollection.pcode.txt)；ABC `boot_ffc6`；body `92329`；SHA256 `1635d24840bc0c5e81cff3730159741f783528dd20bd417838c61c60aafbd8db`；header `[7, 8, 7, 9]`。
- [BattleCharacterLogic$/wfxVisualPaths](pcode/BattleCharacterLogic$__wfxVisualPaths.pcode.txt)；ABC `boot_ffc6`；body `92630`；SHA256 `27c1317a058f2e5b854be7b3477ffa49a57ef43517f95e13b09eb308a92ef45e`；header `[4, 4, 1, 2]`。
- [MemberImpl/wfxAbilityVisualPaths](pcode/MemberImpl__wfxAbilityVisualPaths.pcode.txt)；ABC `boot_ffc6`；body `92631`；SHA256 `bdcd0adac5d79b7402e8ddb5f71fdfa783a15dbbfd2e7fbb46666a1db20161c6`；header `[3, 1, 1, 2]`。
- [BattleCharacterLogic$/wfxPreloadVisualFor](pcode/BattleCharacterLogic$__wfxPreloadVisualFor.pcode.txt)；ABC `boot_ffc6`；body `92632`；SHA256 `b8b504471f5bed8504a58e1f77e0db657f45be64ec39fa2a280881270ce9d1a0`；header `[6, 6, 1, 2]`。
- [BattleCharacterLogic/wfxPreloadAbilityVisuals](pcode/BattleCharacterLogic__wfxPreloadAbilityVisuals.pcode.txt)；ABC `boot_ffc6`；body `92633`；SHA256 `497ecff5cf9c6e1391114caede2f6ca73c74ca3c673e0a6456fb3ccc2f71aec1`；header `[3, 4, 1, 2]`。
- [InahoAbilityVisuals$/shot](pcode/InahoAbilityVisuals$__shot.pcode.txt)；ABC `cn.mod.InahoAbilityVisuals`；body `1`；SHA256 `ec529cbd0b69317e23117240490cf406a5c41bcd76de8ea9a72dac7454f74143`；header `[2, 4, 0, 1]`。
- [InahoAbilityVisuals$/hit](pcode/InahoAbilityVisuals$__hit.pcode.txt)；ABC `cn.mod.InahoAbilityVisuals`；body `2`；SHA256 `222c889582126fd7c175432656d4cad2e2eca752695872a31103f3b6adcb1cc3`；header `[2, 4, 0, 1]`。
- [InahoAbilityVisuals$/preload](pcode/InahoAbilityVisuals$__preload.pcode.txt)；ABC `cn.mod.InahoAbilityVisuals`；body `0`；SHA256 `15046c0508ef56fb260ca03e12cc22fef8a5b57b0e779ad70074461faafecfd1`；header `[2, 3, 0, 1]`。

## 补丁源

source为实现目录源码快照；完整依赖与工具链在run2根目录，重放只用统一构建器。

- [audit.py](source/audit.py)；来源 `visuals/audit.py`；SHA256 `98c208e3af51a40673066182324a5bcb823d7e1f90d9819ff8525e85c59d7443`。
- [helpers.py](source/helpers.py)；来源 `visuals/helpers.py`；SHA256 `f97b860b2346e3ace712b93a652303bf0bc12338d1e75d000f29527fb5fd3809`。
- [hook_checks.py](source/hook_checks.py)；来源 `visuals/hook_checks.py`；SHA256 `339cb3530e3637b2f98086543335a458e80fcd26b5d17784b72fbd62534a3ff0`。
- [patches.py](source/patches.py)；来源 `visuals/patches.py`；SHA256 `66c5e243b9ae83e45e51af9f0cec396d2c1425e9ab86a9173190453186836ea5`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象下验证；AIR/Android实机、联机、视觉和设备性能未核实。本任务不含联网、部署、APK、安装或签名。
