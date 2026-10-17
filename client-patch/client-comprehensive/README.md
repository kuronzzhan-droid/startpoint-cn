# R4 Android 客户端源码组合

`build_swf.py` 只接受登记在 `android-accepted.json` 的上一版 LAN 基线，或显式提供且 SHA-256 为 `4f62b899a89b0648f79d0dbaf20d8aab9b64ad91959d91706dc71af02cb6c335` 的旧 APK。其内嵌 SWF 必须为 `9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7`。当前 `variants.lan` 是 R4 成品，不能回退作构建输入。

固定组合顺序为编队动画等待修复、编队刷新复用、网络请求预算、角色数据与徽标 Lazy、资源按需队列、UI 差量更新。各阶段用方法指纹拒绝未知或重复输入；从阶段报告收集目标方法与 helper 名称，最终比较原有 96,706 个方法体、类布局、常量池前缀与非 ABC 标签，并用独立 FFDec 对照。目标为 47 个改动方法、5 个 helper ABC、102 个新增 body 和 LAN R4 SWF SHA-256 `3f37dee12692b53cd6f9db0a21ec826366d56b8338cdfa66216fc7dbc2efde37`。

运行前指定 AIR SDK 51.2.1.5、Java 与 FFDec。资源编译产物可通过 `--assets` 指向含 `manifest.json`、`runtime.swc` 与 `donor.swc` 的目录；省略时在新工作目录中从本目录源码编译。

```powershell
python -B client-patch/client-comprehensive/build_swf.py --input-apk <previous-LAN.apk> --work <new-work-directory> --output <new-R4.swf> --sdk <AIRSDK-directory> --java <java.exe> --ffdec <ffdec.jar> --assets <resource-assets-directory>
python -B client-patch/client-comprehensive/build_apk.py --input-apk <previous-LAN.apk> --swf <new-R4.swf> --expected <new-work-directory/expected.json> --work <new-apk-work-directory> --output <candidate.apk> --java <java.exe> --ffdec <ffdec.jar> --d8 <d8.jar> --baksmali <baksmali.jar> --smali <smali.jar> --apksigner <apksigner.jar> --zipalign <zipalign.exe>
```

封包器使用同一上一版 LAN 基线，只替换 SWF、三个原生缓存类与配对 AIR 身份。综合原生源码位于 `native/cn/startpoint/StartupCache.java`：定期清理延后到下次冷启动，范围限于 `cache/app` 与 `cache/.AIR`；安装身份清理保持。封包回读检查 DEX 其余类与 APK 其他成员、签名和对齐。构建工具不安装 APK、不改变准入配对或 accepted registry；AIR 夹具和静态字节码对照不代表设备验收。
