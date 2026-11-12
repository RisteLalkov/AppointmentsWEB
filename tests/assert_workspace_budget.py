"""Broad CI regression budgets; not a production capacity certification."""
import json,os,pathlib
root=pathlib.Path(__file__).resolve().parents[1];out=root/os.environ['QA_OUTPUT'];results=[]
def check(ok,name,**details):
 results.append(dict(name=name,status='PASS' if ok else 'FAIL',**details))
 print(('PASS ' if ok else 'FAIL ')+name)
measurements=json.loads((out/'evidence/performance.json').read_text())['summary']
for name,data in measurements.items():
 if 'Large' in name and 'bootstrap' in name:
  check(data['response_bytes']<256*1024 and data['appointments']<=100 and data['patients']<=150,name+' remains bounded',bytes=data['response_bytes'])
for row in json.loads((out/'evidence/browser-performance.json').read_text()):
 longest=max((x['duration'] for x in row['longTasks']),default=0)
 check(row['status']=='PASS' and row['interactive_ms']<10000 and longest<1500,row['role']+' meets broad browser regression budget',interactive_ms=row['interactive_ms'],longest_task_ms=longest)
(out/'evidence/workspace-budget-results.json').write_text(json.dumps(results,indent=2))
raise SystemExit(1 if any(r['status']=='FAIL' for r in results) else 0)
