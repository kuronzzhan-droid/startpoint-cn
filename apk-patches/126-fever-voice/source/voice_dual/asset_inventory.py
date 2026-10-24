"""只读核对本地资产链内的实际语音文件；仅将证据写到本组目录。"""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from .ready_audit import CHARACTERS

HERE = Path(__file__).resolve().parent
ACTIVE = Path(r'D:\WF\startpoint-cn-kulo\assets\asset-patch\active')
SALT = 'K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy'


def inventory():
    rows={}
    for cid,(code,_) in CHARACTERS.items():
        for phase in ('skill_ready','matched_skill_ready'):
            for suffix in ['', *['_alt_'+str(n) for n in range(1,7)]]:
                logical=f'character/{code}/voice/battle/{phase}{suffix}.mp3'
                digest=hashlib.sha1((logical+SALT).encode()).hexdigest()
                rows['production/upload/'+digest[:2]+'/'+digest[2:]]={'character_id':cid,'logical_path':logical,'found':[]}
    archives=sorted(ACTIVE.glob('*.zip'),key=lambda p:tuple(map(int,re.findall(r'\d+',p.name))))
    for path in archives:
        with zipfile.ZipFile(path) as z:
            hits=rows.keys() & set(z.namelist())
            if not hits:
                continue
            sha=hashlib.sha256(path.read_bytes()).hexdigest()
            for member in hits:
                payload=z.read(member)
                rows[member]['found'].append({'archive':str(path),'archive_sha256':sha,'member':member,
                                              'size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()})
    result={'scope':'本地 active 根目录资产增量链 ZIP；未联网，非设备/线上状态',
            'salt_source':r'D:\WF\out\kulo-patch-toolkit\oldrepo_modtools\wf_mod_tool.py:40,289-295',
            'archive_count':len(archives),'files':list(rows.values())}
    (HERE/'voice-asset-inventory.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    return result


if __name__=='__main__':
    print(json.dumps({c:[r['logical_path'].split('/')[-1] for r in inventory()['files'] if r['character_id']==c and r['found']]
                      for c in CHARACTERS},ensure_ascii=False))
