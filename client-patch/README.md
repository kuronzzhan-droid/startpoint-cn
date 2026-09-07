# 客户端最小补丁(免登录 + 重定向)

让官方 CN 客户端连接本服务,仅需两处改动。补丁作用于 FFDec 反编译出的 AS3 源码。

## 前置要求(自备,均不随本目录分发)

- FFDec 24.0.1(SWF 反编译 / 回封)
- 一份官方 CN 客户端 APK(源)
- 一个签名 keystore(重打包后签名)
- Android build-tools(`zipalign` / `apksigner`)

## 两处改动

1. **免登录** — `pinball/config/core/DevConfig.as`
   - `public static var sdkDummy:Boolean = false;`
   - → `public static var sdkDummy:Boolean = true;`
   - 效果:跳过雷霆 SDK 登录,使用假 userId;支付 / 推送 / 实名等真实 SDK 功能变 stub。
2. **重定向到本服** — `pinball/config/gbits/DevConfig_gf_android.as`
   - 域名 `shijtswygamegf.leiting.com` → `<你的服务器 host:port>`(如 `192.168.1.10:8001`)
   - 协议 `"https"` → `"http"`

## 应用步骤(手动)

1. 用 FFDec 把源 APK 内的主 SWF 反编译 / 导出为 AS3 脚本目录(记为 `EXPORT_DIR`)。
2. 运行 `bash apply.sh <EXPORT_DIR> <host:port>`(或按上文手动改两文件)。
3. 用 FFDec 把改后的 AS3 导回 SWF,替换进 APK,`zipalign` + `apksigner` 重签名。
4. 安装到设备。

## 补丁一览

| 补丁目录 | 作用面(类) | 说明 | 互斥 |
|---|---|---|---|
| `abyss-mode-equipment/` | `BattleCharacterLogic` | 深渊连战 15 把武器/能力魂的战斗生效门控 | — |
| `dual-form-v1/` | P-code(赛瑞斯相关) | 赛瑞斯 129999 双形态演出与战斗效果 | — |
| `render-scale-v1/` | `PixelArtCharacterView`、`MemberView`、`CharacterCellView` | 自制大帧像素件的渲染缩放 | — |
| `rank-button-p1/`、`rank-scene-p2/`、`rank-p4-native/` | `RushEventRanking*`、`RushEventTop*`、`ToolAgreementRealRemote`、`TermsOfServiceLoadingTask` | 排行榜场景复活 | — |
| `five-boss-auto-lock/` | `BattleScene`、`BattlePauseMenu` | 五重决战:开战前关掉 Auto 后战斗内锁定 | — |
| `five-boss-random-map/` | `BothBossTool` | 五重决战:`both_boss_map` 多行候选随机选图(多人按房号、单人按时间播种) | — |
| `five-boss-multi-only/` | `BossBattleQuestLogic` | 五重决战 `1099001..1099003` 返回 `available_play_kind = 2`(只能组队,单人按钮置灰) | ⚠ 与 `five-boss-single-allowed` **二选一** |
| `five-boss-single-allowed/` | `BossBattleQuestLogic` | 把上面那条还原成官方的 `return 1`(单人 + 组队,单人按钮可点) | ⚠ 与 `five-boss-multi-only` **二选一** |
| `kyubi-fever-ratio/` | `AbilityValues`、`InstantAbilitySource`、`InstantAbilityContentTools`、`InstantAbilityDescriptionGenerator`、`AbilitySlotImpl`、`FeverPointGaugeImpl` | 新 kind `instant_content 724 AddFeverPointRatio`(按 Fever 槽上限比例增减) | — |
| `dash-parameter/` | `AbilityValues`、`DuringAbilitySource`、`CommonAbilityContentTools`、`AbilityDescriptionGenerator`、`BattleAbilityTotalizerImpl`、`BallImpl` | 新 kind `during_content 422 DashParameter`(7 个可调冲刺参数) | — |
| `kyubi-pf-combo/` | `BallImpl`、`ActionEvaluationResolver` | 九尾狐原生 PF 的弹射前连击快照（追加 1 个 int 槽 + 2 个方法体 P-code 拼接） | — |
| `kyubi-pf-damage/` | `MemberImpl`、`ActionEvaluator`、`AbilityDamageShot`、`SquadManagerImpl` | 九尾狐两档主技 / 常态特殊 PF / 能力 2 追击按**强化弹射**结算。⚠ 目录里的 `patch.py`（整类 AS3 回编）**已废弃**——它产出的包在战斗中抛 `ReferenceError #1069`；现在的入口是 `abcpatch.py`（指令级插入）+ `patch_squad_pcode.py` | — |
| `abcasm/` | (不是补丁) | V12 / V13 补丁共用的 AVM2 汇编器 / 拼接器 / 重定位器 / 方法体按名字定位（`bodies.py`） | — |

`five-boss-multi-only` 与 `five-boss-single-allowed` 改的是**同一个方法**
(`BossBattleQuestLogic.get_availablePlayKind()`),构建链上只能选一个;
其余补丁互不重叠,可以叠加。两者的验证器互相排斥
(装了单人版就通不过多人版的 `verify_quest_logic`,反之亦然),
所以打错了会在回读校验阶段报错,不会静默出货。

## 可选补丁

- **abyss-mode-equipment**(`abyss-mode-equipment/`):深渊连战 15 把武器/能力魂(`8000101`–`8000115`)的战斗生效门控——只在 Rush `700099` / 挑战 `2001` / 练习 `1`–`97` 内生效。**服务端启用深渊连战模式时必须打**,否则武器装上不生效。用法见 `abyss-mode-equipment/README.md`,自建服完整流程见 [`docs/self-host-modes.md`](../docs/self-host-modes.md)。
- **dual-form-v1**(`dual-form-v1/`):赛瑞斯(129999)双形态 P-code 补丁——★4 特殊演出预载、
  双形态动画切换、湿润雷伤终乘、显形退场全队充能、显形中弱化延长。**服务端启用双新角色
  数据链(asset-patch `1.4.103`)时必须打**,否则客户端播放赛瑞斯特殊演出会硬崩。
  与其余补丁不同,它作用于 FFDec 的 **P-code 导出**(非 AS3 源),用法:
  `python dual-form-v1/build_patch.py --baseline-swf <主SWF> --baseline-pcode-root <pcode导出目录> --ffdec-jar <ffdec.jar> --output-dir <空目录> --profile-dir <FFDec配置目录> --manifest dual-form-v1/patch-manifest-seris-combat.json`
  (完整战斗体验用 `patch-manifest-seris-combat.json`;只求不崩可用默认最小 manifest)。
- **omni-element**(`apply-omni-element.sh` / `omni-element.md`):共鸣通用属性标签。
- **random-floor**(`apply-random-floor.sh` / `random-floor.md`):boss 塔每次进本随机——
  `BattleQuestBaseImpl` 两个 getTower*FloorValues 识别 floor 表 `__random__,K` 头行,
  每次构建 quest 时从池中抽 K 层洗牌。配合 `mod-tools/wf_chain_build.py --pool K` 生成数据。
  ⚠ 未打此补丁的客户端读到 `__random__` 数据会崩,数据须在全员换包后再发。

## 说明

完整的自动化流水线(FFDec 导出 / 导入 / 打包 / 签名)是作者基于 [starview](https://github.com/duosii/starview)(GPL-3.0)的本地扩展,未随本仓库分发。本目录仅提供"最小改动 + 应用脚本",方便手动复现;`apply.sh` 为原创实现,不含 starview 代码。
