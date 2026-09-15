"""七角色季节换装版（seasonal7-20260916）语音工具链。

design json 的 voice 字段 → Seed Audio 请求（复用 wf_art_voice_api.payload/generate）
→ 后处理（-14 LUFS、真峰 ≤-1.65 dBTP、44.1k 单声道 96k CBR、mp3_encode 严格校验）
→ 装包（存储态 MP3、character_speech 8 行、matched_skill_ready 原生路由、表 claims）。

边界：不写 live store、assets、.cdn、src；装包函数只写调用方给定的候选 package。
密钥只从进程环境 WF_SEED_AUDIO_KEY 读取；--key-file 由父进程读文件后注入子进程环境，
不进参数、日志、回执或报告。
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import asdict
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import wave
import zlib

import numpy as np

import wf_art_voice_api as api
import wf_assets
import wf_mod_tool as core
import wf_voice_gate as gate
from wf_art_voice_audio import amplitude
from wf_art_voice_enablement import native_excluded
from wf_gerald_voice_audio import metadata, pcm
from wf_gerald_voice_level_audio import measure

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'work' / 'character_packs' / 'seasonal7-20260916'
DESIGN_DIR = PACK / 'design'
VOICE_DIR = PACK / 'voice'
REFS_DIR = VOICE_DIR / 'refs'
REFS_INDEX = REFS_DIR / 'refs.json'
GENERATION_DIR = VOICE_DIR / 'generation'
SMOKE_DIR = VOICE_DIR / 'smoke'
KEY_FILE = PACK / '.secrets' / 'seed_audio.key'
KEY_ENV = 'WF_SEED_AUDIO_KEY'

# role 键只用小写字母（wf_art_voice_api.generate 的输出目录正则 [a-z]+）。
ROLES = {
    'regis': dict(cid='139994', code='rec_android_seaside', template_id='131020', template_code='rec_android_1anv'),
    'tekuto': dict(cid='139993', code='super_robot_tailcoat', template_id='131092', template_code='super_robot'),
    'zantetsu': dict(cid='159998', code='samurai_robot_plum', template_id='151117', template_code='samurai_robot_smr22'),
    'zehr': dict(cid='159997', code='guildknight_leader_tavern', template_id='151069', template_code='guildknight_leader'),
    'philia': dict(cid='159996', code='wind_oracle_yukata', template_id='141165', template_code='wind_oracle_meteor23'),
    'primula': dict(cid='169992', code='blackflower_wiz_yukata', template_id='161123', template_code='blackflower_wiz_smr22'),
    'yuki': dict(cid='129991', code='psychic_yuki_swim', template_id='121147', template_code='psychic_yuki_ny23'),
}

# 相对 character/<code>/voice/ 的官方目录结构（不带 .mp3）。home 用 home_N：
# wf_assets.char_asset_manifest 只认 home_0..9 这类自定义名，其他名导出/直推会丢。
HOME_SLOTS = tuple(f'home/home_{i}' for i in range(6))
SLOTS = ('ally/join', 'ally/evolution', *HOME_SLOTS,
         'battle/battle_start_0', 'battle/battle_start_1',
         'battle/skill_ready', 'battle/matched_skill_ready',
         *(f'battle/skill_{i}' for i in range(4)),
         'battle/power_flip_0', 'battle/power_flip_1',
         'battle/outhole_0', 'battle/outhole_1',
         'battle/win_0', 'battle/win_1')
SUBTITLE_SLOTS = (*HOME_SLOTS, 'ally/join', 'ally/evolution')
SUBTITLE_MAX = 82          # 官方 home 字幕最长 82 字；气泡不缩字、不截断
SUBTITLE_MAX_LINES = 4

# 表演时长目标（官方 p50–p90，见 mech_voice.md §4.1）；拼进 direction。
TIMING = {
    'join': '加入语音，从容完整，目标9至13秒',
    'evolution': '进化语音，情感完整，目标10至15秒',
    'home': '主页闲聊，从容自然，句间短暂换气，不拖长尾音，目标10至15秒',
    'battle_start_N': '开战短句，紧凑清晰，目标1.5至2.6秒',
    'skill_ready': '技能准备提示，紧凑清晰，尾音自然收住，目标1.2至2.2秒',
    'skill_N': '技能发动，坚定有力，只表达一个意象，目标1.8至3.2秒',
    'power_flip_N': '强力弹射的短促喊声，干脆利落，目标0.6至1.5秒',
    'outhole_N': '落洞时的短促反应，目标0.6至1.8秒',
    'win_N': '胜利台词，自然清晰，目标3至5.4秒',
}

SPEECH_TABLE = 'master/character/character_speech.orderedmap'
CHARACTER_TABLE = 'master/character/character.orderedmap'
SWITCH_TABLE = 'master/skill/switched_action_skill.orderedmap'
ACTION_TABLE = 'master/skill/action_skill.orderedmap'
SERVER_CHARACTER = 'cdndata/character.json'
VOICE_ACTOR = 'AI 合成配音'

# 生成
MAX_WORKERS = 2
MAX_AUTO_RETRIES = 1            # 同一请求（同指纹）最多自动重试 1 次，跨续跑累计
AUDIT_CODES = frozenset({'45001125'})
RETRY_BACKOFF = {429: 30.0}
DEFAULT_BACKOFF = 10.0

# 后处理（杰拉德 -14 LUFS 方案：wf_gerald_voice_level_audio）
TARGET_LUFS = -14.0
PEAK_CEILING = -1.65
LIMITER_CEILING = -1.2
MAX_LIMITER_REDUCTION_DB = 4.0
LOUDNESS_TOLERANCE = 1.0
SAMPLE_DELTA_LIMIT = 128
MASTER_PARAMS = dict(target_lufs=TARGET_LUFS, peak_ceiling_dbtp=PEAK_CEILING,
                     limiter_ceiling_dbfs=LIMITER_CEILING,
                     max_limiter_reduction_db=MAX_LIMITER_REDUCTION_DB,
                     limiter='alimiter attack=5 release=80 level=disabled latency=enabled @176.4k',
                     codec='libmp3lame 44100Hz mono 96k CBR xing no-id3')

# 参考音频（校园配方）
REF_FILTERS = ('silenceremove=start_periods=1:start_duration=0.03:start_threshold=-55dB,'
               'areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-55dB,'
               'areverse,highpass=f=70,loudnorm=I=-20:TP=-2:LRA=11')
REF_RANGES = {'battle': (1.5, 6.0), 'home': (10.0, 15.0)}
# 按顺序取第一条清洗后时长落在区间内的官方语音。首选项与 mech_voice.md §3.4 一致；
# 斩铁/勇希/普莉姆拉 skill_ready 太短，战斗参考用 battle_start/win。
REF_CANDIDATES = {
    'regis': {'battle': [('rec_android_1anv', 'battle/skill_ready'), ('rec_android_1anv', 'battle/battle_start_0')],
              'home': [('rec_android_1anv', 'home/otto_mitsukatte'), ('rec_android_1anv', 'home/sate_shinmiri')]},
    'tekuto': {'battle': [('super_robot', 'battle/battle_start_0'), ('super_robot', 'battle/battle_start_1')],
               'home': [('super_robot', 'home/kondosa'), ('super_robot', 'home/jibunomitsuketakute')]},
    'zantetsu': {'battle': [('samurai_robot_smr22', 'battle/battle_start_0'), ('samurai_robot_smr22', 'battle/win_0')],
                 'home': [('samurai_robot', 'home/ninjazamuraiwa'), ('samurai_robot', 'home/ninjazamuraino'),
                          ('samurai_robot', 'home/muron_ninjazamuraiga')]},
    'zehr': {'battle': [('guildknight_leader', 'battle/battle_start_1'), ('guildknight_leader', 'battle/battle_start_0')],
             'home': [('guildknight_leader', 'home/yurukuyarebaiisa'), ('guildknight_leader', 'home/n_iikazefuiterunaa')]},
    'philia': {'battle': [('wind_oracle_meteor23', 'battle/skill_ready'), ('wind_oracle_meteor23', 'battle/win_0')],
               'home': [('wind_oracle_meteor23', 'home/konoisho'), ('wind_oracle_meteor23', 'home/hitoni')]},
    'primula': {'battle': [('blackflower_wiz_smr22', 'battle/battle_start_1'), ('blackflower_wiz_smr22', 'battle/win_1')],
                'home': [('blackflower_wiz_smr22', 'home/bakansunante'), ('blackflower_wiz_smr22', 'home/kondoarisusanto'),
                         ('blackflower_wiz_smr22', 'home/a_au_konokakko')]},
    'yuki': {'battle': [('psychic_yuki_ny23', 'battle/battle_start_1'), ('psychic_yuki_ny23', 'battle/win_0')],
             'home': [('psychic_yuki_ny23', 'home/dattesa_kibun'), ('psychic_yuki_ny23', 'home/inahochanno')]},
}
REF_NOTES = {
    'zantetsu': 'samurai_robot_smr22 自身 6 条 home 均 ≥15.2s，cheiyaraaa_muu 开头为长喊声；'
                'home 参考取同角色同 CV 的基础版 samurai_robot。',
}

SMOKE_LINE = dict(
    role='regis', slot='battle/battle_start_0',
    persona=('成熟从容的成年男性机人绅士声音，优雅风趣、略带戏谑的低笑，把观察和记录人类当乐趣；'
             '措辞考究，自称“私”，自然清晰的日语发音'),
    direction='海边度假的轻松午后，从容优雅地招呼同伴出发',
    ja='さあ、行きましょう。', zh='来吧，我们出发。')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec='seconds')


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def find_tool(name: str) -> Path:
    found = shutil.which(name)
    if found:
        return Path(found)
    fallback = Path('C:/ProgramData/HP/LCDDisplayHelper/bin') / (name + '.exe')
    if fallback.is_file():
        return fallback
    raise FileNotFoundError(f'{name} not found on PATH')


# ---------------------------------------------------------------- 槽位、字幕、路由

def normalize_slot(name) -> str:
    """`skill_0` / `battle/skill_0` → `battle/skill_0`；只接受本批 22 个官方槽。"""
    if not isinstance(name, str) or not name.strip():
        raise ValueError('voice slot must be a non-empty string')
    text = name.strip()
    if '/' not in text:
        group = 'ally' if text in ('join', 'evolution') else 'home' if text.startswith('home_') else 'battle'
        text = group + '/' + text
    if text not in SLOTS:
        raise ValueError(f'unsupported voice slot: {name!r}')
    return text


def family(slot: str) -> str:
    """官方时长族；matched_skill_ready 共用 skill_ready 预算。"""
    fam = 'skill_ready' if slot == 'battle/matched_skill_ready' else gate.slot_family(slot)
    if fam not in gate.OFFICIAL_DURATION:
        raise ValueError(f'slot has no official duration family: {slot}')
    return fam


def compose_direction(direction, slot: str) -> str:
    # payload 会接「。只说以下日语台词：」，这里不留句末标点，避免「。。」。
    parts = []
    for text in (direction or '', TIMING[family(slot)]):
        text = str(text).strip().rstrip('。.；; ')
        if text:
            parts.append(text)
    return '；'.join(parts)


def _clean_text(value, *, allow_newline: bool, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f'{label} must be a string')
    text = value.strip()
    allowed = {'\n'} if allow_newline else set()
    if any((ord(c) < 32 and c not in allowed) or c == '\x7f' for c in text):
        raise ValueError(f'{label} contains control characters')
    return text


def check_subtitle(text: str) -> None:
    visible = text.replace('\n', '')
    if not visible:
        raise ValueError('empty subtitle')
    if len(visible) > SUBTITLE_MAX:
        raise ValueError(f'subtitle exceeds {SUBTITLE_MAX} characters ({len(visible)}): {visible[:20]}…')
    if text.count('\n') + 1 > SUBTITLE_MAX_LINES:
        raise ValueError(f'subtitle exceeds {SUBTITLE_MAX_LINES} lines')


ROUTE_ALIASES = {
    'hphigh': '0', 'hp_high': '0',
    'conditionexist': '1', 'condition_exist': '1', 'condition': '1',
    'changeskillflag': '3', 'change_skill_flag': '3', 'skill_flag': '3', 'skillflag': '3',
}


def switch_key(code: str) -> str:
    return code + '_voice_ready'


def _first(route: dict, *names):
    for name in names:
        if name in route and route[name] not in (None, ''):
            return str(route[name]).strip()
    raise ValueError('route lacks ' + '/'.join(names))


def normalize_route(route, code: str) -> list[str]:
    """返回 character c9–c16 八列。支持 kind 0=HpHigh(c13)、1=ConditionExist(c10/c11)、3=ChangeSkillFlag。

    kind 2（多球，会出编成缤带）、4（IsUnison，主位永不成立）与其他值一律拒绝。
    """
    key = switch_key(code)
    if isinstance(route, dict) and ('columns' in route or 'c9_16' in route):
        route = route.get('columns', route.get('c9_16'))
    if isinstance(route, (list, tuple)):
        cols = ['' if x is None else str(x).strip() for x in route]
    elif isinstance(route, dict):
        raw = str(route.get('kind', '')).strip()
        kind = raw if raw in ('0', '1', '3') else ROUTE_ALIASES.get(raw.lower().replace('-', '_'))
        if kind is None:
            raise ValueError(f'unsupported matched_skill_ready route kind: {raw!r}')
        cols = [kind, '', '', '', '', key, 'false', 'false']
        if kind == '0':
            cols[4] = _first(route, 'hp_threshold', 'threshold', 'c13')
        elif kind == '1':
            cols[1] = _first(route, 'condition_kind', 'c10')
            cols[2] = _first(route, 'condition_id', 'unique_id', 'c11')
    else:
        raise ValueError('missing matched_skill_ready route (matched 条在战斗里永远不会播)')
    if len(cols) != 8:
        raise ValueError('route must be exactly character columns 9..16')
    kind, c10, c11, c12, c13, c14, c15, c16 = cols
    if kind not in ('0', '1', '3'):
        raise ValueError(f'unsupported route kind {kind!r}; only 0/1/3 are native-safe')
    if c12 or c14 != key or (c15, c16) != ('false', 'false'):
        raise ValueError('route must target <code>_voice_ready with voice flags false')
    if kind == '0':
        try:
            threshold = float(c13)
        except ValueError:
            raise ValueError('HpHigh threshold must be numeric') from None
        if c10 or c11 or not 0 < threshold <= 1:
            raise ValueError('HpHigh route needs only c13 in (0, 1]')
    elif kind == '1':
        if not (c10.isdigit() and c11.isdigit()) or c13:
            raise ValueError('ConditionExist route needs numeric c10/c11 and empty c13')
    elif c10 or c11 or c13:
        raise ValueError('ChangeSkillFlag route carries no condition columns')
    return cols


# ---------------------------------------------------------------- design → 请求

def load_design_voice(path) -> dict:
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    voice = data.get('voice') if isinstance(data, dict) else None
    if not isinstance(voice, dict):
        raise ValueError(f'design json lacks a voice object: {path}')
    return voice


def load_refs_index(path=REFS_INDEX) -> dict:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def resolve_references(role: str, spec, refs_index: dict | None = None) -> list[dict]:
    """design 的 references → [{path, sha256}]，读文件核对哈希。

    spec：None/'refs'/'default' 取 refs.json；列表项可为 {path, sha256}、{kind}、'battle'/'home'。
    """
    def indexed():
        index = refs_index if refs_index is not None else load_refs_index()
        entries = index['roles'][role]['references']
        return {e['kind']: e for e in entries}, entries

    items = []
    if spec in (None, '', 'refs', 'default') or spec == []:
        _kinds, entries = indexed()
        items = [dict(path=e['path'], sha256=e['sha256']) for e in entries]
    elif isinstance(spec, list):
        for item in spec:
            kind = item if isinstance(item, str) else item.get('kind') if isinstance(item, dict) else None
            if isinstance(item, dict) and 'path' in item:
                if not isinstance(item.get('sha256'), str):
                    raise ValueError('explicit reference requires sha256')
                items.append(dict(path=str(item['path']), sha256=item['sha256']))
            elif kind in ('battle', 'home'):
                entry = indexed()[0][kind]
                items.append(dict(path=entry['path'], sha256=entry['sha256']))
            else:
                raise ValueError(f'unsupported reference item: {item!r}')
    else:
        raise ValueError('references must be omitted, "refs" or a list')
    if not 1 <= len(items) <= 2:
        raise ValueError('expected one or two reference recordings')
    for item in items:
        path = Path(item['path'])
        if path.suffix.lower() not in ('.wav', '.mp3') or not path.is_file():
            raise ValueError(f'reference recording missing or unsupported: {path}')
        if sha(path.read_bytes()) != item['sha256']:
            raise ValueError('reference hash drift')
    return items


def request_lines(role: str, voice: dict, *, refs_index: dict | None = None,
                  allow_partial: bool = False) -> list[dict]:
    """design voice → wf_art_voice_api 同构的逐条请求（按 SLOTS 顺序）。"""
    if role not in ROLES:
        raise ValueError(f'unknown role {role!r}')
    info = ROLES[role]
    persona = _clean_text(voice.get('persona'), allow_newline=False, label='persona')
    if not persona:
        raise ValueError('persona is required')
    references = resolve_references(role, voice.get('references'), refs_index)
    raw_lines = voice.get('lines')
    if not isinstance(raw_lines, list) or not raw_lines:
        raise ValueError('voice.lines must be a non-empty list')
    output, seen = [], set()
    for item in raw_lines:
        if not isinstance(item, dict):
            raise ValueError('voice line must be an object')
        slot = normalize_slot(item.get('slot'))
        if slot in seen:
            raise ValueError(f'duplicate voice slot {slot}')
        seen.add(slot)
        ja = _clean_text(item.get('ja'), allow_newline=False, label=f'{slot}.ja')
        zh = _clean_text(item.get('zh'), allow_newline=True, label=f'{slot}.zh')
        if not ja or not zh:
            raise ValueError(f'{slot} requires ja and zh')
        if slot in SUBTITLE_SLOTS:
            check_subtitle(zh)
        design_direction = item.get('direction') or ''
        line = dict(role=role, slot=slot, code=info['code'], character_id=info['cid'],
                    family=family(slot), persona=persona,
                    direction=compose_direction(design_direction, slot),
                    design_direction=design_direction, ja=ja, zh=zh, references=references)
        if item.get('tts_text'):
            line['tts_text'] = _clean_text(item['tts_text'], allow_newline=False, label=f'{slot}.tts_text')
        output.append(line)
    missing = [slot for slot in SLOTS if slot not in seen]
    if missing and not allow_partial:
        raise ValueError('incomplete 22-slot voice set; missing ' + ', '.join(missing))
    output.sort(key=lambda x: SLOTS.index(x['slot']))
    return output


def plan_role(role: str, design_path=None, *, refs_index=None, allow_partial=False) -> dict:
    path = Path(design_path) if design_path else DESIGN_DIR / f'{role}.json'
    voice = load_design_voice(path)
    lines = request_lines(role, voice, refs_index=refs_index, allow_partial=allow_partial)
    route = voice.get('route')
    return dict(role=role, design=str(path), lines=lines,
                route=normalize_route(route, ROLES[role]['code']) if route is not None else None)


def request_fingerprint(line: dict) -> str:
    """与 wf_art_voice_api.generate 的 request_fingerprint 同算法。"""
    return api.sha(json.dumps(api.payload(line), ensure_ascii=False, sort_keys=True).encode())


# ---------------------------------------------------------------- 生成（并发 ≤2、重试 ≤1、续跑）

def classify_failure(meta: dict) -> str:
    status = meta.get('http_status')
    code = str(meta.get('api_code') or '')
    message = str(meta.get('api_message') or '').lower()
    if status == 400 and (code in AUDIT_CODES or 'audit' in message):
        return 'needs_rewrite'
    if status is None or status == 429 or status >= 500 or 200 <= status < 300:
        return 'retryable'
    return 'fatal'


def _attempt_records(base: Path, slot: str) -> list[tuple[Path, dict]]:
    folder = base / 'attempts' / slot
    if not folder.is_dir():
        return []
    return [(p, json.loads(p.read_bytes())) for p in sorted(folder.glob('*.json'))]


def _archive_attempt(receipt: Path, base: Path, slot: str) -> Path:
    folder = base / 'attempts' / slot
    folder.mkdir(parents=True, exist_ok=True)
    index = 1 + max((int(p.stem) for p in folder.glob('*.json') if p.stem.isdigit()), default=0)
    target = folder / f'{index:03d}.json'
    receipt.replace(target)
    return target


def _outcome(line: dict, status: str, **extra) -> dict:
    return dict(role=line['role'], slot=line['slot'], status=status, **extra)


def generate_line(line: dict, output, key: str, *, opener=urllib.request.urlopen,
                  sleep=time.sleep, max_retries: int = MAX_AUTO_RETRIES) -> dict:
    """单条生成；失败回执归档到 attempts/<slot>/NNN.json，按指纹累计重试预算。

    审核失败（400/45001125）不重试，返回 needs_rewrite；改写台词后指纹变化自动放行。
    已有不同指纹的成品会返回 conflict（请换 --run 目录重录）。
    """
    if max_retries not in (0, 1):
        raise ValueError('automatic retries are capped at one')
    role, slot = line['role'], line['slot']
    if role not in ROLES or slot not in SLOTS:
        raise ValueError('unsafe or unknown recording path')
    base = Path(output) / role
    target = base / 'raw' / (slot + '.mp3')
    receipt = base / 'receipts' / (slot + '.json')
    fingerprint = request_fingerprint(line)
    if receipt.is_file() and not target.exists():
        saved = json.loads(receipt.read_bytes())
        if saved.get('status') != 'failed':
            return _outcome(line, 'conflict', error='receipt without audio is not a failed attempt')
        _archive_attempt(receipt, base, slot)
    prior = [meta for _path, meta in _attempt_records(base, slot)
             if meta.get('request_fingerprint') == fingerprint]
    last = {k: prior[-1].get(k) for k in ('http_status', 'api_code', 'api_message', 'error')} if prior else {}
    if any(classify_failure(meta) == 'needs_rewrite' for meta in prior):
        return _outcome(line, 'needs_rewrite', attempts=len(prior), **last)
    budget = 1 + max_retries - len(prior)
    if budget <= 0:
        return _outcome(line, 'retry_exhausted', attempts=len(prior), **last)
    result = None
    for attempt in range(budget):
        try:
            result = api.generate(line, output, key, opener=opener)
        except ValueError as exc:
            return _outcome(line, 'conflict', error=str(exc).replace(key, '[REDACTED]') if key else str(exc))
        if result['status'] == 'cached':
            return result
        result['attempts'] = len(prior) + attempt + 1
        if result['status'] == 'generated':
            return result
        meta = json.loads(receipt.read_bytes())
        _archive_attempt(receipt, base, slot)
        kind = classify_failure(meta)
        if kind == 'needs_rewrite':
            return dict(result, status='needs_rewrite')
        if kind == 'fatal':
            return result
        if attempt + 1 < budget:
            sleep(RETRY_BACKOFF.get(meta.get('http_status'), DEFAULT_BACKOFF))
    return result


def rewrite_queue(lines: list[dict], output) -> list[dict]:
    """当前台词指纹下仍待改写（审核失败）的条目。"""
    queue = []
    for line in lines:
        base = Path(output) / line['role']
        fingerprint = request_fingerprint(line)
        hits = [(p, m) for p, m in _attempt_records(base, line['slot'])
                if m.get('request_fingerprint') == fingerprint and classify_failure(m) == 'needs_rewrite']
        if hits:
            path, meta = hits[-1]
            queue.append(dict(role=line['role'], slot=line['slot'], ja=line['ja'], zh=line['zh'],
                              design_direction=line.get('design_direction', ''),
                              http_status=meta.get('http_status'), api_code=meta.get('api_code'),
                              api_message=meta.get('api_message'), receipt=str(path),
                              action='改写 ja（避开审核敏感措辞）后重跑；台词变化即新指纹，自动放行'))
    return queue


def scrub_secret(folder, key: str) -> list[str]:
    """兜底：输出目录里任何 JSON 出现密钥原文即替换并返回命中路径。"""
    hits = []
    if not key or not Path(folder).is_dir():
        return hits
    for path in Path(folder).rglob('*.json'):
        text = path.read_text(encoding='utf-8', errors='ignore')
        if key in text:
            path.write_text(text.replace(key, '[REDACTED]'), encoding='utf-8')
            hits.append(str(path))
    return hits


def run_generation(lines: list[dict], output, key: str, *, workers: int = MAX_WORKERS,
                   opener=urllib.request.urlopen, sleep=time.sleep,
                   max_retries: int = MAX_AUTO_RETRIES, on_result=None) -> dict:
    if workers not in range(1, MAX_WORKERS + 1):
        raise ValueError('Seed Audio concurrency is capped at 2')
    output = Path(output)
    started = time.monotonic()
    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(generate_line, line, output, key, opener=opener, sleep=sleep,
                               max_retries=max_retries) for line in lines]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if on_result:
                on_result(result)
    results.sort(key=lambda r: (r['role'], SLOTS.index(r['slot'])))
    queue_path = output / 'rewrite_queue.json'
    selected = {(line['role'], line['slot']) for line in lines}
    kept = [item for item in (json.loads(queue_path.read_bytes()) if queue_path.is_file() else [])
            if (item['role'], item['slot']) not in selected]     # --only 子集不清掉其他待改项
    queue = sorted(kept + rewrite_queue(lines, output), key=lambda x: (x['role'], SLOTS.index(x['slot'])))
    _write_json(queue_path, queue)
    counts = {}
    for result in results:
        counts[result['status']] = counts.get(result['status'], 0) + 1
    summary = dict(finished_at=_now(), requests=len(lines), workers=workers, max_auto_retries=max_retries,
                   elapsed_seconds=round(time.monotonic() - started, 2), counts=counts,
                   rewrite_queue=len(queue), results=results)
    _write_json(output / 'generation-summary.json', summary)
    leaked = scrub_secret(output, key)
    if leaked:
        raise RuntimeError(f'credential text was found and redacted in {len(leaked)} file(s)')
    return summary


# ---------------------------------------------------------------- 后处理（-14 LUFS）

def _ffmpeg(ffmpeg, args, **kwargs):
    result = subprocess.run([str(ffmpeg), '-hide_banner', '-nostats', *args], capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-2000:])
    return result


def _mono_filters(channels: int) -> list[str]:
    if channels == 1:
        return []
    if channels == 2:
        return ['pan=mono|c0=0.5*c0+0.5*c1']
    raise ValueError(f'unreviewed source channel layout: {channels}')


def encode_voice(source: Path, output: Path, *, ffmpeg, channels: int, gain_db: float = 0.0,
                 limiter_ceiling_db: float | None = None) -> dict:
    filters = _mono_filters(channels)
    if limiter_ceiling_db is None:
        filters += ['aresample=44100', f'volume={gain_db:.8f}dB']
    else:
        limit = 10 ** (limiter_ceiling_db / 20)
        filters += ['aresample=176400', f'volume={gain_db:.8f}dB',
                    f'alimiter=limit={limit:.12f}:attack=5:release=80:level=disabled:latency=enabled',
                    'aresample=44100']
    output.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg(ffmpeg, ['-y', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-map_metadata', '-1', '-vn',
                     '-af', ','.join(filters), '-c:a', 'libmp3lame', '-compression_level', '0',
                     '-ar', '44100', '-ac', '1', '-b:a', '96k', '-minrate', '96k', '-maxrate', '96k',
                     '-write_xing', '1', '-id3v2_version', '0', str(output)])
    return measure(output, Path(ffmpeg))


def oversampled_peak_db(source: Path, *, ffmpeg, channels: int) -> float:
    filters = ','.join(_mono_filters(channels) + ['aresample=176400'])
    raw = _ffmpeg(ffmpeg, ['-v', 'error', '-i', str(source), '-map', '0:a:0', '-af', filters,
                           '-ac', '1', '-f', 'f32le', 'pipe:1']).stdout
    values = np.frombuffer(raw, dtype='<f4')
    if not len(values):
        raise ValueError('empty decoded audio')
    return 20 * math.log10(max(float(np.max(np.abs(values))), 1e-12))


def duration_findings(code: str, slot: str, seconds: float) -> list[dict]:
    fam = family(slot)
    _n, low, p50, p90, _p95, _p99, high = gate.OFFICIAL_DURATION[fam]
    detail = dict(character=code, slot=slot, family=fam, seconds=round(seconds, 3))
    if seconds > high:
        return [dict(level='error', rule='over_official_max', limit=high, **detail)]
    if seconds > p90:
        return [dict(level='warn', rule='over_official_p90', limit=p90, official_max=high, **detail)]
    if seconds < low:
        return [dict(level='warn', rule='below_official_min', limit=low, p50=p50, **detail)]
    return []


def master_voice(source, target, *, slot: str, code: str, ffmpeg, ffprobe,
                 target_lufs: float = TARGET_LUFS, peak_ceiling: float = PEAK_CEILING,
                 limiter_ceiling: float = LIMITER_CEILING,
                 max_limiter_reduction_db: float = MAX_LIMITER_REDUCTION_DB) -> tuple[bytes, dict]:
    """整条表演定增益到 -14 LUFS；真峰超限时用有界 lookahead 限幅。不裁剪、不变速、不拼接。

    返回 (存储态字节, QC 报告)；target 写标准态 MP3。时长超官方族最大值不抛错，写入 findings。
    """
    source, target = Path(source), Path(target)
    if slot not in SLOTS:
        raise ValueError('unknown voice slot')
    source_raw = source.read_bytes()
    info = metadata(source, Path(ffprobe))
    channels = int(info['streams'][0]['channels'])
    _mono_filters(channels)
    temporary = target.with_name(target.stem + '.tmp.mp3')
    try:
        baseline = encode_voice(source, temporary, ffmpeg=ffmpeg, channels=channels)
        if baseline['lufs_i'] <= -69.0:
            raise ValueError('source too short or silent for integrated loudness')
        source_peak = oversampled_peak_db(source, ffmpeg=ffmpeg, channels=channels)
        desired = target_lufs - baseline['lufs_i']
        if baseline['true_peak_dbtp'] + desired <= peak_ceiling:
            gain, ceiling = desired, None
        else:
            ceiling = limiter_ceiling
            gain = min(desired, ceiling - source_peak + max_limiter_reduction_db)
        attempts = []
        for _ in range(6):
            measured = encode_voice(source, temporary, ffmpeg=ffmpeg, channels=channels,
                                    gain_db=gain, limiter_ceiling_db=ceiling)
            attempts.append(dict(gain_db=gain, limiter_ceiling_dbfs=ceiling, **measured))
            if measured['true_peak_dbtp'] <= peak_ceiling:
                break
            # MP3 编码后的真峰会越过限幅天花板：先压天花板保住响度，限幅量触到上界才降增益。
            adjustment = peak_ceiling - 0.1 - measured['true_peak_dbtp']
            if ceiling is None:
                ceiling = min(limiter_ceiling, source_peak + gain + adjustment)
            else:
                ceiling += adjustment
            excess = source_peak + gain - ceiling - max_limiter_reduction_db
            if excess > 0:
                gain -= excess
        else:
            raise ValueError('final MP3 true peak did not reach the ceiling')
        reduction = 0.0 if ceiling is None else max(0.0, source_peak + gain - ceiling)
        if reduction > max_limiter_reduction_db + 1e-6:
            raise ValueError('limiter reduction exceeds the approved bound')
        standard = temporary.read_bytes()
        stored = wf_assets.mp3_encode(standard)
        if wf_assets.mp3_decode(stored) != standard:
            raise ValueError('native MP3 storage roundtrip failed')
        codec = gate.probe(stored)
        container = [asdict(x) for x in gate.check_container(gate.VoiceFile(code, slot, stored), codec)]
        if container or not codec['xing'] or codec['tail'] != 0:
            raise ValueError(f'native audio container validation failed: {container}')
        before, after = amplitude(pcm(source, Path(ffmpeg))), amplitude(pcm(temporary, Path(ffmpeg)))
        delta = after['samples'] - before['samples']
        if abs(delta) > SAMPLE_DELTA_LIMIT:
            raise ValueError(f'mastering changed performance length by {delta} samples')
        if after['clipped_fraction'] > 0 or after['peak'] >= 0.999:
            raise ValueError('mastered performance clips')
        final = attempts[-1]
        if abs(final['lufs_i'] - target_lufs) <= LOUDNESS_TOLERANCE:
            loudness = 'ok'
        else:
            loudness = 'under_target' if final['lufs_i'] < target_lufs else 'over_target'
        fam = family(slot)
        _n, low, p50, p90, _p95, _p99, high = gate.OFFICIAL_DURATION[fam]
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return stored, dict(
        slot=slot, code=code, family=fam, params=MASTER_PARAMS,
        source=str(source), source_sha256=sha(source_raw), source_metadata=info,
        standard=str(target), standard_sha256=sha(standard), storage_sha256=sha(stored),
        storage_roundtrip_equal=True, codec=codec, seconds=codec['duration'],
        official_seconds=dict(min=low, p50=p50, p90=p90, max=high),
        baseline_encoded=baseline, source_oversampled_peak_dbfs=source_peak,
        desired_gain_db=desired, gain_db=gain, limiter_ceiling_dbfs=ceiling,
        limiter_reduction_bound_db=reduction, attempts=attempts, final=final, loudness_status=loudness,
        source_pcm=before, mastered_pcm=after, sample_delta=delta, sample_delta_limit=SAMPLE_DELTA_LIMIT,
        findings=duration_findings(code, slot, codec['duration']),
        no_trim_no_speed_no_concatenation=True)


def process_run(lines: list[dict], run_dir, *, ffmpeg, ffprobe) -> dict:
    """对已生成且回执校验通过的条目做后处理；qc 已存在且哈希一致即跳过（续跑）。"""
    run_dir = Path(run_dir)
    items = []
    for line in lines:
        role, slot = line['role'], line['slot']
        base = run_dir / role
        source, receipt = base / 'raw' / (slot + '.mp3'), base / 'receipts' / (slot + '.json')
        if not (source.is_file() and receipt.is_file()):
            items.append(dict(role=role, slot=slot, status='missing'))
            continue
        generated = json.loads(receipt.read_bytes())
        source_sha = sha(source.read_bytes())
        if generated.get('status') != 'generated' or generated.get('sha256') != source_sha:
            raise ValueError(f'unverified source recording: {role}:{slot}')
        if generated.get('request_fingerprint') != request_fingerprint(line):
            items.append(dict(role=role, slot=slot, status='stale_plan',
                              error='design changed after generation; regenerate in a new run'))
            continue
        target, qc = base / 'standard' / (slot + '.mp3'), base / 'qc' / (slot + '.json')
        if qc.is_file() and target.is_file():
            report = json.loads(qc.read_bytes())
            if (report.get('source_sha256') != source_sha or report.get('standard_sha256') != sha(target.read_bytes())
                    or report.get('params') != MASTER_PARAMS):
                raise ValueError(f'QC drift for {role}:{slot}; use a new run directory')
            status = 'cached'
        else:
            try:
                _stored, report = master_voice(source, target, slot=slot, code=line['code'],
                                               ffmpeg=ffmpeg, ffprobe=ffprobe)
            except (ValueError, RuntimeError) as exc:
                items.append(dict(role=role, slot=slot, status='rejected', error=str(exc)[:500]))
                continue
            _write_json(qc, report)
            status = 'mastered'
        items.append(dict(role=role, slot=slot, status=status, seconds=round(report['seconds'], 3),
                          lufs_i=report['final']['lufs_i'], true_peak_dbtp=report['final']['true_peak_dbtp'],
                          limiter=report['limiter_ceiling_dbfs'] is not None,
                          loudness_status=report['loudness_status'], findings=report['findings']))
    over_max = [x for x in items if any(f['level'] == 'error' for f in x.get('findings', []))]
    retake = [x for x in items if x['status'] in ('rejected', 'stale_plan') or x in over_max
              or x.get('loudness_status') not in (None, 'ok')]
    summary = dict(finished_at=_now(), params=MASTER_PARAMS, items=items,
                   over_official_max=[f'{x["role"]}:{x["slot"]}' for x in over_max],
                   over_official_p90=[f'{x["role"]}:{x["slot"]}' for x in items
                                      if any(f['rule'] == 'over_official_p90' for f in x.get('findings', []))],
                   retake_candidates=[f'{x["role"]}:{x["slot"]}' for x in retake])
    _write_json(run_dir / 'qc-summary.json', summary)
    return summary


# ---------------------------------------------------------------- 装包

def claim(logical: str, keys, codec: str = 'flat', root: str = 'common', inner=None) -> dict:
    """与 wf_campus_nephtim_tables.claim / manifest tables 条目同格式。"""
    return {'codec_id': codec, 'inner_keys': inner or [], 'logical_path': logical,
            'outer_keys': sorted(keys), 'root': root, 'semantic_claims': []}


def encode_flat_rows(rows: list[list[str]]) -> bytes:
    return zlib.compress(core.write_csv_lines(rows).encode('utf-8'))


def decode_flat_rows(raw: bytes) -> list[list[str]]:
    # 整段文本交给 csv.reader（引号内换行不能按物理行拆，U0000 事故）。
    return core.read_csv_lines(zlib.decompress(raw).decode('utf-8'))


def validate_voice_plan(role: str, lines: list[dict]) -> dict[str, dict]:
    by_slot = {}
    for line in lines:
        if line.get('role') != role:
            raise ValueError('voice plan mixes roles')
        slot = normalize_slot(line.get('slot'))
        if slot in by_slot:
            raise ValueError(f'duplicate voice slot {slot}')
        if not line.get('ja') or not line.get('zh'):
            raise ValueError(f'{slot} requires ja and zh')
        by_slot[slot] = line
    if set(by_slot) != set(SLOTS):
        raise ValueError('pack requires the full 22-slot set; missing ' +
                         ', '.join(s for s in SLOTS if s not in by_slot))
    if any(gate.engine_reachable(list(SLOTS)).values()):
        raise AssertionError('slot table contains unreachable numbered voices')
    return by_slot


def speech_rows(lines: list[dict]) -> list[list[str]]:
    """character_speech 8 行：home_0..5（kind0 constraint 2）+ join（kind2）+ evolution（kind1 evo 1）。"""
    by_slot = {line['slot']: line for line in lines}
    rows = [['0', '2', '', by_slot[slot]['zh'], slot] for slot in HOME_SLOTS]
    rows.append(['2', '', '', by_slot['ally/join']['zh'], 'ally/join'])
    rows.append(['1', '', '1', by_slot['ally/evolution']['zh'], 'ally/evolution'])
    for row in rows:
        check_subtitle(row[3])
        if '\r' in row[3]:
            raise ValueError('subtitle contains carriage return')
    home = [row[1] for row in rows if row[0] == '0']
    # ClientError 2265：每个进化档可见 home ≥1，且 join 与 evo_level=1 的 evolution 各一行。
    if not any(c in ('0', '2') for c in home) or not any(c in ('1', '2') for c in home):
        raise AssertionError('speech rows would raise ClientError 2265')
    return rows


def route_character_row(row: list[str], route_cols: list[str], code: str) -> list[str]:
    if len(row) < 17 or row[0] != code or row[8] != code:
        raise ValueError('character/action identity mismatch')
    if row[9] != '(None)':
        if row[9:17] != route_cols:
            raise ValueError('refuse to replace an existing unrelated skill switch')
    elif any(row[10:17]):
        raise ValueError('unreviewed residual skill switch columns')
    output = deepcopy(row)
    output[9:17] = route_cols
    return output


def switched_rows(action_rows: dict) -> dict[str, list[str]]:
    """SwitchedActionSkillValues = ActionSkillValues 第 7–23 列（程序路径 + 自动放技能条件）。"""
    if set(action_rows) != {'1', '2'}:
        raise ValueError('expected both native evolution levels 1 and 2')
    output = {}
    for level in ('1', '2'):
        row = action_rows[level]
        if len(row) != 24:
            raise ValueError('unreviewed ActionSkillValues schema')
        output[level] = list(row[7:24])
    return output


def _package_dir(package, cid: str, code: str) -> Path:
    package = Path(package).resolve()
    if 'character_packs' not in package.parts:
        raise ValueError('voice packing requires a candidate under work/character_packs')
    for item in (package, *package.parents):
        if item.is_symlink() or getattr(item, 'is_junction', lambda: False)():
            raise ValueError('candidate package has a reparse component')
    for marker in (package / 'manifest.json', package.parent / 'workspace.json'):
        if marker.is_file():
            data = json.loads(marker.read_bytes())
            if (str(data.get('character_id')), data.get('code_name')) != (cid, code):
                raise ValueError(f'package identity differs from {cid}/{code}: {marker}')
    return package


def _safe_path(package: Path, root: str, logical: str) -> Path:
    if root not in ('common', 'server'):
        raise ValueError('unsupported candidate root')
    parts = logical.split('/')
    if '\\' in logical or ':' in logical or any(p in ('', '.', '..') for p in parts):
        raise ValueError(f'unsafe logical path: {logical!r}')
    base = (package / 'roots' / root).resolve()
    path = (base / Path(*parts)).resolve()
    if not path.is_relative_to(base):
        raise ValueError('candidate path escapes package root')
    return path


def _package_table(package: Path, logical: str) -> dict[str, bytes]:
    raw = _safe_path(package, 'common', logical).read_bytes()
    table = core.read_orderedmap_raw_rows_from_bytes(raw, logical)
    return dict(zip(table.keys, table.rows))


def read_package_character_row(package, cid: str) -> list[str]:
    rows = decode_flat_rows(_package_table(Path(package), CHARACTER_TABLE)[cid])
    if len(rows) != 1:
        raise ValueError('unreviewed CharacterValues row count')
    return rows[0]


def read_package_action_rows(package, code: str) -> dict[str, list[str]]:
    return dict(core.decode_action_skill_row(_package_table(Path(package), ACTION_TABLE)[code]))


def _standard_bytes(standard, slot: str) -> bytes:
    if callable(standard):
        return standard(slot)
    if isinstance(standard, dict):
        return standard[slot]
    return (Path(standard) / (slot + '.mp3')).read_bytes()


DURATION_RULES = frozenset({'over_official_max', 'over_official_p90', 'below_official_min'})


def pack_voice(package, role: str, lines: list[dict], standard, *, route, character_row=None,
               action_rows=None, mirror_row=None, exclude_rules: str | None = None,
               replace: bool = False, write: bool = True) -> dict:
    """写 roots/common/character/<code>/voice/<slot>.mp3（存储态）并返回表行与 claims。

    standard：标准态 MP3 目录、{slot: bytes} 或 callable(slot)->bytes。
    character_row/action_rows 缺省时读 package 内候选表（由表构建步骤先写好）。
    表文件不在这里改；需要落表时调用 apply_package_tables。
    """
    if role not in ROLES:
        raise ValueError(f'unknown role {role!r}')
    cid, code = ROLES[role]['cid'], ROLES[role]['code']
    by_slot = validate_voice_plan(role, lines)
    package = _package_dir(package, cid, code)
    if exclude_rules is not None:
        if any(not token for token in exclude_rules.split('|')):
            raise ValueError('empty character_voice_exclude token silences every voice')
        blocked = [s for s in SLOTS if native_excluded(f'character/{code}/voice/{s}', exclude_rules)]
        if blocked:
            raise ValueError(f'character_voice_exclude blocks {code}: {blocked[:3]}')
    route_cols = normalize_route(route, code)
    if character_row is None:
        character_row = read_package_character_row(package, cid)
    if action_rows is None:
        action_rows = read_package_action_rows(package, code)

    voices, findings = [], []
    for slot in SLOTS:
        standard_raw = _standard_bytes(standard, slot)
        stored = wf_assets.mp3_encode(standard_raw)
        if wf_assets.mp3_decode(stored) != standard_raw:
            raise ValueError(f'native MP3 storage roundtrip failed: {slot}')
        voices.append(gate.VoiceFile(code, slot, stored))
        findings += duration_findings(code, slot, gate.probe(stored)['duration'])
    findings += [asdict(f) for f in gate.check_voice_set(voices) if f.rule not in DURATION_RULES]
    errors = [f for f in findings if f['level'] == 'error']
    if errors:
        raise ValueError(f'voice gate failed: {errors}')

    assets, pending = [], []
    for voice in voices:
        logical = f'character/{code}/voice/{voice.slot}.mp3'
        path = _safe_path(package, 'common', logical)
        state = 'new'
        if path.is_file():
            if path.read_bytes() == voice.data:
                state = 'unchanged'
            elif not replace:
                raise ValueError(f'existing candidate voice differs (pass replace=True): {logical}')
            else:
                state = 'replaced'
        assets.append(dict(root='common', logical_path=logical, sha256=sha(voice.data),
                           size=len(voice.data), state=state))
        if state != 'unchanged':
            pending.append((path, voice.data))
    voice_root = _safe_path(package, 'common', f'character/{code}/voice')
    planned = {f'character/{code}/voice/{s}.mp3' for s in SLOTS}
    foreign = sorted(p.relative_to(package / 'roots' / 'common').as_posix() for p in voice_root.rglob('*')
                     if p.is_file()) if voice_root.is_dir() else []
    foreign = [p for p in foreign if p not in planned]
    if write:
        for path, data in pending:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            if path.read_bytes() != data:
                raise OSError(f'candidate voice readback failed: {path}')

    speech = speech_rows([by_slot[s] for s in SLOTS])
    character = route_character_row(character_row, route_cols, code)
    switched = switched_rows(action_rows)
    key = switch_key(code)
    table_rows = {
        CHARACTER_TABLE: {cid: encode_flat_rows([character])},
        SPEECH_TABLE: {cid: encode_flat_rows(speech)},
        SWITCH_TABLE: {key: core.encode_action_skill_row([(level, switched[level]) for level in ('1', '2')])},
    }
    claims = [claim(CHARACTER_TABLE, [cid]), claim(SPEECH_TABLE, [cid]),
              claim(SWITCH_TABLE, [key], codec='switched_nested', inner=[dict(keys=['1', '2'], outer_key=key)])]
    server_rows = {}
    if mirror_row is not None:
        mirror = deepcopy(mirror_row)
        if len(mirror) != 1 or mirror[0][0] != code:
            raise ValueError('server character mirror identity mismatch')
        mirror[0] = route_character_row(mirror[0], route_cols, code)
        server_rows = {SERVER_CHARACTER: {cid: mirror}}
        claims.append(claim(SERVER_CHARACTER, [cid], codec='json_object', root='server'))
    return dict(role=role, character_id=cid, code=code, written=write, writes_live=False,
                assets=assets, foreign_voice_files=foreign, findings=findings,
                rows=dict(speech=speech, character=[character], route=route_cols, switched=switched),
                table_rows=table_rows, server_rows=server_rows, claims=claims,
                metadata=dict(voice_count=len(voices), language='ja', home_ally_subtitles='zh-CN',
                              battle_subtitles='delivery manifest only', switched_key=key,
                              route_kind={'0': 'HpHigh', '1': 'ConditionExist', '3': 'ChangeSkillFlag'}[route_cols[0]],
                              suggested_voice_actor=VOICE_ACTOR, new_client_capabilities=[]))


def splice_table(raw: bytes, logical: str, rows: dict[str, bytes]) -> bytes:
    """只替换/追加自有外层键；其他键字节不变。"""
    table = core.read_orderedmap_raw_rows_from_bytes(raw, logical)
    prior = dict(zip(table.keys, table.rows))
    for key, value in rows.items():
        if key in prior:
            table.rows[table.keys.index(key)] = value
        else:
            table.keys.append(key)
            table.rows.append(value)
    output = core.build_orderedmap_raw_rows(table)
    check = core.read_orderedmap_raw_rows_from_bytes(output, logical)
    after = dict(zip(check.keys, check.rows))
    if any(after.get(k) != v for k, v in prior.items() if k not in rows) or \
            any(after.get(k) != v for k, v in rows.items()):
        raise AssertionError(f'foreign table row changed: {logical}')
    return output


def apply_package_tables(package, result: dict) -> list[dict]:
    """把 pack_voice 的表行拼进候选包已有表文件（不从 live 新建表）。"""
    from wf_content_revision_patch import merge_json
    package = _package_dir(package, result['character_id'], result['code'])
    report = []
    for logical, rows in result['table_rows'].items():
        path = _safe_path(package, 'common', logical)
        if not path.is_file():
            raise FileNotFoundError(f'candidate table missing; build tables first: {logical}')
        before = path.read_bytes()
        after = splice_table(before, logical, rows)
        report.append(dict(root='common', logical_path=logical, before_sha256=sha(before),
                           after_sha256=sha(after), size=len(after), changed=after != before))
        if after != before:
            path.write_bytes(after)
    for logical, rows in result['server_rows'].items():
        path = _safe_path(package, 'server', logical)
        before = path.read_bytes()
        target = json.loads(before)
        target.update(rows)
        after = merge_json(before, json.dumps(target, ensure_ascii=False).encode('utf-8'), set(rows))[0]
        report.append(dict(root='server', logical_path=logical, before_sha256=sha(before),
                           after_sha256=sha(after), size=len(after), changed=after != before))
        if after != before:
            path.write_bytes(after)
    return report


# ---------------------------------------------------------------- 参考音频

def choose_reference(candidates, render, low: float, high: float):
    """render(code, slot) -> (temp_path, info)；返回 (选中项, info, rejected)。"""
    rejected = []
    for code, slot in candidates:
        path, info = render(code, slot)
        seconds = info['duration_seconds']
        if low <= seconds <= high:
            return (code, slot), path, info, rejected
        rejected.append(dict(source_logical=f'character/{code}/voice/{slot}.mp3', clean_seconds=seconds,
                             reason=f'cleaned duration outside {low}-{high}s'))
        Path(path).unlink(missing_ok=True)
    raise ValueError('no reference candidate within the duration range')


def official_voice(baseline, code: str, slot: str) -> dict:
    logical = f'character/{code}/voice/{slot}.mp3'
    digest = core.sha1_path(logical)
    rel = digest[:2] + '/' + digest[2:]
    roots = [r for r in ('common', 'medium', 'android') if baseline.identity(r, rel) is not None]
    if len(roots) != 1:
        raise ValueError(f'official voice must have one authoritative root: {logical}: {roots}')
    stored = baseline.get(roots[0], rel)
    return dict(logical=logical, root=roots[0], stored=stored, standard=wf_assets.mp3_decode(stored))


def clean_reference(standard: bytes, target: Path, *, ffmpeg) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg(ffmpeg, ['-v', 'error', '-y', '-f', 'mp3', '-i', 'pipe:0', '-map_metadata', '-1', '-af', REF_FILTERS,
                     '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', str(target)], input=standard)
    with wave.open(str(target), 'rb') as handle:
        info = dict(channels=handle.getnchannels(), sample_rate=handle.getframerate(),
                    sample_width=handle.getsampwidth(), frames=handle.getnframes())
    info['duration_seconds'] = round(info['frames'] / info['sample_rate'], 3)
    if (info['channels'], info['sample_rate'], info['sample_width']) != (1, 48000, 2):
        raise ValueError('reference is not 48 kHz mono 16-bit PCM')
    return info


def build_references(roles, *, out_dir=REFS_DIR, ffmpeg=None, baseline=None) -> dict:
    """官方归档（.cdn/cn OfficialBaseline）取母本原声 → 清洗 WAV → refs.json。"""
    from wf_enhancement_policy import OfficialBaseline
    ffmpeg = ffmpeg or find_tool('ffmpeg')
    out_dir = Path(out_dir)
    baseline = baseline or OfficialBaseline(ROOT / '.cdn' / 'cn',
                                            cache_dir=ROOT / 'mod-tools' / 'work' / 'official-baseline',
                                            write_cache=False)
    index_path = out_dir / 'refs.json'
    index = json.loads(index_path.read_bytes()) if index_path.is_file() else dict(schema=1, roles={})
    for role in roles:
        info = ROLES[role]
        entries = []
        for kind in ('battle', 'home'):
            low, high = REF_RANGES[kind]
            sources = {}

            def render(code, slot, kind=kind):
                voice = official_voice(baseline, code, slot)
                sources[(code, slot)] = voice
                temp = out_dir / role / f'{kind}.candidate.wav'
                return temp, clean_reference(voice['standard'], temp, ffmpeg=ffmpeg)

            (code, slot), temp, wav, rejected = choose_reference(REF_CANDIDATES[role][kind], render, low, high)
            final = out_dir / role / f'{kind}.wav'
            Path(temp).replace(final)
            voice = sources[(code, slot)]
            loudness = measure(final, Path(ffmpeg))
            entries.append(dict(kind=kind, path=str(final), sha256=sha(final.read_bytes()),
                                source_logical=voice['logical'], source_root=voice['root'],
                                source_code=code, source_slot=slot,
                                source_stored_sha256=sha(voice['stored']),
                                source_standard_sha256=sha(voice['standard']),
                                source_seconds=round(gate.probe(voice['stored'])['duration'], 3),
                                cleaning=REF_FILTERS, clean_lufs_i=loudness['lufs_i'], clean_lra_lu=loudness['lra_lu'],
                                range_seconds=[low, high], rejected=rejected, **wav))
        index['roles'][role] = dict(character_id=info['cid'], code=info['code'],
                                    template_id=info['template_id'], template_code=info['template_code'],
                                    references=entries, note=REF_NOTES.get(role, ''))
    index.update(schema=1, updated_at=_now(), source='OfficialBaseline .cdn/cn official archive',
                 official_tail=getattr(baseline, 'official_tail', None),
                 usage='官方声优原声做音色参考 = 克隆真人声纹；仅限本机自用，对外分发前须作者另行拍板（mech_voice.md §3.4）')
    _write_json(index_path, index)
    return index


# ---------------------------------------------------------------- 冒烟

class _CapturingResponse:
    def __init__(self, response, sink):
        self._response, self._sink = response, sink
        self.status = response.status

    def __enter__(self):
        self._response.__enter__()
        return self

    def __exit__(self, *exc):
        return self._response.__exit__(*exc)

    def read(self, *args):
        data = self._response.read(*args)
        self._sink['http_status'] = self.status
        self._sink['headers'] = {h: self._response.headers.get(h) for h in ('Content-Type', 'X-Tt-Logid')}
        self._sink['response_bytes'] = len(data)
        try:
            body = json.loads(data)
        except ValueError:
            self._sink['fields'] = 'non-json body'
            return data
        self._sink['fields'] = {k: _describe(v) for k, v in body.items()} if isinstance(body, dict) else type(body).__name__
        return data


def _describe(value):
    if isinstance(value, str):
        return dict(type='str', length=len(value))
    if isinstance(value, dict):
        return dict(type='dict', keys=sorted(value)[:20],
                    sentences=len(value['sentences']) if isinstance(value.get('sentences'), list) else None)
    if isinstance(value, list):
        return dict(type='list', length=len(value))
    return dict(type=type(value).__name__, value=value if isinstance(value, (int, float, bool)) or value is None else None)


def capturing_opener(sink: dict, opener=urllib.request.urlopen):
    def open_request(request, **kwargs):
        return _CapturingResponse(opener(request, **kwargs), sink)
    return open_request


def run_smoke(key: str, *, out_dir=SMOKE_DIR, refs_index=None, opener=urllib.request.urlopen) -> dict:
    """只发 1 个请求（不自动重试）：生成 → 后处理 → mp3_encode/voice_gate 全链路。"""
    out_dir = Path(out_dir)
    ffmpeg, ffprobe = find_tool('ffmpeg'), find_tool('ffprobe')
    voice = dict(persona=SMOKE_LINE['persona'], references=None,
                 lines=[{k: SMOKE_LINE[k] for k in ('slot', 'ja', 'zh', 'direction')}])
    line = request_lines(SMOKE_LINE['role'], voice, refs_index=refs_index, allow_partial=True)[0]
    report_path = out_dir / 'report.json'
    previous = json.loads(report_path.read_bytes()) if report_path.is_file() else {}
    sink = {}
    started = time.monotonic()
    result = generate_line(line, out_dir, key, opener=capturing_opener(sink, opener), max_retries=0)
    elapsed = round(time.monotonic() - started, 2)
    report = dict(started_at=_now(), endpoint=api.ENDPOINT, model=api.MODEL, request=dict(
        role=line['role'], slot=line['slot'], ja=line['ja'], zh=line['zh'], direction=line['direction'],
        references=[dict(path=r['path'], sha256=r['sha256']) for r in line['references']]),
        generation=result, wall_seconds=elapsed, response=sink)
    if result['status'] == 'cached' and previous.get('response'):
        # 续跑不再联网：保留首个真实请求的耗时与返回字段形状。
        report.update(first_request=previous.get('first_request') or dict(
            started_at=previous.get('started_at'), wall_seconds=previous.get('wall_seconds'),
            generation=previous.get('generation'), response=previous.get('response')))
    base = out_dir / line['role']
    if result['status'] in ('generated', 'cached'):
        receipt = json.loads((base / 'receipts' / (line['slot'] + '.json')).read_bytes())
        report['receipt'] = {k: receipt.get(k) for k in ('request_id', 'http_status', 'elapsed_seconds',
                                                         'bytes', 'sha256', 'response')}
        raw = base / 'raw' / (line['slot'] + '.mp3')
        report['raw_metadata'] = metadata(raw, ffprobe)
        target = base / 'standard' / (line['slot'] + '.mp3')
        if target.exists():
            target.unlink()
        stored, qc = master_voice(raw, target, slot=line['slot'], code=line['code'], ffmpeg=ffmpeg, ffprobe=ffprobe)
        _write_json(base / 'qc' / (line['slot'] + '.json'), qc)
        gate_findings = [asdict(f) for f in gate.check_voice_set([gate.VoiceFile(line['code'], line['slot'], stored)])]
        report['postprocess'] = dict(
            seconds=qc['seconds'], final=qc['final'], loudness_status=qc['loudness_status'],
            limiter_used=qc['limiter_ceiling_dbfs'] is not None, gain_db=round(qc['gain_db'], 3),
            codec={k: qc['codec'][k] for k in ('srate', 'channels', 'bitrate', 'cbr', 'xing', 'tail', 'obfuscated')},
            mp3_encode_strict=True, storage_roundtrip_equal=qc['storage_roundtrip_equal'],
            storage_sha256=qc['storage_sha256'], sample_delta=qc['sample_delta'],
            duration_findings=qc['findings'], voice_gate=gate_findings,
            leading_quiet_seconds=round(qc['mastered_pcm']['leading_quiet_seconds'], 3),
            trailing_quiet_seconds=round(qc['mastered_pcm']['trailing_quiet_seconds'], 3))
    _write_json(report_path, report)
    leaked = scrub_secret(out_dir, key)
    if leaked:
        raise RuntimeError('credential text was found and redacted in smoke output')
    return report


# ---------------------------------------------------------------- CLI

def _output_dir(path) -> Path:
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(VOICE_DIR.resolve()):
        raise SystemExit('output outside the seasonal7 voice workspace')
    return resolved


def _child_argv(argv: list[str]) -> list[str]:
    output, skip = [], False
    for token in argv:
        if skip:
            skip = False
            continue
        if token == '--key-file':
            skip = True
            continue
        if token.startswith('--key-file='):
            continue
        output.append(token)
    return output


def child_env(key_file) -> dict:
    """读密钥文件，返回注入了 WF_SEED_AUDIO_KEY 的子进程环境（调用方不得打印）。"""
    key = Path(key_file).read_text(encoding='utf-8').strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit('credential file is empty or malformed')
    env = dict(os.environ)
    env[KEY_ENV] = key
    return env


def _take_key() -> str:
    key = os.environ.pop(KEY_ENV, '')
    if not key:
        raise SystemExit(f'missing process credential; pass --key-file (injected as {KEY_ENV})')
    return key


def _roles(values) -> list[str]:
    roles = values or list(ROLES)
    unknown = [r for r in roles if r not in ROLES]
    if unknown:
        raise SystemExit(f'unknown roles: {unknown}')
    return roles


def _plans(args) -> list[dict]:
    plans = []
    for role in _roles(args.roles):
        design = Path(args.design) if getattr(args, 'design', None) else None
        plans.append(plan_role(role, design))
    return plans


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('refs', help='准备 7 个母本的清洗参考 WAV 与 refs.json')
    p.add_argument('--roles', nargs='*')

    for name, text in (('plan', '校验 design 并写请求快照（不联网）'), ('generate', '调用 Seed Audio 生成'),
                       ('process', '后处理到 -14 LUFS 标准 MP3 与 QC'), ('pack', '装包（默认 dry-run）')):
        p = sub.add_parser(name, help=text)
        p.add_argument('--roles', nargs='*')
        p.add_argument('--design', help='单角色时覆盖 design json 路径')
        p.add_argument('--run', default='take1', help='generation/<run> 目录；重录换新 run')
        if name == 'generate':
            p.add_argument('--only', action='append', default=[], help='role:slot，可重复')
            p.add_argument('--workers', type=int, choices=(1, 2), default=2)
            p.add_argument('--no-retry', action='store_true', help='本次不自动重试')
            p.add_argument('--key-file', help='读取后注入子进程环境变量')
        if name == 'pack':
            p.add_argument('--package', required=True, help='work/character_packs/<pkg>/package')
            p.add_argument('--write', action='store_true', help='写存储态 MP3')
            p.add_argument('--apply-tables', action='store_true', help='同时把表行拼进候选包已有表')
            p.add_argument('--replace', action='store_true')

    p = sub.add_parser('smoke', help='单请求冒烟：生成 → 后处理 → mp3_encode')
    p.add_argument('--key-file', help='读取后注入子进程环境变量')
    args = parser.parse_args(argv)

    if getattr(args, 'key_file', None):
        env = child_env(args.key_file)
        return subprocess.run([sys.executable, str(Path(__file__).resolve()), *_child_argv(argv)], env=env).returncode

    if args.command == 'refs':
        index = build_references(_roles(args.roles))
        print(json.dumps({role: [(e['kind'], e['source_logical'], e['duration_seconds']) for e in item['references']]
                          for role, item in index['roles'].items()}, ensure_ascii=False, indent=1))
        return 0
    if args.command == 'smoke':
        key = _take_key()
        report = run_smoke(key)
        print(json.dumps(dict(status=report['generation']['status'], wall_seconds=report['wall_seconds'],
                              fields=report['response'].get('fields'), postprocess=report.get('postprocess')),
                         ensure_ascii=False, indent=1))
        return 0 if report['generation']['status'] in ('generated', 'cached') else 1

    run_dir = _output_dir(GENERATION_DIR / args.run)
    plans = _plans(args)
    if args.command == 'plan':
        for plan in plans:
            for line in plan['lines']:
                api.payload(line)   # 引用哈希与 payload 可构造
            _write_json(run_dir / 'plan' / f'{plan["role"]}.json',
                        dict(plan, planned_at=_now(), fingerprints={l['slot']: request_fingerprint(l) for l in plan['lines']}))
            print(json.dumps(dict(role=plan['role'], lines=len(plan['lines']), route=plan['route']), ensure_ascii=False))
        return 0
    if args.command == 'generate':
        key = _take_key()
        lines = [line for plan in plans for line in plan['lines']]
        if args.only:
            lines = [x for x in lines if f'{x["role"]}:{x["slot"]}' in args.only]
        if not lines:
            raise SystemExit('empty generation selection')
        for plan in plans:
            _write_json(run_dir / 'plan' / f'{plan["role"]}.json', dict(plan, planned_at=_now()))
        summary = run_generation(lines, run_dir, key, workers=args.workers,
                                 max_retries=0 if args.no_retry else MAX_AUTO_RETRIES,
                                 on_result=lambda r: print(json.dumps(r, ensure_ascii=False), flush=True))
        print(json.dumps(dict(counts=summary['counts'], rewrite_queue=summary['rewrite_queue']), ensure_ascii=False))
        return 0 if set(summary['counts']) <= {'generated', 'cached'} else 1
    if args.command == 'process':
        lines = [line for plan in plans for line in plan['lines']]
        summary = process_run(lines, run_dir, ffmpeg=find_tool('ffmpeg'), ffprobe=find_tool('ffprobe'))
        print(json.dumps({k: summary[k] for k in ('over_official_max', 'over_official_p90', 'retake_candidates')},
                         ensure_ascii=False, indent=1))
        return 0
    if args.command == 'pack':
        if len(plans) != 1:
            raise SystemExit('pack one role at a time')
        plan = plans[0]
        role = plan['role']
        standard_dir = run_dir / role / 'standard'
        for slot in SLOTS:
            qc = json.loads((run_dir / role / 'qc' / (slot + '.json')).read_bytes())
            if qc['standard_sha256'] != sha((standard_dir / (slot + '.mp3')).read_bytes()):
                raise SystemExit(f'standard recording drifted from QC: {slot}')
        package = Path(args.package)
        mirror_path = package / 'roots' / 'server' / SERVER_CHARACTER
        mirror = json.loads(mirror_path.read_bytes()).get(ROLES[role]['cid']) if mirror_path.is_file() else None
        result = pack_voice(package, role, plan['lines'], standard_dir, route=plan['route'],
                            mirror_row=mirror, replace=args.replace, write=args.write)
        tables = apply_package_tables(package, result) if args.apply_tables and args.write else []
        record = {k: v for k, v in result.items() if k != 'table_rows'}
        record['table_rows_sha256'] = {logical: {key: sha(raw) for key, raw in rows.items()}
                                       for logical, rows in result['table_rows'].items()}
        record['applied_tables'] = tables
        _write_json(run_dir / role / 'pack-result.json', record)
        print(json.dumps(dict(role=role, written=args.write, assets=len(result['assets']),
                              foreign_voice_files=result['foreign_voice_files'], claims=result['claims'],
                              applied_tables=tables), ensure_ascii=False, indent=1))
        return 0
    return 2


if __name__ == '__main__':
    sys.exit(main())
