# 43 个人资料关注按钮可见性修复

按原四态关系直接设置关注和取消关注按钮，避免父层切帧后状态残留

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`PlayerProfileView/refreshFollowRelationButtons`；`OtherProfileLogic/applyButton`。
- 修的问题或错误码：关注关系状态正确但具体按钮可见性残留
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:14-18,83-95`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [PlayerProfileView/refreshFollowRelationButtons](pcode/boot_ffc6--PlayerProfileView_refreshFollowRelationButtons.pcode.txt)；body `78965`；code SHA-256 `31bd383995f6ff26867e53ca9d51fd3d55da1fb4eb86936e6d56a6387aa80af6`。
- [OtherProfileLogic/applyButton](pcode/boot_ffc6--OtherProfileLogic_applyButton.pcode.txt)；body `79102`；code SHA-256 `d5bb4ff4652ef7484c3d2f697e2c1fde41e6bef54ee664960acfe8741c7c825c`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_profile_follow_lan_rootfix_apk.py](source/build_profile_follow_lan_rootfix_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_profile_follow_lan_rootfix_apk.py`；14,375 B；SHA-256 `060c52da13e04a946938a35ff93568e95114e750fe68bb7f076899ef56ca65d7`。
