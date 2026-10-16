# 99 x86_64 SDK 与壳兼容桩

为其余十二个 native 库名提供兼容桩，使 Android 选用 x86_64 且保留启动所需库名和入口。

- 首发 APK 版本：**v33-x86**。
- v33 使用的最终修订：v33-x86。
- 适用包：仅 v33-x86。
- 改动位置：`lib/x86_64/libentryexpro.so 等十二个库（不含 AIR 两库和 SocketHelper）`。
- 修的问题或错误码：缺失同名 x86_64 库/入口会阻断加载；这些桩不提供完整支付、推送等 SDK 功能。
- 依赖：NDK/JNI；同版 AIR；SocketHelper
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

现场只读 ELF 字符串中每库的 .c 文件名与 gen 文件相符，libysshared 对应 stub.c；所有 .so 与 x86_64-e3 缓存逐字节一致。实际产物无 X86STUB 诊断字符串，故不收计划中的 stub_logged.c。E2 十二库完整编译命令未找到，不能宣称可逐字节重建。

## 最终采用证据

构建链及原始说明：

- `D:\WF\perf-v30-20261015\X86-STUBS-PLAN.md:28-52`
- `D:\WF\perf-v30-20261015\build-e3.ps1:10-16`
- `D:\WF\perf-v30-20261015\build-v33x86.ps1:13-16`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。


## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [libentryexpro.c](source/libentryexpro.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libentryexpro.c`；6,982 B；SHA-256 `e158622c7125e5d73e3fa1a7e5e67504bd9d83e5aff9cb460924471427757c20`。
- [libexecgame.c](source/libexecgame.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libexecgame.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libfakedyn.c](source/libfakedyn.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libfakedyn.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libfakedyn_x86.c](source/libfakedyn_x86.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libfakedyn_x86.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libgetuiext3.c](source/libgetuiext3.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libgetuiext3.c`；267 B；SHA-256 `c6008efaa9bd74c8a87c104e075d03285ba68d0b3c8c6b58376c0893fcda59b1`。
- [libsecsdk.c](source/libsecsdk.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libsecsdk.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libsobot.c](source/libsobot.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libsobot.c`；262 B；SHA-256 `6752549dc2aab6f1001c4ecb737c5cc1cff2300b13070819a89a63829ce06711`。
- [libtracepath.c](source/libtracepath.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libtracepath.c`；436 B；SHA-256 `80d10e3638f32bc63ed1788ca965b475a8645fc79b43f20facd457f9d19e9d64`。
- [libuptsmaddon.c](source/libuptsmaddon.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libuptsmaddon.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libuptsmaddonmi.c](source/libuptsmaddonmi.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libuptsmaddonmi.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [libwordfilter.c](source/libwordfilter.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\gen\libwordfilter.c`；139 B；SHA-256 `71cc3d54ef26cdddecb2b092300feda8b6232cd703eb3a270424c263bf0f9ac9`。
- [stub.c](source/stub.c) ← `D:\WF\perf-v30-20261015\work\x86stubs\src\stub.c`；100 B；SHA-256 `f8e4c34c8fc1e700599237e8a99397a9944aeb3849e53950ad9e9019de68aa92`。
- [build-v33x86.ps1](source/build-v33x86.ps1) ← `D:\WF\perf-v30-20261015\build-v33x86.ps1`；1,598 B；SHA-256 `4c453b373f29550e4bb554e85f9c7d61c683ff877399b7a6dc42708bf9f8511d`。
- [build-e3.ps1](source/build-e3.ps1) ← `D:\WF\perf-v30-20261015\build-e3.ps1`；2,038 B；SHA-256 `22c828c2c84ace543b5a1677f3b38cbcd083df9ded0029ff34dc15e1878d78e9`。
- [build_x86.py](source/build_x86.py) ← `D:\WF\perf-v30-20261015\tools\build_x86.py`；1,942 B；SHA-256 `93dad51b1a9316cbedf4f76042d507cbb119dbfab50a547f5a1347a4339fb3ac`。
