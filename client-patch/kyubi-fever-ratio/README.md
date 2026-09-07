# Fever 槽按上限比例增减（instant_content 724，V12）

能力标识：`kyubi-fever-ratio-v1`。

给瞬发词条加一条新 kind **724 `AddFeverPointRatio`**：触发时给当前 zone 的
Fever 槽加 `strength/100000 × 当前槽上限`，带符号，并且和官方 213 `AddFeverPoint`
一样**绕过 Fever 上升率乘区**。稻穗（139995 `fox_oracle_autumn`）用它做
「Fever 中自身发动技能 → 燃烧 10% 槽上限」。

## 列契约

| 列 | 内容 | 解析器 |
|---|---|---|
| ability `c47`（instant_content 块偏移 0） | `724` | `AbilityValues.parseAt47` |
| ability `c51` / `c52`（块偏移 4/5，`strength.power1` / `strength.first_max`） | Decimal ×100000，**允许负号** | `AbilityValues.parseAt51` |

和 213 用的是同一列，因此 SLv 缩放、`AbilityPowerValue` 的取值方式全部照旧；
唯一的区别是 213 走 `resolveInt`（把 Decimal 取整成绝对点数），
724 走 `resolveDecimal`（保留原始定点值当比例）。`-10000` = 槽上限的 **−10%**。

槽上限每进一次 Fever ×1.25（`FeverPointGaugeImpl.as:243/348`），所以「上限的 10%」
在第 3 次 Fever 时比第 1 次多 56%。钳位不用补丁写：Fever 槽是
`new ClosedInterval(0, max, 0)`，`ClosedInterval.set` 本来就把值夹在 `[0, max]`。

生效行（稻穗 V12 包 1.0.9，`ability.orderedmap` 键 `1399951` 第 4 条记录）：
`c6=12`（Fever 中）+ `c27=23`（自身发动技能）+ `c47=724` + `c51=c52=-10000`。
契约由 `mod-tools/tests/test_inaho_v12_package.py` 钉死。

## 未打补丁的客户端会崩

`AbilityValues.parseAt47` 的 else 分支是
`throw new ClientError(7050,"不存在的构造函数。")` —— 官方 APK 读到 724
就崩在角色详情页。所以**数据必须等 APK 到位再发**。闸门登记在
`mod-tools/wf_client_legality.py` 的 `CLIENT_PATCH_CONTENT_KINDS`，
`required_client_capabilities()` 会把这一行报成需要 `kyubi-fever-ratio-v1`。

## 改了哪七个方法体

全部是「在一个指令边界上**整块插入**」：原有指令一条都没改（操作码、操作数全等），
只有分支的 s24 偏移按插入长度重算。表格里的 body index 由
`client-patch/tests/test_kyubi_fever_ratio.py` 按类名+方法名从真实 ABC 重新解析后断言，
不是抄来的常量。

| 类 / 方法 | body | 插入点(指令) | 新增指令 | 代码字节 | 干什么 |
|---|---:|---:|---:|---:|---|
| `AbilityValues$/parseAt47` | 39128 | 6 | 16 | 51283 → 51325 | 认识 `"724"`，构造 master value |
| `InstantAbilitySource$/resolveInstantContent` | 14582 | 56 | 22 | 85750 → 85804 | master value → `InstantAbilityContent.InstantBattle(InstantAbilityInstantBattleContent("AddFeverPointRatio",5,[strength]))` |
| `InstantAbilityContentTools$/mergeForDescription` | 14504 | 26 | 25 | 1736 → 1790 | 新 kind 一律不合并（否则 `_loc3_` 留 null，后面 `switch(_loc3_.index)` 空引用） |
| `InstantAbilityDescriptionGenerator/stringfyInstantBattleContent` | 11983 | 2 | 36 | 17 → 95 | 面板文案 |
| `InstantAbilityDescriptionGenerator/stringfyInstantBattleContentAccordingToPrecontent` | 11919 | 2 | 9 | 626 → 646 | 带前置内容时的兜底（官方 switch 只有 0..4，新 kind 会留 null 闭包） |
| `AbilitySlotImpl/applyInstantBattle` | 51510 | 27 | 20 | 723 → 768 | 战斗生效 |
| `FeverPointGaugeImpl/addFeverPoint` | 60988 | 2 | 15 | 308 → 335 | 比例 → 绝对值的**唯一**换算点 |

`InstantAbilityInstantBattleContent` 的新 index 是 **5**（官方 0..4 占满）；
`InstantAbilityContentMasterValue` 的新 index 是 **724**（官方 `__constructs__` 724 条，占满 0..723）。
两个枚举都**不加静态工厂方法**，直接 `construct` 类本身（那正是官方工厂内部做的事），
所以 ABC 的 method_info / instance / class / script 四张表逐字节不变。

### 比例怎么算出来的：statsKind 哨兵

`Zone.addFeverPoint(value, isChangeable, statsKind)` 的第三参在官方全库只取
0/1/2/3/4（分别对应不同的 stats 统计口径，`kind 1` 还会触发
`abilityTrigger.countUp(9,…)`「因能力增加 FEVER 槽」）。补丁在
`AbilitySlotImpl` 传 **101 = 100 + 官方 kind 1**,
`FeverPointGaugeImpl.addFeverPoint` 开头拆开：

```as3
if(param3 >= 100)
{
   param1 = param1 * feverPoint.max;   // Decimal 原始值 × 浮点上限
   param3 = param3 - 100;              // 还原成官方 statsKind
}
```

于是往下的 `isChangeable`、白条动画、xdebug ×10、`feverPoint.add`、
`stats.add(132/133)`、`countUp(9)` 全部与 213 走同一条路,统计口径不打折。

哨兵安全性不是靠注释:`verify.py` 会枚举**最终产物**里每一处 `addFeverPoint`
调用点的 statsKind 实参,断言 ≥100 的只有我们那一处;
另外三处实参不是字面量的(EnemyImpl 的三元 + EnemyImpl/ZoneImpl 的纯转发),
它再证明那三个方法体里根本不存在 ≥100 的整数字面量。

### 面板文案

`stringfyInstantBattleContent` 在方法开头拦 index 5,用官方的
`AbilityDescriptionTools.stringfy(value)`（把任意值包成描述闭包）返回

    "FEVER槽上升（槽上限的）" / "FEVER槽减少（槽上限的）" + Decimal_Impl_.toPercentString(|s|) + "%"

配上触发前缀,面板读作「Fever模式中，自身发动技能时，FEVER槽减少（槽上限的）10%」。
官方 ui_string 没有「上限的 N%」这种键(`ability_description_instant_content_add_fever_point`
是 `'Fever ::count::'`),所以这两句中文是内联字面量;百分比走官方
`Decimal_Impl_.toPercentString`,与别处的格式一致。

`InstantAbilityInstantBattleContent` 的其余消费者已逐个查过,index 5 都不会抛:
`AbilityDescriptionTools.isContinuationInstantBattleContent`、
`AbilitySummarizer.getChangeContentFromInstantBattleContent`、
`AbilityTriggerDifference.diffInstantAbilityInstantBattleContent`、
`PartyRibbonSummarizer.resolveInstantContent` 全部落在「没有 case 就什么都不做」,
只有上表那两处 mergeForDescription / AccordingToPrecontent 会留 null,已经补上。

### 一处已知的「没做」

两个枚举类的 `__constructs__`(静态字符串表)**没有**跟着加条目 ——
它由类初始化器的字节码构建,要改就得动 cinit,而我们这条链上没有任何代码读它:
`Boot.enum_to_string` 走的是实例的 `tag` 字段(我们填了 `"AddFeverPointRatio"`),
不是 `__constructs__`;`Type.enumConstructor` 这类反射 API 在这条路径上不出现。
真要在别处用 Haxe 反射枚举名时,记得这一条。

## 锁定输入与修改范围

输入 = V11 产物 `v11-minimal.swf`,SHA256

`9c86430e7dc230e2abd7aa799a9ecaeb9be6056278712d9b2939878912ed5900`

（V11 APK 本身 SHA256 `77a31e160d744f08da62578a7381447b4ee77066727869925f6852a75acd73ad`。）

新增常量池条目只有 4 条字符串:`724`、`AddFeverPointRatio`、
`FEVER槽上升（槽上限的）`、`FEVER槽减少（槽上限的）`。
新增 multiname **0** 个、新增方法 **0** 个、新增 trait **0** 个 ——
`InstantAbilityContentMasterValue` / `InstantAbilityInstantBattleContent` /
`AbilityDescriptionTools` / `Decimal_Impl_` / `Zone` 这些类在基线里早就被 `getlex` 过。

## 为什么不走 FFDec

`parseAt47`（51KB）和 `resolveInstantContent`（85KB）这种巨型方法体,
FFDec 的 P-code 往返**即使一个字节都不改**也会重写上百条「终止指令之后的死 jump」
（实测 39128 体 724 处、14582 体 723 处,偏移被归零）。那些改写可以证明无害,
却会把「只有我改的地方变了」这条判据彻底淹掉。所以本补丁在 ABC 字节层动手,
用仓内读写器 `client-patch/rank-button-p1/abc/abcfmt.py`（逐字节往返自检）
加 `client-patch/abcasm/asm.py`（指令级汇编 / 拼接 / 重定位）。

## 怎么重建

```bash
# 1) 打补丁(输入必须是锁定的 V11 SWF)
python -X utf8 client-patch/kyubi-fever-ratio/abcpatch.py --require-base \
    D:/WF/out/newchars-v12-20260907/base-v11.swf \
    D:/WF/out/newchars-v12-20260907/step1-fever.swf \
    --report D:/WF/out/newchars-v12-20260907/step1-fever-report.json

# 2) 独立复核(与打补丁不共用一行读取器)
python -X utf8 client-patch/kyubi-fever-ratio/verify.py \
    D:/WF/out/newchars-v12-20260907/base-v11.swf \
    D:/WF/out/newchars-v12-20260907/step1-fever.swf \
    --report D:/WF/out/newchars-v12-20260907/verified-fever-ratio.json

# 3) 回归
python -X utf8 -m unittest discover -s client-patch/tests -p "test_*.py"
```

补丁**幂等**（已经打过的 SWF 会被拒绝,而不是打第二遍）、**可逆**
（`abcpatch.patch_body` 每次都当场把插入块摘掉,验证能逐字节还原基线),
输入漂移一个字节就当场报错。

## 与 dash-parameter 的关系

`client-patch/dash-parameter/`（during_content 422）改的 13 个方法体
与这里的 7 个**完全不相交**,两个补丁可以任意先后叠加;
V12 构建链是 `base-v11 → step1-fever.swf → v12.swf`。
`client-patch/tests/test_dash_parameter.py` 把「不相交」写成了断言。
