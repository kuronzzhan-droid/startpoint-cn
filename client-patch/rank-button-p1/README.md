# rank-button-p1 · 官方皇冠「排名」钮上屏（置灰不可点）

对应方案文档 `mod-tools/docs/排行榜类移植-可行性与方案-20260827.md` 的 **P1 阶段**。
**本期只做「按钮可见 + 置灰 + 点不动」**，不接跳转（跳转是 P2）。
目的：把「美术资源 / 布局槽位 / 常量池 / P-code 汇编」四类风险单独隔离验掉。

---

## 改了什么

两个方法，纯方法级 P-code 手术。**不新增类、不调 FFDec 的 AS3 编译器、不新增任何常量池条目。**

| 手术 | 类 / 方法 | 改动 |
|---|---|---|
| A | `pinball.scene.event.rush.top:RushEventTopScene/run` | 按钮 id 数组 `[0,1,2,3,4]` → `[0,1,2,3,4,5]`；追加 `buttonGroup.get(5).set_enabled(3)` |
| B | `pinball.scene.event.rush.top:RushEventTopView/run` | 末尾追加 `addWithConfig(5, getButtonLayer(3,1), buttonSize, ButtonConfigs.ranking)` |

反编译回读（补丁后的 SWF，FFDec 独立导出）：

```as3
// RushEventTopScene.run
buttonGroup = new ButtonGroupLogic(buttonClicked,[0,1,2,3,4,5]);
...
buttonGroup.get(3).checked = true;
buttonGroup.get(3).set_enabled(2);
buttonGroup.get(5).set_enabled(3);        // ← 新增：置灰 + 不可点
if(!event.isWithinPeriod(sceneTime)) { buttonGroup.get(4).set_enabled(4); }

// RushEventTopView.run
_loc4_.addWithConfig(4,_loc2_.getButtonLayer(4,2),_loc2_.buttonSize,ButtonConfigs.rushEventEndlessBattle);
_loc4_.addWithConfig(5,_loc2_.getButtonLayer(3,1),_loc2_.buttonSize,ButtonConfigs.ranking);  // ← 新增
```

### 为什么不撞两条铁律

- **铁律①（FFDec 整类回编不可靠）**：这里走的是 FFDec 的 **P-code 汇编器**（`-replace <class> <pcode> <bodyIndex>`），
  不是 AS3 编译器；补丁后全 ABC 只有 2 个 method body 变了，其余 92,547 个 body、
  全部 7 个常量池、method_info / instance_info / class_info / script_info 四张表**逐字节不变**。
- **铁律②（引用未验证的新定义）**：`ButtonConfigs` 是同方法里已经出现 5 次的老类；
  `ranking` 是 `boot_ffc6` 脚本初始化器在 boot 期就赋好值的老静态字段；
  `QName(PackageNamespace(""),"ranking")` 这个 multiname **基线常量池里本来就有**（索引 4496）。
  ⇒ 本补丁**零新增常量池条目**。

### 依赖的三条现成事实（本轮独立实测，非引用）

1. `ButtonConfigs.ranking = ButtonConfig.Circle({...})` —— 在 `boot_ffc6` script init 里赋值，
   `textImagePath = scene/general/sprite_sheet/bitmap_text-assets/ranking`、
   `disabledTextImagePath = .../ranking_gray`、`iconPath = .../vector_icon-assets/ranking`。
   `Circle` ⇒ `ButtonGroupView.addWithConfig` 走 case 1（`CircleButtonView`），不会掉进 `default: return`。
2. 三张图**都在 CN 客户端在用的图集里**：解 `scene/general/sprite_sheet.atlas.amf3.deflate`
   （store `upload/94/c238c788d5557f9ba757cf60f3f280c4650ded`，1750 条），
   `bitmap_text-assets/ranking`、`bitmap_text-assets/ranking_gray`、`vector_icon-assets/ranking` 三条全部命中。
   正向对照：同图集里 `ranking_reload` / `ranking_reload_gray` 也在，那是现役 `rankingEventQuestSelectReward` 在用的。
3. `getButtonLayer(锚位, 槽序)` 是**算出来的**，不是查布局资源：
   `QuestLikeSceneTemplateView.getButtonLayer` 现场 `new Sprite()`，锚位 3 → `x = safeArea.left + 96`，
   `y = 200 + (buttonSize.height + 16) * 槽序`。⇒ (3,1) 恰好在「任务」(3,0) 正下方一格，
   **不需要任何布局资源，也不可能"槽位不存在"**。

### A / B 两处必须同时上

`ButtonGroupView.registerButton(id, view)` 第一句就是 `param2.injectPeek(peek.get(id))`，
而 `ButtonGroupLogic.get(id)` 查不到 id 会 `throw ClientError(7504, "登録されていないボタン…")`。
⇒ **只上 B 不上 A = 进活动页当场抛**。两处在同一次 `-replace` 里一起改，构建器也把两个方法体
一起锁哈希，不存在半吊子状态。

### 置灰态为什么用 3 而不是 4

`ButtonEnableStateTools.isEnableUserInput`：`1/4 → true`，`2/3 → false`；
`ButtonViewBase.setEnabled`：`1/2 → showEnable()`，`3/4 → showDisable()`。
P1 要的是**置灰 + 点不动** ⇒ **3**。（方案文档 §4.2 说的 4 是「置灰但可点、点了弹说明」，那是 P2 的形态。）
输入闸在 `CoreButtonView.processTouch` / `ButtonLogic.inputHandler`，触摸在到 `clickHandler` 之前就被丢掉，
`buttonClicked` 根本不会收到 5；而且 `buttonClicked` 的 switch 无 `default` 分支，落空即返回，**不会抛**。

---

## 构建

```powershell
$env:WF_APK_KS_PASS = "<keystore 口令>"    # 不设也行，构建器会走项目本地既有凭据源，全程不打印
python -X utf8 D:\WF\startpoint-cn\client-patch\rank-button-p1\build_rank_button_p1.py `
  --base-apk "C:\Users\12101\Documents\MuMu共享文件夹\device_base.apk" `
  --out-dir  D:\WF\startpoint-cn\out\rank-button-p1 `
  --abcinject D:\WF\startpoint-cn\client-patch\rank-button-p1\abc
```

构建器 fail-closed：基线 APK/SWF 哈希、两个方法体的字节码哈希、P-code 锚点唯一性、
补丁后的 ABC 结构、AS3 回读行集、签名证书指纹，任何一项不符即中止，不出包。

## 产物

| 文件 | 说明 |
|---|---|
| `out/rank-button-p1/WorldFlipper-rank-button-p1.apk` | 已签名、已 zipalign 的成品 |
| `out/rank-button-p1/worldflipper_android_release.p1.swf` | 补丁后的主 SWF（比对用） |
| `out/rank-button-p1/build-report.json` | 逐条自检证据 |
| `out/rank-button-p1/0*-*.pcode` | 实际喂给 FFDec 汇编器的两段 P-code |
| `out/rank-button-p1/evidence/` | 补丁前后的 P-code / AS3 导出，可直接 diff |

---

## 装机步骤（作者本人执行）

> ⚠ **全程不要 uninstall**：签名与在用包一致，`install -r` 是原地升级，本地身份和存档绑定都保留。
> ⚠ **不要 force-stop**：会触发全量重下。
> ⚠ **不要用 `run-as`**：本包 `android:debuggable=false`（aapt 实测），
> `run-as com.leiting.wf` 必定报 `package not debuggable`。MuMu 的 `adb shell` 默认就是 root，直接删即可。

```powershell
$adb = "C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe"
$apk = "D:\WF\startpoint-cn\out\rank-button-p1\WorldFlipper-rank-button-p1.apk"

# 0) 现查设备号（会漂，别用缓存的）
& $adb devices
# adb 连不上时用 MuMuManager 兜底：
#   D:\WF\MuMuPlayer\nx_main\MuMuManager.exe adb -v <索引>

# 0.5) 【先确认设备上现装的就是 device_base 基座】
#      若设备已漂到别的本地构建，install -r 会把它静默盖掉，事后无从追溯。
& $adb shell pm path com.leiting.wf          # 看清楚有几行；取那行 base.apk
& $adb pull /data/app/<上一步看到的路径>/base.apk "$env:TEMP\wf_dev.apk"
python -X utf8 -c "import zipfile,hashlib,sys;print(hashlib.sha256(zipfile.ZipFile(sys.argv[1]).read('assets/worldflipper_android_release.swf')).hexdigest())" "$env:TEMP\wf_dev.apk"
#   期望 = ab13b84852915b4e49294e0efd01fbdcd16d9f0ec6cec105804c27e68a962399
#   不等就先停手，别装。

# 1) 原地升级（同签名、同 versionCode 1008001，-r 即可，不要 -d，更不要卸载）
& $adb install -r $apk

# 2) 清 AIR 的 SWF 缓存 —— 不清就跑旧 SWF，会把「补丁无效」误判成「补丁没崩」
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app

# 2.5) 【必做】确认真的清掉了 —— rm -rf 失败是静默的，这是本轮最容易翻车的一步
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"
#   期望输出：... No such file or directory   ⇒ 清干净了，继续
#   若输出 Permission denied ⇒ 没权限，先提权再重清：
#       & $adb root
#       & $adb shell rm -rf /data/data/com.leiting.wf/cache/app
#       & $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"
#   若直接列出了目录 ⇒ 没删掉，别往下走。

# 3) 清 logcat
& $adb logcat -c

# 4) 显式 Activity 启动（不要 force-stop）
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

### 真机检查单

```
[ ] 进游戏 → 主页 → 深渊连战活动页
[ ] 左侧竖排出现一颗新圆钮（位置 = 锚位3/槽序1，即「任务」钮的正下方一格）
    · 皇冠图标在
    · 「排名」字样在，且是置灰版（ranking_gray）
    · 圆底是灰底、内容变暗（showDisable 的效果）
    · 不重叠、不越界、不遮住底部三个大钮
[ ] 点它 —— 应该完全没反应（这一步就是要它没反应）
[ ] 「道具交换」「连战」「无尽战斗」照常；「任务」钮见下方注
[ ] 返回主页再进一次，按钮还在
[ ] 打一局连战，正常
[ ] logcat 无 VerifyError / ReferenceError / Error #1065 / Error #1107 / C7050
[ ] /crash 无新上报
```

> **关于「任务」钮**：它自己受 `isMissionButtonVisible()` 门控（真值 = `event.getPlayableTimeRange().endTime` 是否为 Some），
> 该数据来自官方 CDN 主表、不在私服 store 里，**离线无法复验**。
> 若「排名」钮出现在正确位置、但它上面一格（3,0）是空的，那是 `isMissionButtonVisible` 的数据态，
> **属正常、不算 P1 失败，也不要去改手术 B 的 pushbyte**。判定「位置对不对」只看：
> 它是否贴在左侧竖排、x 与上方按钮对齐、y 比 (3,0) 低一格。

### 失败诊断

| 现象 | 判断 |
|---|---|
| 按钮不出现、但也不崩 | 九成是 SWF 缓存没清 → 回第 2 / 2.5 步，先确认 `ls` 返回 No such file or directory；确认清过了再怀疑槽位参数 |
| 按钮出现，但上方 (3,0) 空一格 | **不是 bug**：`isMissionButtonVisible` 数据态，见上方注。**别动 pushbyte** |
| 按钮出现但整体位置不对（不贴左侧竖排 / 压住底部大钮） | 改手术 B 的两个 `pushbyte`（锚位 3 / 槽序 1） |
| 进活动页就崩 + `VerifyError` | 栈深或跳转偏移问题 → 回滚（离线已验：栈峰值 9/13 与 5/11，余量 4 层；跳转目标 100% 落指令边界，出现概率极低） |
| 进活动页崩 + `Error #1065` | `ButtonConfigs.ranking` 没解析到 → getproperty 的 multiname 写错（离线已验索引 4496 存在） |
| 崩 + `ClientError 7504`「登録されていないボタン」 | 只有手术 B 生效、A 没生效 → 回滚重出包（构建器是原子落盘，正常不会出现） |
| 按钮出现但没有「排名」字样、只有圆底 | 图集里缺 `bitmap_text-assets/ranking_gray`（离线已验存在） |

> MuMu 上若出现语音/音效全哑，那是 AudioFlinger 僵尸轨的老毛病，与本补丁无关：
> `killall audioserver` 即可，**别用 force-stop 去排查**。

### 回滚

```powershell
& $adb install -r "C:\Users\12101\Documents\MuMu共享文件夹\device_base.apk"
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"   # 同样要确认
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

同签名、同 versionCode，同样是原地升级，**身份和存档绑定不受影响**。
`device_base.apk` sha256 = `9b539c210a80d76856ddbdf67e426746c020e9b389f78a63771a750327608772`
（其内 `assets/worldflipper_android_release.swf` sha256 = `ab13b848…a962399`，即第 0.5 步的期望值）。

---

## 附：口径说明

`build-report.json` 里 `bodies[].branches` 统计的是**分支边**（`lookupswitch` 的 default 与每个 case 各算一条边），
不是分支指令条数。故 body 71590 记 `6`（2×jump + 1×iffalse + lookupswitch 的 default+2 case），
按**指令**数则是 4 条。两种口径都判定补丁前后不变，结论一致，仅单位不同。
