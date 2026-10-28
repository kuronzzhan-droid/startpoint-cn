"""从最终验收及分析证据生成中文交付说明；只写 run21。"""
import json
import bootstrap
from bootstrap import ROOT, INPUTS, sha


def main():
    report = json.loads((ROOT/'verify-report.json').read_text(encoding='utf-8'))
    framework = json.loads((ROOT/'framework-report.json').read_text(encoding='utf-8'))
    audit = json.loads((ROOT/'enemy21-audit.json').read_text(encoding='utf-8'))
    analysis = (ROOT/'analysis'/'report.md').read_text(encoding='utf-8')
    rows = []
    for profile, (_, source_sha, name) in INPUTS.items():
        path = ROOT/name
        assert sha(path.read_bytes()) == report['profiles'][profile]['sha256']
        rows.append(f'| {profile} | `{source_sha}` | `{sha(path.read_bytes())}` | {path.stat().st_size:,} |')
    window = json.loads((ROOT/'early_window-test.json').read_text(encoding='utf-8'))['details']
    methods = framework['profiles']['test']
    detail_fields = audit['detailFields']
    text = analysis + '\n\n## 7. v35t 实现与读取格式\n\n'
    text += ('输入严格锁定 run20 的 v35s / v35s-local-wf。两版使用同一补丁源；'
             'build 为 `v35t`，schema 保持 `coop-state-fingerprint-compact-v2`。\n\n'
             '- `/enemies.count/hash/entries` 保留 v35s 原定义；新增 `details`、`detailsHash`、`detailStatus`。'
             'count≤32 输出每只敌人完整记录，details 按复制出的 JSON 字符串排序；不排序或修改源容器。'
             'count>32 保留旧摘要，明确标记详情未覆盖，禁止把它当成全量敌人明细。\n'
             '- `details` 每项是 JSON 数组字符串；先 JSON.parse，再按下表解读。'
             '浮点读已有槽并转 IEEE754 `f64:`，避免位置或大HP被十进制舍入掩盖。'
             '条件包括可见、invisible、reserved；有独立完整 trialProgress。\n'
             '- 新增 `/rng/conditionChange`、`/rng/coffin`；未知 RNG 类型仍仅在 unsupported 报告，'
             '不伪造数值。命名清控事件计数只读取已有事件，字段具体结构以 `enemy21-audit.json` 和字段专项报告为准。\n'
             '- 0≤postFrame≤1200 固定30；耗时及预算压力都不能升档。1200后恢复v35s的30/60/120/240绝对网格、'
             '240保底、状态变化额外采样与自适应。强制采样会入队，发送仍受全客户端共享限额约束。\n\n')
    text += '| 下标 | 字段 |\n|---|---|\n' + '\n'.join(f'| {i} | `{name}` |' for i,name in enumerate(detail_fields))
    text += ('\n\n计数器顺序：`' + '`, `'.join(audit['counterFields']) + '`。'
             '条件字段顺序、所有原始槽的ABC归属及枚举签名见 `enemy21-audit.json`；'
             '无法安全复制的类型明确进入 unsupported，不调用游戏随机函数、getter或懒创建函数。\n\n')
    text += '## 8. 最终产物身份与验收\n\n| 版本 | 输入 SHA256 | 输出 SHA256 | 大小 B |\n|---|---|---|---|\n' + '\n'.join(rows)
    text += (f'\n\n`verify-report.json` 状态为 **{report["status"]}**，绑定双SWF、各专项报告和全部测试/构建源SHA。'
             f'只拼接 {len(methods["changed_methods"])} 个既有诊断方法，尾增 {len(methods["added_methods"])} 个静态诊断助手；'
             f'原有 {methods["whole_swf_unchanged_body_records"]:,} 个方法记录完全不变。'
             '未增类或实例槽。输入整包锁、目标方法SHA/header双锁、逆插入恢复、尾增恢复、'
             '两版本同源重放和P-code静态检查均通过。\n\n'
             '验收包括：0/4/5/32/33敌人边界；字段变化、完整条件/试炼、未知类型；'
             '前1200帧固定网格和1201后恢复；状态边沿；本机及副本绑定；OFF零读和异常隔离；'
             '游戏状态/RNG不变；共享限流、分片重组、队列生命周期；实际字节码变异变红后恢复基线；'
             'P-a matchTrial 的2240个独立语义夹具。详细结果见各 `*-test.json`、`*-local.json`。\n\n')
    text += ('前1200帧持续压力夹具明确使用合成状态：7敌人、每敌6条件、三Battle，共'
             f'{window["sampled_rows"]}条检查点；滚动1000ms物理上行最大 **{window["max_any_1000ms_bytes"]:,} B**。'
             f'第1200帧时积压 {window["queued_bytes_at_frame1200"]:,} B，最终在离线时钟 '
             f'{window["final_drained_at_ms"]:,} ms 排空；所有采样完整重组且无gap。'
             '逐秒字节数及指令数见 `early_window-*.json`；三个资产容量场景与v35s对照见 `flow-*.json`。'
             '这证明发送限额与固定采样兼容，但采样时间不等于到服时间；不能把排队延迟说成丢失。\n\n')
    text += ('## 9. 复现及边界\n\n在 run21 内执行：\n\n```powershell\n'
             'python -B build.py --candidate --replace-work\npython -B verify.py --candidate\n'
             'python -B build.py\npython -B verify.py\npython -B write_readme21.py\n```\n\n'
             '正式输出存在且内容不同会拒绝覆盖；候选覆盖只限 run21/work。所有构建/测试支持均在run21内，'
             '使用 `-B` 禁止向只读源目录写pycache；原run20全目录文件SHA保持。当前目录不是Git仓库，不初始化仓库。'
             'P-code前后及diff在 `pcode/`，独立复审在 `review21.md`，追加字段合同说明在 `contract-delta.md`。\n\n'
             '本轮只写run21；未联网、未访问服务器/模拟器/adb、未签名或安装APK、未改数据链。'
             '验收为实际AVM2方法字节码的有限离线执行，JSON/时钟/socket/物理与输入回调是明示外围夹具。'
             'AIR/JIT/GC、手机实际耗时、三机联机、设备资产一致性及根因均**未核实**。'
             '4MiB有界队列及显式overflow gap继承v35s；持续无界条件/事件量不承诺无限无损缓存。\n')
    bootstrap.output_path(ROOT/'README.md').write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
