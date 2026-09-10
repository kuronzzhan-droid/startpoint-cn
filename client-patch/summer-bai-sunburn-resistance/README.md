# 夏日白晒伤能力抗性

能力标识：`summer-bai-sunburn-resistance-v1`。

夏日白的 413 施加 `Unique(1499901)` 晒伤标记；原 171 → 348 行只是能力伤害加算，
没有修改敌人能力抗性。本补丁让现存晒伤每层提供 15% 能力抗性降低，最多三层。
标记仍由原游戏条件系统维护，失效或减层后下一次读取立即反映，不创建另一份计时状态。

## 实际计算入口

仅在 `ConditionSlot.getOneSideTotalAbilityDamageResistance` 原生循环之后、返回之前追加：

```text
若 param1 == false，owner.index == 2，且不是 invisibleSlot：
  n = clamp(getConditionAccumulationCount(Unique(1499901)), 0, 3)
  total -= n * 15000
返回原 total
```

Decimal 分辨率是 100000，15000 即 15%。`getConditionAccumulationCount` 按原实现取可见
条件的最大层数，保持既有同源叠层语义。隐形子槽不追加晒伤减抗，原本其它抗性条件仍照常累加。

敌人实战的 `EnemyImpl.getStatModifierAbilityDamageResistance` 分别读取 false/true 两侧，
对 false 侧套用原生 `DEBUF_ABILITY_DAMAGE_RESISTANCE_LIMIT` 下限，再与 true 侧相加。
该入口及下限保持原字节；没有修改用于汇总显示的 `getTotalAbilityDamageResistance`。

原统计模式允许 Bad 类减抗条件，本补丁也保留这一语义，不额外排除统计模式。
413 原生标记使用 false 侧；不改技能归属、普通攻击计算器、属性伤害或其它角色的条件。

## 配套数据要求

安装此补丁时应同时移除能力 `1499903` 原第 5 行的 `during 171 → content 348` 加算，
保留前四行以及 `Unique(1499901)` 的现有寿命、叠层、强制施加和显示设定。
面板覆盖行 `desc_override_white_tiger_summer_3` 应说明实际减抗行为。
构建器不修改资源表、角色包或 store，这些变更由单独的数据发布流程处理。

## 构建与验证

仅接受已核实的原 V14 SWF 或其声音路由产物，完整输入 SHA 列在 `patch.py`。
按方法名定位后再锁定原 code SHA、栈、局部变量、作用域和异常表，拒绝未知基座、重复应用
或覆盖已有输出。原 243 条指令保留，仅在第 241 条之前插入 33 条；复用已结束循环的 local 4。

```powershell
python -B -X utf8 client-patch/summer-bai-sunburn-resistance/patch.py SOURCE.swf FINAL.swf --report build.json
python -B -X utf8 client-patch/summer-bai-sunburn-resistance/verify.py SOURCE.swf FINAL.swf build.json verify.json
```

独立解析器确认只改主 ABC 的 body 56922；其它 92,555 个方法体、类、签名、常量池已有项及
非 ABC 的 SWF 字节完全保留。新增的整型常量只有 1499901，maxstack/localcount 无需增加。
验证器在实际生成的注入字节上执行 504 个组合，并验证 0 → 1 → 2 → 3 → 3 → 1 → 0 生命周期、
负层与超限层钳制、两侧和其它 owner 隔离、隐形槽不追加、统计模式以及原生抗性下限的合成。

组合声音路由后的最终 SWF SHA：
`eed904417bb6a2865a471d309ae60b3d64be1e51c8e7c28e9a5035a2d8b774b8`。
FFDec 24.0.1 实际读回确认上述分支，也确认 V14 的 `AbilityLogic` 两个面板方法仍保留通用
`desc_override_` 查表并直接返回的逻辑。

最终 APK 回执应同时绑定 `summer-bai-voice-router-v1` 与本模块能力标识到 SWF SHA。
当前角色包 schema 的 capability 是非空字符串，没有需追加的全局枚举注册表。
这些验证属于静态和受控字节码语义验证；安装后仍须实际验证晒伤施加、退层、结束、敌方伤害
以及其它抗性来源共存，不能据此宣称实战验收完成。
