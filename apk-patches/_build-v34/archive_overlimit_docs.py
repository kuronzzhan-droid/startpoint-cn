"""Chinese reviewable archive text; generated separately from copy/verification."""


def render_entry(item, verified):
    number = item["number"]
    methods = item["methods"]
    lines = [f'# {number} {item["title"]}（{item["id"]}）', "", item["behavior"], "",
             "- 首发 APK 版本：**v34**。适用测试包：`com.leiting.wt`。本轮设备验收未核实。",
             f'- 编号映射：来源 `{item["upstream_number"]}-{item["slug"]}` → 本草稿 `{number}-{item["slug"]}`。',
             f'- 依赖归档：{", ".join("#" + str(x) for x in item["dependencies"]) or "无硬依赖"}。',
             "- 与 R4 的 47 个目标方法、5 个合成方法及原 101 条的 611 个归档方法均无交集，无须合成；R4 目标中没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。",
             "- O8/O9/O10/O11/O12 五个目标方法互不重叠。PartyCarousel.update 不在这些补丁目标中。",
             "- 外来源只读；source 与 before/after P-code 均逐字节复制。每个原始文件路径和 SHA-256 记录在 entry.json。",
             f'- 行为边界：{item["caveat"]}', ""]
    if item.get("revision") == "r2":
        lines += ["## 修订 r2（r1 已废弃）", "", item["revision_note"], "",
                  "本条 after P-code 与共享 source 已替换为 r2；旧 r1 指纹只用于识别已废弃版本。重建必须从精确 v33＋R4 基线应用新版，不能把 r2 脚本直接覆盖到 r1 SWF 上。", ""]
    else:
        lines += ["本条共享来源更新为 r2；O8 方法逻辑、before/after 指纹均未变化。", ""]
    lines += ["## 方法体锁与 P-code", ""]
    for target in methods:
        pcode = f'boot_ffc6--{target["label"].replace("/", "_")}'
        lines += [f'### {target["id"]}：`{target["label"]}`', "",
                  f'主 ABC `boot_ffc6`；body `{target["body"]}`。',
                  f'输入 code SHA-256：`{target["before"]}`；header `{target["before_header"]}`。',
                  f'打后 code SHA-256：`{target["after"]}`；header `{target["after_header"]}`。',
                  f'[before P-code](pcode/{pcode}.before.pcode.txt) / [after P-code](pcode/{pcode}.pcode.txt)。']
        if target.get("superseded_r1_after_sha256"):
            lines += [f'已废弃 r1 的 after code SHA-256：`{target["superseded_r1_after_sha256"]}`，不再作为可交付结果。']
        lines += [""]
    selection = " ".join(m["id"] for m in methods)
    lines += ["## 重放与验证边界", "",
              f'单条源码入口：`python -B source/apply.py IN.swf OUT.swf {selection}`。共享工具只读依赖仍是 `D:\\WF\\perf-v30-20261015\\tools`；须设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONDONTWRITEBYTECODE=1`。',
              "来源 v34_patches.py 是五个补丁共用的完整定义，四个归档的源码副本一致；单条回放必须显式选择上面的补丁 ID。",
              "本任务重建优先使用根入口 `python -B scripts/build_v34.py`，经 scripts/overlimit_runner.py 加载本目录 incoming 下已锁定的来源副本与共享依赖，避免来源 apply.py 的外部路径假设。来源原文脚本仍逐字节保存，归档自身不是免依赖包。",
              "脚本先核对 before/after 方法指纹，已打则跳过，未知方法体拒绝；不做整类反编译回编。",
              "本轮实际产物哈希和静态保留证明见 [build-report.json](../../build-report.json)。最终方法实测：" + ("已核对实际最终 SWF。" if verified else "等待根构建后核对。"),
              "[来源 README 原文](provenance/upstream-README.md) 保留来源线程的历史自测/真机陈述，不代表本轮验证。本轮仅离线，没有运行模拟器、adb、游戏或服务器；运行表现未核实。", ""]
    return "\n".join(lines)


def render_index(existing):
    text = existing.split("\n## 本轮新增 108 / 109", 1)[0].rstrip()
    text += "\n\n## 本轮新增 108 / 109 / 110 / 111\n\n"
    text += "原 102–107 继续保留，之后按 108→109→110→111 应用；新增后共 52 个唯一既有方法、53 个模块方法条目，helper ABC 仍是 5 个。\n\n"
    text += "当前 109–111 为 **revision r2，r1 已废弃**，首发版本仍为 v34：O9–O12 的生效条件均为五星、overLimitStep ≥4 且 get_maxOverLimitStep()>4。最大突破次数为4的普通五星保留原按钮、列表与文案；仅真正可超限角色触发新增逻辑。108/O8 的方法体不变，仅刷新共享 r2 来源。\n\n"
    text += "- [108：持有角色超限台座（O8）](108-overlimit-owned-pedestal/README.md)，来源原编号 102，首发 v34。\n"
    text += "- [109：缺悖论之核禁止确认超限（O9）](109-overlimit-paradox-core-gate/README.md)，来源原编号 103，首发 v34。\n"
    text += "- [110：超限窗口两个消耗框（O10/O11）](110-overlimit-two-cost-slots/README.md)，来源原编号 104，首发 v34。\n"
    text += "- [111：超限确认框文案包含悖论之核（O12）](111-overlimit-dialog-paradox-text/README.md)，来源原编号 105，首发 v34。\n\n"
    text += "五个目标只改 boot_ffc6 的 body 87354 / 73067 / 73055 / 73065 / 33543，不碰 PartyCarousel.update；与旧 101 条的 611 个归档方法、R4 47 目标及 5 合成方法均无交集。R4 目标没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。来源 README 原文、原始路径、文件哈希及精确副本在各条 provenance/source/pcode 与 entry.json。四个条目的 source/v34_patches.py 均为同一份最新共享定义；只应用单条时必须选择补丁 ID。\n\n"
    text += "作者已取消零消耗方案，109/O9 与旧归档 101 保留；`--without-O9` 只保留为历史诊断开关，不再是候选，也不是完整零核版本。凉月觉醒入口属于数据边，本轮没有 APK 补丁。\n\n"
    text += "本轮新增验证只声明离线结果。来源线程的真机自测不是本轮重跑，当前设备运行未核实。\n"
    return text
