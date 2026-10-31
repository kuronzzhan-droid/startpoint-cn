# 124 码24最终直击倍率钳到非负

- 首发层：v35b第二轮，本地离线候选。
- capability：`direct-base-v1`；仅登记草稿。
- 固定输入：run1/v35a.swf；方法body SHA与header均锁定。
- 提供指令构造源及最终P-code，不使用整类回编。

## 数据接口

`wfx:24:1:-10000:0:negative_combo`：连击2时旧最终乘积为-1，新最终乘积钳为0；其它输入行为不变。

## 采用与验证证据

- 最终SWF SHA256：`cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b`。
- [完整说明](../../README.md)；[统一验收](../../verify-report.json)；[全包保持性](../../framework-report.json)。
- [统一构建入口](../../build.py)；[本组说明](../../visuals/notes.md)。

## 最终 P-code

- [MemberImpl/wfxDirectFactor](pcode/MemberImpl__wfxDirectFactor.pcode.txt)；ABC `boot_ffc6`；body `92605`；SHA256 `780e04531be4fb5a4c2f703cafade333d2263a9ef6edf012016e7a025b622a2b`；header `[4, 12, 1, 2]`。

## 补丁源

source为实现目录源码快照；完整依赖与工具链在run2根目录，重放只用统一构建器。

- [audit.py](source/audit.py)；来源 `visuals/audit.py`；SHA256 `98c208e3af51a40673066182324a5bcb823d7e1f90d9819ff8525e85c59d7443`。
- [helpers.py](source/helpers.py)；来源 `visuals/helpers.py`；SHA256 `f97b860b2346e3ace712b93a652303bf0bc12338d1e75d000f29527fb5fd3809`。
- [hook_checks.py](source/hook_checks.py)；来源 `visuals/hook_checks.py`；SHA256 `339cb3530e3637b2f98086543335a458e80fcd26b5d17784b72fbd62534a3ff0`。
- [patches.py](source/patches.py)；来源 `visuals/patches.py`；SHA256 `66c5e243b9ae83e45e51af9f0cec396d2c1425e9ab86a9173190453186836ea5`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象下验证；AIR/Android实机、联机、视觉和设备性能未核实。本任务不含联网、部署、APK、安装或签名。
