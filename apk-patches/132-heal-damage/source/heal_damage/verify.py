"""从候选SWF真实ABC执行旧对照、新矩阵、静态有效变异及恢复复跑。"""
import hashlib,json,sys
from pathlib import Path
if __package__ in (None,''):
 sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from heal_damage.cases import parity,scenarios
from heal_damage.mutations import run as mutations
from heal_damage.patches import TARGETS
from heal_damage.mutations import HELPERS
import bodies


def run(before,after):
 baseline={label:hashlib.sha256(after.bodies[bodies.resolve(after,label)][5]).hexdigest() for label in TARGETS+HELPERS}
 old=parity(before,after);new=scenarios(after);mutants=mutations(before,after)
 assert all(item['status']=='killed' for item in mutants),[item for item in mutants if item['status']!='killed']
 assert baseline=={label:hashlib.sha256(after.bodies[bodies.resolve(after,label)][5]).hexdigest() for label in TARGETS+HELPERS}
 restored_old=parity(before,after);restored_new=scenarios(after)
 assert old==restored_old and new==restored_new
 return {'status':'pass','old_count':len(old),'new_count':len(new),'mutation_count':len(mutants),'mutations_killed':len(mutants),'mutations_survived':0,'restored_baseline':True,
 'old_checks':old,'new_checks':new,'mutations':mutants,'methods':baseline,
 'old_parity_count':len(old),'new_check_count':len(new),'mutant_count':len(mutants),'survived':0,'final_baseline':'pass',
 'scope':'真实AVM2字节码离线执行；完整AIR、设备与实际联机未核实',
 'native_attack_reference':2,'original_task_literal_reference':0,'task_literal_reference':2}


def main():
 import argparse
 from swfabc import SwfAbc
 parser=argparse.ArgumentParser();parser.add_argument('--after',type=Path,default=bootstrap.ROOT/'v35f.swf');parser.add_argument('--output',type=Path,default=Path(__file__).with_name('verify-report.json'));args=parser.parse_args()
 assert hashlib.sha256(bootstrap.BASE.read_bytes()).hexdigest()==bootstrap.BASE_SHA
 result=run(SwfAbc(bootstrap.BASE).abc,SwfAbc(args.after).abc);result['swf_sha256']=hashlib.sha256(args.after.read_bytes()).hexdigest()
 bootstrap.output_path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({k:result[k] for k in ['status','old_count','new_count','mutation_count','restored_baseline']},ensure_ascii=False))

if __name__=='__main__':main()
