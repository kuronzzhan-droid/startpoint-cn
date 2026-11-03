"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAttentionConfig = exports.ATTENTION_CONFIG = void 0;
exports.ATTENTION_CONFIG = Object.freeze({
    attention_recruitment_interval_seconds: 15,
    attention_recruitment_redeliver_limit: 20,
    attention_polling_interval_seconds_normal: 10,
    attention_polling_interval_seconds_battle: 15,
    multi_attention_lifetime_seconds: 30,
    contribution_score_rate_to_parasite: 0.25,
    attention_log_interval_seconds: 600,
    disable_finish_duration_seconds: 5,
    disable_decline_count_seconds: 60,
    disable_decline_count_limit: 14,
    disable_decline_duration_seconds: 30,
    disable_intent_disconnect_duration_seconds: 300,
    disable_unintent_disconnect_duration_seconds: 5,
    disable_remote_error_duration_seconds: 300,
    attention_animation_time_seconds: 6,
    disable_expire_count_limit: 4,
    disable_expire_duration_seconds: 180,
    polling_delay_normal_seconds_range_min: 1,
    polling_delay_normal_seconds_range_max: 10,
    polling_delay_battle_seconds_range_min: 1,
    polling_delay_battle_seconds_range_max: 15,
    return_attention_max_num: 3,
});
function getAttentionConfig() {
    return Object.assign({}, exports.ATTENTION_CONFIG);
}
exports.getAttentionConfig = getAttentionConfig;
