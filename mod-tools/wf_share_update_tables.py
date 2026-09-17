"""Scoped update planner: compare each claimed leaf with its previous delivery.

An unknown receiver edit is a conflict, not permission to replace a shared table.
Unclaimed native keys and JSON fields retain their values. No publishing here.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from wf_share_asset_index import relative_path
import wf_share_update_codec as codec
from wf_share_update_io import checked_path, describe, entry, strict_json


def semantic(value):
    if isinstance(value, dict):
        return {k: semantic(v) for k, v in value.items() if k != 'raw'}
    if isinstance(value, list):
        return [semantic(v) for v in value]
    return value


def encode(node):
    if 'children' in node:
        return codec.pack({k: encode(v) for k, v in node['children'].items()})
    return codec.leaf_raw(node)


def patch_native(rows, keys, before, after, label):
    key, *rest = keys
    current = rows.get(key)
    if rest:
        children = {} if current is None else codec.unpack(current)
        patch_native(children, rest, before, after, label)
        encoded = codec.pack(children)
        if current != encoded:
            rows[key] = encoded
        return
    observed = None if current is None else codec.node(current)
    if semantic(observed) == semantic(after):
        return
    if semantic(observed) != semantic(before):
        raise ValueError('Receiver native leaf conflict: ' + label)
    rows[key] = encode(after)


def operations_checked(operations):
    paths = set()
    for op in operations:
        path = op['path']
        if not isinstance(path, list) or not path or any(not isinstance(k, str) or not k for k in path):
            raise ValueError('Invalid claimed key path')
        key = tuple(path)
        if any(key[:len(p)] == p or p[:len(key)] == key for p in paths):
            raise ValueError('Overlapping claimed key paths')
        paths.add(key)
    return operations


def client_plan(common, payload):
    if isinstance(payload, (str, Path)):
        payload = strict_json(Path(payload).read_bytes())
    if payload.get('format') != 'wf-scoped-update-client-1':
        raise ValueError('Unknown client update format')
    planned, reports = [], []
    for logical, table in payload['tables'].items():
        if not logical.startswith('master/') or not logical.endswith('.orderedmap'):
            raise ValueError('Expected a native master table')
        path = checked_path(common, relative_path(logical))
        before = path.read_bytes() if path.exists() else None
        rows = {} if before is None else codec.unpack(before)
        old_rows = dict(rows)
        for op in operations_checked(table['operations']):
            patch_native(rows, op['path'], op['before'], op['after'], logical + '|' + '/'.join(op['path']))
        after = before if rows == old_rows and before is not None else codec.pack(rows)
        item = entry(path, before, after, root='common', logical_path=logical,
                     owned_keys=sorted({op['path'][0] for op in table['operations']}))
        reports.append(describe(item))
        if before != after:
            planned.append(item)
    return planned, dict(kind='client', baseline=payload['target'], files=reports)


SERVER_FILES = {'character.json', 'cdndata/character.json', 'cdndata/character_text.json',
                'mana_board.json', 'mana_node.json', 'gacha.json', 'cdndata/gacha.json',
                'cdndata/gacha_feature_content.json', 'item_lookup.json', 'item_sale.json',
                'abyss_endurance_degree_reward.json', 'character_degree_rewards.json',
                'equipment_degree_rewards.json', 'abyss_shop_degree_reward.json'}


def patch_json(value, op, label):
    keys = op['path']
    current = value
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        if not isinstance(current[key], dict):
            raise ValueError('Receiver JSON parent schema conflict: ' + label)
        current = current[key]
    key = keys[-1]
    present = key in current
    if present and current[key] == op['after']:
        return
    if present != op['before_exists'] or (present and current[key] != op['before']):
        raise ValueError('Receiver JSON leaf conflict: ' + label + '|' + '/'.join(keys))
    current[key] = copy.deepcopy(op['after'])


def server_plan(assets, payload):
    if isinstance(payload, (str, Path)):
        payload = strict_json(Path(payload).read_bytes())
    if payload.get('format') != 'wf-scoped-update-server-1':
        raise ValueError('Unknown server update format')
    planned, reports = [], []
    for relative, file in payload['files'].items():
        if relative not in SERVER_FILES:
            raise ValueError('Server file is not in the update allowlist: ' + relative)
        path = checked_path(assets, relative)
        before = path.read_bytes() if path.exists() else None
        old = {} if before is None else strict_json(before)
        if not isinstance(old, dict):
            raise ValueError('Expected a JSON object')
        merged = copy.deepcopy(old)
        for op in operations_checked(file['operations']):
            patch_json(merged, op, relative)
        after = before if old == merged and before is not None else (
            json.dumps(merged, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        item = entry(path, before, after, root='server', logical_path=relative)
        reports.append(describe(item))
        if before != after:
            planned.append(item)
    return planned, dict(kind='server', baseline=payload['target'], files=reports)
