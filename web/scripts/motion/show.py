import sys,json
for l in sys.stdin:
    n,_,j=l.partition(' ')
    try: d=json.loads(j)
    except Exception:
        if l.strip(): print(l.strip()[:200])
        continue
    print(n, {k:v for k,v in d.items() if k in('ok','bad','up','down','turns','ratio','net','skipped','key','gap','was','now','grew')})
    for x in (d.get('downs',[])[:4] if not d.get('ok') else []):
        print('  down',x['t'],x['d'],'scroll',x['top'],'h',x['h'])
        for m in x['near'][:8]: print('     ',m[:170])
