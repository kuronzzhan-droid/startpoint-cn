"""最终SWF的真实AVM2行为/时间线/变异复审；产物只写本目录。"""
import sys,json,hashlib,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from superfever.cases import suite
from superfever.mutations import mutants

def main():
 source=Path(sys.argv[1]) if len(sys.argv)>1 else HERE/'test.swf'
 abc=SwfAbc(source).abc;base=SwfAbc(HERE.parent.parent/'run2/v35b.swf').abc
 started=time.time();report=suite(base,abc);print('baseline',len(report['checks']),flush=True)
 results=[];survived=[]
 for name,overrides in mutants(base,abc):
  try:suite(base,abc,overrides,legacy=False)
  except Exception as exc:results.append({'name':name,'detected':True,'reason':str(exc)[:500]})
  else:results.append({'name':name,'detected':False});survived.append(name);print('SURVIVED',name,flush=True)
  if len(results)%10==0:print('mutants',len(results),'survived',len(survived),flush=True)
 final=suite(base,abc)
 report.update(status='pass' if not survived else 'fail',swf_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
  mutants=results,survived=survived,final_baseline='pass',elapsed_seconds=round(time.time()-started,3),
  boundary='游戏资产与外部射击服务使用夹具；状态构造、原生叠层/移除/到期、wfx扫描与最终追加方法均执行真实ABC；伤害通路另由superdamage验证')
 (HERE/'verify-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'status':report['status'],'checks':len(report['checks']),'mutants':len(results),'survived':survived},ensure_ascii=False))
 if survived:raise SystemExit(1)
if __name__=='__main__':main()
