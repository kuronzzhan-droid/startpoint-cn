# 主线boss缺专属boss战盘点（本地 1.4.131）

数据来源：本地服 8001 实际下发的客户端数据（.cdn 1.4.54 基线 + active 补丁链到 1.4.131，全量物化后读表）。
对比范围：主线 main_quest + 主线EX ex_quest 的关卡boss位，对照领主战/降临讨伐(boss_battle_quest)、advent_event_quest、raid_event_quest、hard_multi_event_quest、world_story_event_boss_battle_quest 里出现过的boss。自制五重决战借用的不算“已有”。

## 结论

- 剧情专属boss（有名字/专属模型）共 42 个；**完全没有boss战关卡的 26 个**，另有 6 个只有同族或同名的其他型号，10 个已有同模型boss战。
- 上面 26 个的敌人数据（general_boss / standard_boss 行、boss_level 行）和战斗资源（模型/图集/影子/动作DSL/地形）在本地CDN里**全部齐全**，没有缺件。
- 唯一要留意的共用件：像素小人类boss（16点阵）都引用 `battle/boss/general_16dots/common/general_16dots_shadow`，这个文件CDN里查不到，但主线这些关卡本来就在引用它。试点时会用一只像素小人boss真机确认不崩。
- 另有 56 个“通用魔物”型关卡boss（巨蜥、镰鼬这类按元素换色的怪），数据也都齐，清单放在文末附录，默认不算剧情boss。

## A. 没有任何boss战关卡（26）

| 章 | boss | 代号 | 类型 | 主线关卡 | 敌人数据 | 资源 |
|---|---|---|---|---|---|---|
| 2 | 白虎兽人 | `shiro` | GeneralBoss | 白色咆哮 | 有/有level | 可直接用 |
| 3 | 人鱼老人 | `mermaid_oldman` | GeneralBoss | 真的没吃 | 有/有level | 可直接用 |
| 4 | 克劳斯 | `wolf_assassin` | GeneralBoss | 守护年轻人的梦想 | 有/有level | 可直接用 |
| 5 | 自动贩卖机 | `mob_ticket_counter` | GeneralBoss | 史黛拉防卫 | 有/有level | 可直接用 |
| 5 | 雷克·雷吉斯塔 | `rec_android_boss_single` | GeneralBoss | 雷克·雷吉斯塔 | 有/有level | 可直接用 |
| 6 | 玉藻・稻穗 | `boss_fox_oracle` | GeneralBoss | 妨碍恋情 | 有/有level | 可直接用 |
| 6 | 五行・水善 | `boss_onmyoji_boy` | GeneralBoss | 水善战 | 有/有level | 可直接用 |
| 7 | 伊尔比斯 | `devil_commander` | GeneralBoss | 魔族袭来 | 有/有level | 可直接用 |
| 7 | 诅咒伊尔比斯 (只在自制五重里借用过) | `devil_commander_evil` | GeneralBoss | 伊尔比斯的毒牙 | 有/有level | 可直接用 |
| 7 | 魔族男性 | `devil_leader` | GeneralBoss | 看不见的身份、魔族男性 | 有/有level | 可直接用 |
| 7 | 红发老战士 | `flame_witch` | GeneralBoss | 炎血魔女战 | 有/有level | 可直接用 |
| 7 | 精灵守护像 | `light_guardian_single` | GeneralBoss | 精灵守护像 | 有/有level | 可直接用 |
| 7 | 魔王 | `maou2` | GeneralBoss | 不速之客 | 有/有level | 可直接用 |
| 8 | 史黛拉 | `stella_copy_boss_single` | GeneralBoss | 另一个史黛拉 | 有/有level | 可直接用 |
| 9 | 歼灭者 | `epuration_boss_another_single` | GeneralBoss | 再战歼灭者、歼灭者捕获作战、突入 | 有/有level | 可直接用 |
| 9 | 歼灭者 | `epuration_boss_single` | GeneralBoss | 歼灭者 | 有/有level | 可直接用 |
| 9 | 歼灭者 | `high_epuration_boss_single` | GeneralBoss | 上位歼灭者个体、星之骑士们、歼灭者上位个体 | 有/有level | 可直接用 |
| 10 | 形似弁天的魔物 | `benzaiten` | GeneralBoss | 扭曲的水神 | 有/有level | 可直接用 |
| 10 | 异形歼灭者 | `epuration_boss_variant_ver_single` | GeneralBoss | 异形剑 | 有/有level | 可直接用 |
| 10 | 影丘龙一 | `psychic_projection` | GeneralBoss | 龙与言灵 | 有/有level | 可直接用 |
| 10 | 伊野里翔太 | `psychic_shouta` | GeneralBoss | 伊野里翔太 | 有/有level | 可直接用 |
| 10 | 伊野里翔太 | `psychic_shouta_sequel` | GeneralBoss | 步与翔太 | 有/有level | 可直接用 |
| 10 | 绯河凛音 | `psychic_tomboygirl` | GeneralBoss | 龙与言灵 | 有/有level | 可直接用 |
| 11 | 吞噬星辰之物(名称取自关卡名) | `epuration_boss_dragon_main` | StandardBoss(esdl) | 吞噬星辰之物 | 有/esdl无需level | 可直接用 |
| 12 | 终始之龙 | `chapter12_boss_story` | StandardBoss(esdl) | 终始之龙 | 有/esdl无需level | 可直接用 |
| 12 | 咒剑关卡boss(名称按代号推断) | `epuration_boss_highest_main` | StandardBoss(esdl) | 咒剑 | 有/esdl无需level | 可直接用 |

## B. 只有同族/同名的其他型号（6）

| 章 | boss | 代号 | 现有的是 |
|---|---|---|---|
| 3 | 北海巨妖 | `kraken_single` | boss_battle_quest:1009001 潮汐巨妖 ::quest_rank:: |
| 5 | 管理者 | `admin_human` | boss_battle_quest:1017001 管理者 ::quest_rank:: |
| 6 | 八头古神(八岐大蛇全头形态) | `orochi_all_head_single` | boss_battle_quest:1020001 八岐大蛇 ::quest_rank:: |
| 8 | 诅咒图腾 | `guardian_totem_another` | boss_battle_quest:1005001 废墟守卫 ::quest_rank:: |
| 10 | 始龙之眼 | `eye_dragon_boss` | advent_event_quest:100010001 (None) |
| 12 | 始龙之眼 | `eye_dragon_boss_ch12` | advent_event_quest:100010001 (None) |

## C. 已有同模型boss战（10，不用做）

不死王瑞西塔尔(`lich_wind_single`), 废墟魔像(`guardian_golem_fire_single`), 诅咒弧魔艾基尔(`arch_evil_single`), 寄居蟹船长(`hermit_crab_water_single`), 白虎(`white_tiger_ghost_thunder_single`), 管理者(`administrator_light_single`), 诅咒弧魔艾基尔形态一(`arch_evil_tripple_single_a`), 诅咒弧魔艾基尔形态二(`arch_evil_tripple_single_b`), 诅咒弧魔艾基尔形态三(`arch_evil_tripple_single_c`), 艾基尔·嫉妒(`devil_commander_evil_envy`)

## 附录：通用魔物型关卡boss（56）

| 章 | 怪 | 代号 | 现有boss战 |
|---|---|---|---|
| 1 | 费戈・索拉斯等 | `owl_single` | 仅同族其他型号 |
| 1 | 火灵等 | `spirit` | 无 |
| 1 | 火焰树妖等 | `treant_single` | 仅同族其他型号 |
| 2 | 机枪魔块·火等 | `cube` | 无 |
| 2 | 红皮独眼巨魔等 | `cyclops` | 无 |
| 2 | 沙漠士兵等 | `desert_soldier` | 无 |
| 2 | 废墟守卫·火等 | `guardian_totem_single` | 仅同族其他型号 |
| 3 | 红色海妖等 | `clione` | 无 |
| 3 | 恶魔之卵・红等 | `curse_eye` | 无 |
| 3 | 灼热虎鲸等 | `killer_whale` | 无 |
| 3 | 灼热八爪盔等 | `oct_helm` | 无 |
| 3 | 火之海盗等 | `pirates_big` | 无 |
| 3 | 恶行海盗等 | `pirates_enemy` | 无 |
| 3 | 海盗船长火焰等 | `pirates_enemy_captain` | 无 |
| 3 | 炽热先锋等 | `turtle_striker` | 无 |
| 4 | 炎将獠牙骑士等 | `boar_rider_single` | 仅同族其他型号 |
| 4 | 红蝮蛇等 | `cobra` | 无 |
| 4 | 红毛狂奔地鼠等 | `desert_diver` | 无 |
| 4 | 见习兵等 | `dog_soldier` | 无 |
| 4 | 火斧蛮族等 | `dog_tribe` | 无 |
| 4 | 红枪一等兵等 | `dog_tribe_soldier` | 无 |
| 4 | 帕拉鼠·蹦等 | `paralysis_hedgehog` | 无 |
| 4 | 废墟幽灵·火等 | `ruins_ghost` | 无 |
| 4 | 红波露公爵等 | `slango` | 无 |
| 4 | 火枪近卫兵等 | `wolf_soldier` | 无 |
| 5 | LIMBA-Fi等 | `bug1` | 无 |
| 5 | iBOW-Fi等 | `bug2` | 无 |
| 5 | Sec-5200Fi等 | `security_armour_single` | 仅同族其他型号 |
| 5 | Sec-2600Fi等 | `security_robot` | 无 |
| 5 | Sec-3000Fi等 | `security_robot_large` | 无 |
| 6 | 绯色中忍等 | `chunin` | 无 |
| 6 | 红之下忍等 | `genin` | 无 |
| 6 | 焰狐等 | `ghost_fox_single` | 仅同族其他型号 |
| 6 | 火灵幽魂等 | `ghost_girl` | 无 |
| 6 | 哈宁红Z等 | `haniwa` | 无 |
| 6 | 红色山童等 | `low_level_ghost` | 无 |
| 6 | 灼热大入道等 | `middle_level_ghost` | 无 |
| 6 | 灼热大鬼等 | `oni` | 无 |
| 7 | 火焰兽人领主等 | `enemy_orc` | 无 |
| 7 | 火焰大蝙蝠等 | `enemy_snowbat` | 无 |
| 7 | 火焰阿玛斯等 | `enemy_snowgiant` | 无 |
| 7 | 火焰魅影等 | `enemy_snowspirit` | 无 |
| 7 | 火焰灵魄等 | `enemy_snowwisp` | 无 |
| 7 | 火焰楹树精等 | `wooden_dummy` | 无 |
| 8 | 焰唆诅咒魔蛛等 | `enemy_demonspider` | 无 |
| 8 | 魔族匪徒等 | `enemy_devil_rascal` | 无 |
| 8 | 魔族战士等 | `enemy_devil_soldier` | 无 |
| 8 | 焰唆诅咒魔将等 | `enemy_evilgiant` | 无 |
| 8 | 焰唆诅咒悲魔等 | `enemy_eviltower` | 无 |
| 8 | 厄运艾基尔・火等 | `evil_weak` | 无 |
| 8 | 丑王奥格等 | `maou_org` | 无 |
| 9 | 燃烧狂熊等 | `big_bear_monster` | 无 |
| 9 | 火刃镰鼬等 | `fox` | 无 |
| 9 | 灼热哈比等 | `harpy` | 无 |
| 9 | 火巨蜥等 | `land_dragon` | 无 |
| 9 | 灼烧恶魔拉比等 | `one_eyed_rabbit` | 无 |

完整字段（缺失明细、所有出处关卡）见同目录 `主线boss盘点.csv`。