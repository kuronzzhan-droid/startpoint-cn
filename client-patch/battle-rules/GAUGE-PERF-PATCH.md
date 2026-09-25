# 回槽提前拦截补丁与修改流程（2026-09-25）

## 交付范围

【决定／作者】以后默认交付补丁源码、应用工具、校验信息和流程说明；只有明确要求时才附完整 APK。优先复用工作区已有源码和构建记录，不为提取已有修复重新反编译。

【事实／2026-09-25】本次修复源码已在提交 `f85939b4` 中。独立包不含 APK、完整 SWF、游戏资源、存档或签名密钥。附带的 `fix-gauge-performance.patch` 是该提交的 Git 补丁；`client-patch/` 是运行所需的最小源码依赖。

这是在 9 月 24 日 1.4.1043 分享包客户端上追加今天的两处修复。此前的通用回槽来源限制、伤害类型转换、PF3 分类和语音修复由旧客户端提供，本包保留它们，不重新实现它们。它不能直接用于官方原版或任意未知客户端。

## 找到的源码与实际变化

| 文件 | 用途 |
| --- | --- |
| `client-patch/battle-rules/gauge_effect_guard.py` | 生成目标回槽演出之前的拦截指令 |
| `client-patch/battle-rules/gauge.py` 的 `filter_body` | 先匹配来源位，再求活动条件 |
| `client-patch/battle-rules/gauge_perf_overlay.py` | 校验旧 SWF，只改两个方法，验证无关方法不变 |
| `client-patch/battle-rules/apply_gauge_perf.py` | 从 APK 直接读取主 SWF，或使用现有 SWF，输出修复文件 |
| `client-patch/battle-rules/build_apk.py` | 使用接收方原 APK 和原签名重打包，检查无关资源不变 |

【事实】旧流程先创建 `AbilityPerpetuity` 回槽特效，再到 `reserveSkillPoint`／`reserveFixedSkillPoint` 拒绝入账。虽然槽值可以不增加，连续触发时仍有无效特效开销。

修改后的流程：

1. 保留原方法死亡、零倍数等前置检查。
2. 只检查比例回槽（content 8）和固定回槽（content 9）的实际正向增量。
3. 使用本次触发来源判断接收角色是否禁止这次回槽；禁止则在创建目标特效和排队加槽之前返回。
4. 正常增益继续原生路径；零值、扣槽和其他能力效果保持原逻辑。检查后恢复外层来源上下文，不额外创建来源对象。
5. 规则先做来源位筛选，匹配后才计算活动条件，避免移动充能反复求值不相干的限制。

只改 `MemberImpl/applyInstantAbility` 和 `MemberAbilityTotalizerImpl/wfBlocksGauge`。不改变触发次数、冷却和其他能力，不缓存跨帧条件，不合并触发器调用。

## 使用方法

先解压整个补丁包，保留目录结构。需要 Python 3.10 或以上，无第三方 Python 依赖；应用补丁不需要 FFDec、AS3 导出或反编译。

### 1. 仅检查对方客户端

在解压目录运行：

```powershell
python -X utf8 client-patch/battle-rules/apply_gauge_perf.py --input "D:/receiver/old.apk" --check
```

- `ready`：主 SWF 与已验证的旧基线一致，可以应用。
- `already_patched`：已有今天的修复，不重复写文件。
- `Unknown SWF baseline`：对方主程序有其他修改或版本不同，拒绝覆盖。保留对方客户端，按下面的合并流程处理。

APK 其他成员和签名不同，不会仅因此拒绝；主 SWF 内容必须符合基线。服务端地址若修改在 SWF 内，也会触发基线拒绝，不能强行取消校验。

### 2. 生成修复后的 SWF

```powershell
python -X utf8 client-patch/battle-rules/apply_gauge_perf.py --input "D:/receiver/old.apk" --output-dir "D:/receiver/gauge-fix-output"
```

也可把 `--input` 改为工作区里已有的 `.swf`。输出目录必须不存在；输入保留不变。成功后得到：

- `baseline.swf`：从输入读取的旧主程序，便于核对。
- `gauge-performance.swf`：修复后的主程序。
- `patch-report.json`：两方法前后哈希、无关方法保持证据。
- `prepare-report.json`：输入、输出及应用结果。

【事实】脚本只解析和改写 SWF 的 ABC 字节码，不经过 AS3 全量回编。应用输出才含完整 SWF，交付 ZIP 本身不含。

### 3. 接收方本地封装签名

接收方自行提供原 APK、其原签名 keystore、JDK 与 Android build-tools。先在接收方本地安全设置口令环境变量 `WF_PATCH_KS_PASS`；补丁中不保存口令。

```powershell
python -X utf8 client-patch/battle-rules/build_apk.py `
  --base "D:/receiver/old.apk" `
  --swf "D:/receiver/gauge-fix-output/gauge-performance.swf" `
  --patch-report "D:/receiver/gauge-fix-output/patch-report.json" `
  --output "D:/receiver/fixed.apk" `
  --work "D:/receiver/apk-build-new" `
  --zipalign "D:/Android/build-tools/34.0.0/zipalign.exe" `
  --apksigner "D:/Android/build-tools/34.0.0/apksigner.bat" `
  --keystore "D:/receiver/original.keystore" `
  --ks-pass-env WF_PATCH_KS_PASS
```

如私钥口令不同，另设环境变量并传 `--key-pass-env`。输出 APK 和工作目录使用新路径。工具会核对基线 SWF、原签名证书、所有非 SWF 成员、压缩类型和 ZIP 完整性。原输入不变。生成的 APK 留在接收方本地；工具不会安装设备。

原签名私钥必须由接收方自己持有；本包不提供替代签名或卸载重装流程。

## 工作区修改与合并流程

【决定／本轮执行】按“找现成源码 → 确定接收方基线 → 最小改动 → 聚焦验证 → 单独补丁交付”进行。

1. 先查 `client-patch/battle-rules/` 和 Git 提交 `f85939b4`，复用上述已有实现及测试。完整仓库可先执行 `git apply --check fix-gauge-performance.patch`；确认该提交尚未合入且检查通过后才应用。已包含该提交的仓库不用再应用。
2. 从对方 APK 中读取 `assets/worldflipper_android_release.swf`，或直接用其工作区 SWF。记录 SHA-256，读取 APK 成员不等于反编译。
3. 已知基线用本包脚本；未知基线先比较这两个方法、已有 `wfAllowsGauge`／`wfGaugeContext` 及常量池。保留对方地址和其他补丁；同方法冲突需三方合并。当前自动工具明确不支持未知基线，不能删除 SHA 校验后强打。
4. 在指令层插入 guard、更新筛选方法；校验栈深、局部变量、跳转及异常表。AVM2 向后跳转入口必须是实际 `label` 指令，不能只用汇编符号标签。
5. 核对原指令可恢复、仅两个方法体变化、其余 92560 个方法体保持，再对输出 SWF 做字节级回读。使用新基线合并时应重新建立对应的验证证据，不套用本包旧哈希。
6. 使用对方原 APK 和原签名本地封装，检查其非目标资源和证书保持。发布补丁源码与哈希，不默认分享生成的完整 APK。
7. 安装后核对实际运行 SWF，而不只看应用版本号。AIR 可能保留旧程序缓存；仅在安装／缓存操作获授权时处理该应用的程序缓存，保留存档和下载资源。
8. 原掉帧队伍验证：开局充能和正常跑条保留，战斗中的技能／能力回槽不加槽、不刷无效准备特效；分开记录静态检查、安装和实战结果。

## 数据依赖与校验

【事实】月兔全队限制还依赖 1.4.1045 的资源修复：`ability[1499872]` 的 `c111` 由空字符串改为 `(None)`，避免空角色列表导致规则不选中任何人。1.4.1047 分享包已经包含该资源修复。本独立包只提供客户端补丁；对方仍需应用此前资源包中的相应资源。

【事实】已验证基线主 SWF SHA-256：

`b113c90c3bccaf48eb0874512e862213dc91c9221882c061748fbe191478ad5e`

目标主 SWF SHA-256（与 1.4.1047 分享包内客户端一致）：

`6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497`

9 月 24 日参考 APK SHA-256（仅供辨认，不作为唯一输入条件）：

`21f0d6b37bec1007c47109e9059391a802c47720df4ceb3cb8ed8e3dd5cf6935`

`SHA256SUMS.txt` 覆盖包内文件；`verification.json` 记录本次提取和隔离演练结果。此前本机月兔两局已验证直接加槽仅保留开场；这不代表对方设备已通过测试，也不承诺所有场景的帧率。
