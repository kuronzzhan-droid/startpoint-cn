# 100 x86_64 SocketHelper JNI 实现

以 E3 C 实现补齐雷霆 SDK 的 SocketHelper native 入口，越过启动配置解密必经点。

- 首发 APK 版本：**v33-x86**。
- v33 使用的最终修订：v33-x86。
- 适用包：仅 v33-x86。
- 改动位置：`lib/x86_64/libSocketHelper.so / com.leiting.sdk.SocketHelper`。
- 修的问题或错误码：E0 的 UnsatisfiedLinkError: SocketHelper.H(String)。
- 依赖：NDK/JNI；SocketHelper.c 的 H/G 实现
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

SocketHelper.c 虽是早期文件，却被最终 SocketHelper_e3.c #include，属于最终构建依赖；不收未使用的 gen/libSocketHelper.c。AES/M 等部分语义仍沿用原报告推断等级。

## 最终采用证据

构建链及原始说明：

- `D:\WF\perf-v30-20261015\E3-PLAN.md:68-92`
- `D:\WF\perf-v30-20261015\E3-PLAN.md:111-122`
- `D:\WF\perf-v30-20261015\build-e3.ps1:10-16`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。


## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [SocketHelper_e3.c](source/SocketHelper_e3.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\src\SocketHelper_e3.c`；15,306 B；SHA-256 `7b88f64cb6d5e19acc55f8c10000c8d6d3529143961b105ba3bd4cc10bf763c7`。
- [SocketHelper.c](source/SocketHelper.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\src\SocketHelper.c`；9,009 B；SHA-256 `fb6f8b8315c15267dd0e0a707f77a97263770aaa2703df5cfba8328e05145d62`。
- [build-v33x86.ps1](source/build-v33x86.ps1) ← `D:\WF\perf-v30-20261015\build-v33x86.ps1`；1,598 B；SHA-256 `4c453b373f29550e4bb554e85f9c7d61c683ff877399b7a6dc42708bf9f8511d`。
- [build-e3.ps1](source/build-e3.ps1) ← `D:\WF\perf-v30-20261015\build-e3.ps1`；2,038 B；SHA-256 `22c828c2c84ace543b5a1677f3b38cbcd083df9ded0029ff34dc15e1878d78e9`。
- [build_x86.py](source/build_x86.py) ← `D:\WF\perf-v30-20261015\tools\build_x86.py`；1,942 B；SHA-256 `93dad51b1a9316cbedf4f76042d507cbb119dbfab50a547f5a1347a4339fb3ac`。
