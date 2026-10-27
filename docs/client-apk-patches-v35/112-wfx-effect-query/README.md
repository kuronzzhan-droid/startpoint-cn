# 112 WFX 效果状态查询层

- 首发客户端：v35a 第一轮，本地离线候选。
- capability：`wfx-effect-query-v1`（草稿，未登记线上档案）。
- 构建基线：固定 v34 SWF；每个被改方法体和header均锁定。
- 是否只提供二进制：否，附可读指令构造源码与最终逐方法P-code。

## 数据接口

`unique_condition.c0=wfx:<code>:<arg>:<value>:<flags>:<label>`；按uid缓存，非wfx缓存null；层数复用官方当前层数；不含pin。

## 最终采用证据

- 输出 SWF SHA256：`941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9`。
- [统一验证报告](../../verify-report.json)；[方法保持性和锁验证](../../framework-report.json)。
- [统一构建器](../../build.py)；[完整说明和七组例子](../../README.md)。

## 最终 P-code

- [ConditionSlot$/wfxSpec](pcode/ConditionSlot$__wfxSpec.pcode.txt)；body `92601`；code SHA256 `31b978b016948be04ff9f5f9c2f90e2fb008d9dd037af441ffe9924d6e460076`；header `[5, 9, 1, 2]`。
- [ConditionSlot/wfxCollect](pcode/ConditionSlot__wfxCollect.pcode.txt)；body `92602`；code SHA256 `fefed63f32ea56ea41805ea450a850ebc2d6bfb11e6a43db58411dc3ed89f1cc`；header `[7, 9, 1, 2]`。
- [ConditionSlot/wfxRows](pcode/ConditionSlot__wfxRows.pcode.txt)；body `92603`；code SHA256 `043dc1989b5bced086cb2b10ceba115cf29139c75f6b43fe1a18fe7c1d87bba3`；header `[3, 7, 1, 2]`。
- [ConditionSlot/wfxSum](pcode/ConditionSlot__wfxSum.pcode.txt)；body `92604`；code SHA256 `1c2e61835f1933dd81e018e91f101ac48fd871bb1ff7913d909017adee235901`；header `[3, 7, 1, 2]`。

## 补丁源与构建脚本

source 是本条实现目录的源码快照；共享底层工具及完整依赖位于本轮根目录。重放使用统一命令，不单独运行此处的源码副本。

- [consumers.py](source/consumers.py) ← `../../core_combat/consumers.py`；SHA256 `c6fca18074c47e3a7b07b883e757934b24015e8178f07e3aca16c016f095fa41`。
- [patches.py](source/patches.py) ← `../../core_combat/patches.py`；SHA256 `d4c5a9ecc626ba809acfe5a72a6c7497762506a0c64ddbe2112d9e272b29b47a`。
- [query.py](source/query.py) ← `../../core_combat/query.py`；SHA256 `0995c597d3ca72570808af1388a002439585a274fbd2324f7c6cc603a59c6b24`。

`wfx-core-v1` 原计划还承诺pin防驱散，本轮使用独立查询层capability避免错报已实现范围。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象/表夹具下验证；Android/AIR设备、联机、视觉与设备性能未核实。没有联网、部署、安装或签名。
