# 90 Fever 结束跳过未开箭头

Fever 结束时跳过被替换且从没开启的箭头收起演出，其他物件照常收起。

- 首发 APK 版本：**v32g**。
- v33 使用的最终修订：v32l（B2 未变，B3/B5 最后改于 v32k）。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`YakumonoManagerImpl/deactivate`。
- 修的问题或错误码：被替换且从未打开的箭头在 Fever 结束时仍播放收起演出。
- 依赖：B1
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py:413-437`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:80-85`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32l-pflv4-feveritems.build-report.json:6-6`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [YakumonoManagerImpl/deactivate](pcode/boot_ffc6--YakumonoManagerImpl_deactivate.pcode.txt)；body `61868`；code SHA-256 `be565848a5c9bccb1030b57a98799a4fde637418f8601d76009fc45aa3422e9b`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [feveritems_patches.py](source/feveritems_patches.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\feveritems_patches.py`；37,593 B；SHA-256 `b37963c756354dededdb937a15275aa693c0424c3ad45582efa39c719b46adee`。
- [build_feveritems_apk.py](source/build_feveritems_apk.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\build_feveritems_apk.py`；6,287 B；SHA-256 `afa802f15b929f3885cd5023b9045790647a1f2b7aa23a55887c0014f7afb291`。
