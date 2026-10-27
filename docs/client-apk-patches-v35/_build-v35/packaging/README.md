# v35 测试包封包

v35f 以后测试服只出一个 x86 包(同时带 arm64-v8a 和 x86_64 库,ARM 侧与 ARM 包逐字节一致)。做法是拿已签名的 v35e-x86 包当底,只换主 SWF 和 `android:versionCode`:

```
python swap_swf_bump.py v35e-x86.signed.apk v35k.swf 1008009 v35k-x86.unsigned.apk
```

之后用 Android SDK 的 `zipalign -p 4` 和 `apksigner` 对齐、签名。其余条目按原压缩方式和顺序原样复制。

x86 模拟器移植本身(重写的 libSocketHelper、模拟器桩、ANE 补丁、`build_x86.py`)在 `docs/client-apk-patches-v33/100-x86-sockethelper`。
