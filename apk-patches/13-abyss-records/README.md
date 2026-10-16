# 13 深渊本期最快纪录展示

在深渊详情中请求并显示本期全服最快通关用时

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`cn.ui.AbyssDetails/openDetails`；`cn.ui.AbyssRecordDetails/*`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

昵称最终responseText由abyss-record-holder脚本覆盖；只收原AS会漏最终昵称补丁。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\README.md:1-40`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AbyssDetails$/openDetails](pcode/cn.ui.AbyssDetails--AbyssDetails__openDetails.pcode.txt)；body `9`；code SHA-256 `e4e50796a8508b022a9c3a4942ba205e1377a782308b56bb9de77d827d907218`。
- [AbyssRecordDetails$/formatTime](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__formatTime.pcode.txt)；body `0`；code SHA-256 `16f6ce4add4ca83d2870f3a1b7b217d99d557ebe3a168bf31706acc79b84b66a`。
- [AbyssRecordDetails$/responseText](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__responseText.pcode.txt)；body `1`；code SHA-256 `bd6bdb780750710767f9f6b05cfb6d8bc5f3b12c0285a5364032036e29fd9bf7`。
- [anonymous-method-4](pcode/cn.ui.AbyssRecordDetails--anonymous-method-4.pcode.txt)；body `2`；code SHA-256 `f199ce0fe19d0460945228a83f128659c1926af516ca140b1c9657c861fa7628`。
- [anonymous-method-5](pcode/cn.ui.AbyssRecordDetails--anonymous-method-5.pcode.txt)；body `3`；code SHA-256 `dc36e7c5312991305894e715b2110f511ec8fc3ee7a4b8f3258aad2a26cadded`。
- [anonymous-method-6](pcode/cn.ui.AbyssRecordDetails--anonymous-method-6.pcode.txt)；body `4`；code SHA-256 `8e728287a9c6352b245d09ce42124084635aba595b668dcceb3058d0be0c5766`。
- [AbyssRecordDetails$/open](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__open.pcode.txt)；body `5`；code SHA-256 `39e929fac668eb3611ba416d514a69dfd6179c0719c907bbf93b977dbc4df5fb`。
- [anonymous-method-8](pcode/cn.ui.AbyssRecordDetails--anonymous-method-8.pcode.txt)；body `6`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [AbyssRecordDetails$/show](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__show.pcode.txt)；body `7`；code SHA-256 `c4086a61cd284d04b647013927af1fbb06226930445c4b8aeee3c5bfaaf263c6`。
- [AbyssRecordDetails$/<cinit>](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails___cinit_.pcode.txt)；body `8`；code SHA-256 `dee51013bf04e5bd8544837c46f8000e71eee934c53224a90b60150e2e48415c`。
- [AbyssRecordDetails/<ctor>](pcode/cn.ui.AbyssRecordDetails--AbyssRecordDetails__ctor_.pcode.txt)；body `9`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.ui.AbyssRecordDetails--anonymous-method-0.pcode.txt)；body `10`；code SHA-256 `ba12d940b8c361ceaf9219504957833f53a7d8bf369fd693ddd5d181b06b1af3`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\patch_swf.py`；3,012 B；SHA-256 `0a3f03adf1b71c4affcd7c53b6629af0627a9a6ab2602ae27fb920239a2c2205`。
- [AbyssRecordDetails.as](source/AbyssRecordDetails.as) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-records\src\cn\ui\AbyssRecordDetails.as`；6,045 B；SHA-256 `73985005705045abbb53a64cdaa052e7edc64e1729bf0673bf047852f4eaa27d`。
- [abyss-record-holder--patch_swf.py](source/abyss-record-holder--patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\abyss-record-holder\patch_swf.py`；2,395 B；SHA-256 `cbb5c4065d5eb2cea0ca895b09a23ecb2e42a4d9157679e5676165ea7d44c86a`。
