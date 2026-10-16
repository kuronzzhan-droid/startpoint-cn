# 74 主表 key 下标字典缓存

为 MasterBinaryMap 懒建 key 到首个下标的字典，严格校验命中，降低重复线性查表成本。

- 首发 APK 版本：**v30-perf**。
- v33 使用的最终修订：v30-perf。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MasterBinaryMap/getIndex`。
- 修的问题或错误码：全场景重复 indexOf；找不到 key 仍按原逻辑抛 8601。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\perf-v30-20261015\tools\perf2_patches.py:18-25`
- `D:\WF\perf-v30-20261015\REPORT.md:307-385`
- `D:\WF\perf-v30-20261015\REPORT.md:458-480`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MasterBinaryMap/getIndex](pcode/boot_ffc6--MasterBinaryMap_getIndex.pcode.txt)；body `5759`；code SHA-256 `c0afa6d54379daa2b32406e40218f4f556b7569179fe39db5146f2b710f4cfbe`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [perf2_patches.py](source/perf2_patches.py) ← `D:\WF\perf-v30-20261015\tools\perf2_patches.py`；14,850 B；SHA-256 `08c28cf3492d0c5c03ae87a51e0477e18a00438f4358d21ee08c87536841c224`。
- [perf2_apply.py](source/perf2_apply.py) ← `D:\WF\perf-v30-20261015\tools\perf2_apply.py`；1,900 B；SHA-256 `d000586e73c2c430b91e3efc8a3e1f6676ee20c02f36b95b78a3b689f88a6966`。
- [perf2_core.py](source/perf2_core.py) ← `D:\WF\perf-v30-20261015\tools\perf2_core.py`；9,504 B；SHA-256 `b5d50c6ae613e22773f8dd969df0faf80a3afe4a1aa1bef790b561ceb94c4a8a`。
- [build_perf2_apk.py](source/build_perf2_apk.py) ← `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py`；6,583 B；SHA-256 `52f0ed20f5b74bddc3c3b76c6100525cbaa8751674dd12b8180db1754d48b862`。
- [patch_perf.py](source/patch_perf.py) ← `D:\WF\perf-v30-20261015\tools\patch_perf.py`；10,127 B；SHA-256 `8774d4809f0cd648687c121306f54551c482ed83672b225d12303eb0dc34455a`。
