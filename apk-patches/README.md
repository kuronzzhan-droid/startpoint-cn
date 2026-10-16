# 最终 v33 客户端 APK 补丁索引

共收 **101 个独立补丁条目**：其中 97 条属于 v33 共用客户端，4 条仅属于后续 v33-x86 双 ABI 变体。逐方法正文来自最终包；原始生成脚本和构建脚本按实际来源保留。

本目录是只读调查及文本源归档。没有重新构建、安装、签名、运行游戏或连接服务器；没有运行 Git。只在 `D:\WF\apkp1016\` 写入。APK、keystore、签名文件、.so、整份 SWF/ABC 和美术二进制均未收。单文件采用更保守的 **500,000 B** 上限。

## 最终包锚点与判断口径

| 对象 | 本次只读核对的 SHA-256 |
|---|---|
| 测试者 v33 APK | `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` |
| 后续 v33-x86 APK | `572dd17256de6708b9cdcbe752e184a97b44781bce8fd5ffacf7be7413e0c331` |
| 两包相同的 SWF | `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` |

先依据构建脚本的真实应用顺序和构建报告，再对照实际最终方法/成员。能力标签只是线索。v25 从 v17 重建，未沿用 v24；v32 最终采用 v32f 的 PF 和 v32l 的 Fever 实现。旧快照及已撤回功能不作为正式条目。`首次版本` 指能够从 APK/构建说明证明的最早版本；没有映射证据的写“v17以前，具体编号未核实”，这组内部按英文短名排序，不伪造更早编号。101 为本次补录的 v31 O5，按用户指定保留既有 1–100 编号，另列 101；其版本归属在 v31 时间线标明。

同一方法若有多个功能叠加，各目录的 P-code 是 v33 最终合成方法，不是互相独立的整方法覆盖包。原始脚本中仍存在旧注释或先应用再覆盖的构建步骤时，以其执行顺序及最终 P-code 为准。活动商品索引与 S1 已合并为一个最终条目，避免重复收早期版。

## 总索引

| 编号 | 补丁 | 作用（一句话） | 首发版本 | 改动位置 | 修的问题 |
|---|---|---|---|---|---|
| 01 | [九尾 PF 弹射前连击快照](01-pf-initial-combo/README.md) | 在消耗连击前保留真实连击，供私有 PF 的35连击判定使用 | v10 | BallImpl/resolveCollisionForPrimaryOrSummons；ActionEvaluationResolver/<ctor> | 未发现专用错误码 |
| 02 | [能力与队长技文案覆盖](02-panel-description-override/README.md) | 按 desc_override_<string_id> 显示作者文案，缺表时沿用原文避免8013 | v11（v14 泛化与安全取表） | AbilityLogic/getDescriptions；AbilityLogic/getDescriptionWithSimplify；LeaderAbilityLogic/getDescriptions；LeaderAbilityLogic/getDescriptionWithSimplify | 8013：CustomAbilityStringTable 未加载时原 getMasterTable 会抛错 |
| 03 | [冲刺参数能力422](03-dash-parameter-422/README.md) | 支持由能力修改冲刺参数的解析、文案、汇总和战斗执行 | v12 | AbilityValues$/parseAt109；DuringAbilitySource$/createFromDuringAbilityValues；BattleAbilityTotalizerImpl/addDuringContent；BallImpl/update；BallImpl/findEscapeTarget；BallImpl/tryEscape；BallImpl/canEscapeNow | C7050：未支持的新枚举解析 |
| 04 | [Fever 槽百分比增减724](04-fever-ratio-724/README.md) | 新增按 Fever 满槽比例加减槽的瞬时能力，配套解析、文案和执行 | v12 | AbilityValues$/parseAt47；InstantAbilitySource$/resolveInstantContent；AbilitySlotImpl/applyInstantBattle | C7050：未支持的新枚举解析 |
| 05 | [夏日白晒伤能力减抗](05-summer-bai-sunburn/README.md) | 让Unique(1499901)每层降低敌人能力抗性15%，最多三层 | v15；Lens 0910 移植前作者具体构建名需核实 | ConditionSlot/getOneSideTotalAbilityDamageResistance | 未发现专用错误码 |
| 06 | [夏日白Fever语音路由](06-summer-bai-voice/README.md) | 依据真实Fever状态选技能音并分别轮换准备音 | v15 | SquadManagerImpl/invokeActionSkill；HudMemberStatus/update；BattleCharacterLogic/resolveFollowingPathCollection | 未发现专用错误码 |
| 07 | [129992四条准备音轮换](07-gerald-129992-ready-voice/README.md) | 为unicorn_lancer_rose轮换四条准备音并预加载，缺文件回退 | v16 | HudMemberStatus/update；BattleCharacterLogic/resolveFollowingPathCollection | 未发现专用错误码 |
| 08 | [能力汇总描述缓存](08-ability-summary-description-cache/README.md) | 在一次能力汇总中，按上一项能力对象的身份复用 getDescription(false) 结果，减少同一能力多条触发条件的重复描述计算。 | v17以前；原性能阶段称 R8，具体发布APK编号未核实 | AbilitySummarizer$/summaryAbilities | 同一能力的多条触发条件反复生成同一文案，造成重复计算。 |
| 09 | [深渊续战跨关复用角色](09-abyss-autostart/README.md) | 让深渊活动700099续战时跨关复用队伍角色，保留逐关选队与其他活动限制 | v17 以前；具体 APK 编号未核实 | RushEventAutoStartQuestGroup/getDuplicatedCharacterIdsForEachQuest | 未发现专用错误码 |
| 10 | [深渊关卡详情与摘要](10-abyss-details/README.md) | 在列表与编队页展示封锁属性和关卡详情，并保留最终四角曲线的详情按钮。 | v17 以前；具体 APK 编号未核实 | QuestTranslator/translateFormattedQuestNumber；PartySelectTopPanelView/baseRun；cn.ui.AbyssDetails/* | 未发现专用错误码 |
| 11 | [深渊装备与能力魂副本门控](11-abyss-equipment-mode-gate/README.md) | 限制 8000101–8000115 的装备/能力魂只在精确副本白名单中生效，并允许直接装备强化等级至少 120 的例外。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | BattleCharacterLogic.getAvailableAbilities；getAvailableAbilitiesWithCond 不改 | 强力深渊装备需要限制适用模式；直接装备需要解包 abilitySoulAbility，能力魂不能获得直接装备等级例外。 |
| 12 | [深渊纪录保持者昵称](12-abyss-record-holder/README.md) | 在最快用时下显示纪录保持者当前公开昵称并安全转义 | v17 以前；具体 APK 编号未核实 | cn.ui.AbyssRecordDetails/responseText | 未发现专用错误码 |
| 13 | [深渊本期最快纪录展示](13-abyss-records/README.md) | 在深渊详情中请求并显示本期全服最快通关用时 | v17 以前；具体 APK 编号未核实 | cn.ui.AbyssDetails/openDetails；cn.ui.AbyssRecordDetails/* | 未发现专用错误码 |
| 14 | [标题和游戏内数据继承入口](14-account-takeover-entry/README.md) | 恢复标题菜单第四格及游戏内菜单的数据继承入口，复用客户端原生继承页面和处理。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | MenuTopScene.createMenuListData、TitleMenuDialogContentView.setupContents | V51 中继承逻辑存在但缺正常可见入口；只改 TitleMenuDialog.prepare 顺序无法改变真实显示。 |
| 15 | [杰拉尔特克托斩铁准备音扩展](15-author-ready-voices/README.md) | 移植三角色准备音选择、详情试听与战斗预加载 | v17 以前；具体 APK 编号未核实 | HudMemberStatus/update；CharacterVoiceLogic/createVoicePathMap；BattleCharacterLogic/resolveFollowingPathCollection | 未发现专用错误码 |
| 16 | [可用能力描述缓存](16-available-ability-description-cache/README.md) | 在一次可用能力筛选中，按上一项能力对象的身份复用 getDescription(false) 结果，减少遍历同一能力多条触发条件时的重复描述计算。 | v17以前；原性能阶段称 R8，具体发布APK编号未核实 | BattleCharacterLogic/getAvailableAbilities | 同一能力的多条触发条件反复生成同一文案，造成重复计算。 |
| 17 | [觉醒任务完成即时刷新](17-awake-page-refresh/README.md) | 任务回调后重新取得角色与觉醒等级，立即启用正确页签 | v17 以前；具体 APK 编号未核实 | CharacterAwakeScene/applyMissionProgress | 未发现专用错误码 |
| 18 | [编队轮播仅更新当前队伍](18-character-carousel-current-only/README.md) | 轮播每帧只更新当前队伍并按需初始化，降低大量编队时开销 | v17 以前；具体 APK 编号未核实 | PartyCarousel/update | 未发现专用错误码 |
| 19 | [客户端准入与握手续期](19-client-admission/README.md) | 让HTTP/TCP等待有效准入凭证并处理续期、重试与取消保护 | v17 以前；具体 APK 编号未核实 | cn.admission.ClientAdmission/*；cn.admission.AdmissionSession/*；cn.admission.BuildConfig/* | 未发现专用错误码 |
| 20 | [普通伤害类型完整转换（424 与 DSL 标记）](20-damage-type-conversion/README.md) | 让技能、能力、直击与 PF1–3 的来源标志、增伤池和 PF 档位一并转换，供角色规则及单段 DSL 指定分类。 | 未核实（v17 已含；2026-09-24 客户端规则补丁已出现） | Environment/getBuffTargetAs、ImpactSourceContent$/NormalAttack、MemberImpl$/wfConvertNormalAttack、MemberAbilityTotalizerImpl/wfResolveDamageType；共用 content.py | 旧 getBuffTargetAs 丢弃 101/102/104/131–133，导致 PF3 等标记最终仍按技能结算；仅改通用增伤池无法正确覆盖统计、耐性、计数与独立乘区。 |
| 21 | [ModDualForm特殊动画切换](21-dual-form-animation/README.md) | 持有ModDualForm标签的角色按Unique22切换special动画并预加载 | v17以前；具体编号未核实 | MemberView/draw；BattleCharacterLogic/resolvePathCollection | 未发现专用错误码 |
| 22 | [空更新兼容与账号切换偏好保留](22-empty-update-and-preferences/README.md) | 兼容旧服务端空更新响应并在账号切换时保留设备偏好 | v17 以前；具体 APK 编号未核实 | AssetGetPathRealRemote/successHandler；cn.asset.EmptyUpdate/*；cn.account.PlayerLogin/* | 未发现专用错误码 |
| 23 | [幻想装备缩略图预加载](23-fantasy-equipment-thumbnail-preload/README.md) | 在全局资源路径收集中加入幻想装备缩略图，保证相关界面读取装备图标前已纳入加载集合。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | GlobalAssetPathCollectionBuilder.leadingLogicLoadedHandler | 幻想装备图标需要进入原生全局资源加载集合；最终方法包含十一条 item/equipment/mod/fantasy/* 路径。 |
| 24 | [幻想连战多人阶段准入与战斗路由](24-fantasy-rush-multi-routing/README.md) | 为幻想连战 300098001–300098003 阶段提供活动可见/选择、直达多人战斗以及房间准备路由。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | AdventEventQuestLogic、BossBattleModeSelectScene、SingleQuestStartFlow、PartySelectScene、RushEventQuestSelectScene、MultiBattleRoomPrepareFlow | 幻想连战第5/10/15阶段需要走多人房间与战斗流程，并保持相关解锁/准入分支。 |
| 25 | [幻想连战多人结算及房间返回](25-fantasy-rush-result-return/README.md) | 识别幻想连战多人阶段边界，衔接奖励结算、重试、结束、房主解散、访客退出与场景返回。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | RushEventClearRewardDialog、QuestResultScene、MultiBattleRoomScene、CooperationRoomSocketContact、QuestAbortTransitionRouter | 普通单人 Rush 的推进/返回流程不能直接覆盖幻想多人边界；最终存在独立 boundary/continue 判定与 disband 状态。 |
| 26 | [幻想能力魂图标异步纹理加载](26-fantasy-soul-async-texture/README.md) | 先异步加载 ItemThumbnail，再为幻想魂珠更新图标，使用 pendingFantasySoulImagePath 避免直接读取未准备的纹理。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | PartyCarouselAbilitySoulView.present/fantasySoulTextureLoadCompleted、pendingFantasySoulImagePath 字段 | 资源未入纹理缓存时同步 getTexture 可触发 C8004，继而 G1002；跨端说明明确这是 Android 既有策略。 |
| 27 | [五重联机手动开局 Auto 锁及暂停状态](27-fiveboss-manual-auto-lock/README.md) | 仅对联机 1099001–1099003，在手动开局后禁止切到自动，并在暂停菜单显示同一锁状态。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | BattleScene.preparation/changeAutoplayMode、BattlePauseMenu.prepare、fiveBossManualAutoLock 实例槽 | 需要维持手动开局模式，避免战斗按钮与暂停菜单的锁状态不一致。 |
| 28 | [五重随机地图与联机房号种子](28-fiveboss-random-map-seed/README.md) | 为五重地图候选加入条件行与随机选择，并以联机房号生成确定性种子，使同房客户端选择一致地图。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | BothBossTool 的 3 个地图入口与 6 个新增辅助方法 | 自定义五重地图需要随机候选，并避免联机各端独立随机导致地图不一致；普通 BothBoss 分支保留。 |
| 29 | [5900101 禁五星铁钢替代觉醒材料](29-fiveboss-weapon-no-steel/README.md) | 对五重武器 5900101 返回无可替代觉醒结晶，防止用五星铁钢跳过专用材料。 | v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留） | OwnedEquipmentLogic.getUseableAwakingCrystal | 5900101 不应接受五星铁钢替代；其他武器原有替代规则保留。 |
| 30 | [无效回槽演出提前拒绝与规则筛选优化](30-gauge-effect-guard/README.md) | 在能力目标演出创建前拒绝已被 423 禁止的正向回槽，并先筛来源位，减少月兔队连续触发时的无效特效和状态查询。 | 未核实（v17 已含；源候选日期 2026-09-25，资源版本 1.4.1044 不是 APK 版本） | MemberImpl/applyInstantAbility、MemberAbilityTotalizerImpl/wfBlocksGauge | 原版回槽先创建 AbilityPerpetuity 再拒绝入账；大量连击持续积累无效特效，作者报告连续掉帧。 |
| 31 | [通用回槽来源限制（423）](31-gauge-gain-rules/README.md) | 按加槽方式、出处、持有者和触发者拦截正向回槽，支持全队与属性目标并保留开场、跑条等独立来源。 | 未核实（v17 已含；源补丁于 2026-09-24 出现，不能把日期当 APK 编号） | battle-rules/content.py、gauge.py、provenance.py；共用 423/424 解析和说明消费者 | 旧客户端遇到 423/424 可能在 AbilityValues.parseAt109 报 C7050；早期循环缺 AVM2 label 导致 VerifyError #1021 和开战黑屏，最终源已修复。 |
| 32 | [稻穗能力攻击视觉与预载](32-inaho-visuals/README.md) | 保留稻穗弹道与命中特效及六项必要资源预载 | v17 以前；具体 APK 编号未核实 | cn.mod.InahoAbilityVisuals/*；MemberImpl/applyInstantAbility；ActionEvaluator/addImpactToSubject；BattleCharacterLogic/resolvePathCollection | 未发现专用错误码 |
| 33 | [普通深渊EX幻想独立编队](33-independent-rush-party/README.md) | 为三类Rush活动分别保存编队并保留其它活动分类 | v17 以前；具体 APK 编号未核实 | cn.mod.IndependentRushParty/*；RushEventLoadingTask/summaryRemoteInput；EventRushPartyRealRemote/<ctor>；RushEventPartyGroupHolder/getPartyCategory；PartyGroupEditSceneView/refreshPartyCategory | 未发现专用错误码 |
| 34 | [常驻文件夹物品来源修复](34-item-source-folders/README.md) | 将已解锁且开放的活动文件夹纳入物品入手来源搜索 | v17 以前；具体 APK 编号未核实 | ItemHowToGetQuestSearcher/getAvailableQuestLogic；cn.ui.ItemSourceFolderGate/* | 未发现专用错误码 |
| 35 | [排行榜本人资料路由](35-leaderboard-self-profile/README.md) | 点击榜单本人时打开原生本人资料，其他玩家仍走公开资料路由 | v17 以前；具体 APK 编号未核实 | RushEventRankingPartyScene/copyPlayedParty | 未发现专用错误码 |
| 36 | [空账号记录恢复与原子替换写入](36-local-record-recovery/README.md) | 空账号返回登录流程，账号和设备记录经同目录临时文件替换写入 | v17 以前；具体 APK 编号未核实 | AccountLocalStore_Impl_$/get；AccountLocalStore_Impl_$/saveAccountData；DeviceLocalStore_Impl_$/writeFile；cn.storage.LocalRecordIO/* | Error #2030：0字节账号文件解包EOF导致重开黑屏 |
| 37 | [八岐大蛇阶段血量弱点与同步运行时](37-orochi-boss-runtime/README.md) | 按机制配置建立阶段伤害账本，维护弱点伤害窗口、阶段生命值和联机快照恢复。 | v17 以前；具体 APK 编号未核实 | cn.boss.BossMechanicsRuntime/*；OrochiExValues/<ctor>；OrochiEx/ensurePhase4Ledger；OrochiEx/resolvePhase4Break；OrochiEx/updatePhase4Extension；OrochiEx/reinitialize；OrochiEx/getSynchronizeKind；OrochiEx/changePhase；OrochiEx/applySynchronizeKind；OrochiEx/subtrac…（完整列表见子目录） | 具体bug未核实，现存Android构建器只转换已验收LAN载荷 |
| 38 | [编队切换空引用修复](38-party-carousel-f1009/README.md) | 先初始化目标队伍再绑定触摸，空角色格触摸安全返回 | v17 以前；具体 APK 编号未核实 | PartyCarousel/changeIndex；CharacterCellButtonProcessor/beginTouch | F1009：切队名称或beginTouch空引用 |
| 39 | [队伍派生缓存与完整键](39-party-derived-cache/README.md) | 复用同次加载中的派生角色结果并按完整枚举与数据快照失效 | v17 以前；具体 APK 编号未核实 | BattlePartyLogic/getUnitedCharacters；cn.loading.PartyDerivedCache/* | R9回调曾有F1063，最终R10保留五参数回调修复 |
| 40 | [角色派生分批预计算](40-party-precompute-batching/README.md) | 每个16ms Timer回调至多计算一个主副角色组合后继续场景构造 | v17 以前；具体 APK 编号未核实 | LoadingSceneBase/gotoNextScene；LoadingSceneBase/startNextSceneAssetLoadWithDetail；BattleScene/leaveHandler；cn.loading.PartyDerivedCache/* | 未发现专用错误码 |
| 41 | [玩家账号登录界面](41-player-login/README.md) | 添加玩家登录与账号切换入口，保持原存档流程 | v17 以前；具体 APK 编号未核实 | cn.account.PlayerLogin/*；TitleMenuDialogContentView/setupContents；MenuTopScene/createMenuListData；DevConfig/getSaveDataKey | 未发现专用错误码 |
| 42 | [游戏服务器地址重指向](42-private-server-route/README.md) | 将游戏请求转向私服地址并保留原请求协议 | v17 以前；具体 APK 编号未核实 | DevConfig_gf_android/<ctor> | 未发现专用错误码 |
| 43 | [个人资料关注按钮可见性修复](43-profile-follow-visibility/README.md) | 按原四态关系直接设置关注和取消关注按钮，避免父层切帧后状态残留 | v17 以前；具体 APK 编号未核实 | PlayerProfileView/refreshFollowRelationButtons；OtherProfileLogic/applyButton | 关注关系状态正确但具体按钮可见性残留 |
| 44 | [关卡属性耐性入口](44-quest-element-resistance/README.md) | 读取关卡 sub_name 的属性伤害配置并附加原生耐性条件 | v17 以前；具体 APK 编号未核实 | BattleQuestBaseImpl/getInitialEnemyConditions；cn.rules.QuestElementResistance/* | 未发现专用错误码 |
| 45 | [角色像素按frame.scale显示](45-render-frame-scale/README.md) | 尊重逐角色frame.scale使自制角色在界面与战斗中的占屏一致 | v17以前；具体编号未核实 | MemberView/<ctor>；PixelArtCharacterView/spriteSheetLoadCompleted；CharacterCellView/drawWithAdvanceFlag | 未发现专用错误码 |
| 46 | [通用Rush原生排行榜](46-rush-native-leaderboard/README.md) | 复用官方排行榜页面和素材，显示分页榜单、本人定位、奖励及玩家资料 | v17 以前；具体 APK 编号未核实 | RushEventTopScene/run；RushEventTopScene/buttonClicked；RushEventTopView/run；RushEventRankingPartyScene/preparation；RushEventRankingPartyScene/run；RushEventRankingPartyScene/buttonClicked；RushEventRankingPartyScene/copyPlayedParty；RushEventRankingPartyScene/a…（完整列表见子目录） | 未发现专用错误码 |
| 47 | [跳过渠道SDK正式登录](47-sdk-dummy/README.md) | 启用sdkDummy以使用兼容的登录通道而不进入原渠道SDK | v17 以前；具体 APK 编号未核实 | DevConfig$/<cinit>；ChannelSDKDummy/startLoginServer | 未发现专用错误码 |
| 48 | [特殊SET编辑标题C8601修复](48-set-edit-title-c8601/README.md) | 特殊编队分类仍用于路由，标题按安全分类显示以免非法查表 | v17 以前；具体 APK 编号未核实 | PartyGroupEditSceneView/refreshPartyCategory | C8601：特殊分类作为原生标题表key时越界 |
| 49 | [活动商品成员索引与最终快扫](49-shop-event-product-index/README.md) | 按活动类型和 ID 建立商品成员索引，最终用前两字段快扫减少首次整表解码，并保留异常行原逻辑。 | v17 以前；具体 APK 编号未核实 | ShopProductRepository/getAllProducts；ShopProductRepository/existsEventItemInQuestEvent；cn.shop.ShopFirstOpen/* | 未发现专用错误码；最终快扫降低兑换冷扫描，坏行仍回退并保留原 7050 语义。 |
| 50 | [商店与文件夹存在性短路](50-shop-existence-short-circuit/README.md) | 找到首个可用兑换活动即返回，保持进入列表时的完整结果 | v17 以前；具体 APK 编号未核实 | ShopTopScene/existsExchangeableEvents；EventItemExchangeTopScene/getListSource | 未发现专用错误码 |
| 51 | [标题CNtips_b隐藏](51-title-cntips-hide/README.md) | 在每次健康提示刷新时保持隐藏CNtips_b，防止初始化后又显示 | v17 以前；具体 APK 编号未核实 | TitleView/refreshHealth | 未发现专用错误码 |
| 52 | [测试服独立包与准入身份](52-testserver-v17-identity/README.md) | 将作者累计包隔离为com.leiting.wt并同步更换标签、AIR身份和两份准入key | v17 | AndroidManifest.xml；resources.arsc；cn.admission.ClientAdmission/*；cn.admission.BuildConfig/* | 准入key有两处编译副本，漏改会握手失败；生成源码不含实际key值 |
| 53 | [强化充能速度固有上限](53-charge-cap-unique/README.md) | 让固有 13999010 的层数指定高于官方上限的充能速度上限，并在原始值未超官方 MAX 时跳过状态扫描。 | v18 | MemberImpl/getStatModifierSkillGaugeCharging | 官方上限固定；早期 1+n/50 公式后改成 n/100，最终 v25 先比较原始和再查固有以降低逐帧开销。 |
| 54 | [凯尔队长直击固有参数倍率](54-kyle-direct-multiplier/README.md) | 由凯尔专用固有状态层数控制直击基础倍率和每连击加成，使倍率配置落在数据中。 | v18 | MemberImpl/scheduleDirectAttack 的 kyle 块 | v18 初版硬编码倍率/连击上限；最终版改为 13999011 基础倍率 × (1 + 13999012 层数 × combo / 10000)，无另设 combo 设计上限。 |
| 55 | [凯尔 PF 追加命中标记静音](55-kyle-pf-marker-silence/README.md) | 识别凯尔 PF 追加判定区的专用命中特效标记，省去该追加命中的数字、特效、音效和闪烁。 | v18 | EnemyImpl/applyAttack | 凯尔 PF 多次追加产生重复表现；没有错误码。最终 v25 删除普通多段直击的通用静音，只保留专用 marker。 |
| 56 | [凯尔队长四段以上直击合并结算](56-kyle-direct-merge/README.md) | 把凯尔队长 N≥4 段直击合为一次总伤结算，同时补齐 N−1 次计数、连击、Fever 与韧性贡献。 | v20 | MemberImpl/scheduleDirectAttack 的 merge/tough/fever 块 | 大量段数逐段调度带来开销；v20 初版对所有角色 N≥4 生效，v25 最终限制为凯尔队长，其他角色回归原生逐段结算。 |
| 57 | [Boss 韧性击晕条常显](57-boss-stun-gauge/README.md) | 对 kind=3 的 Boss 始终显示韧性击晕调试条，方便观察击晕进度。 | v22 | EnemyImpl/isBattleDebugToughnessPointGaugeVisible | 显示功能，无原始错误码。 |
| 58 | [hidden_ 固有图标与翻页计数过滤](58-hidden-unique-icons/README.md) | 不在状态栏绘制 string_id 以 hidden_ 开头的固有状态，并以过滤后数量计算翻页。 | v23 | MemberImpl/getConditionsIncludingOuterEnvironments、MemberImpl/getTotalConditions | 专门承载机制的固有状态挤占图标；v23 仅过滤图标后，原始总数仍造成空页/页数不一致，v25 改用过滤后长度。 |
| 59 | [自动倍速重复写盘跳过](59-autospeed-store-skip/README.md) | 自动倍速值未变化时跳过JSON压缩和同步写盘 | v25 | MiscDataLogic/setAutoSpeedLevel | 性能问题，无专用错误码 |
| 60 | [角色表每帧最多应用三格](60-character-apply-throttle/README.md) | 启用轻量绘制分支并将每帧应用上限设为3 | v25 | CharacterTableView/draw | 性能问题，无专用错误码 |
| 61 | [屏外角色格绘制计算跳过](61-character-offscreen-draw-skip/README.md) | 屏外格跳过颜色坐标计算但继续原生隐藏块以避免残影 | v25 | CharacterCellView/drawWithAdvanceFlag | v25初稿屏外直接return曾导致异步台座残影，最终保留隐藏块 |
| 62 | [远屏角色格动画更新跳过](62-character-offscreen-playhead-skip/README.md) | 视口外超过2160px且不下落的格跳过playhead更新 | v25 | CharacterTable/updateCells | 性能问题，无专用错误码 |
| 63 | [角色可见集合与排序优化](63-character-rank-map-sort/README.md) | 使用局部集合和线性重排替代indexOf比较器，异常长度退回原排序 | v25 | CharacterTable/applyCharacters | 性能问题，无专用错误码 |
| 64 | [五重首轮600帧宽限](64-five-boss-round1-grace/README.md) | 首轮隔离豁免只在主战斗前600帧生效，之后恢复原隔离 | v25 | BattleScenePlayingStateImpl/proceedBattles | 旧五重首轮永久豁免限制；与v29 getDeferralLevel有独立作用 |
| 65 | [149999四拍准备音轮换](65-gerald-149999-ready-voice/README.md) | 为white_wolf_gerald按原生音和alt_1至alt_3四拍轮换并预载试听 | v25 | HudMemberStatus/update；BattleCharacterLogic/resolveFollowingPathCollection；CharacterVoiceLogic/createVoicePathMap | 内容扩展；缺文件保留原生音 |
| 66 | [主城MSAA关闭](66-home-msaa-off/README.md) | 将主城antiAliasing从4改0减少渲染成本 | v25 | HomeView/<ctor> | 性能问题，无专用错误码 |
| 67 | [编队与角色页无效日志求值跳过](67-party-ui-log-skip/README.md) | 绕过关闭日志时仍执行的字符串拼接与全角色遍历 | v25 | CharacterTableView/present；PartyCarouselPageView/apply；CharacterTableView/applyPatch；CharacterScene/viewDidChange | 性能问题，无专用错误码 |
| 68 | [战斗日志仅保存快照](68-reproduce-snapshot-only/README.md) | 跳过Instant和Ready逐事件序列化落盘，仅保留Snapshot | v25 | ReproduceFileRecordImpl/saveLog | 性能问题，无专用错误码 |
| 69 | [图集超限递归分页](69-atlas-overflow-spill/README.md) | pack尺寸溢出时将资源对半递归拆页并按名登记，防止加载失败 | v26 | BattleStartProductionViewService/setupTextureAtlas | U_1d93f4 / size exceeded（源码注释） |
| 70 | [本地资源加载GC四次减一次](70-local-loading-view-gc/README.md) | 仅给画面资源子任务挂GC，跳过逻辑前后段与声音的重复GC | v26 | LocalLoading/startChild | 性能问题，无专用错误码 |
| 71 | [战斗图集合成分帧](71-battle-pack-slicer/README.md) | 用Timer分帧合成战斗图集，失败或不适用时走同步分页兜底 | v27 | BattleStartProductionViewService/prepare；cn.loading.BattlePackSlicer/* | 性能问题，无专用错误码 |
| 72 | [转场GC去重](72-transition-gc-dedupe/README.md) | 1.5秒内重复显式GC只执行一次 | v28 | LogicSceneTransition/deactivatePreviousScene；ProductionLoading/resetAssets；cn.loading.GcGate/* | 性能问题，无专用错误码 |
| 73 | [联机停帧有限宽限](73-coop-bounded-grace/README.md) | 将队友停帧隔离的等级八边界从 240 放宽到 1800，减少仍在心跳的短暂停帧被踢出。 | v29-coop | BattleDerailleur/getDeferralLevel | 停帧队友提前隔离；C15001 的真实服成因未证实，此补丁不应声称修复乱序。 |
| 74 | [主表 key 下标字典缓存](74-master-index-dictionary/README.md) | 为 MasterBinaryMap 懒建 key 到首个下标的字典，严格校验命中，降低重复线性查表成本。 | v30-perf | MasterBinaryMap/getIndex | 全场景重复 indexOf；找不到 key 仍按原逻辑抛 8601。 |
| 75 | [进战跳过状态全量日志](75-battle-skip-status-dump/README.md) | 跳过 floor=0 时反射序列化整个 LogicStatus 到 _status.log，缩短进战首段停顿。 | v30-perf2 | Restore/saveBattleRestore | 进战同步反射/文件写入热点；保留 header、校验与 Initial 快照，运维导出会少此状态日志。 |
| 76 | [编队翻页只建队员](76-party-flip-cached-members/README.md) | 筛选设置完全相同且有缓存时只重建当前两队成员，减少翻页时全角色重建与排序。 | v30-perf2 | CharacterUseCaseBase/getListCharactersInParties | 翻队伍页反复 find 全角色；原报告设备样本没有观察到改善，不能把静态优化写成实测提速。 |
| 77 | [兑换入口恢复灰显](77-shop-entry-greyout/README.md) | 撤掉 v28 兑换入口强制点亮常量，恢复有可兑换活动时才点亮的判断。 | v30-perf2 | ShopTopScene/listCellEnabledResolver | v28 入口总亮的副作用；首次开商店会重新承担一次快速扫描。 |
| 78 | [超限结晶突破按钮过滤](78-overlimit-crystal-buttons/README.md) | 让突破窗口按钮列表按超限模式只显示对应结晶。 | v31 | OwnedOverLimitLogic/getAwakingCrystalToOverLimit | 无明确错误码；为超限功能的客户端规则支持。 |
| 79 | [五星 101–120 内置经验表](79-overlimit-experience/README.md) | 给 character_level_iosbundled 五星行追加 101–120 级，每级累计经验增加 15000，120 级 679988。 | v31 | assets/bundle.zip / master/character/character_level_iosbundled.orderedmap | 无明确错误码；为超限功能的客户端规则支持。 |
| 80 | [超限全身台座路径](80-overlimit-full-pedestal/README.md) | 超限和满级全觉醒角色分别切换全身台座 _6 与 _7 档。 | v31 | GeneralCharacterLogic/getPedestalImagePath | 无明确错误码；为超限功能的客户端规则支持。 |
| 81 | [超限半身台座路径](81-overlimit-half-pedestal/README.md) | 超限和满级全觉醒角色分别切换半身台座 _6_half 与 _7_half 档。 | v31 | GeneralCharacterLogic/getHalfPedestalImagePath | 无明确错误码；为超限功能的客户端规则支持。 |
| 82 | [五星内置等级上限表扩展](82-overlimit-level-cap/README.md) | 将 level_cap_iosbundled 五星行 80,4,5,3,3 改为 80,8,5,3,3，提供超限八次。 | v31 | assets/bundle.zip / master/character/level_cap_iosbundled.orderedmap | 无明确错误码；为超限功能的客户端规则支持。 |
| 83 | [超限角色最大突破次数门控](83-overlimit-max-step/README.md) | 按稀有度、character_status 最高键等级和已有突破次数区分官方 4 次与超限 8 次。 | v31 | GeneralCharacterLogic/get_maxOverLimitStep | 无明确错误码；为超限功能的客户端规则支持。 |
| 84 | [超限模式禁止重复角色突破](84-overlimit-no-dupes/README.md) | 第 5 次突破起不再提供用重复角色突破，维持新道具规则。 | v31 | OwnedOverLimitLogic/getOverLimitState | 无明确错误码；为超限功能的客户端规则支持。 |
| 85 | [超限结晶持有列表过滤](85-overlimit-owned-crystals/README.md) | 让持有结晶列表按超限模式只显示对应结晶。 | v31 | OwnedOverLimitLogic/getOwnAwakingCrystalToOverLimit | 无明确错误码；为超限功能的客户端规则支持。 |
| 86 | [超限台座图集追加](86-overlimit-pedestal-atlas/README.md) | 在台座图集追加六属性 _6/_7 及 half 共 24 帧，供 O6/O7 路径使用。 | v31 | assets/bundle.zip / character_pedestal/sprite_sheet.png + sprite_sheet.atlas.amf3.deflate | 无明确错误码；为超限功能的客户端规则支持。 |
| 87 | [PF Lv4 弹板渐变和红光](87-pf-lv4-color/README.md) | 根据 P2 编码给弹板染八档渐变及就绪满红，控制官方充能件红光和 spark 显示。 | v32 | BattleFlipperView/draw | 无明确错误码；支持新增 PF Lv4 功能。 |
| 88 | [PF Lv4 DSL 选择](88-pf-lv4-dsl/README.md) | 队长拍板快照连击至少 100 时优先使用 forLevels=4 的 override，仍走 Lv3 乘区。 | v32 | MemberImpl/startPowerFlip | 无明确错误码；支持新增 PF Lv4 功能。 |
| 89 | [PF Lv4 充能状态与提示](89-pf-lv4-ready/README.md) | 按 Lv3 阈值至 100 连击记录八档渐变状态，Lv4 就绪播一次预载提示音并每 60 帧重放红色官方 twinkle。 | v32 | BattleFlipperImpl/update | 最终修订使用预载 SE，修复最初 v32 懒加载通路 ClientError 8022；并撤掉旧周期 HitEffect 的噪声/观感问题。 |
| 90 | [Fever 结束跳过未开箭头](90-fever-arrow-close/README.md) | Fever 结束时跳过被替换且从没开启的箭头收起演出，其他物件照常收起。 | v32g | YakumonoManagerImpl/deactivate | 被替换且从未打开的箭头在 Fever 结束时仍播放收起演出。 |
| 91 | [Fever 箭头换随机道具](91-fever-arrow-items/README.md) | 队长有数据标记时保持 Fever 箭头关闭，并按联机一致种子在箭头位置生成随机官方 Fever 道具。 | v32g | YakumonoManagerImpl/activate | 8013（主表未加载）、8601（空标记槽缺键）、14502（rotationPanelAnimation=None）、联机副本分歧；最终 v32l 使用 Some(backgroundAnimation)。 |
| 92 | [Fever 道具 following 预载](92-fever-items-preload/README.md) | 预载所有有效候选道具的视图/动画路径，防止生成后缺资源。 | v32g | BattleQuestBaseImpl/resolvePathCollectionForDashPanel | 8013（主表未加载）、8601（遍历未配置标记槽）、候选数据坏链导致战斗资源收集失败。 |
| 93 | [Fever 道具 leading DSL 预载](93-fever-items-leading-dsl/README.md) | 在 leading 阶段提前加入各候选 program_path:元素，修复进有箭头关卡时报 8037。 | v32j | BattleQuestBaseImpl/leadingResolvePathCollection | ClientError 8037：battle/action/item/action/hp_recovery_small 的 action 没有在 leading 阶段加载。 |
| 94 | [技能准备 alt 语音图鉴](94-generic-ready-gallery/README.md) | 把正常和变身技能准备 alt 路径补进图鉴，夏日白原本缺项由通用逻辑补上。 | v33 | CharacterVoiceLogic/createVoicePathMap | 无明确错误码；为通用语音轮换功能。 |
| 95 | [通用技能准备 alt 预载](95-generic-ready-preload/README.md) | 战斗预载正常和变身技能准备路径的连续 alt，最多五条且遇缺号停止。 | v33 | BattleCharacterLogic/resolveFollowingPathCollection | 无明确错误码；为通用语音轮换功能。 |
| 96 | [通用技能准备语音轮换](96-generic-ready-rotation/README.md) | 有连续 _alt_N 文件的角色按原句与 alt 轮换，保留五个已有专用轮换角色的旧逻辑。 | v33 | HudMemberStatus/update | 无明确错误码；为通用语音轮换功能。 |
| 97 | [x86_64 同版 AIR 运行时](97-x86-air-runtime/README.md) | 为双 ABI 测试包追加 AIR 33.1.1.620 x86_64 运行时及 C++ 依赖，使模拟器能原生运行。 | v33-x86 | lib/x86_64/libCore.so；lib/x86_64/libc++_shared.so | ARM 转译下主线程占满、战斗掉帧。 |
| 98 | [ANE Android-x64 平台补全](98-x86-ane-platforms/README.md) | 为十三个 ANE 克隆 ARM64 平台声明和平台资源到 Android-x64，修复 x86 运行时创建 context 为空后的黑屏。 | v33-x86 | assets/META-INF/AIR/extensions/*/META-INF/ANE/extension.xml 与 Android-x64/ | ScreenAne 同步解引用 null 的 TypeError #1009；未注册错误监听时静默黑屏。 |
| 99 | [x86_64 SDK 与壳兼容桩](99-x86-native-stubs/README.md) | 为其余十二个 native 库名提供兼容桩，使 Android 选用 x86_64 且保留启动所需库名和入口。 | v33-x86 | lib/x86_64/libentryexpro.so 等十二个库（不含 AIR 两库和 SocketHelper） | 缺失同名 x86_64 库/入口会阻断加载；这些桩不提供完整支付、推送等 SDK 功能。 |
| 100 | [x86_64 SocketHelper JNI 实现](100-x86-sockethelper/README.md) | 以 E3 C 实现补齐雷霆 SDK 的 SocketHelper native 入口，越过启动配置解密必经点。 | v33-x86 | lib/x86_64/libSocketHelper.so / com.leiting.sdk.SocketHelper | E0 的 UnsatisfiedLinkError: SocketHelper.H(String)。 |
| 101 | [悖论之核双道具次数限制](101-overlimit-paradox-core-item/README.md) | 超限可突破次数取结晶数、悖论之核数、剩余次数的最小值。 | v31 | OwnedCharacterLogic/getPossibleOverLimitCountByItem | 无明确错误码；为超限功能的客户端规则支持。 |

## 版本时间线

表中只列最终仍采用的条目；修订不重复算新增。早于 v17 的确切编号见各子目录，编号缺失组保留未核实。

| APK 版本 | 最终保留的新增或修订 |
|---|---|
| v17 | 52 测试服独立包与准入身份（v17）；继承上述所有早期补丁，具体首发编号缺失者不推定首发 v17。 |
| v18 | 53 强化充能速度固有上限（v18）；54 凯尔队长直击固有参数倍率（v18）；55 凯尔 PF 追加命中标记静音（v18） |
| v19 | 未发现需要独立新增收录的最终功能；历史修订并入其最终条目。 |
| v20 | 56 凯尔队长四段以上直击合并结算（v20） |
| v21 | 凯尔直击倍率参数化修订，归入首发 v18 的最终条目。 |
| v22 | 57 Boss 韧性击晕条常显（v22） |
| v23 | 58 hidden_ 固有图标与翻页计数过滤（v23） |
| v24 | 没有最终新增条目；当时的分数 ×0.01 已在 v25 重建时明确排除。 |
| v25 | 59 自动倍速重复写盘跳过（v25）；60 角色表每帧最多应用三格（v25）；61 屏外角色格绘制计算跳过（v25）；62 远屏角色格动画更新跳过（v25）；63 角色可见集合与排序优化（v25）；64 五重首轮600帧宽限（v25）；65 149999四拍准备音轮换（v25）；66 主城MSAA关闭（v25）；67 编队与角色页无效日志求值跳过（v25）；68 战斗日志仅保存快照（v25）；从 v17 重建，重做凯尔静音/队长合并、max-first 充能上限和隐藏图标计数。 |
| v26 | 69 图集超限递归分页（v26）；70 本地资源加载GC四次减一次（v26） |
| v27 | 71 战斗图集合成分帧（v27） |
| v28 | 72 转场GC去重（v28）；当时强制兑换入口点亮随后被 S2 恢复，不另收旧状态。 |
| v29 | 73 联机停帧有限宽限（v29-coop） |
| v30 | 74 主表 key 下标字典缓存（v30-perf）；75 进战跳过状态全量日志（v30-perf2）；76 编队翻页只建队员（v30-perf2）；77 兑换入口恢复灰显（v30-perf2）；活动商品索引改为 S1 最终快扫（原条目首发更早）；P1=v30-perf，S1/S2/B1/C1=v30-perf2。 |
| v31 | 78 超限结晶突破按钮过滤（v31）；79 五星 101–120 内置经验表（v31）；80 超限全身台座路径（v31）；81 超限半身台座路径（v31）；82 五星内置等级上限表扩展（v31）；83 超限角色最大突破次数门控（v31）；84 超限模式禁止重复角色突破（v31）；85 超限结晶持有列表过滤（v31）；86 超限台座图集追加（v31）；101 悖论之核双道具次数限制（v31）；O1–O7 均已构建并保留，其中 O5 双道具／悖论之核限制补录为 101；后续零核调整尚未构建。 |
| v32 | 87 PF Lv4 弹板渐变和红光（v32）；88 PF Lv4 DSL 选择（v32）；89 PF Lv4 充能状态与提示（v32）；90 Fever 结束跳过未开箭头（v32g）；91 Fever 箭头换随机道具（v32g）；92 Fever 道具 following 预载（v32g）；93 Fever 道具 leading DSL 预载（v32j）；PF 最终 v32f，Fever B1/B2/B3 首见 v32g、B5 首见 v32j，最终合成 v32l；B4 撤销。 |
| v33 | 94 技能准备 alt 语音图鉴（v33）；95 通用技能准备 alt 预载（v33）；96 通用技能准备语音轮换（v33）；97 x86_64 同版 AIR 运行时（v33-x86）；98 ANE Android-x64 平台补全（v33-x86）；99 x86_64 SDK 与壳兼容桩（v33-x86）；100 x86_64 SocketHelper JNI 实现（v33-x86） |

## 如何从官方底包重建 v33

**尚不能给出一条经过验证、从官方底包起可完整运行的重建命令。** 早期作者载体含缺失的 Boss 原改写源、SDK dummy 原生成源及部分历史应用链；准入生成配置和签名材料也未收。下面区分已证明的顺序与缺口，不把文本归档称作完整构建工具包。

1. **官方底包 → 早期作者累计载体：未核实完整单一链。** `out/newchars-v14-20260908/BUILD.md` 能证明 v10/v11/v12 与 v14 的保留/回退关系；`startpoint-cn-kulo/client-patch/android-accepted.json` 和各子模块构建器证明 R8/R9/R10、作者内容及原生排行榜等累计内容，但版本号映射与所有前置产物不齐。R8 可从本次最终 P-code审阅，原 R8 重写器缺失；Boss Android 构建器直接读取已构建 LAN SWF，原算法与全部 trait/字段重建仍缺。不能将旧 v9、v15 试验或旧排行榜 P1/P2 顺手串入。
2. **累计 Android 作者 v17 → 测试服 v17。** 归档的 `make_test_apk.py` 生成 `com.leiting.wt` 独立包身份，修改 Manifest/resources/AIR 身份及两份编译准入副本。实际准入配置、旧/新 KEY、keystore 不归档；脚本只作文本源查看。源脚本含向原工作区写入配置的动作，此次没有执行。v17 已有 SWF `be3cd96af18c569153314ca2c9468ad9cb6061e188c75e84713c0dca06be5f15`，本次与 v33 对照证明继承。
3. **测试服 v17 → v28。** 最终组合源为 Temp `scratchpad/apk28/wf_hitfx_silence.v28.py`，直接以 v17 为基线并依脚本顺序加入最终凯尔/充能/Boss条/图标、日志/角色表优化、图集分页、分帧图集和 GC helper；不是把 v18→v24 各旧脚本叠打一遍。该组合源及其最终 helper 源已归档。旧分数缩放与通用多段直击静音不在最终组合中。
4. **v28 → v29-coop。** `coop-fix-20261014/client/patch_coop_grace.py` 只改 `BattleDerailleur/getDeferralLevel`；由 `build_coop_apk.py` 组包。生产 v29 SHA `be91bc50a5208b27abeb3412a30264dd429c0f505cc1465e22d0cd5fcaeebeb5`。本地端点补丁、服务端撤回方案及 coop2 计划不参与。
5. **v29 → v30-perf → v30-perf2。** 第一轮 `tools/patch_perf.py` / `build_perf_apk.py` 应用 P1；第二轮 `perf2_apply.py` → `perf2_core.apply_patches` 按 `perf2_patches.PATCHES` 的 **P1、S1、S2、B1、C1** 顺序处理（P1 已有则不重打），由 `build_perf2_apk.py` 组包。后续 v31 明确读取签名 perf2 SHA `90eb4659c4418a2dfa874ef724cf0be5e71cb9ade9773c67fdf5d19c82a352d0`。
6. **perf2 → v31-overlimit120。** `out/角色超限-120/apk/build_overlimit_apk.py` 调用 `overlimit_patches.py`，按真实 `PATCHES` 顺序应用 **O1→O2→O3→O4→O5→O6→O7**，并修改 bundle 内两张表与台座图集四成员。**O5 双道具／悖论之核限制已在 v31 applied，且 v33 实包方法体哈希一致，正式补录为 101；重建 v33 必须保留此 O5。后续“零核调整”尚未构建，不属于当前 v33。** 台座算法依赖未归档美术 PNG；二进制图集未收。v31 APK SHA `e9d4db2ebabf6a9c41f06daeac1a0a48f5b975de4678c4211f4dcf89c60c1749`。
7. **v31 → v32f PF。** `out/赛瑞斯重做-20261015/apk/build_pflv4_apk.py` 调用最终 `pflv4_patches.py`，应用 P1→P2→P3；v32f SHA `51dd8cd35f22cf7143967623dce6aace628539f050a197181004b62e8b5433c4`。
8. **v32f → v32l Fever 道具。** `build_feveritems_apk.py` 调用最终 `feveritems_patches.py`，按清单 B1→B2→B3→B5；B4 不在最终清单。v32l SHA `05582224e73343660714ba82f4dc6f1bff85ab7920ed29a773435afe19c90f67`。不要顺序叠打 v32b…v32l 的旧快照。
9. **v32l → v33。** `out/角色超限-120/apk/build_voice_apk.py` 调用 `voice_patches.py` 的 V1→V2→V3。构建报告输出 SWF `3b7b3391…` 与最终测试者 v33 逐字节同哈希；报告未签名 APK `275a4a15…` 不能冒认为最终签名 APK `3de625cf…`。签名和最终命名不改变该 SWF，签名材料未收。
10. **v33 → v33-x86（仅需要该变体时）。** `perf-v30-20261015/build-v33x86.ps1` 锁定 v33 哈希，先 `tools/build_x86.py` 加入 `x86_64-e3` 库集，再 `ane_x64_patch.py` 加十三个 `Android-x64` 平台，最后 zipalign/签名。`build-e3.ps1` 从 E2 库集继承并单独编译 `SocketHelper_e3.c`；E2 全库原始编译命令和 AIR 两个预编译库不在本归档中，不能宣称独立精确重建。实际 v33-x86 与 v33 的共用非签名成员只改十三个 ANE XML，SWF/DEX相同，增加十五个 native 库和平台资源。

上述脚本保留原绝对路径和依赖。`_build-support` 仅归档已定位的小型解析/汇编支持源，未运行、未改造成自动重建器，也未下载编译器或运行时。

## 只能二进制提供或源码恢复不完整

- **x86 AIR 运行时**：`libCore.so` / `libc++_shared.so` 只留预编译依赖，本地没有对应源码，且大于单文件上限；没有收入任何 `.so`。
- **八岐大蛇原 Android 构建载体**：现存脚本从已验收 LAN 整份 SWF 转公网，原生成/改写源缺失。未收整份载体；只收最终逐方法文本与转换脚本。所收文本不能证明可完整重建类/字段/traits。
- **超限台座美术输入**：Python 生成算法已收；依赖的 AI PNG、输出 PNG/AMF 图集按本次仅收文本规则未收。这是素材缺口，不把有算法源码的补丁冒称为只有二进制。

## 待核实

共 **6 项调查问题**；前 2 项涉及收录/生效边界，后 4 项是重建或首发信息缺口。它们不混入正式补丁表：

1. **原生 StartupCache 在 wt 测试包中的有效性**：`startup-cache/native/cn/startpoint/StartupCache.java:16-20` 只允许 `com.leiting.wf`，v17/v33 DEX相同且测试包为 `com.leiting.wt`；历史覆盖安装实测未清缓存。不能把原仓库登记的缓存刷新功能算成 v33 已有效功能。未收为正式补丁；运行期十分钟缓存计划也不能仅凭登记认定在此包生效。
2. **幻想装备准备页门禁**：模块存在，但最终 v33 `BattleStartableLogic/isPartyStartable` 未显示该模块的采用差分；不据源文件存在认定有效。其它已核实的深渊装备门控按自己的精确方法收录。
3. **Boss 完整 Android 原改写源与精确独立重建集合**：实际 helper 及机制存在；原目录已失，现存转换器不是原实现。相关 owner 和直接 hook 已收可读 P-code，所有配套字段/traits 的从零构建链仍未核实。
4. **官方底包 → v17 累计载体的完整应用链**：已有许多模块源码和累计验收清单，但缺少完整、无断点的单一构建记录；SDK dummy 原生成器和 R8 原重写器缺失，不能把现有预构建 SWF 当源码。
5. **部分早期补丁的首发 APK 编号**：可以证明 v17 已有且最终保留，但具体更早编号没有对应记录；资源版本、日期和 R8/R9/R10 阶段号不替代 APK v编号。
6. **x86 E2 十二个兼容桩的完整原编译命令**：最终 ELF 的源文件名与所收 C 源相符、十五库均与 E3 缓存同字节；缺少全部 E2 编译参数/组织脚本，未验证从文本精确重建。计划中的 `stub_logged.c` 没有进入实际最终包，未收。

## 已规划未构建

- O5 零核调整：超限突破不再消耗悖论之核，尚未构建。当前 v33 已采用的 O5 双道具限制见正式补丁 101。
- 凉月觉醒入口：仅列计划，不计为补丁。
- O8 超限台座：仅列计划，不计为补丁；不得将已构建的 O6/O7 与图集算法直接改名为 O8。

## 已排除的历史实现

- v24 `battle-score-x0.01`；普通多段直击通用静音；旧“所有角色 N≥4 合并”范围。最终 v25 起仅保留凯尔队长限定。
- v9 九尾技能按 PF 伤害、校园希尔媞旧专属能力伤害、七角色固定槽随机语音，以及正式 R10 已剥离的 LoadingTrace。
- 旧排行榜 P1/P2 界面、独立 Seris 九处形态扩展、Fever B4、旧 `thunder_small`/`paralysis_ball` 与最初懒加载 SE 方案。
- 救援铃铛超级+内置 Flatomo 480B/11组排版（实包仍466B/10组）；C8016 v3 的八方法条件预载（实包为七方法、无条件六项预载）；十分钟 native 缓存清理对 wt 包名守卫不生效。这些 LAN 登记项未当最终测试包采用。
- E0/E2 中间探针、未采用的 logged native 桩、升 versionCode 实验、已撤回的服务端乱序方案及未构建 coop2。
- 狮子 A3 点火等纯角色表/服务端内容，不作为客户端 APK 代码补丁。

## 单文件超过 500KB 的未收内容

- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 最终 boot_ffc6:AbilityValues$/parseAt47 的完整 P-code 文本为 848,725 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 最终 boot_ffc6:InstantAbilitySource$/resolveInstantContent 的完整 P-code 文本为 1,580,144 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 历史整类 AS `DuringAbilitySource` 约 915,076 B，未收；已收对应小型 P-code 生成脚本。所有 APK、SWF/ABC、.so 等即使小于 500KB 也按类型禁收。

## 复核入口

- [SOURCES.md](SOURCES.md)：逐条结论的原始文件路径、行号/段落及最终方法哈希。
- [MANIFEST.json](MANIFEST.json)：每份实际源副本的路径、大小、原 SHA 与副本 SHA；如有实际准入常量省略则标记。
- [_checks/README.md](_checks/README.md)：本次只读核验记录；不含 APK、SWF、ABC、PNG 或签名载荷。

## 公开发布说明

- 测试服公网地址与局域网地址在下列文本中已替换为 `TEST-SERVER-HOST` / `LAN-HOST`,这些文件的哈希因此与 MANIFEST.json 记录的原始副本不同,其余文件未改动。重建时把占位符换回实际地址即可。
- 准入密钥、keystore、签名材料、APK、`.so`、整份 SWF/ABC 均未收录。
- 08-ability-summary-description-cache/source/build.py
- 14-account-takeover-entry/source/build_apk.py
- 16-available-ability-description-cache/source/build.py
- 19-client-admission/pcode/cn.admission.ClientAdmission--anonymous-method-27.pcode.txt
- 19-client-admission/pcode/cn.admission.ClientAdmission--anonymous-method-31.pcode.txt
- 19-client-admission/pcode/cn.admission.ClientAdmission--ClientAdmission__beforeQueue.pcode.txt
- 19-client-admission/pcode/cn.admission.ClientAdmission--ClientAdmission__load.pcode.txt
- 19-client-admission/pcode/cn.admission.ClientAdmission--ClientAdmission__refreshSession.pcode.txt
- 19-client-admission/pcode/cn.admission.ClientAdmission--ClientAdmission__transport.pcode.txt
- 19-client-admission/source/build.py
- 37-orochi-boss-runtime/source/build_public_android.py
- 39-party-derived-cache/source/build.py
- 41-player-login/source/build.py
- 42-private-server-route/pcode/boot_ffc6--DevConfig_gf_android__ctor_.pcode.txt
- 42-private-server-route/source/build_self_profile_public_apk.py
- 43-profile-follow-visibility/source/build_profile_follow_lan_rootfix_apk.py
- 51-title-cntips-hide/source/build_title_cntips_apk.py
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--anonymous-method-27.pcode.txt
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--anonymous-method-31.pcode.txt
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--ClientAdmission__beforeQueue.pcode.txt
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--ClientAdmission__load.pcode.txt
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--ClientAdmission__refreshSession.pcode.txt
- 52-testserver-v17-identity/pcode/cn.admission.ClientAdmission--ClientAdmission__transport.pcode.txt
- _build-support/coop-tools/patch_local_endpoints.py
- _checks/early_actual_checks.json
