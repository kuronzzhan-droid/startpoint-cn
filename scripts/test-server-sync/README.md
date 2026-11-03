# 测试服 → GitHub 自动同步

把测试服（175）上的服务端代码和资源表单向同步到本仓库的 `test-server` 分支。`main` 不受影响，需要时再从 `test-server` 挑内容合进 `main`。

## 什么时候跑

- 每次测试服发布完，发布流程最后执行一次 `sync.ps1`
- 计划任务每天 04:30 兜底执行一次（`install-task.ps1` 注册）
- 没有变化时直接退出，不产生提交

## 同步什么

白名单目录：`src` `assets` `web` `scripts` `tools` `admin` `data` `docs` `client-patch` `apk-patches` `deployment`，以及 `package.json` 等根文件。

永远不同步：`.env*`、密钥/证书、APK、存档和数据库、日志、`node_modules`、`out`、`.cdn`、`config/`、`*.zip`（补丁包照旧放 Release）、`*.backup.json`、可执行文件，以及超过 20MB 的单个文件。

推送前依次检查：gitleaks 扫描暂存内容、`scripts/check-hygiene.sh`（个人 IP / 路径 / 邮箱）。任何一项不过就放弃本次提交。

## 安装（175 上，一次性）

1. 建目录 `C:\startpoint-sync`，放入 `sync.ps1` 和 `gitleaks.exe`
2. 在 GitHub 建 fine-grained token：只选本仓库，权限只开 Contents 读写；内容保存为 `C:\startpoint-sync\token.txt`
3. 先试跑：`powershell -ExecutionPolicy Bypass -File C:\startpoint-sync\sync.ps1 -DryRun`，看 `sync.log`
4. 管理员 PowerShell 运行 `install-task.ps1`：注册计划任务，并把 token 文件权限收紧到 SYSTEM/Administrators

令牌只在每条 git 命令里临时作为 HTTP 头传入，不写进 `.git/config` 或远程地址，日志里会打码。

## 失败时

日志在 `C:\startpoint-sync\sync.log`。推送失败会重试 4 次，仍失败就把提交留在本地，下次运行一起推。
