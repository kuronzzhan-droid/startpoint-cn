# 46 通用Rush原生排行榜

复用官方排行榜页面和素材，显示分页榜单、本人定位、奖励及玩家资料

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`RushEventTopScene/run`；`RushEventTopScene/buttonClicked`；`RushEventTopView/run`；`RushEventRankingPartyScene/preparation`；`RushEventRankingPartyScene/run`；`RushEventRankingPartyScene/buttonClicked`；`RushEventRankingPartyScene/copyPlayedParty`；`RushEventRankingPartyScene/afterTransition`；`RushEventRankingPartyView/run`；`RushEventRankingPartyListView/createListCell`；`RushEventRankingPartyListCellContentView/run`；`RushEventRankingPartyListCellContentView/apply`；`RushEventRankingPartyListCellContentView/resizeWidth`；`EventRushRewardRealRemote/<ctor>`；`EventRushRewardRealRemote/successHandler`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\README.md:22-58`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [RushEventTopScene/run](pcode/boot_ffc6--RushEventTopScene_run.pcode.txt)；body `71069`；code SHA-256 `92018c3f00aa31ce271987b8f00fab9c07dd57c60cd158064c514ebf52b1ce9d`。
- [RushEventTopScene/buttonClicked](pcode/boot_ffc6--RushEventTopScene_buttonClicked.pcode.txt)；body `71083`；code SHA-256 `ff1399e1d817506365d54528bbb528ec90710b6081a2336e86ac6e7edecdceb4`。
- [RushEventTopView/run](pcode/boot_ffc6--RushEventTopView_run.pcode.txt)；body `71087`；code SHA-256 `64c20d3f9cba4969835d634d5acae79326dfbc8ca883556d8ec0bf1d956db9a9`。
- [RushEventRankingPartyScene/preparation](pcode/boot_ffc6--RushEventRankingPartyScene_preparation.pcode.txt)；body `70995`；code SHA-256 `290e64aaab3a904ad5dc4566dcdc79548cb2dc653c5a1390e0d07ea449368a11`。
- [RushEventRankingPartyScene/run](pcode/boot_ffc6--RushEventRankingPartyScene_run.pcode.txt)；body `70993`；code SHA-256 `778d46660d1ca60f0e3ffbbd1e40ac4f166cbdb15ae567da33c4e42b7a49d351`。
- [RushEventRankingPartyScene/buttonClicked](pcode/boot_ffc6--RushEventRankingPartyScene_buttonClicked.pcode.txt)；body `71002`；code SHA-256 `9f1f3c2d5510b4d96e6370957a25a792ee847e085a144548934179eb32ef7a53`。
- [RushEventRankingPartyScene/copyPlayedParty](pcode/boot_ffc6--RushEventRankingPartyScene_copyPlayedParty.pcode.txt)；body `71000`；code SHA-256 `e44d600bf617c0b100dbc4b2aebadb9f977a72d9b0a4f651719f9627f4cdef00`。
- [RushEventRankingPartyScene/afterTransition](pcode/boot_ffc6--RushEventRankingPartyScene_afterTransition.pcode.txt)；body `71003`；code SHA-256 `52dc974bbe75f7597e6160539574f2fc1949096d17f93553a880646b35bc85b7`。
- [RushEventRankingPartyView/run](pcode/boot_ffc6--RushEventRankingPartyView_run.pcode.txt)；body `71012`；code SHA-256 `40f0a147bbd0b4051806625c59269e0e113a777b1030be101aec2014ddd148c2`。
- [RushEventRankingPartyListView/createListCell](pcode/boot_ffc6--RushEventRankingPartyListView_createListCell.pcode.txt)；body `71023`；code SHA-256 `046c2ba2f8755a08affa59456220138a29d36ce4cd62f7edd07f12f6dc33e231`。
- [RushEventRankingPartyListCellContentView/run](pcode/boot_ffc6--RushEventRankingPartyListCellContentView_run.pcode.txt)；body `71042`；code SHA-256 `795e4692235094e46b9b04d0cd39508047f3fc6be9d10d1d37d82476f5dd0d0b`。
- [RushEventRankingPartyListCellContentView/apply](pcode/boot_ffc6--RushEventRankingPartyListCellContentView_apply.pcode.txt)；body `71047`；code SHA-256 `6d23b6d82f3c00abe461e557fc4e23b322e3ff58ca1df89df9a37fef2e596e6a`。
- [RushEventRankingPartyListCellContentView/resizeWidth](pcode/boot_ffc6--RushEventRankingPartyListCellContentView_resizeWidth.pcode.txt)；body `71043`；code SHA-256 `da79dca455460c5aa3c34c784209bc43d0c88fd18a33b20ab6fb3e53aec23153`。
- [EventRushRewardRealRemote/<ctor>](pcode/boot_ffc6--EventRushRewardRealRemote__ctor_.pcode.txt)；body `48465`；code SHA-256 `36411b6694c06c1578848c535b0fe243de22ae3bdb643d27d8e30bbb3be17b20`。
- [EventRushRewardRealRemote/successHandler](pcode/boot_ffc6--EventRushRewardRealRemote_successHandler.pcode.txt)；body `48463`；code SHA-256 `a558b9711da96a1308e26b52d355d5f9f540d642ff2f448767e8d2feb8fe6384`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch.py](source/patch.py) ← `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\patch.py`；33,171 B；SHA-256 `0276b5cffe329291e3862efc41ec03001d3f521be3a39f2aab04a98802632db2`。
- [build_apk.py](source/build_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_apk.py`；36,562 B；SHA-256 `29727a48d8d36191562df780b59304e285243f50b51e27391cb6d29b8491b7df`。
- [build_navigation_apk.py](source/build_navigation_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_navigation_apk.py`；21,442 B；SHA-256 `a6a591e4b69691899326521db5b0b382ca2108149f1dd484af4242c9e47e8acc`。
