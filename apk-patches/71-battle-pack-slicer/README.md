# 71 战斗图集合成分帧

用Timer分帧合成战斗图集，失败或不适用时走同步分页兜底

- 首发 APK 版本：**v27**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleStartProductionViewService/prepare`；`cn.loading.BattlePackSlicer/*`。
- 修的问题或错误码：性能问题，无专用错误码
- 依赖：atlas-overflow-spill
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:633-654`
- `%USERPROFILE%\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
- `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleStartProductionViewService/prepare](pcode/boot_ffc6--BattleStartProductionViewService_prepare.pcode.txt)；body `38045`；code SHA-256 `8eb9f901d73b20499ad2b97b3d7a72beab1eda5e0a9a98d480f7196320744c59`。
- [BattlePackSlicer$/cls](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer__cls.pcode.txt)；body `0`；code SHA-256 `a3e677a1c802473dbd619b5553c5fd68c7c0224f49ba78097694ad493f609308`。
- [BattlePackSlicer$/start](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer__start.pcode.txt)；body `1`；code SHA-256 `da6b1a666d9644190ece4d3d1d614b800124b6ac2d35cc91955e64a8ac68cd5f`。
- [BattlePackSlicer/layer](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_layer.pcode.txt)；body `2`；code SHA-256 `8dfb780606e30bec6dd2b8d162193f3338baaba1de29154b0484c19c994fa169`。
- [BattlePackSlicer/newPage](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_newPage.pcode.txt)；body `3`；code SHA-256 `dc4178f06c385b65758d47617da1935633570e8d6e0085265ca8135837a1747c`。
- [BattlePackSlicer/tick](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_tick.pcode.txt)；body `4`；code SHA-256 `6665e013c3efe3bc2579a89ea520ba40e90d2a6e30473d0bc2181644d55d2d4d`。
- [BattlePackSlicer/progress](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_progress.pcode.txt)；body `5`；code SHA-256 `23a77227a14a30753f2661aab87a536c3ef4e78920f84b2e0170afe967206338`。
- [BattlePackSlicer/packStep](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_packStep.pcode.txt)；body `6`；code SHA-256 `e9c8879bf9e6cc3973e69815ee5e6175e875c479048ba8bd3fd2545377e5fa48`。
- [BattlePackSlicer/build](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_build.pcode.txt)；body `7`；code SHA-256 `0512a7dd91952f85dea98b07d5e0d5f66542298558a1543d4abe7cae03d32f46`。
- [BattlePackSlicer/markLost](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_markLost.pcode.txt)；body `8`；code SHA-256 `4c3ad09a1b7ce8a2ecebb28a99eccb5a2d8d329e994a62076e77897a45253049`。
- [anonymous-method-11](pcode/cn.loading.BattlePackSlicer--anonymous-method-11.pcode.txt)；body `9`；code SHA-256 `e5b5e4ff4f59b1bab0e521f78fe35113a640b885e5fee558118ac3592a8b7d24`。
- [BattlePackSlicer/drawStep](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_drawStep.pcode.txt)；body `10`；code SHA-256 `7706ddef0eab2b6499d1bce80627d6bac27e9c58e3b3d822c3ffbd88828fb7b4`。
- [BattlePackSlicer/map](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_map.pcode.txt)；body `11`；code SHA-256 `ca868ee5b6ce68e7ea3970c9e19f4e3e27b759f9a6ae4f8b06f559f022989ed0`。
- [BattlePackSlicer/colorStep](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_colorStep.pcode.txt)；body `12`；code SHA-256 `138b4e2b5113b7e17ac6715deb3f11c5801345b5787594bbd410982b68b450fe`。
- [BattlePackSlicer/finish](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_finish.pcode.txt)；body `13`；code SHA-256 `993c0f2ed05bb88937dc9289a1f5014e19d34e823811b75549466690cfdd715a`。
- [BattlePackSlicer/stop](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_stop.pcode.txt)；body `14`；code SHA-256 `14114c129e4b392df2ac4d18dd2d33b44cbd06173d8bfe75279759b756bcb884`。
- [BattlePackSlicer/disposeAll](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_disposeAll.pcode.txt)；body `15`；code SHA-256 `96d6ac7a17fd63d60f4679c1ca94f15a623694fda47327d9c46172fa8e51d636`。
- [BattlePackSlicer/abort](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_abort.pcode.txt)；body `16`；code SHA-256 `0c8f89b4efb9cab8bca11e71f508daee100c5894727b2d264650b097598be48b`。
- [BattlePackSlicer/fallback](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_fallback.pcode.txt)；body `17`；code SHA-256 `145473185bf4ce42a1280bea911ca7c95aaea2bed281e45121983040b7778730`。
- [BattlePackSlicer/dumpStat](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer_dumpStat.pcode.txt)；body `18`；code SHA-256 `eac2a10b7d844a9a69a2f03b801a4c23f26ef6799d7de1163baf6c098e13b85f`。
- [BattlePackSlicer$/active](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer__active.pcode.txt)；body `19`；code SHA-256 `abb54b1c3cbe42b50347f37336002a766b617e850ec9244c9fe35851accabc0f`。
- [BattlePackSlicer/<ctor>](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer__ctor_.pcode.txt)；body `20`；code SHA-256 `2d41a635ebdbaec17c25790d6f1710791abcc1d85000843df87a3a81dca420ae`。
- [BattlePackSlicer$/<cinit>](pcode/cn.loading.BattlePackSlicer--BattlePackSlicer___cinit_.pcode.txt)；body `21`；code SHA-256 `5bcaf4c4a3b43361e34bc3e4f5d9a001731074ca1073f8a7ccd325715ddcb78b`。
- [anonymous-method-0](pcode/cn.loading.BattlePackSlicer--anonymous-method-0.pcode.txt)；body `22`；code SHA-256 `1719c0768f2363ec9f8ebd4afaa61bffd019f7f04428410ecf85015c699c9e62`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
- [BattlePackSlicer.as](source/BattlePackSlicer.as) ← `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\src\cn\loading\BattlePackSlicer.as`；16,575 B；SHA-256 `88ce4e3a57a1c6c3f00186e386ddef4738917d213de8c91e66367a083e3816e1`。
