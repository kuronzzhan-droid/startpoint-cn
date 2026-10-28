"""离线读取 run3-v35r 证据；仅在本脚本所在 run20 输出可复现报告。"""
import copy
import hashlib
import json
import math
from collections import Counter, defaultdict, deque
from pathlib import Path

OUT = Path(__file__).resolve().parent
SOURCE = Path(r'<WORKDIR>\outputs\work\coop-desync-20261021\evidence\run3-v35r')
BASELINE = OUT.parent / 'run18'


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def size(value):
    return len(compact(value).encode('utf-8'))


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]


def summary(values):
    values = sorted(values)
    if not values:
        return {'count': 0}
    return {'count': len(values), 'min': values[0], 'mean': round(sum(values) / len(values), 3),
            'p95': values[math.ceil(len(values) * .95) - 1], 'max': values[-1]}


def rolling_max(entries):
    active, total, maximum = deque(), 0, 0
    for stamp, byte_count in sorted(entries):
        while active and stamp - active[0][0] >= 1000:
            total -= active.popleft()[1]
        active.append((stamp, byte_count))
        total += byte_count
        maximum = max(maximum, total)
    return maximum


def bad_autoplayer(row):
    return any(item.get('path') == '/rng/autoplayer' and item.get('reason') == 'rng_type'
               for item in row.get('unsupported', []))


def solo_wire(row, payload, build):
    clone = copy.deepcopy(row)
    if build == 'v35s' and bad_autoplayer(clone):
        clone['values'].pop('/rng/autoplayer', None)
    shell = {k: copy.deepcopy(v) for k, v in payload.items()
             if k not in ('rows', 'events', 'gaps', 'chunk')}
    shell.update(build=build, rows=[clone], events=[], gaps=[], parts=1, part=0)
    return size([0, [5, shell]]) + 1


def audit_room(room):
    fingerprint_files = sorted(room.glob('fingerprint-*.jsonl'))
    relay_files = sorted(p for p in room.glob('*.jsonl') if not p.name.startswith('fingerprint-'))
    records = [row for path in fingerprint_files for row in read_rows(path)]
    rows = [row for row in records if row.get('type') == 'row']
    streams, owners = defaultdict(list), defaultdict(set)
    for row in rows:
        observer, battle = row['observer']['id'], row['battleId']
        streams[(observer, battle)].append(row)
        owners[battle].add(observer)
    stream_report = []
    for (observer, battle), stream in sorted(streams.items()):
        frames300 = [r['postFrame'] for r in stream if r.get('sampleInterval') == 300]
        stream_report.append({'observer': observer, 'battleId': battle, 'rows': len(stream),
            'self': observer == battle, 'min_frame': min(r['postFrame'] for r in stream),
            'max_frame': max(r['postFrame'] for r in stream),
            'interval_counts': dict(Counter(r.get('sampleInterval') for r in stream)),
            'interval300_first_frames': frames300[:6],
            'interval300_frame_mod300': sorted({f % 300 for f in frames300}),
            'off_advertised_grid': sum(r['postFrame'] % r['sampleInterval'] != 0 for r in stream),
            'state_counts': dict(Counter(r['values'].get('/battle/state') for r in stream))})
    common = []
    for battle, observers in sorted(owners.items()):
        frame_sets = [{r['postFrame'] for r in streams[(observer, battle)]} for observer in sorted(observers)]
        shared = sorted(set.intersection(*frame_sets))
        common.append({'battleId': battle, 'observers': sorted(observers),
            'owner_observer_present': battle in observers, 'replica_common_frames': shared,
            'last_replica_common_frame': max(shared) if shared else None})
    wire_entries, raw_rows, wire18, wire20, wire_events = defaultdict(list), [], [], [], []
    packet_count, fragmented = 0, 0
    for path in relay_files:
        for rec in read_rows(path):
            frame = rec.get('f')
            if not (isinstance(frame, list) and len(frame) == 2 and frame[0] == 0
                    and isinstance(frame[1], list) and len(frame[1]) == 2 and frame[1][0] == 5
                    and isinstance(frame[1][1], dict) and frame[1][1].get('kind') == 'wf-fp'):
                continue
            payload = frame[1][1]
            packet_count += 1
            wire_entries[rec['cid']].append((rec['t'], size(frame) + 1))
            if payload.get('parts') != 1:
                fragmented += 1
                continue
            for row in payload.get('rows', []):
                raw_rows.append(row)
                wire18.append(solo_wire(row, payload, 'v35r'))
                wire20.append(solo_wire(row, payload, 'v35s'))
            if payload.get('events'):
                wire_events.append(size(payload['events']))
    wire_observers = []
    for observer, entries in sorted(wire_entries.items()):
        span_ms = max(t for t, _ in entries) - min(t for t, _ in entries)
        total = sum(b for _, b in entries)
        wire_observers.append({'observer': observer, 'packets': len(entries), 'bytes': total,
            'span_ms': span_ms, 'mean_bytes_per_second_over_observed_span': round(total * 1000 / max(1, span_ms), 3),
            'max_server_arrival_1000ms_bytes': rolling_max(entries)})
    projection = []
    for interval in (30, 60, 120, 240, 300):
        stat18, stat20 = summary(wire18), summary(wire20)
        projection.append({'interval': interval,
            'run18_two_battles_mean_bytes_per_second': round(stat18['mean'] * 2 * 60 / interval, 3),
            'v35s_three_battles_mean_bytes_per_second': round(stat20['mean'] * 3 * 60 / interval, 3),
            'v35s_three_battles_p95_bytes_per_second': round(stat20['p95'] * 3 * 60 / interval, 3),
            'v35s_three_battles_max_bytes_per_second': round(stat20['max'] * 3 * 60 / interval, 3),
            'valid_v35s_interval': interval != 300})
    return {'room': room.name, 'record_types': dict(Counter(r.get('type') for r in records)),
        'row_count': len(rows), 'self_row_count': sum(r['observer']['id'] == r['battleId'] for r in rows),
        'observers': sorted({r['observer']['id'] for r in rows}), 'streams': stream_report,
        'comparison_coverage': common, 'autoplayer_rng_type_rows': sum(bad_autoplayer(r) for r in rows),
        'autoplayer_rng_type_present_in_server_values': sum(bad_autoplayer(r) and '/rng/autoplayer' in r['values'] for r in rows),
        'relay_packet_count': packet_count, 'relay_fragmented_packets': fragmented,
        'relay_row_count': len(raw_rows), 'relay_autoplayer_rng_type_present_in_values': sum(bad_autoplayer(r) and '/rng/autoplayer' in r['values'] for r in raw_rows),
        'logical_relay_row_utf8_bytes': summary([size(r) for r in raw_rows]),
        'solo_wire_run18_utf8_plus_nul': summary(wire18), 'solo_wire_v35s_utf8_plus_nul': summary(wire20),
        'events_array_utf8_bytes': summary(wire_events), 'wire_by_observer': wire_observers,
        'projection_60fps_frozen_rows': projection}


def source_hashes():
    paths = sorted(SOURCE.rglob('*.jsonl'))
    paths += [BASELINE / name for name in ('v35r.swf', 'v35r-local-wf.swf',
        'compact_sampling.py', 'compact_transport.py', 'contract-delta.md')]
    return [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in paths]


def markdown(report):
    text = ['# 第二十轮实测证据与上行预算离线复核', '',
        '读取本机 run3-v35r 的 4 个房间；不联网、未操作服务器/设备。数据来源和完整 SHA256 见文末及 evidence-audit.json。', '',
        f"四房合计 **{sum(r['row_count'] for r in report['rooms'])} 条 row，本机 Battle row 为 0**；每个观察端只有两名队友副本。",
        '这只能核实诊断覆盖缺口，不能用缺失的本机状态证明游戏状态一致或定位真实脱同步首帧。', '',
        '| 房号 | row 数 | 自机 row | 单行含外壳均值 B | 单行最大 B | 三 Battle / 30 帧均值 B/s | 三 Battle / 60 帧均值 B/s | 三 Battle / 240 帧均值 B/s |',
        '|---|---:|---:|---:|---:|---:|---:|---:|']
    for room in report['rooms']:
        p = {v['interval']: v for v in room['projection_60fps_frozen_rows']}
        s = room['solo_wire_v35s_utf8_plus_nul']
        text.append(f"| {room['room']} | {room['row_count']} | {room['self_row_count']} | {s['mean']} | {s['max']} | {p[30]['v35s_three_battles_mean_bytes_per_second']} | {p[60]['v35s_three_battles_mean_bytes_per_second']} | {p[240]['v35s_three_battles_mean_bytes_per_second']} |")
    pumpkin = next(r for r in report['rooms'] if r['room'] == '119478')
    text += ['', '## 南瓜房 119478 的同帧覆盖', '',
        '| Battle ID | 两个副本的共同帧 | 本机观察端存在 |', '|---|---|---|']
    for coverage in pumpkin['comparison_coverage']:
        text.append(f"| `{coverage['battleId']}` | {', '.join(map(str, coverage['replica_common_frames']))} | 否 |")
    text += ['', '300 档实际采样起点及相位：', '',
        '| observer | Battle ID | 300 档前六帧 | mod 300 |', '|---|---|---|---|']
    for stream in pumpkin['streams']:
        text.append(f"| `{stream['observer']}` | `{stream['battleId']}` | {stream['interval300_first_frames']} | {stream['interval300_frame_mod300']} |")
    text += ['', '## 估算口径与 run18 对照', '',
        '按 relay 内原始 row，保留完整字段、输入/路由摘要，单行独立套用已观测的外壳；UTF-8 紧凑 JSON 加 XMLSocket NUL。',
        'v35s 投影只改 build 和移除 rng_type 的 autoplayer 值；未凭空缩短地址、摘要或 unsupported。',
        '按 60 逻辑帧/秒冻结各已观测行长度，run18 为每机 2 个 Battle，v35s 为 3 个 Battle；相同档位采样流量因此为 1.5 倍。',
        '表格不含状态变化额外采样、initial、throttle 等事件、网络协议层开销；不能称为真实手机 B/s。JSON 内另存均值/p95/最大值和 30/60/120/240/300 档比较。',
        'relay 是解析后的服务器录制；重新紧凑编码能复现估算口径，但原始 XMLSocket 字节流与客户端发送时间未核实。',
        'server-arrival 一秒窗口不能验证客户端滑窗限速，因为网络延迟、合批和录制时间可改变到达间隔。', '',
        f"共 {sum(r['autoplayer_rng_type_rows'] for r in report['rooms'])} 条已观测 rng_type 行，在原始 relay 和服务端重组 values 中均没有 /rng/autoplayer；unsupported 保留。",
        '这不证明未遇到的本机分支安全，主实现仍应显式在不可读时省略 values 键。', '',
        '## 三 Battle 预算实现建议与极端边界', '',
        '1. 本机和副本绑定到同一连接上下文，使用相同字段与采样器；保留整台客户端跨 context 的 20,000 B/1000ms 滑窗。',
        '2. 只使用 30/60/120/240，按 postFrame 对档位取模；不使用 frame-previousFrame 来决定普通采样。状态变化与 frame%240==0 独立强制采样。',
        '3. 对按实际编码字节得出的预算压力，先提高以后普通采样的档位，再由已有发送队列延迟发送；不得为限速跳过当次强制行。',
        '4. 档位 240 的保底对应三 Battle 每秒 0.75 个常规完整行（60fps）；状态变化每增加一个 row，就增加其完整编码体积及可能事件开销。',
        '5. 若每帧变化状态，三 Battle 可要求每秒 180 个 row；按任意无界 row 长度或持续突发，有限队列与 20KB/s 不可能同时保证无限期无损实时交付。',
        '6. 因此合同应明确“采样并入队”与“即时送达”的区别：保留既有有限队列/overflow gap；不能静默丢状态行，也不能宣称全部极端输入必能及时到服。',
        '7. 本轮要求不改服务器；迟到、掉线、原继承队列上限和重组期限导致的交付不足，仍必须报告 gap 或未核实。', '',
        '上述为基于证据的设计建议；v35s 最终字节码是否按此实施及通过变异测试，须另见本轮实际验收，不在本报告预先作完成承诺。', '',
        '## 复现与来源 SHA256', '', '`python -B run20\\evidence_audit.py`', '',
        '本脚本只写自身 run20 内的 evidence-audit.json 与 evidence-audit.md。', '', '| 来源 | SHA256 |', '|---|---|']
    text += [f"| `{item['path']}` | `{item['sha256']}` |" for item in report['sources']]
    return '\n'.join(text) + '\n'


def main():
    rooms = [audit_room(p) for p in sorted(SOURCE.iterdir()) if p.is_dir()]
    report = {'schema': 'run20-offline-evidence-audit-v1', 'source_root': str(SOURCE),
        'sources': source_hashes(), 'rooms': rooms,
        'bounds': {'fps_assumed': 60, 'wire_model': 'compact reserialization of parsed relay frame plus NUL; not raw captured socket bytes',
            'projection': 'observed frozen row size distribution; no transition or lifecycle event allowance',
            'physical_budget': '20000 UTF-8 bytes plus NUL per client per rolling 1000ms',
            'runtime_v35s': '未核实', 'device_and_server': '未核实'}}
    (OUT / 'evidence-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'evidence-audit.md').write_text(markdown(report), encoding='utf-8')
    print(json.dumps({'rooms': len(rooms), 'rows': sum(r['row_count'] for r in rooms),
        'self_rows': sum(r['self_row_count'] for r in rooms), 'outputs': ['evidence-audit.json', 'evidence-audit.md']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
