# 134-leader-unlock-v2

继承位1/2/4；位8限制本人slot0合击，位16要求原生同属性人数至少6。

能力标识：`leader-unlock-v2`；最终SWF SHA256：`383f49b060718055a80080309aed92f150073d321c8a237f748a025c32050ed4`。

完整说明与验证见[模块说明](../../leader_unlock/README.md)和[本轮说明](../../README.md)。

`source/`与`pcode/`是本轮源码、最终方法的逐字节副本；构建共用run6框架、vendor和输入锁。本归档是累计链的一部分，不能脱离run6独立应用；统一入口为`python -B run6/build.py`。

132归档包含码30/31共享applyHeal采样入口，133包含码31的原生Fever助手。当前未修改正式补丁库、角色数据或发布门禁；AIR、真机、真实联机未核实。
