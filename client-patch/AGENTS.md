# Android APK/SWF 工作入口

2026-10-24 当前后续开发基线为累计内容运营、历史入口、时间栏及兑换修复、个人“一览”和主城外观控制的 Android 内网 R11，登记层级为 `accepted_offline`，默认读取 [android-accepted.json](android-accepted.json) 的 `variants.lan`。身份与验证范围见 [R11 登记记录](ACCEPTANCE-CONTENT-OPERATIONS-ANDROID-LAN-20261024.md)。`variants.public` 保留 10-17 PR43 公网包的原身份和验收范围，它尚未包含 R11 累计改动；后续同功能公网版应从 R11 转换，不回落旧公网包重新拼装。R4、加载修复 r2、Q1/Q2/Q3 仍不采用。

当前 Android 直接基线以 [android-accepted.json](android-accepted.json) 的 `default_variant` 和 `baseline_selection` 为准，默认选择 `lan`；同功能公网版尚未制作，不把现存旧 `public` 当成功能对等包。从登记读取成品路径、哈希、地址、ABC 身份、准入号、验收层级及对应审计/方法文档；不按旧日期、文件名或历史报告选包。R11 沿用原内网测试准入材料，登记不推进准入号或更改服务端允许名单。累计实现入口见 [content-operations](content-operations/README.md) 与 [town-theme](town-theme/README.md)；历史验收记录只证明各自载体与当时覆盖范围。

- 实际选择、解包或修改 Android APK/SWF 输入时，读取本目录 `ANDROID-BASELINE.md`、所选 `android-accepted.json` 变体及相关补丁文档；已加载且未变的规则不重读。JSON 中登记的已验收公网/内网成品是当前直接基线，其他文档的旧哈希只代表历史步骤；仅整理文档不触发包身份校验。
- 对所选实际输入运行 `python client-patch/verify_android_baseline.py --variant public` 或 `--variant lan`，回读 APK、内嵌 SWF 和 AIR UUID。同任务登记、成品及相关校验条件未变时复用有效结果，不因切换步骤或收尾重跑；输入/登记变化或身份矛盾时补查。输入缺失或不匹配时不得按日期、文件名或旧报告另选 APK，也不得跳过哈希保护。新成品按其自身最终载荷验证，不能沿用基线结果。
- 累计功能保留救援铃铛 C8016 v3、10 分钟缓存清理、玩家登录、Lens 0910、属性通道、深渊详情、旧服空更新兼容、覆盖安装首次启动缓存清理、圆角按钮与切队初始化/触摸保护，以及此前全部 MOD、幻想连战、排行榜、关注/本人资料路由、CNtips_b 隐藏、422/724、五重决战及 700099 续战队伍复用。公网迁移的历史范围见 [ACCEPTANCE-OROCHI-RESCUE-BELL-PUBLIC-20261004.md](ACCEPTANCE-OROCHI-RESCUE-BELL-PUBLIC-20261004.md)；9 月 9/10 日登记是归档复现输入，不再作为新任务基线。
- 旧步骤构建器锁定各自的历史输入，用于解释或复现该步骤；不能把任一中间产物直接当成最新成品。不同 UUID 会改变 APK 哈希，串联重建时不得为通过旧步骤的哈希检查而复用 UUID。
- 改动 SWF 时分配新 `uniqueappversionid`，保持包名、版本身份和签名证书；回读最终载荷、方法差异、UUID、ZIP 对齐和签名。完整类重编译产物只能用于提取 P-code，不能直接发版。
- 构建报告只记录本地校验；用户明确验收或明确要求执行验收后，按实际证据更新 `android-accepted.json`、方法文档和检查器，再按用户授权提交。离线验收记为 `accepted_offline`，不得记成用户已真机验收。APK、SWF 成品、临时产物和签名凭据不提交 Git；IPA 必须单独授权。

# iOS IPA 工作入口

2026-10-25 当前 iOS 后续开发基线为装备修复与 R11 内容运营、个人一览、主城外观控制的累计整合 ARM64 公网未签名 IPA，登记层级 `accepted_offline`。身份及范围见 [R11 累计整合登记记录](ACCEPTANCE-R11-IOS-COMPACT-20261025.md)，最终源码入口见 [累计整合配方](ios-r11-port/CUMULATIVE-COMPACT.md)及其引用的各阶段工具。沿用 10-17 公网地址和 iOS 准入材料，不推进准入号。当前无同功能内网变体，需要内网版时从该公网基线转换；10-17 及更早登记完整保留于 lineage，仅作历史复现。未执行 iOS 原生、真机、重签安装或公网登录，未部署云服；体积减少不代表启动、内存或稳定性已经改善。

当前 iOS 直接基线以 [ios-accepted.json](ios-accepted.json) 为准。成品路径、哈希、地址、准入号、完整 ABC/AOT 身份和方法数量、验收层级读取登记及其引用的审计/方法文档；离线校验不代表真机验收，旧包的验收状态不自动继承给新包。以下内容用于保留累计功能、平台差异和已验证方法，不重复维护当前成品身份。

- 实际选择、解包或修改 iOS IPA/SWF/AOT 输入时，读取 `ios-accepted.json` 及相关方法文档，运行 `python client-patch/verify_ios_baseline.py` 回读实际 IPA、主可执行文件、主 SWF 的 SHA-256 和包身份。同任务登记、成品及相关校验条件未变时复用有效结果，已加载且未变的规则不重读；仅整理文档不触发包身份校验。输入/登记变化或身份矛盾时补查，输入缺失或不匹配时不得改用旧包、诊断包或按文件名推测最新包；新成品按其自身最终载荷验证。
- 保留救援铃铛 iOS 修复、超级+ 紧凑内置排版、10 分钟缓存清理（状态放在新类 `cn.mod::CacheCleanupState`，`GlobalLoading/applyLoad` 原生入口包装器）、F1009 静态槽修复，以及 SET C8601、幻想连战返回、EX 和独立编队等累计功能。10-04 旧候选进入副本触发 F1009 后已停用，原因与修复见 [IOS-STATIC-SLOT-F1009-20261004.md](IOS-STATIC-SLOT-F1009-20261004.md)；该批离线范围见 [ACCEPTANCE-OROCHI-RESCUE-BELL-IOS-FIX-20261004.md](ACCEPTANCE-OROCHI-RESCUE-BELL-IOS-FIX-20261004.md)，不把旧候选作为当前成品。
- 以下为 2026-09-12 及更早累计功能保留说明，见 `ACCEPTANCE-CACHE-PARTY-20260912.md`：保留空更新、安装变化后一次 NSURLCache 清理、圆角按钮及 R4 的登录、深渊、属性伤害通道、Lens 0910、TrollStore 布局、公网初始地址和 HUD 字段修复，以及旧方法 26363 和全部 Lens/资料页行为。iOS 不加入 Android 切队修复。原 unsigned 成品与方法数量属于历史登记；当前成品、完整 ABC 数量与验收层级读取 `ios-accepted.json`。用户确认与离线检查分开记录。R4 和更早包仅作历史精确复现，不以 stripped ABC 替代完整 ABC，不绕过历史哈希保护。
- 保留此前累计功能及 iOS 标题 `CNtips_b` 原有行为，不移植 Android 的标题隐藏。诊断包不作为当前成品，不将 DEBUG 标记带入后续发布。
- 原构建、交付及诊断报告保留生成时状态，后续用户验收单独登记。验收不等于授权提交 Git、重签、部署或清理其他 IPA。
- 新增 iOS AOT 数据或 dyld 重定位流时，所有加载器使用的 LINKEDIT 数据必须位于 `LC_CODE_SIGNATURE.dataoff` 之前，签名区域应为文件最后一段。禁止把新增重定位流附在旧签名尾部之后；重签可能移除或覆盖它，导致游戏代码执行前在 dyld 内闪退。每个相关最终成品检查实际偏移、段边界及签名尾部；本次改变加载元数据、重定位或签名布局时，模拟替换不同大小的签名块，确认 rebase/bind/导出及符号数据完整。同任务载荷和检查条件未变时复用有效结果。参考 `ios-cumulative-login/test_signing_layout.py`；未签名 IPA 的静态解析成功不代表重签后可启动。
- TrollStore 安装链还必须满足其 `ldid` 的裁剪边界：它会将 `LC_SYMTAB.stroff + strsize` 向上对齐 16 字节作为签名起点，优先于原 `LC_CODE_SIGNATURE.dataoff`。新增 rebase 等数据应放在符号字符串表之前，字符串表作为最后的加载元数据，签名紧随其后。仅把数据移到签名之前仍可能被 ldid 覆盖；按实际 ldid 分配/裁剪规则核验相关最终成品，不能只模拟从原签名偏移替换尾部。首次采用该方法、加载元数据/重定位/签名工具或检查器规则变化、裁剪疑点或缺少匹配证据时，用历史错误包证明检查能捕获 `unknown rebase opcode 0xF0`；方法与检查器未变时复用已有负例证据，不重复重跑旧包。
- iOS 登录面板等标题前置联网功能必须核对版本查询完成前的实际地址，不能只凭包内出现公网 IP 或沿用原包配置就判定为公网。原生 `DevConfig_gf_ios` 的初始官网地址会在异步版本查询后才替换；提前缓存它会让登录面板及重试继续访问旧地址。地址/origin、加载常量或相关 AOT 改动时，核对最终成品原生构造器实际加载的协议/主机常量和字符串池，保持初始地址与云服版本配置的规范写法一致。首次采用该方法、对应方法/检查器变化、实际地址疑点或缺少匹配负例证据时验证历史 R2；其余复用有效证据。参见 `ios-cumulative-login/public_endpoint.py` 和 `verify_public_endpoint.py`。
- iOS AOT 给既有类追加实例字段时，必须核对实际内存偏移；trait 列表只追加并不保证原生 ABI 不变。AIR arm64 将 32 位标量放在引用字段之前，追加 `int/uint/Boolean` 可能移动全部既有引用字段，使保留的构造器、初始化、访问器和其他调用者读写错误位置。R3 的三个 HUD 语音计数字段导致引用偏移整体增加 8 字节，在 `HudMemberStatus.run` 初始化时触发 F1009。R4 使用尾部 Number 存储、零默认值和显式整数读取，保留轮换语义与原引用偏移。实例字段或相关 AOT 规则变化时，从最终成品实际 ABC 和原生加载指令共同核验；首次采用方法、字段布局方法/检查器变化、ABI 疑点或缺少匹配负例证据时用 R3 错误包作负例，方法/检查器未变时复用已有负例结果。参见 `ios-cumulative-login/hud_state_layout.py`、`verify_hud_state.py`；不得仅给报错方法加空值保护或仅重编译一个访问者来掩盖字段错位。
