# 129 装备诅咒和衰减参数数据化

capability：`equipment-rules-data-v1`；本地候选，未部署。
输入固定为run2/v35b.swf，方法体SHA256与header同时锁定。
最终SWF SHA256：`d0a8e186203d94ba98d78dcf14a7557fcf4c0a4cea9fcaa340250267ec326682`。

[中文数据例子与完整说明](../../README.md) · [统一验证报告](../../verify-report.json) · [统一构建入口](../../build.py)

## 现有方法合成及源文件

下面是实现目录的完整Python源码快照；运行仍使用run3根目录的工具、依赖和统一构建器。

- [equipment详细说明](../../equipment/notes.md)。
- [equipment/__init__.py](source/equipment/__init__.py)，SHA256 `78f3a7adc9b546fe1b8d9e76e8ca27e62b913d6def1d2880709a688617a9adbe`。
- [equipment/checks.py](source/equipment/checks.py)，SHA256 `35150d981c3a562331fc5224c1a16db8662ea58feb34f058910e9efa94e11912`。
- [equipment/config.py](source/equipment/config.py)，SHA256 `0b17f7fc8f485e957c02b88c886fb8c1a7baaa1fd2ca3e447de4f73939ca07ef`。
- [equipment/harness.py](source/equipment/harness.py)，SHA256 `05ad775541f818a36b1a8b97f15b02187ad05fac6098e1598ac1735b44ff0e7a`。
- [equipment/patches.py](source/equipment/patches.py)，SHA256 `d5e9f143461750206fecd2d576eece2457eeabd28dc37ba11d8741ab0d116e52`。
- [equipment/probe.py](source/equipment/probe.py)，SHA256 `87190fd8b4d26afe57e44fd1153ff7625305b3f8a96d2ef8d68c0d9d0f7ad0a5`。
- [equipment/verify.py](source/equipment/verify.py)，SHA256 `5de16f25a286a3fb09f5774d5380b4fbf554d20a9ee51b6c4e4375406f3f6dba`。

## 最终P-code

- [BattleCharacterLogic/wfTierAbility](pcode/BattleCharacterLogic__wfTierAbility.pcode.txt)，body `92598`，SHA256 `a1518b447139bf07db2584a5430a1e815abfb1a9ad4d45190632dd88e80cf848`，header `[8, 12, 1, 2]`。
- [BattleCharacterLogic/wfIsCursedSoul](pcode/BattleCharacterLogic__wfIsCursedSoul.pcode.txt)，body `92595`，SHA256 `73d66629e92923100d2952e5995fe8e4a19e1c550af8dc982c714a9135fb61dd`，header `[2, 2, 1, 2]`。
- [BattleCharacterLogic/wfIsDecaySoul](pcode/BattleCharacterLogic__wfIsDecaySoul.pcode.txt)，body `92596`，SHA256 `a39b79e09a6638cbb7433e584bf88f9a79eb94fcf7904296209b5116c69908c0`，header `[2, 2, 1, 2]`。
- [BattleCharacterLogic/wfEquipmentRule](pcode/BattleCharacterLogic__wfEquipmentRule.pcode.txt)，body `92599`，SHA256 `9d00229ab9b600ff9d6082a2d9482e5927a51d004befe46e2564cd19e6ab7f89`，header `[5, 7, 1, 2]`。
- [BattleCharacterLogic/wfPreloadEquipmentTiers](pcode/BattleCharacterLogic__wfPreloadEquipmentTiers.pcode.txt)，body `92600`，SHA256 `67b1a352eea71b3e644155c12ccabef4b14ccb88a011298478412f038dbc7669`，header `[4, 5, 1, 2]`。
- [BattleCharacterLogic/wfxEquipmentConfig](pcode/BattleCharacterLogic__wfxEquipmentConfig.pcode.txt)，body `92644`，SHA256 `94d1f036c2d03097d9d5f21188d0b25c7e1de72491b32910123f60e30e7fc0e5`，header `[3, 6, 1, 2]`。
- [BattleCharacterLogic/wfxEquipmentParam](pcode/BattleCharacterLogic__wfxEquipmentParam.pcode.txt)，body `92645`，SHA256 `d7848a6984b3ee360b5ed6bc1a8e737b0017f2ffe7e1111d78f93e4246304bd7`，header `[2, 5, 1, 2]`。

完整AIR/Android、真实联机和设备呈现未核实。没有APK、签名、安装或发布。
