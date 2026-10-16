# 21 ModDualForm特殊动画切换

持有ModDualForm标签的角色按Unique22切换special动画并预加载

- 首发 APK 版本：**v17以前；具体编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberView/draw`；`BattleCharacterLogic/resolvePathCollection`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch-manifest-pure-pcode.json:8-29`
- `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch_pcode.py:239-330`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberView/draw](pcode/boot_ffc6--MemberView_draw.pcode.txt)；body `60616`；code SHA-256 `f32bfe1956a9d8b906987ad12d8b349c908f5cbf7b4ac8f76a8a7ae9b7b1bc8e`。
- [BattleCharacterLogic/resolvePathCollection](pcode/boot_ffc6--BattleCharacterLogic_resolvePathCollection.pcode.txt)；body `92329`；code SHA-256 `4be465684a1346a539ccdcc65221ea64a875fdc0e3ebcd93bb16d47b185b7e93`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_pcode.py](source/patch_pcode.py) ← `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch_pcode.py`；71,950 B；SHA-256 `fe02e42b9b0bc525bfc5fefccf1e4422c46d2130722902652de3b80c5008b045`。
- [pcode_tools.py](source/pcode_tools.py) ← `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\pcode_tools.py`；4,977 B；SHA-256 `e44386619d1899f960091218e86e765e5ebfbcc90c3f6c78bfaf77c08d452540`。
- [patch-manifest-pure-pcode.json](source/patch-manifest-pure-pcode.json) ← `D:\WF\out\q1056\rv4p\client-patch\dual-form-v1\patch-manifest-pure-pcode.json`；1,059 B；SHA-256 `af95a983f2292f7696737c22dfa001a855183649fd95bf0aa6f8bb3dcd2933a0`。
