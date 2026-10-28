# 147 联机镜像战斗跳过每帧调试统计

- 首发版本：v35o / 1008014（run15；另含同 SWF 重打包版 v35o-r / 1008016）
- capability：`client-perf-mirror-debugstats-v1`
- 依赖前置补丁：146（基于 v35n SWF 叠加）
- 对应数据边：无数据表变更

## 作用

在多人联机的非本机镜像战斗（`Battle.primary == false`）且非 Raid（`Battle.isRaid == false`）时，跳过 `ElapsedTimeCalculatorImpl/advanceTime` 末尾对 `xDebugTimeCalculatorImpl.advanceTime(rawFrame)` 的每帧调试统计调用。该统计仅写入不参与协力结算上报的 `debugFloorStatistics`，跳过后三人房两个镜像战斗逻辑耗时实测降低约 38%（总逻辑帧耗时降低约 13%），且不改动任何随机数游标、HP、状态槽或 Coop/Impact 字段。

## 改动类与方法

- `ElapsedTimeCalculatorImpl/advanceTime`：在 `#125`（调用 `xDebugTimeCalculatorImpl.advanceTime` 前）插入 `!battle.primary && !battle.isRaid` 早返门控；零新增方法、零新增槽与常量池项。

## 开关与数据写法

- 无外部配置开关；自动对 `primary == false && isRaid == false` 的镜像 Battle 生效，主战斗（`primary == true`）与 Raid 战斗保持原行为。

## 最终 P-code

- [ElapsedTimeCalculatorImpl/advanceTime](pcode/ElapsedTimeCalculatorImpl__advanceTime.pcode.txt)；文件 SHA256 `455345e827a0249d07cedde4883cc98812dd8de5efc04fe212d5946b610dd3e1`（`ElapsedTimeCalculatorImpl/advanceTime header=[4, 2, 1, 2] sha=4f730953a32d3debb4872389b64b80093b31bdfa30fe7b125bf5be380a626e3b`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `7e13e378784491eb625d5ba436a4f86172785b234cb3d2b7722f8237b94f6de7`。
- [build.py](source/build.py) ← `build.py`；SHA256 `5d08222ff27e18df20cc0df2239e742349a6da6f73d90e840fd89446d33a2101`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `0ca0f2b6a5976c943cc962516be8cb542b98e78fc9a0ab66a410b850e3eccdea`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `c18e19314293d9099885be5fe802f78477e59fe42b700edcfaa5552590bf269e`。
- [perf15_patch.py](source/perf15_patch.py) ← `perf15_patch.py`；SHA256 `4f56a2487cb4f84d24c74fbb94de82e2997d8a2119a314316d7c7748fb318639`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `24de5d146836fc692784c343e22d2eebd11b92faff099c3ef63d0f3b38ee4647`。

## 已知限制与验收边界

- 原候选方案 B（镜像战斗跳过减伤统计第二遍 `_calculate`）因会改变 `ImpactResult.reductionDamage` 字段与 `randomForReductionDamage` 游标而未纳入正式产物。
- 测试服输出 SWF SHA256 `ec493123861924e5b51f73ab0de93cb046cdf491024771be9c6a387d5dd6a7de`。`v35o-r`（versionCode `1008016`）使用完全相同的 `v35o.swf`，仅刷新版本号与 AIR UUID 以便从 `v35p`（`1008015`）平级覆盖回退。

来源工作区：`<WORKDIR>/v35-generic-20261018/run15`、`<WORKDIR>/outputs/apk/client-perf-20261021/v35o`、`<WORKDIR>/outputs/apk/coop-fingerprint-20261022`
