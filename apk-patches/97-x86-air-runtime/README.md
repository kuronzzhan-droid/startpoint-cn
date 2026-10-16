# 97 x86_64 同版 AIR 运行时

为双 ABI 测试包追加 AIR 33.1.1.620 x86_64 运行时及 C++ 依赖，使模拟器能原生运行。

- 首发 APK 版本：**v33-x86**。
- v33 使用的最终修订：v33-x86。
- 适用包：仅 v33-x86。
- 改动位置：`lib/x86_64/libCore.so`；`lib/x86_64/libc++_shared.so`。
- 修的问题或错误码：ARM 转译下主线程占满、战斗掉帧。
- 依赖：x86 SDK/壳桩；SocketHelper；ANE Android-x64 平台
- 是否只能以二进制形式发：该项运行时只能以预编译二进制提供：本地没有 libCore 与 libc++_shared 对应源码，文件分别约 21.7 MB / 1.12 MB。按禁收二进制及单文件上限未收；只收调用构建脚本。

## 最终采用证据

构建链及原始说明：

- `D:\WF\perf-v30-20261015\FEASIBILITY-x86.md:172-198`
- `D:\WF\perf-v30-20261015\E3-PLAN.md:94-109`
- `D:\WF\perf-v30-20261015\build-v33x86.ps1:8-15`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。


## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build-v33x86.ps1](source/build-v33x86.ps1) ← `D:\WF\perf-v30-20261015\build-v33x86.ps1`；1,598 B；SHA-256 `4c453b373f29550e4bb554e85f9c7d61c683ff877399b7a6dc42708bf9f8511d`。
- [build-e3.ps1](source/build-e3.ps1) ← `D:\WF\perf-v30-20261015\build-e3.ps1`；2,038 B；SHA-256 `22c828c2c84ace543b5a1677f3b38cbcd083df9ded0029ff34dc15e1878d78e9`。
- [build_x86.py](source/build_x86.py) ← `D:\WF\perf-v30-20261015\tools\build_x86.py`；1,942 B；SHA-256 `93dad51b1a9316cbedf4f76042d507cbb119dbfab50a547f5a1347a4339fb3ac`。
