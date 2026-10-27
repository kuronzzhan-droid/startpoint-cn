# 117 PF前连击快照数据开关

- 首发客户端：v35a 第一轮，本地离线候选。
- capability：`pf-snapcombo-v1`（草稿，未登记线上档案）。
- 构建基线：固定 v34 SWF；每个被改方法体和header均锁定。
- 是否只提供二进制：否，附可读指令构造源码与最终逐方法P-code。

## 数据接口

custom_ability_string键`wfx_snapcombo_override_example_pf`值`1`；非空非字符串0启用；原秋九尾override键保留，BallImpl写快照不变。

## 最终采用证据

- 输出 SWF SHA256：`941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9`。
- [统一验证报告](../../verify-report.json)；[方法保持性和锁验证](../../framework-report.json)。
- [统一构建器](../../build.py)；[完整说明和七组例子](../../README.md)。

## 最终 P-code

- [ActionEvaluationResolver/<ctor>](pcode/ActionEvaluationResolver__ctor.pcode.txt)；body `52225`；code SHA256 `6d07497167fbfb8673fc2f8a871045721a4e1776af687951f65478359a83edb7`；header `[8, 16, 1, 2]`。
- [ActionEvaluationResolver/wfxUsesSnapCombo](pcode/ActionEvaluationResolver__wfxUsesSnapCombo.pcode.txt)；body `92613`；code SHA256 `a400d4fdd3b6a8e03095da1e2b8340ca7f2325004797438e8f311ece2d04289c`；header `[4, 4, 1, 2]`。
- [Battle$/wfxPfReadString](pcode/Battle$__wfxPfReadString.pcode.txt)；body `92609`；code SHA256 `e5ea4e9a21522cfa9fb2692ea8ee55d53d03a34f420ade692831a9eb67e0cc4d`；header `[2, 4, 1, 2]`。

## 补丁源与构建脚本

source 是本条实现目录的源码快照；共享底层工具及完整依赖位于本轮根目录。重放使用统一命令，不单独运行此处的源码副本。

- [patches.py](source/patches.py) ← `../../pf/patches.py`；SHA256 `b10a4b651a4286bdd0eb12fa1f609fdb20326539ee0734db8296084a7a75d58f`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象/表夹具下验证；Android/AIR设备、联机、视觉与设备性能未核实。没有联网、部署、安装或签名。
