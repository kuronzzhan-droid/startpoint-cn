# 146 客户端表现层性能补丁（同帧伤害数字合并、受击特效限流、镜像浮字省略）

- 首发版本：v35n / 1008013（run14）
- capability：`client-perf-presentation-v1`
- 依赖前置补丁：145（基于 v35m SWF 叠加）
- 对应数据边：无数据表变更

## 作用

在不改动任何伤害结算、连击、溢出计数、联机命令及战斗逻辑随机流的前提下，降低高频命中场景下的表现层开销：
1. **同帧同目标伤害数字合并（merge）**：主战斗非毒伤命中在单目标每帧超过 2 条或全局每帧超过 16 条后，保留原调用链与 `>=5000万` 溢出统计，跳过逐条新建 `DamageEffectImpl`，将其 `Decimal100.dfloor` 值累加并在下一帧合成为一条合计伤害数字；
2. **受击特效每帧预算（hitbudget）**：每个 `EffectManagerImpl` 每逻辑帧最多创建 6 个 `HitEffect`（case 63），超额部分补调 `getRandomRotation()` 以保持 `randomGeneralEffect` 随机游标一致后直接返回；
3. **队友镜像战斗省略累计浮字视图（otheraccum）**：`BattleView/show` 在他人分支（`param1 != -1`）的 case 47 不再创建 `AccumulationDamageIndicator` 的显示视图与数字 MovieClip。

## 改动类与方法

- `DamageIndicatorManager/show`、`DamageIndicatorManager/update`、`EffectManagerImpl/addDamageEffect`：插入伤害数字分帧合并与延迟冲刷逻辑；新增辅助方法 `DamageIndicatorManager/wfxMergeState`、`wfxEmitPending`、`wfxMergeDamage`、`wfxFlushDamage`，以及静态槽 `EffectManagerImpl.wfxDamageMode`、`DamageIndicatorManager.wfxMergeStates`、`wfxGlobalStates`。
- `EffectManagerImpl/show`：在 case 63（`HitEffect`）入口插入 `wfxHitAllow` 检查；新增辅助方法 `EffectManagerImpl/wfxHitAllow` 与静态槽 `EffectManagerImpl.wfxHitStates`。
- `BattleView/show`：在非本机分支 case 47 入口检查静态开关 `BattleView.wfxKeepOtherAccumView`（默认 `false`），直接返回 `removeKey`。

## 开关与数据写法

- 编译期常量位于 `perf_patch.py` 的 `LIMITS`：`DMG_PER_TARGET=2`、`DMG_GLOBAL=16`、`DMG_WINDOW=1`、`HIT_PER_FRAME=6`。
- 运行期静态槽 `BattleView.wfxKeepOtherAccumView` 默认为 `false`（置 `true` 可恢复镜像累计伤害浮字视图）。

## 最终 P-code

- [BattleView/show](pcode/BattleView__show.pcode.txt)；文件 SHA256 `c0e3902897e87a10c52a72a79cb4f09fa3a4382488bf2bf257b9fb0844abe129`（`BattleView/show header=[10, 15, 1, 2] sha=002b73426b6b92a3e3202458f4599f79919ce53b9bf4dbea335917c945c02f9a`）。
- [DamageIndicatorManager/show](pcode/DamageIndicatorManager__show.pcode.txt)；文件 SHA256 `9d712c277f19000cf085ce9a65a569f28a8de6e5209e5617c2722416ee0a496c`（`DamageIndicatorManager/show header=[6, 5, 1, 2] sha=cb1b74803d3c1270ab1e387acecdecf1dba987b25400f148e53b2cd075eb18ea`）。
- [DamageIndicatorManager/update](pcode/DamageIndicatorManager__update.pcode.txt)；文件 SHA256 `4915668b9a0a4d544337205dde46bc2419c6b785b87c122341c9eb85f89e6def`（`DamageIndicatorManager/update header=[3, 1, 1, 2] sha=d5fa5658e6f257566f66add4009dc92c140a4bfbcfee108610d378ca1f85d646`）。
- [DamageIndicatorManager/wfxEmitPending](pcode/DamageIndicatorManager__wfxEmitPending.pcode.txt)；文件 SHA256 `1e47096fe5c8be301424d4b676b874c35127edb7869fb16c2dc61e8a03282a2b`（`DamageIndicatorManager/wfxEmitPending header=[18, 4, 1, 2] sha=bc651b2e418514c0218283423206837d29fff28af0c47d4f2383b6ec2b9f0064`）。
- [DamageIndicatorManager/wfxFlushDamage](pcode/DamageIndicatorManager__wfxFlushDamage.pcode.txt)；文件 SHA256 `90b60216556636f7f98c33c0651aa03b61c82310ab6e4f02080cefc87c5a42d1`（`DamageIndicatorManager/wfxFlushDamage header=[3, 4, 1, 2] sha=c74f70c07f56afd99c422ff382b16525e639737960b0e178996cd8b9d7e2c1a1`）。
- [DamageIndicatorManager/wfxMergeDamage](pcode/DamageIndicatorManager__wfxMergeDamage.pcode.txt)；文件 SHA256 `cd8a3ea966a436af813d168250f88fc186cddfc36a371fd346b1b864ecc7e27b`（`DamageIndicatorManager/wfxMergeDamage header=[5, 10, 1, 2] sha=17efcd692f84bccd8008f0f42c7c6922551854639bdfec060c6c6f0e11e1e930`）。
- [DamageIndicatorManager/wfxMergeState](pcode/DamageIndicatorManager__wfxMergeState.pcode.txt)；文件 SHA256 `5ab895550a45ea35eaa4b61dc95239003bb1f96682d738cca5e5a5c5216ebadc`（`DamageIndicatorManager/wfxMergeState header=[8, 3, 1, 2] sha=89023245e8d1dbeaa280b870acd08c0852bebe1a9ac0a9c617e9f93f4cbc6cfa`）。
- [EffectManagerImpl/addDamageEffect](pcode/EffectManagerImpl__addDamageEffect.pcode.txt)；文件 SHA256 `e950840ec9db7936fa54e589e4d0c0b87362efa433ed1afca8f51ec4587ca1c4`（`EffectManagerImpl/addDamageEffect header=[10, 8, 1, 2] sha=239764b7c9f5d906f22f446190364db5d279ddcf1af87ed3fde190094637d229`）。
- [EffectManagerImpl/show](pcode/EffectManagerImpl__show.pcode.txt)；文件 SHA256 `66c739d360159e11963a90df117dd4fc61ce8ff8c9dd8e34890598f9ad46a880`（`EffectManagerImpl/show header=[11, 9, 1, 2] sha=043515f468f7dc2318bbef0da5b851e6e8a2d682e9c907fb61c6beb3a174db60`）。
- [EffectManagerImpl/wfxHitAllow](pcode/EffectManagerImpl__wfxHitAllow.pcode.txt)；文件 SHA256 `dab0f271bb9fc366fb90219f82956ed8df8304c480fa591d86c4a6c061034e9d`（`EffectManagerImpl/wfxHitAllow header=[4, 4, 1, 2] sha=05cead97e66eed7d61138a90c27bfb4d60614baf8715fc51d8caa0a75bc80172`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `c1f99f61133c90eaa9ac56b9beefd1f3c1ee23eaa16ce3b6c04cc84917bff1c1`。
- [build.py](source/build.py) ← `build.py`；SHA256 `5d8f625a0d6c8308daeb13bd201f0451272ff6fcda1e210224a4d5f08f76cad8`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `0ca0f2b6a5976c943cc962516be8cb542b98e78fc9a0ab66a410b850e3eccdea`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `c18e19314293d9099885be5fe802f78477e59fe42b700edcfaa5552590bf269e`。
- [perf_patch.py](source/perf_patch.py) ← `perf_patch.py`；SHA256 `70d088a0d78a97b9b91a24bb8015781f004affbb8fbcc63afee935073b7bec1f`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `9017ba078e1d4284ff3a063a949cdb125922a857f541540784401ebe8f94c894`。

## 已知限制与验收边界

- 被合并的合计伤害数字延后 1 帧显示；若目标在下一帧前已被移除则该条合计浮字不显示（不影响已结算伤害与溢出计数）。
- 超出每帧预算的受击特效及其绑定音效一并省略；表现层专用的 `damageEffectRandom` 调用次数随数字合并减少（不参与跨端同步）。
- 测试服输出 SWF SHA256 `1c145e2709d7f8716c9abd817d30632b6fc6700791d1168855c8e46b2154c676`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run14`、`<WORKDIR>/outputs/apk/client-perf-20261021`
