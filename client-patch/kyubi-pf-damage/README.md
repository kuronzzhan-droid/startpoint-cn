# 九尾狐技能按强化弹射伤害计算

> **⛔ 已弃用(2026-09-07)。** 作者裁决不再需要「技能按强化弹射伤害计算」;设备定版为不含本模块的
> V13a(`D:/WF/out/newchars-v13-20260907/wf_newchars_v13a.apk`)。本模块最初的交付方式是 FFDec
> **整类重编译** `ActionEvaluator` / `MemberImpl` / `AbilityDamageShot`,装上后所有角色进战斗放技能/PF
> 即 `ReferenceError #1069 @ ActionEvaluator/evalCommand`(重编译把 evalCommand 改了上千条指令,
> 见 `D:/WF/out/f1069-diag/`)。`abcpatch.py` 是后来用字节级拼接重做的等价实现(V13),已通过静态验证但
> **未在真机使用**。任何客户端补丁都只准单方法 P-code / abcasm 拼接,禁止整类或直编 AS3。


> ## ⚠ 旧实现（整类 AS3 回编）已废弃 —— 用 `abcpatch.py`
>
> 本目录**曾经**的构建方式是：`patch.py` 生成四个类的改后 AS3，再用 FFDec
> 把 `ActionEvaluator` / `MemberImpl` / `AbilityDamageShot` **整类回编**进 SWF
> （只有 `SquadManagerImpl` 走单方法 P-code）。那样产出的 V9 APK
> **在真机战斗里抛 `ReferenceError #1069`**（在密封对象上找不到属性），
> 栈是 `ActionEvaluator/evalCommand ← eval ← evalBlock ← eval ←
> ListeningEvent/eval ← evaluationPhase ← ActionEvaluator/update`，
> 触发点是稻穗（139995）进 Fever／Fever 中放技能／发动 PF。
>
> 这就是 `client-patch/random-floor.md` 记过的那一类事故：**FFDec 直接编译 AS3
> 产出的字节码与原件运行时不等价**。实测这一次回编把 `evalCommand`
> 从 11,602 条指令改写成 12,679 条，并且是**成体系**地换写法：
> `findproperty` 500→4 / `findpropstrict` 80→813、`coerce` 1617→2 /
> `coerce_a` +791、`astype` 139→0 / `getlex`+`astypelate` +139、
> `initproperty` 27→0 / `setproperty` +27，另加 189 条 `debug`、29 条 `kill`、
> 231 条 `label`、200 条新 `ifstrictne`；接口方法调用从
> `QName(Namespace("pkg:Iface"),"m")` 变成 `Multiname("m",[public,…])`。
>
> **现在的构建入口是 `abcpatch.py`**（指令级插入，一条原指令都不改），
> 加上照旧的 `patch_squad_pcode.py`。`patch.py` 留下来只作为**意图**的可读版本
> （每一处改动的 AS3 原文），构建链上不再调用它，也不要再拿它回编。
> 成品与验收见 `D:/WF/out/newchars-v13-20260907/`。

## 意图（下面这段仍然有效，读的时候把「回编」换成「指令级插入」）

本补丁只重分类 `fox_oracle_autumn` 的两档主技能、常态特殊 PF 与能力 2 专属追击。
杰拉尔及合击搭档的技能通过各自的 `program_path` 独立判断，不按主位角色名一刀切。
基础 APK 必须是 2026-09-05 的 V8；从它增量修改四个类，保留已有 APK 补丁。

## 必须同时交付的数据与客户端改动

`ActionDsl` 裸树 `[10] = 3`（`buffTargetAs`）只切换普通增伤桶。
原客户端仍把普通技和 629 标为技能来源，独立技伤乘区、技能抗性和统计不会随之变为 PF。
因此纯资源修改不能完成本次要求。

本补丁在 `SquadManagerImpl` 的主技及合击技入口分别比较精确程序路径；
在 `MemberImpl.applyInstantAbility` 的 629 入口比较特殊 PF 专属程序路径。
识别成功后仅在 `ActionEvaluator` 的 `CreateNormalAttack` 产物上设置：

- `createdByPowerFlipAction = true`，主技/合击技来源标记为 `false`。
- 普通主动技能使用有效的 Lv1 作为 PF 伤害档位；不凭空获得 Lv2/Lv3 专属收益。
- 特殊 PF 的 629 在创建时从队长读取最近一次真实 PF 档位，固定为本次动作快照。
  每个实际 PF 执行者记录档位；缺少有效历史时回退 Lv1。普通角色只多记录一个数值，伤害不变。
- 保留原 `ActionKind`、技能槽、施放事件、连锁和演出控制流程。

能力 2 保留 I354 原行、主/副位、20 倍近敌伤害、原触发与 45 帧冷却。
`MemberImpl.kyubiIsPfAbilityDamage` 在 `abilitySlot.instantAbilities` 内找到同一地址对象，
同时验证 `source.origin` 为 2000（主位能力 2 第 0 行）或 1002000（副位能力 2 第 0 行），
再核对对应主/副角色的能力 2 ID 必须恰为 1399952。
`AbilityDamageShot` 仅对识别成功的伤害置 PF 标记、清除能力伤害标记，并快照真实 PF 档位；
将该追击的 `incrementCombo` 置 `false`，避免它再次触发 PF 命中并无限追击。
其余角色的 I354、九尾的武器/能力魂、其他主副位能力及全部数值不变。

## 来源与安全门

直接核对的客户端源码（行号为研究用反编译版本，V8 导出存在轻微偏移）：

- `ActionEvaluationResolver` 构造器：DSL `params[9]` 是 `buffTargetAs`。
- `NormalAttackCalculator`：PF 普通桶约 422 行，PF 独立桶 451 行，
  技能独立桶 499 行，PF 抗性 593 行，技伤抗性 609 行。
- `EnemyImpl.onNormalAttack`：约 5644–5665 行，只有 `incrementCombo` 为真才递增 PF 命中计数。
- `ActionKind`：`AbilitySkill` 的索引为 4，`PowerFlip` 为 5。
- `GeneralCharacterLogic` 约 1207–1224 行：能力 2 编号为 2/1002。
  `BattleCharacterLogic` 约 2375 行：来源号 = 能力编号 × 1000 + 行号。
  `AbilitySlotImpl` 约 1905–1926 行：地址与来源保存于同一个 `InstantAbility` 实例。

`patch.py` 只接受以下基线的完整四类导出哈希，并对每处替换检查唯一形状。
已生成源可幂等重跑；未知源、部分补丁、被改动的已生成源一律拒绝。

| 基线 | SHA-256 |
|---|---|
| V8 APK | `0cb1d3e438863e3fee167d0946f4816e8b78d807d6cd3d7bc5584427e5e555cb` |
| V8 SWF | `c1c0782bed5bbcaaf097855c041e3b05100a46387d7cccc2ef9372d7b57744ed` |

导出器使用 FFDec 24.0.1；其他版本的不同导出须重新复核后更新哈希，不能绕过验证。

```powershell
python client-patch/kyubi-pf-damage/patch.py --source-dir <V8导出的scripts> --out-dir <新scripts> --dry-run
python client-patch/kyubi-pf-damage/patch.py --source-dir <V8导出的scripts> --out-dir <新scripts>
python -m unittest discover -s client-patch/kyubi-pf-damage/tests -v
```

测试中的完整 V8 源不入库。通过 `KYUBI_PF_V8_SOURCE` 指定导出目录；
测试确认四类完整身份、补丁完全可逆、独立主/副路径、合法档位、其他攻击分支不变及未知源拒绝。
这些是源码门禁，不是 SWF 编译、真机、伤害数值或协力兼容验收。
构建方必须替换 `MemberImpl`、`ActionEvaluator`、`AbilityDamageShot` 三类，重新导出核对完整变更，
并验证 V8 既有补丁仍保留。

### `SquadManagerImpl` 必须用单方法 P-code

V8 的 `invokeActionSkill` 已有 Seris 双形态语音补丁，FFDec 导出的源包含
`§§goto/§§push/§§pop`，实际整类回编失败。不得尝试根据不完整反编译结果改写该分支。
`patch.py` 生成的这个类仅供源码差异审阅，不用于 SWF 替换。

`patch_squad_pcode.py` 直接修改既有 `invokeActionSkill` 字节码导出：
在两次创建技能 context 的 `newobject 12` 前各追加两对属性，然后改成 `newobject 14`。
两次路径判断用 `equals/equals/bitor/convert_b`，没有新分支；`maxstack` 从 29 调到 33。
原有 Seris 语音及其他指令、分支逐行保持。原 V8 方法体 SHA-256 锁为
`1e5cfb972f60505ab7dac6284584dcf387e0f5b64bcb0e9813a016b567afd739`。

```powershell
python client-patch/kyubi-pf-damage/patch_squad_pcode.py --pcode <V8类.pcode> --swf <待打补丁.swf> --out <单方法.pcode>
# 用工具返回的 body_index 做 FFDec -replace；之后重导该类为 P-code。
python client-patch/kyubi-pf-damage/patch_squad_pcode.py --pcode <V8类.pcode> --verify <重导类.pcode>
```

二次校验会规范化 FFDec 重命名的 `ofs` 偏移标签，并要求除此之外仅有这两块注入。


## 现在怎么构建（V13 用的就是这条）

`abcpatch.py` 在 **V13a**（V8 + V10 + V11 + V12，V9 缺席）的 SWF 上做 6 处指令级插入
和 5 个新成员，`patch_squad_pcode.py` 再补 `SquadManagerImpl` 那一处：

```bash
python -X utf8 client-patch/kyubi-pf-damage/abcpatch.py <v13a.swf> <v13.swf> --report <报告.json>

java -Xmx6g -Xss64m -jar ffdec.jar -format script:pcode   -selectclass pinball.scene.battle.battle.squad.SquadManagerImpl -export script <导出目录> <v13.swf>
python -X utf8 client-patch/kyubi-pf-damage/patch_squad_pcode.py   --pcode <导出目录>/scripts/.../SquadManagerImpl.pcode --out <单方法.pcode> --swf <v13.swf>
java -Xmx6g -Xss64m -jar ffdec.jar -air -onerror abort -replace <v13.swf> <v13-final.swf>   pinball.scene.battle.battle.squad.SquadManagerImpl <单方法.pcode> <工具返回的 body_index>
# 重导出后逐行复核
python -X utf8 client-patch/kyubi-pf-damage/patch_squad_pcode.py   --pcode <导出目录>/scripts/.../SquadManagerImpl.pcode --verify <重导出>/…/SquadManagerImpl.pcode

python -X utf8 client-patch/kyubi-pf-damage/verify.py <v13a.swf> <v13.swf> --report <verified.json>
python -X utf8 -m unittest discover -s client-patch/tests -p "test_kyubi_pf_damage_abc.py"
```

### 改了什么（相对 V13a）

| 方法 | 插入点（基线指令下标） | 代码字节 |
|---|---|---:|
| `MemberImpl.startPowerFlip` | 16 | 1099 → 1108 |
| `MemberImpl.applyInstantAbility` | 1380 | 4508 → 4541 |
| `ActionEvaluator.evalCommand` | 1895 | 29212 → 29301 |
| `AbilityDamageShot`（构造器） | 40 | 372 → 434 |
| `AbilityDamageShot.finish` | 361 / 369 / 371 / 422 / 426 | 1205 → 1276 |
| `SquadManagerImpl.invokeActionSkill`（P-code） | 两处 context | 1771 → 1853 |

追加成员：`MemberImpl` +1 个 int 槽 +2 个方法；`AbilityDamageShot` +2 个槽。
常量池只追加 6 条字符串、5 个 QName、2 个 int，别的池一条不改。

### 三处与旧实现写法不同（语义相同）

1. `kyubiLastPowerFlipChargeLv` / `kyubiPfChargeLv` 的槽默认值是 **0** 不是 1。
   前者唯一的读点是 `kyubiGetPowerFlipChargeLv()`，它做 `max(1, min(3, x))`，0 和 1 读出来都是 1；
   后者唯一的读点是 `kyubiPfDamage ? kyubiPfChargeLv : 0`，而构造函数在把
   `kyubiPfDamage` 置 true 时一定同时写了它。
2. 629 的 context 不改 `newobject 12` 的操作数，而是在它之后 `dup` + `setproperty` 两次。
   **注意 FFDec 反编译回读会把这个形状渲染成三个一模一样的对象字面量**
   （它没法表达「同一个临时对象」），那是渲染假象，不是三个对象 —— 字节码里
   `newobject` 只执行一次。
3. `finish` 里 5 个值表达式不改写原指令，而是在原指令之后插入
   「`pop` 掉再压新值」。回读会看到 `§§push/§§pop`，那正是这个形状。

`verify.py`（独立读取器）复核：只有主 ABC 那一个 tag 变；常量池只追加声明过的条目；
`metadata/classes/scripts` 逐字节不变；`methods` 只在末尾多 2 条；`instances` 只有
`MemberImpl` 与 `AbilityDamageShot` 在 trait 表**末尾**多出条目；恰好 5 个体被改、
2 个体被追加；每个被改体的原指令逐条保留、分支只做平移；插入段与声明逐条一致；
栈/作用域抽象解释无错、不可达指令数不变；两个新方法只在声明的地方被调用；
并用 CreateNormalAttack 对象字面量的消费点反证 `_loc63_/_loc4_/_loc5_/_loc24_`
就是 63/4/5/24 号寄存器。
