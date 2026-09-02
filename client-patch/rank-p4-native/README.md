# P4 —— 深渊连战排行榜「官方原生列表」客户端补丁(S1 / S2 / S3 / S4)

- 基座:`out/rank-scene-p2/WorldFlipper-rank-scene-p2.apk`(P1 皇冠钮 + P2 富文本榜)
- 产物:
  - `out/rank-p4-s1/WorldFlipper-rank-p4-s1.apk` —— 纯版式,假数据
  - `out/rank-p4-s2/WorldFlipper-rank-p4-s2.apk` —— 接真实数据(**无条件顶替宿主页**)
  - `out/rank-p4-s3/WorldFlipper-rank-p4-s3.apk` —— **哨兵分流**,宿主页原功能全部回来
  - `out/rank-p4-s4/WorldFlipper-rank-p4-s4.apk` —— S3 + 翻页条 / 官方 preset / 两颗圆钮
- 方案总纲:`mod-tools/docs/排行榜P4-原生列表-方案-20260827.md`

```
python -X utf8 client-patch/rank-p4-native/build_rank_p4.py --variant s3
python -X utf8 client-patch/rank-p4-native/build_rank_p4.py --variant s4
python -X utf8 client-patch/rank-p4-native/mutation_check.py --variant s4
```

> **别高估 `mutation_check` 的 4/4 RED。** 它的 `break-sentinel` 变异只翻转了 **10 处哨兵里的
> 1 处**(body 71546 `RushEventRankingPartyListCellContentView.resizeWidth` 的 `ifne`),
> 而且判红靠的是「插入块操作码序列」比对 —— `verify_rank_p4.py` 自己的注释就写明这一条
> 不是独立判据。**另外 9 处哨兵的极性是人工逐条读 P-code 确认的**(S3 收口时复核过一遍),
> 不要把 4/4 RED 当成那 9 处的证明。

## 装哪一个

| 包 | 皇冠钮 | 「战斗记录与重置」钮 | 一键重开 15 层 / 复制编成 / 点头像 |
|---|---|---|---|
| S1 / S2 | 富文本榜(P2 链) | **变成排行榜** | ❌ 全废 |
| **S3** | **原生名次列表** | 原样(记录 + 重置) | ✅ 一条指令没改 |
| **S4** | 原生名次列表 + 翻页条 + 两颗圆钮 | 原样 | ✅ 一条指令没改 |
| **S5**(`out/rank-p5`) | S4 + 顶部日期黑条 + 置顶自身名次卡 + 两颗钮真的有用 + 点行看资料 | 原样 | ✅ 一条指令没改 |

S3/S4 的分流靠**合法数值哨兵** `RushEventRankingPartyMode.RushBattle(-1)`:
唯一活着的入口 `RushEventQuestSelectScene.as:456` 传的是 `folderId`(master ID,恒 ≥ 0),
所以 `mode.index == 0 && int(mode.params[0]) < 0` 这条判据只有皇冠钮能满足。
`mode.params[0]` 在全树**零读点**,`RushEventRankingPartyMode` 也没有任何
`Type.enumEq` / `enumIndex` / `__constructs__` 反射。

**S3 之前的 S1/S2 说明(历史,已被 S3 取代)**:那两个包把宿主页的渲染**无条件**换成了名次行,
`preparation` 里的按钮 id 数组被换成空数组 ⇒ `buttonClicked` / `confirmResetProgress` /
`resetProgressOkHandler` 三条路一起变成不可达代码。要用重置就刷 S3 或回 P2。

## 改了哪 8 个方法(S2;S1 只有前 5 个)

| # | 类 / 方法 | body | 改法 |
|---|---|---|---|
| A1 | `…_RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView/run` | 71545 | 两条 `pushstring` 换值:`scene/rush/rush_event_ranking_party`→`…_ranking`、`layout/party_list_cell`→`layout/list_cell` |
| A2 | 同类 `/apply` | 71550 | 前置整段渲染块(5 个文本槽 + 黑旗可见性 + 3 个头像槽),原文整段保留 |
| A2b | 同类 `/resizeWidth` | 71546 | 前置 `returnvoid`,原文整段保留 |
| A3 | `RushEventRankingPartyListView/createListCell` | 71526 | `cell.config.height = 204` |
| B1 | `RushEventRankingPartyScene/preparation` | 71498 | `allPartyListData` = 3 行假数据(s1)/ `[]`(s2) |
| B3 | 同类 `/afterTransition` | 71506 | 前置一次性 `POST tool/agreement` |
| C1 | 同类 `/copyPlayedParty` | 71503 | 征用成响应处理器:`appendAll(rows)` + `partyListView.reload()` |
| C2 | `ToolAgreementRealRemote/successHandler` | 50330 | 4 字段重打包 → 原样透传 `data`(净删 9 条指令) |

**A2b 是方案文档漏掉的一个**:`VerticalListCellViewBase.refreshLayout` 每次布局都会调
`cellContentContainer.resizeWidth`,CN 的实现去取容器 `right_align` —— 它只在
`layout/party_list_cell` 里有,`layout/list_cell` 里没有。`getContainer` 找不到名字时抛
`ClientError(7700)`,所以不改这一处,第一个 cell 就会把整屏打死。

## 「关掉原文」为什么写成 `pushfalse / iftrue`

不是 `returnvoid` 直接压死,而是:

```
pushfalse
iftrue <原文入口>     ; 运行期恒不跳,但对 AVM2 校验器来说原文仍是可达基本块
<新块>
returnvoid
<原文入口>:
<原文一条不改>
```

两个好处:① 原文块仍被校验器走一遍,不会变成「不可达代码」这种边缘情形;
② S3 只要把这两条谓词换成真正的 `mode.index == 0 && int(mode.params[0]) == -1`,
两条路就地分流,**原文一个字节都不用动**。

## 常量池:0 新 multiname / 0 新 int / 0 新 namespace

行对象的字段名 `rank / visible / level / name / count / time / a / b / c` 是**挑出来的**:
每一个都必须在 P2 包常量池里已经存在 `QName(PackageNamespace(""),…)`。
`rank_text` / `user_rank` / `thumb0` 这些「自然」的名字都**不在**池里,用了就要新增 multiname。

⚠ 改字段名之前先跑常量池探针复核,服务端 `src/lib/rush-leaderboard-native-rows.ts` 必须同步。

唯一的池增量是 **6 条字符串**(官方 cell 的槽位名,CN 包里已无人引用):
`ranking_rank` / `user_name` / `party_thumbnails` / `thumbnail000` / `thumbnail001` / `thumbnail002`。
S1 另有 14 条假数据字符串。

## 头像:朴素 setTexture → dummy 槽

- 路径由**服务端**拼好(`character/<code_name>/ui/thumb_party_unison_<0|1>`),客户端不查角色主表
  ⇒ 彻底绕开「角色 ID 不在 master ⇒ `ClientError(8013)` ⇒ 整屏开不起来」。
- 桶用 `AssetGroupKind.CharacterFaceThumbnail`(索引 89,`getCommonGroups()` 首项,全场景常驻),
  不用 `PartyCharacterThumbnail`(只挂两个场景 ⇒ ClientError 8028)。
- 不用 `thumbnailAnimator.addThumbnail` —— 它会再 `new PartyGroupThumbnailView`,在布局自带的
  底板 + 描边上再画一层 = 双框。
- **两道防线**:① 每次 `apply` 先 `changeTexture(Option.None)`,否则复用的 cell 会留上一行的脸;
  ② 贴图到货的回调是 `apply(slot, {p: 路径, r: 名次文案})`,它会拿槽位里当前的名次文案和请求时
  捕获的那一份比对,不符就丢弃 —— 快速翻页时不会把 A 行的脸画到 B 行。

## 自检口径

`build_rank_p4.py` 每次构建都跑:方法体基线哈希 → FFDec 汇编 → `verify_rank_p4.py`
(独立解 SWF 字节,不看补丁写的 P-code)→ FFDec 反编译回 AS3 断言语句。
`verify_rank_p4.py` 的分支重定位检查值得单独说:它把两版的指令清单**抹掉跳转操作数**之后对齐,
再逐条验证每一条幸存的跳转**落点仍是同一条指令** —— 手写前置块最经典的事故就是悄悄劫持了
下游的某个跳转,而抹操作数之前的 diff 看起来一切正常。

## 装机步骤(协调者执行;本目录不碰设备)

```powershell
$adb = "C:\Program Files\Netease\MuMu Player 12\shell\adb.exe"   # 以现场为准
& $adb devices

# 1) 装(S1 先验版式;确认没问题再装 S2)
& $adb install -r D:\WF\startpoint-cn\out\rank-p4-s1\WorldFlipper-rank-p4-s1.apk
# 或
& $adb install -r D:\WF\startpoint-cn\out\rank-p4-s2\WorldFlipper-rank-p4-s2.apk

# 2) 清 AIR SWF 缓存(不清 = 整轮作废,跑的还是旧 SWF)
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app

# 2.5)【必做】确认真的清掉了 —— rm -rf 失败是静默的
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"
#   期望:... No such file or directory

# 3) 清 logcat
& $adb logcat -c

# 4) 显式 Activity 启动(不要 force-stop,不要 uninstall,不要 run-as)
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

### S1 检查单(纯版式,不连服务端)

```
[ ] 主页 → 深渊连战 → 关卡选择页 → 底部「战斗记录与重置」
[ ] 看到 3 行官方名次行,行与行之间不重叠、不留巨大空白
[ ] 每行左上角一面黑色名次旗,旗里白字「1位」/「2位」;第 3 行**没有黑旗**,文字是「排名外」
[ ] 「RANK169」/「RANK88」/「RANK7」在名次旗正下方
[ ] 玩家名(假数据甲/乙/丙)40px 大字,名字下面一条浅灰细分隔线
[ ] 「BEST RECORD: 30战」「TIME: 04:17.13」两行小字
[ ] 行右侧三个带深色描边的空头像框(S1 不发头像,空框就是对的)
```

失败诊断:

- 进页就崩,槽位名拼错或布局取错 ⇒ **不要按错误码去查**。
  `UiDisplayObjectContainer.notExistsError` 先无条件 `throw` 一个**裸 Haxe 字符串**
  (`<kind> : <name> は存在しない要素です`,名字在但类型不对时是
  `… は存在しますが、種類が異なります`),它后面那句
  `throw new ClientError(7701/7702,…)` 是**不可达代码**。
  ⇒ 真出事时 `/crash` 里看到的是那句日文,不是 7700/7701/7702。按名字搜堆栈。
- 崩在 `uiProvider.build` ⇒ 资源组 56 没下到这台设备(方案文档 §7 中止条件 1),
  回 P2 包,先把 `scene/rush/rush_event_ranking` 显式补进一次下发。
- 行严重重叠 / 行距巨大 ⇒ `config.height` 没生效(中止条件 2)。

### S2 检查单(接真实数据)

```
[ ] 服务端 8001 在跑(改 src/ 之后必须 npx tsc 再重启)
[ ] 同一入口进去,看到 6 行真实成绩,名次 1..6
[ ] 逐行和后台数据对得上:1 位 zzhan 04:17.13、2 位 艾利西弗 04:34.27、
    3 位 zzhan 04:51.41、4 位 彼岸花丿樱、5 位 肉鸽空武器、6 位 abyss-live-qa-20260714
[ ] 每行右侧三个头像**出图**,不是空框
[ ] 第 1 行第 2 个头像 = 魔王(169995 maou2_playable);第 3 行第 1 个也是魔王
    —— 作者自制角色能取到,这是本轮必验的一条
[ ] 上下快速翻几个来回,头像不串行、空位不残留上一行的脸
[ ] 全程没有「数据不足」弹窗
```

失败诊断:

- **弹「数据不足」/ 被拉去重下资源** ⇒ 某个 `thumb_party_unison_*` 在这台设备上没有实体文件。
  客户端读不到贴图走的是 `SectionCommand.FileNotFound`,**不是**空框降级。
  应急:服务端 `WF_RUSH_RANK_NATIVE_ICONS=0` 重启,整屏不发头像路径,文字照常。
- 行是空的、只有空框 ⇒ 载荷没到:抓一次 `POST /api/index.php/tool/agreement`,
  看 `data.rows` 是否为 6 元素数组。
- 进页即崩且日志里是 `ClientError 8028` ⇒ 用错了贴图组(应为 89 CharacterFaceThumbnail)。
- 一直显示空列表且没有任何文字 ⇒ `preventsShowEmptyStatePlaceholder` 生效了但数据是空的,
  按上一条查载荷。

## 已知边界(S1/S2 时期记录;打 ✅ 的已在 S3/S4 解决)

这些都**不是阻断项**,但装机和排障时要知道:

1. **榜为空时是一整屏纯白,没有任何文字。**
   B3 无条件写了 `preventsShowEmptyStatePlaceholder = true`(它本来是用来压掉 party
   preset 那句错文案「还没有已用队伍」的)。所以榜空 / 请求超时 / 服务端异常退空载荷时,
   玩家看到的是纯白屏而不是空态提示。⇒ 见到白屏先抓 `POST /api/index.php/tool/agreement`
   看 `data.rows`,别当成崩溃。另外守卫是 `allPartyListData.length == 0`,而
   `copyPlayedParty` 是把行 `appendAll` 进 `partyList.abstractAdapter`、**从不写回**
   `allPartyListData`(它自始至终是 `[]`,只多挂一个动态 `page` 属性)⇒ **这个守卫恒真**,
   每次 `afterTransition` 都会重发一次请求。今天无害:`afterTransitionDispatcher` 对每个
   场景实例只由 `LogicScene.finishTransition` 触发一次(S2 真机也确实是 6 行不是 12 行);
   但那个 dispatcher 是 `once=false` 建的,**将来若有路径二次 `finishTransition`,行会翻倍**,
   而第 3 条的贴图复用护栏依赖「名次文案逐行唯一」,届时会当场退化。
   S4 切 `rushRanking()` preset 时把这句改成按 `rows.length` 有条件设。
2. **转场那几帧里 party preset 的错文案仍可能闪一下** —— `preventsShowEmptyStatePlaceholder`
   在 `afterTransition` 才生效。同样等 S4 换 preset。
3. **行复用护栏依赖「名次文案逐行唯一」。** A2 的贴图回调用
   `getText("ranking_rank").get_text()` 和回调里带的 `row.r` 比对来判断 cell 有没有被复用。
   本轮两张榜都是 `1位..N位`,唯一性成立。**S3/S4 一旦让同一屏出现多行「排名外」**
   (比如置顶的自身名次卡也用这个布局),这道护栏就退化成「可能把 A 行的脸画到 B 行」,
   届时要换成比对一个真正唯一的键。
4. **玩家名不截断、不转义。** 安全没问题(Starling `TextField` 不解析 XML,和 P2 富文本
   那条路不同 —— 那条是 `sanitizeRichText` 过的),但**超长名字会往右溢出压到头像上**
   (`user_name` 在 x=157,头像从 x≈651 起)。
5. **头像横向位置假定安全区 1080。** `party_thumbnails` 在布局里硬编码 `tx=1016`,
   而 A2b 把 `resizeWidth` 整段短路了 ⇒ 实际等于假定
   cell 宽 = `safeArea.width(1080) − listPadding(32+32) = 1016`。
   官方 ranking 布局本身就是这么设计的,MuMu 上没问题;安全区更窄的设备上头像会偏。
6. **`config.height` 的依赖链要记一笔。** `VerticalListCellViewBase` 构造函数里的
   `initializeHitQuad()` 读的是**补丁写 204 之前**的 `config.height`(=329),
   两块 hit quad 先按 329 建。之所以无害,是因为 `listCellRun()` → `resizeHeight(config.height)`
   之后把 `cellHitQuad` / `detailButtonHitQuad` 的 `height`/`y` 都重设成 204。
   ⇒ 点击命中区最终是对的,但**别有人把那次 `resizeHeight` 优化掉**。
7. **构建脚本不能用超长 `--out-dir`。** ffdec 导出 base-pcode 时路径会拼到
   `…/work/base-pcode/scripts/pinball/scene/event/rush/ranking/party/list/cell/_RushEventRankingPartyListCellView/…`
   (约 190 字符)。out-dir 太深会超 Windows `MAX_PATH`,ffdec 静默写不出文件,
   随后报 `FileNotFoundError: …RushEventRankingPartyListCellContentView.pcode`。
   ⇒ 那**不是**补丁坏了,是路径太长。用 `out/` 下的短目录。
8. **`/tool/agreement` 除了可选的 `viewer_id` 之外没有鉴权**,现在会返回全部玩家名 + 编成。
   暴露面和 P2 富文本页一样。本机单人服,记录在案。



---

# S3 —— 哨兵分流

## 改了哪 9 个方法(S3)

S2 的 8 个 body 里有 7 个变成「按哨兵分流」,successHandler 原样不动(它是全局的、
且透传对 P2 富文本链无害),再加 1 个新的:皇冠钮的终点。

| # | 类 / 方法 | body | S3 的改法 |
|---|---|---|---|
| A1 | `…ContentView/run` | 71545 | **不再改写** `pushstring`。两个字符串各自变成一个二选一:榜模式取 `scene/rush/rush_event_ranking` + `layout/list_cell`,否则**原样**取 `…_ranking_party` + `layout/party_list_cell`。maxstack 6 → 7 |
| A2 | 同类 `/apply` | 71550 | 谓词 `pushfalse/iftrue` → 真哨兵 |
| A2b | 同类 `/resizeWidth` | 71546 | 谓词 → 真哨兵(榜模式才短路 `right_align`) |
| A3 | `…ListView/createListCell` | 71526 | 高度写入改成**只有值分叉**:`param2.rank != null ? 204 : 329`。329 正是 `RushEventRankingPartyListCellView` 构造函数塞进 `config` 的原值 ⇒ 原路径逐位等价 |
| B1 | `…Scene/preparation` | 71498 | 榜模式 `allPartyListData = []`,否则**原样**用 `_loc3_`(`fromQuestParties` / `fromRoundParties` 的结果) |
| B3 | 同类 `/afterTransition` | 71506 | 整块 `POST tool/agreement` 前置哨兵 |
| C1 | 同类 `/copyPlayedParty` | 71503 | 响应处理器前置哨兵;非榜模式走原来的「复制他人编成」 |
| C2 | `ToolAgreementRealRemote/successHandler` | 50330 | **与 S2 逐字节相同**(s2→s3 的 body diff 里没有 50330) |
| D1 | `RushEventTopScene/buttonClicked` | 71586 | 皇冠钮的终点从 `LoadingTaskKind.TermsOfService` 换成 `SceneKind.RushEventRankingParty(eventId, RushBattle(-1), Option.None)` + `ChangeSceneBackKind.AddCurrent` |

### D1 为什么第一条指令原封不动

`ofsRank:`(P2 加的那一段)是本方法 `lookupswitch` 第 6 个 case 的落点。
把落点那条指令换掉 = 改跳转目标,正是 `verify_rank_p4._check_branch_targets` 要抓的事故
(第一次构建就被它挡下来了)。所以保留 `findproperty ::changeSceneWithLoading`:
`findproperty` 压的是**拥有这个名字的作用域对象**,对这两个方法而言都是 `this`
(都继承自 `LogicScene`),后面直接 `callpropvoid ::changeSceneWithDetail, 2` 完全正确。

### `AddCurrent` 与 TypePacker

`AddCurrent` 往 `logicStatus.backSceneKinds` 里压的是**当前**场景(`RushEventTop(eventId)`),
所以进榜这一步哨兵 SceneKind 根本不进包。它**之后**仍可能进去
(头部的宝石购买流会压 `stoneBuyDialogChangeSceneBackKind`),所以哨兵必须是打包器认识的值 ——
本轮重跑了 preflight 第 3 条:

```
TypePackerResource2.as:29543   RushEventRankingPartyMode 注册为 ENUM(map 187 / 188)
resolveMap187()                {"RushBattle": 0, "EndlessBattle": 1}
resolveMap188()                {0: ["pinball.master.generated.RushEventQuestFolderId"], 1: []}
TypePackerResource2.as:34574   RushEventQuestFolderId = TypeInformation.ABSTRACT("Int")
DataSimplifier.simplifyEnum    取 param2.h[0] → resolveType("Int") → simplifyPrimitive
DataSimplifier.simplifyPrimitive  只做 Std.is(v, int),**无查表、无范围校验**
TypePackerResource2.as:82738   SceneKind[77] = [RushEventId, RushEventRankingPartyMode, Option<EquipmentId>]
Restore.as:202                 floor == 0 时 printWithInfo(LogicStatus, logic.logicStatus)
```

⇒ `RushBattle(-1)` 打包成裸 int `-1`,不查 master、不校验范围。**过。**
正向对照:`grep -rn "mode\.params" --include=*.as` 全树 **0 命中**,而
`grep -rn "\.params\[0\]"` 有 22481 命中 ⇒ 阴性结论不是 grep 写错了。

## S4 —— 门面

| # | 类 / 方法 | body | 改法 |
|---|---|---|---|
| E1 | `…Scene/run` | 71496 | 榜模式 `partyList.pagerConfig = VerticalListPagerConfig.Set(100)`。**必须插在 `gear.addChild(partyList,…)` 之前** —— gipo 在 addChild 里就跑子对象的 run,而 `VerticalListLogic.baseRun` 正是在那里决定要不要把翻页器自己的两个按钮 id(33554432 / 50331648)放进 `innerButtonGroup`。放晚了 = `VerticalListPagerView.run` 取一个没注册的按钮 = **ClientError 7504**。官方两处先例(`ReceiveHistoryScene.as:72-77`、`MailListScene.as:186-193`)也都是先赋值后 addChild |
| E2 | `…View/run` | 71515 | ① 在 `gear.addChild(partyListView,…)` 之前把 `partyListView.config` 换成 `VerticalListViewConfigPreset.rushRanking()`,并按 `config.pager.params[0]` 重算 view 侧的 `pagerConfig`;② 在末尾建两颗 `container/button` 圆钮 |
| E3 | `…Scene/preparation` | 71498 | 榜模式按钮 id 数组 = `[1, 2]` |
| E4 | `…Scene/buttonClicked` | 71505 | id 1 → `partyList.changePage(int(allPartyListData.page))`;id 2 → `changeSceneWithLoading(LoadingTaskKind.TermsOfService, AddCurrent)`(= P2 那张富文本页,它本来就渲染「报酬一览」的档位表) |
| E5 | `…Scene/copyPlayedParty` | 71503 | 响应里的 `data.page` 存到 `allPartyListData.page`(`Array` 是 AS3 的 dynamic 类,`page` 已在常量池) |

### S4 解决了什么

- **列表底部约 180px 的多余留白** —— party preset 的 `listPadding.bottom: 180` /
  `scrollBar.bottomOffset: -192`;`rushRanking()` 是 32 / -32。
- **错误的空态文案**(「还没有已用队伍」)—— party preset 的
  `emptyStatePlaceholder: Some({text:"rush_event_played_party_list_empty_placeholder"})`;
  `rushRanking()` 是 `Option.None`。
- **官方翻页条**「1 / N」+ 左右箭头 —— `pagerConfig = Set(100)` 一行,资源
  (`scene/common_ui/vertical_list` → `layout/pager`)与消费者 `VerticalListPagerView` 都活着。
- **每行都做成活 cell 的规模问题** —— `Set(n)` 会设 `abstractAdapter.limitPerPage`,
  一页最多 100 行活 cell。服务端 `NATIVE_ROWS_CAP` 因此从 50 放大到 200。
- **两颗官方圆钮**:`container/button` 只有一个 126×126 的 `area` 导引矩形,
  白圆底 + 文字位图 + 图标全部来自 `ButtonConfigs.raidMyRanking` /
  `ButtonConfigs.rushReward`(和官方一模一样的画法)。

### S4 没做(记录原因)

- **顶部「YYYY.MM.DD HH:MM更新」黑条**、**置顶「自身名次」卡**、**标题栏**。
  三者都要求列表从 y≈438 起画(官方 `layout/scene_layout` 里
  `ranking_layer` 就在 438),而宿主走的是 `MenuSceneTemplateView.setupForListOnlyLayout`,
  列表从 `safeArea.y` 起、`listPadding.top` 只有 40。
  **量化判据**:官方所有带标题的 preset(`menuLike` / `mailLike`)`listPadding.top` 都是 **259**;
  `rushRanking()` 是 **40**,就是给「没有标题、上面另有一层」的场景设计的。
  要补这三样得重推 `listPadding.top` + `scrollBar.topOffset` + 一份非 cell 的
  `layout/list_cell` 实例,是需要真机逐像素调的活(方案文档给 S4 的 1–1.5 人日主要就是它)。
  留给 S5。

### 头像背后的深色棋盘格 —— 不是缺陷

`container/party_thumbnail` 的 depth 0 是
`scene/general/sprite_sheet/thumbnail-assets/raid_ranking_background`:实测 **130×170、97% 不透明、
两色(#222222 / #333333)各占一半的深色棋盘纹**。它在
`scene/rush/rush_event_ranking` 和 `scene/raid/raid_event_ranking` 两份官方榜布局里**逐字节相同**。

露出来是因为 `thumb_party_unison_*` 本身就是**抠像**:对服务端实发的 14 条路径逐张测 alpha,
全透明像素占比 0.3%(`seris_dragon_king`)~ 35.6%(`land_dragon_wind_playable`),
官方角色和自制角色**都在这个区间**(`kyle_wolf_knight` 28.4%、`stella_summer_goddess` 16.5%、
`maou2_playable` 7.0%)。⇒ 不是我们少画了一层,也不是自制立绘的问题。

作者印象里的「满底图」来自**另一条**通路:编成页用的是
`scene/common_ui/party_face_thumbnail` → `layout/partyUnisonThumbnail`,
它 depth 0 铺的是 `thumbnail-assets/party_small_background`(tint `0xA5A5A5`,整幅不透明)
外加一层 `elementBackground`。那是 `PartyGroupThumbnailView` 的画法,和榜的 dummy 槽是两套。

**能改但那是偏离官方的审美改动**,所以本轮不改。要改的话最小改动是在 `apply` 的榜分支里
`foregroundLayout.getContainer("party_thumbnails").getContainer("thumbnailNNN").getImage("")`
拿到那块底板(它 `name` 是空串,`getImage("")` 能取到)再压 `alpha`;
风险是空串是否在常量池、以及同名的描边件是不是排在它前面 —— 需要真机确认一次。

## 装机步骤(协调者执行;本目录不碰设备)

```powershell
$adb = "C:\Program Files\Netease\MuMu Player 12\shell\adb.exe"   # 以现场为准
& $adb devices

# S3 先验「功能回归」,确认没问题再装 S4
& $adb install -r D:\WF\startpoint-cn\out\rank-p4-s3\WorldFlipper-rank-p4-s3.apk
# 或
& $adb install -r D:\WF\startpoint-cn\out\rank-p4-s4\WorldFlipper-rank-p4-s4.apk

& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"   # 期望 No such file
& $adb logcat -c
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

### S3 检查单(**反向断言优先**)

```
[ ] A. 深渊连战活动页 → 底部「战斗记录与重置」(注意:是关卡选择页那颗,不是皇冠)
    [ ] 看到的是**原来的**已用队伍列表(圆形头像 + 右侧按钮),不是名次行
    [ ] 「一键重置」弹 ConfirmResetProgressDialog,**确认后真的重开一层**
    [ ] 「单层重打」可用(无尽模式)
    [ ] 点某一行的复制钮 → 进编成页(复制他人编成)
    [ ] 点行里的角色/装备/能力魂头像 → 弹详情
    ⚠ 这一条不过 = S3 作废,回 S2/P2
[ ] B. 深渊连战活动页 → 皇冠钮
    [ ] 进的是名次列表(黑旗 + RANK + 名字 + BEST RECORD + TIME + 三头像)
    [ ] 返回键回到**深渊连战活动页**(不是关卡选择页 —— AddCurrent 的语义)
```

> **注意:S3 上验不到 TypePacker。** 旧版检查单曾写「进过榜之后返回再开一场战斗」来验哨兵打包,
> 那是错的:`AddCurrent`(`ChangeSceneBackKind.index==6`)在 `LogicScene.changeSceneWithDetail`
> 里压进 `backSceneKinds` 的是**当前**场景(`LogicScene.as:3908-3917` 读的是 `sceneKind`,
> 不是目的地),所以皇冠钮进榜时压的是 `RushEventTop(eventId)`,哨兵 `RushBattle(-1)`
> **根本没进 `backSceneKinds`**,后面开战打包自然也就打不到它。
> 真要验哨兵进打包器,见下面 S4 检查单的 C 项。

### S4 追加检查单

```
[ ] 列表底部**没有**约 180px 的空白;滚到底就是最后一行 + 翻页条
[ ] 底部中间出现「1 / 1」(只有 6 条成绩时),左右箭头灰掉/隐藏
[ ] 左下角圆钮「自身名次」、右下角圆钮「报酬一览」(白圆底 + 图标 + 文字位图)
[ ] 点「自身名次」→ 跳到自己那一页(现在只有 1 页,应当无变化且不崩)
[ ] 点「报酬一览」→ 进 P2 的富文本页(两张榜 + 报酬档位),返回回到名次列表
[ ] 榜为空时(把 6 条成绩清掉才测得到)不再出现「还没有已用队伍」
[ ] 原「战斗记录与重置」页**观感与 S3 完全一致**(preset 分支没漏)
[ ] C. **TypePacker 哨兵真机验证(只有 S4 验得到)**:
    进榜 → 点「报酬一览」→ 返回名次列表 → 退出去再**开一场战斗**
    [ ] 不崩、`/crash` 无新上报
    理由:点「报酬一览」时当前场景才是 `RushEventRankingParty(eventId, RushBattle(-1), None)`,
    此时 `AddCurrent` 把**哨兵**压进 `backSceneKinds`;而 `backSceneKinds` 是
    `LogicStatus` 的打包字段(`TypePackerResource2.as:35861`,类型
    `Array<pinball.common.data.scene.SceneKind>`),下一次 floor==0 的 Restore 打包
    就会真的序列化到 `RushBattle(-1)`。
```

失败诊断补充:

- 进榜即崩且 `/crash` 堆栈里是日文 `… は存在しない要素です` ⇒ 槽位名/布局名不对。
  **不要按 7700/7701/7702 去查**(`UiDisplayObjectContainer.notExistsError` 先无条件
  `throw` 裸字符串,后面那句 `ClientError` 是不可达代码)。
- 进榜即崩、堆栈里有 `ClientError 7504 登録されていないボタン` ⇒ E1 的插入点又跑到
  `gear.addChild(partyList,…)` 后面去了(翻页器的按钮 id 没进 innerButtonGroup)。
- 「战斗记录与重置」页变成名次行 ⇒ 哨兵判据被反向了,立刻回 P2,并跑
  `mutation_check.py --variant s4`(它的 `break-sentinel` 变异就是这个事故)。

---

# S5 —— 门面收口(顶部日期条 / 置顶自身名次卡 / 两颗钮真的有用 / 点行看资料)

产物:`out/rank-p5/WorldFlipper-rank-p5.apk`(基座仍是 P2 包,**不是** S4 包 ——
S1..S5 是同一基座上的五个平行分支,每一版都能独立回滚)。

| 物件 | sha256 |
|---|---|
| `out/rank-p5/WorldFlipper-rank-p5.apk` | `9abfbc00a98264f337c1546eed9bccbbb88bc6312573a19da3c76a4fe7c3c768` |
| `out/rank-p5/worldflipper_android_release.p5.swf` | `b1c067bd303fe60b19fa9dc23d8171898a36e60ffea8c6aa923ee2cd78319c53` |

签名证书 SHA-256 `729507c1…a827a0b`,与 P2/S1/S2/S3/S4 **一致** ⇒ `install -r` 原地升级,不掉号。

```
python -X utf8 client-patch/rank-p4-native/build_rank_p4.py --variant s5 --out-dir out\rank-p5
python -X utf8 client-patch/rank-p4-native/mutation_check.py --variant s5
```

## S5 相对 S4 加了什么

| # | 位置 | body | 改法 |
|---|---|---|---|
| F1 | `…View/run` | 71515 | 榜模式:① 列表移到官方 `ranking_layer` 的 y=438 并**等量缩高**;② build `container/time_range_layer` 当顶部黑条;③ 一块 `colorfafafa` 底板 + 一份 `layout/list_cell` 实例当**置顶自身名次卡**(建好时 `visible=false`)。两个容器挂到 `allPartyListData.b` / `.c` 上供响应处理器回找 |
| F2 | `…Scene/copyPlayedParty` | 71503 | 响应到货后:`.row` / `.list` 入栈;黑条 `getText("text").set_text(data.time)`;自身卡五个文本槽 + 黑旗可见性 = `data.item`,然后 `visible=true` |
| F3 | `…Scene/buttonClicked` | 71505 | 「自身名次」= `changePage(page)` **再** `partyListView.scrollTo(0, row*220)`(`row<0` 就什么都不做);新增行按钮分支 → `LoadingTaskKind.ProfileGetProfile(row.id)` |
| F4 | `…Scene/preparation` | 71498 | 榜模式的按钮 id 数组从 `[1,2]` 变成 `[1,2] + 16..115`(一页 100 行,一行一个 id) |
| F5 | `…ContentView/apply` | 71550 | 每行渲染完追加 `buttonGroupView.registerDisplayObjectAsButton(16 + index%100, foregroundLayout, Scale)` —— 整行变成一颗按钮 |

「报酬一览」钮**没动**:它仍然落到 P2 的富文本页,但服务端从 S5 起在那一页上
放了**自制称号的铭牌图**(见下面「为什么只有铭牌有图」)。

## 为什么列表用 `resizeHeight` 而不是 `adjustList`

`MenuSceneTemplateView.getListSize` 最后一句是 `safeArea.height -= …`
(`MenuSceneTemplateView.as:277-278`)—— 它**改的是模板自己那份 safeArea**。
`setupForListOnlyLayout` 已经调过一次,再调一次会把 footer/pager 余量**减两遍**,
列表凭空短掉约 272px。所以 S5 走 `VerticalListView.resizeHeight(listSize.height - 438)`
(`VerticalListView.as:463`),只做「缩高 + 重排」这一件事。

也**不能**用 `listPadding.top`:padding 属于**可滚动内容**
(`VerticalListView.layoutCells`:614),把它调大只会让行往下挪、然后照样滚到黑条底下去,
不会被裁掉。方案文档里「官方带标题 preset 是 259」那条只说明了官方怎么留白,
不是我们这一屏该用的机制。

## 行按钮的 id 为什么是 16..115

`applyData(param1, …)` 的 `param1` 是**全表下标**(`VerticalListView.as:494` 用
`param1 - currentPageIndex * limitPerPage` 去找 cell 就是证据),所以 id 取
`16 + 下标 % 100`,`buttonClicked` 再乘回 `partyList.currentPageIndex`。

页内化的唯一理由是**常量池**:16..115 全都塞得进 `pushbyte`,
而 `pushint 268435456` 之类会往 int 池里加常量,直接违反验证器
「ints/uints/doubles/namespaces/ns_sets/multinames 逐字节相同」这条硬不变式。
`preparation` 里那 100 个 id 是**循环**生成的(上界 116 也是 pushbyte),
不是 100 条 `pushbyte` + `newarray 102`。

## 点一行 → 那个玩家的资料:全链都是官方活代码

```
行按钮 → RushEventRankingPartyScene.buttonClicked
       → LoadingTaskKind.ProfileGetProfile(Number)         index 23,活
       → LogicScene.resolveLoadingTask case 23             LogicScene.as:2294
       → ProfileGetProfileLoadingTask                      loading/follow/…as:52-66
       → ProfileGetProfileRealRemote
         startUserRequest("profile/get_profile", {target_viewer_id})   …as:24
       → SceneKind.PlayerProfile(ProfileKind.Other(data))
       → PlayerProfileScene + OtherProfileLogic            两个类在 CN 都活着
```

`target_viewer_id` 客户端**只搬运不解释**。榜行发的是 `9e9 + player_id`
(服务端 `toProfileTargetId`),因为榜行的身份是**存档**而不是账号 ——
viewer_id 只认账号,一个账号可以有多个存档。真实 viewer_id 是 9 位数,
落在 9e9 之下,两个区间不相交,所以 `profile/get_profile` 一个端点吃两种输入。

`row.id == 0`(存档已删)时行**不跳转**,免得进了 loading 再吃 404。

## 服务端契约(S5 版 `/tool/agreement` 的 `data`)

| 键 | 类型 | 含义 |
|---|---|---|
| `terms_text` | String | P2 富文本页正文(「报酬一览」钮落到这里),**必填** |
| `rows` / `list` | 行数组 | 主榜(全程用时)/ 副榜(当期首通),各至多 200 行 |
| `item` | 行 或 null | 置顶自身名次卡;**没上榜时是一张「排名外」卡**,认不出人才是 null |
| `page` | Int | 自己在第几页(0 起) |
| `row` | Int | 自己在**那一页里的第几行**(0 起);**-1 = 没上榜/被截断 ⇒ 客户端不滚** |
| `index` | Int | 自己在整张榜里的全局下标(0 起);-1 = 没上榜 |
| `time` | String | 顶部黑条文案,已含「更新」 |
| `total` | Int | 主榜截断前的总行数(去重后 = 有成绩的存档数) |
| `reward` | 数组 | 报酬档位预览(客户端今天不读,报酬走富文本页) |

行对象新增 `id`(个人资料目标 ID,0 = 不可点),其余键不变。
老包只读它认识的键 ⇒ **P2/S1/S2/S3/S4/S5 六版 APK 共用同一份服务端**。

## 为什么「报酬一览」只有铭牌有图

富文本 `<img src="file://X">` 的解析链:`RichTextImageLoader.resolveSource`
(`ui/richText/RichTextImageLoader.as:59-70`)砍掉扩展名 →
`ViewAssetCache.setTexture` → `FileReader.readTextureFile`
(`asset/file/FileReader.as:486-499`)**补回 `.png`**。
拿 `sha1(逻辑路径+SALT)` 对 `.cdn/cn` 下 archive-* 的全部 zip(141 561 条)实测:

- `dynamic/degree/degree_mod_broken_wheel_hero.png` —— **在**(独立 png)⇒ 铭牌能画;
- `item/sprite_sheet.png` —— 在;但单枚道具图标
  `item/spends/tickets/ashen_verdict_once_gacha_character_ticket.png` —— **不在**,
  它是共享图集里的子纹理。硬发 = 客户端走 `SectionCommand.FileNotFound`
  ⇒ 弹「数据不足」拉去重下资源(**不是**空图降级)。

⇒ 券只发名字 + 数量。想赌图集已加载,设
`WF_RUSH_RANK_REWARD_ITEM_ICON=<子纹理逻辑路径>` 重启即可;弹了「数据不足」把它删掉,
**不用回滚 APK**。

## 装机步骤(协调者执行;本目录不碰设备)

```powershell
$adb = "C:\Program Files\Netease\MuMu Player 12\shell\adb.exe"   # 以现场为准
& $adb devices

& $adb install -r D:\WF\startpoint-cn\out\rank-p5\WorldFlipper-rank-p5.apk
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"   # 期望 No such file
& $adb logcat -c
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

服务端必须是本轮这份(改了 `src/` 之后已 `npx tsc` 并重启过 8001)。

## S5 检查单 —— **带元素 y 预期值**

坐标都相对 `safeArea`(MuMu 上 safeArea ≈ (0,0,1080,1920),即绝对值就是下表的数)。
官方 `layout/scene_layout` 的原始读数写在括号里,对得上说明几何没走样。

```
[ ] 深渊连战活动页 → 皇冠钮 → 名次列表
[ ] 顶部黑条「YYYY.MM.DD HH:MM更新」—— 应当是**今天**(真实墙钟);
    显示 2025.08.02 说明走的是被后台时间控制钉住的服务器钟(见「已知边界」3)
    [ ] 黑条本体 450×46,横向居中(中心 x = 540),顶边 y = 104,底边 y = 150   (官方 update_time_label ty=104)
    [ ] 文字 28px 白色居中,压在黑条上
[ ] 置顶自身名次卡(不随列表滚动)
    [ ] 浅色底板 x = 32 … 1048,y = 193 … 397                                  (官方 player_layer ty=158,高 275,卡高 204 → 居中 158+35=193)
    [ ] 黑色名次旗左上角 (32, 193),旗高 35 → 底边 y = 228
    [ ] 「RANK___」在旗正下方,y ≈ 247
    [ ] 玩家名 40px 大字,x ≈ 189,y ≈ 231
    [ ] 名字下细分隔线 527×4,y = 290
    [ ] 「BEST RECORD: N战」y ≈ 306;「TIME: MM:SS.FF」y ≈ 345
    [ ] 卡上**没有**三个头像框(S5 刻意不画,见「已知边界」)
    [ ] 没成绩的存档进去:名次旗**不显示**,文字是「排名外」,时间是「TIME: --:--.--」
[ ] 名次列表
    [ ] 第 1 行顶边 y = 478                                                    (438 + rushRanking listPadding.top 40)
    [ ] 行距 220(204 + cellVerticalSpace 16)⇒ 第 2/3/4/5 行顶边 698 / 918 / 1138 / 1358
    [ ] 列表**不会**滚到黑条或自身卡底下(裁剪边界就是 y=438)
    [ ] 底部翻页条「1 / 1」仍在
[ ] 两颗圆钮(位置与 S4 相同)
    [ ] 「自身名次」左下 (94, 1683)、「报酬一览」右下 (983, 1683)               (官方 myrank_button / reward_button)
    [ ] 点「自身名次」:用自己的存档进去,列表**滚到自己那一行**
        (现在只有 1 页 5 行,zzhan 是第 1 名 ⇒ row=0 ⇒ 滚到顶,肉眼可能没变化;
         换一个排在后面的存档进去更好验)
    [ ] 点「报酬一览」:进富文本页,**开头第一屏**就是
        「第 1 名 终焉裁定券 ×10 / 称号 断轮的原勇者」+ **一张铭牌图**、
        「第 2 ~ 3 名 ×5」、「第 4 ~ 10 名 ×2」,返回回到名次列表
        (20260828 复核前报酬排在两张榜后面,要滚到 84% 处才看得见;已排到榜前面)
[ ] 点某一行 → 那个玩家的个人资料页
    [ ] **先点第 2 行「艾利西弗」** —— 这是 20260828 那条必崩路径的验收点:
        修之前点它必抛「No Value(...)」,修之后要能正常开出资料页
        (她选中那一队主位 1 是助战角色 700016,发不出去 ⇒ 槽 0 会空)
        她的编队会显示成「阿尔克 + 两个空位」—— 那是兜底,不是丢数据
    [ ] 玩家名 / RANK / 留言 / 称号铭牌 都是那个人的
    [ ] 「常用编队」是那个存档当前选中的那一队(3 主位 + 3 合击)
    [ ] 返回键回到名次列表
    [ ] 点自己那一行也能进(id 是自己的存档)
[ ] **反向断言(不红不算过)**:关卡选择页 → 底部「战斗记录与重置」
    [ ] 看到的是**原来的**已用队伍列表,不是名次行
    [ ] 「一键重置」能弹确认框并**真的重开一层**
    [ ] **没有**顶部黑条、**没有**自身名次卡、列表**没有**被推到 y=438
    [ ] 点行里的角色/装备/能力魂头像照旧弹详情
[ ] TypePacker 哨兵(和 S4 同一条):进榜 → 点「报酬一览」→ 返回 → 退出去再开一场战斗
    [ ] 不崩、`/crash` 无新上报
```

## S5 已知边界

1. **自身名次卡上不画头像。** 三个 144×188 的 dummy 槽被显式 `visible=false`。
   贴图的异步加载 + 「cell 复用防串脸」那两道护栏都长在 cell 类里
   (`RushEventRankingPartyListCellContentView`),在场景层复刻一遍是另一份等量的
   手写字节码,而且卡只有一张、没有复用,护栏的价值也不存在。
   要补的话正解是官方的做法:再起一个只有一行的 `VerticalList`(KR 的 `playerList`),
   那需要新字段 —— 违反「不新增 trait」。
2. **自身名次卡没有白色圆角卡面 + 右下阴影。** 列表里的行是
   `VerticalListCellViewBase` 挂 `BottomRightPanelView` 画的;独立 layout 实例没有。
   S5 用一块 `bg-assets/colorfafafa` 平底板顶上(页面底色是 `coloreaeaea`,所以读得出来
   是一张卡),但**不是**官方那块圆角面板。
3. ~~**顶部黑条的时刻走服务器钟**~~ **(20260828 复核后改了默认)**
   顶部黑条和 P2 富文本页顶部那一行现在**都走真实墙钟**。
   之前默认取 `getServerDate()`,而后台的时间控制把服务器钟钉在活动窗口里,
   实测下发的是 `2025.08.02 01:24更新` —— 作者刚要求补日期条,第一眼看到 2025 年
   只会当成 bug。「更新」说的是这份榜什么时候读出来的,榜是实时查库的。
   想退回服务器钟(和界面其它时间一致):`WF_RUSH_RANK_TIME_REAL=0` 重启。
4. **「自身名次」在只有一页时视觉上仍可能没反应**:page 已经是 0、row 是 0 时
   `scrollTo(0,0)` 就是原地。这是正确行为,不是失效;拿一个排在后面的存档验才看得出来。
5. **行按钮上限 100/页**:`preparation` 只注册 16..115。一页超过 100 行不可能发生
   (`pagerConfig = Set(100)` 就是页大小),但如果将来改页大小,
   `PAGE_SIZE` / `ROW_BTN_LIMIT` / 服务端 `NATIVE_PAGE_SIZE` **三处必须同改**。
6. **个人资料页的关注按钮**会打 `follow/*`,服务端没实现 ⇒ 点了吃 404 提示框,
   不写坏任何状态(`follow_state` 恒发 0)。本机单人服,记录在案。
7. **自身名次卡的浅色底板在数据到货前就画出来了**(只有卡本体是 `visible=false`)。
   进榜的头几帧会看到一块空底板;`item` 一直是 null(服务端认不出观看者)时它会一直空着。
   实际使用中框架层总会附上 `viewer_id`,所以只在拿 curl 打端点时才会遇到。
8. **行的 `id` 用 `convert_d` 而不是 `convert_i` 判非零**:`9e9 + 存档 id` 超过 2^31,
   ToInt32 会绕回(9000000008 → 410065416)。绕回后仍是正数所以旧写法也“碰巧对”,
   但基数一改就不对了 —— 已改成按 Number 判。
9. **`character_ids[0]` 是硬约束,不是「渲染成空框」**(20260828 复核抓到的必崩路径)。
   `OtherProfileLogic.getLeaderFullShotImageId`(`OtherProfileLogic.as:308-323`)
   在槽 0 为 `Option.None` 时直接 `throw "No Value(...)"`,而
   `PlayerProfileView.registerButtons` 的 Other 分支(`:640/:701/:826` **三条全走**)
   无条件调它。其余五个槽位都是 None-safe 的。
   现场就有一行中招:榜第 2 行「艾利西弗」选中那一队主位 1 是助战角色 **700016**
   (`isShippableCharacterId` 拒发)⇒ 槽 0 空 ⇒ 点那一行必崩。
   已在服务端修(`src/lib/rush-profile-party.ts`,三级兜底:成对左压缩 → 队长角色 →
   已拥有角色里 ID 最小的;一个都没有则回 400)。**APK 不用重打。**

   ⚠ `WF_RUSH_PROFILE_CHARACTERS=0` 的**语义也改了**:旧语义「编队全发 null」会让
   **每一行都必崩**,是加重不是止血。新语义 = **只发一个**能开起这一屏的角色。
   (立绘风险仍在:自制角色缺 full_shot 会弹「数据不足」—— 那是拉去重下资源,不是崩。)

---

# P5b —— P5 黑屏后的退一步交付(20260828)

## 装哪一个(现状)

| 包 | SWF sha256 | 状态 |
|---|---|---|
| `out/rank-p4-s4/WorldFlipper-rank-p4-s4.apk` | `4033d7ae…626765` | 能用,作者当前在用 |
| `out/rank-p5/WorldFlipper-rank-p5.apk` | `b1c067bd…319c53` | **黑屏,别装** |
| **`out/rank-p5b/WorldFlipper-rank-p5b.apk`** | `8b373872…45a0e7` | **本轮交付** |

`out/rank-p5b/WorldFlipper-rank-p5b.apk`
sha256 `6952af87a7fa753da9cdbdc45a51726bc796e649b7b302a6ba8c8121cec99807`,139 726 581 B。

## P5b = S4 + 一件事

被改的 12 个方法体和 S4 **完全同一批**;12 份 `.pcode` 里
**10 份与 S4 逐字节相同**,只有两份有增量:

| 方法 | 增量 |
|---|---|
| `RushEventRankingPartyView/run` | 榜模式下:`partyListView.config.listPadding.top = 204`;build `container/time_range_layer`,摆在 (safeArea.x+540, 104),挂到 `passContentLayer`,存到 `allPartyListData.b`。`localcount 3 → 4` |
| `RushEventRankingPartyScene/copyPlayedParty` | `.b` 非空则 `getText("text").set_text(data.time)` |

**P5 里被拿掉的东西**(全部留到下一轮):列表矩形手术
(`listLayer.y += 438` + `resizeHeight`)、置顶自身名次卡 + 浅色底板、
行按钮(`preparation` 的 16..115、`apply` 的 `registerDisplayObjectAsButton`)、
「自身名次」滚到行、点行看资料。这些在 P5b 里连一条指令都没有 ——
`AS3_S5B_MUST_VANISH` 就是这条的机器断言。

## 为什么用 `listPadding.top` 而不是 P5 的「移动 + 缩高」

P5 唯一**改动既有可用布局状态**的两条语句就是那对:

```
template.listLayer.y += 438
partyListView.resizeHeight(listSize.height - 438)   -> refreshLayout() -> baseDraw(0)
```

第二条在 `run()` 中途把列表的**整条绘制链**重跑一遍,官方代码没有任何地方这么做。
P5b 改成只写 `config.listPadding.top`:`config` 就是同一方法几行前刚装上的
`VerticalListViewConfigPreset.rushRanking()` 返回的**新对象字面量**
(`VerticalListViewConfigPreset.as:49-69`,每次调用新建),
这个写入不可能抛异常、不会重入任何东西,`layoutCells`(:602)和
`baseEarlyUpdate`(:1234)在下一帧读它。

**代价(已知,记录在案)**:padding 属于可滚动内容,所以行数多到能滚时
(**≥ 7 行**:`maxY = 220N − 1376`,N=6 时 −56 不可滚,N=7 时 +164 可滚)
第一行往上滚会滑到黑条底下。黑条在 `passContentLayer`(层级在列表之上),
所以是「行从条底下过去」,不是「条被盖住」。现场 5 行,滚不动。
真正的解法是 P5 那种裁剪,等黑屏根因定位后再上。

## P5b 检查单 —— 带元素 y 预期值

MuMu 上 `safeArea ≈ (0,0,1080,1920)`,所以下表就是绝对像素。
括号里是官方 `layout/scene_layout` / `layout/list_cell` 的原始读数。

```
版式常量(离线算出来的,不是估的)
  列表视口 listSize = 1080 × 1596
    = safeArea.height 1920 − (翻页器 80 + marginTop 52 + 官方留量 192 = 324)
    翻页器高 80 来自 scene/common_ui/vertical_list 的 layout/pager guide "height"
  行距 220 = 行高 204 + cellVerticalSpace 16
  行首 y = listPadding.top = 204(S4 是 40)

[ ] 深渊连战活动页 → 皇冠钮 → **看得见名次列表**(这一条就是本轮的验收点)
[ ] 顶部黑条
    [ ] 黑条本体 450 × 46,x 315…765(中心 x = 540),y **104…150**   (官方 update_time_label tx=540 ty=104;
        图集里 label-assets/top_event_period_label 是 133×46,frame a=3.3837 → 133×3.3837 = 450.0)
    [ ] 文字 28px 近白色(0xFAFAFA)居中,文本框 x 321…761、y 106…168
    [ ] 内容形如「2026.08.28 14:05更新」,**日期是今天**(真实墙钟,见「已知边界」3)
[ ] 黑条与第一行之间是空的浅灰(页面底色 coloreaeaea),y **150…204**
[ ] 名次列表(x 32…1048)
    [ ] 第 1 行顶边 y = **204**,底边 408
    [ ] 第 2/3/4/5/6 行顶边 = **424 / 644 / 864 / 1084 / 1304**
    [ ] 行内(相对行顶边,官方 layout/list_cell 读数):
          黑色名次旗 rank_label   0…35    → 第 1 行 204…239
          旗上「N位」ranking_rank −4…43   → 第 1 行 200…247
          玩家名 user_name        38…105  → 第 1 行 242…309
          细分隔线 527×4          97…101  → 第 1 行 301…305
          RANK player_rank        54…101  → 第 1 行 258…305
          「N战」kill_count        113…170 → 第 1 行 317…374
          TIME best_score         152…204 → 第 1 行 356…408
          三头像 x 651/791/931     14…184  → 第 1 行 218…388
    [ ] 5 行时**滚不动**(maxY = 220×5 − 1376 = −276)
[ ] 底部翻页条「1 / 1」,y **1648…1728**,横向居中
[ ] 两颗圆钮(与 S4 完全相同,一条指令都没动)
    [ ] 「自身名次」中心 (94, 1683)、「报酬一览」中心 (983, 1683),命中区 126×126
    [ ] 「报酬一览」进 P2 富文本页,返回回到名次列表
    [ ] 「自身名次」只 `changePage`,**只有一页时看不出变化 —— 这是 S4 行为,不是回归**
[ ] 本轮**不该有**的东西(有 = 装错包了)
    [ ] 没有置顶的自身名次卡、没有浅色底板
    [ ] 点某一行**没有**任何反应(不进个人资料页)
[ ] 反向断言(不红不算过):关卡选择页 → 底部「战斗记录与重置」
    [ ] 已用队伍列表照旧,第一行仍在 y=40(**没有** 204 的留白)
    [ ] 没有顶部黑条
    [ ] 「一键重置」能弹确认框并真的重开一层
    [ ] 点行里的角色/装备/能力魂头像照旧弹详情
[ ] TypePacker 哨兵:进榜 → 点「报酬一览」→ 返回 → 退出去再开一场战斗
    [ ] 不崩、`/crash` 无新上报(装包前记下当前计数,现为 44)
```

## 装机步骤(协调者执行;本目录不碰设备)

```powershell
$adb = "C:\Program Files\Netease\MuMu Player 12\shell\adb.exe"   # 以现场为准
& $adb devices

& $adb install -r D:\WF\startpoint-cn\out\rank-p5b\WorldFlipper-rank-p5b.apk
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"   # 期望 No such file
& $adb logcat -c
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

签名与 S4 同证书(`729507c1…a827a0b`,v1/v2/v3 全 Verifies)⇒ 原地升级,不掉号。
服务端**本轮没动**,S5 那份继续用;P5b 只读它认识的键(`rows` / `page` / `time`)。

## 如果 P5b 仍然黑屏

那就说明黑屏来自**建 `container/time_range_layer` 这一步本身**
(离线已证该 layout、它的 `text` 槽、以及 `label-assets/top_event_period_label`
在 CDN 数据里都在,所以这是目前排在最后的可能)。
届时的下一步是**直接回 S4**,并且**不要**再往 `View/run` 里加任何 `uiProvider.build` ——
改走「黑条画在 P2 富文本页」或者等 P-code 级现场调试。
