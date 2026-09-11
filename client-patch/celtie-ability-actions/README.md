# 校园希尔媞动作能力伤害补丁

能力标识：`celtie-ability-actions-v1`。本模块只实现与静态验证；不改 APK、不签名、不连接设备，不证明当前用户已安装兼容补丁。

## 范围

仅改 `ActionEvaluator/evalCommand` 的 CreateNormalAttack 分支。在原生 `newobject 49` 之后、`NormalAttack` 构造调用之前追加指令，其他原指令完整保留。白名单恰好五条缓存动作路径：

- `battle/action/skill/action/rare5/wind_spgirl_campus$wind_spgirl_campus_1`
- `battle/action/skill/action/rare5/wind_spgirl_campus$wind_spgirl_campus_2`
- `battle/action/skill/action/power_flip/campus_celtie_fever/campus_celtie_fever_lv1`
- `battle/action/skill/action/power_flip/campus_celtie_fever/campus_celtie_fever_lv2`
- `battle/action/skill/action/power_flip/campus_celtie_fever/campus_celtie_fever_lv3`

判定是 `get_action()` 与 `get_zone().asset._getActionDsl(完整路径)` 的对象严格相等。只查已加载缓存，缺失返回 null；当前动作为空会先退出，不会把两个 null 当作匹配。不接受路径前缀、近似名称，也不包括 PF 库存累加小技能。

匹配后只修改当前动态 NormalAttack 对象的九项：能力来源 true；主技能、副技能、PF、SkillInvoker 来源 false；副位能力来源严格取 `originMemberKind == 1`；`buffTargetAs=0`；PF 充能级别0；reference 改为 `AttackParameter(multiplierOfAttackPoint)`。其余字段、碰撞区域、hit、动画、行动时序和 ActionKind 原样保留。

## 输入门禁与验证

按方法名称唯一定位，并锁定 code SHA-256 `105f258ab3649922848391d6515c42df4a91d9f64e8ea3849884071a9255ecbc`、头 `[109,190,1,2]`、11602 条原指令、插入点2257和 `newobject49 → callproperty NormalAttack/1` 形状。所有使用的 QName 需 public 命名空间、名称唯一且为审查过的索引。未知、重复应用、方法或池漂移一律拒绝。

插入可 `unsplice` 字节级还原原方法；`asm.simulate` 验证栈与 scope；独立 `myabc` 读取器比较全部方法/traits/类/脚本/metadata，常量池仅允许末尾追加五个字符串。保存后再次验证非 ABC 标签不变、输入文件字节不变。输出和报告必须是互不相同的新文件。

测试执行实际插入 opcode 的小型 VM，覆盖五路径、主副位/PF来源、49字段中的其余值未改、引用参数、空缓存、近似路径和对象 identity；有本机 V14 fixture 时另测完整方法插入、漂移拒绝、重复拒绝及独立读取器抓额外方法修改。

```powershell
python -X utf8 -m unittest discover -s client-patch/celtie-ability-actions/tests -p test_patch.py -v
python -X utf8 client-patch/celtie-ability-actions/patch.py D:/WF/out/newchars-v14-20260908/v14.swf D:/WF/startpoint-cn/work/codex_out/celtie-fever-20260912/client-patch-fixture/celtie-v14-fixture.swf --report D:/WF/startpoint-cn/work/codex_out/celtie-fever-20260912/client-patch-fixture/build-report.json
```

V14 仅为不可变的验证样本。报告状态明确为 `fixture_static_verified_runtime_pending`，不能把静态测试当作设备实战验收或对所有客户端版本的兼容证明。
