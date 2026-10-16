# 28 五重随机地图与联机房号种子

为五重地图候选加入条件行与随机选择，并以联机房号生成确定性种子，使同房客户端选择一致地图。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BothBossTool 的 3 个地图入口与 6 个新增辅助方法`。
- 修的问题或错误码：自定义五重地图需要随机候选，并避免联机各端独立随机导致地图不一致；普通 BothBoss 分支保留。
- 依赖：五重地图配置
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

最早 APK 编号未核实；历史 donor SWF 不按本任务规则收录，最终 P-code 可从 v33 获取。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:39-43；三地图方法与六helper、房号种子和普通分支`
- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json:319-373；三 replace_methods 与六 new_methods 精确类方法`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BothBossTool$/mapBoss](pcode/boot_ffc6--BothBossTool__mapBoss.pcode.txt)；body `50988`；code SHA-256 `4f7be710e2c1d4a1e57a818f9176d4e7bfeecd0a4c9ebf4d7db1dfde6755d8cb`。
- [BothBossTool$/bothBossMap](pcode/boot_ffc6--BothBossTool__bothBossMap.pcode.txt)；body `50998`；code SHA-256 `85ae58d54e427ea926fd838dc3cacf8d2c316a858fac8c96d6d51321f8597f4e`。
- [BothBossTool$/bothBossMapSingle](pcode/boot_ffc6--BothBossTool__bothBossMapSingle.pcode.txt)；body `50999`；code SHA-256 `b7affd6ee25203b61f8137a1f3d082b98f9a707d8a09a57c673cc87d0644e60c`。
- [BothBossTool$/isRandomMapQuest](pcode/boot_ffc6--BothBossTool__isRandomMapQuest.pcode.txt)；body `92434`；code SHA-256 `e84bc0b0fe0b4b3e90dba190809ba2a78af89a981e68babba8aec7a696bfa7eb`。
- [BothBossTool$/isConditionalRow](pcode/boot_ffc6--BothBossTool__isConditionalRow.pcode.txt)；body `92435`；code SHA-256 `7db4961886739d9c8695feace54846431831a2bea366d8aefa0a4cfe8de848ec`。
- [BothBossTool$/mapSeed](pcode/boot_ffc6--BothBossTool__mapSeed.pcode.txt)；body `92436`；code SHA-256 `b5942a1f7195ca7d566fc7aa8805814d450a8b45d51b1f736336329b3a93709e`。
- [BothBossTool$/singleMapSeed](pcode/boot_ffc6--BothBossTool__singleMapSeed.pcode.txt)；body `92437`；code SHA-256 `1f51b372b44a7fed9ef03abf84eb8fd950284cf8d7f5a6d98caccaf557395581`。
- [BothBossTool$/randomIndex](pcode/boot_ffc6--BothBossTool__randomIndex.pcode.txt)；body `92438`；code SHA-256 `730d28453db5beaf32c3483afd615930af4fe9b0819483fa9081d32fd70aac89`。
- [BothBossTool$/pickCandidate](pcode/boot_ffc6--BothBossTool__pickCandidate.pcode.txt)；body `92439`；code SHA-256 `2d5831ea25c4c78fb546c04ed0e6c7cfd709b41a4c32b1cfce7890ef92ea37de`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_swf.py](source/build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py`；21,318 B；SHA-256 `fda30d7f435f8d0a9c0ab6a2a09cde1178014d65c25f8eae0b8163151736d4f4`。
- [method-plan.json](source/method-plan.json) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json`；12,882 B；SHA-256 `8e726176d9273f1c85573fe0cdcc0ff4246c6110c7cd7f248daad79a997cbf40`。
