# 36 空账号记录恢复与原子替换写入

空账号返回登录流程，账号和设备记录经同目录临时文件替换写入

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AccountLocalStore_Impl_$/get`；`AccountLocalStore_Impl_$/saveAccountData`；`DeviceLocalStore_Impl_$/writeFile`；`cn.storage.LocalRecordIO/*`。
- 修的问题或错误码：Error #2030：0字节账号文件解包EOF导致重开黑屏
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

AS源及写入钩子生成脚本俱在。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\README.md:7-23`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AccountLocalStore_Impl_$/get](pcode/boot_ffc6--AccountLocalStore_Impl___get.pcode.txt)；body `29386`；code SHA-256 `16a02778ee23e4f6fdf43350ef9e735b689669bb75f6710ad04d3fe3110b547c`。
- [AccountLocalStore_Impl_$/saveAccountData](pcode/boot_ffc6--AccountLocalStore_Impl___saveAccountData.pcode.txt)；body `29390`；code SHA-256 `47dc813287972f40c4a72c57dbbeb2ea6e71a2324a88dd654802f4c3032fd5d0`。
- [DeviceLocalStore_Impl_$/writeFile](pcode/boot_ffc6--DeviceLocalStore_Impl___writeFile.pcode.txt)；body `29456`；code SHA-256 `a248484cb9a33d4667109fb1a8e542a9d5a05252b28e3ea48f277c2f17875423`。
- [LocalRecordIO$/writeBinaryFile](pcode/cn.storage.LocalRecordIO--LocalRecordIO__writeBinaryFile.pcode.txt)；body `0`；code SHA-256 `2486d1077a319688498241af0ec4b088b6b0fea257febfbdd0bed4a6945c4b65`。
- [LocalRecordIO$/<cinit>](pcode/cn.storage.LocalRecordIO--LocalRecordIO___cinit_.pcode.txt)；body `1`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [LocalRecordIO/<ctor>](pcode/cn.storage.LocalRecordIO--LocalRecordIO__ctor_.pcode.txt)；body `2`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.storage.LocalRecordIO--anonymous-method-0.pcode.txt)；body `3`；code SHA-256 `154e49820801a489ebb2388ddc5ccde375319ed31d03924bd1b21cc90e4181e1`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build.py](source/build.py) ← `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\build.py`；11,874 B；SHA-256 `a664189cca03f8673c1f6cf901c9bdb31f94afa27b8abb41b8831f78687bfde2`。
- [LocalRecordIO.as](source/LocalRecordIO.as) ← `D:\WF\startpoint-cn-kulo\client-patch\local-record-recovery\src\cn\storage\LocalRecordIO.as`；1,585 B；SHA-256 `31f96ee5782928749fcb96bf2b245f1487537b76f72622d2caf978ae234bff86`。
