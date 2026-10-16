# 79 五星 101–120 内置经验表

给 character_level_iosbundled 五星行追加 101–120 级，每级累计经验增加 15000，120 级 679988。

- 首发 APK 版本：**v31**。
- v33 使用的最终修订：v31。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`assets/bundle.zip / master/character/character_level_iosbundled.orderedmap`。
- 修的问题或错误码：无明确错误码；为超限功能的客户端规则支持。
- 依赖：bundle-level-cap
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py:70-83`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。


## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_overlimit_apk.py](source/build_overlimit_apk.py) ← `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py`；11,436 B；SHA-256 `3896b43ef3aa495cb2cac8bac82fed9403df1ea8fd4efe50af045d7d1fda3a13`。
