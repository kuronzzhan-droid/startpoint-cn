# 去第三方原生 SDK + x86_64 运行时 可行性调查

日期 2026-10-15。只读调查:没有构建、签名、改包,没有碰 ADB/MuMu 或服务器。
解包与脚本输出都在 `work\x86probe\`(`p1b.out.txt`、`p3.out.txt`、`p4.out.txt`、`p5.out.txt`、`p6.out.txt`、`manifest.txt`、`classes.strings.txt`)。
解析用的是 python 自写的 zip/DEX/AXML/ELF 解析器。本机 `dexdump.exe`、`aapt.exe` 直接运行需要审批,所以没用。

## 结论先行

| 路线 | 分级 | 一句话 |
|---|---|---|
| **A. 保留爱加密壳,增加 `lib/x86_64/`** | **有条件可行**(推荐先验证) | 壳本身带 x86_64 版。但 Java 层被加密,封着 AIR 33.1.1.620,所以必须拿到**同版本 33.1.1.620 的 x86_64 `libCore.so`**;其余第三方库要用 x86_64 空壳 .so 补齐。能否启动只能靠真机实验确认 |
| B. 去壳,沿用原 Java 层 | **当前不可行** | 明文 DEX 只是 6 个类的壳桩。真实 DEX 是 `assets/ijiami.dat`,加密,本机没有脱壳产物。另有疑似 DEX-VMP 库 `libsecsdk.so` |
| C. 弃用原 Java 层,用 AIR SDK 51 整体重打包(无壳、无第三方 SDK) | 有条件可行,但工作量大 | 本机已有 AIR SDK 51.1.4.1,带官方 x86_64 运行时。但 13 个 ANE 的 Java 部分都封在加密 DEX 里,要逐个重写成桩或替换,其中资源下载 ANE 必须写成能用的实现 |

最快的证伪实验见第 6 节 E0:不需要任何新下载,改一个测试包装到 MuMu,看 logcat。

---

## 1. 加固壳(决定项)

**证据:**
- `classes.dex` 只有 16,676 字节。只有 6 个类:`cn.startpoint.BuildIdentity`、`cn.startpoint.StartupCache`(我们自己加的启动缓存类),以及壳类 `s.h.e.l.l.A`(extends `AppComponentFactory`)、`s.h.e.l.l.C`、`s.h.e.l.l.N`、`s.h.e.l.l.S`(extends `Application`)(`p2.py` 输出)。
- Manifest:`application name='s.h.e.l.l.S'`、`appComponentFactory='s.h.e.l.l.A'`(`work\x86probe\manifest.txt:3`)。
- 壳桩字符串(`classes.strings.txt`)包括:`com.leiting.sdk.LeitingApplication`(真实 Application,不在明文 DEX 里)、`com.ijm.dataencryption.DETool`、`assets/ijm_lib/%s/libexec.so`、`assets/ijm_lib/%s/libexecmain.so`、`exec_x86`、`execmain_x86`、`SUPPORTED_ABIS`、`ro.product.cpu.abi`、`x86_64`、`instantiateClassLoader`、`mBoundApplication`。这是典型的**爱加密(ijiami)** 整体加固:壳桩先替换 ClassLoader,再在 native 层解密真实 DEX。
- 加密载荷:`assets/ijiami.dat` 4,302,705 B,前 1 MB 熵 7.983 bit/byte,找不到 `dex\n0` 魔数;`assets/ijiami.ajm` 1,336,597 B,熵 7.992。另有 `assets/IJMDal.Data`、`zlsioh.dat`、`signed.bin`、`af.bin`(`p1b.out.txt:2-22`)。
- 壳的原生库:
  - `assets/ijm_lib/{arm64-v8a,x86_64}/libexec{,main}.so`。**x86_64 版本身就有**(ELF machine 62,`p3.out.txt:80-88`)。
  - `libexecgame.so`:导出符号 `_Z5isX86v`、`_Z11checkExecSuv`,是爱加密的环境/模拟器检测(`p4.out.txt:5-16`)。
  - `libfakedyn.so` 是 arm64;`libfakedyn_x86.so` 虽然放在 arm64-v8a 目录里,实际是 **x86_64 ELF**(machine 62,`p3.out.txt:120`)。推断:这是给 houdini/libnb 转译场景用的壳组件。
- `libsecsdk.so`:字符串含源码路径 `.../jarwrapper/Android3DK/.../mutiVmP/src/main/jni/VmP/DeXAnalYST.h` 和一组 `dexGetMethodId` 等函数(`p4.out.txt:99-113`)。**推断**:这是 DEX 方法虚拟化(VMP)组件,也就是部分 Java 方法体被抽成 native 执行。
- 本机脱壳产物:在 `D:\WF` 全盘 glob `**/*.dex`,只找到本次解包出的 `classes.dex`。`startpoint-cn-kulo\client-patch\*` 的历史构建脚本都只 baksmali/smali 这 6 个类(例如 `client-patch/abyss-record-holder/build_apk.py:42-53` 断言 smali 文件数 == 6)。**没有原始 DEX。**

**结论:** DEX 被加密,真实代码靠壳在运行时解密。本机拿不到原始 DEX,路线 B 当前不可行。要做 B,只能在设备上运行时 dump 内存里的 DEX,这超出本次硬规则,需要你决定;而且如果 VMP 真的抽取了方法体,dump 出来的方法仍要依赖 `libsecsdk.so`。

另一个正面证据:历史包已经多次改过壳桩 DEX、SWF 并重签名,都能运行(v29/v30 签名与原包不同,见 `p1b.out.txt:38-40, 79-81`)。说明这个壳**不校验原厂签名或 DEX 完整性**,往包里加内容的可行性较高(推断)。

## 2. AIR 入口与 ANE 依赖

- 入口 Activity 是 `air.com.leiting.wf.AppEntry`;`initialcontent=worldflipper_android_release.swf`(`manifest.txt:4, 11`)。
- 13 个 ANE 全部**只有 Java jar,没有 .so**(`extension.xml` 的 nativeLibrary 都是 `.jar`,见 `p3.out.txt:164-233`)。所以 ANE 本身与 CPU 架构无关,ANE 也不依赖上面那 15 个 .so。它们的 Java 代码由 ADT 合进了 DEX,现在都在加密的 `ijiami.dat` 里。
- 私服构建 `DevConfig.sdkDummy = true`(`startpoint-cn-kulo/client-patch/apply.sh:16`;反编译默认值在 `pinball/config/core/DevConfig.as:60`)。因此 `ChannelSDKMain` 在 `realRemote == null` 时走 `ChannelSDKDummy`(`pinball/channels/ChannelSDKMain.as:51-54, 156-158`),`sdkIsInited` 也跳过 Leiting(同文件 `:99-103`)。**登录不经过 Leiting ANE。**

| ANE id | AS3 调用点(反编译 `scripts\`) | 在启动/登录/战斗路径上? | 缺失后果 |
|---|---|---|---|
| com.gibits.leitingaar | 构造器内 `createExtensionContext`,失败就 `throw new Error("extCtx is null.")`(`com/gibits/leitingaar/LeitingSDKExtension.as:26-30`)。调用方有:`TitleScene.as:214-215, 348`、`TitleMenuDialog.as:85-107`、`OtherMenuScene.as:304-406`、`QuestResultScene.as:1228-1232`、`GachaResultScene.as:496-500`、`ChannelLeitingSDK.*` | 登录不在(sdkDummy);标题菜单/其他菜单/结算页的评价跳转按钮在路径上 | 抛 AS3 异常,对应按钮失效。release 运行时不弹窗,但可能打断当前处理链(推断)。**需要桩 ANE,或在 AS3 侧加保护** |
| (Leiting 敏感词) | `FWordLeiting.Filtrate` 在 `DevConfig.wordFilterSwitch` 为 false 时直接返回(`pinball/gbits/word/FWordLeiting.as:165-168`;默认 false,`DevConfig.as:96`) | 否 | 无影响 |
| pinball.assetDownload | `AneAssetDownloading.as:260`(`AssetDownloader.startDownloadAsset`,`AssetDownloader.as:168-177`) | **是**(资源下载;manifest 还有 `pinball.assetDownload.AssetDownloadService`) | 资源无法下载。**必须保留或功能等价重写** |
| pinball.ane.getbuild | `RemoteUtil.as:763, 775`、`InitializeRealRemote.as:6478`、`StarlingManager.as:197` | 是(请求头/机型) | wrapper 有 `context != null` 判断(`GetBuild.as:19-38`),缺失时返回空,推断不崩 |
| pinball.screen | `ScreenSizeSection.as:66` | 是(启动时屏幕尺寸) | 需要桩,返回合理尺寸 |
| pinball.vibration | `VibrationSection.as:51` | 战斗中震动 | 桩空实现即可 |
| pinball.checkapp | `AndroidCrackDetector.as:27`(只在 `forceRootedDeviceError` 时) | 否 | 桩返回 false |
| pinball.ane.googleId | `GoogleIdExtension.as:15` | 否 | 桩 |
| com.gbitstools | 只有 `AndroidFileReader.as:68, 182` 用;`AndroidFileReader` 在包外**没有引用** | 否(死代码) | 无 |
| com.distriqt.Core / Battery | `NativeExtensionInitializer.as:38`(`Core.init()`)、`BatterySection.as:84-119` | 启动时 Core.init | distriqt 是公开商用 ANE;缺失时 `isSupported` 为 false。推断不崩,但需要实测 |
| com.digitalstrawberry.ane.share | `PlatformShareSection.as:54-55`、`OperationMenuDialogView.as:176, 482` | 否(分享) | 桩 |
| jp.cygames.GooglePlayServicesANE、com.tuarua.frekotlin | AS3 侧没有直接的 `createExtensionContext` | 否 | 桩,或在重打包时去掉 |

路线 A 不动 Java 层,所有 ANE 原样保留,这一节只对路线 C 有意义。

## 3. 每个第三方 .so

Java 侧的 `System.loadLibrary` 调用点都在加密 DEX 里,**无法静态定位**。下表的"加载者"按 JNI 导出符号和字符串推断(`p3.out.txt:90-163`、`p4.out.txt`)。

| .so | 归属(证据) | 私服用得到? | 删除或换空壳的后果 |
|---|---|---|---|
| libCore.so | AIR 33.1.1.620 运行时(字符串 `33.1.1.620`,89 个 `Java_com_adobe_air_*` 导出) | 必需 | — |
| libc++_shared.so | libCore 的 NEEDED | 必需 | NDK 自带 x86_64 版 |
| libysshared.so | **Harman AIR 自带**:AIR 51 SDK 的 arm8 `Runtime.apk` 里也有同名库(`p5.out.txt:6`)。51 的 x86_64 `Runtime.apk` 里没有(`p5.out.txt:11-13`) | 推断是 AIR 33 Java 层加载的 | 可能必需。x86_64 版要从 AIR 33.1.1.620 SDK 里找,找不到就用空壳 |
| libexecgame / libfakedyn / libfakedyn_x86 / libsecsdk | 爱加密壳(见第 1 节) | 壳需要 | 路线 A:壳只为 x86_64 带了 `libexec`/`libexecmain`,这几个是否必需未知,**只能靠 E0 实验确认** |
| libSocketHelper.so | Leiting SDK(`Java_com_leiting_sdk_SocketHelper_*`) | 否(sdkDummy) | 如果在 `LeitingApplication.onCreate` 里加载,缺失会导致启动崩溃(推断);空壳能让 loadLibrary 通过 |
| libwordfilter.so | Leiting 敏感词(`com/leiting/sdk/wordfilter/WordFilterHandler`,用 JNI_OnLoad 注册) | 否(`wordFilterSwitch` = false) | 同上 |
| libgetuiext3.so | 个推推送(`com_igexin_dms_core_NativeCaller`) | 否 | 推送 SDK 常在 Application 初始化时加载,推断风险较高 |
| libsobot.so | 智齿客服(`com_sobot_chat_core_SobotUtil`) | 否 | 一般打开客服时才加载 |
| libtracepath.so | 网易网络诊断(`com_netease_LDNetDiagnoService_*`) | 否 | 诊断功能时才加载 |
| libentryexpro.so、libuptsmaddon.so、libuptsmaddonmi.so | 银联支付/TSM(`com_unionpay_*`) | 否 | 支付时才加载 |

关键点:**路线 A 下这些 .so 不能真的删**。删了 arm64 手机会走原路径出错;x86_64 下又需要同名库,否则 `UnsatisfiedLinkError`。做法是 arm64 目录保持原样,x86_64 目录放同名空壳(只有 `JNI_OnLoad` 返回 `JNI_VERSION_1_6`)。只要私服流程里没有真正调用它们的 native 方法就安全,这一点要靠 logcat 验证。

## 4. x86_64 AIR 运行时

- **Harman 支持 Android x86_64。** Harman 的 AIR 33.0.2.315 发布帖写明 "support for x86_64 platform on Android"(2019-11-14)。官方 ADT 文档列出 `-arch armv7 | armv8 | x86 | x64`,另有 `all`(通用 APK)。GitHub 上也有 "[AIR 33.1.1.698] AIR SDK build Android APK with all ABIs" 这个 issue。**推断**:33.1.1.620 的 SDK 里有 `x86_64` 版 `libCore.so`,但这个具体文件本机没有,未核实。
- **本机已有 AIR SDK:** `D:\WF\_archive\kept\AIRSDK_51.1.4.1`。里面有:
  - `runtimes/air/android/device/x86_64/Runtime.apk`:`lib/x86_64/libCore.so` 23,142,816 B,machine 62,版本字符串 51.1.4.1(`p5.out.txt:11-14`)
  - `lib/android/x86_64/FlashRuntimeExtensions.so`
  - `adt.jar`
- **能不能用 51 的 libCore 替换 33.1 的?不能直接混用。** 对比 33.1.1.620 arm64 与 51.1.4.1 的 libCore(`p6.out.txt`):
  - JNI 导出:33 的 89 个是 51 的 91 个的子集。51 多了 `Entrypoints_EntryLifecycleChange` 和 `customHandler_nativeCheckCertificateError`。
  - 51 的 libCore 会回调 33.1 Java 层**没有的 4 个类**:`com/adobe/air/AIRFileDescriptorWrapper`、`AIRFileUtils`、`AndroidScreenMode`、`AndroidTimeUtils`。
  - 方法签名也变了,例如 `(IIIZZZ)Z` 变成了 `(IIIZZZZZ)Z`。
  - 推断:51 的 libCore 配 33.1 的 Java 层,在 `FindClass`/`GetMethodID` 时会失败,导致崩溃。
- 所以:
  - **路线 A** 必须用**完全相同的 33.1.1.620** x86_64 `libCore.so`,因为 AIR Java 层(`com.adobe.air.*`、`air.com.leiting.wf.AppEntry`)封在加密 DEX 里,换不了。需要 Harman 33.1.1.620 SDK 或它的 x86_64 `Runtime.apk`。本次没有下载;要不要从 Harman 官方存档获取,由你决定。
  - **路线 C** 可以整体换成 51.1.4.1:libCore、Java 层、ANE 桩全部用 ADT 重新生成。
  - 注意:Harman 的 release-notes PDF 链接 308 跳转到 `airsdk.wxlift.com`,这个域名无法核实,本次没有访问。

## 5. 安卓 ABI 规则

- PackageManager 按设备 `SUPPORTED_ABIS` 的顺序,选 APK 里第一个存在的 `lib/<abi>/` 作为主 ABI,**只解压这个目录**。
  - MuMu x86_64 的顺序是 x86_64 优先,所以有了 `lib/x86_64/` 就会以原生 x86_64 运行,同时 arm64-v8a 目录里的库**完全不可见**。
  - arm64 手机不认 x86_64,继续只用 arm64-v8a,**不受影响**,只是包体变大约 25–30 MB。
  - (Android 通用规则,未在本机实测。)
- 因此 `lib/x86_64/` 必须包含所有在 x86_64 进程里会被 `loadLibrary` 的库。
  - "只放 libCore + libc++_shared" 的最小集合**只在路线 C 成立**,因为那时 Java 层不再加载第三方库。
  - 路线 A 的最小集合是:libCore、libc++_shared、libysshared,外加其余 12 个库的同名 x86_64 空壳。
- 爱加密壳桩自己按 `SUPPORTED_ABIS`/`ro.product.cpu.abi` 从 `assets/ijm_lib/%s/` 取库,对应的 x86_64 版本已经存在。
- 现有包没有声明 `extractNativeLibs=false`,libs 是 STORED 存储(`p1b.out.txt:23-37` 的 c0),这点不影响上述规则。

## 6. 步骤、风险、工作量

### 最小验证(先做,最快证伪路线 A)

**E0(约 0.5 天,不需要任何新下载):** 以 v30-perf2 为底,只新增 `lib/x86_64/`:
- 15 个同名 .so:x86_64 空壳,用 NDK clang 编译,只导出 `JNI_OnLoad`;
- `libCore.so` 暂时也用空壳;
- `libc++_shared.so` 用 NDK 的 x86_64 版。

签名后装到 MuMu,看 logcat。要回答的问题:
1. 爱加密壳在原生 x86_64 下能不能解密并进入 `LeitingApplication`。看有没有 `isX86`/环境检测导致的退出,以及有没有要求 x86_64 版 `libexecgame`/`libsecsdk` 的报错。
2. `System.loadLibrary` 的加载顺序,以及第一个 `UnsatisfiedLinkError` 的 Java 栈。这能让我们**看到加密代码里的类名和调用点**,等于补上第 3 节缺的证据。
3. 进程会死在 AIR `RegisterNatives` 阶段。这是预期的,说明前面全部通过。

- E0 如果失败在壳阶段,例如 VMP 需要 x86_64 版 `libsecsdk`:路线 A 基本不可行,转路线 C。
- E0 如果走到了 AIR:做 **E1**,把 libCore 换成 33.1.1.620 x86_64 的真实版本(需要你同意获取),看能否进入标题、登录、战斗,并测帧率。

### 路线 A 完整步骤(E0、E1 都通过后)

1. 获取 AIR 33.1.1.620 x86_64 的 `libCore.so`(以及 `libysshared.so`,如果有)。风险:Harman 存档里可能没有这个精确版本。0.5 天。
2. 生成 12 个第三方库的 x86_64 空壳。如果 E0/E1 的 logcat 显示某个 native 方法会被调用,就在空壳里按需导出对应的 `Java_*` 符号,返回默认值。风险:用 `RegisterNatives` 的库(wordfilter、getuiext3、uptsmaddon*)无法看到方法签名。0.5–1 天。
3. 构建脚本在现有 perf2 流水线上增加 `lib/x86_64/`,保持 arm64 目录逐字节不变,重签名,然后 v1/v2 校验。0.5 天。
4. 回归测试:MuMu 原生 x86_64 上测登录、下载、战斗、多人;arm64 手机测原路径不变。1 天。

合计约 **3–4 天**,其中 E0 结果决定成败。另外,"去掉第三方 SDK"在这条路线上只能做到让它们在 x86_64 上失效,做不到真正移除。

### 路线 C(无壳重打包,AIR 51.1.4.1)

1. 用本机的 51.1.4.1 ADT 重新打包:SWF、`application.xml`(升 namespace)、assets、`-arch all` 或 Android Studio 工程只保留 arm64+x86_64。
2. 自写 13 个 ANE 的 Java 实现,id 和 initializer 类名保持一致:
   - `pinball.assetDownload`:**功能等价重写**,包括下载服务和进度事件。最大风险,需要读 `AneAssetDownloading.as` 和 `AssetDownloadAne.as` 的全部调用和事件协议。2–4 天。
   - Leiting / screen / getbuild / vibration / checkapp / googleId / share / gbitstools / GPS / frekotlin:返回合理值的桩。1–2 天。
   - distriqt Core/Battery:用 distriqt 公开版或桩。
3. 去掉 sobot/银联/个推/Leiting 的 activity、provider、service;重新处理 `StartupCache` 和图标等资源。1 天。
4. 风险:
   - AIR 33 编译的 SWF 跑在 51 运行时上的行为差异(渲染、Stage3D、文件 API);
   - 包名和签名变化后,原有私有目录的存档和缓存兼容性;
   - 失去壳以后,原 `LeitingApplication` 里可能有的初始化逻辑不复存在(我们看不到它的内容)。
5. 合计约 **6–10 天**。

### 建议

先做 E0。它一天内就能回答"爱加密壳能不能原生跑 x86_64"和"加密 Java 层加载了哪些库",结果直接决定走 A 还是 C。路线 B(运行时脱壳)不建议,除非你明确授权在设备上 dump 内存里的 DEX。

## 来源

- 本机文件:见各条引用的路径和行号。
- [AIR 33.0.2.315 released(Adobe Community, 2019-11-14)](https://community.adobe.com/questions-537/air-33-0-2-315-released-85237):"support for x86_64 platform on Android"
- [ADT -package(airsdk.dev)](https://airsdk.dev/docs/building/air-developer-tool/commands/package):`-arch armv7|armv8|x86|x64`
- [airsdk/Adobe-Runtime-Support #1429:[AIR 33.1.1.698] build Android APK with all ABIs](https://github.com/airsdk/Adobe-Runtime-Support/issues/1429)
- [airsdk/Adobe-Runtime-Support #3708:-arch "all" missing in docs](https://github.com/airsdk/Adobe-Runtime-Support/issues/3708)
- [airsdk/Adobe-Runtime-Support #2873:Selected architectures for Android .apk](https://github.com/airsdk/Adobe-Runtime-Support/issues/2873)

## E0 实测结果(2026-10-15 08:45,MuMu安卓设备-1)

- 包:`out\e0-x86probe.signed.apk`(sha 8d61aaaf…,v30-perf2 + 15 个 x86_64 空壳 .so,`tools\build_e0.py`)。
- 安卓选了 `primaryCpuAbi=x86_64`,15 个空壳库全部被系统接受,没有 dlopen 报错。
- **爱加密壳在 x86_64 下原生跑通**:真实 DEX 被解密加载,`com.leiting.sdk.LeitingApplication.onCreate` 开始执行。
- 第一处崩溃(调用栈见 `work\e0\logcat.txt`):
  `UnsatisfiedLinkError: com.leiting.sdk.SocketHelper.H(String)` ← `DesUtil.decryptConfig:73` ← `SdkConfigManager.getLocalSdkConfig:347` ← `loadLocalSdkConfig:467` ← `LeitingSDK.initPlugAndConfigOnApplication:67` ← `LeitingApplication.onCreate:25`。
  即雷霆 SDK 启动时用 `libSocketHelper.so` 的 `H()` 解密本地 SDK 配置,x86 版必须真实实现它。
- 壳没有把解密后的 DEX 落盘(`/data/data/com.leiting.wt` 下无 .dex/.jar)。
- 结束后装回 v28(sha 812526f5…,ABI 回到 arm64-v8a),删 cache/app,启动正常后关闭。

## E2 实测结果(2026-10-15 16:12,MuMu安卓设备-1)

- 包:`out\e2-x86.signed.apk`(v30-perf2 + AIR 33.1.1.620 真 x86_64 `libCore.so`/`libc++_shared.so` + x86 `libSocketHelper`(DES)+ 12 空壳;SDK 校验:SDK 内 arm64 `libCore.so` 与游戏包逐字节一致)。
- 安装后 `primaryCpuAbi=x86_64`;进程映射里是 `lib/x86_64/libCore.so`。
- **E0 的崩溃已消失**:`SocketHelper.H` 解密配置通过,PrivacyActivity → `air.com.leiting.wf.AppEntry` 正常跳转,SWF 解到 `cache/app`。
- **新卡点**:AppEntry 显示后一直**黑屏**,2 分钟内进程 CPU 约 4%,无崩溃、无 Java 异常;主线程在 Looper 空闲,libCore 的若干工作线程在等待。推断:AIR 运行时已启动,但 AS3 侧或渲染初始化在等某个回调(候选:某个 ANE 的原生回调、Stage3D/GL 上下文、或被空壳替掉的 SDK 返回空值导致的等待)。日志:`work\e2\logcat-all.txt`、`work\e2\trace.txt`。
- 结束后装回 v28(812526f5…,ABI arm64-v8a),删 cache/app,启动到登录确认页后关闭。

## E3 实测结果(2026-10-15 19:00 左右,MuMu安卓设备-1,账号 123123)

- 包:`out\e3-x86.signed.apk`(sha de7d435b…;v30-perf2 + x86_64 库 + 13 个 ANE 加 `Android-x64` 平台条目,由 `build-e3.ps1` 构建)。
- **x86 原生跑通**:`primaryCpuAbi=x86_64`,过标题、资源下载、登录进主城、角色页、编队、商店、兑换、打 6-2 并正常结算,全程无崩溃。
- 对照(同账号同路径,v30-perf2 的 ARM 翻译运行 → E3 x86 原生,单位秒,点击后卡住到第几秒):
  - 主城→角色页 首次 4.60 → 1.62;再次 1.16 → 0
  - 角色页→编队 首次 3.31 → 0.93;再次 1.45 → 0
  - 编队翻页 2.60/2.01/1.49 → 0.68/0.41/0
  - 首次进商店 0.77 → 0;兑换(冷)0.47 → 0
  - 点「挑战」→ 战斗首帧 约 10.5 → 约 3.8
  - 战斗中(10 秒窗口):16.7 fps → 57.7 fps;中位帧间隔 43 → 17 ms;p95 170 → 29 ms;>250ms 长卡 6 → 0;主线程占用 平均 44%(之前 85–98%)。通关时间 15.5 → 11.2 秒(游戏内计时,掉帧时游戏变慢)。
- 覆盖安装与 SWF 缓存:同 versionCode(1008001)覆盖安装后不清 `cache/app`,AIR 继续跑旧 SWF(实测 v33 的 3b7b3391 留在缓存里);缓存目录名不随包变化。提高 versionCode 能否触发重解包**未验证**。
- 结束后装回 v33(3de625cf…,ABI arm64-v8a),清 cache/app,确认缓存 SWF=3b7b3391(v33),启动到登录卡后关闭。

## v33 双架构测试包(2026-10-15 19:45 左右)

- 产物:`C:\Users\12101\Downloads\世界弹射测试服-v33-x86.apk`,sha256 572dd17256de6708b9cdcbe752e184a97b44781bce8fd5ffacf7be7413e0c331,约 214MB。v33(3de625cf…)+ `lib/x86_64/`(E3 同一套)+ 13 个 ANE 加 `Android-x64`;versionCode 不变(1008001);v29-coop 证书。构建脚本 `build-v33x86.ps1`。
- MuMu 实测:x86 原生,登录→6-2 战斗→结算正常;战斗 57.5 fps,>250ms 长卡 0 次。**未在手机上回归。**
- versionCode 实验:把 versionCode 改为 1008002(`tools\bump_versioncode.py`)覆盖安装到 v33 上、不清缓存,启动后缓存 SWF 的 mtime/大小不变 ⇒ AIR **不**因 versionCode 升高而重新解包。覆盖安装后仍须清 cache/app(或清数据/卸载)。
- 降级还原注意:MuMuManager `app install` 遇到降级会静默失败,其 `adb` 子命令不可用;还原用共享文件夹(`Documents\MuMu共享文件夹` ↔ `/mnt/shared/MuMuShared`)拷进设备后 `pm install -r -d`。
