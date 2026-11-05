"""Bounded, dependency-free offline delivery verification; never activates assets."""
import base64
import hashlib
import json
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPECTED = {
    'starview-encounter': ([169998, 139999, 149997, 139992, 179999, 129991], 1462),
    'autumn-beast-dice': ([149986, 139990, 139991], 656),
    'autumn-prayer-rabbit': ([159991, 169988, 169991], 916),
    'autumn-moon-laurel': ([159995, 119991, 119992], 876),
}


def need(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    need(path.stat().st_size < 12 * 1024**2, 'Oversized JSON: ' + path.name)
    return json.loads(path.read_text(encoding='utf-8'))


def local(base, relative):
    p = (base / relative).resolve()
    need(p.is_relative_to(base.resolve()), 'Resource path escapes delivery')
    return p


def identity(data, item):
    need(len(data) == item['bytes'] and sha(data) == item['sha256'], 'Resource identity changed')


def native(data, name):
    if name.endswith('.deflate'):
        decoder = zlib.decompressobj(-15)
        decoded = decoder.decompress(data, 16 * 1024**2)
        need(decoded and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
             'Invalid or oversized raw-DEFLATE payload')
    elif name.endswith('.png'):
        need(data[:8] == b'\x89png\r\n\x1a\n', 'Expected native stored PNG')
        width, height = struct.unpack('>II', data[16:24])
        need(0 < width <= 16384 and 0 < height <= 16384, 'Invalid PNG extent')


def verify_pool(key, roles, frames):
    base = ROOT / key
    art = read(base / 'native-resources.json')
    need(len(art) == (len(roles) + 1) * 4 + 1, 'Incomplete Movie set')
    keys = {x['logical'] for x in art}
    need(len(keys) == len(art) and all('cnmod_' in k for k in keys), 'Duplicate or shared art key')
    with zipfile.ZipFile(base / 'native-assets.zip') as archive:
        need(len(archive.infolist()) == len(art) and set(archive.namelist()) == {x['member'] for x in art}, 'Archive member set differs')
        for item in art:
            local(base, item['member'])
            info = archive.getinfo(item['member'])
            need(info.file_size == item['bytes'] < 20 * 1024**2, 'Oversized native resource')
            data = archive.read(info)
            identity(data, item)
            native(data, item['logical'])
    feature = read(base / 'FEATURE-RECIPE.json')
    need(all(feature[k] is None for k in ['formalPoolId', 'formalUPRoster', 'ticket', 'rates', 'pity']), 'Business configuration unexpectedly assigned')
    need(feature['bannerLogical'] in keys, 'Banner missing')
    order = feature['featureOrder']
    need(len(order) == 1 + len(roles) * 2 and order[0]['kind'] == 0, 'Incomplete feature order')
    manifest = read(base / 'scenes/RESOURCE-MANIFEST.json')
    donors = read(base / 'scenes/DONOR-ROWS.json')
    need(manifest['gameIntegrated'] is False and manifest['namespaceRebindRuntimeVerified'] is False, 'Invalid integration claim')
    scenes = manifest['scenes']
    need([s['roleId'] for s in scenes] == roles and sum(s['nativeFrames'] for s in scenes) == frames, 'Scene roles or full frame counts differ')
    need([d['roleId'] for d in donors['roles']] == roles, 'Donor rows differ')
    files = manifest['files']
    need(len(files) == len(roles) * 2 + (4 if key == 'autumn-moon-laurel' else 0), 'Incomplete scene files')
    logicals = {x['logical'] for x in files}
    need(len(logicals) == len(files) and all('cnmod_' in k for k in logicals), 'Scene keys are not isolated')
    need({p.name for p in (base / 'scenes/payload').iterdir()} == {Path(x['file']).name for x in files}, 'Scene payload closure differs')
    for item in files:
        data = local(base / 'scenes', item['file']).read_bytes()
        identity(data, item)
        native(data, item['logical'])
        if not item.get('pathRebindings'):
            need(item['sha256'] == item['sourceSHA256'], 'Native source bytes changed')
    media = read(base / 'preview/native-recordings.json')
    for i, (scene, donor, clip) in enumerate(zip(scenes, donors['roles'], media['clips'])):
        rid = scene['roleId']
        recipe = scene['recipe']
        need(set(donor['rows']) == {'gacha', 'quest', 'fieldData', 'field', 'zone'}, 'Five scene rows required')
        g, q, fd, field, zone = [recipe[k] for k in ['gacha', 'quest', 'fieldData', 'field', 'zone']]
        need(q['key'] == g['columns'][0] == 'AUTHOR_QUEST_ID_' + str(rid), 'Quest allocation must remain explicit')
        need(q['columns'][-1] == fd['key'] == g['key'], 'Quest/fieldData binding differs')
        need(fd['columns'] == [field['key'], scene['terrainLogical'].removesuffix('.amf3.deflate'), zone['key']], 'Field binding differs')
        need(g['columns'][1] + '.battle.amf3.deflate' == scene['replayLogical'] in logicals, 'Replay missing')
        need(scene['terrainLogical'] in logicals, 'Terrain missing')
        need(list(map(int, g['columns'][2:4])) == list(reversed(scene['clipLeftTop'])), 'Clip top/left order differs')
        source = scene['sourcePreview']
        need(g['columns'][4:] == [str(source['enablesAbility']).lower(), str(source['enablesPowerFlip']).lower()], 'Native flags differ')
        need(scene['clipLeftTop'] == source['clip'] and scene['stageMask'] == [0, 60, 1080, 1560], 'Native viewport differs')
        need(q['columns'][:-1] == donor['rows']['quest']['columns'][:-1], 'Unrelated quest fields changed')
        zone_raw = base64.b64decode(donor['rows']['zone']['storedBase64'], validate=True)
        need(sha(zone_raw) == zone['storedRowSHA256'] == donor['rows']['zone']['storedRowSHA256'], 'Nested zone changed')
        need(int(clip['roleId']) == rid and clip['videoHash'] == scene['nativeVideoSHA256'], 'Selected recording differs')
        need(scene['nativeFrames'] == clip['lastFrame'] - clip['firstFrame'] + 1, 'Recording frame window differs')
        skill, poster = order[1 + i * 2:3 + i * 2]
        need(skill == {'kind': 2, 'roleId': rid, 'skillPreviewKey': g['key']} and poster['kind'] == 0 and poster['roleId'] == rid, 'Skill/poster order changed')
        if rid == 119992:
            bg = scene['miaBackgroundFix']
            need(bg and bg['partsTranslationY'] == -245760 and bg['worldTranslationY'] == -360, 'Mia background correction missing')
            need(field['columns'][0] == bg['fieldResourcePrefix'], 'Mia field points to old background')
            need(field['columns'][1:] == donor['rows']['field']['columns'][1:], 'Unrelated field entries changed')
            for suffix in ['.parts.amf3.deflate', '.atlas.amf3.deflate', '.png', '.timeline.amf3.deflate']:
                need(bg['fieldResourcePrefix'] + suffix in logicals, 'Mia background family incomplete')
        else:
            need(field['columns'] == donor['rows']['field']['columns'], 'Unmodified background changed')
    for entry in order:
        if entry['kind'] == 0:
            for suffix in ['feature.movie.amf3.deflate', 'feature.timeline.amf3.deflate', 'sprite_sheet.atlas.amf3.deflate', 'sprite_sheet.png']:
                need(entry['movie'] + '/' + suffix in keys, 'Incomplete Movie reference')
    result = subprocess.run(['node', '--max-old-space-size=192', str(ROOT / 'build-preview.cjs'), key, '--verify'], capture_output=True, text=True, timeout=60)
    need(result.returncode == 0, 'HTML rebuild failed: ' + result.stderr[:1000])
    rebuilt = json.loads(result.stdout)
    need(rebuilt['nativeFrames'] == frames and rebuilt['pages'] == len(order), 'Rebuilt presentation differs')
    print(f'PASS {key}: {len(art)} art resources, {len(files)} scene resources, {len(order)} pages, {frames} native frames')


def main():
    inventory = read(ROOT / 'DELIVERY.json')
    need(inventory['gameIntegrated'] is False and inventory['deviceAccepted'] is False, 'Invalid acceptance claim')
    actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p.name not in ['DELIVERY.json', 'review.html'] and '__pycache__' not in p.parts}
    need(actual == set(inventory['files']), 'Delivery file closure differs')
    for relative, item in inventory['files'].items():
        file = local(ROOT, relative)
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        need(file.stat().st_size == item['bytes'] and digest == item['sha256'], 'Delivery changed: ' + relative)
    for key, (roles, frames) in EXPECTED.items():
        verify_pool(key, roles, frames)
    print('PASS all four offline deliveries; no game activation or device acceptance')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile) as exc:
        print('FAIL: ' + str(exc)[:2000], file=sys.stderr)
        sys.exit(1)
