import { Database } from "better-sqlite3";

/**
 * 这张表上有没有这一列。
 *
 * 加列的**唯一**正确姿势:`CREATE TABLE IF NOT EXISTS` 见到已存在的表会整段跳过,
 * 所以往 DDL 里加一列只对**全新库**生效;老库(作者本机那一份)必须另走
 * `ALTER TABLE … ADD COLUMN`。本文件早年的迁移用的是 try/catch 吞
 * `duplicate column name`,能跑但每次启动都白抛一次异常、也吞掉了真正的错误。
 * 新增迁移一律先查 pragma。
 *
 * @param database 数据库句柄。
 * @param table 表名(调用方写死字面量,不接受外部输入)。
 * @param column 列名。
 * @returns 列已存在则 true。
 */
function hasColumn(database: Database, table: string, column: string): boolean {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return columns.some(entry => entry.name === column)
}


export default function init(
    database: Database,
    exists: Boolean
) {
    // initialize the database

    // create players table
    database.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        first_login_time DATE NOT NULL,
        idp_alias TEXT NOT NULL,
        idp_code TEXT NOT NULL,
        idp_id TEXT NOT NULL,
        reg_time DATE NOT NULL,
        last_login_time DATE NOT NULL,
        status TEXT NOT NULL,
        username TEXT UNIQUE,
        password_hash TEXT
    )`).run()

    // create zat session table
    database.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY NOT NULL,
        account_id INTEGER NOT NULL,
        expires DATE NOT NULL,
        type INTEGER NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run()

    // create players table
    database.prepare(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stamina INTEGER NOT NULL,
        stamina_heal_time INTEGER NOT NULL,
        boost_point INTEGER NOT NULL,
        boss_boost_point INTEGER NOT NULL,
        transition_state INTEGER NOT NULL,
        role INTEGER NOT NULL,
        name TEXT NOT NULL,
        last_login_time DATE NOT NULL,
        comment TEXT NOT NULL,
        vmoney INTEGER NOT NULL,
        free_vmoney INTEGER NOT NULL,
        rank_point INTEGER NOT NULL,
        star_crumb INTEGER NOT NULL,
        bond_token INTEGER NOT NULL,
        exp_pool INTEGER NOT NULL,
        exp_pooled_time INTEGER NOT NULL,
        leader_character_id INTEGER NOT NULL,
        party_slot INTEGER NOT NULL,
        degree_id INTEGER NOT NULL,
        birth INTEGER NOT NULL,
        free_mana INTEGER NOT NULL,
        paid_mana INTEGER NOT NULL,
        enable_auto_3x INTEGER NOT NULL,
        total_stamina_used INTEGER NOT NULL DEFAULT 0,
        total_powerflips INTEGER NOT NULL DEFAULT 0,
        total_dashes INTEGER NOT NULL DEFAULT 0,
        total_mana_obtained INTEGER NOT NULL DEFAULT 0,
        max_combo_achieved INTEGER NOT NULL DEFAULT 0,
        total_login_days INTEGER NOT NULL DEFAULT 0,
        account_id INTEGER NOT NULL,
        tutorial_step INTEGER,
        tutorial_skip_flag INTEGER,
        tutorial_gacha_character_id INTEGER DEFAULT NULL,
        time_offset INTEGER DEFAULT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run();

    // migration: add tutorial_gacha_character_id to existing tables
    try { database.prepare(`ALTER TABLE players ADD COLUMN tutorial_gacha_character_id INTEGER DEFAULT NULL`).run(); } catch { /* column already exists */ }

    // migration: add total_stamina_used for mission progress tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_stamina_used INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add powerflip/dash counters for mission progress
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_powerflips INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_dashes INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add total_mana_obtained for mission progress tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_mana_obtained INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: max_combo_achieved was added to CREATE TABLE only — existing DBs need this ALTER
    try { database.prepare(`ALTER TABLE players ADD COLUMN max_combo_achieved INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_character_quest_clears (
        player_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        clear_count INTEGER NOT NULL DEFAULT 0,
        multi_count INTEGER NOT NULL DEFAULT 0,
        leader_clear_count INTEGER NOT NULL DEFAULT 0,
        leader_multi_count INTEGER NOT NULL DEFAULT 0,
        leader_power_flip_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, character_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    // migration: add leader_clear_count for leader-specific awakening missions
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_clear_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_multi_count for co-op leader tracking
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_multi_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_character_id to quest_progress for quest-clear leader validation
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN leader_character_id INTEGER`).run(); } catch { /* column already exists */ }

    // migration: add multi_clear_count for event mission multi-battle tracking
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN multi_clear_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: unlocked was added to CREATE TABLE only — existing DBs need this ALTER (else /load SELECT fails)
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_power_flip_count for per-character powerflip missions
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_power_flip_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add total_login_days for weekly mission tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_login_days INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_member_co_clears (
        player_id INTEGER NOT NULL,
        char_id_a INTEGER NOT NULL,
        char_id_b INTEGER NOT NULL,
        co_clear_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, char_id_a, char_id_b),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_race_clears (
        player_id INTEGER NOT NULL,
        race_key TEXT NOT NULL,
        clear_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, race_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_periodic_snapshots (
        player_id INTEGER NOT NULL,
        period_type TEXT NOT NULL,
        quest_clears INTEGER NOT NULL DEFAULT 0,
        stamina_used INTEGER NOT NULL DEFAULT 0,
        rank_ss INTEGER NOT NULL DEFAULT 0,
        rank_s INTEGER NOT NULL DEFAULT 0,
        rank_a INTEGER NOT NULL DEFAULT 0,
        rank_b INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, period_type),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS device_bindings (
        device_id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        last_seen DATE NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run();

    // migration: device_bindings.name for admin panel identification
    try { database.prepare(`ALTER TABLE device_bindings ADD COLUMN name TEXT DEFAULT NULL`).run(); } catch { /* column already exists */ }

    // migration: add awake_level for character awakening system
    try { database.prepare(`ALTER TABLE players_characters_mana_nodes ADD COLUMN awake_level INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: ex_boost / illustration columns were added to CREATE TABLE only — existing DBs need these ALTERs
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN ex_boost_status_id INTEGER`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN ex_boost_ability_id_list TEXT`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN illustration_settings TEXT`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_options (
        key TEXT NOT NULL,
        value INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (key, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_triggered_tutorials (
        id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        reason_id INTEGER NOT NULL DEFAULT 0,
        subject TEXT,
        description TEXT,
        type INTEGER NOT NULL,
        type_id INTEGER,
        number INTEGER NOT NULL DEFAULT 1,
        receive_time TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
        create_time TEXT NOT NULL,
        reward_period_limited INTEGER NOT NULL DEFAULT 0,
        reward_limit_time TEXT,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_receive_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        type INTEGER NOT NULL,
        type_id INTEGER,
        number INTEGER NOT NULL DEFAULT 1,
        reason_id INTEGER NOT NULL DEFAULT 0,
        create_time TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_cleared_regular_missions (
        id INTEGER NOT NULL,
        value INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_items (
        id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_challenge_point_list_entries (
        id INTEGER NOT NULL,
        point INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_challenge_point_list_campaigns (
        campaign_id INTEGER NOT NULL,
        additional_point INTEGER NOT NULL,
        list_entry_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, campaign_id, list_entry_id),
        FOREIGN KEY (list_entry_id, player_id) REFERENCES daily_challenge_point_list_entries (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters (
        id INTEGER NOT NULL,
        entry_count INTEGER NOT NULL,
        evolution_level INTEGER NOT NULL,
        over_limit_step INTEGER NOT NULL,
        protection INTEGER NOT NULL,
        join_time DATE NOT NULL,
        update_time DATE NOT NULL,
        exp INTEGER NOT NULL,
        stack INTEGER NOT NULL,
        mana_board_index INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        ex_boost_status_id INTEGER,
        ex_boost_ability_id_list TEXT,
        illustration_settings TEXT,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters_bond_tokens (
        mana_board_index INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        PRIMARY KEY (mana_board_index, player_id, character_id),
        FOREIGN KEY (character_id, player_id) REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters_mana_nodes (
        value INTEGER NOT NULL,
        awake_level INTEGER NOT NULL DEFAULT 0,
        character_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (value, character_id, player_id),
        FOREIGN KEY (character_id, player_id) REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_groups (
        id INTEGER NOT NULL,
        color_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        PRIMARY KEY (id, player_id, category),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_parties (
        slot INTEGER NOT NULL,
        name TEXT NOT NULL,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_1 INTEGER,
        unison_character_2 INTEGER,
        unison_character_3 INTEGER,
        equipment_1 INTEGER,
        equipment_2 INTEGER,
        equipment_3 INTEGER,
        ability_soul_1 INTEGER,
        ability_soul_2 INTEGER,
        ability_soul_3 INTEGER,
        edited INTEGER NOT NULL,
        current_battle_power INTEGER NOT NULL DEFAULT 0,
        before_battle_power INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        PRIMARY KEY (slot, player_id, group_id, category),
        FOREIGN KEY (group_id, player_id, category) REFERENCES players_party_groups (id, player_id, category) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    // migration: add current_battle_power and before_battle_power to existing tables
    try { database.prepare(`ALTER TABLE players_parties ADD COLUMN current_battle_power INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_parties ADD COLUMN before_battle_power INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // database.prepare(`CREATE TABLE IF NOT EXISTS players_party_options (
    //     allow_other_players_to_heal_me INTEGER NOT NULL,
    //     slot INTEGER NOT NULL,
    //     player_id INTEGER NOT NULL,
    //     group_id INTEGER NOT NULL,
    //     category INTEGER NOT NULL,
    //     PRIMARY KEY (slot, player_id, group_id, category),
    //     FOREIGN KEY (slot, player_id, group_id, category) REFERENCES players_parties (slot, player_id, group_id, category) ON DELETE CASCADE,
    //     FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    // )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_equipment (
        id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        enhancement_level INTEGER NOT NULL,
        protection INTEGER NOT NULL,
        stack INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_quest_progress (
        section INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        finished INTEGER NOT NULL,
        unlocked INTEGER NOT NULL DEFAULT 0,
        high_score INTEGER,
        clear_rank INTEGER,
        best_elapsed_time_ms INTEGER,
        leader_character_id INTEGER,
        multi_clear_count INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (section, quest_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_gacha_info (
        gacha_id INTEGER NOT NULL,
        is_daily_first INTEGER NOT NULL,
        is_account_first INTEGER NOT NULL,
        gacha_exchange_point INTEGER,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (gacha_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_gacha_campaigns (
        gacha_id INTEGER NOT NULL,
        campaign_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (gacha_id, campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_drawn_quests (
        category_id INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        odds_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (category_id, quest_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_periodic_reward_points (
        id INTEGER NOT NULL,
        point INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_missions (
        id INTEGER NOT NULL,
        progress INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_missions_stages (
        id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        PRIMARY KEY (id, mission_id, player_id),
        FOREIGN KEY (mission_id, player_id) REFERENCES players_active_missions (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mission_counters (
        player_id INTEGER NOT NULL,
        counter_key TEXT NOT NULL,
        dimension TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        qualifier_json TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, counter_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mission_counter_snapshots (
        player_id INTEGER NOT NULL,
        period_type TEXT NOT NULL,
        counter_key TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, period_type, counter_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_box_gacha (
        id INTEGER NOT NULL,
        box_id INTEGER NOT NULL,
        reset_times INTEGER NOT NULL,
        remaining_number INTEGER NOT NULL,
        is_closed INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, box_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_box_gacha_drawn_rewards (
        id INTEGER NOT NULL,
        box_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, box_id, gacha_id, player_id),
        FOREIGN KEY (gacha_id, box_id, player_id) REFERENCES players_box_gacha (id, box_id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_start_dash_exchange_campaigns (
        campaign_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        term_index INTEGER NOT NULL,
        status INTEGER NOT NULL,
        period_start_time DATE NOT NULL,
        period_end_time DATE NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_multi_special_exchange_campaigns (
        campaign_id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        active_rush_battle_folder_id INTEGER,
        endless_battle_max_round INTEGER,
        endless_battle_max_round_time INTEGER,
        endless_battle_max_round_character_id_1 INTEGER,
        endless_battle_max_round_character_id_2 INTEGER,
        endless_battle_max_round_character_id_3 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_1 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_2 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_3 INTEGER,
        PRIMARY KEY (player_id, event_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events_cleared_folders (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, folder_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events_played_parties (
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER,
        equipment_id_1 INTEGER,
        equipment_id_2 INTEGER,
        equipment_id_3 INTEGER,
        ability_soul_id_1 INTEGER,
        ability_soul_id_2 INTEGER,
        ability_soul_id_3 INTEGER,
        evolution_img_level_1 INTEGER,
        evolution_img_level_2 INTEGER,
        evolution_img_level_3 INTEGER,
        unison_evolution_img_level_1 INTEGER,
        unison_evolution_img_level_2 INTEGER,
        unison_evolution_img_level_3 INTEGER,
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        round INTEGER NOT NULL,
        battle_type INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, round, battle_type),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    // mod(排行榜): 深渊连战「战斗用时榜 / 当轮首通榜」的记录表。
    //
    // 刻意不挂 players 的外键级联:
    //   1. 存档导入(replacePlayerDataSync)会先 DELETE FROM players 再重插同 id,
    //      挂了级联就会连带抹掉这个存档的全部历史成绩,与「历史成绩都记」相悖;
    //   2. wf_rogue_reroll.py 重摇塔时按表名清 players_rush_events* 三张进度表,
    //      本表不在它的 PROGRESS_TABLES 里,所以重摇不会毁榜。
    // 代价是删存档会留下孤儿行 —— 因此这里快照一份 player_name,查询时
    // LEFT JOIN players 取实时名,取不到就回落到快照名。
    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_event_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        player_name TEXT,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER,
        ended_at_ms INTEGER,
        duration_ms INTEGER,
        battle_ms INTEGER NOT NULL DEFAULT 0,
        rounds_cleared INTEGER NOT NULL DEFAULT 0,
        total_rounds INTEGER NOT NULL,
        tracked_from_round INTEGER NOT NULL DEFAULT 1,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER
    )`).run()

    database.prepare(`CREATE INDEX IF NOT EXISTS idx_rush_runs_board
        ON players_rush_event_runs (event_id, folder_id, status, duration_ms)`).run()
    // 榜的排序键 2026-08-28 从 duration_ms 换成 battle_ms。同名索引不能就地改列:
    // CREATE INDEX IF NOT EXISTS 见到旧索引就跳过,老库上永远留着 duration_ms 版
    // (实测 .database/wdfp_data.db 的 sqlite_master 就是旧定义)。所以新建一条新名字的,
    // 旧的留给后台「全部记录」页按墙钟排查。
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_rush_runs_board_battle
        ON players_rush_event_runs (event_id, folder_id, status, battle_ms)`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_rush_runs_season
        ON players_rush_event_runs (event_id, folder_id, season, finished_at_ms)`).run()
    database.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rush_runs_active
        ON players_rush_event_runs (player_id, event_id, folder_id)
        WHERE status = 'active'`).run()

    // mod(排行榜结算): 每个 (事件, folder) 一条结算配置。
    // reward_tiers 是 JSON 数组 [{fromRank,toRank,itemId,count,degreeId}]。
    // itemId 与 degreeId 同时为 null 才是「奖励未配」；只配 degreeId 是合法称号奖。
    // 未配档仍照常冻结名次和换期，但不发奖，避免误发错道具。
    database.prepare(`CREATE TABLE IF NOT EXISTS rush_settlement_config (
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        auto_enabled INTEGER NOT NULL DEFAULT 0,
        settle_at_ms INTEGER,
        repeat_interval_ms INTEGER,
        reward_board TEXT NOT NULL DEFAULT 'full-run',
        reward_rank_limit INTEGER NOT NULL DEFAULT 10,
        reward_tiers TEXT NOT NULL,
        mail_subject TEXT NOT NULL,
        mail_body TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        exclude_bots INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (event_id, folder_id)
    )`).run()

    // migration(2026-08-28): 机器人发不发奖的开关。
    // `CREATE TABLE IF NOT EXISTS` 见到老表就整段跳过 —— 已经跑过一次的库
    // (作者本机的 .database/wdfp_data.db 就是)永远拿不到新列,所以必须补一条
    // ALTER。用 pragma 先查而不是 try/catch:列已存在时不该产生一次异常。
    if (!hasColumn(database, "rush_settlement_config", "exclude_bots")) {
        database.prepare(
            `ALTER TABLE rush_settlement_config ADD COLUMN exclude_bots INTEGER NOT NULL DEFAULT 1`
        ).run()
    }

    // 结算台账: 一期结算一行。唯一索引保证同一期不会被结算两次。
    database.prepare(`CREATE TABLE IF NOT EXISTS rush_season_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        settled_at_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        next_season INTEGER NOT NULL,
        full_run_rows INTEGER NOT NULL DEFAULT 0,
        season_first_rows INTEGER NOT NULL DEFAULT 0,
        rewarded_count INTEGER NOT NULL DEFAULT 0,
        mail_count INTEGER NOT NULL DEFAULT 0,
        note TEXT
    )`).run()

    database.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rush_settlement_once
        ON rush_season_settlements (event_id, folder_id, season)`).run()

    // 冻结的名次快照: 结算那一刻两张榜的完整排名,连同发了什么奖、邮件是哪封。
    database.prepare(`CREATE TABLE IF NOT EXISTS rush_season_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        settlement_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        board TEXT NOT NULL,
        rank INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        player_name TEXT,
        run_id INTEGER,
        duration_ms INTEGER,
        battle_ms INTEGER,
        rounds_cleared INTEGER,
        finished_at_ms INTEGER,
        reward_item_id INTEGER,
        reward_count INTEGER,
        mail_id INTEGER,
        skip_reason TEXT
    )`).run()

    // migration(2026-08-28): 这一行为什么占了名次却没收到奖励。
    // 现在有两种「占名次不发奖」:'bot'(机器人,被结算配置的开关排除)与
    // 'deleted'(存档已删,players 外键插不进邮件)。null = 正常。
    // 没有这一列的话,快照上「rank 3 没有 mail_id」是个无从解释的空格。
    if (!hasColumn(database, "rush_season_results", "skip_reason")) {
        database.prepare(`ALTER TABLE rush_season_results ADD COLUMN skip_reason TEXT`).run()
    }

    database.prepare(`CREATE INDEX IF NOT EXISTS idx_rush_season_results_lookup
        ON rush_season_results (event_id, folder_id, season, board, rank)`).run()

    // 轮次(期)台账: 每个 rush event 当前是第几期,以及这期是怎么开始的。
    database.prepare(`CREATE TABLE IF NOT EXISTS rush_event_seasons (
        event_id INTEGER PRIMARY KEY,
        season INTEGER NOT NULL,
        started_at_ms INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        source TEXT NOT NULL
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_carnival_event_records (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        best_score INTEGER,
        previous_score INTEGER,
        previous_character_ids TEXT,
        previous_unison_character_ids TEXT,
        PRIMARY KEY (player_id, event_id, folder_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_shop_purchases (
        player_id INTEGER NOT NULL,
        shop_item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, shop_item_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_quests (
        player_id INTEGER PRIMARY KEY,
        play_id TEXT NOT NULL,
        quest_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        use_boss_boost_point INTEGER NOT NULL DEFAULT 0,
        use_boost_point INTEGER NOT NULL DEFAULT 0,
        is_auto_start_mode INTEGER NOT NULL DEFAULT 0,
        is_multi INTEGER NOT NULL DEFAULT 0,
        room_number TEXT,
        entry_item_id INTEGER,
        event_id INTEGER,
        continue_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
}
