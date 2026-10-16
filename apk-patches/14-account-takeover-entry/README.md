# 14 标题和游戏内数据继承入口

恢复标题菜单第四格及游戏内菜单的数据继承入口，复用客户端原生继承页面和处理。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MenuTopScene.createMenuListData、TitleMenuDialogContentView.setupContents`。
- 修的问题或错误码：V51 中继承逻辑存在但缺正常可见入口；只改 TitleMenuDialog.prepare 顺序无法改变真实显示。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:72-91；两方法最终载荷与原生点击逻辑`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MenuTopScene/createMenuListData](pcode/boot_ffc6--MenuTopScene_createMenuListData.pcode.txt)；body `77056`；code SHA-256 `628e347f457027585c6e34dc8a57651736f4ed6b1c2be611c1ede2c39e854098`。
- [TitleMenuDialogContentView/setupContents](pcode/boot_ffc6--TitleMenuDialogContentView_setupContents.pcode.txt)；body `37085`；code SHA-256 `77dcedbfbea53661d3755c303efa7ab2bc8093983c8e6068fb11f439b159db92`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_apk.py](source/build_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\build_apk.py`；23,983 B；SHA-256 `bdf57cb5e32d6a98234040caf524dba6a1e2b50e0c701312785f50ad006a4ea0`。
