# 48 特殊SET编辑标题C8601修复

特殊编队分类仍用于路由，标题按安全分类显示以免非法查表

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`PartyGroupEditSceneView/refreshPartyCategory`。
- 修的问题或错误码：C8601：特殊分类作为原生标题表key时越界
- 依赖：independent-rush-party
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py:19-75`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [PartyGroupEditSceneView/refreshPartyCategory](pcode/boot_ffc6--PartyGroupEditSceneView_refreshPartyCategory.pcode.txt)；body `77565`；code SHA-256 `52fb8029eaaee239942cbfcfdd7fee9b9c51c3b35e3007e77566c36765899a3b`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_set_edit_c8601.py](source/patch_set_edit_c8601.py) ← `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py`；6,287 B；SHA-256 `3e0c7541e1f695c8b86975263167b37bdf80c8389c4bbea8d41567ee2c6dbe12`。
