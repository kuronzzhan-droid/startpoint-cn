"""最终双份SWF：真实字节码语义、静态有效变异、保持性、CLI及只读来源总验收。"""
import json

import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import json_write, locked_sources
from swfabc import SwfAbc
from tests import clear_tests, socket_tests
from verify_framework import run as verify_framework
from verify_pcode import verify as verify_pcode
from verify_cli import run as verify_cli
import provenance


def audit_hashes():
    return {path.relative_to(ROOT).as_posix(): sha(path.read_bytes())
            for path in sorted((ROOT / "audit").rglob("*"))
            if path.is_file() and path.suffix in (".json", ".md", ".txt")}


def main():
    if not __debug__:
        raise ValueError("禁止 -O；验收断言必须开启")
    bootstrap.check_baseline()
    provenance.verify()
    sources = locked_sources()
    audit_evidence = audit_hashes()
    reports = {}
    for profile, (path, _, output) in INPUTS.items():
        before = SwfAbc(path).abc
        after = SwfAbc(ROOT / output).abc
        initial = {
            "clear": clear_tests.run(before, after),
            "socket": socket_tests.run(before, after),
        }
        mutations = {
            "clear": clear_tests.mutations(before, after),
            "socket": socket_tests.mutations(before, after),
        }
        # 两组变异全部完成后再次解释两组完整基线，不只检查文件恢复。
        final = {
            "clear": clear_tests.run(before, after),
            "socket": socket_tests.run(before, after),
        }
        assert final == initial, "变异后的完整业务基线与初始结果不一致"
        reports[profile] = {
            "status": "pass", "baseline": initial, "mutations": mutations,
            "final_complete_baseline": final, "baseline_after_all_mutations": "pass",
            "input_sha256": sha(path.read_bytes()), "output_sha256": sha((ROOT / output).read_bytes()),
        }
        json_write(ROOT / f"business-{profile}.json", reports[profile])
        print(json.dumps({"profile": profile, "business": "pass"}), flush=True)
    structure = verify_framework()
    pcode = verify_pcode()
    cli = verify_cli()
    readonly = provenance.verify()
    assert locked_sources() == sources, "验收期间源码变化，必须重验"
    assert audit_hashes() == audit_evidence, "验收期间原生审计证据变化"
    result = {
        "status": "pass", "task": "TASK13",
        "outputs": {name: {"file": value[2], "sha256": sha((ROOT / value[2]).read_bytes())}
                    for name, value in INPUTS.items()},
        "business": reports, "framework": "framework-report.json",
        "structural_summary": {
            name: {key: structure["profiles"][name][key] for key in (
                "whole_swf_original_body_count", "whole_swf_unchanged_body_records",
                "replay_byte_identical")}
            for name in INPUTS},
        "pcode_evidence": pcode, "cli": cli,
        "audit_evidence": audit_evidence, "source_locks": sources,
        "readonly": readonly,
        "readonly_evidence_sha256": sha((ROOT / "input-provenance.json").read_bytes()),
        "requirements": {
            "no_finalized_native_behavior_preserved": "pass",
            "playing_finalized_native_victory_current_statistics": "pass",
            "non_playing_unchanged": "pass",
            "earlier_floor_zone_and_bothboss_unchanged": "pass",
            "duplicate_finalized_once_per_battle_object": "pass",
            "confirmed_clear_no_mate_or_900_frame_wait": "pass",
            "closed_socket_no_followup_disconnect_popup": "pass",
            "semantic_mutations_detected_and_complete_baseline_restored": "pass",
        },
        "inherited_limitations": "run12持有者来源待确认口径保持；本轮不重新裁定旧需求",
        "final_clean_baseline": "pass",
        "verification_boundary": (
            "解释两份最终SWF真实AVM2方法；外围对象、计算器、socket事件、渲染和HTTP用显式夹具。"
            "完整AIR、Android真机、画面、真实联机、弱键GC时机和服务端配套上线均未核实。"),
    }
    json_write(ROOT / "verify-report.json", result)
    print(json.dumps({"status": "pass", "outputs": result["outputs"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
