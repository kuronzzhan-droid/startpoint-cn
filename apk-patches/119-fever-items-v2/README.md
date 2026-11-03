# 119 Fever箭头道具任意UID与等级

- 首发客户端：v35a 第一轮，本地离线候选。
- capability：`fever-items-v2`（草稿，未登记线上档案）。
- 构建基线：固定 v34 SWF；每个被改方法体和header均锁定。
- 是否只提供二进制：否，附可读指令构造源码与最终逐方法P-code。

## 数据接口

`fever:items:hp_recovery_small|skill_charge_middle:lv100:example`；任意UID，主队队长再位次取首个；等级缺省100；全表候选预载按场缓存。

## 最终采用证据

- 输出 SWF SHA256：`941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9`。
- [统一验证报告](../../verify-report.json)；[方法保持性和锁验证](../../framework-report.json)。
- [统一构建器](../../build.py)；[完整说明和七组例子](../../README.md)。

## 最终 P-code

- [YakumonoManagerImpl/activate](pcode/YakumonoManagerImpl__activate.pcode.txt)；body `61871`；code SHA256 `c79dc0e57dbb3fb20df1a33249a64a350db6a16cc8605c6f99a20d8e14a30de8`；header `[5, 21, 1, 2]`。
- [YakumonoManagerImpl/deactivate](pcode/YakumonoManagerImpl__deactivate.pcode.txt)；body `61868`；code SHA256 `e53793d1c783c0c1bb5e024de944584c8df25ae9ca1cef15ebed57bcee3b3b45`；header `[3, 12, 1, 2]`。
- [BattleQuestBaseImpl/resolvePathCollectionForDashPanel](pcode/BattleQuestBaseImpl__resolvePathCollectionForDashPanel.pcode.txt)；body `21430`；code SHA256 `0fa0d23a96cfb64a81ecfba61ae40f311997ab3ff3f62d5ee88d9b1b9c885a30`；header `[3, 15, 1, 1]`。
- [BattleQuestBaseImpl/leadingResolvePathCollection](pcode/BattleQuestBaseImpl__leadingResolvePathCollection.pcode.txt)；body `21446`；code SHA256 `911dbe4bf9656e6dfc682c6f24f848e6462e73684c80956deee48808864f8c9b`；header `[7, 39, 1, 2]`。
- [YakumonoManagerImpl$/wfxFeverSpecV2](pcode/YakumonoManagerImpl$__wfxFeverSpecV2.pcode.txt)；body `92615`；code SHA256 `8226ca60dd9e409406b0c0822651dc688e4782e24017064ee8c84ab5b7386ac9`；header `[4, 16, 1, 2]`。
- [YakumonoManagerImpl$/wfxFeverMarkerV2](pcode/YakumonoManagerImpl$__wfxFeverMarkerV2.pcode.txt)；body `92616`；code SHA256 `a2f5ada1da643f39789e21cee64a9fb154edc3a262a359355524c556652bc00a`；header `[4, 11, 1, 2]`。
- [BattleQuestBaseImpl/wfxFeverCatalogV2](pcode/BattleQuestBaseImpl__wfxFeverCatalogV2.pcode.txt)；body `92617`；code SHA256 `2b102585ec9a024d671dd7d0e041216c0df14fa4c388df668043c01e82c27906`；header `[4, 5, 1, 2]`。

## 补丁源与构建脚本

source 是本条实现目录的源码快照；共享底层工具及完整依赖位于本轮根目录。重放使用统一命令，不单独运行此处的源码副本。

- [helpers.py](source/helpers.py) ← `../../fever/helpers.py`；SHA256 `877a6b62e5036365774e2406c08b6e4663e4184fb00240ff45d8e446410ff68c`。
- [patches.py](source/patches.py) ← `../../fever/patches.py`；SHA256 `f537880a6b636e8f9c32a7223415a89dd364ad43ae81d1dfc975117f4d1c9071`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象/表夹具下验证；Android/AIR设备、联机、视觉与设备性能未核实。没有联网、部署、安装或签名。
