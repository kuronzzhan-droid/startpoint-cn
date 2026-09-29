"""Export the current MOD character catalog as a portable, read-only website.

python -X utf8 mod-tools/wf_wiki.py --output D:/WF/out/MOD角色Wiki/site
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import wf_mod_tool as core
import wf_publish
from wf_wiki_media import WikiMedia
from wf_wiki_media import digest

HERE = Path(__file__).resolve().parent
MARKER = ".wf-wiki-export.json"


def prepare_output(output: Path, repo: Path, store: Path) -> Path:
    output = output.resolve()
    for protected in (repo.resolve(), store.resolve().parent):
        if output == protected or output in protected.parents:
            raise ValueError("输出路径不得覆盖仓库、数据目录或其上级目录")
    if output.is_relative_to(store.resolve().parent):
        raise ValueError("输出路径不得位于游戏数据目录")
    if output.is_relative_to(repo.resolve()) and not output.is_relative_to(repo.resolve() / "work"):
        raise ValueError("仓库内导出仅允许 work/；建议放到仓库外")
    if output.exists() and any(output.iterdir()):
        children = list(output.iterdir())
        if any(path.is_symlink() or path.is_junction() for path in children):
            raise ValueError("输出目录含链接或目录联接，请选择独立目录")
        marker = output / MARKER
        try:
            identity = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            identity = None
        if not isinstance(identity, dict) or identity.get("generator") != "wf_wiki":
            raise ValueError("输出目录非空且不是本工具产物，请选择新目录")
        media = output / "media"
        if media.is_dir() and any(path.is_symlink() or path.is_junction() for path in media.iterdir()):
            raise ValueError("媒体目录含链接或目录联接，请选择独立目录")
    output.mkdir(parents=True, exist_ok=True)
    (output / MARKER).write_text('{"generator":"wf_wiki","complete":false}\n', encoding="utf-8")
    return output


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_catalog(catalog: dict, output: Path) -> None:
    characters = catalog["characters"]
    ids = [str(character["id"]) for character in characters]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("角色目录为空或存在重复 ID")
    for character in characters:
        urls = [character.get("icon")]
        urls.extend(item.get("url") for item in character.get("portraits", []))
        urls.extend(item.get("audio") for item in character.get("voices", []))
        for url in filter(None, urls):
            path = (output / url).resolve()
            if not url.startswith("media/") or not path.is_relative_to(output.resolve() / "media"):
                raise ValueError("媒体链接必须指向导出目录内的 media 文件夹")
            if not path.is_file():
                raise ValueError(f"角色 {character['id']} 存在失效媒体链接：{url}")


def verify_table_sources(meta: dict, voice_summary: dict, store: Path) -> None:
    hashes = dict(meta.get("sourceHashes", {}))
    hashes.update(voice_summary.get("sourceHashes", {}))
    for logical, expected in hashes.items():
        path = core.table_path(store, logical)
        if not path.is_file() or digest(path.read_bytes()) != expected:
            raise RuntimeError(f"导出期间数据源变化：{logical}，请重新导出")
    for logical in meta.get("sourceMissing", []):
        if core.table_path(store, logical).exists():
            raise RuntimeError(f"导出期间出现新的覆盖数据：{logical}，请重新导出")


def export(output: Path) -> dict:
    from wf_wiki_catalog import build_catalog
    from wf_wiki_voice import export_voices

    repo = HERE.parent
    store = core.resolve_active_store()
    version_before = wf_publish.current_max_version()
    pending = HERE / "work/sync_pending.json"
    pending_before = pending.read_bytes() if pending.exists() else None
    if pending_before and json.loads(pending_before):
        raise RuntimeError("当前存在待发布修改；请待发布结束后导出，避免把候选标为生效版")
    output = prepare_output(output, repo, store)
    media = WikiMedia(store, output)
    print("正在读取角色、技能与能力数据……", flush=True)
    catalog = build_catalog(repo, media)
    print(f"正在匹配 {len(catalog['characters'])} 个角色的语音与字幕……", flush=True)
    voice_summary = export_voices(repo, catalog["characters"], media)
    media.verify_sources()
    verify_table_sources(catalog["meta"], voice_summary, store)
    validate_catalog(catalog, output)
    version_after = wf_publish.current_max_version()
    pending_after = pending.read_bytes() if pending.exists() else None
    if version_before != version_after or pending_before != pending_after:
        raise RuntimeError("导出期间发布状态改变，请重新导出")
    catalog["meta"].update({
        "version": version_after,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "voiceCounts": voice_summary, "media": media.summary(),
        "snapshotNote": "本地数据快照；更新游戏数据后需重新导出。语音取当前资源，字幕来源逐条标注。",
    })
    write_json(output / "data.json", catalog)
    script = "window.WF_WIKI = " + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (output / "data.js").write_text(script, encoding="utf-8")
    for path in (HERE / "wiki").iterdir():
        if path.suffix in {".html", ".css", ".js"}:
            shutil.copyfile(path, output / path.name)
    write_json(output / "media-manifest.json", media.entries)
    (output / "打开角色Wiki.bat").write_bytes(b'@echo off\r\nstart "" "%~dp0index.html"\r\n')
    (output / "使用说明.txt").write_text(
        "世界弹射 MOD 角色资料站\n\n双击 index.html 或 打开角色Wiki.bat 即可浏览，无需联网。\n"
        "保留同目录下的 data.js、CSS、JavaScript 和 media 文件夹。\n"
        "搜索支持名字、角色 ID、技能与能力关键词；详情页面地址可保留角色定位。\n"
        "角色数据是导出时的本地快照。普通/进化技能分别展示；属性面板保留数值口径。\n"
        "语音逐条显示当前可用的日文原文和中文台词；缺失项不代表音频不存在。\n"
        "更新资料：在仓库执行 python -X utf8 mod-tools/wf_wiki.py --output <此目录>\n",
        encoding="utf-8")
    receipt = {"generator": "wf_wiki", "complete": True,
               "version": version_after, "characters": len(catalog["characters"]),
               "voices": voice_summary, "media": media.summary()}
    write_json(output / MARKER, receipt)
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description="只读导出 MOD 角色 Wiki（不发布、不改游戏数据）")
    parser.add_argument("--output", type=Path, required=True, help="独立产物目录，推荐放在仓库外")
    args = parser.parse_args()
    result = export(args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"网页：{args.output.resolve() / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
