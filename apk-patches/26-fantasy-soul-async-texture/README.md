# 26 幻想能力魂图标异步纹理加载

先异步加载 ItemThumbnail，再为幻想魂珠更新图标，使用 pendingFantasySoulImagePath 避免直接读取未准备的纹理。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`PartyCarouselAbilitySoulView.present/fantasySoulTextureLoadCompleted、pendingFantasySoulImagePath 字段`。
- 修的问题或错误码：资源未入纹理缓存时同步 getTexture 可触发 C8004，继而 G1002；跨端说明明确这是 Android 既有策略。
- 依赖：ItemThumbnail 异步资源加载；pendingFantasySoulImagePath 与完成回调
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

Android 最初源码脚本未找到；当前只有最终 v33 P-code可收。iOS 具体 ARM64 实现不收进 APK 补丁源。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:59-61；Android 已有队伍/装备图标缓存和生命周期修复`
- `D:\WF\startpoint-cn-kulo\client-patch\ios-fantasy-soul\README.md:1-3；明确移植 Android 已有策略与问题码`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [PartyCarouselAbilitySoulView/present](pcode/boot_ffc6--PartyCarouselAbilitySoulView_present.pcode.txt)；body `92077`；code SHA-256 `7a5338b2abf272abb008d136064ddc8ae56254ed14655e3f0e286c191e08e369`。
- [PartyCarouselAbilitySoulView/fantasySoulTextureLoadCompleted](pcode/boot_ffc6--PartyCarouselAbilitySoulView_fantasySoulTextureLoadCompleted.pcode.txt)；body `92078`；code SHA-256 `3c83174b5f677e48f5438185416ceac9547e69a3a7e3cfe3fc2f83e418526dc1`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

