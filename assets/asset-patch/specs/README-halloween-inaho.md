# 万圣稻穗稀疏重建

`assets/asset-patch/specs/halloween-inaho-1.4.258.json` 是可移植输入，包含 18 张表的 27 个新增外层键及原始行字节、108 个非表资源的成员名与 SHA-256、1 个共享基线声音依赖，以及 5 个服务端 JSON 的新增键内容。

`tools/rebuild_character_edge.py` 只需要 Python 标准库。它读取显式指定的本地资源链，按新增键合并，逐字节保留旧压缩行；不会启动服务、修改输入 manifest、覆盖输入 JSON 或修改只读基线。输出必须使用尚不存在的新目录。缺失归档、哈希不符、链断裂、旧键冲突或任一分包达到 5 MiB 均停止。

示例从仓库根执行，先把本批六个 ZIP 放到 `art-input` 目录；按实际本地 manifest 选择版本号和路径：

下面的 257→258 示例必须提供**尚未加入角色 169977 的 1.4.257 manifest，以及同一底稿下尚未加入 169977 的五份服务端 JSON**。已应用本边、链已到 258 或已含私有键的目录，不能直接重复执行；应另行提供干净的 257 底稿。仅把命令版本改大不会绕过私有键冲突检查。

```powershell
python tools/rebuild_character_edge.py `
  --spec assets/asset-patch/specs/halloween-inaho-1.4.258.json `
  --manifest assets/asset-patch/manifest.json `
  --active assets/asset-patch/active `
  --baseline .cdn/cn `
  --server-root . `
  --art-dir art-input `
  --from-version 1.4.257 `
  --to-version 1.4.258 `
  --output prepared-halloween-inaho-258
```

可重复传 `--active` 指向已下载的归档缓存；所有命中的有效链包仍按 manifest 摘要核对。不自动联网寻找缺失输入。`--baseline` 必须是正式只读 pristine `cn` 根目录；只采用 full 包和版本不高于 `--baseline-version`（默认 `1.4.54`）的 diff 包。

本批六个 ZIP 只作为**非表美术/声音载荷来源**：工具按 spec 的 `artArchive`、`member`、`size`、`sha256` 读取 108 个成员。工具绝不读取这些 ZIP 中的旧全表作为底稿。所有表底稿均从指定目标链重新解析；五份服务端底稿从 `--server-root` 读取。共享 `se_dark_hit_shadow.mp3` 必须在目标有效链已有相同字节，因此省略重发。

输出包括六个新边 ZIP、`manifest-entry.json`、五份合并后 JSON、独立 `server-additions.json`、18 张表 preimage 与 `rebuild-proof.json`。这些是准备文件，实际应用、提交、发布和设备验证分别执行。若目标已经包含角色私有键，工具会拒绝重复安装，不会替换既有角色。

manifest 的启用条目出现重复 version 时拒绝构建；禁用历史条目的同号版本不会形成生效链冲突。重复 id 仍检查全部条目；输出版本号已被任意条目（包括禁用条目）占用时，也拒绝构建，避免重占候选号。输出分组必须从 1 开始连续。控制台和 proof 会列出已有 active 包对本次表底稿的覆盖，作为提示而非阻断。本次 18 张表中有 17 张由 pristine 基线之后的 active 包提供最终底稿，剩余 `story_character` 表来自 pristine 基线；工具在这些实际终态上追加声明行。

当前 257→258 重建与主成品的六个 ZIP、manifest 条目和五份 JSON 均逐字节相同。缺包和私有键冲突两种故障注入均以非零退出且不产生输出目录。该证据仅覆盖离线构建、结构与资源身份；游戏表现和设备验收尚未执行。本边不包含其他角色的 14 项 iOS 切入图修复。

管线后续修改可用 `python tools/test_rebuild_character_edge.py` 一条命令运行 8 项标准库回归。测试使用临时合成极小 ZIP、表与 spec，检查旧压缩行保留、键冲突、缺包、enabled 同版本冲突、disabled 历史同版本兼容、候选版本号占用、重复 id 和分组断号；不依赖本角色大文件。
