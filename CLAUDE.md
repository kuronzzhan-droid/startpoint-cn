# CLAUDE.md

> **`CLAUDE.md` 与 `AGENTS.md` 除首行标题外必须逐字相同。**
> 两者分别被 Claude / Codex 读取；内容分裂会导致两个执行者依据不同规则工作。
> 改动任何一份，必须同步改另一份。

StarPoint CN — 世界弹射物语(World Flipper)CN(雷霆)版服务端模拟器。
Fastify + TypeScript，CN 服务入口 `src/cn-server.ts`（端口 8001），国际服入口 `src/server.ts`（8000）。

## 开工顺序

- 先读 `work/agent-coordination/当前状态.md`（不带日期、始终当前、不超过 60 行的共同入口）。任务涉及代码、共享表、发布或接管时，
  再读 `work/agent-coordination/codex-to-claude.md` / `claude-to-codex.md` 的**顶部当前状态段**（不读全文）和
  `docs/协作对齐-Claude-Codex.md` 中与任务相关的章节。纯问答、只读调研、单文件小改不需要读协作对齐全文。
- 带日期的任务书/清单/交接一律只当历史证据；已冻结的在各 `frozen/<日期>/`，禁止据其施工。
- 主线：自制角色/模式/深渊武器/发布链（分支 `custom/characters-1.4.407`，live 链尾以 `wf_publish.py --list` 报告为准）。
- 后台管理界面重构（feature/admin-ui，M0–M3 已完成，M4 须作者同意）的历史进度见 `docs/admin-refactor-plan.md`。

## 工程基线（2026-07-15）

- Node.js 最低版本 `20.19.0`；根目录和 `admin/` 使用 `npm ci`，不得绕过 lockfile。
- Fastify 5 与插件版本已锁定在已验证兼容组；Vite 8/Rolldown 已启用按路由拆包和构建预算。
- Windows 启动入口为 `start-cn.bat`：从 `.env` 读取地址，校验构建新鲜度和 PID 所有权；
  端口属于陌生进程时必须拒绝，禁止按端口或进程名直接终止。
- Linux `scripts/start-cn.sh` 以前台方式运行，生命周期交给终端或 systemd；禁止恢复宽泛进程匹配。
- 新角色整包必须走 `mod-tools/wf_character_flow.py`：production 发布要求 37/37 必需资产、
  完整 manifest/hash/seal、三层一致和无漂移 preflight；普通单表修改才直接走 `wf_publish.py`。
  角色已由 flow 管理（`work/character_packs/<pack>/` 存在且被 active 引用）时，单表改动也必须回写该包 workspace 的候选
  （或改 workspace 后 `flow publish`）；`wf_publish` 裸表边只是让它先生效，**回写 workspace 是同一任务的一部分**，不回写视为未完成。
- 资产整理必须执行 `scan → plan → preflight → quarantine → verify → restore drill`。
  隔离不等于删除，`purge` 需要单独明确授权和精确确认口令。
- 当前工程验收证据见 `docs/engineering-verification-2026-07-15.md`。

## 硬性约束

- **多执行者对齐**：本项目同时由 Claude 与 Codex 施工。协作协议、冲突处理、事实/判断/决定的标注方式
  见 `docs/协作对齐-Claude-Codex.md`（读法见「开工顺序」）。
- **迁移期间旧后台零改动**：`web/pages/`、`src/routes/web/`、`web/public/` 在 M4 之前不许修改/删除
- 最终要向上游 `DontBeAlarmed/startpoint-cn` 提 PR，commit 保持小而清晰（前缀 `feat/fix/refactor(<模块或角色>)`）
- `git rebase origin/main` 只在作者要求时做；工作区有未提交 WIP 时先说明再做
- 全仓 LF（`.gitattributes` 已配置）；不要提交 `web/dist`、`admin/node_modules`
- 未跟踪的 `decompile/`、`ffdec_26.2.1/`、`pc-run/`、`弹国服/`、`assets/*.backup.json`
  是本地逆向工作区，别动也别提交
- `mod-tools/` **是例外：它被 git 跟踪**（工具代码、文档、schema、测试照常提交；
  `mod-tools/work/`、`edit/`、`*.csv`、`profiles.json` 已 gitignore）。
  它在 `custom/*`、`release/*` 分支被跟踪，不在 `origin/main`、`dev`、上游。最终归属待重构拍板。
- 已修改的 `assets/*.json`、`assets/cdndata/*.json`、`work/` 和未跟踪角色方案文档默认属于用户 WIP；
  未证明归属前不覆盖、不还原、不提交，也不得用 `git clean` 批量处理。
  这条约束的是用户 WIP 本身；对同一文件做键级修改并提交自己那部分不受此限（见「提交」）
- 依赖变更后根目录与 `admin/` 的 `npm audit` high/critical 必须为 0
- **授权分级（常设，不必逐次再问；作者 2026-09-15）**：
  - 作者提出的改数据/改代码请求本身即授权：键级改 live store 与 `assets/*`、登记 pending、构建、聚焦测试、本地验证。
  - **本地发布**（`wf_publish.py` 铸边到本机 `.cdn`、`./start-cn.bat -RestartOwned`、`reload_assets`、重启本机 MuMu 里的游戏）
    是改数据任务的一部分，默认做，回复附 `wf_publish.py --list` 摘要（版本边、键数）；作者说「先别发」「只改不发」时停在 pending。
    本机 8001 仅作者自用，改了 `out/` 或静态 JSON 后直接 `-RestartOwned`；禁止的仍是清理陌生端口占用者。
  - 下列动作每次都要作者在当次请求里明确说，不得从「改一下 X」推断：整包 `flow publish`（已有 `--confirm` 口令）、
    公开链/overlay/Release/分享包投递、发给灰服、APK 安装到设备、设备直推、`purge`、push 到任何远端、
    `active.json` 之外的链回退。
- **提交**：完成一个可独立描述的单元即 commit（作者纪律第 3 条，视为常设授权，不必再问）。只暂存自己改的文件或 hunk
  （`git add <file>` / `git add -p`），禁止 `git add -A`。文件同时含用户 WIP 与自己的改动时，用 `git add -p` 只提交自己的 hunk；
  无法分离时不提交，并在 `work/agent-coordination/当前状态.md` 登记「未提交：<文件>：<原因>」。push 一律需作者要求。

## 常用命令

```bash
npm run verify           # 服务端/后台/Python 工具完整验收
npm run typecheck        # 仅服务端 TS 检查（快）
npm run test:python      # mod-tools 测试（unittest discover，本机无 pytest）
npm run test:launcher    # Windows + Linux 启动安全门禁
npm run test:hygiene     # 仓库卫生检查器隔离测试
npm run check:hygiene    # 全仓路径安全扫描
npm run dev:cn           # 构建 + 前台启动 CN 服务(8001)
npm run dev:admin        # Vite 热更新(5173)，/api 代理到 8001
npm run build:admin      # 构建 SPA 到 web/dist，并执行 bundle budget
```

**验收口径**：改 `src/` → `npm run typecheck` + 相关 `src/tests` 聚焦测试；改 `mod-tools/` → 对应 unittest 模块；
改发布器/校验器/启动器/hygiene → 再加 `test:launcher`、`test:hygiene`；全仓 `npm run verify` 与 `check:hygiene`
只在依赖变更、发布工具变更或作者要求时跑。全仓已知红项登记在 `docs/verify-baseline.md`；与基线相同的红不算失败，
**新增红项才算**，回复写「聚焦 N 项通过；全仓与基线一致」。基线变化时更新该文件并单独 commit。

## 已知坑

- 玩家详情数据量大（角色/道具数千行），前端用 AntD Table 虚拟滚动或分页
- `@fastify/multipart` 已在 web_api 注册（存档导入用），新端点勿重复注册
- 后台已按页面 lazy-load，并由 Vite 8/Rolldown 拆包；修改依赖分组或路由后必须保留
  `admin/scripts/check-bundle.mjs` 的单 chunk 与业务路由预算，不能用提高阈值掩盖回归
- 改 `src/` 后必须 `tsc`，否则服务端跑的是 `out/` 里的旧产物；验收先比 ts/js mtime
