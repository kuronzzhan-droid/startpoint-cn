# Android 内网验收包转公网

`build_android.py` 从 `../android-accepted.json` 的 `lan` 条目选择输入，也可用
`--record` 指定另一份已验收登记。`--input-apk` 只允许改变文件位置，APK 身份仍须
通过 `verify_android_baseline.py`。脚本从 SWF `cn.admission::BuildConfig` 回读
旧 ID、KEY、ORIGIN，并用受限 `--keys-file` 查旧/新配对。公网 origin、
新 ID、AIR UUID、输出路径和构建工具路径都由调用者传入。

`--scratch` 的父目录必须预先建立并限制 ACL 为当前用户、SYSTEM 与
Administrators。脚本会再次检查新 scratch 目录的 ACL。解出的 SWF、DEX、
未签名 APK 和签名日志只留在该目录；keys 文件不会复制进去。输出 APK
与 scratch 必须位于 Git 仓库外，且必须是新路径。签名调用既有 DPAPI 工具。

本入口保留 R4 的字符串池布局门槛：地址常量 9 处、准入 ID 常量 3 处、
准入 key 常量 2 处。DoABC 与方法体总数从所选登记读取。换用布局不同的
新基线前，须先核对实际字符串引用并更新门槛；不能跳过逆变换核验。
脚本逐项核验非目标 SWF 标签、全部 DEX 类、非目标 APK 成员、AIR UUID、
签名证书、v1/v2 签名和 ZIP 对齐。它不安装客户端或验证公网服务。
