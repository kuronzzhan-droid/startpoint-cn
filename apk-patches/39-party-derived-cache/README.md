# 39 队伍派生缓存与完整键

复用同次加载中的派生角色结果并按完整枚举与数据快照失效

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattlePartyLogic/getUnitedCharacters`；`cn.loading.PartyDerivedCache/*`。
- 修的问题或错误码：R9回调曾有F1063，最终R10保留五参数回调修复
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

最终正式版通过build.py将checkpoint替换为空函数；原AS是R10算法源，不能将其诊断引用误当最终启用功能。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\README.md:3-23`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattlePartyLogic/getUnitedCharacters](pcode/boot_ffc6--BattlePartyLogic_getUnitedCharacters.pcode.txt)；body `20565`；code SHA-256 `46c807a5ff5b1b02e4435417d1e026b33683909b726c0f1b7095148e325f2e7c`。
- [PartyDerivedCache$/snapshot](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__snapshot.pcode.txt)；body `0`；code SHA-256 `bd361676756a4fc1d6c3e65a699b9b37732e6a55718145370bf5a5f926417a95`。
- [PartyDerivedCache$/key](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__key.pcode.txt)；body `1`；code SHA-256 `0e20ed5e5d87414d24757452a535aa523aa01956c519f70d4849247b67b77d59`。
- [PartyDerivedCache$/begin](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__begin.pcode.txt)；body `2`；code SHA-256 `562021a3d33aa12f7f8d738a07b8a5edbb413d3b2b0154dc4eb095ebd693eb01`。
- [PartyDerivedCache$/reset](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__reset.pcode.txt)；body `3`；code SHA-256 `b65025645dc8b3d7bd720079e88aa72e70112014ccce751465417e6cd817e1b5`。
- [PartyDerivedCache$/metrics](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__metrics.pcode.txt)；body `4`；code SHA-256 `2e0aad34bcdf8e5b092629dc38581a01b1102e9d61aa6e414d4b7c17f55106eb`。
- [PartyDerivedCache$/checkpoint](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__checkpoint.pcode.txt)；body `5`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [PartyDerivedCache$/finish](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__finish.pcode.txt)；body `6`；code SHA-256 `7f99c45b1479003ff8c7f3b4dee642b02d895dd1e79dd336c8b30ab9619e4181`。
- [PartyDerivedCache$/find](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__find.pcode.txt)；body `7`；code SHA-256 `2c7efbd3346b4386af60766d46d5c883a9754ce2ec473e2a5eec54aec47b4ab0`。
- [PartyDerivedCache$/createEntry](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__createEntry.pcode.txt)；body `8`；code SHA-256 `7009e21431fa1ed9baea9ad5066f5df0475e56ca02ed605e2c96dc94eae2e383`。
- [anonymous-method-11](pcode/cn.loading.PartyDerivedCache--anonymous-method-11.pcode.txt)；body `9`；code SHA-256 `ee1a1e0c31bc7bccd32fcb51676bd376aac128a53694e0055a88b61b4d16169f`。
- [PartyDerivedCache$/get](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__get.pcode.txt)；body `10`；code SHA-256 `60e29ffa9b4d0bcd122e357f5066d1ce855028661fbe2d9f2d534fe7d341e2a6`。
- [anonymous-method-13](pcode/cn.loading.PartyDerivedCache--anonymous-method-13.pcode.txt)；body `11`；code SHA-256 `6a0c9ab58aaa42809013ab4163b77f78e7e73b11aab2926248ea50eb1ede7d92`。
- [PartyDerivedCache$/enqueue](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__enqueue.pcode.txt)；body `12`；code SHA-256 `dad97231604a644e4d93468b44a73ebfb5742ff90f07394845a02eec00f71119`。
- [PartyDerivedCache$/runOne](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__runOne.pcode.txt)；body `13`；code SHA-256 `778548493f9a3bde6a42406bff86df5c33e02a6910c7b3ba799197c5b9ad2021`。
- [PartyDerivedCache$/defer](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__defer.pcode.txt)；body `14`；code SHA-256 `ed74fba30a6d83ddb3682017536f2936fd8f8444f1bacf21bc3e734ba8e0e452`。
- [PartyDerivedCache$/tick](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__tick.pcode.txt)；body `15`；code SHA-256 `76675f7bda88b0d027db17936133eb63ed2f99be1ad8d5d18be85507f9bd3d3f`。
- [PartyDerivedCache$/<cinit>](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache___cinit_.pcode.txt)；body `16`；code SHA-256 `10fe9e763de10a0b148654e1539db1391cec9e1a8cf60e610681ad3972f53cfa`。
- [PartyDerivedCache/<ctor>](pcode/cn.loading.PartyDerivedCache--PartyDerivedCache__ctor_.pcode.txt)；body `17`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.loading.PartyDerivedCache--anonymous-method-0.pcode.txt)；body `18`；code SHA-256 `e14877b7d93d62f8847ca6b5b8c358591f3adb25303e005a20cb51fbda04c07f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\patch_swf.py`；6,012 B；SHA-256 `bf02b8e15bcf1d60e06a2352fa5030eb501ce063790563c6e32882c381b1e271`。
- [PartyDerivedCache.as](source/PartyDerivedCache.as) ← `D:\WF\startpoint-cn-kulo\client-patch\loading-preparation-r10\src\cn\loading\PartyDerivedCache.as`；12,221 B；SHA-256 `4322bc35d8b25481546f6a8e3b8c453f077cd6c34af259c5b452e635cdeee604`。
- [build.py](source/build.py) ← `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py`；19,523 B；SHA-256 `bcf73b6196bc4e5b5c4fd0aee61a0848213fc83ef5f46786ea1219d6b2aabc84`。
