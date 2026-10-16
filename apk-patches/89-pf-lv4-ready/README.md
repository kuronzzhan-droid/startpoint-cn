# 89 PF Lv4 充能状态与提示

按 Lv3 阈值至 100 连击记录八档渐变状态，Lv4 就绪播一次预载提示音并每 60 帧重放红色官方 twinkle。

- 首发 APK 版本：**v32**。
- v33 使用的最终修订：v32f。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleFlipperImpl/update`。
- 修的问题或错误码：最终修订使用预载 SE，修复最初 v32 懒加载通路 ClientError 8022；并撤掉旧周期 HitEffect 的噪声/观感问题。
- 依赖：P1
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:161-292`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json:58-63`
- `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:40-56`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleFlipperImpl/update](pcode/boot_ffc6--BattleFlipperImpl_update.pcode.txt)；body `58371`；code SHA-256 `850b7356ba86f981b98d73d4d3619484acf2e7b2b0ff9f4ee8814113b7e9b8f0`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [pflv4_patches.py](source/pflv4_patches.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py`；24,815 B；SHA-256 `623cbe32a7cb7b950b12fd4ef03a3e50c0c4354ba195d4c7e3890746fdfb64e1`。
- [build_pflv4_apk.py](source/build_pflv4_apk.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\build_pflv4_apk.py`；5,761 B；SHA-256 `6c39dfc5c0bc61e2860dbd05fba30fd839348de61fc3cf2ff0f931f26eb0b929`。
