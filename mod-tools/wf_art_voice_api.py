"""Seed Audio 角色独立语音生成；密钥仅从进程环境读取，不保存请求头。"""
from __future__ import annotations
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import uuid

ENDPOINT='https://openspeech.bytedance.com/api/v3/tts/create'
MODEL='seed-audio-1.0'


def sha(raw):return hashlib.sha256(raw).hexdigest()


def payload(line):
    direction=(line['persona']+'。'+('参考音频来自同一位虚构游戏角色，保持音色统一。' if line['references'] else '')+
        '仅一位角色，用自然日语说指定台词。录音棚干声，无音乐、环境音、战斗音效或其他说话者。'
        '不要朗读说明，不复述参考音频中的台词，不添加文字。'+line['direction']+
        '。只说以下日语台词：'+line.get('tts_text',line['ja']))
    refs=[]
    for item in line['references']:
        path=Path(item['path']);raw=path.read_bytes()
        if sha(raw)!=item['sha256']:raise ValueError('reference hash drift')
        refs.append({'audio_data':base64.b64encode(raw).decode('ascii')})
    result=dict(model=MODEL,text_prompt=direction,
        audio_config=dict(format='mp3',sample_rate=48000,pitch_rate=0,speech_rate=0,
                          loudness_rate=0,enable_subtitle=True),watermark={})
    if refs:result['references']=refs
    return result


def generate(line,output,key,*,opener=urllib.request.urlopen):
    role,slot=line['role'],line['slot']
    if not re.fullmatch(r'[a-z]+', role) or not re.fullmatch(r'(ally|battle|home)/[a-z0-9_]+', slot):
        raise ValueError('unsafe recording path')
    target=output/role/'raw'/(slot+'.mp3');receipt=output/role/'receipts'/(slot+'.json')
    request_payload=payload(line)
    fingerprint=sha(json.dumps(request_payload,ensure_ascii=False,sort_keys=True).encode())
    if target.exists() and receipt.exists():
        saved=json.loads(receipt.read_bytes())
        if saved.get('request_fingerprint')==fingerprint and saved.get('sha256')==sha(target.read_bytes()):
            return dict(role=role,slot=slot,status='cached')
        raise ValueError('existing recording differs; use a separate retake output')
    if target.exists() or receipt.exists():raise ValueError('incomplete prior recording requires separate retake')
    rid=str(uuid.uuid4());started=time.monotonic()
    meta=dict(role=role,slot=slot,request_id=rid,model=MODEL,endpoint=ENDPOINT,
        request_fingerprint=fingerprint,ja=line['ja'],zh=line['zh'],direction=line['direction'],
        persona=line['persona'],references=line['references'])
    request=urllib.request.Request(ENDPOINT,data=json.dumps(request_payload).encode(),headers={
        'Content-Type':'application/json','X-Api-Key':key,'X-Api-Request-Id':rid},method='POST')
    try:
        with opener(request,timeout=300) as response:
            body=json.loads(response.read());meta['http_status']=response.status
        if not isinstance(body.get('audio'),str):raise ValueError('response contains no inline audio')
        raw=base64.b64decode(body['audio'],validate=True)
        if len(raw)<512:raise ValueError('audio payload is too short')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
        meta.update(status='generated',sha256=sha(raw),bytes=len(raw))
        meta['response']={name:body[name] for name in ('duration','original_duration','subtitle') if name in body}
    except urllib.error.HTTPError as exc:
        meta.update(status='failed',http_status=exc.code,error='HTTP '+str(exc.code))
        # Inspect only scalar error messages; never persist an HTTP body/header dump.
        try:
            error_body=json.loads(exc.read(16384))
            detail=error_body.get('error',error_body)
            if isinstance(detail,dict):
                for name in ('code','message'):
                    value=detail.get(name)
                    if isinstance(value,(str,int)):
                        text=str(value).replace(key,'[REDACTED]')
                        meta['api_'+name]=re.sub(r'[A-Za-z0-9_-]{24,}','[opaque]',text)[:300]
        except (ValueError,TypeError):pass
        exc.close()
    except Exception as exc:
        meta.update(status='failed',error=type(exc).__name__+': '+str(exc).replace(key,'[REDACTED]'))
    meta['elapsed_seconds']=round(time.monotonic()-started,2)
    receipt.parent.mkdir(parents=True,exist_ok=True)
    receipt.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    return {name:meta.get(name) for name in ('role','slot','status','http_status','elapsed_seconds','error','api_code','api_message')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--only',action='append',default=[])
    parser.add_argument('--workers',type=int,choices=(1,2,3),default=2)
    args=parser.parse_args();key=os.environ.pop('WF_SEED_AUDIO_KEY','')
    if not key:raise SystemExit('missing process credential')
    output=args.output.resolve()
    allowed=(Path('D:/WF/startpoint-cn/work/codex_out/character-art-voice-20260912/voice'),
             Path('D:/WF/角色语音/角色重录_20260912'))
    if not any(output==p or output.is_relative_to(p) for p in allowed):
        raise SystemExit('output outside assigned voice workspace')
    lines=json.loads(args.plan.read_text(encoding='utf-8'))
    if args.only:lines=[x for x in lines if x['role']+':'+x['slot'] in args.only]
    if not lines:raise SystemExit('empty generation selection')
    failed=0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(generate,line,output,key) for line in lines]
        for future in as_completed(futures):
            result=future.result();failed+=result['status']=='failed'
            print(json.dumps(result,ensure_ascii=False),flush=True)
    if failed:raise SystemExit(1)


if __name__=='__main__':main()
