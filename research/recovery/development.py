"""Small development panel, explicitly NOT a concealed final evaluation."""
from pathlib import Path
import argparse, hashlib, json, random, subprocess, time
from prepare import ROOT, ALPHABET

def cli():
    p=ROOT/'kernel/target/release/vah-search'
    return p.with_suffix('.exe') if p.with_suffix('.exe').exists() else p

def job_for(plain,seed,encoding,algorithm,iterations,start):
    rng=random.Random(seed)
    alphabet=list(range(len(ALPHABET))); rng.shuffle(alphabet)
    if encoding=='substitution':
        ciphertext=[alphabet[ALPHABET.index(c)] for c in plain];symbols=23
    elif encoding=='homophonic':
        symbols=46; mapping=list(range(symbols)); rng.shuffle(mapping)
        ciphertext=[mapping[2*ALPHABET.index(c)+rng.randrange(2)] for c in plain]
    else:raise ValueError(encoding)
    return dict(version='vah-search-1',experiment='recovery-development-v1',ciphertext=ciphertext,symbol_count=symbols,encoding=encoding,algorithm=algorithm,seed=seed,start=start,iterations=iterations,beam_width=16)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--starts',type=int,default=8);parser.add_argument('--iterations',type=int,default=10000);parser.add_argument('--length',type=int,default=1000);parser.add_argument('--languages',default='latin,italian');opt=parser.parse_args()
    cache=ROOT/'data/recovery'; manifest=json.loads((cache/'manifest.json').read_text());results=[]
    out=ROOT/'research/recovery/development-results.jsonl'
    for lang in opt.languages.split(','):
        train=next(x for x in manifest if x['language']==lang and x['split']=='training')
        dev=next(x for x in manifest if x['language']==lang and x['split']=='development')
        model=cache/f'{lang}.model.json'
        subprocess.run([str(cli()),'train','--input',str(cache/f"{train['id']}.normalized.txt"),'--source',train['normalized_sha256'],'--out',str(model)],check=True)
        text=(cache/f"{dev['id']}.normalized.txt").read_text();plain=text[5000:5000+opt.length]
        with subprocess.Popen([str(cli()),'batch','--model',str(model)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8',bufsize=1) as p:
            for encoding in ['substitution','homophonic']:
                for algorithm in ['beam-v1','restart-anneal-v1']:
                    # Beam has no random restarts; record one baseline and state
                    # that repeated identical deterministic searches add nothing.
                    starts=1 if algorithm=='beam-v1' else opt.starts
                    best=None
                    for start in range(starts):
                        job=job_for(plain,731,encoding,algorithm,opt.iterations,start)
                        p.stdin.write(json.dumps(job)+'\n');p.stdin.flush()
                        line=p.stdout.readline()
                        if not line:raise RuntimeError(f'solver exited {p.poll()}')
                        measured=json.loads(line);result=measured['result'];accuracy=sum(a==b for a,b in zip(plain,result['plaintext']))/len(plain)
                        row=dict(language=lang,source=dev['id'],encoding=encoding,algorithm=algorithm,length=len(plain),start=start,iterations=opt.iterations,character_recovery=accuracy,elapsed_ms=measured['elapsed_ms'],score=result['score'],result_digest=result['result_digest'])
                        results.append(row)
                        if best is None or result['score']>best['score']:best=row
                        print(json.dumps(row),flush=True)
                    print('selected by fixed score:',lang,encoding,algorithm,best['character_recovery'],flush=True)
            p.stdin.close();p.wait()
    out.write_text(''.join(json.dumps(r)+'\n' for r in results),encoding='utf-8')
if __name__=='__main__':main()
