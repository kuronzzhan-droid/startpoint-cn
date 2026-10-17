# 新角色制作通用门禁清单

日期：2026-10-06

适用范围：StarPoint CN MOD 新角色与独立换皮角色的制作、发布、事故回滚与验收（本仓库 `Ku1o/startpoint-cn-kulo`）。

## 文档定位

- 本文把以下资料收敛为可执行的默认门禁：
  - `tools/fantasy-gauntlet-mod-tools/docs/新角色制作心得.md`（一手制作心得，必读原文）；
  - `docs/development/MOD-CHARACTER-PRODUCTION-RETROSPECTIVE-20260922.md`（MOD 角色制作复盘，含 `author-integration-20260924` 节）；
  - `docs/development/MOD-CHARACTER-UPSTREAM-LESSONS-20260924.md`（上游经验的本地适用范围与未复核项）；
  - 2026-10 凉月（159992 / `liangyue_onmyoji`）从制作、发布到 1.4.145 的修复与事故记录。
- 门禁是发布前的失败条件。“经验已在文档 ≠ 已进门禁”：只有存在对应脚本、断言或审计回执时，才算落地。
- 旧模板限制、上游 CI 策略和其他角色的一次性选择不自动成为本机引擎规则；以当前有效资源链与当前客户端解析器的针对性证据为准。
- 本清单不改变授权边界：`.cdn/` 只读；提交、推送、云服包、部署与客户端发布各自独立授权。

### 路径与证据范围

- 未注明前缀的源码路径均相对本仓库根目录；`StarPoint-Character-Studio:<路径>` 表示独立工坊仓库 `Ku1o/StarPoint-Character-Studio` 内的相对路径，不是本仓库的子目录。
- `local-evidence:<批次>/<文件>` 仅标识历史本地旁证或隔离备份，不随仓库提供，也不是可直接运行的路径。案例中的历史结论不能替代当前发布边验收。
- 凉月最终合并边随仓库保留的回执位于 `assets/asset-patch/audit/liangyue-character-final-merge-1.4.131/`：`report.json`、`verification.json`、`gate-character-edge.json`、`gate-ability-strong-fields.json`、`gate-timeline-sounds.json`；其中已标注为本地旁证的附件不在仓库内。

## 0. 开工前：必读与基线

必读（按顺序）：

1. 本仓库根目录的 `AGENTS.md`
2. `<CODEX_HOME>/skills/starpoint-cn-mod-tools/SKILL.md` 及适用的 references
3. `tools/fantasy-gauntlet-mod-tools/docs/新角色制作心得.md`（一手原文，不接受二手摘要替代）
4. `docs/development/MOD-CHARACTER-PRODUCTION-RETROSPECTIVE-20260922.md`
5. `docs/development/MOD-CHARACTER-UPSTREAM-LESSONS-20260924.md`
6. 本清单

基线记录（开工时记录一次，之后复用，不重复计算）：

- 输入：作者工程/压缩包 SHA-256，角色 ID / code / donor；
- 有效链：manifest `cdn_version`、enabled patches、受影响表与资源的终态字节；
- 计划输出：active ZIP 命名、manifest 补丁 id、audit 目录、覆盖层路径；
- 计划版本边：必须高于客户端当前 `res_ver`；
- 验证计划：按第 9 节选择层级，不默认跑发布级全量。

## 门禁总览

4 道边界门禁（1–4）+ 4 道落实门禁（5–8），全部 fail-closed；任一失败即停止发布。

| # | 门禁 | 凉月案例对照 |
| --- | --- | --- |
| 1 | 仓库边界：输出路径断言 | 默认发布链写 `.cdn/cn/archive-*-diff/` |
| 2 | 链边界：outer key union + 声明行合并 | C8601：角色表 596→584 键 |
| 3 | 客户端结构契约：编译产物逐键对齐 | timeline 缺 `sounds` → 获取演出 F1009 |
| 4 | 客户端解析器契约：声明行强类型 | C7101 / C7050 / 详情页 F1009 / null角色 / +0 |
| 5 | 先例与语境：同表同语境、过滤敌方行 | 条件类 kind 与官方先例组合 |
| 6 | 资源语义：像素锚点 / `_sp` 帧 / UI 裁剪遮罩 / 编号与引用 | atlas 偏移事故、22 张裁剪图 |
| 7 | 共享表影响面：改动前枚举消费者 | `unique_condition` 22 行影响赛瑞斯 |
| 8 | 发布链与回滚：版本边 / manifest / preflight / 金丝雀 / 回滚 | 同版本换包不重下；1.4.144 回滚边 |

## 1. 门禁 1：仓库边界（输出路径断言）

要求：

- 新 CDN 增量 ZIP 只能写入 `assets/asset-patch/active/`；
- 同批必须在 `assets/asset-patch/manifest.json` 登记顺序版本边；
- 审计与回执写入 `assets/asset-patch/audit/<batch>/`；
- 覆盖层散文件写入 `assets/asset-patch/production/{upload,medium_upload,android_upload,ios_upload}/**`，不得出现 `production/production` 中间层级；
- 任何输出路径包含 `.cdn`（含 `archive-*-diff`、`archive-*-full`、`character-releases`、`dev-catalog`，或经 junction 指向的同一物理路径）都必须中止。

检查方式：

- 发布脚本在写盘前对每个目标路径做前缀断言，失败即退出；
- 发布后核对 active 目录、manifest 条目、audit 目录的实际落盘；
- 发布后核对 loose 资源的本地落盘；存在单文件交付路径时，比对其字节与 ZIP 中的本次发布物，防止写错层级。HTTP 读回仅按第 8.1 节的故障、受影响路由/准入或明确验收等条件触发，不作为普通发布的固定步骤。

案例（2026-10-05）：角色包发布沿用工具默认链，把 ZIP 写入 `.cdn/cn/archive-{common,medium,android}-diff/`，并生成 `.cdn/cn/character-releases/active.json` 与 `.cdn/cn/dev-catalog/`；该链被服务端 `get_path` 列出。处理方式：14 个新文件移入任务隔离目录 `local-evidence:liangyue-character-20261005/quarantine-cdn-20261005/`，清理由本批新建的 `.cdn` 目录，随后重建 active 发布流程；隔离目录内容不得复制回 `.cdn/`。

案例（2026-10-06）：覆盖层 store 一度写入 `assets/asset-patch/production/production/upload/...`，客户端经 active 链下载的字节自始正确，但本机 loose 端点仍返回旧表；通过读回端点字节发现并修正。

## 2. 门禁 2：链边界（outer key union + 声明行合并）

要求：

- 先解析当前有效链（`assets/asset-patch/manifest.json` + enabled patches + active ZIP）得到终态；候选不得以不完整的 materialized store 作为整表来源；
- 对受影响表做外层 key union：候选外层 key 集合必须包含有效链外层 key 集合，任何减少都必须失败；
- 未声明的行必须与有效链逐字节一致（声明行合并审计）；嵌套技能表同时检查 outer/inner key；
- live store 与解析来源不一致（漂移）时 fail-closed，不得静默选择首个可读副本。

建议覆盖的表（按角色包实际范围选择并记录）：

- `master/character/character.orderedmap`
- `master/character/character_text.orderedmap`
- `master/character/character_status.orderedmap`
- `master/character/character_speech.orderedmap`
- `master/character/character_gacha_sound.orderedmap`
- `master/character/character_awake_status.orderedmap`
- `master/ability/ability.orderedmap`、`master/ability/leader_ability.orderedmap`
- `generated/character_image`、`generated/mana_board`、`generated/trimmed_image`
- `mana_board/*`
- `skill/action_skill`、`skill/switched_action_skill`、`skill_preview_character`、`stance_detail`

案例：C8601（2026-10-05）。候选把 `character.orderedmap` 整表覆盖为 584 键，丢失 13 个历史键（`119990`、`119991`、`119992`、`129990`、`139990`、`139991`、`139992`、`149986`、`149987`、`159994`、`159995`、`169988`、`169991`），玩家队伍使用的 `149987` 解析失败，登录链路 `HomeScene/prepareScene → PartyLogic/get_allCharacters → OwnedCharacterLogic/GeneralCharacterLogic` 抛 `C8601`（界面提示“资源文件已损坏”，与真实原因不符）。修复以有效链 1.4.130 终态为 donor，按声明行合并 17 张表，`keys-union.json` 零丢失，`character.orderedmap` 596→597 键（596 历史 + 159992）。

回执样例：`local-evidence:liangyue-character-20261005/keys-union.json`；`local-evidence:liangyue-character-20261005/phaseE/account-save-resolution.json`（1914 名玩家、5453 条角色引用全部命中，覆盖队伍/共清/深渊出战列）。

## 3. 门禁 3：客户端结构契约（编译产物逐键对齐官方/donor）

要求：编译产物必须与官方 donor（同类角色、同槽位）或既有已验收 MOD 产物逐键/逐成员对齐，至少包括：

- `pixelart` / `special` timeline 顶层键集 `{sequences, sounds, points, circles}`；`sounds` 必须存在（可为空数组），`points/circles` 与 donor 同构；
- sprite sheet PNG、`sprite_sheet.atlas`、`frame` 三件套的成员集合与引用关系成对更新；
- atlas 的记录名/帧编号、`fw/fh`、帧序列区间保持不变（除非有明确审计与锚点回放证据）；
- 特效 parts/timeline 的键集与资源闭包；
- ★4+ 角色的 special 槽必须保留获取演出 `special_land`/`special_pose`；一槽两用（获取演出 + 战斗形态）按已验收先例（129999 赛瑞斯）的布局复刻，并在改动后重放逐帧映射；
- 模板克隆与 deepcopy：新角色优先克隆官方/已验收模板，保留已知键集与结构再逐项替换；deepcopy 产物仍须过逐键对齐断言；不得从旧模板重新生成共享表（会覆盖其他角色的新行）。

案例：凉月两条 pixelart timeline 的 AMF3 缺 `sounds` 成员（2026-10-05，获取演出 F1009）。`PlayheadTimeline.sounds` 被 coerce 为 null，`AssetPathCollectionBuilder/loadDynamicSoundEffect` 读 `sounds.length` 抛 TypeError #1009。全链内容扫描：147,570 个归档成员中 12,922 个“含 `sequences` 的 AMF3 对象”里只有这两条缺 `sounds`。修复：`StarPoint-Character-Studio:studio_compile.py` 的 `compile_pixelart` 固定输出官方键集；新增 fail-closed 门禁 `tools/lens-integration/check_timeline_sounds.py`（边成员 + pathlist + 全链内容）。

检查工具与回执：`python tools/lens-integration/check_timeline_sounds.py --expect-tail <v> --edge-version <v> --expect-edge --require-logical <路径> --receipt <json>`；样例见 `local-evidence:liangyue-f1009-fix-1.4.134/`。

## 4. 门禁 4：客户端解析器契约（声明行强类型校验）

要求：对每个声明行，按客户端生成解析器（`pinball/master/generated/AbilityValues.as`、`LeaderAbilityValues.as` 的 `parseAtN` 分支）实际可达的列校验：

- Bool 列只接受 `TRUE/True/true/FALSE/False/false`；空串抛 C7101（`文字列“”作为Bool无法被解析`）；
- 枚举列空串抛 C7050（不存在的构造函数）；必须给出合法值；
- Option 列必须写字面量 `(None)`：空串会被读成 `Some(null)` 或 `Some(0)`，与 `(None)`、枚举 `0` 语义不同，三者不可互换；
- 数值列按官方单位和同 kind 先例取值，不用“看起来合理”的值代替；
- 角色详情页会提前解析整组能力（不等到战斗），必须按 `parseAt47`（ability）/`parseAt45`（leader）分支表给出的全部可达列校验，而非只查战斗实际走的字段；
- 数组型组格与 Option 型组格分开处理：数组型只能填 token，Option 型才可用 `(None)`。

检查工具：

- `tools/lens-integration/check_ability_strong_fields.py`（`--expect-tail/--edge-version/--require-key/--expect-edge/--check-declared-cells/--receipt`，fail-closed）；
- `tools/fantasy-gauntlet-mod-tools/wf_client_legality.py` 与 `StarPoint-Character-Studio:core/wf_client_legality.py`（生成器与门禁共用规则，避免漂移）；
- 真实解析器字节码回放：`tools/inaho-integration/verify_native_master_fields.py`（前后对照 + 正控）。

案例（凉月，2026-10-06，同批 5 类）：

| 案例 | 触发点 | 根因 | 修复 |
| --- | --- | --- | --- |
| C7101 | 角色详情 | ability 列 72 / leader 列 70 的 `by_each_trigger_puller` 为空串 | 补 `false`（官方同族 546×`false` / 10×`true`；自目标与 kind 24 先例全 `false`） |
| C7050（潜在） | 角色详情 | 同批 `multiply_trigger`（列 75 / leader 73）为空串 | 补 `0`（官方众数） |
| 详情页 F1009 | 角色详情 | Option 列（ability c62..65 / leader c60..63）空串 → `Some(null)`/`Some(0)` → `InstantAbilitySource$/resolveEndPowerFlipLevels` 返回 undefined → 描述生成器对 null 取 `.length` | 13 个空 Option 格改为 `(None)`（官方同 kind 先例：kind 0 ×157、kind 24 ×1、leader kind 489 ×19） |
| 「null角色」 | 角色详情 | 组格空串 → `parseAt36/49` 得到空数组 → `stringfyCharacterGroups` 取 `[0]` 得 null 后拼串渲染 | 数组型组格填 token（如 `Green`），Option 型组格填 `(None)`；官方基线 3,207 个可读组格 0 空串 |
| 「+0」显示 | 角色详情 | `initial_multiply` 空串 → null→int 0，描述器相乘后显示「连击+0」「追击伤害+0%」 | 官方同类行全写 `1`（46/46 + 1/1）；`number` 列对齐 `100000` |

回执样例：`local-evidence:liangyue-c7101-fix-1.4.135/`、`local-evidence:liangyue-ability-description-fix-1.4.136/`、`local-evidence:liangyue-group-nullrole-fix-1.4.137/`、`local-evidence:liangyue-zero-value-fix-1.4.138/`；真实坏行夹具：`tools/fantasy-gauntlet-mod-tools/tests/fixtures/liangyue-c7101-bool-rows.json`、`liangyue-f1009-option-rows.json`。

## 5. 门禁 5：先例与语境

- 先例必须同表同语境：能力表与队长表列布局不同（leader = ability 整体 -2 列），同一 kind 在一张表可用、在另一张表可能走不同分支；
- 统计先例时过滤敌方行：只把可用于玩家角色的官方行计入先例；
- 零先例或单行先例单独列出并逐格对照（凉月 kind 24 官方仅 1 行，逐字段核对后差异只允许在数值列）；
- 语境错位型 kind 优先做解析器/执行器取证；上游“零先例必崩”类结论只作为风险提示，不作为本机普遍定理；
- 显示描述与战斗行为是两条链：同一效果挪动位置会改变主位/协力上下文与描述分支，两链分别验证。

案例：凉月三处问题都位于“条件类瞬发变体”的强类型列；先例统计（`local-evidence:liangyue-zero-value-20261006/precedents.json`）给出 kind 489（ability 26 行 / leader 20 行全 `number=100000`、`initial_multiply=1`）与 kind 24（唯一 1 行）的官方组合，用于确定修复值。

## 6. 门禁 6：资源与数据接入语义

### 6.1 像素图集 trim 与锚点（必须按客户端语义校验）

客户端读取链（以本机已验收 SWF 反编译为准）：

- `pinball/asset/view/_ViewAssetCache/SpriteSheetHandler.as:49-67`：`region=(x,y,w,h)`、`frame=(fx,fy,fw,fh)`；
- `starling/textures/SubTexture.as:48-70`：绘制尺寸 = region 的 `w/h`；
- `starling/textures/Texture.as:339-357`：区域左上角画在 `(-fx,-fy)`；
- `flatomo/animation/frame/FrameAnimation.as:24-33`：容器 x/y = frame 文件值（`-128,-128`），scale=6；
- `flatomo/animation/frame/FrameAnimationSource.as:12-42`：`imageFrames[tick-1]` 由 atlas 名字的数字后缀铺开，名字必须匹配该 layout 的资源名；
- `starling/display/Quad.as:140-158`：`fw/fh` 只用于 bounds/枢轴，不参与定位。

由此得到定位公式：`区域左上角 = frame.x - fx = -128 - fx`（同理 y）；画面位置 = 成员位置 + scale × 区域左上角 + 帧内像素偏移。工作室编译器的写入关系是 `fx = -clip.x - 128`。

断言（任何 pixelart 改动，锚点逐帧零变化）：

1. 用上述客户端公式对上一版链上字节逐 tick 重放比对，保留像素的位置误差必须为 0（不依赖“图像看起来一样”）；
2. 字段不变量：`n`（帧编号/序列区间）不变、`fw/fh` 不变、帧集合不变；
3. 换素材时按 `clip.x += dx`（dx/dy 为新素材在旧帧内的偏移）补偿，符号不得取反；
4. 保留负例样本：1.4.143 的错误 atlas（`43dfcd5a…`）必须在新的锚点校验脚本上复现 (-24,-24) 逻辑像素位移后才算有效。

案例（1.4.143 事故）：基础帧去召唤物时把补偿符号做反，本体整体偏移 (-24,-24) 逻辑像素 = 144 屏幕像素（×6）。根因是离线模拟器把区域画在 `(128+fx, 128+fy)`（符号镜像），与客户端 `(-fx,-fy)` 相反；同时把 `fw/fh` 误当定位信息。修正版（1.4.145）保持 sheet 不变、只修 atlas，逐 tick 断言 0 新增像素、0 颜色变化，仅删除 58,144 个召唤物像素；并用负例重放验证 368 个基础 tick 的统一 (-24,-24) 位移。

### 6.2 `_sp` 合成帧与纯本体帧

- 作者工程可能同时提供纯本体 `<名>.png` 与合成帧 `<名>_sp.png`（本体 + 召唤物/伴随特效）；clip 默认引用合成帧，但设计意图可能只在特定状态展示加成内容；
- 判定方式：逐对子图搜索证明纯本体 = 合成帧在固定偏移处的子矩形（凉月 143/143 对，偏移恒为 `(+12,+12)`，exact），剩余层做包围盒分析归因；
- 落点：基础状态（待机/移动/胜利/倒下/灵魂/复活等）用纯本体；技能/获取展示状态保留合成帧；
- 断言：逐 tick diff 只允许“删除加成像素”，新增/改色像素必须为 0；切换形态/状态时本体位置不跳动。

### 6.3 UI 裁剪与形状遮罩

- 立绘派生按“主裁剪 + 同源派生”成组管理（凉月：5 类主裁剪 + 6 类派生 = 22 张 medium PNG，覆盖进化前后两形态）；
- 每类按官方同用途构图重裁、等比铺满；记录比例偏差与各向异性上限（凉月 ≤0.3% / 0.17%）；
- 八类形状遮罩使用官方共享 alpha：逐类 IoU 门限（技能指引/技能连锁 =1.0，其余 ≥0.98），遮罩外 alpha 必须为 0（16/16 项检查通过）；
- `trimmed_image` 逐行审计（凉月只允许改 `skill_cutin_0/1` 两行，其余 12,200 行逐字节回读一致）；
- 平台配对：同一源 PNG 独立生成 Android ETC1 slot2 与 iOS ETC2 RGBA slot3，同一 ZIP 成对存在、字节不同，禁止复制。

### 6.4 立绘三表契约

- `full_shot` PNG 官方为紧贴内容的裁剪图；`trimmed_image=(tx,ty,2000,2000)`、`character_image=(tx,ty,图宽,图高)`、`full_shot_image_attribute=(1000,1000,1,face_x,face_y)` 必须与母版实际内容一致；
- 官方内容水平中心 ≈994、脚底 ≈1959；tx/ty 由内容 bbox 反推，不能套用模板值；
- 用整图时必须重算定位；工具预览与页面实际读取分别核对。

### 6.5 玛纳板 ID 编码

- 节点 `multiplied_id = 角色ID×2 拼 板序×200+节点号`；客户端由节点 ID 反推角色 ID；
- 克隆/新建必须做三层树叶子重编号，并同步服务端 `mana_node.json`（静态导入需重启）；
- 漏重映射会指回模板角色（表现为 H400 回登录）。

### 6.6 语音与音效（三入口）

- 扩展满槽语音必须同时接通：战斗轮播、战斗预加载、角色详情试听列表；检查缺文件回退、原生无可选语音与其他角色不受影响；
- 进化前后语音成对处理；记录源格式到游戏封装格式（`44.1kHz/单声道/96kbps CBR` 是已用配置，不是通用上限）；
- 角色语音（`skill_0`/`skill_1`/`skill_ready` 等喊声）与主动技能音效分栏登记；没有专属音效时明确记录“不适用/复用官方”，不能以“不报错”当作完成；
- 动态音效逻辑必须是目标客户端已注册的资源；未注册的 `sound_effect/character_studio/*` 会触发 F1009。

### 6.7 引用闭包

- 表/DSL/时间轴引用到的每张图、每个音效逻辑都必须真实存在且被目标客户端预载（同步读取器需要闭包内的纹理）；
- “文件可单独下载”不等于同步读取器可用；缺图会表现为“数据不足”或下载卡死。

## 7. 门禁 7：共享表影响面

- 修改共享表行（如 `master/character/unique_condition.orderedmap`、全局 `ui_string` 行）前，必须枚举全部消费者（角色、机制、客户端硬编码钩子），逐项列出影响面；跨角色影响进入发布说明与验收范围；
- 优先为角色新增独立状态行/ID；确需改共享行时保留旧值回执与前后对照；
- 案例：`unique_condition` 第 22 行 `unique_seris_dragon_king`（「龙王显现」，`duration_frame=1500`）被赛瑞斯（129999）与客户端 `ModDualForm` + `Unique(22)` 钩子共用；凉月双形态若把该行改为 900 帧会同时缩短赛瑞斯形态时长。可选路径：接受 1500（零副作用）、改共享行（跨角色影响）、或调度删除（`DeleteCondition` 运行时语义未验证，需要金丝雀）；
- 案例：`ui_string` 全局文案行（凉月 U 徽章间距修复）影响全链 26 行 precondition 引用（凉月 2 行 + 其他角色 24 行），属有意变更并已记录影响面；
- 客户端硬编码钩子（如 `MemberView` 的 `ModDualForm` 分支）属于共享行为契约；复用或改动前先核对目标客户端字节，Android 已验证不等于 iOS 已验证。

## 8. 门禁 8：发布链与回滚

### 8.1 版本边与 manifest 纪律

- 新边从实际已启用链尾顺序推进，不能改写已发布边；需要确认指定设备的升级范围时，使用其真实请求 `RES_VER`，不把服务端边起点当作设备状态；同批替换旧边不会触发已更新客户端重新下载；
- 全表 payload 新增 outer key 必须同步进 manifest 的 `tables[].outer_keys`，否则出现 unclaimed_change 冲突；
- 发布前必须先跑 `wf_character_flow preflight`（刷新 `release_ready`），不允许跳过 preflight 直接 publish；
- 发布脚本写盘前执行门禁 1（路径断言）与门禁 2（key union），对 live store 漂移 fail-closed；
- 已发布边不改写；补漏与纠错用新边；一版多包按 `pinball-<from>-<to>-<seq>-<suffix>.zip` 协议拆分，客户端全量下载；
- `package_version` 按字符串比较，版本规划避免降序；
- 发布后必要检查：资源格式与原生路径、ZIP 成员/CRC/字节回读、manifest 对应关系、受影响资源的离线终态，以及本地 loose 资源与 ZIP 字节一致性（存在单文件交付路径时）。这些检查不要求另行 HTTP 下载。
- HTTP 是按需证据层：下载/版本故障、受影响 HTTP 路由或准入改动、无客户端且确需确认下发、或明确要求 HTTP 验收时，复用 `tools/cdn-http-probe.cjs`；普通增量及普通开服不自动触发。客户端正在实际下载并验收时，不重复下载同批资源；清单查询、下载哈希与游戏内验收分别记录。

落地状态注记：截至本文档成稿，`tools/fantasy-gauntlet-mod-tools/wf_character_flow.py` 的路径断言 / outer key union / live store fail-closed 硬化尚未落地，先由本清单与任务侧发布脚本（各批次 `build_edge_*.py`、`finalize_*.py`）执行；硬化完成后回填本节与 SKILL。

### 8.2 金丝雀流程

- 发全新角色前，先用零拷贝克隆的官方角色（示例：111165→119999）端到端走通：邮件发放 → 领取演出 → 角色一览（含关键字遍历）→ 详情页 → 玛纳板全学满 → 进战；
- 金丝雀通过的链路，新角色只剩“数据本身”一个变量；金丝雀角色与正式角色分开记录，不进入正式发布边；
- 用缺数据/干净的低版本客户端验收；作者自带 CDN 不能作为唯一环境；
- 展示语义（元素序、「null角色」、双 Ⓜ 等）以客户端实际渲染为准。

### 8.3 事故回滚与重做

- 发布后出现崩溃或表现事故时，先发逐字节回滚边：从事故前的有效来源取回受影响成员字节，断言全部成员逐字节一致、既有修复不受影响、本边不含新内容；
- 回滚边同样走正式资源流程：active + manifest + audit、逐字节恢复与离线终态检查；HTTP 按上述触发条件执行，另记客户端回归验收的实际状态；
- 回滚后用客户端语义做根因复核，再把修正作为新边重做；事故样本保留为负例校验样本；
- 案例：1.4.143 基础帧修正事故 → 1.4.144 逐字节回滚（2 个成员恢复到 1.4.142 行为，6 个未变成员与 1.4.134 `sounds` 修复保持原字节）→ 根因定位（客户端锚点公式）→ 1.4.145 v2 修正（复用 1.4.143 的 sheet、修正 atlas），并以负例重放验证。

## 9. 证据分层模板

| 层级 | 覆盖内容 | 典型回执 | 不代表 |
| --- | --- | --- | --- |
| L0 静态/结构 | key 集、AMF3 往返、成员/CRC、格式与路径断言 | validation-report、candidate-verification | 客户端能加载 |
| L1 离线回放 | 有效链终态、客户端存储模拟、解析器/描述链回放、客户端语义渲染、存档引用解析 | keys-union.json、replay-*.json、client-semantics-verification.json、account-save-resolution.json | 服务端下发正确 |
| L2 服务端（按需） | 源仓库 8001：更新清单；明确需要时再核对下载字节 | cdn-http-probe 结果、live-http-verification-*.json | 客户端加载与表现；仅查清单也不代表下载哈希通过 |
| L3 客户端运行 | MuMu/设备：领取演出、详情页、练习战、语音 | latest.log、服务端 `/crash` 观察、练习战记录 | 另一平台或全部路径 |
| L4 真机验收 | 人工确认的可见行为与体验 | 验收登记 | 未覆盖的分支 |

规则：证据层用于说明覆盖范围，不表示每个任务都必须逐层执行。低层级不能冒充高层级；HTTP 200 ≠ 客户端加载；Android 通过 ≠ iOS 通过；离线预览 ≠ 训练场/真机表现；每项结论必须标注覆盖的机制与平台。纯开服确认就绪后交给客户端测试，不补跑全部层级。

## 10. 案例索引（凉月 159992 / `liangyue_onmyoji`，2026-10）

| 案例 | 根因摘要 | 门禁 | 历史本地证据/回执（不随仓库提供） |
| --- | --- | --- | --- |
| C8601 整表覆盖 | 稀疏 store 整表覆盖，丢 13 个历史键 | 2 | `local-evidence:liangyue-character-20261005/`；`local-evidence:liangyue-character-20261005/phaseE/` |
| 发布路径违规 | 默认链写 `.cdn` | 1 | `local-evidence:liangyue-character-20261005/quarantine-cdn-20261005/cleanup-report.json` |
| timeline 缺 `sounds` | AMF3 键缺失 → F1009 | 3 | `local-evidence:liangyue-f1009-fix-1.4.134/` |
| C7101 + 潜在 C7050 | Bool/枚举空串 | 4 | `local-evidence:liangyue-c7101-fix-1.4.135/` |
| 详情页 F1009 | Option 空串 → `Some(null)`/`Some(0)` | 4 | `local-evidence:liangyue-ability-description-fix-1.4.136/` |
| 「null角色」 | 组格空串 → 空数组 → null 渲染 | 4 | `local-evidence:liangyue-group-nullrole-fix-1.4.137/` |
| 「+0」显示 | `initial_multiply` 空串 → 0 | 4 | `local-evidence:liangyue-zero-value-fix-1.4.138/` |
| U 徽章间距 | 共享 ui_string 行缺尾随空格 | 7 | `local-evidence:liangyue-unison-icon-spacing-fix-1.4.139/` |
| 插画裁剪/遮罩 | 22 张 medium PNG + `trimmed_image` 2 行 + 八类遮罩 | 6 | `local-evidence:liangyue-illustration-crop-mask-fix-1.4.142/` |
| 像素 atlas 偏移事故 | `fx/fy` 补偿符号反 + 错误符号模型 | 6/8 | `local-evidence:liangyue-base-frame-fix-1.4.143/`、`liangyue-revert-base-frame-fix-1.4.144/`、`liangyue-base-frame-fix-v2-1.4.145/` |
| `_sp` 合成帧污染基础态 | 基础状态引用合成帧 | 6 | `local-evidence:liangyue-base-frame-fix-20261006/修复报告-基础帧与召唤物归位-20261006.md` |
| 共享 `unique_condition` 22 行 | 双形态钩子共用状态行 | 7 | `local-evidence:liangyue-base-frame-fix-20261006/dual-form/双形态候选报告-20261006.md` |

## 11. 工具与脚本索引

- 链解析与发布：`tools/lens-integration/prepare_content.py`；历史任务侧 `build_edge_*.py` / `finalize_*.py`（本地批次脚本，不随仓库提供）。
- 门禁脚本（fail-closed，退出码非 0 即失败）：
  - `tools/lens-integration/check_timeline_sounds.py`
  - `tools/lens-integration/check_ability_strong_fields.py`
- 规则库与生成器（两个正式仓库的共享模块保持同步）：`tools/fantasy-gauntlet-mod-tools/wf_client_legality.py`、`wf_ability_composer.py`；`StarPoint-Character-Studio:core/` 同名副本。
- 工作室编译：`StarPoint-Character-Studio:studio_compile.py`（`compile_pixelart` 输出官方四键）。
- 回归测试：`tools/fantasy-gauntlet-mod-tools/tests/test_client_legality.py`、`StarPoint-Character-Studio:tests/test_client_legality_bool.py`、`StarPoint-Character-Studio:tests/test_studio.py`。
- 解析器回放：`tools/inaho-integration/verify_native_master_fields.py`；历史任务侧 `replay_rows_from_file.py` / `describe_replay.py`（本地旁证脚本，不随仓库提供）（`local-evidence:liangyue-f1009-20261005/f1009/`）。
- 卫生检查：`scripts/check-hygiene.sh --all`（无 Bash 时用 `<CODEX_HOME>/skills/starpoint-cn-mod-tools/scripts/check_hygiene_windows.py`）。

## 12. 维护约定

- 新事故修复完成后，把案例补进第 10 节，并把对应检查补进第 1–8 节；“经验已在文档 ≠ 已进门禁”，未形成脚本/断言的条目必须标注为未落地；
- 本清单与 SKILL（`starpoint-cn-mod-tools`）同步更新：SKILL 的新角色段落以本清单为入口；
- 本清单为客观技术记录，不包含会话内容；个人化偏好只留在本地工作区规则。

## 13. 工坊与服务端的边界：共享模块同步策略 + 门禁归属表（2026-10-06）

### 13.1 项目边界

- **工坊（StarPoint Character Studio）** 是独立项目与独立仓库（`Ku1o/StarPoint-Character-Studio`，GPLv3）：面向角色创作者的本地工作台，负责立绘/界面图片/像素动作/特效/声音与能力草稿，导出 `.wfchar` 工程与候选资源。
- **服务端** 是本仓库（`Ku1o/startpoint-cn-kulo`）：负责资源链与交付（`assets/asset-patch/active/*.zip`、`manifest.json`、`audit/`、版本边、准入）。工坊源码由其独立仓库维护，不是本仓库的一部分；开发期额外克隆及本机忽略配置不作为源码定位或同步依据。
- 两层通过**候选包 + 回执**衔接，不互相 import：工坊产出候选与校验回执，服务端门禁 fail-closed 校验后登记边。

### 13.2 共享模块同步策略

正式工坊仓库的 `StarPoint-Character-Studio:core/` 与本仓库 `tools/fantasy-gauntlet-mod-tools/` 下的同名模块属于**同源共享模块**，内容必须一致（允许的差异只有行尾）。每次提交均以两个正式仓库的实际文件为准；开发期额外克隆的核对结果不能代替正式仓库核对。

规则：

1. 修改共享模块（`wf_client_legality.py`、`wf_ability_composer.py`、`wf_dsl.py`、`wf_describe.py`、`ability_enum_map.json`、`wf_mod_tool.py`、`wf_assets.py`、`wf_character_requirements.py`、`wf_flatomo_preview_render.py`、`词条条件代码全表.md`、`LICENSE`）时，工坊侧与服务端侧**同批修改**；
2. 仅工坊侧需要的适配必须在工坊提交信息里登记，不得静默漂移；
3. 提交前显式指定两个正式仓库根目录，分别读取工坊 `core/` 与本仓库 `tools/fantasy-gauntlet-mod-tools/` 的同名文件，仅归一化 CRLF/LF 后比较；文件缺失或内容差异均视为未同步，不依赖嵌套克隆布局。模块来源见 `StarPoint-Character-Studio:CORE-PROVENANCE.md`。

### 13.3 门禁归属表

| 层 | 门禁 | 实现/入口 | 回执 |
| --- | --- | --- | --- |
| 工坊 | 官方模板键集与 deepcopy（timeline 四键等） | `StarPoint-Character-Studio:studio_compile.py` | 键集断言 |
| 工坊 | `_sp` 合成帧与状态声明（基础态用纯本体） | `StarPoint-Character-Studio:pixel_import.py`、`StarPoint-Character-Studio:web/pixel-import.js`、动作卡声明字段 | 导入提示 + 工程声明 |
| 工坊 | 像素图集锚点（客户端语义 `fx/fy`）逐帧回归 | `StarPoint-Character-Studio:studio_compile.py` | 锚点差值 = 0 |
| 工坊 | UI 裁剪与 8 类形状遮罩（比例 ≤0.3%） | `StarPoint-Character-Studio:portrait_editor.py` | 覆盖/形状比对 |
| 工坊 | 声明行 schema 与先例（Bool/枚举/`(None)`） | `StarPoint-Character-Studio:core/wf_client_legality.py`、`StarPoint-Character-Studio:core/wf_ability_composer.py` | 问题清单 |
| 工坊 | 包内必读、声明字段、三段式检查 | `StarPoint-Character-Studio:studio_core.py` | 检查报告 |
| 服务端 | 输出路径断言（禁 `.cdn`；`active/` + manifest + `audit/`）、outer key union、结构契约、解析器契约 | `tools/fantasy-gauntlet-mod-tools/wf_character_gates.py` + CLI `tools/lens-integration/check_character_edge.py` | fail-closed CLI 输出 / 逐键 diff |
| 服务端 | 发布链（边号、manifest、audit、离线终态）与 `wf_character_flow` preflight；HTTP 按需 | `tools/fantasy-gauntlet-mod-tools/wf_character_flow.py` + 发布脚本；`tools/cdn-http-probe.cjs` | manifest/audit/实际检查回执 |
| 客户端（按需） | SWF/APK/IPA 构建与准入推进 | 本仓库 `client-patch/`（需单独授权） | 客户端验收登记 |
