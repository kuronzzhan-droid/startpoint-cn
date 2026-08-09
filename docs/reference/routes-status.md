# API Endpoints
> 状态: 端点实现状态总表   关键文件: src/routes/   相关端点: 见表
> [!WARNING]
> This list may be incomplete and/or outdated. Check for any open pull requests or branches to make any final calls.

> [!WARNING]
> This is not a definitive list of every API endpoint that the game client interacts with.

Symbol | Meaning
:------- | :-------
:white_check_mark: | Complete
:warning: | Partial
:construction: | In Progress
:no_entry: | Incomplete & Not Being Worked On

### ``na.wdfp.kakaogames.com/latest/api/index.php``
Endpoint | Status
:------- | :-------
[/active_mission/receive](../routes/active_mission_receive.md) | :white_check_mark:
[/asset/get_path](../routes/asset_get_path.md) | :warning:
[/asset/version_info](../routes/asset_version_info.md) | :warning:
[/attention/check](../routes/attention_check.md) | :white_check_mark:
[/bonus/shown](../routes/bonus_shown.md) | :no_entry:
``/box_gacha/close`` | :white_check_mark:
[/box_gacha/exec](../routes/box_gacha_exec.md) | :warning:
[/box_gacha/get_box_list](../routes/box_gacha_get_box_list.md) | :white_check_mark:
[/character/add_character_from_town](../routes/character_add_character_from_town.md) | :no_entry:
[/character/learn_mana_node](../routes/character_learn_mana_node.md) | :white_check_mark:
[/character/open_mana_board](../routes/character_open_mana_board.md) | :white_check_mark:
[/character/over_limit](../routes/character_over_limit.md) | :white_check_mark:
[/character/receive_bond_token](../routes/character_receive_bond_token.md) | :white_check_mark:
[/character/set_illustration_settings](../routes/character_set_illustration_settings.md) | :white_check_mark:
[/encyclopedia/index](../routes/encyclopedia_index.md) | :white_check_mark:
[/encyclopedia/read_keyword](../routes/encyclopedia_read_keyword.md) | :white_check_mark:
[/equipment/set_protection](../routes/equipment_set_protection.md) | :white_check_mark:
[/equipment/sell_equipment](../routes/equipment_sell_equipment.md) | :white_check_mark:
[/equipment/sell_stack](../routes/equipment_sell_stack.md) | :white_check_mark:
[/equipment/bulk_sell_stack](../routes/equipment_bulk_sell_stack.md) | :white_check_mark:
[/equipment/bulk_upgrade](../routes/equipment_bulk_upgrade.md) | :white_check_mark:
[/equipment/upgrade](../routes/equipment_upgrade.md) | :white_check_mark:
``/event/rush/summary`` | :white_check_mark:
``/event/rush/select_folder`` | :white_check_mark:
``/event/rush/ranking`` | :white_check_mark:
``/event/rush/ranking/played_party`` | :white_check_mark:
``/event/rush/aggregated_time`` | :white_check_mark:
``/event/rush/party`` | :white_check_mark:
``/event/rush/battle/start`` | :white_check_mark:
``/event/rush/reset`` | :white_check_mark:
[/ex_boost/draw](../routes/ex_boost_draw.md) | :white_check_mark:
[/ex_boost/first_draw](../routes/ex_boost_first_draw.md) | :white_check_mark:
[/ex_boost/select](../routes/ex_boost_select.md) | :white_check_mark:
[/expod/inject_exp](../routes/expod_inject_exp.md) | :white_check_mark:
[/expod/stack_to_exp](../routes/expod_stack_to_exp.md) | :white_check_mark:
[/expod/bulk_stack_to_exp](../routes/expod_bulk_stack_to_exp.md) | :white_check_mark:
[/follow/lists](../routes/follow_lists.md) | :no_entry:
[/gacha/exchange_character](../routes/gacha_exchange_character.md) | :white_check_mark:
``/gacha/exchange_equipment`` | :white_check_mark:
[/gacha/exec](../routes/gacha_exec.md) | :warning:
[/history/receive](../routes/history_receive.md) | :no_entry:
[/how_to_get/get_list](../routes/how_to_get_get_list.md) | :no_entry:
[/load](../routes/load.md) | :white_check_mark:
[/lounge/get_list](../routes/lounge_get_list.md) | :no_entry:
[/mail/index](../routes/mail_index.md) | :warning:
[/mail/receive](../routes/mail_receive.md) | :no_entry:
[/mail/receive_all](../routes/mail_receive_all.md) | :no_entry:
[/mission/get_mission_progress](../routes/mission_get_mission_progress.md) | :white_check_mark:
[/mission/update_mission_progress](../routes/mission_update_mission_progress.md) | :warning:
[/active_mission/receive](../routes/active_mission_receive.md) | :white_check_mark:
<!-- mission: server-side compute for 5 cat + auto-reward (active & awake); awake reward format resolved (base=9, 1 slot) -->
[/multi_battle_quest/abort](../routes/multi_battle_quest_abort.md) | :no_entry:
[/multi_battle_quest/create_room](../routes/multi_battle_quest_create_room.md) | :no_entry:
[/multi_battle_quest/disband_room](../routes/multi_battle_quest_disband_room.md) | :no_entry:
[/multi_battle_quest/finish](../routes/multi_battle_quest_finish.md) | :no_entry:
[/multi_battle_quest/get_rooms](../routes/multi_battle_quest_get_rooms.md) | :no_entry:
[/multi_battle_quest/prepare](../routes/multi_battle_quest_prepare.md) | :no_entry:
[/multi_battle_quest/select_room](../routes/multi_battle_quest_select_room.md) | :no_entry:
[/multi_battle_quest/share_room](../routes/multi_battle_quest_share_room.md) | :no_entry:
[/multi_battle_quest/start](../routes/multi_battle_quest_start.md) | :no_entry:
[/multi_battle_quest/summon](../routes/multi_battle_quest_summon.md) | :no_entry:
[/multi_special_exchange/exchange_character](../routes/multi_special_exchange_exchange_character.md) | :no_entry:
[/multi_special_exchange/single_draw_ticket](../routes/multi_special_exchange_single_draw_ticket.md) | :no_entry:
[/option/update](../routes/option_update.md) | :white_check_mark:
[/option/update_in_battle](../routes/option_update_in_battle.md) | :white_check_mark:
[/party/edit](../routes/party_edit.md) | :white_check_mark:
[/party_group/edit](../routes/party_group_edit.md) | :white_check_mark:
[/payment/item_list](../routes/payment_item_list.md) | :white_check_mark:
[/profile/get_my_profile](../routes/profile_get_my_profile.md) | :no_entry:
[/profile/get_degree_list](../routes/profile_get_degree_list.md) | :white_check_mark:
[/profile/update_degree](../routes/profile_update_degree.md) | :white_check_mark:
``/ranking_event/get_summary`` | :white_check_mark:
``/ranking_event/receive_reward`` | :white_check_mark:
[/reproduce/post](../routes/reproduce_post.md) | :white_check_mark:
[/shop/buy](../routes/shop_buy.md) | :white_check_mark:
[/shop/get_sales_list](../routes/shop_get_sales_list.md) | :warning:
``/shop/recover_stamina`` | :white_check_mark:
[/single_battle_quest/abort](../routes/single_battle_quest_abort.md) | :white_check_mark:
[/single_battle_quest/finish](../routes/single_battle_quest_finish.md) | :white_check_mark:
[/single_battle_quest/play_continue](../routes/single_battle_quest_play_continue.md) | :white_check_mark:
[/single_battle_quest/start](../routes/single_battle_quest_start.md) | :white_check_mark:
[/sns/get](../routes/sns_get.md) | :no_entry:
[/story_quest/finish](../routes/story_quest_finish.md) | :white_check_mark:
[/tool/get_header_response](../routes/tool_get_header_response.md) | :white_check_mark:
[/tool/signup](../routes/tool_signup.md) | :white_check_mark:
[/tutorial/finish_trigger](../routes/tutorial_finish_trigger.md) | :white_check_mark:
[/tutorial/update_step](../routes/tutorial_update_step.md) | :white_check_mark:

### ``openapi-zinny3.game.kakao.com/service``
Endpoint | Status
:------- | :-------
[/v2/appGroup](../routes/v2_appGroup.md) | :white_check_mark:
[/v2/app](../routes/v2_app.md) | :warning:

## 游戏服务路由族

| 路由族 | 状态 | 当前边界 | 注册或源码入口 | Current 文档 |
|---|---|---|---|---|
| 账号与认证 | **Partial** | 设备绑定、账号、会话和存档选择已实现；雷霆登录、防沉迷及部分平台响应属于兼容实现，不是真实 OAuth 或官方账号服务 | `src/routes/cn/leitingAuth.ts`、`src/routes/openapi.ts`、`src/data/domains/account.ts`、`src/data/domains/session.ts` | [存档与输入校验](../systems/save-validation.md) |
| `load` | **Partial** | 可以校验会话并序列化玩家主要领域；新增领域仍需同步 load、导入导出和恢复契约 | `src/routes/cn/load.ts`、`src/data/utils.ts` | [当前架构](../architecture.md)、[存档与输入校验](../systems/save-validation.md) |
| Asset 与 CDN | **Partial** | `local`、`remote`、`client-owned` 三种资源模式及版本、路径、Range 下载已接线；完整客户端断点续传和部署组合仍需专项验收 | `src/routes/cn/asset-provider.ts`、`src/routes/cn/asset.ts`、`src/routes/cn/cdnFiles.ts` | [CDN 与内容](../cdn/README.md) |
| 角色与装备养成 | **Partial** | 角色获取、玛纳板、羁绊、分解、装备强化与保护等主流程广泛实现；完整角色、装备和异常回滚矩阵尚未建立 | `src/routes/api/character.ts`、`src/routes/api/character/`、`src/routes/api/equipment.ts`、`src/routes/api/sell.ts`、`src/routes/api/exBoost.ts` | [角色分解审计](../systems/character-stack-audit.md)、[装备强化审计](../systems/equipment-upgrade-audit.md) |
| 选项与编队 | **Complete** | 当前客户端使用的选项更新、普通编队和编队组编辑路由已接入持久状态；状态只代表服务端当前支持边界 | `src/routes/api/option.ts`、`src/routes/api/party.ts`、`src/routes/api/partyGroup.ts` | [当前架构](../architecture.md) |
| 抽卡 | **Partial** | 核心角色与装备抽取、票券、兑换和权重已实现；特殊卡池、费用、保底与部分动画仍不完整 | `src/routes/api/gacha.ts`、`src/lib/gacha*.ts` | [扭蛋赔率修复](../systems/gacha-odds-fix.md)、[卡池生成](../protocol/gacha-pool-generation.md) |
| 普通关卡 | **Partial** | 单人 start、finish、abort、续关、体力、门票、奖励和进度已有主流程；finish 的整体事务与分类覆盖仍不完整 | `src/routes/api/singleBattleQuest.ts`、`src/routes/api/storyQuest.ts`、`src/lib/quest/` | [关卡入场道具](../systems/quest-entry-items.md)、[体力](../systems/stamina.md) |
| 任务 | **Partial** | 普通/每日/每周、收集、507 条权威称号、活动协力与累计物品首批规则、Pass 三分类与等级奖励、Active Mission 动态定义/可用性/安全领奖核心及 Contents Guide 首任务生产链、角色觉醒核心时序已有实现；复杂活动谓词、Active Mission 其余 95 条业务事实生产者、其余称号与 Pass 少量 pattern 尚未完成 | `src/routes/api/mission.ts`、`src/routes/api/passCard.ts`、`src/routes/api/activeMission.ts`、`src/routes/api/contentsGuide.ts`、`src/lib/mission/` | [任务完成度审计](../systems/mission-completion-audit.md)、[Active Mission](../systems/active-mission.md)、[修行之道](../systems/pass-card.md) |
| 邮件 | **Partial** | 列表、单领、全领和后台定向发送已经实现；任务与单人/多人结算已动态返回 `mail_arrived`，其他普通业务响应尚未全部统一 | `src/routes/api/mail.ts`、`src/routes/web_api/mail.ts`、`src/data/domains/mail.ts` | [邮件](../systems/mail.md) |
| 商店与兑换 | **Partial** | 普通商店、星之粒、活动兑换及部分特殊兑换已有实现；数据来源、组合奖励和活动期覆盖仍按各系统边界处理 | `src/routes/api/shop.ts`、`src/routes/api/exchange.ts`、`src/data/domains/shopPurchase.ts` | [商店](../systems/shop.md) |
| 活动 | **Partial** | 土俑、狂热激战、无限演武、战阵、歼灭者和活动扭蛋箱完成度不同；不得用单一活动代表整个路由族 | `src/routes/api/carnivalEvent.ts`、`src/routes/api/rushEvent.ts`、`src/routes/api/raidEvent.ts`、`src/routes/api/rankingEvent.ts`、`src/routes/api/boxGacha.ts` | [特殊关卡架构](../systems/special-quest-architecture.md)、[支持矩阵](../status/support-matrix.md) |
| 多人联机 | **Partial** | NPC 房主的建房、招募、准备、开始和结算基础流程可用；真人匹配、双客户端完整验收和多场景战斗缺失 | `src/multi/http/`、`src/multi/tcp/`、`src/multi/room/`、`src/multi/state/` | [多人联机协议](../protocol/multi-battle.md) |
| 教程、工具与外围兼容 | **Stub** | 一部分路由有真实持久状态，另一部分仅返回维持 CN 客户端启动或菜单流程所需的空响应；必须逐注册源码确认 | `src/routes/api/tutorial.ts`、`src/routes/api/tool.ts`、`src/cn-server.ts` | [当前架构](../architecture.md)、[已知问题](../status/known-issues.md) |
| 礼包码兑换 | **Missing** | 客户端入口可以显示，但没有真实礼包码校验、次数限制、奖励配置与持久化 | `src/cn-server.ts` | [已知问题](../status/known-issues.md) |

## 管理端路由族

| 路由族 | 状态 | 当前边界 | 注册或源码入口 | Current 文档 |
|---|---|---|---|---|
| 旧管理页面 | **Partial** | `/`、`/player`、`/mail`、`/seeds` 继续作为兼容界面；不再扩展为新功能主入口 | `src/routes/web/`、`web/pages/` | [管理后台](../admin/README.md) |
| 管理 Web API | **Partial** | 玩家、存档、邮件、查询、服务状态和抽卡种子接口已接入；破坏性操作和完整浏览器矩阵尚未验收 | `src/routes/web_api/` | [管理后台](../admin/README.md) |
| React 管理后台 | **Partial** | `/admin/` 可挂载可选 Vite 构建产物；页面功能、响应式设备和真实操作仍处于人工验收阶段 | `admin/`、`web/dist/`、`src/cn-server.ts` | [管理后台](../admin/README.md) |

## 使用规则

1. 先从本矩阵确定业务路由族和 current 文档。
2. 再检查 `src/cn-server.ts` 及对应插件是否实际注册目标路径。
3. 读取处理函数、领域模块和相关测试，确认请求字段、持久状态、事务与错误路径。
4. 协议字段优先核对 CN 1.8.1 反编译代码；需要网络证据时仅使用本地自备且已脱敏的抓包。
5. 客户端是否通过，以[全项目测试进度](../status/test-progress.md)为准，不由本矩阵代替。
