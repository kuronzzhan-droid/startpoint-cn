"""Create text-only v34 archive-entry drafts 102-107.

Final P-code is supplied by a separate actual-SWF exporter. This script never
creates P-code, compiles classes, packages APKs, or invokes signing tools.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "r4-src/client-patch"
OUT = ROOT / "apk-patches-additions"
APK_SHA = "3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532"
SWF_SHA = "3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4"
UPSTREAM = "224aa2a663b7756fc8a34c0f37f1ae61ad81800c"
MODULES = [
    (102, "liveness", "party-animation-liveness", "编队动画等待存活性修复",
     "保留原 #18 的当前队伍更新与按需初始化；仅在原 join/remove waiter 等待期间，额外推进已初始化、非当前且仍有入退场动画的容器。每个容器每帧最多推进一次，不初始化隐藏容器；原完成条件与回调保持。",
     [], "合成 PartyCarousel/update（原 #18）；其 v33 代码指纹本就与上游补丁的单方法锁一致，使用上游可逆插入，不以整方法回退覆盖 #18。"),
    (103, "refresh", "party-refresh-performance", "编队刷新重复能力汇总复用",
     "在同次 PartyTranslator.translate 内，满血、普通阈值且输入等价时复用第一次能力汇总；其他分支仍执行原计算。没有跨次缓存。",
     [], "本条与 #105 共用 PartyTranslator/translate。归档最终 P-code 显示两条顺序合成后的方法，不能把本条最终方法再整方法覆盖 #105。"),
    (104, "network", "client-network-optimization", "独立管理网络请求的超时预算",
     "每次初始请求获得独立预算，重试共享该请求的已耗时截止；耗尽时进入原 timeout 路径。以单次 AIR Timer 替代按 60 FPS 计数的 HTTP 等待；完成与错误移除时取消 Timer。",
     ["cn/optimize/network/RequestTimer", "cn/optimize/network/NetworkBudget"],
     "4 个目标方法均直接通过 v33 方法锁；源模块历史提交为 66aac625，归档源码以本次 origin/main 导出为准。"),
    (105, "data", "client-data-optimization", "编队与角色数据运算及徽标延迟求值",
     "加入局部排序索引、技能槽 getter 精简、编队详情 revision/静默刷新、重复排序快照和单次 translate 节点 scope 复用；角色任务徽标 case 0 延迟到原 Lazy 首次求值，其他徽标分支保留。",
     ["cn.optimize.data.DataOptimization"],
     "合成 CharacterTable/applyCharacters（原 #63）：保留 v33 局部可见集合与正常线性重排，仅在原长度异常的排序回退分支采用 R4 ranks/rankComparator；原比较器字节可逆保留。PartyTranslator/translate 先承载 #103，再加入作用域清理。"),
    (106, "resource", "client-resource-optimization", "资源 IO 批任务与完成阶段优化",
     "约束异步打开与批任务在途数，修复重入、取消和重复完成生命周期；将 decode/deliver/上传/恢复纳入需求调度及所有者失效，保留原生同步调用不可抢占的边界。",
     ["cn.optimize.resources.ResourceRuntime"],
     "23 个主 ABC 方法：11 个指定单方法 body 移植、12 个可逆 hook。donor 中的同名游戏类仅为方法编译依赖，绝不以 donor 类定义替换游戏类；游戏签名、traits 与类布局保留。"),
    (107, "ui", "client-ui-optimization", "客户端 UI 差量更新与动画池修复",
     "同路径动画池保留有剩余对象的桶，dispose 清理索引；列表复用可比较且未改变的 view，patch/dispose 失效快照；稳定隐藏 cell 与页面省帧，待完成动画及可见边缘继续推进。",
     ["cn.optimize.ui.UiOptimization"],
     "合成 CharacterTable/updateCells（原 #62）：先同步 z/alpha，再由 R4 shouldUpdateCell 决定执行原 update 或继续循环；旧远屏 guard 字节保留但不再截断完成敏感状态。合成 CharacterTableView/present 与 applyPatch（原 #67）：加入 R4 增量呈现/失效 hook，同时保留 v33 无效日志参数求值跳过。原 #60 每帧三格 draw 上限不变。"),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def confined(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"output escapes workspace: {path}")
    return path


def source_files(folder):
    names = {"patch_swf.py", "build_assets.py", "run_air_harness.py", "run_air_tests.py"}
    for path in sorted((PATCH / folder).rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".py", ".as", ".json", ".xml"}:
            continue
        relative = path.relative_to(PATCH / folder)
        if path.name in names or relative.parts[0] in {"src", "donor", "tests"} or path.suffix == ".json":
            yield path


def copy_source(path, target, origin):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, confined(target))
    data = target.read_bytes()
    return {"path": target.relative_to(OUT).as_posix(), "origin": origin,
            "bytes": len(data), "sha256": sha(data)}


def load_pcode(path):
    if not path:
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("methods", data.get("entries", []))
    assert isinstance(data, list), "P-code manifest must be a list or contain methods/entries"
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pcode-manifest", type=Path)
    parser.add_argument("--final-swf", type=Path, default=ROOT / "v34.swf")
    parser.add_argument("--build-report", type=Path, default=ROOT / "build-report.json")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    targets = json.loads((ROOT / "audits/overlap-audit.json").read_text(encoding="utf-8"))["targets"]
    pcode = load_pcode(args.pcode_manifest)
    final_sha = sha(args.final_swf.read_bytes()) if args.final_swf.is_file() else None
    all_entries = []
    for number, module, folder, title, behavior, helpers, composition in MODULES:
        entry = OUT / f"{number}-{folder}"
        entry.mkdir(exist_ok=True)
        methods = [x for x in targets if x["module"] == module]
        sources = []
        for path in source_files(folder):
            relative = path.relative_to(PATCH)
            sources.append(copy_source(path, entry / "source/client-patch" / relative,
                f"D:\\WF\\startpoint-cn-kulo@{UPSTREAM}:client-patch/{relative.as_posix()}"))
        if module in {"data", "ui"}:
            path = ROOT / "scripts/compose_conflicts.py"
            sources.append(copy_source(path, entry / "source/task-adapters/compose_conflicts.py", str(path)))
        selected = []
        labels = {row["method"] for row in methods}
        bodies = {row["body"] for row in methods}
        for item in pcode:
            abc = item.get("abc", item.get("abc_name"))
            label = item.get("method", item.get("label"))
            if (abc == "boot_ffc6" and (label in labels or item.get("body") in bodies)) or abc in helpers:
                path = Path(item["path"])
                if not path.is_absolute():
                    path = args.pcode_manifest.parent / path
                assert path.suffix == ".txt" and path.is_file(), str(path)
                destination = entry / "pcode" / path.name
                copied = copy_source(path, destination, str(path))
                selected.append(dict(item, path=destination.relative_to(entry).as_posix(),
                                     text_sha256=copied["sha256"]))
        record = {"number": number, "module": module, "title": title, "status": "归档条目草稿",
                  "upstream_origin_main": UPSTREAM, "input_apk_sha256": APK_SHA,
                  "input_swf_sha256": SWF_SHA, "final_swf_sha256": final_sha,
                  "methods": methods, "helpers": helpers, "composition": composition,
                  "source_files": sources, "final_pcode": selected,
                  "verification_report": "../../build-report.json",
                  "pcode_export_status": "已复制实际 SWF 最终导出" if selected else "等待最终实际 SWF 导出"}
        write_json(entry / "entry.json", record)
        lines = [f"# {number} {title}", "", behavior, "",
                 "- 首发 APK 版本：**v34 测试服候选；设备验收未核实**。",
                 "- 最终采用修订：本次 v33 + R4 离线组合；这是待并入原归档的新增条目草稿。",
                 "- 适用包：`com.leiting.wt`，包名、AIR 身份、服务端地址和准入沿用 v33。",
                 f"- 改动位置：{len(methods)} 个既有目标方法；见下方方法清单。",
                 "- 修的问题或错误码：本条行为见上文；未新增错误码。",
                 "- 依赖：精确 v33 输入、前序 R4 组合阶段和原 ABC/SWF 支持工具；不是可对任意 SWF 单独覆盖的补丁。",
                 "- 是否只能以二进制形式发：否；仅收文本源码、逐方法 P-code 与清单，不收 APK/SWF/ABC/SWC/native 二进制或签名材料。", "",
                 "## 最终采用证据", "",
                 f"输入 APK SHA-256：`{APK_SHA}`；输入 SWF SHA-256：`{SWF_SHA}`。",
                 f"上游来源：`D:\\WF\\startpoint-cn-kulo` 的 `origin/main` 提交 `{UPSTREAM}` 下 `client-patch/{folder}/`，先用 git show 导出到本工作区再使用。",
                 f"最终 v34 SWF SHA-256：`{final_sha}`。" if final_sha else "最终 v34 SWF 哈希等待根构建报告回填，当前不宣称成品已完成。",
                 "本任务实际验证以 [build-report.json](../../build-report.json) 为准；上游 README 的历史断言数和设备结果不是本次重跑结果。", "",
                 "## 合成与保留逻辑", "", composition, "",
                 "## 最终 P-code", "",
                 "以下条目必须来自最终实际 v34 SWF 的逐方法导出。同一方法承载多条补丁时显示最终组合状态，不能脱离精确输入与生成顺序整方法覆盖。", ""]
        for method in methods:
            match = next((item for item in selected if item.get("abc", item.get("abc_name")) == "boot_ffc6" and item.get("body") == method["body"]), None)
            state = f"[最终 P-code]({match['path']})；code SHA-256 `{match.get('code_sha256', '见 P-code 头')}`" if match else "最终 P-code 待实际 SWF 导出"
            lines.append(f"- `{method['method']}`；body `{method['body']}`；{state}。")
        lines += ["", "新增 helper ABC：" + ("、".join(f"`{name}`" for name in helpers) if helpers else "无") + "。", "",
                  "## 补丁源与构建脚本", "",
                  "源码副本保留原相对目录及原始路径假设；列表不包含 APK 打包或签名脚本。原工具链共享的 startup-cache/build_swf.py、lens0907-0908、swfabc/asm 等仍依赖原归档支持目录；本条并非独立免依赖构建包。适配源码在 source/task-adapters 下。", ""]
        for source in sources:
            local = Path(source["path"]).relative_to(entry.name).as_posix()
            lines.append(f"- [{Path(local).name}]({local}) ← `{source['origin']}`；{source['bytes']:,} B；SHA-256 `{source['sha256']}`。")
        lines += ["", "## 验证与安装边界", "",
                  "单方法 P-code/body 变更、非目标方法逐字节保留、helper 数量与本次 AIR 夹具结果见最终根报告。没有启动 Android 模拟器、adb、安装 APK 或运行游戏；Android 完整运行及性能未核实。AIR SDK 实际使用版本须以根报告记录为准。",
                  "交付 APK 未签名且已 zipalign；由另一线程签名。测试者应清理 AIR cache/app 或卸载重装，避免旧提取 SWF 缓存。R4 StartupCache 原生改动未带，不能依赖它为 wt 包自动清缓存。", ""]
        (entry / "README.md").write_text("\n".join(lines), encoding="utf-8")
        all_entries.append({"number": number, "module": module, "directory": entry.name,
                            "method_count": len(methods), "helper_count": len(helpers),
                            "final_pcode_files": len(selected)})
    write_json(OUT / "manifest.json", {"status": "draft", "entries": all_entries,
        "input_swf_sha256": SWF_SHA, "final_swf_sha256": final_sha,
        "unique_original_methods": len({x["method"] for x in targets}),
        "module_method_occurrences": len(targets), "binary_files_included": False})
    (OUT / "README.md").write_text(
        "# v34 新增补丁归档草稿（102 起）\n\n"
        "本目录供后续并入 D:\\WF\\apkp1016\\apk-patches；未修改原归档。编号 102–107 对应 liveness、refresh、network、data、resource、ui，48 个模块方法条目涉及 47 个唯一原方法，另新增 5 个 helper ABC。\n\n"
        "组合顺序为 102→103→104→105→106→107。#103 与 #105 共用 PartyTranslator.translate；与旧 #18/#62/#63/#67 的 5 个方法采用保留 v33 语义的合成。各条 entry.json 记录方法、输入指纹、来源、源码哈希及最终 P-code 状态。\n\n"
        "本目录只有文本；不含 APK/SWF/ABC/SWC、native 二进制、keystore、签名或 APK 构建脚本。源码仍保留原路径依赖，复现应使用任务根脚本和完整共享工具链。\n\n"
        "最终哈希与验证见 ../build-report.json；上游历史测试数不得当作本次验证。未做 Android 设备验收。\n", encoding="utf-8")
    forbidden = {".apk", ".swf", ".abc", ".swc", ".dex", ".so", ".jar", ".p12", ".jks", ".keystore"}
    assert not [p for p in OUT.rglob("*") if p.is_file() and p.suffix.lower() in forbidden]
    print(json.dumps(all_entries, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
