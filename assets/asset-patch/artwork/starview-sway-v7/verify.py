"""Verify this offline delivery without loading or modifying game resources."""

import base64
import csv
import hashlib
import json
import struct
import sys
import zlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROLES = [119990, 129999, 139994, 149987, 149999, 169989]
FRAMES = [212, 312, 382, 292, 332, 322]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def row(text):
    return next(csv.reader([text]))


def verify_resource(base, item, data=None):
    path = (base / item['file']).resolve()
    require(path.is_relative_to(base.resolve()), 'Resource path escapes its directory')
    if data is None:
        data = path.read_bytes()
    require(len(data) == item['bytes'] and digest(data) == item['sha256'],
            'Resource identity changed: ' + item['file'])
    if path.name.endswith('.deflate'):
        require(bool(zlib.decompress(data, -15)), 'Empty raw-DEFLATE resource')
    elif path.suffix == '.png':
        # The client stores PNG assets with a lowercase signature (see wf_preview_2d_core.py).
        require(data[:8] == b'\x89png\r\n\x1a\n', 'Not a native stored PNG')
        require(all(struct.unpack('>II', data[16:24])), 'Empty PNG dimensions')


def main():
    delivery = read('DELIVERY.json')
    require(delivery['gameIntegrated'] is False, 'Offline delivery must not be activated')
    for name, expected in delivery['files'].items():
        path = (ROOT / name).resolve()
        require(path.is_relative_to(ROOT), 'Inventory path escapes delivery')
        require(digest(path.read_bytes()) == expected, 'Delivery file changed: ' + name)

    art = read('native-resources.json')
    require(len(art) == 29, 'Expected seven Movies and one banner')
    art_keys = {item['logical'] for item in art}
    require(len(art_keys) == 29, 'Duplicate artwork key')
    with zipfile.ZipFile(ROOT / 'native-assets.zip') as archive:
        require(len(archive.namelist()) == len(art)
                and set(archive.namelist()) == {item['file'] for item in art}, 'Native archive member set changed')
        for item in art:
            verify_resource(ROOT, item, archive.read(item['file']))
    require('dynamic/gacha_list_banner/cnmod_starview_sway.png' in art_keys, 'Missing banner')
    for page in ['top', *map(str, ROLES)]:
        for suffix in ['feature.movie.amf3.deflate', 'feature.timeline.amf3.deflate',
                       'sprite_sheet.atlas.amf3.deflate', 'sprite_sheet.png']:
            require(f'gacha/feature_movie/cnmod_starview_sway/{page}/{suffix}' in art_keys,
                    'Incomplete native Movie: ' + page)

    pool = read('config/pool-990006.baseline.json')
    require(list(pool) == ['990006'], 'Pool fragment must contain only 990006')
    rule = pool['990006']
    require(rule['pageKind'] == 4 and rule['tenTicketItemId'] == 999023
            and rule['wildcardTicketAvailable'] is False, 'Original ticket contract changed')
    require(rule['rankRates'] == {'normal': [75, 150, 775], 'multiGuarantee': [75, 925]},
            'Original rank probabilities changed')
    require([entry['id'] for entry in rule['pool']['1'] if entry['isRateUp']] == ROLES,
            'Original pickup order changed')

    scene_manifest = read('scenes/RESOURCE-MANIFEST.json')
    tables = read('scenes/MASTER-ROWS.json')['tables']
    require(len(tables) == 5 and all(len(rows) == 6 for rows in tables.values()),
            'Scene fragments must have six rows per table')
    require([scene['roleId'] for scene in scene_manifest['scenes']] == ROLES, 'Scene role order changed')
    scene_keys = {item['logical'] for item in scene_manifest['files']}
    require(len(scene_keys) == len(scene_manifest['files']) == 12, 'Expected 12 isolated scene resources')
    for item in scene_manifest['files']:
        require('starview_sway' in item['logical'], 'Shared scene must not be overwritten')
        verify_resource(ROOT / 'scenes', item)
    quest_ids = []
    for scene in scene_manifest['scenes']:
        key = scene['skillKey']
        quest_ids.append(scene['questId'])
        gacha = row(tables['master/gacha/gacha_skill_preview.orderedmap'][key])
        require(gacha == [str(scene['questId']), scene['log'], str(scene['clip'][1]),
                         str(scene['clip'][0]), 'false', 'false'], 'Skill metadata mismatch: ' + key)
        quest = row(tables['master/skill_preview/skill_preview_quest.orderedmap'][str(scene['questId'])])
        require(quest[-1] == scene['fieldData'], 'Quest reference mismatch')
        field = row(tables['master/battle/field_data.orderedmap'][scene['fieldData']])
        require(field == [scene['field'], scene['terrain'].removesuffix('.amf3.deflate'), scene['zone']],
                'Field reference mismatch')
        require(scene['field'] in tables['master/battle/field.orderedmap']
                and scene['zone'] in tables['master/battle/zone.orderedmap'], 'Missing field or zone')
        require(scene['terrain'] in scene_keys and scene['log'] + '.battle.amf3.deflate' in scene_keys,
                'Missing terrain or replay')
    require(len(set(quest_ids)) == 6, 'Duplicate candidate quest ID')
    require(scene_manifest['scenes'][-1]['window'] == [0, 320], 'Neftim shortened window changed')

    feature = read('feature/gacha_feature_content.990006.json')
    require(list(feature) == ['990006'] and list(feature['990006']) == list(map(str, range(1, 14))),
            'Feature must contain only the 13 ordered pages for 990006')
    content = [value[0] for value in feature['990006'].values()]
    require(all(len(value) == 9 for value in content), 'Feature rows must have nine fields')
    require(content[0][0] == '0' and content[0][2].endswith('/top/feature'), 'Missing cover')
    for index, role in enumerate(ROLES):
        skill, poster = content[1 + 2 * index:3 + 2 * index]
        require(skill == ['2', '', '', '1', scene_manifest['scenes'][index]['skillKey'],
                          str(role), '0', str(role), ''], 'Skill feature reference mismatch')
        require(poster[0] == '0' and poster[2] == f'gacha/feature_movie/cnmod_starview_sway/{role}/feature'
                and poster[7] == str(role), 'Poster reference mismatch')

    media = read('preview/native-recordings.json')
    require(media['fps'] == 60 and media['stage'] == [1080, 1920]
            and media['stageMask'] == [0, 60, 1080, 1560], 'Native capture geometry changed')
    require([int(clip['roleId']) for clip in media['clips']] == ROLES, 'Recording order changed')
    for clip, frames in zip(media['clips'], FRAMES):
        require(clip['lastFrame'] - clip['firstFrame'] + 1 == frames, 'Recording frame count changed')
        require(digest(base64.b64decode(clip['data'], validate=True)) == clip['videoHash'], 'Recording changed')
    proof = read('scenes/VERIFY-PROOF.json')
    require(digest((ROOT / 'scenes/MASTER-ROWS.json').read_bytes()) == proof['masterRowsSHA256']
            and digest((ROOT / 'scenes/RESOURCE-MANIFEST.json').read_bytes()) == proof['resourceManifestSHA256'],
            'Isolated capture proof no longer binds current scene rows')
    print(json.dumps({'passed': True, 'nativeArtResources': 29, 'isolatedSceneResources': 12,
                      'featurePages': 13, 'nativeFrames': sum(FRAMES), 'gameIntegrated': False}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, IndexError, OSError, zlib.error, zipfile.BadZipFile) as error:
        print('Verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
