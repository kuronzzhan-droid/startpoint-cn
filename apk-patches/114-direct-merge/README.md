# 114 直击合并数据入口

- 首发客户端：v35a 第一轮，本地离线候选。
- capability：`direct-merge-v1`（草稿，未登记线上档案）。
- 构建基线：固定 v34 SWF；每个被改方法体和header均锁定。
- 是否只提供二进制：否，附可读指令构造源码与最终逐方法P-code。

## 数据接口

`wfx:25:4:1:0:merge`；任一有效层启用，arg为最少段数，0代表4；保留旧凯尔队长入口。

## 最终采用证据

- 输出 SWF SHA256：`941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9`。
- [统一验证报告](../../verify-report.json)；[方法保持性和锁验证](../../framework-report.json)。
- [统一构建器](../../build.py)；[完整说明和七组例子](../../README.md)。

## 最终 P-code

- [MemberImpl/scheduleDirectAttack](pcode/MemberImpl__scheduleDirectAttack.pcode.txt)；body `60192`；code SHA256 `7f0d02acfc116523f829a639e717fea6e53ce30b61c0f40085082c4b0caf1e07`；header `[110, 45, 1, 2]`。
- [MemberImpl/wfxMergeDirect](pcode/MemberImpl__wfxMergeDirect.pcode.txt)；body `92606`；code SHA256 `9e94f2904e16303fa9eb4d2db70f97357cb304f94399ad7ca1493e8509efca61`；header `[3, 5, 1, 2]`。

## 补丁源与构建脚本

source 是本条实现目录的源码快照；共享底层工具及完整依赖位于本轮根目录。重放使用统一命令，不单独运行此处的源码副本。

- [consumers.py](source/consumers.py) ← `../../core_combat/consumers.py`；SHA256 `c6fca18074c47e3a7b07b883e757934b24015e8178f07e3aca16c016f095fa41`。
- [patches.py](source/patches.py) ← `../../core_combat/patches.py`；SHA256 `d4c5a9ecc626ba809acfe5a72a6c7497762506a0c64ddbe2112d9e272b29b47a`。
- [query.py](source/query.py) ← `../../core_combat/query.py`；SHA256 `0995c597d3ca72570808af1388a002439585a274fbd2324f7c6cc603a59c6b24`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象/表夹具下验证；Android/AIR设备、联机、视觉与设备性能未核实。没有联网、部署、安装或签名。
