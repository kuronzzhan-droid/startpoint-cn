"""Prepare a lossless union of the two seasonal-seven voice deliveries.

Writes an external review/overlay directory only. Existing package, live store,
CDN and device are read-only. Fixed-slot alternatives need the companion client
patch; a prepared overlay is never reported as installed.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path

import wf_assets
import wf_mod_tool as core
import wf_seasonal7_specs as specs
import wf_seasonal7_voice as voice
import wf_voice_gate as gate

NUMBERED = {'battle_start': 2, 'skill': 4, 'power_flip': 2, 'outhole': 2, 'win': 2}
FIXED = {'battle/skill_ready', 'battle/matched_skill_ready', 'ally/join', 'ally/evolution'}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def remap_slot(slot: str) -> str:
    if slot in FIXED:
        return slot + '_alt'
    group, name = slot.split('/')
    family, number = name.rsplit('_', 1)
    count = 6 if group == 'home' and family == 'home' else NUMBERED.get(family)
    if count is None or not number.isdigit() or not 0 <= int(number) < count:
        raise ValueError('unknown source slot: ' + slot)
    return f'{group}/{family}_{int(number) + count}'


def merge_speech(original: list[list[str]], added: list[dict]) -> list[list[str]]:
    """Keep native kinds/conditions and pair each new audio with its own subtitle."""
    rows = [list(r) for r in original]
    for line in added:
        if line['slot'].split('/')[0] not in ('home', 'ally'):
            continue
        donor = [r for r in original if r[4] == line['slot']]
        if len(donor) != 1:
            raise ValueError('speech donor missing/ambiguous: ' + line['slot'])
        row = list(donor[0])
        row[3], row[4] = line['zh'], remap_slot(line['slot'])
        rows.append(row)
    refs = [r[4] for r in rows]
    if len(refs) != len(set(refs)):
        raise ValueError('duplicate speech reference')
    return rows


def validate_mp3(raw: bytes, label: str) -> dict:
    p = gate.probe(raw)
    if not p['ok'] or not p['cbr'] or p['tail'] or p['obfuscated']:
        raise ValueError('invalid standard MP3: ' + label)
    if p['srate'] != [44100] or p['channels'] != [1] or p['bitrate'] != [96]:
        raise ValueError('unexpected MP3 format: ' + label)
    stored = wf_assets.mp3_encode(raw)
    if wf_assets.mp3_decode(stored) != raw:
        raise ValueError('MP3 storage roundtrip failed: ' + label)
    return p


def prepare(repo: Path, delivery: Path, output: Path) -> dict:
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('output must be empty; never overwrite a previous union')
    index = json.loads((delivery / '交付/最终素材清单.json').read_text(encoding='utf-8-sig'))
    audio = index['audio']
    if len(audio) != 154:
        raise ValueError('expected 154 Codex production recordings')
    output.mkdir(parents=True, exist_ok=True)
    entries, roles, table_plans = [], [], []
    for role in specs.all_keys():
        spec = specs.get_spec(role)
        package = repo / spec.workspace / 'package'
        candidates = [p for p in (repo / specs.BATCH_DIR / 'voice/generation').glob(f'*/{role}/pack-result.json')]
        current = package / 'roots/common/character' / spec.code / 'voice'
        matches = []
        for path in candidates:
            rec = json.loads(path.read_text(encoding='utf-8'))
            if all((package/'roots'/a['root']/a['logical_path']).is_file() and
                   sha((package/'roots'/a['root']/a['logical_path']).read_bytes()) == a['sha256']
                   for a in rec['assets']):
                matches.append((path, rec))
        if len(matches) != 1:
            raise ValueError(f'{role}: no unique verified Claude pack receipt')
        receipt_path, receipt = matches[0]
        added = [r for r in audio if r['role'] == role]
        if {r['slot'] for r in added} != set(voice.SLOTS) or len(added) != 22:
            raise ValueError(f'{role}: Codex slot coverage differs')
        if any(str(r['character_id']) != spec.cid_s or r['code'] != spec.code for r in added):
            raise ValueError(f'{role}: identity mismatch')
        plan_path = receipt_path.parent.parent/'plan'/f'{role}.json'
        claude_plan = {r['slot']: r for r in json.loads(plan_path.read_text(encoding='utf-8'))['lines']}
        for source, rows in [('claude', [claude_plan[s] for s in voice.SLOTS]), ('codex', added)]:
            for row in rows:
                slot = row['slot']
                target = slot if source == 'claude' else remap_slot(slot)
                src = current / (slot+'.mp3') if source == 'claude' else Path(row['production_file'])
                source_bytes = src.read_bytes()
                raw = wf_assets.mp3_decode(source_bytes) if source == 'claude' else source_bytes
                expected = row.get('production_sha256')
                if source == 'codex' and sha(raw) != expected:
                    raise ValueError('Codex production hash changed: '+str(src))
                info = validate_mp3(raw, f'{role}/{source}/{slot}')
                standard_rel = Path('audio') / spec.code / (target+'.mp3')
                logical = f'character/{spec.code}/voice/{target}.mp3'
                stored_rel = Path('overlay/roots/common') / logical
                for rel, content in [(standard_rel, raw), (stored_rel, wf_assets.mp3_encode(raw))]:
                    dest = output / rel
                    if dest.exists():
                        raise ValueError('target collision: '+str(rel))
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(content)
                entries.append(dict(role=role, character_id=spec.cid, code=spec.code, source=source,
                    source_file=str(src), source_sha256=sha(source_bytes), slot=slot, target_slot=target,
                    standard_file=standard_rel.as_posix(), logical_path=logical, sha256=sha(raw),
                    stored_sha256=sha(wf_assets.mp3_encode(raw)), duration=info['duration'],
                    ja=row.get('ja',''), zh=row['zh'],
                    requires_client_patch=source == 'codex' and slot in FIXED))
        speech_path = package/'roots/common'/voice.SPEECH_TABLE
        before_raw = speech_path.read_bytes()
        before = core.read_orderedmap_file_from_bytes(before_raw)
        old_rows = core.read_csv_lines(before[spec.cid_s])
        merged = merge_speech(old_rows, added)
        table_plans.append(dict(role=role, character_id=spec.cid, table=voice.SPEECH_TABLE,
            source_file=str(speech_path), source_table_sha256=sha(before_raw),
            before_rows=old_rows, after_rows=merged, foreign_keys_unchanged=True))
        roles.append(dict(role=role, name=added[0]['name'], character_id=spec.cid, code=spec.code,
            claude=22, codex=22, total=44, speech_rows=len(merged), receipt=str(receipt_path)))
    result = dict(schema='seasonal7-voice-union/1', installed=False, live_writes=False,
        client_capability='seasonal7-voice-union-v1', total_audio=len(entries), roles=roles,
        audio=entries, table_patches=table_plans)
    (output/'合并清单.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    write_gallery(output, result)
    return result


def write_gallery(output: Path, result: dict) -> None:
    esc = html.escape
    sections = []
    for role in result['roles']:
        rows=[]
        for slot in voice.SLOTS:
            cells=[]
            for source in ['claude','codex']:
                e=next(e for e in result['audio'] if e['role']==role['role'] and e['slot']==slot and e['source']==source)
                cells.append(f'<td><audio controls preload="none" src="{esc(e["standard_file"])}"></audio>'
                    f'<p>{esc(e["ja"])}</p><p>{esc(e["zh"])}</p><small>{esc(e["target_slot"])}</small></td>')
            rows.append(f'<tr><th>{esc(slot)}</th>'+''.join(cells)+'</tr>')
        sections.append(f'<details><summary>{esc(role["name"])} · 22＋22＝44条</summary>'
            '<table><tr><th>触发槽</th><th>Claude 版</th><th>Codex 版</th></tr>'+''.join(rows)+'</table></details>')
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>七角色双版本语音合并</title>
<style>body{max-width:1180px;margin:32px auto;background:#eef2f7;color:#20324a;font:16px/1.6 "Microsoft YaHei"}details{background:white;margin:20px 0;padding:20px;border-radius:12px}summary{font-size:21px;cursor:pointer}table{width:100%;table-layout:fixed;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #ddd;vertical-align:top}th:first-child{width:170px}audio{max-width:100%}small{color:#65758c}p{white-space:pre-line}</style>
<h1>七角色双版本语音合并</h1><p>两边全部保留：每角色44条，共308条。独立候选随机播放，不串成长音频。
技能发动、开战、强力弹射、掉落、胜利和主页台词使用原生多语音机制。
准备、加入和同等级觉醒的第二版需要额外随机路由；原生客户端仍播放这些槽位的第一版。
本目录为合并候选，尚未发布或安装。</p>'''+''.join(sections)+'</html>'
    (output/'合并试听.html').write_text(page,encoding='utf-8')


if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    ap.add_argument('--delivery',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    result=prepare(args.repo,args.delivery,args.output)
    print(json.dumps({'total_audio':result['total_audio'],'roles':result['roles'],'installed':False},ensure_ascii=False))
