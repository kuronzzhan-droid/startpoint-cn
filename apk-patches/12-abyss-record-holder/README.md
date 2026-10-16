# 12 深渊纪录保持者昵称

在最快用时下显示纪录保持者当前公开昵称并安全转义

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`cn.ui.AbyssRecordDetails/responseText`。
- 修的问题或错误码：未发现专用错误码
- 依赖：abyss-records
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\README.md:3-11`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AbyssRecordDetails$/responseText](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__responseText.pcode.txt)；body `1`；code SHA-256 `bd6bdb780750710767f9f6b05cfb6d8bc5f3b12c0285a5364032036e29fd9bf7`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\patch_swf.py`；2,395 B；SHA-256 `cbb5c4065d5eb2cea0ca895b09a23ecb2e42a4d9157679e5676165ea7d44c86a`。
