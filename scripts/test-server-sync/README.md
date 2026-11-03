# 测试服 → GitHub 自动同步

把测试服（175）上的服务端代码和资源表单向同步到本仓库的 `test-server` 分支。`main` 不受影响，需要时再从 `test-server` 挑内容合进 `main`。

测试服没有装 git，也连不上 github.com（只能连 api.github.com），所以 `sync.cjs` 直接调用 GitHub REST API：按 git 的方式算文件哈希，和分支上的树比对，只上传有变化的文件，生成一个提交并移动分支。

## 什么时候跑

- 计划任务每天 04:00（服务器时间）跑一次（`install-task.ps1` 注册），没有变化就直接退出，不产生提交
- 发布线程发布完也可以手动跑一次：`node C:\startpoint-sync\sync.cjs`
- 有文件大小+修改时间缓存，没变化的文件不会重新读取
- 10 分钟内有文件被改过（可能正在发布）就跳过本次，第二天再同步，或发布后手动跑，避免推上换了一半的文件

## 同步什么

白名单目录：`src` `out` `assets` `web` `scripts` `tools` `admin` `data` `docs` `client-patch` `apk-patches` `deployment`，以及 `package.json` 等根文件。

`out/` 一定要同步：测试服实际运行的是 `out/` 里的 JS，10-22 以后很多改动只在 `out/` 里，`src/` 没有跟上。

永远不同步：`.env` 和 `.env.*` 备份、`*.bak` / `*.pre-*` 备份、密钥/证书、APK、存档和数据库、日志、`node_modules`、`.cdn`、`config/`、`tmp/`、`*.zip`（补丁包照旧放 Release）、`*.backup.json`、可执行文件。超过 50MB 的文件、新增的超过 1MB 的二进制文件会跳过并写进报告。被排除的文件即使分支上有，也不会被删掉。

文本文件统一转成 LF（和仓库的 `.gitattributes` 一致）。

## 推送前的检查

每个新增/修改的文本文件都会扫描：GitHub / AWS / API 令牌、私钥、测试服和 StarView 的 IP、局域网 IP、个人家目录路径、个人邮箱，以及同步令牌本身。命中任何一项就整次放弃，结果写进 `blocked.txt`，退出码 2。`C:\startpoint-sync\gitleaks.exe` 存在时会再用 gitleaks 扫一遍。

## 文件（都在 `C:\startpoint-sync`）

| 文件 | 用途 |
|---|---|
| `sync.cjs` | 同步脚本 |
| `token.txt` | fine-grained token，只能写本仓库的 Contents；权限收紧到 SYSTEM/Administrators |
| `sync.log` | 运行日志 |
| `last-diff.txt` | 最近一次的新增/修改/删除/跳过清单 |
| `blocked.txt` | 被安全扫描拦下时的命中清单 |
| `hash-cache.json` | 哈希缓存，可以随时删 |

## 安装

1. 把 `sync.cjs`、`install-task.ps1` 拷到测试服，令牌存成 `C:\startpoint-sync\token.txt`
2. 先试跑：`node C:\startpoint-sync\sync.cjs --dry-run`，看 `last-diff.txt` 和 `blocked.txt`
3. 管理员 PowerShell 运行 `install-task.ps1`（要按间隔跑就加 `-EveryMinutes 60`）

## 失败时

网络错误和限流会自动等待重试。分支只在提交建好之后才移动，中途失败不会留下半个提交，下次运行会重新比对。
