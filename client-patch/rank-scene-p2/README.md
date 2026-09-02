# rank-scene-p2 · 皇冠「排名」钮点得进去了（全屏可滚动榜单页）

对应方案文档 `mod-tools/docs/排行榜类移植-可行性与方案-20260827.md` 的 **P2 阶段（手术 C / D）**。
P1 把按钮摆上屏并验掉了「美术 / 布局 / 常量池 / P-code 汇编」四类风险；
**P2 把它从置灰改成正常可点，并接上跳转** —— 点进去是一个整屏、可上下滚动的富文本排行榜。

**基座是 P1 的成品 APK**，不是原始净包，所以作者真机在用的五合一补丁
（重指向 / sdkDummy / render-scale / …）全部原样保留，P1 的按钮也在。

```
device_base.apk (五合一)  →  P1 (按钮上屏, 置灰)  →  P2 (可点 + 跳转)
```

---

## 改了什么

三个方法，纯方法级 P-code 手术。**不新增类、不调 FFDec 的 AS3 编译器。**

| 手术 | 类 / 方法 | 改动 |
|---|---|---|
| A2′ | `pinball.scene.event.rush.top:RushEventTopScene/run` | P1 加的那句 `buttonGroup.get(5).set_enabled(3)` → `set_enabled(1)`（置灰不可点 → 正常可点） |
| C | `pinball.scene.event.rush.top:RushEventTopScene/buttonClicked` | `lookupswitch` 从 5 个 case 扩到 6，并在方法末尾追加一个新基本块 |
| D | `pinball.loading.termsOfService:TermsOfServiceLoadingTask/toolAgreementRemoteInput` | 页面标题 `title_name_terms`(服务条款) → `ranking_ranking_tab_total_ranking`(综合排名) |

反编译回读（补丁后的 SWF，FFDec 独立导出）：

```as3
// RushEventTopScene.run
buttonGroup.get(5).set_enabled(1);          // ← 由 3 改 1

// RushEventTopScene.buttonClicked
case 5:
   changeSceneWithLoading(LoadingTaskKind.TermsOfService,ChangeSceneBackKind.AddCurrent);
   return;

// TermsOfServiceLoadingTask.toolAgreementRemoteInput
var _loc2_:String = "ranking_ranking_tab_total_ranking";
```

### 跳到哪儿去了

借官方**被遗弃的「服务条款」全链**（`LoadingTaskKind.TermsOfService`，全 ABC 实测**零调用者**
——唯一一处引用是 `LoadingTaskKind` 自己给静态字段赋值的 `initproperty`；
正向对照：同法扫同族的 `RushEventReset` 能扫出 2 个真实调用点）：

```
buttonClicked case 5
  → changeSceneWithLoading(LoadingTaskKind.TermsOfService, ChangeSceneBackKind.AddCurrent)
  → LogicScene.internalChangeScene case 2 → LogicScene.resolveLoadingTask case 40
  → new TermsOfServiceLoadingTask()
  → remote.toolAgreement(hook) → POST tool/agreement
  → ToolAgreementRealRemote.successHandler：data.terms_text 必填 String（缺了抛 ClientError 8702）
  → SceneKind.RichTextData(title, terms_text)
  → RichTextDataScene → RichTextLayoutParser().getLayoutData(html)
  → RichTextDataSceneView.initializeRichTextFromData(getUiString(title), htmlData, …, scroll)
```

服务端那一半：`POST /api/index.php/tool/agreement`（`src/routes/cn/tool.ts`），
正文由 `src/lib/rush-leaderboard-agreement.ts` 现查两张榜生成。

**这一屏不需要任何新资源**：`SceneKind.RichTextData` 的索引是 126，
`AssetGroupResolver.resolveAssetGroups` 的 case 126 是
`uiSceneGroups.concat([getTownAssetGroupKind(...)])` —— 和主城同一批常驻组，
不会触发「数据不足」。CSS 也是公告详情用的同一份 `rich_text/style_bundled`。

### 手术 C 的新基本块是抄来的，不是写出来的

方案文档把「`lookupswitch` 扩表 + 新基本块」列为本期最大风险。降风险的做法是
**别自己发明指令序列**：新块逐字抄 `MenuTopScene.listSelected` 的 `ofs0127` 分支
（现役代码，同为「场景里点了某一项 → 换场景」的形状），只把一个操作数换掉：

```
              官方 MenuTopScene.listSelected ofs0127            本补丁 ofsRank
  findproperty  ::changeSceneWithLoading                        同
  getlex        pinball.common.data.scene::LoadingTaskKind      同
  getproperty   ::ProfileGetMyProfile          ←唯一差异→        ::TermsOfService
  getlex        pinball.common.data.scene::ChangeSceneBackKind  同
  getproperty   ::AddCurrent                                    同
  callpropvoid  ::changeSceneWithLoading, 2                     同
  jump          ofs02a8                        ←收尾方式不同→    returnvoid
```

- `changeSceneWithLoading(LoadingTaskKind, ChangeSceneBackKind)` 是 `LogicScene` 上的 public 方法，
  `RushEventTopScene → UiScene → LogicScene` 继承链实测成立，**同一份 SWF 里有 56 个现役调用点**（基线全量实测：`changeSceneWithLoading` 的调用点全部是 `callpropvoid` + 实参 2，形状与本补丁新块完全一致，无一例外）。
- 用到的 5 个 multiname **基线常量池里全都有**（26936 / 22590 / 22640 / 22578 / 22579）。
- 新块**追加在末尾那条 `returnvoid` 之后**，不是插在它前面 —— 那条 `returnvoid`（`ofs018a`）
  是 5 条现存 jump 的目标，追加在后面**不可能改道**任何一条；新块自己以 `returnvoid` 收尾，
  也不借用共享代码。
- 官方那份没有 `coerce`（静态枚举字段直接进 callpropvoid），本补丁同样不加。

### 唯一的常量池增量

手术 D 需要字符串 `ranking_ranking_tab_total_ranking`，它**不在**基线字符串池里，
FFDec 会追加一条。构建器把这条证明成**严格的前缀扩展**：
基线 92,895 条逐条字节相同，新池 92,896 条，多出来的**恰好**是这一条；
其余六张池（ints / uints / doubles / namespaces / ns_sets / multinames）逐元素完全相同。
（P1 是零新增；P2 是「+1 且可证明只 +1」。追加一条字符串对 AVM2 只是数组变长，
`pushstring` 按下标取值，语义无影响。）

不想要这条增量的话：把 `patch_rank_scene.py` 里的 `D_REPLACEMENT` 改回
`D_ANCHOR` 即可，代价是页面标题显示「服务条款」。`title_name_terms` 同样在
ui_string 主表里（值 = 服务条款），所以这条回滚路径是安全的 —— 但**换成任何别的键之前
必须先读下面这段**。

### ⚠ 换标题键之前必读：写错的代价不是「标题难看」，是崩溃 + 删主表

页面标题不是字面量。`RichTextDataSceneView.run` 走的是
`view.asset.getUiString(peek.title)`，链路：

    getUiString(key) → UiStringTable.data.get(key) → MasterMapBase.get
                     → IMasterBinaryMap.getIndex → MasterBinaryMap.getIndex

`MasterBinaryMap.getIndex`（body 6092）遇到**表里没有的键**时的实际字节码：

    ifnlt        +68                    ; 命中就跳过整段
    getlex       pinball.asset::FileUtilCommon
    getproperty  ::extraInfo
    pushstring   ','
    callproperty ::split, 1
    callpropvoid ::deleteFile, 2        ; ← 先把主表文件删掉
    findpropstrict pinball.error::ClientError
    pushint      8601
    pushstring   '指定的Key不存在。key='
    constructprop pinball.error::ClientError, 2
    throw                               ; ← 再抛 ClientError 8601

所以键写错**不会**退化成空标题或旧标题，而是**客户端崩溃 + 删掉缓存的主表文件**。

注意「这个键不在 SWF 字符串池里」和「这个键在不在 ui_string 主表里」是**两个不同的问题**：
前者只决定常量池要不要 +1，跟运行时安全毫无关系。真正要证的是后者。

这条不变量现在由 `check_title_ui_string_key.py` **强制**（构建器开工前、校验器收尾时各跑一次，
不过就不出包）：它从 `patch_rank_scene.py` 里直接读 `D_REPLACEMENT` / `D_ANCHOR`
（而不是另抄一份，免得改了补丁忘了改守卫），到 CN store 的
`master/string/ui_string.orderedmap` 里查，并带一个**正向对照** —— 先确认一个故意编造的键
查得出「不存在」，否则「查到了」这个回答本身不可信。

    python -X utf8 client-patch\rank-scene-p2\check_title_ui_string_key.py

当前实测：ui_string 共 **3342** 键，`ranking_ranking_tab_total_ranking` = 综合排名、
`title_name_terms` = 服务条款，两个都在。

---

## 离线自检（构建器全自动，任一不过即中止、不出包）

`verify_rank_scene_p2.py` **不复用构建器用的读写器**：它用 `independent/` 下另一套
ABC 解析器 + AVM2 反汇编器 + 抽象栈解释器重跑一遍，一个读写器的 bug 无法自证。

| 检查 | 结果 |
|---|---|
| APK 条目 | 4180 → 4180，`only_in_base` / `only_in_patched` 均空；内容变的只有 SWF + META-INF 三件签名（对 P1 与对 device_base 两轮 diff 都是这四条） |
| SWF 标签 | 351 个，**只有 #347（`boot_ffc6` DoABC2）变**，+63 B |
| 常量池 | 六张逐元素相同；strings 严格前缀扩展 +1（`ranking_ranking_tab_total_ranking`） |
| 四张表 | method_info / metadata / instance_info / class_info / script_info **完全相同** |
| method body | 92,549 个里**恰好 3 个变**：39005 / 71572 / 71586；三者的 `maxstack` `localcount` `initscopedepth` `maxscopedepth` 异常表 body-trait 零漂移 |
| 编辑脚本 | 把每个 body 反汇编成「分支操作数替换成目标指令**序号**」的规范列表后逐行 diff，编辑脚本必须**逐字**等于预期的那 4 处；多一处（= 有跳转被改道）即失败 |
| 栈深 | 抽象解释器走遍每条可达路径：body 71586 补丁前后同为 **10/10**（新块峰值只有 3，不抬高原有峰值）；71572 **13/13**；39005 **3/3**。无下溢、无栈深合流冲突、跳转目标 100% 落指令边界 |
| lookupswitch | 从补丁后的字节里重新解码：`case_count` 字段 = 5（= 6 臂 − 1），default → #7，六臂 → #8 / #41 / #54 / #74 / #75 / **#110**；case 0..4 打开的基本块与补丁前**逐条相同**；方法里另一处 lookupswitch（内层 `RushEventTimeKind`，2 臂）原样不动 |
| 新块可达性 | 除 lookupswitch 外**没有任何**分支或 fallthrough 能进入 #110 |
| 类清单 | `ffdec -dumpAS3` 补丁前后 **10,186 行完全相同**（无类新增 / 删除 / 改名）；FFDec 的 3 条 `Duplicate scriptpack path` 告警数也不变（原包出厂就带） |
| AS3 回读 | 出现 `case 5:` + `changeSceneWithLoading(LoadingTaskKind.TermsOfService,ChangeSceneBackKind.AddCurrent);` + `set_enabled(1)` + `"ranking_ranking_tab_total_ranking"`；`set_enabled(3)` 与 `"title_name_terms"` 消失 |
| 签名 | 证书 SHA-256 `729507c1…a827a0b`，与 `device_base.apk` **相同**；v1/v2/v3 全 true，单签名者 ⇒ 原地升级，不换号 |
| 基座血统 | 构建器核对 `device_base.apk` 的 sha256，并在继承来的 SWF 里数出 `192.168.0.130:8001`×1、`sdkDummy`×1 ⇒ 既有补丁没被回退 |

**离线能证到的边界就到这里。** AVM2 校验器的实际接受、以及点下去之后的运行时行为，
只能真机验。基于「栈深不抬高 + 跳转 100% 落边界 + 新块逐字抄现役模板 + 常量池只多一条字符串」，
判断真机崩的概率很低，但**这仍是本项目第一次做 `lookupswitch` 扩表**。

---

## 构建

```powershell
$env:WF_APK_KS_PASS = "<keystore 口令>"    # 不设也行，构建器会走项目本地既有凭据源，全程不打印
python -X utf8 D:\WF\startpoint-cn\client-patch\rank-scene-p2\build_rank_scene_p2.py `
  --base-apk    D:\WF\startpoint-cn\out\rank-button-p1\WorldFlipper-rank-button-p1.apk `
  --device-base "C:\Users\12101\Documents\MuMu共享文件夹\device_base.apk" `
  --out-dir     D:\WF\startpoint-cn\out\rank-scene-p2
```

## 产物

| 文件 | 说明 |
|---|---|
| `out/rank-scene-p2/WorldFlipper-rank-scene-p2.apk` | 已签名、已 zipalign 的成品，139,722,485 B，sha256 `aab265cf7b73d5a33a80c312112c5790124333d64cb208fa23dd76c838e43409` |
| `out/rank-scene-p2/worldflipper_android_release.p2.swf` | 补丁后的主 SWF（29,070,209 B，sha256 `ce317fc2…14614e1`），与 APK 内成员逐字节相同 |
| `out/rank-scene-p2/build-report.json` | 逐条自检证据 |
| `out/rank-scene-p2/0*-*.pcode` | 实际喂给 FFDec 汇编器的三段 P-code |
| `out/rank-scene-p2/evidence/` | 补丁前后的 P-code / AS3 导出 + dumpAS3 类清单，可直接 diff |

---

## 服务端前置（装机前必须先做）

P2 的按钮点下去会打 `POST /api/index.php/tool/agreement`。该端点已实现并上线，
但**必须是重启过的 8001**（`src/` 改了要 `tsc`，服务端跑的是 `out/`）。

确认端点活着（响应是 base64(msgpack)，要解开才看得见 `terms_text`）：

```powershell
node -e "const{unpack}=require('D:/WF/startpoint-cn/node_modules/msgpackr');fetch('http://192.168.0.130:8001/api/index.php/tool/agreement',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({viewer_id:306205655})}).then(r=>r.text()).then(t=>{const d=unpack(Buffer.from(t,'base64'));console.log('result_code=',d.data_headers.result_code);console.log('terms_text is String:',typeof d.data.terms_text==='string');console.log(String(d.data.terms_text).slice(0,200))})"
```

期望：`result_code= 1`、`terms_text is String: true`、正文以 `<html lang="zh"><body class="body">` 开头。

---

## 装机步骤（作者本人执行）

> ⚠ **全程不要 uninstall**：签名与在用包一致，`install -r` 是原地升级，本地身份和存档绑定都保留。
> ⚠ **不要 force-stop**：会触发全量重下。
> ⚠ **不要用 `run-as`**：本包 `android:debuggable=false`，`run-as com.leiting.wf` 必定报
> `package not debuggable`。MuMu 的 `adb shell` 默认就是 root，直接删即可。

```powershell
$adb = "C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe"
$apk = "D:\WF\startpoint-cn\out\rank-scene-p2\WorldFlipper-rank-scene-p2.apk"

# 0) 现查设备号（会漂，别用缓存的）
& $adb devices
#   adb 连不上时用 MuMuManager 兜底：
#   D:\WF\MuMuPlayer\nx_main\MuMuManager.exe adb -v <索引>

# 0.5) 【先确认设备上现装的是什么】
& $adb shell pm path com.leiting.wf
#   输出形如：package:/data/app/~~xxxx==/com.leiting.wf-yyyy==/base.apk
#   ⚠ 这行输出**本身就以 /base.apk 结尾**。去掉 package: 前缀后原样用，
#      千万别再往后拼一次 /base.apk，否则 pull 必然失败。
$pkgPath = ((& $adb shell pm path com.leiting.wf) -replace '^package:', '').Trim()
& $adb pull $pkgPath "$env:TEMP\wf_dev.apk"
python -X utf8 -c "import zipfile,hashlib,sys;print(hashlib.sha256(zipfile.ZipFile(sys.argv[1]).read('assets/worldflipper_android_release.swf')).hexdigest())" "$env:TEMP\wf_dev.apk"
#   期望是下面三者之一：
#     ab13b84852915b4e49294e0efd01fbdcd16d9f0ec6cec105804c27e68a962399  = device_base（五合一）
#     78db404c4e4a56cdd1274d2232038aa1a176a4d85b2cda298fd9852988b72fc4  = P1
#     ce317fc20903717e4047afa603c420e1dc8a09cba4f69d11a42f2e61b11614e1  = P2（已经装过了）
#   都不是就先停手，别装 —— 说明设备漂到了别的本地构建。

# 1) 原地升级（同签名、同 versionCode 1008001，-r 即可，不要 -d，更不要卸载）
& $adb install -r $apk

# 2) 清 AIR 的 SWF 缓存 —— 不清就跑旧 SWF，会把「补丁无效」误判成「补丁没崩」
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app

# 2.5) 【必做】确认真的清掉了 —— rm -rf 失败是静默的，这是最容易翻车的一步
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
[ ] 通用前置 0 ~ 4 全做完，第 2.5 步看到 No such file or directory
[ ] 进游戏 → 主页 → 深渊连战活动页
[ ] 左侧竖排那颗皇冠钮现在是**正常外观**（不再置灰，「排名」字样是白版不是 ranking_gray）
[ ] 点它 → 走一次 loading → 进到一个整屏页面
    · 标题栏写「综合排名」
    · 正文第一行是「YYYY.MM.DD HH:MM更新」
    · 有「全程用时榜」和「当期首通榜」两节，中间一条虚线分隔
    · 每节先是「自身名次」卡（没成绩时写「排名外」），再是名次表
    · 行文案是「N位 / RANK250　名字 / BEST RECORD: N战 / TIME: MM:SS.FF」
    · 自己那一行是橙色（#ff9f1c）
    · 能上下滚动（榜空时内容短，滚不动是正常的）
[ ] 按返回 → 回到深渊连战页，页面正常、按钮还在、其它四个钮都还能点
[ ] 反复进出 5 次，不崩、不卡 loading
[ ] 断网点一次「排名」→ 走网络错误提示，不应崩
[ ] 打一局连战，正常
[ ] logcat 无 VerifyError / ReferenceError / Error #1065 / Error #1107 / C7050
[ ] /crash 无新上报
```

### 契约通路探针（可选，但值得做一次）

证明「客户端确实在读我们发的 `terms_text`」，而不是碰巧没走到：

```powershell
# 1) 服务端临时开逃生门：.env 加一行 WF_RANK_PAGE_FORCE_NULL=1，重启 8001
# 2) 真机点一次「排名」  → 应当报 ClientError 8702（data.terms_text 不是 String）
# 3) 把那行删掉，重启 8001，再点一次 → 恢复正常榜单
```

实测（8021 隔离实例）：开着这个开关时端点回的是
`{"terms_text":null,"terms_url":null,"required_terms_version":null,"required_privacy_version":null}`。

### 失败诊断

| 现象 | 判断 |
|---|---|
| 按钮还是置灰、点不动 | SWF 缓存没清 → 回第 2 / 2.5 步。确认清过了再怀疑别的 |
| 点了完全没反应、也不崩 | case 5 没接上（缓存没清最常见）；确认清过缓存后看 logcat 有没有 7504 |
| 点了立刻崩 + `VerifyError` | 跳转表 / 栈深问题 —— **本阶段头号风险**。回滚到 P1，然后走「最小化 case 5」复现路线：把 `patch_rank_scene.py` 的 `C_NEW_BLOCK` 换成只有一条 `returnvoid`，重建后先验证「扩表本身」是否成立，通过了再逐条把指令加回去 |
| 进 loading 卡住不返回 | 服务端 `/tool/agreement` 没响应或字段不对 → 看 `logs/cn-live-20260825.log` 有没有那条 POST；`data.terms_text` 必须是 String |
| 弹 `ClientError 8702` | `terms_text` 发成了 null / 非字符串。若是有意开了 `WF_RANK_PAGE_FORCE_NULL`，把它删掉重启 |
| 弹 `ClientError 7613` | 正文不是合法 XML —— 玩家名里有元字符没被换掉。`sanitizeRichText` 已覆盖，若真出现请把玩家名贴出来 |
| 页面开了但整页白 | 同上 7613，或 `terms_text` 是空串 |
| 页面标题写「服务条款」 | 手术 D 没生效（缓存没清），或用的是没打 D 的包 |
| 崩 + `Error #1065` | 某个 getlex/getproperty 的 multiname 写错（离线已验五个索引全部存在，概率极低） |
| 崩 + `ClientError 7504` | 按钮 id 没注册 —— 说明装的不是 P2 而是别的构建，重装 |

> MuMu 上若出现语音/音效全哑，那是 AudioFlinger 僵尸轨的老毛病，与本补丁无关：
> `killall audioserver` 即可，**别用 force-stop 去排查**。

### 回滚

**回到 P1（按钮还在、只是不可点）**：

```powershell
& $adb install -r "D:\WF\startpoint-cn\out\rank-button-p1\WorldFlipper-rank-button-p1.apk"
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"   # 同样要确认
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

**回到五合一基座（按钮整个消失）**：

```powershell
& $adb install -r "C:\Users\12101\Documents\MuMu共享文件夹\device_base.apk"
& $adb shell rm -rf /data/data/com.leiting.wf/cache/app
& $adb shell "ls -d /data/data/com.leiting.wf/cache/app 2>&1"
& $adb shell am start -n com.leiting.wf/com.leiting.sdk.activity.PrivacyActivity
```

三个包同签名、同 versionCode 1008001，**互相之间都是原地升级，身份和存档绑定不受影响**。
服务端的 `/tool/agreement` 端点回滚后留着也无害 —— CN 里除了这条链之外只有
`LinkResolver.openLink` 会走同一个 `SectionCommand.ToolAgreementRemote`，
而那要富文本里带「服务条款」链接才触发，我们自己发的富文本从不带。

| 包 | APK sha256 | 内含 SWF sha256 |
|---|---|---|
| device_base（五合一） | `9b539c210a80d76856ddbdf67e426746c020e9b389f78a63771a750327608772` | `ab13b84852915b4e49294e0efd01fbdcd16d9f0ec6cec105804c27e68a962399` |
| P1 | `f58379a1289213b9973734e14f79567226ab97754eda4bdfb41d3bad7f74e233` | `78db404c4e4a56cdd1274d2232038aa1a176a4d85b2cda298fd9852988b72fc4` |
| **P2** | `aab265cf7b73d5a33a80c312112c5790124333d64cb208fa23dd76c838e43409` | `ce317fc20903717e4047afa603c420e1dc8a09cba4f69d11a42f2e61b11614e1` |
