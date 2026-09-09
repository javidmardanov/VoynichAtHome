"""Copy a frozen study to a new private directory and verify every copied byte.

The destination contains concealed answers. Never publish it before evaluation
closes, or include it in a public CI artifact. No source file is modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
from datetime import datetime, timezone


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def preserve(source, destination):
    source, destination = source.resolve(), destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError('Keep private backups outside the source checkout')
    panel = source / 'data/recovery-panel-evaluation-v1'
    if (panel / 'worker/.running').exists():
        raise ValueError('Stop and verify the study process before taking its baseline snapshot')
    preparation = json.loads((source / 'research/recovery/evaluation-v1.preparation.json').read_bytes())
    manifest = json.loads((panel / 'worker/manifest.json').read_bytes())
    binary = source / 'kernel/target/release/vah-search.exe'
    if not binary.exists():
        binary = binary.with_suffix('')
    commitments = {
        panel / 'worker/manifest.json': preparation['worker_manifest_sha256'],
        panel / 'custodian/answers.json': preparation['answers_commitment'].removeprefix('sha256:'),
        binary: manifest['kernel_digest'].removeprefix('sha256:'),
    }
    for path, expected in commitments.items():
        if sha256(path) != expected:
            raise ValueError('Published commitment differs: ' + str(path))
    roots = [panel, source / 'data/recovery', binary,
             source / 'research/recovery/evaluation-v1.freeze.json',
             source / 'research/recovery/evaluation-v1.preparation.json',
             source / 'research/recovery/panel-evaluation-v1.json',
             source / 'research/recovery/sources.json',
             source / 'kernel/rust-toolchain.toml', source / 'kernel/Cargo.lock']
    files = sorted(p for root in roots for p in (root.rglob('*') if root.is_dir() else [root]) if p.is_file())
    destination.mkdir(parents=True, exist_ok=False)
    inventory = []
    for index, path in enumerate(files, 1):
        relative = path.relative_to(source)
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        expected = sha256(path)
        shutil.copy2(path, output)
        if sha256(output) != expected or sha256(path) != expected:
            raise ValueError('Source changed or backup differs: ' + str(relative))
        inventory.append({'path': relative.as_posix(), 'bytes': output.stat().st_size, 'sha256': expected})
        if index % 1000 == 0:
            print(json.dumps({'verified_files': index, 'total_files': len(files)}), flush=True)
    receipt = {'version': 'vah-private-preservation-1', 'created_at': datetime.now(timezone.utc).isoformat(),
               'source': str(source), 'private': True, 'files': inventory,
               'file_count': len(inventory), 'total_bytes': sum(p['bytes'] for p in inventory),
               'worker_manifest_sha256': preparation['worker_manifest_sha256'],
               'kernel_digest': manifest['kernel_digest'], 'complete': True}
    (destination / 'inventory.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in receipt.items() if k not in ('source', 'files')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    preserve(args.source, args.out)
