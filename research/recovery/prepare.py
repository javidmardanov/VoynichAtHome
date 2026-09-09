"""Fetch/normalize registered works. Never fetch evaluation without --evaluation.

Normalization follows Naibbe's Latin replacements, then restricts to its 23
ASCII letters. Original bytes and header/license stay in the local cache.
"""
from pathlib import Path
import argparse, hashlib, json, re, subprocess, unicodedata, urllib.request
ROOT=Path(__file__).resolve().parents[2]
ALPHABET='abcdefghilmnopqrstuvxyz'
STARTS={'218':'GALLIA est omnis', '226':'Quo usque tandem', '1000':'Nel mezzo del cammin', '56498':'Canzone da dirsi innanzi', '227':'ARMA virumque', '45334':'Quel ramo del lago'}
def normalize(text):
    text=unicodedata.normalize('NFD',text).lower()
    for a,b in {'æ':'ae','œ':'oe','ð':'d','þ':'th','ł':'l','ß':'ss','ø':'o','w':'uu','j':'i','k':'c'}.items(): text=text.replace(a,b)
    return ''.join(c for c in text if c in ALPHABET)
def main():
    args=argparse.ArgumentParser();args.add_argument('--evaluation',action='store_true');opt=args.parse_args()
    registry=json.loads((Path(__file__).parent/'sources.json').read_text())
    cache=ROOT/'data/recovery'; cache.mkdir(parents=True,exist_ok=True)
    manifest=[]
    for row in registry['sources']:
        if row['split']=='evaluation' and not opt.evaluation:continue
        path=cache/f"pg{row['work_id']}.txt"
        if not path.exists():path.write_bytes(urllib.request.urlopen(row['url'],timeout=45).read())
        raw=path.read_bytes();sha=hashlib.sha256(raw).hexdigest()
        if row.get('sha256') and row['sha256']!=sha:raise ValueError(f"changed source: {row['id']}")
        text=raw.decode('utf-8-sig')
        start=STARTS[row['work_id']]
        found=re.search(re.escape(start),text,re.I)
        if not found:raise ValueError(f"missing start marker: {start}")
        end=re.search(r'\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG',text)
        if not end:raise ValueError('missing end marker')
        body=text[found.start():end.start()]
        normalized=normalize(body)
        (cache/f"{row['id']}.normalized.txt").write_bytes(normalized.encode('ascii'))
        manifest.append({**row,'sha256':sha,'normalization':'vah-naibbe-ascii-1','start_marker':start,'end_marker':'Project Gutenberg END boundary','normalized_sha256':hashlib.sha256(normalized.encode()).hexdigest(),'characters':len(normalized)})
        print(row['id'],row['split'],len(normalized),flush=True)
    (cache/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
if __name__=='__main__':main()
