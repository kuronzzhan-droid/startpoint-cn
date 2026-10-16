# 73 联机停帧有限宽限

将队友停帧隔离的等级八边界从 240 放宽到 1800，减少仍在心跳的短暂停帧被踢出。

- 首发 APK 版本：**v29-coop**。
- v33 使用的最终修订：v29-coop。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleDerailleur/getDeferralLevel`。
- 修的问题或错误码：停帧队友提前隔离；C15001 的真实服成因未证实，此补丁不应声称修复乱序。
- 依赖：v28 客户端基线；继承五重 R1 的 600 帧宽限
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\coop-fix-20261014\REPORT.md:92-125`
- `D:\WF\coop-fix-20261014\REPORT.md:274-288`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleDerailleur/getDeferralLevel](pcode/boot_ffc6--BattleDerailleur_getDeferralLevel.pcode.txt)；body `62884`；code SHA-256 `84e04501423fa23b0caeb53235652347b2d0d780ce526e1d7793a027951cb570`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_coop_grace.py](source/patch_coop_grace.py) ← `D:\WF\coop-fix-20261014\client\patch_coop_grace.py`；6,649 B；SHA-256 `325d676f3256f9d866236f786ca06ce2ae16ad9ee7101de8c4e7b8ed233fa51f`。
- [build_coop_apk.py](source/build_coop_apk.py) ← `D:\WF\coop-fix-20261014\client\build_coop_apk.py`；6,461 B；SHA-256 `827057057af149d5a053dc0ed74c6cc96f144031ce44a224b54c908480346e8e`。
