# 118 PF Lv4门槛与颜色数据化

- 首发客户端：v35a 第一轮，本地离线候选。
- capability：`pf-lv4-data-v1`（草稿，未登记线上档案）。
- 构建基线：固定 v34 SWF；每个被改方法体和header均锁定。
- 是否只提供二进制：否，附可读指令构造源码与最终逐方法P-code。

## 数据接口

custom_ability_string键`wfx_pf4_139990`值`80:40A0FF`，颜色可省；缺键100/FF4040；按battle身份缓存，表未加载重试；仍须原override支持4级。

## 最终采用证据

- 输出 SWF SHA256：`941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9`。
- [统一验证报告](../../verify-report.json)；[方法保持性和锁验证](../../framework-report.json)。
- [统一构建器](../../build.py)；[完整说明和七组例子](../../README.md)。

## 最终 P-code

- [MemberImpl/startPowerFlip](pcode/MemberImpl__startPowerFlip.pcode.txt)；body `60180`；code SHA256 `030ae3c33da2fe234e174d12fdd251b59251ca36ce2813a5bea1e8fb47cf69b8`；header `[27, 20, 1, 2]`。
- [BattleFlipperImpl/update](pcode/BattleFlipperImpl__update.pcode.txt)；body `58371`；code SHA256 `c95c944a7f4735ef9e9c62a421c8a035a8bbc2894505a6f25af2814a7c3cc57d`；header `[5, 10, 1, 2]`。
- [BattleFlipperView/draw](pcode/BattleFlipperView__draw.pcode.txt)；body `58431`；code SHA256 `f0a8da06784d7b9bf54b73101852ca25f5665c1548e75ce00caa4f2a5bdf6516`；header `[6, 27, 1, 2]`。
- [Battle$/wfxPfReadString](pcode/Battle$__wfxPfReadString.pcode.txt)；body `92609`；code SHA256 `e5ea4e9a21522cfa9fb2692ea8ee55d53d03a34f420ade692831a9eb67e0cc4d`；header `[2, 4, 1, 2]`。
- [Battle$/wfxPfParseUInt](pcode/Battle$__wfxPfParseUInt.pcode.txt)；body `92610`；code SHA256 `5ada965be7bfd983277a4f7f1523fd61b4434d184b40428df4e288c11163cc8f`；header `[2, 7, 1, 2]`。
- [Battle$/wfxPf4Config](pcode/Battle$__wfxPf4Config.pcode.txt)；body `92611`；code SHA256 `8257144592e422abe05e62b0f07522da584579eb780f54be43348d61b5228ff5`；header `[4, 8, 1, 2]`。
- [Battle$/wfxPf4Gradient](pcode/Battle$__wfxPf4Gradient.pcode.txt)；body `92612`；code SHA256 `5173ee112d9837bb75cad68c3b9801d6faf5ec34e9a8c5d1047e0c1af1a5e7a8`；header `[5, 3, 1, 2]`。
- [BattleFlipperView/wfxPf4Accent](pcode/BattleFlipperView__wfxPf4Accent.pcode.txt)；body `92614`；code SHA256 `70c64a736c9514960c298c6b0fffde17cc2d4f43550f71eaad7b4a3985012904`；header `[4, 4, 1, 2]`。

## 补丁源与构建脚本

source 是本条实现目录的源码快照；共享底层工具及完整依赖位于本轮根目录。重放使用统一命令，不单独运行此处的源码副本。

- [patches.py](source/patches.py) ← `../../pf/patches.py`；SHA256 `b10a4b651a4286bdd0eb12fa1f609fdb20326539ee0734db8296084a7a75d58f`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象/表夹具下验证；Android/AIR设备、联机、视觉与设备性能未核实。没有联网、部署、安装或签名。
