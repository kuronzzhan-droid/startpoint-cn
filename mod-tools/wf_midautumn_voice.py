# -*- coding: utf-8 -*-
"""中秋批次语音管线：:mod:`wf_seasonal7_voice` 的批次包装壳。

    python mod-tools/wf_midautumn_voice.py refs     --roles mia nicola
    python mod-tools/wf_midautumn_voice.py plan     --roles mia --run take1
    python mod-tools/wf_midautumn_voice.py generate --roles mia --run take1      # 付费
    python mod-tools/wf_midautumn_voice.py process  --roles mia --run take1
    python mod-tools/wf_midautumn_voice.py pack     --roles mia --run take1      # 一步装完

路径全部改指本批：design = ``B/design/<key>.json``、输出 = ``B/voice/…``；
``ROLES`` 由 :mod:`wf_midautumn_specs` 生成。

密钥：从 ``work/character_packs/seasonal7-20260916/.secrets/seed_audio.key`` 读进
进程环境 ``WF_SEED_AUDIO_KEY``，**不打印、不落盘、不进回执**；也不用 ``--key-file``
（那个分支会 subprocess 重新拉起原脚本，本壳的全局改写会全部丢掉，01 报告 §3.3 坑 2）。

另外两个坑（01 报告 §3.3）：
- ``load_refs_index`` / ``build_references`` / ``run_smoke`` 的默认参数在 def 时就绑死了，
  改模块全局不生效 ⇒ 这里直接改它们的 ``__defaults__`` / ``__kwdefaults__``。
- 凯尔、索恩没有官方母本语音 ⇒ ``refs`` 默认跳过它们，design 的 ``references``
  必须写显式 ``{path, sha256}``。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402
import wf_seasonal7_voice as V  # noqa: E402

ROOT = V.ROOT
BATCH = ROOT / MS.BATCH_DIR
KEY_FILE = ROOT / "work" / "character_packs" / "seasonal7-20260916" / ".secrets" / "seed_audio.key"
# 无官方母本语音：凯尔（原创）、索恩（十天众原声随包）——design 里写显式 references。
NO_OFFICIAL_REFS = ("kyle", "thorn")
BATTLE_REF_SLOTS = ("battle/skill_ready", "battle/battle_start_0", "battle/battle_start_1",
                    "battle/win_0", "battle/win_1")
SPEECH = "master/character/character_speech.orderedmap"


def roles() -> dict[str, dict[str, str]]:
    out = {}
    for key in MS.all_keys():
        spec = MS.SPECS[key]
        out[key] = dict(cid=spec.cid_s, code=spec.code,
                        template_id=spec.template_id_s, template_code=spec.template_code)
    return out


def install_paths() -> None:
    """把 wf_seasonal7_voice 的模块级路径全部改指本批（函数体运行时读全局）。"""
    V.PACK = BATCH
    V.DESIGN_DIR = BATCH / "design"
    V.VOICE_DIR = BATCH / "voice"
    V.REFS_DIR = V.VOICE_DIR / "refs"
    V.REFS_INDEX = V.REFS_DIR / "refs.json"
    V.GENERATION_DIR = V.VOICE_DIR / "generation"
    V.SMOKE_DIR = V.VOICE_DIR / "smoke"
    V.KEY_FILE = KEY_FILE
    V.ROLES = roles()
    # 默认参数在 def 时绑死，改全局不生效（01 报告 §3.3 坑 1）。
    V.load_refs_index.__defaults__ = (V.REFS_INDEX,)
    for func, name, value in ((V.build_references, "out_dir", V.REFS_DIR),
                              (V.run_smoke, "out_dir", V.SMOKE_DIR)):
        defaults = dict(func.__kwdefaults__ or {})
        defaults[name] = value
        func.__kwdefaults__ = defaults


def load_key() -> None:
    """密钥只进进程环境；读不到就明确报错（绝不打印内容）。"""
    if os.environ.get(V.KEY_ENV):
        return
    if not KEY_FILE.is_file():
        raise SystemExit(f"credential file missing: {KEY_FILE}")
    key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not key or any(ch.isspace() for ch in key):
        raise SystemExit("credential file is empty or malformed")
    os.environ[V.KEY_ENV] = key


# ---------------------------------------------------------------- 参考音候选

def _official_speech_home_slots(pack, template_code: str, template_id: str) -> list[str]:
    """母本 character_speech 里的 home 语音槽（官方自定义名，如 ``home/otto_mitsukatte``）。"""
    raw = pack.official_read(SPEECH, "common")
    if raw is None:
        return []
    rows = C.core.read_orderedmap_file_from_bytes(raw)
    if template_id not in rows:
        return []
    prefix = f"character/{template_code}/voice/"
    slots = []
    for cells in C.csv_split(rows[template_id]):
        if len(cells) != 5:
            continue
        # c4 官方写法是相对 character/<code>/voice/ 的槽名（``home/nn_lightno``）；
        # 少数行写全路径，两种都认。
        slot = cells[4][len(prefix):] if cells[4].startswith(prefix) else cells[4]
        if slot.startswith("home/"):
            slots.append(slot)
    return slots


def ref_candidates(role: str) -> dict[str, list[tuple[str, str]]]:
    """按母本自动生成 battle/home 候选，并且只留官方归档里真有的那些。"""
    spec = MS.SPECS[role]
    pack = MC.MAPack(spec)
    code, tid = spec.template_code, spec.template_id_s
    home = _official_speech_home_slots(pack, code, tid) or [f"home/home_{i}" for i in range(6)]
    candidates = {"battle": [(code, slot) for slot in BATTLE_REF_SLOTS],
                  "home": [(code, slot) for slot in home]}
    out = {}
    for kind, items in candidates.items():
        keep = [(c, s) for c, s in items
                if pack.official_identity(f"character/{c}/voice/{s}.mp3") is not None]
        if not keep:
            raise SystemExit(f"{role}: no official {kind} reference voice under character/{code}/voice/")
        out[kind] = keep
    return out


def prepare_refs(role_keys: list[str]) -> None:
    """给 ``wf_seasonal7_voice.build_references`` 喂本批的候选表（它按 role 现查这两个全局）。"""
    V.REF_CANDIDATES = {role: ref_candidates(role) for role in role_keys}
    V.REF_NOTES = {role: f"参考音取母本 {MS.SPECS[role].template_code} 的官方原声；仅本机自用。"
                   for role in role_keys}


# ---------------------------------------------------------------- 装包后处理

def finish_pack(role: str, run: str) -> dict[str, Any]:
    """并入 claims、登记 voice 产物、刷新三层镜像（01 报告 §2.4 的三件必做）。"""
    spec = MS.get_spec(role)
    pack = MC.MAPack(spec)
    record = json.loads((V.GENERATION_DIR / run / role / "pack-result.json").read_text(encoding="utf-8"))
    claims = record.get("claims") or []
    merged = C.merge_claims(pack.load_claims(), claims)
    pack.write_evidence(C.CLAIMS_FILE, merged)
    entries = [(a["root"], a["logical_path"]) for a in record.get("assets") or []]
    pack.register_outputs("voice", entries)
    mirrors = pack.sync_character_mirrors()
    return {"claims_merged": len(claims), "voice_assets_registered": len(entries),
            "character_row_c9_16": mirrors["character"][9:17],
            "server_character": mirrors["server_character"]}


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("refs", "plan", "generate", "process", "pack"))
    parser.add_argument("--roles", nargs="*", default=[])
    parser.add_argument("--run", default="take1")
    parser.add_argument("--design", help="单角色时覆盖 design json 路径")
    parser.add_argument("--only", action="append", default=[], help="generate：role:slot，可重复")
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--no-retry", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="pack：不写文件（只跑校验）")
    parser.add_argument("--replace", action="store_true", help="pack：允许覆盖包内已有语音")
    parser.add_argument("--force-refs", action="store_true",
                        help="refs：连无官方母本语音的角色也一起跑（默认跳过 %s）" % (NO_OFFICIAL_REFS,))
    args = parser.parse_args(argv)

    install_paths()
    role_keys = args.roles or MS.all_keys()
    unknown = [r for r in role_keys if r not in MS.SPECS]
    if unknown:
        parser.error(f"unknown roles: {unknown}")

    if args.command == "refs":
        usable = role_keys if args.force_refs else [r for r in role_keys if r not in NO_OFFICIAL_REFS]
        skipped = [r for r in role_keys if r not in usable]
        if not usable:
            print(json.dumps({"skipped_no_official_reference": skipped,
                              "reason": "design 里写显式 references {path, sha256}"},
                             ensure_ascii=False))
            return 0
        prepare_refs(usable)
        rc = V.main(["refs", "--roles", *usable])
        if skipped:
            print(json.dumps({"skipped_no_official_reference": skipped}, ensure_ascii=False))
        return rc

    if args.command in ("plan", "process"):
        extra = ["--design", args.design] if args.design else []
        return V.main([args.command, "--roles", *role_keys, "--run", args.run, *extra])

    if args.command == "generate":
        load_key()
        extra = ["--design", args.design] if args.design else []
        for only in args.only:
            extra += ["--only", only]
        if args.no_retry:
            extra.append("--no-retry")
        return V.main(["generate", "--roles", *role_keys, "--run", args.run,
                       "--workers", str(args.workers), *extra])

    # pack：装包（--write --apply-tables）+ 并 claims + 登记产物 + 刷三层镜像
    if len(role_keys) != 1:
        parser.error("pack one role at a time")
    role = role_keys[0]
    spec = MS.get_spec(role)
    package = MC.MAPack(spec).package
    extra = ["--design", args.design] if args.design else []
    if args.replace:
        extra.append("--replace")
    if not args.dry_run:
        extra += ["--write", "--apply-tables"]
    rc = V.main(["pack", "--roles", role, "--run", args.run, "--package", str(package), *extra])
    if rc != 0 or args.dry_run:
        return rc
    print(json.dumps({"role": role, "post_pack": finish_pack(role, args.run)},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
