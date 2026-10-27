# 136-overlimit-full-and-window-guard

能力 `wfx-overlimit-full-v1`，产物SHA256 `f1c3260d470f46a4364baddb85af48dc34a5c299bb025d123be085ad6f04e573`。
新增角色键 `wfx_overlimit_full_<角色id> = 1`，仅星5且最高等级键至少120生效。
材料全程使用10000320和10000302；最高台座以突破8次、Lv120、所有盘节点已学判定。
窗口原循环跳过不存在的格子；当前窗口不增建格子，重新打开正常建两格。

本归档 `source/` 包含本轮完整Python源码、工具链和方法锁，`pcode/` 是最终方法副本。
统一重放使用 [run8构造器](../../build.py)，加 `--from-v34` 从八轮起点串联。
不能在归档副本原位运行构造器：路径边界绑定run8，前七轮仍是只读依赖。
参见 [本轮说明](../../README.md)、[验收报告](../../verify-report.json)。
本地草稿，未写正式补丁库、注册表或游戏数据。完整AIR、真机、实际画面未核实。
