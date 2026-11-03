# 135-wfx-no-leader-guard

修复party非空但首位为Option.None时，WFX自适应属性与合击掩码助手调用原生队长getter导致C2330。
守卫读取原生的`values.characters[0].index`，只有0（Some）继续；其余沿用各自无party出口。

能力标识：`wfx-no-leader-guard-v1`；最终SWF SHA256：`960757dbaf599b5d4978b95670b9bbe3e76fac5cfd29045b8c9c0dd1a1ca0870`。

见[本轮说明](../../README.md)、[调用范围审计](../../audit/README.md)、[总验收](../../verify-report.json)。
`source/`和`pcode/`是本轮源码与最终方法的逐字节副本。构建共用run7的framework、vendor和锁；
本归档属于累计链，统一入口为`python -B run7/build.py`，七轮入口加`--from-v34`。

不修改原生getter、实际角色数据或正式注册表。完整AIR、真机、实际UI和真实联机均未核实。
