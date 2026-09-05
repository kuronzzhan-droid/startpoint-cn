# 五重决战 BothBoss 选图随机化(five-boss-random-map)

**一句话**:五重决战进战前挑 boss 组合时,官方是"按队长伤害类型对号入座、命中第一条就
定死";这个补丁改成"把所有能命中的行都收起来,再按种子随机抽一条",而且**只对入口
quest id 落在 `1099001..1099099` 的关生效**,官方索拉斯等其他 BothBoss 关一字节不改语义。

## 官方是怎么选图的(改之前)

进战前 `BattleStartLoadingTaskBase.startAssetLoading` 调
`BothBossTool.mapBoss(kind, globalLogic, mates)`:

1. `BothBossMapRepository.getBothBossMap(entryQuestId)` 取 `both_boss_group[入口id].map_ids`
   对应的 `both_boss_map` 行,**按 id 升序**;
2. 对每个 viewer 用自己的队伍造一个 `BothBossMapTranslator`,再拿它逐行调
   `BothBossMapLogic.getAvailableBothBoss`(多人)/ `getAvailableBothBossSingle`(单人);
3. **第一条返回 `Some` 的行**决定这个 viewer 的 `{viewerId, questIds:[第0轮, 第1轮]}`,
   然后 `break`。

`getAvailableBothBoss` 自己的三条出口:

- `test(translator)` 通过 → 返回 `[condition_quest1, condition_quest2]`;
  五个 `party_condition_kindN` 全是 `(None)` 时 `test()` 恒为真,所以"无条件行"也走这条;
- `test()` 不过,但 `default_quest1/2` 都有值 → 返回 `[default_quest1, default_quest2]`;
- 否则 → `None`。

数据侧现在按"队长主要伤害类型 kind 0..4 各 A/B 两条"排 `1099001001..1099001010`,再加一条
无条件兜底行 `1099001999` 放最后。**不打补丁**的客户端就是"同一套队伍永远打同一对 boss"。

## 打完补丁的规则

只有 `isRandomMapQuest(entryQuestId)` 为真(`1099001 <= id <= 1099099`)时才改行为:

1. 不再遇到第一条 `Some` 就 `break`,而是**把所有返回 `Some` 的行都收下来**;
2. 分成两桶:
   - **带条件命中桶**:该行至少声明了一个 `party_condition_kindN`(不是 `(None)`)
     **并且** `test(translator)` 为真 —— 也就是这个 `Some` 确实来自条件分支,不是
     `default_quest` 兜底;
   - **无条件/兜底桶**:其余全部(无条件行、以及条件没过但靠 `default_quest` 返回的行);
3. 候选集 = 带条件命中桶(非空时)否则无条件/兜底桶;
4. 从候选集里取 `pool[seed % pool.length]`;
5. **候选集为空**时什么都不 push,和官方"没有任何行命中"的结果完全一样
   (多人:这个 viewer 不进结果数组;单人:返回空数组)。

窗口外的关(索拉斯等)走的仍是那条官方语句:`push` 后立刻 `break`,一条指令都没多。

第 1 轮(`refreshBossAndRound` 用 `getMaxDamage` 的 viewer 统一)的逻辑**没动**:整张图
(两轮的 quest)是开战前一次算出来的,轮次切换只是拿 `questIds[round]` 取下标。

## 种子怎么来的

| 场景 | 种子 |
|---|---|
| 多人 | `djb2("<房间号>|<round>|<入口questId>") & 0x7FFFFFFF` |
| 单人 | `djb2("<Date.getTime()>|-1|<入口questId>") & 0x7FFFFFFF` |

**房间号从哪拿的**:`GlobalLogic` 上没有任何协力房间的 getter(全仓 `pinball/context/global/`
里搜不到 `roomId` / `roomNumber` / `cooperationRoom`)。但
`BattleConnectionConfig.roomNumber:String` 就在 `mapBoss` 的 `case 1:` 分支的局部变量
`_loc10_` 上,这正是调用 `bothBossMap` 的那一行。所以补丁给 `bothBossMap` 加了一个尾部
可选参数 `param4:String = ""`,并让**唯一那处官方调用**把 `_loc10_.roomNumber` 传进去。
不需要退化成 "最小 viewerId + 当前分钟数"。

**为什么必须是全房一致的量**:官方设计里每个客户端都在本地算出**全部** viewer 的图,
没有主机下发。三个种子输入(房间号、轮次、入口 id)在同房间的每台机器上都一样,所以每台
机器为同一个 viewer 算出的下标一致 —— 这是不脱机的唯一保证。不同 viewer 的候选集可以不同
(队伍不同),这是官方本来就允许的。

**哈希为什么是 djb2 & 0x7FFFFFFF 而不是 FNV-1a**:FNV-1a 的 `hash * 16777619` 会到
7.2e16,超过 `2^53`,AS3 里靠 double 中转会丢低位;djb2 的 `hash * 33` 最大 7.1e10,
每一步都精确。掩到 31 位后结果恒非负,`seed % length` 才是合法下标。整段只用 `int`,
不用 `uint` 也不用 `>>>`,少一层对 FFDec 自带 AS3 编译器的依赖。

**已知性质(不是 bug,是这个种子的必然结果)**:房间号在一个房间的生命周期里不变,
所以**在同一个房间里反复开五重决战,选到的图是同一张**。想重摇就散房重开。
`hostEntryTime` 同理(它是"房主进房时间",也随房不随场),`playId` 是各客户端各自
prepare 拿到的、没证明跨端相等,所以都没用。要做到"同房每场都换",得先找到一个
**服务端下发且全房一致的每场量**,再把它并进种子 —— 那是另一次改动。

## 改了哪三处(锚点)

权威输入是**真机在用的 V6 APK 里那份 SWF** 反编译出来的
`pinball.scene.battle.battle.BothBossTool`(不是 `弹国服/scripts` 那份:那是更老的 FFDec
导出的,`bothBossMapSingle` 里带 `§§goto`,回编译不了,也不是 V6 的当前形态)。

| # | 锚点 | 改动 |
|---|---|---|
| 1 | `mapBoss` 里 `BothBossTool.bothBossMap(param3,_loc10_.questId,param2)` | 补一个 `,_loc10_.roomNumber` |
| 2 | 整个 `bothBossMap` 方法体 | 换成收集+抽取版,并在前面插 6 个静态辅助函数 |
| 3 | 整个 `bothBossMapSingle` 方法体 | 换成收集+抽取版 |

新增的 6 个静态函数:`isRandomMapQuest` / `isConditionalRow` / `mapSeed` /
`singleMapSeed` / `randomIndex` / `pickCandidate`。

`isConditionalRow` 的参数**故意声明成 `Object`**:这样 `param1.values.party_condition_kind1`
整条链都是运行时查找,FFDec 的重编译器不必去解析 `BothBossMapValues` 的 traits,也就
不用为它加 import。

## 用法

```powershell
python -X utf8 client-patch\five-boss-random-map\patch.py `
  --both-boss-tool <FFDec 导出的官方 BothBossTool.as> `
  --output-dir out\five-boss-random-map
```

补丁器要求每个锚点**恰好出现一次**;重复运行**字节不变**(先认标记,认到就只做验证直接
返回);输出走临时文件 + `os.replace`。

回读复验(FFDec 重新导出的类里没有注释,所以标记也没了):

```powershell
python -X utf8 client-patch\five-boss-random-map\patch.py `
  --verify <回读的 BothBossTool.as> --expect out\five-boss-random-map\BothBossTool.as
```

`--verify` 的 markerless 验证器检查 11 条语义针,并且会把 `_locN_` / `paramN` 归一、把
十六进制和十进制整数常量归一,所以 FFDec 重编号寄存器、把 `2147483647` 渲染成
`0x7FFFFFFF` 都不会让它失灵。它盯的是:

1. **范围判定存在且只针对 `1099001..1099099`** —— 两个字面量各恰好一个,全类不许出现
   第三个 `1099xxx` 七位数;
2. **候选集收集循环存在** —— 多人/单人各一处 `isConditionalRow(...) && test(...)`
   的二分 push;
3. **随机取值函数存在且模候选集长度** —— `randomIndex` 里有 `param1 % param2`,
   `pickCandidate` 里有 `randomIndex(seed, int(pool.length))`;
4. **官方首条命中路径在非五重时保留** —— 多人/单人各一处 `if(!gate){ push; break; }`;
5. 外加:调用点确实传了房间号、旧的三参调用一处不剩、两条路径各自被 `isRandomMapQuest`
   把门、djb2 那一行没被改。

`--expect` 会额外把回读件和生成件做归一化 token 全等比较,不等只打 warning(加
`--strict-readback` 变成报错)。已知的良性差异有:重编译器丢掉没用到的 import、
构造函数补出 `super()`、`NaN` 渲染成 `Number(NaN)`、十进制变十六进制、两处赋值被套上
`Boolean(...)` / `int(...)` 恒等强转。

## 测试

```powershell
python -X utf8 -m unittest client-patch/tests/test_five_boss_random_map.py -v
python -X utf8 -m unittest discover -s client-patch/tests -p "test_*.py"
```

三层:策略镜像(patch.py 里的 Python 模型和注入的 AS3 是同一套算术、同一条选择规则)、
文本注入(锚点唯一/幂等/只动三处/行尾保持)、篡改回归(逐条破坏验证器该抓的性质)。
本机若存在 `D:\WF\out\abyss-v7-20260905\BothBossTool.official.as`,还会额外拿真实的官方
类跑一遍锚点唯一性和可逆性。

## 与数据侧的配合(**重要**)

1. **无条件兜底行的 id 必须最大**。补丁没有改行的遍历顺序,只改了"命中之后怎么选"。
   兜底行如果排在条件行前面,窗口外的关(以及本补丁的官方回退路径)仍然会被它一口吃掉。
2. **条件行不要填 `default_quest1/2`**。填了以后条件没过的行也会返回 `Some`,虽然会被
   归进"无条件/兜底桶"不影响正确性,但会让兜底桶里塞进一堆重复的兜底 quest 对,
   稀释不了什么但没意义。
3. `both_boss_group[1099001].map_ids` 要把所有行都列进去,`getBothBossMap` 只认这张表。
4. 数据侧新增/删除行**不需要重打 APK**:候选集是运行时算的。

## 边界与风险

- **混版本组队会脱机**。V6 客户端按"首条命中"、V7 按"随机抽",同房两台机器算出的图不同,
  每个人打的 boss 就不一样。参与五重决战的所有人必须都是 V7。这是比 V6 的按钮灰化严重
  得多的一类不兼容 —— V6 那个只影响本地 UI,这个直接影响战斗内容。
- **服务端不参与**。这道选择完全在客户端;绕过客户端的请求服务端照样受理。
- **没有真机验收**。本目录和 `D:\WF\out\abyss-v7-20260905\` 里的全部是静态证据。
- 数据侧的 `both_boss_map` 行本次**没有写**,补丁只负责"有多行时怎么选"。
