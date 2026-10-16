# 16 可用能力描述缓存

在一次可用能力筛选中，按上一项能力对象的身份复用 getDescription(false) 结果，减少遍历同一能力多条触发条件时的重复描述计算。

- 首发 APK 版本：**v17以前；原性能阶段称 R8，具体发布APK编号未核实**。
- v33 使用的最终修订：R8 算法经 R10 去诊断后，由 v17 原样继承到 v33。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleCharacterLogic/getAvailableAbilities`。
- 修的问题或错误码：同一能力的多条触发条件反复生成同一文案，造成重复计算。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

原始R8改写脚本未找到；现存build.py只去掉诊断，不生成优化算法。正式补丁源可从最终v33按精确label提取单方法P-code；不可收LoadingTrace诊断。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\loading-diagnostic\patch_swf.py:86-88`
- `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py:85-101`
- `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\README.md:10-12`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleCharacterLogic/getAvailableAbilities](pcode/boot_ffc6--BattleCharacterLogic_getAvailableAbilities.pcode.txt)；body `92420`；code SHA-256 `9a0fcbbeae31de6293028b437a0716e2d959524544370cf2f7bfa58aef59fd9f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build.py](source/build.py) ← `D:\WF\startpoint-cn-kulo\client-patch\r10-public-release\build.py`；19,523 B；SHA-256 `bcf73b6196bc4e5b5c4fd0aee61a0848213fc83ef5f46786ea1219d6b2aabc84`。
