# x86_64 替身库逆向准备 + AIR 33.1.1.620 x86_64 运行时调查

日期 2026-10-15。**只读调查**:没有下载任何文件、没有构建/签名/改 APK、没有碰 ADB/MuMu/服务器。
解包与脚本都在 `work\x86stubs\`:`arm64\`(从 `世界弹射测试服-v29-coop.apk` 解出的 15 个 .so)、
`assets\`(解出的若干配置)、`src\`(C 草稿 + Python 参考)、`tools\`(自写 ELF/反汇编脚本)。
反汇编用自写的 ELF64 解析器 + AArch64 迷你解码器(本机无 capstone/lief/pycryptodome;`cryptography` 49.0.0 可用,
仅用来**验证**算法,不是运行时依赖)。所有偏移、符号、命令输出均可复现;推断处标「推断」。

---

## 0. 结论先行

1. **第一处崩溃已彻底逆清并验证**:`SocketHelper.H(String)` = **单重 DES / ECB / PKCS5**,
   密钥 = ASCII `548711fd`(16 字符字面量 `548711fdc20a2129` 的前 8 字符),输入是密文的十六进制串,输出 UTF-8 明文。
   用它解包内 `assets/sdkConfig.properties` 的 `wf=` 长 hex,得到合法 JSON(`{"loginUrl":"https://loginwf.leiting.com",...}`),
   **算法证实无误**。C 重写草稿在 `work\x86stubs\src\SocketHelper.c`,其 DES 表/逻辑已用 Python 镜像比对,产出同一测试向量。
2. 整个 `libSocketHelper.so` 是**雷霆 SDK 的 DES/AES/Base64 工具库 + 一个 socket hook 组件**(xhook)。
   A–O、G1–G5、k、CW/DW 全是同一套 `CDES`/`AES`/`TBase64` 类的 JNI 包装,密钥都是库内明文常量(见第 2 节密钥表)。
   因此**一个 .c 覆盖全部字母**即可,x86 下不需要原库。
3. **AIR 33.1.1.620 的 x86_64 `libCore.so` 没有可核实的官方下载**:Harman 官方站 `airsdk.harman.com` 现已 308 跳转到
   **无法核实的 `airsdk.wxlift.com`**(硬规则禁止打开),我能到达的任何列表都没有列出 33.1.1.620 这个精确版本。
   历史下载 URL 规律 `airsdk.harman.com/download/<版本>` 与 `apm airsdk install <版本>` 仍是最可能的获取方式(推断,见第 4 节)。
4. NDK(Windows,构建 x86_64 .so 用):`android-ndk-r27-windows.zip` = **781,482,169 字节(约 745 MiB)**,
   SHA1 `0ea2756e6815356831bda3af358cce4cdb6a981e`,官方页 developer.android.com/ndk/downloads 与 github.com/android/ndk releases。

---

## 1. `lib/arm64-v8a/` 15 个 .so 逐个分析

数据来自 `work\x86probe\p3.out.txt`(导出符号/`JNI_OnLoad`/`DT_NEEDED`/classpath 字符串)与本次 `tools\syms.py` 重验。
machine 183 = AArch64。**归属**:AIR = Harman AIR 运行时自带;壳 = 爱加密加固组件;SDK = 雷霆/第三方业务 SDK。

| .so | 大小 | `JNI_OnLoad` | 导出的 `Java_*` 类(静态可见) | `DT_NEEDED` | 归属 | 私服是否调用 native |
|---|---|---|---|---|---|---|
| libCore.so | 20.3 MB | 有(+RegisterNatives) | 89 个 `com_adobe_air_*`(含 AndroidActivityWrapper/Camera/StageText/WebView…) | libz,libGLESv2,libEGL,libdl,libc,libm,liblog,libjnigraphics,**libc++_shared** | **AIR** | 必需(主运行时) |
| libc++_shared.so | 1.03 MB | 无 | — | libc,libdl | AIR/NDK | 必需(libCore 的 NEEDED) |
| libysshared.so | 326 KB | 无 | — | libc,libm,libstdc++,libdl | **AIR 自带**(AIR51 arm8 Runtime.apk 内有同名,x86_64 Runtime.apk 内无) | 推断必需;x86_64 版要从 33.1.1.620 SDK 取,取不到就空壳 |
| libSocketHelper.so | 310 KB | 无(静态注册 `Java_*`) | `com_leiting_sdk_SocketHelper` | liblog,libm,libdl,libc | **SDK(雷霆)** | **是——H() 是启动必经**(详见第 2 节) |
| libwordfilter.so | 1.01 MB | 有(+RegisterNatives) | 动态注册(表在运行时建),字符串 `com/leiting/sdk/wordfilter/WordFilterHandler` | liblog,libm,libstdc++,libdl,libc | SDK(雷霆敏感词) | 否(`DevConfig.wordFilterSwitch`=false);空壳即可 |
| libgetuiext3.so | 54 KB | 有(+RegisterNatives) | `com_igexin_dms_core_NativeCaller` | liblog,libstdc++,libm,libc,libdl | SDK(个推推送) | 否;空壳,但推送常在 Application 初始化加载,风险中(推断) |
| libsobot.so | 14 KB | 无 | `com_sobot_chat_core_SobotUtil` | libc,libm,libstdc++,libdl | SDK(智齿客服) | 否(打开客服才用);空壳 |
| libtracepath.so | 92 KB | 无 | `com_netease_LDNetDiagnoService_{LDNetSocket,LDNetTraceRoute}` | liblog,libc,libm,libstdc++,libdl | SDK(网易网络诊断) | 否;空壳 |
| libentryexpro.so | 174 KB | 无 | 6 个 `com_unionpay_*`(HttpNative/UPPayEngine/NativeSDWriter/…) | libdl,liblog,libstdc++,libm,libc | SDK(银联支付) | 否(支付才用);空壳 |
| libuptsmaddon.so | 759 KB | 有(+RegisterNatives) | 动态注册,字符串 `com/unionpay/tsmservice/utils/IUPJniInterface` | libdl,liblog,libstdc++,libm,libc | SDK(银联 TSM) | 否;空壳 |
| libuptsmaddonmi.so | 759 KB | 有(+RegisterNatives) | 动态注册,`com/unionpay/tsmservice/mi/utils/IUPJniInterface`(小米变体) | 同上 | SDK(银联 TSM 小米) | 否;空壳 |
| libexecgame.so | 185 KB | 无 | — | liblog,libandroid,libm,libdl,libc | **壳(爱加密)** | 导出 `_Z5isX86v`/`_Z11checkExecSuv`(模拟器/环境检测),E0 已证原生 x86_64 可过 |
| libfakedyn.so | 270 KB | 无 | — (arm64) | liblog,libandroid,libm,libdl,libc | 壳(爱加密) | houdini/libnb 转译辅助;E0 已证可省(没放 arm64 版进 x86_64 目录也跑通了) |
| libfakedyn_x86.so | 290 KB | 无 | — (**实为 x86_64 ELF**,machine 62,误放在 arm64 目录) | 同上 | 壳(爱加密) | 同上;其本身就是 x86 件 |
| libsecsdk.so | 341 KB | 有 | — | liblog,libz,libdl,libc,libm,libstdc++ | 壳(爱加密 DEX-VMP,源码路径含 `mutiVmP/.../DeXAnalYST.h`) | **E0 关键结论:x86_64 下用空壳即跑通,说明本包未启用需要 x86 版 libsecsdk 的 VMP**(见第 3 节) |

**加载关系**:静态 `DT_NEEDED` 只连系统库;业务库彼此无 `DT_NEEDED` 依赖,都是 Java 层 `System.loadLibrary` 单独加载
(调用点在加密 DEX 里,静态不可见)。E0 已证:15 个 x86_64 空壳被系统全部接受,壳成功解密并进入 `LeitingApplication.onCreate`。

---

## 2. 重点:`libSocketHelper.so` 的 `H()` 及整类算法

### 2.1 H 的调用链与定位
E0 崩溃链:`SocketHelper.H(Native)` ← `DesUtil.decryptConfig:73` ← `SdkConfigManager.getLocalSdkConfig:347`
← `loadLocalSdkConfig:467` ← `LeitingSDK.initPlugAndConfigOnApplication:67` ← `LeitingApplication.onCreate:25`。
即 SDK 启动时读本地 SDK 配置并 DES 解密。

符号(`tools\syms.py`):`Java_com_leiting_sdk_SocketHelper_H` @ `0x163dc`(96 字节,薄包装)。
反汇编(`tools\dis.py`)显示它:`adrp x8,0x3b000` 取密钥常量 → `movz w0,#0x11`(17=16+NUL)+ `_Znam` 分配密钥缓冲 →
尾调用 `b 0x13a30`。通过 `.rela.plt`(DT_JMPREL)解析 PLT:

```
H @0x163dc -> PLT 0x13a30 -> GOT 0x5ccd0 -> _ZN6DesByJ18decodeAndHexToByteEP7_JNIEnvP8_jstringPKc
G @0x1637c -> PLT 0x134f0 -> _ZN6DesByJ18encodeAndHexToByteE...
```
即 **H = `DesByJ::decodeAndHexToByte(env, jstr, key)`**(DES 解码),G = 其编码逆。密钥常量 `adrp 0x3b000 + ldr q0,#0x4f0` 指向
`0x3b4f0 = "548711fdc20a2129..."`。分配 17 字节、加载 16 字节 → 密钥字面量是 16 字符 `548711fdc20a2129`。

### 2.2 算法与密钥(已实证)
对包内 `assets/sdkConfig.properties` 的 `wf=`(2160 hex = 1080 字节,8 的倍数)逐一尝试:

| 方案 | 结果 |
|---|---|
| **DES-ECB,key=ASCII `548711fd`(前 8 字符)** | **`{"loginUrl":"https://loginwf.leiting.com",...}` 合法 JSON**,尾部 PKCS5 填充 `06×6` |
| 3DES-2key(16 ASCII)/3DES-24/CBC | 全是乱码 |
| key=hex 解码 `548711fdc20a2129`(8 字节) | 乱码(否定对照) |

**结论**:单重 DES / ECB / PKCS5,密钥 = **16 字符字面量的前 8 个 ASCII 字符** `548711fd`。
H 流程 = unhex → DES-ECB 解密 → 去 PKCS5 → UTF-8;G = 反向(PKCS5 → DES-ECB 加密 → 小写 hex)。G 对上述明文回编码 hex 与原 `wf=` **逐字节一致**。
参考实现 `work\x86stubs\src\des_ref.py`(用 `cryptography` 的 TripleDES(k,k,k) 即单 DES)。

**测试向量**(供 C 验收):`H("cc590f74c86d450653021a2b2e695d3d") == "hello, leiting"`;`G("hello, leiting")` 得该 hex。

### 2.3 同类其它 native 方法的密钥表(0x3b4f0 连续常量区,`tools` 提取)
`548711fdc20a2129` `#LeitingAESKey#!` `LeitingAESIVKEY!` `f6c3f2c274be025a` `c953aadcb548212d`
`E3LfXBuk68bvhHyt` `#LeitingWEBAES#!` `LeitingWEBAESIV!` `leitingpkey12345` 以及 `ECB`/`CBC`。

按尾调用/所取密钥常量归类(`tools` 批量解析所有 `Java_*`):

| 方法 | 原语(尾调用/常量) | 密钥 / IV |
|---|---|---|
| **H / G** | DES-ECB 解/编 | key `548711fd` |
| L / k | DES 解 / 编 | (同族,常量未定位) |
| E / F | DES 编 / 解 | 推断 key `f6c3f2c2`(`f6c3f2c274be025a` 前 8) |
| A / B / C / D | AES-128-CBC(无 DES 尾调用) | key `#LeitingAESKey#!`,iv `LeitingAESIVKEY!` |
| N / O | AES-128-CBC(web) | key `#LeitingWEBAES#!`,iv `LeitingWEBAESIV!` |
| CW / DW | AES-128 | key `E3LfXBuk68bvhHyt` |
| G1..G5 | AES(内嵌 key bytes) | 各自常量(G4 用 `f6c3f2c274be025a`) |
| Run | socket hook `hook_app()`(xhook,`new_connect`/`new_send`/`new_dlopen`) | — |
| Release | `Console::shutdown()` | — |

> C 草稿已**完整实现并验证 H/G**;A/B/N/O/CW/DW/E/F 等按上表留了注释与空壳,等运行轨迹证明被调用再按同一形状补 AES-CBC(密钥已就位)。

---

## 3. 下一批会崩的点(启动必经 / 登录必经 / 可空壳)

依据:E0 日志(壳已过、真实 DEX 在跑)、`sdkConfig.properties`(`plugs=WordFilterPlug`)、
`commonConfig.properties`(`commonPlugs=MdidSdk,Sobot,LtshareSocial,OpenOtherApp`)、各 .so 符号、以及 `FEASIBILITY-x86.md` 第 2 节
(`DevConfig.sdkDummy=true` → 登录走 `ChannelSDKDummy`,不经雷霆)。

**启动必经(实现 H 后仍可能崩,需优先处理)**
1. `SocketHelper.H` — 已解,补 C 实现即过(本轮成果)。
2. H 之后 `SdkConfigManager` 解析 JSON、继续 `initPlugAndConfigOnApplication`。此处可能**再调同类 DES/AES 方法**
   (如对其它配置字段)。应对:C 里一次性把 `SocketHelper` 全字母按第 2.3 表实现,避免再次 `UnsatisfiedLinkError`(推断)。
3. `LeitingApplication.onCreate` 里若 `System.loadLibrary("SocketHelper")` 之外还 load 其它库(wordfilter/getuiext3),
   只要只做 `loadLibrary` 而不调用其 native 方法,x86_64 空壳(仅 `JNI_OnLoad`)即可通过——E0 已证 15 个空壳被接受。
4. **AIR `RegisterNatives` 阶段**:当 libCore 是空壳时,进程会死在 AIR 初始化(预期)。这是 E1 的事,需要**真实 33.1.1.620 x86_64 libCore**。

**登录必经(私服 sdkDummy 下大多不触发)**
- 雷霆登录走 `ChannelSDKDummy`,不调 `libSocketHelper` 的网络/登录 native,也不进 Leiting ANE(`FEASIBILITY-x86.md` 第 2 节)。
- `pinball.assetDownload`(资源下载)是**纯 Java ANE,无 .so**,不在本批 native 风险内;但功能必需(路线 C 才需要重写)。

**可空壳(私服路径不调用其 native)**
- libwordfilter(开关 false)、libsobot、libtracepath、libentryexpro、libuptsmaddon(mi)、libgetuiext3:
  x86_64 同名空壳(仅 `JNI_OnLoad` 返回 `JNI_VERSION_1_6`)。
- 用 `RegisterNatives` 动态注册的库(wordfilter/getuiext3/uptsmaddon*/libsecsdk):**方法签名静态不可见**;
  只要不被调用,空壳的 `JNI_OnLoad` 不注册任何方法也安全(推断,需 logcat 复核)。

**壳组件(E0 已给结论)**
- `libsecsdk`(DEX-VMP)、`libexecgame`(检测)、`libfakedyn*`:E0 用空壳即跑通并进入真实 DEX,
  说明**本包未启用需要 x86 版 VMP 的方法**。若后续在业务代码里碰到 VMP 抽取的方法才会暴露(目前无证据)。

---

## 4. AIR 33.1.1.620 x86_64 运行时 + NDK(联网只读,未下载)

### 4.1 AIR SDK 33.1.1.620
- **官方渠道现状**:`airsdk.harman.com/download` 与 `.../api/versions/listall` 都 **308 永久跳转到 `airsdk.wxlift.com`**
  (「AIRSDK 正从 HARMAN 迁往 wxlift 域」)。按硬规则**未打开 wxlift**,故无法在官方站核实 620 是否在列。
- **历史获取方式(GitHub 讨论 #1035 等,仍可核实)**:
  1. 直链规律 `https://airsdk.harman.com/download/<版本>`(维护者给过 `.../download/33.1.1.444`);代入即 `.../download/33.1.1.620`(**未验证**)。
  2. Release Notes 页 `airsdk.harman.com/release_notes` 把各版本列为超链接(**现也会被跳转到 wxlift**)。
  3. APM 工具:`apm airsdk install 33.1.1.620`(wiki:github.com/airsdk/apm)——下载并解包到当前目录(**未验证 620 是否存在**)。
- **是否需账号/授权**:Harman AIR 商用需许可证;可达页面未明确个别版本是否强制登录(推断:下载页或 APM 可能要许可证)。
- **精确文件/大小**:**无法给出**——没有能核实 33.1.1.620 的页面。可核实的邻近版本仅:33.1.1.444、33.1.1.533
  (archive.org 只有 Windows `AdobeAIR.exe` 7.5 MB,**不含 Android x86_64 运行时**)、33.1.1.554、33.1.1.743/744。
  620 介于 554 与 743 之间,**很可能是真实构建**,但本次拿不到确切 URL 与字节数。
- **x86_64 `libCore.so` 位置(推断)**:取得某个 33.1.1.620 SDK 后,运行时在
  `runtimes/air/android/device/x86_64/Runtime.apk` 内 `lib/x86_64/libCore.so`(对照本机 51.1.4.1 的同路径结构)。
  `libysshared.so` 的 x86_64 版同理在该 Runtime.apk 内找;找不到则用空壳。
- **不能用 51 混 33**:`FEASIBILITY-x86.md` 第 4 节已证——51 的 libCore 回调 33.1 没有的 4 个类、JNI 签名也变,会在 `FindClass/GetMethodID` 崩。

### 4.2 Android NDK(Windows,构建 x86_64 .so)
- `android-ndk-r27-windows.zip` = **781,482,169 字节(约 745 MiB)**,SHA1 `0ea2756e6815356831bda3af358cce4cdb6a981e`。
- 点版本 r27d = 781,506,724 字节,SHA1 `56607cbccd3642d4a1991f6bb3114a00f884f426`。
- 官方来源:developer.android.com/ndk/downloads(及镜像 developer.android.google.cn/ndk/downloads)、github.com/android/ndk releases。无需账号。
- 编译命令(草稿,见 `SocketHelper.c` 头注释):
  `…/toolchains/llvm/prebuilt/windows-x86_64/bin/x86_64-linux-android21-clang -shared -fPIC -O2 -o libSocketHelper.so SocketHelper.c`

---

## 5. 逐步实施计划(编译哪些库 / 实现哪些函数 / 每步看哪行日志算过关)

> 前提:E0 已过(壳原生 x86_64 跑通,进入 `LeitingApplication.onCreate`)。以下在 v30-perf2 基础上只增 `lib/x86_64/`,
> arm64 目录逐字节不变,重签名。**本轮不构建、不签名、不入包**,仅交付源码与计划。

**步骤 1 — 真实 `libSocketHelper.so`(x86_64)**
- 编译 `work\x86stubs\src\SocketHelper.c`(已含验证过的 H/G;A/B/N/O/CW/DW/E/F 先留空壳)。
- 验收:logcat **不再出现** `UnsatisfiedLinkError: ...SocketHelper.H`;SDK 配置解密成功,
  执行越过 `SdkConfigManager.getLocalSdkConfig:347`,进入后续初始化。

**步骤 2 — 12 个第三方库的 x86_64 同名空壳**
- 每个只含 `JNI_OnLoad{ return JNI_VERSION_1_6; }`(wordfilter/getuiext3/sobot/tracepath/entryexpro/uptsmaddon/uptsmaddonmi 等)。
- 验收:无 `dlopen`/`loadLibrary` 失败日志;若出现某库的 `No implementation found for Java_...`,
  按该符号在对应空壳里补一个返回默认值的 `Java_*`(RegisterNatives 库则在 `JNI_OnLoad` 里注册)。

**步骤 3 — 真实 `libCore.so`(x86_64,33.1.1.620)+ `libysshared.so`**
- 取得 33.1.1.620 x86_64 Runtime.apk,抽 `lib/x86_64/libCore.so`、`libysshared.so`;`libc++_shared.so` 用 NDK 的 x86_64 版。
- 验收:越过 AIR `RegisterNatives` 阶段,出现 AIR 启动日志(Stage3D/EGL 初始化、`AppEntry`),能到标题画面。
  **这步是 E1 的成败点**,取决于能否拿到精确 33.1.1.620 x86_64 libCore(第 4 节风险)。

**步骤 4 — 功能回归 + 测帧率**
- MuMu 原生 x86_64:标题 → 登录(sdkDummy 路径)→ 资源下载 → 进战斗 → 多人;arm64 真机验证原路径不变。
- 若中途再崩 native:多半是 `SocketHelper` 的 AES 字母(A/B/N/O/CW/DW),按第 2.3 密钥表在 `SocketHelper.c` 里补 AES-128-CBC 实现
  (key/iv 已就位),再回步骤 1 验收。
- 验收:能稳定进本体并出帧率数据(本项目 perf 主线目标)。

**风险与回退**
- 33.1.1.620 x86_64 libCore 取不到 → 退路线 C(本机 AIR 51.1.4.1 整体重打包,`FEASIBILITY-x86.md` 第 6 节),代价 6–10 天。
- 若后续暴露需要 x86 版 `libsecsdk` 的 VMP 方法(目前无证据)→ 路线 A 失败,同样转 C。

---

## 来源
- 本机:`work\x86stubs\arm64\*`(APK 解包)、`work\x86stubs\assets\*`、`work\x86probe\p3.out.txt`、`work\e0\logcat.txt`、`FEASIBILITY-x86.md`。
- 自写脚本:`work\x86stubs\tools\{syms.py,dis.py}`、`work\x86stubs\src\des_ref.py`(算法验证,证据可复现)。
- [airsdk/Adobe-Runtime-Support #1035 Archived versions of SDK](https://github.com/airsdk/Adobe-Runtime-Support/discussions/1035)(下载 URL 规律、APM 用法)
- [Adobe AIR 33.1.1.533 — Internet Archive](https://archive.org/details/adobeair_)(邻近版本,仅 Windows exe,无 Android x86_64)
- NDK r27:GitHub android/ndk release 清单(`android-ndk-r27-windows.zip` 781,482,169 B,SHA1 0ea2756e…);官方页 developer.android.com/ndk/downloads。
- `airsdk.harman.com/download` 现 308 跳 `airsdk.wxlift.com`(未打开,按硬规则)。
