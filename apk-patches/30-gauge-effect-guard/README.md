# 30 无效回槽演出提前拒绝与规则筛选优化

在能力目标演出创建前拒绝已被 423 禁止的正向回槽，并先筛来源位，减少月兔队连续触发时的无效特效和状态查询。

- 首发 APK 版本：**未核实（v17 已含；源候选日期 2026-09-25，资源版本 1.4.1044 不是 APK 版本）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/applyInstantAbility、MemberAbilityTotalizerImpl/wfBlocksGauge`。
- 修的问题或错误码：原版回槽先创建 AbilityPerpetuity 再拒绝入账；大量连击持续积累无效特效，作者报告连续掉帧。
- 依赖：gauge-gain-rules 的 423、wfAllowsGauge 和来源上下文
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\README.md:45-53；问题原因及两方法性能补丁`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py:19-40；仅正向、恢复上下文`
- `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_perf_overlay.py:13-59；两方法限定和原指令可还原检查`
- `D:\WF\out\月兔回槽性能与狮子PF点火-20260925\增量包\改动说明.md:5-14；原始问题与未做原队伍实测的边界`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/applyInstantAbility](pcode/boot_ffc6--MemberImpl_applyInstantAbility.pcode.txt)；body `60552`；code SHA-256 `6088e8e59832bca7c260e5f82339395fe1d1fce47c92aa7fa2f0591549052817`。
- [MemberAbilityTotalizerImpl/wfBlocksGauge](pcode/boot_ffc6--MemberAbilityTotalizerImpl_wfBlocksGauge.pcode.txt)；body `92443`；code SHA-256 `c00c039ed5450963581587afefb79a4e0e8185bba082a0f95677263e9a510e37`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [gauge_effect_guard.py](source/gauge_effect_guard.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_effect_guard.py`；2,220 B；SHA-256 `cc04de50dadc741906f44d3d08d3d34d80c703092205970d205994fef1b4f3d7`。
- [gauge_perf_overlay.py](source/gauge_perf_overlay.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge_perf_overlay.py`；3,598 B；SHA-256 `b81e5e8f3cbf796b053e66e024454c44227ba17fa6ea8fc42a0c1c96ada54f2a`。
- [gauge.py](source/gauge.py) ← `D:\WF\out\q1056\rv4p\client-patch\battle-rules\gauge.py`；4,614 B；SHA-256 `b0eb2ab4904858e94d438fe9a8927c9fbee6d1aa68fea3b89ccc2c49bb1dc4f2`。
- [build-apk.py](source/build-apk.py) ← `D:\WF\out\月兔回槽性能与狮子PF点火-20260925\build-apk.py`；1,983 B；SHA-256 `dabe7608c6afc1676bbe49344573743f2928530a61eb911092eb393954a705d5`。
