# 56 凯尔队长四段以上直击合并结算

把凯尔队长 N≥4 段直击合为一次总伤结算，同时补齐 N−1 次计数、连击、Fever 与韧性贡献。

- 首发 APK 版本：**v20**。
- v33 使用的最终修订：v25 仅凯尔队长最终修订。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/scheduleDirectAttack 的 merge/tough/fever 块`。
- 修的问题或错误码：大量段数逐段调度带来开销；v20 初版对所有角色 N≥4 生效，v25 最终限制为凯尔队长，其他角色回归原生逐段结算。
- 依赖：与 kyle-direct-multiplier 共用同一方法且同一凯尔队长判据；需由组合构建器一次应用，不能把整份脚本重复运行
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v20.build-report.json:174-175；v20 首次 merge_min_segments=4`
- `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:336-366；最终队长限定、补计数和韧性/Fever恢复`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/scheduleDirectAttack](pcode/boot_ffc6--MemberImpl_scheduleDirectAttack.pcode.txt)；body `60192`；code SHA-256 `223640cd78b631640313859bb39410d270696644f058435cd1258c88c9f30576`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
