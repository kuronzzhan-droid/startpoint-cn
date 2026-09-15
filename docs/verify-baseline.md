# 全仓验收基线（已知红项）

> 用途：`CLAUDE.md`「验收口径」——与本文件相同的红不算失败，**新增红项才算**。
> 基线变化（修掉旧红或出现新红）时更新本文件并单独 commit。
> 标注：【事实】本机实测（含日期与命令）；【记录】转自 `work/agent-coordination/codex-to-claude.md` 未复核。

## 状态表

| 命令 | 状态 | 已知红项 |
|---|---|---|
| `npm run typecheck` | 【事实】绿（2026-09-15） | — |
| `npm run test:python` | 【事实】红（2026-09-15）：2862 项，failures=3，errors=8，skipped=12 | 见下表 11 项 |
| `npm run check:hygiene` | 【事实】红（2026-09-15，exit 1）：19 处 | 16 处「家目录路径」（`mod-tools/rolf_tools/*.py` 写死旧会话 scratchpad 路径、`mod-tools/wf_art_voice_asr.py` 写死 whisper 模型路径）+ 3 处「个人 IP」。均为历史脚本，协作对齐 8.③ 冻结期内不清理 |
| `npm run test:hygiene` | 【事实】绿（2026-09-15）：15/15 | — |
| `npm run test:node` | 【记录】Codex 2026-09-14：449 项通过（本次未重跑，该命令会重建 `out/`） | — |
| `npm run test:launcher` | 【记录】Codex 2026-09-14：通过 | — |
| `npm run verify:local-release` | 【记录】Codex 2026-09-14：红——`assets/cdndata/character.json` 投影漂移（作者 WIP，未提交） | 该漂移 |
| `npm run verify`（串联上述） | 因 `test:python` 与 `verify:local-release` 而红 | 同上 |

## `test:python` 已知红项（2026-09-15）

| 类型 | 用例 | 备注 |
|---|---|---|
| FAIL | `test_kyubi_pf_revision.KyubiRevisionTests.test_live_special_layout_is_pinned_and_revision_is_a_no_op` | 夹具读作者 live 包，随 live 漂移（见记忆 wf-kyubi-pf-test-fixture-is-live-package） |
| FAIL | `test_kyubi_pf_revision.KyubiRevisionTests.test_dry_run_writes_nothing_and_original_path_is_refused` | 同上 |
| FAIL | `test_featured_main_ability.FeaturedMainAbilityTests.test_exact_five_ids_and_all_builder_a1_rows_including_bianca_bridge` | 与当前 live 行不一致 |
| ERROR | `test_campus_bianca.CampusBiancaTests.setUpClass` | 校园比安卡夹具缺依赖 |
| ERROR | `test_bianca_dragon_bridge.BiancaDragonBridgeTests.test_native_bridge_contract` | 同族 |
| ERROR | `test_celtie_fever_leader.CeltieFeverLeaderTest.test_native_consume_precontent_and_main_member_flip_contract` | `*_native_*` 系列：依赖反编译源树/原生资源，本机路径不全 |
| ERROR | `test_celtie_fever_stock.CeltieFeverStockTest.test_native_phase_order_supports_same_frame_cleanup_and_exact_skill_charge` | 同上 |
| ERROR | `test_nephtim_fever_abilities.NephtimFeverAbilitiesTest.test_summon_state_native_encoffin_cleanup_and_existing_unique_precondition` | 同上 |
| ERROR | `test_nephtim_fever_abilities.NephtimFeverAbilitiesTest.test_native_condition_frame_counter_and_precondition_filter_are_not_elapsed_time` | 同上 |
| ERROR | `test_nephtim_leader_growth.NephtimLeaderGrowthTest.test_native_multiball_removal_distinguishes_temporary_inactive_transition` | 同上 |
| ERROR | `test_nephtim_multiball_direct.NephtimMultiballDirectTest.test_native_chain_reads_local_hidden_slot_and_removes_finished_evaluator` | 同上 |

「备注」列是【判断】（按用例名与既有记录推断，未逐个复现根因）；修复任一项后把它从表里删掉。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-15 | 建立。配合协作对齐 v1.13 与 `CLAUDE.md`「验收口径」 |
