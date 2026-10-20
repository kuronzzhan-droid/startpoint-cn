# 137-leader-unlock-owner-main

能力 `wfx-owner-main-unlock-v1`，产物SHA256 `764254976d9f0c5a246f16d89e31da3e3347d752582938c9033e59237a57fabb`。
复用 `wfx_unlock_<slot0队长技编号>` 的bit1/bit8/bit16判据，
只放开合击角色自身能力的202 OwnerIsMain；其余前置保持原生。

本归档 `source/` 包含本轮Python源码、工具链和方法锁，`pcode/` 为最终方法副本。
统一重放使用 [run9构造器](../../build.py)，加 `--from-v34` 从v34串联全部九轮。
不能在归档副本原位运行构造器：路径边界绑定run9，前八轮是只读依赖。
参见 [本轮说明](../../README.md)、[验收报告](../../verify-report.json)。
本地草稿；完整AIR、真机、实际UI未核实。
