# AGENTS.md

> **`CLAUDE.md` 与 `AGENTS.md` 除首行标题外必须逐字相同。**
> 两者分别被 Claude / Codex 读取；内容分裂会导致两个执行者依据不同规则工作。
> 改动任何一份，必须同步改另一份。

StarPoint CN — 世界弹射物语(World Flipper)CN(雷霆)版服务端模拟器。
Fastify + TypeScript，CN 服务入口 `src/cn-server.ts`（端口 8001），国际服入口 `src/server.ts`（8000）。

## 当前状态入口（2026-09-02 起）

- **唯一当前状态入口**：`work/agent-coordination/当前状态与优化计划-<最新日期>.md`（现为 20260902）。开工先读它，再读
  `docs/协作对齐-Claude-Codex.md` 与两份实时状态 `work/agent-coordination/claude-to-codex.md` / `codex-to-claude.md`。
- 其余日期化任务书/清单/交接一律只当历史证据；已冻结的在各 `frozen/<日期>/`，禁止据其施工。
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
- 资产整理必须执行 `scan → plan → preflight → quarantine → verify → restore drill`。
  隔离不等于删除，`purge` 需要单独明确授权和精确确认口令。
- 当前工程验收证据见 `docs/engineering-verification-2026-07-15.md`。

## 硬性约束

- **多执行者对齐**：本项目同时由 Claude 与 Codex 施工。协作协议、冲突处理、事实/判断/决定的标注方式
  见 `docs/协作对齐-Claude-Codex.md`（**开工前必读**）。
- **迁移期间旧后台零改动**：`web/pages/`、`src/routes/web/`、`web/public/` 在 M4 之前不许修改/删除
- 最终要向上游 `DontBeAlarmed/startpoint-cn` 提 PR，commit 保持小而清晰（`feat(admin):` / `refactor(web_api):`）
- 定期 `git rebase origin/main`
- 全仓 LF（`.gitattributes` 已配置）；不要提交 `web/dist`、`admin/node_modules`
- 未跟踪的 `decompile/`、`ffdec_26.2.1/`、`pc-run/`、`弹国服/`、`assets/*.backup.json`
  是本地逆向工作区，别动也别提交
- `mod-tools/` **是例外：它被 git 跟踪**（工具代码、文档、schema、测试照常提交；
  `mod-tools/work/`、`edit/`、`*.csv`、`profiles.json` 已 gitignore）。
  它目前只存在于 `release/modes-20260714`，不在 main / dev / 上游。最终归属待重构拍板。
- 已修改的 `assets/*.json`、`assets/cdndata/*.json`、`work/` 和未跟踪角色方案文档默认属于用户 WIP；
  未证明归属前不覆盖、不还原、不提交，也不得用 `git clean` 批量处理
- 依赖变更后根目录与 `admin/` 的 `npm audit` high/critical 必须为 0

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

## 已知坑

- 玩家详情数据量大（角色/道具数千行），前端用 AntD Table 虚拟滚动或分页
- `@fastify/multipart` 已在 web_api 注册（存档导入用），新端点勿重复注册
- 后台已按页面 lazy-load，并由 Vite 8/Rolldown 拆包；修改依赖分组或路由后必须保留
  `admin/scripts/check-bundle.mjs` 的单 chunk 与业务路由预算，不能用提高阈值掩盖回归
- 改 `src/` 后必须 `tsc`，否则服务端跑的是 `out/` 里的旧产物；验收先比 ts/js mtime
