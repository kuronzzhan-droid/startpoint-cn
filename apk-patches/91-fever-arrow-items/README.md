# 91 Fever 箭头换随机道具

队长有数据标记时保持 Fever 箭头关闭，并按联机一致种子在箭头位置生成随机官方 Fever 道具。

- 首发 APK 版本：**v32g**。
- v33 使用的最终修订：v32l（B2 未变，B3/B5 最后改于 v32k）。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`YakumonoManagerImpl/activate`。
- 修的问题或错误码：8013（主表未加载）、8601（空标记槽缺键）、14502（rotationPanelAnimation=None）、联机副本分歧；最终 v32l 使用 Some(backgroundAnimation)。
- 依赖：B2；B3；B5；unique_condition 数据行和队长标记
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:331-410`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:28-33`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [YakumonoManagerImpl/activate](pcode/boot_ffc6--YakumonoManagerImpl_activate.pcode.txt)；body `61871`；code SHA-256 `fd64527e90a488f108d36e1efc3b4164cecc10c2b0d575eade511a92d4def037`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [feveritems_patches.py](source/feveritems_patches.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py`；37,593 B；SHA-256 `b37963c756354dededdb937a15275aa693c0424c3ad45582efa39c719b46adee`。
- [build_feveritems_apk.py](source/build_feveritems_apk.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py`；6,287 B；SHA-256 `afa802f15b929f3885cd5023b9045790647a1f2b7aa23a55887c0014f7afb291`。
