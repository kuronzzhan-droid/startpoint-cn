# 幻想连战（Mode15）APK 客户端整合设计

> 状态：最终方案（v20）
> 用途：把已经验证的客户端行为移植到另一份国服 APK；不是可直接安装的 APK，也不包含服务器地址修改。
> 对应服务端：本分支的 `src/lib/mode15.ts` 及现有 Rush / Multi Battle 接口。

## 1. 范围与边界

客户端补丁只解决幻想连战中第 5、10、15 关由单人连战切换到多人房间，以及多人房间退出、解散、失败返回时的场景栈问题。

补丁不做以下事情：

- 不修改 API、TCP、CDN 或资源下载服务器地址；
- 不新增 Mode15 专用 HTTP 路由，复用游戏已有 Rush、单人战斗和多人战斗接口；
- 不把 APK、签名文件、密钥、反编译工作目录或 active 增量包提交到 Git；
- 不改深渊连战 `700099` 的客户端逻辑；
- 不保留 v15/v16 曾尝试的结算页强制跳转。

APK 内需要替换的 SWF 固定为：

```text
assets/worldflipper_android_release.swf
```

## 2. ID 契约

| 含义 | ID |
|---|---:|
| 幻想连战 Rush Event | `700098` |
| 幻想连战多人 Event | `300098` |
| 旧版高难多人 Event（服务端兼容） | `100098` |
| 幻想代币 | `2370098` |
| 全通关代币 | `2370097` |

客户端只需要把三个多人边界映射如下：

| Rush 单人关卡 | 多人关卡 |
|---:|---:|
| `700098005` | `300098001` |
| `700098010` | `300098002` |
| `700098015` | `300098003` |

## 3. 最终 v20 的类与方法改动

### 3.1 `pinball.scene.bossBattle.modeSelect.BossBattleModeSelectScene`

新增：

- `isFantasyRushBossQuest():Boolean`
- `startFantasyRushMultiBattle():void`

逻辑：当前 Advent 多人关卡 ID 在 `300098001..300098003` 时，使用游戏原有的 `startMultiBattle(false)` 创建/进入多人房间。其他领主战保持原逻辑。

### 3.2 `pinball.common.data.quest.event.advent.AdventEventQuestLogic`

只对 `300098001..300098003` 放宽原本依赖 `isHostCleared(param1)` 的显示门槛，使幻想连战边界能够出现多人入口。其余 Advent Event 的可见性判断不变。

### 3.3 `pinball.scene.event.rush.questSelect.RushEventQuestSelectScene`

在玩家点击关卡时执行 5/10/15 → 1/2/3 的映射，通过原有仓库读取多人关卡：

```actionscript
globalLogic.getQuestRepository().getMultiQuest(
   MultiQuestIdKindTools.fromCategoryAndId(7, mode15MultiQuestId)
)
```

然后进入：

```actionscript
SceneKind.BossBattleModeSelect(mode15MultiQuest.get_idGroup())
```

返回栈指向：

```text
EventTop
  -> RushEventTop(700098)
  -> RushEventLoading(RushEventQuestSelect(700098, 1))
```

最终 v20 必须是“点击后进入”，不得在页面加载时自动打开多人关卡。必须原样保留 `eventId == 700099` 与 `abyssViewableQuests` 相关的深渊连战逻辑。

### 3.4 `pinball.scene.ui.SingleQuestStartFlow`

修改入口：

```actionscript
start(param1:QuestLogic, param2:Option, param3:Option, param4:Boolean):void
```

这是第一层兜底。若传入的 `RushEventQuestLogic.id` 是 `700098005/010/015`，先映射多人关卡并进入 `BossBattleModeSelect`，不再继续建立单人出战流程。

### 3.5 `pinball.scene.partySelect.PartySelectScene`

修改 `run` 路径。这是第二层兜底，用于客户端从结算对话框或其他旧入口直接构造单人编队页面的情况。检测到三个边界关卡后，同样映射到多人关卡并：

```actionscript
changeSceneWithDetail(
   ChangeSceneNextKind.Scene(SceneKind.BossBattleModeSelect(mode15MultiQuest.get_idGroup())),
   ChangeSceneBackKind.NotChange
);
return;
```

### 3.6 `pinball.dialog.rushEvent.clearReward.RushEventClearRewardDialog`

新增：

- `isFantasyRushMultiBoundary():Boolean`

仅当 `eventId == 700098` 且当前 Rush round 为 `5/10/15` 时：

- 隐藏并禁用按钮 ID `16777216`（继续挑战）；
- 不启动 `autoRetryFinishWaitCount = 120`；
- 即使旧 UI 仍发出点击事件，也不得调用 `retryHandler`。

其他轮次和其他 Rush Event 完全不变。

### 3.7 `pinball.scene.ui.MultiBattleRoomPrepareFlow`

对 `300098001..300098003` 设置幻想连战房间来源和返回栈。正常返回与创建房间失败都回到：

```text
RushEventLoading(RushEventQuestSelect(700098, 1))
```

回退栈为：

```text
EventTop -> RushEventTop(700098)
```

必须同时存在两处 Rush 返回路径：正常房间流程一处、创建/准备失败一处。

### 3.8 `pinball.scene.bossBattle.room.MultiBattleRoomScene`

修改：

- `releaseOpenMultiRoom():void`（房主解散）
- `BackChangeSceneHandler():void`（游客离开）

若 `MultiQuestIdKindTools.toInt(config.questId)` 在 `300098001..300098003`，直接返回幻想连战关卡选择页；其他房间仍使用原来的 `backChangeScene()`。

### 3.9 `pinball.context.socket.room.CooperationRoomSocketContact`

新增布尔标记：

```actionscript
public var mode15FantasyDisband:Boolean;
```

修改：

- `disband(param1:String, param2:CooperationRoomConnectionReason):void`
- `applyDisbanded(param1:DialogResult):void`

收到 socket 解散通知时，从当前房间配置中判断 `questId.index == 1` 且关卡位于 `300098001..300098003`，在玩家确认提示后回幻想连战页，而不是走通用回退。

### 3.10 `pinball.scene.questResult.QuestResultScene`

最终方案**不修改该类**。任何名为 `isFantasyRushMultiQuestResult` 的结果页强制跳转都属于 v15/v16 的弃用试验，不能进入最终 APK；否则可能与多人房间自己的结算回程竞争，造成重复跳转或错误场景栈。

## 4. 客户端到服务端的接口关系

此 APK 设计没有新增 URL。客户端进入多人边界后，继续使用原版多人房间协议：

- `/api/index.php/multi_battle_quest/create_room`
- `/api/index.php/multi_battle_quest/select_room`
- `/api/index.php/multi_battle_quest/prepare`
- `/api/index.php/multi_battle_quest/start`
- `/api/index.php/multi_battle_quest/finish`
- `/api/index.php/multi_battle_quest/disband_room`
- `/api/index.php/multi_battle_quest/restore_room`

幻想连战其他单人轮次与活动状态继续使用：

- `/api/index.php/event/rush/summary`
- `/api/index.php/event/rush/select_folder`
- `/api/index.php/event/rush/battle/start`
- `/api/index.php/event/rush/reward`
- `/api/index.php/single_battle_quest/start`
- `/api/index.php/single_battle_quest/finish`

所谓“新增 Mode15 调用”实质是让客户端把 5/10/15 三个 Rush 边界送入现有多人协议，并传递 `300098001..300098003`；不是增加另一套网络地址或私有 API。

## 5. 补丁演进与最终取舍

| 版本 | 内容 | 最终 v20 |
|---|---|---|
| v10 | 直接多人入口 | 保留 |
| v11 | Rush 连续挑战路径修正 | 保留 |
| v12 | `SingleQuestStartFlow` 兜底 | 保留 |
| v13 | `PartySelectScene` 兜底 | 保留 |
| v14 | 多人边界禁用单人继续/自动重试 | 保留 |
| v15/v16 | `QuestResultScene` 强制回 Rush 页 | **弃用** |
| v17 | 多人准备流程返回栈（从 v14 继续） | 保留 |
| v18 | 房主/游客显式退出路由 | 保留 |
| v19 | socket 解散确认路由 | 保留 |
| v20 | 仅点击时进入，移除加载即自动跳转 | 保留 |

因此最终 v20 不是简单叠加 v10～v20，而是：

```text
v10 + v11 + v12 + v13 + v14 + v17 + v18 + v19 + v20
```

## 6. 快照式移植流程

1. 固定一份目标 APK 和签名证书指纹，记录 APK SHA-256。
2. 解包 APK，并从 `assets/worldflipper_android_release.swf` 导出上表九个类。
3. 每次只替换一个类；替换后立即重新导出该类，核对语义标记。
4. 按第 5 节的最终链构造，不应用 v15/v16。
5. 将 SWF 写回原路径，保持 APK 内其他资源不变。
6. 执行 zipalign，再用项目自己的 Android 签名重新签名。
7. 校验签名证书、APK 完整性和最终 SHA-256。
8. 用 `examples/mode15_client_routing.v20.json` 做自动检查；缺少 required marker 或出现 forbidden marker 时禁止出包。仓库提供的检查命令为：

   ```bash
   python wf_mode15_apk_verify.py /path/to/ffdec-export/scripts
   ```

已验证的最终 v20 样本只用于溯源，不应上传：

- 最终 APK SHA-256：`13b544663a3007d6a19a220ddb45a9f90e95e578377f00f57228fee9f9dfec53`
- 其签名证书 SHA-256：`569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894`

这些哈希用于确认“参考的最终态是哪一份”，不代表接收方重新打包后必须得到相同 APK 哈希。

## 7. 验收清单

- 1～4、6～9、11～14 仍走单人连战。
- 点击第 5、10、15 关进入对应多人关卡。
- 打开关卡页时不会自动弹进多人模式。
- 三个边界的继续挑战按钮不可用，自动续战不会跨过边界。
- 房主解散、游客退出、创建房间失败、socket 解散都回到幻想连战关卡选择页。
- 其他多人关卡的返回行为不变。
- 深渊连战 `700099` 可见关卡和页面跳转不变。
- 导出的 `QuestResultScene` 不含 `isFantasyRushMultiQuestResult`。

## 8. 客户端资源核对

Mode15 已知美术源文件已在本工具目录中：

- `assets/mode15-banner/fantasy_banner_1000x184.png`
- `assets/fantasy-equipment/*.png`
- `assets/abyss-equipment/*.png`

本次 APK 客户端工作区未发现需要额外提交、且不在上述目录中的独立特效图或场景图；其余差异是 SWF 中的逻辑代码。生成后的 SWF/APK 属于可重建产物，不提交。
