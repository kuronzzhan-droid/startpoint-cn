"""Project an export into player-facing data without game keys or source code."""
from __future__ import annotations

import hashlib
import re

PRIVATE = {
    "code", "raw", "rawCommands", "commands", "commandsNote", "commandCount", "program",
    "sources", "sourceHashes", "sourceMissing", "sourceFiles", "sourceDocuments", "fingerprints",
    "changes", "customText", "modificationScope", "key", "elementId", "categorySource", "logical",
    "source", "audioSha", "missingTranslations", "uniqueCondition", "multiballs", "condition",
    "questId",
}


def public_id(kind, value):
    return kind + hashlib.sha256(f"wf-wiki-public-v1:{kind}:{value}".encode()).hexdigest()[:12]


def clean_text(value):
    value = re.sub(r"（固有\d+）", "", value)
    value = re.sub(r"固有\d+", "固有状态", value)
    value = re.sub(r"(?:battle|master|character)/[^\s，。；）\]']+", "相关技能", value)
    value = re.sub(r"(?:[A-Za-z]:[\\/]|file:///)[^\n]+", "本地资料", value)
    value = re.sub(r"\[[A-Za-z][A-Za-z0-9_$./-]*_[A-Za-z0-9_$./-]+\]", "（特殊效果）", value)
    value = re.sub(r"\b[A-Za-z][A-Za-z0-9$]*_[A-Za-z0-9_$./-]+", "特殊效果", value)
    return value.replace("角色 ID", "角色条目").replace("程序摘要", "详细数值")


def readable(value):
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return [readable(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in PRIVATE or key == "id":
            continue
        if key == "rows":
            item = [row for row in item if isinstance(row, dict)]
        if key == "values" and isinstance(item, list):
            item = [row for row in item if isinstance(row, dict) and "label" in row and "value" in row]
        result[key] = readable(item)
    return result


def public_catalog(catalog):
    result = readable(catalog)
    for original, public in zip(catalog["characters"], result["characters"]):
        public["id"] = public_id("c", original["id"])
        # Errors retain player context, never exception payloads or file paths.
        public["warnings"] = [w for w in public.get("warnings", []) if not re.search(r"[A-Za-z_]{8,}", w)]
    for original, public in zip(catalog.get("equipment", []), result.get("equipment", [])):
        public["id"] = public_id("w", original["id"])
    result["meta"]["dataNote"] = "数值从当前资料解析；条件、成长与单次命中倍率分别列出。"
    result["meta"]["rosterRule"] = "收录官方可玩角色、改版官方与新增 MOD。剧情及助战占位角色不列为可玩角色；独立角色包的资料来源另行标注。"
    result["meta"]["credits"] = ["界面及配队交互参考作者提供的《弹射世界中文 WIKI》离线版 v3.0.0。感谢前人整理的资料；当前 MOD 数值以本次数据快照为准。"]
    return result
