# 第十一轮原生链独立审阅

固定输入 `run10/v35j.swf` 的 SHA256 为 `1414862f84a1895b0bea54613f92fd48a59d11544a6097ef4dd2627c0dfe2384`，与相邻 SHA 文件相符。本文只描述本次重新从该 SWF 提取的字节码；完整方法体、SHA/header 和索引见 `native-evidence.json`、`native-pcode/`。不把离线执行解释为完整 AIR 或设备证明。

## 码 33 的正确原生入口

`MemberImpl/scheduleDirectAttack` 的指令 132–148 先调用原生 `getAdditionalDirectAttack`，将 `directAttackTimes` 放入 local5，将 `directAttackDamage` 放入 local6。149 起计算 `1 / local5` 和循环次数；160 起进入码 25 / 凯尔合并链。因此在 149 前把新增次数加到 local5，可以共同进入原生排程、次数统计、连击和合并处理，而无需新增伤害乘区。`getAdditionalDirectAttack` 内部从能力、状态和场地效果按 `AdditionalDirectAttackContent.getBetter` 选择已有原生效果，不能改成把原生彼此全部累加。

## 受治疗者、队伍及持有者

`MemberImpl/applyImpact` 的 104–132 指令对非死亡且所属队伍允许治疗的成员调用 `applyHeal`。`applyHeal` 的 24–36 指令保留“不允许接受队友治疗”的原生拒绝门；对获准治疗，其末尾 199–205 调用原有 `wfxHealSample`，输入包含总量、有效量、采样前最大 HP。它是每个受治疗成员的一次实际回复入口。

`SquadImpl/getMember` 仅转调 `getMemberAt`；后者只接受 0、1、2，返回 `Option.Some(member)` 或 None。越界会抛错。合击不是另一套可受治疗的独立实体成员。扫描必须限定 0–2 并展开 Some。

`ConditionSlot/wfxRows(code, true)` 依次读取成员本体、`invisibleSlot`、`squadSlot` 的 Some 槽、该队伍槽的 `invisibleSlot`；以槽对象身份消除别名重复。队伍槽中的状态因此对每个成员有效，不能把同一队伍状态只分配给任意一个成员；具体角色示例应仅给水杰拉德自身槽施加 34/35。

`Battle/__isMyBattle__` 返回 `battle.primary` 布尔。这个本端所有权标记与 `squadManager.primary` 的本队对象是两个概念。只检查受治疗者属于 `squadManager.primary`，不能排除另一个模拟 Battle 的本队。新功能需使用本端所有权门，旧码分支则保持旧行为。

## Fever 单位与统计

原 `MemberImpl/wfxHealFever` 对有效百分比和溢出百分比加权后除以 10000，再 `Decimal.fromFloat`，调用 `Zone.addFeverPoint(..., true, 101)`。`FeverPointGaugeImpl/addFeverPoint` 的 2–16 指令对 kind>=100 先乘当前槽最大值再减 100，故码 31 的 `value=100` 在有效 1% 时为最大槽的 1%；码 35 每档 `value=500` 就是 5%。kind 101 会触发原生能力加槽事件及 stat59 计数，因此调用次数也有可观察语义，不能只比较最终槽量便声称“一次 API”成立。

## 联机裁定 B：跨 ID 实际回复按本端归属计入

原生 `ActionEvaluator/evalCommand` 的治疗分支在指令 3582–3588（RatioHeal）取得施放者 `get_battle().get_id()`，并在 3652–3653 写入源 `battleId`；NormalHeal 使用同一口径。`Battle/get_id` 直接返回 `initialData.id`。`ActionEvaluator/addImpactToSubject` 对 Mate 原样包装 NormalHeal / RatioHeal 参数为 `SendImpactToMate`。

接收端 `Battle/applyCoopCommand` 的 325–345 原样转回 NormalHeal / RatioHeal payload，400–401 只增设 `createdByCoopCommand=true`，不改 payload 的 `battleId`。NormalHeal / RatioHealCalculator 将该来源 `battleId` 原样写入结果 `statsBattleId`。`BattleScenePlayingStateImpl/distributeCoopCommand` 明确区分 `scene.myBattleId` 与 `otherBattleDerailleurs` 的各 Battle ID。因此普通跨玩家治疗拥有来源端统计 ID，不能把“本队被治疗”解释为天然同一个 statsBattleId。

原生 `MemberImpl/applyHeal` 147–191 在跨 statsBattleId 时依然回血，只把统计通过 `StatsFeedback(HealToMember, 来源 ID)` 发回。反馈在 `Battle/applyCoopCommand` 505–553 只增加任务统计和调用 `summerizeHealResult`，不会再次调用 `applyHeal`。`ImpactManagerImpl.shouldSync` 对 Heal + 非敌方 + 非棺材返回 false，正常我方回血结果不会再作为 Impact 广播。

TASK11 末尾裁定 B 已明确允许本端收到的跨玩家治疗计入 34/35，因此本轮只删除新助手 `wfxHealAnySample` 的来源 `statsBattleId` 相等门。`wfxHealSample` 的旧码 30/31 跨 ID 排除不变；来源 ID 本身不重写。新助手保留 `Battle.__isMyBattle__`、受治疗者所在 `squad` 与 `squadManager.primary` 的对象身份、受治疗者确实出现在该队成员列表等归属检查。镜像 Battle 即使推进其模拟 HP，也不能产生 34/35 贡献。

独立 `network_cases.py` 现执行真实 `Battle.applyCoopCommand` 的 SendImpactToMate 接收分支、真实 `RatioHealCalculator.calculate`、真实 `MemberImpl.applyHeal` 和真实 StatsFeedback 接收分支。受控对象只提供引擎数据、枚举及定点数基础函数，不替代上述路由与 WFX 算法。用例验证来源 ID 从 payload 保留到统计结果、接收排队时无 HP/新效果变化、本端执行回复后仅持有者一次贡献、回执只更新来源统计且不二次触发、镜像执行不计入。

另外执行真实 `BattleScenePlayingStateImpl.distributeCoopCommand`：远端来源只写入一个本端 driver，跳过来源对应的镜像；本端来源不回写本端 driver。仅转发阶段不调用回复或产生 34/35。上述原生链、归属门和回执边界共同排除常规转发/镜像/回执造成的重复计入；没有新增网络消息批次标记，也不把重复投递两次同一“实际回复”解释为已实现任意网络重放去重。实际联网传输及完整 AIR 运行仍为「未核实」。

“实际回复”指原生 `applyHeal` 的获准回复路径已经执行；满血时有效恢复为零仍按需求计算合法溢出，不以 HP 净增量大于零作为前置条件。原生拒绝协力回复的提前返回、拒绝治疗标记和零治疗量均不产生新贡献。

## Fever 裁定 A：每成员实际回复一次 API

原生 `ImpactManagerImpl/processImpacts` 仅遍历本帧已拆成 `target + source` 的条目，没有共同治疗批次令牌。友方 `ActionEvaluator/calculateImpactId` 2–8 直接返回 None；本地 DSL 每执行一次 NormalHeal / RatioHeal 指令都会构造新的 source/content。不能按同帧、治疗者、倍率或相同数值合并，否则会混并两次独立治疗。

接收一条 `SendImpactToMate` 时，原生可见的 0–2 成员循环共享 `content` 对象，因此该特定入口存在对象身份边界；它不能自动推广至所有本地技能、能力、道具、场地和持续回复。TASK11 末尾裁定 A 已选定每名成员的实际回复各自量化后各调用一次 Fever API，明确不加批次标记。实现维持“每次实际成员回复，各持有者合计自己的多状态后一次 API”；同帧、同来源、多成员仍分别调用，不能跨成员合并零头或 API。独立断言同时检查两名成员的两次调用、原生槽总量和持有者伤害汇总，避免仅用最终槽量相同替代调用边界验证。

两项 `pending_clarification` 均已由裁定解决；未核实项只保留实际联网、完整 AIR、设备及画面行为。
