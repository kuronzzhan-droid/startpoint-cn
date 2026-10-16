# 23 幻想装备缩略图预加载

在全局资源路径收集中加入幻想装备缩略图，保证相关界面读取装备图标前已纳入加载集合。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`GlobalAssetPathCollectionBuilder.leadingLogicLoadedHandler`。
- 修的问题或错误码：幻想装备图标需要进入原生全局资源加载集合；最终方法包含十一条 item/equipment/mod/fantasy/* 路径。
- 依赖：幻想装备图片资源路径
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

Android 原始重建脚本未找到；只收最终 v33 P-code。其他未能从最终方法明确归属的通用图标生命周期改动不据宽泛registry表述另编条目。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:59-61；Android 幻想队伍/装备图标缓存和生命周期修复`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [GlobalAssetPathCollectionBuilder/leadingLogicLoadedHandler](pcode/boot_ffc6--GlobalAssetPathCollectionBuilder_leadingLogicLoadedHandler.pcode.txt)；body `92264`；code SHA-256 `351374e5297daca7743cb3b774a16e032ad205822181785b7d6c254625a812f2`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

