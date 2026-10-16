# 本次只读核验

这些 JSON 是 2026-10-16 本次调查的文本记录：实际 APK 文件哈希、内存解析的逐方法哈希、v17/v33继承关系、bundle成员和x86变体成员比较。未输出整份APK/SWF/ABC、PNG、.so、签名或准入密钥。原报告中的设备结果仅作历史来源；本次没有重新运行设备。

- `v33_actual.json`：两包哈希及perf2/coop目标方法。
- `x86_actual_check.json`：13个ANE XML变化、15库及E3缓存一致性。
- `v32_actual_check.json`：最终PF/Fever/语音/超限方法与bundle实证；已采用O5双道具限制正式收录为101，零核后续调整尚未构建。
- `early_actual_checks.json`：早期主方法、helper、最终语义指令。
- `early_r8_boss.json`：R8算法与Boss精确hook/owner范围及源码缺失。
- `startup_cache_dex_check.json`：相同DEX和包名守卫线索。
