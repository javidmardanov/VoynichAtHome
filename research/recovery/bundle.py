"""Build and read back a complete frozen-study archive. Does not publish anything.

Answers are admitted only after full original coverage and successful replay,
including supplemental scientific outputs. Reports bind the same original bytes.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile

import rfc8785

from panel import ROOT, digest, file_digest, load
from summarize import summarize


def validate_ready(manifest, report, replay):
    expected = len(manifest['cases']) * (1 + max(manifest['spec']['starts']))
    if (not report.get('complete') or report['coverage']['recorded_searches'] != expected
            or report['coverage']['expected_searches'] != expected or report['coverage']['unrecorded_searches'] != 0):
        raise ValueError('Complete every planned original outcome before retiring answers')
    if (not replay.get('all_recorded_successes_reproduced')
            or not replay.get('supplemental', {}).get('all_outputs_reproduced')):
        raise ValueError('Reproduce every original and supplemental scientific output first')
    for record in (report, replay):
        if record.get('worker_manifest_digest') != digest(manifest):
            raise ValueError('Report belongs to a different worker manifest')
    if not report.get('original_records_digest') or report['original_records_digest'] != replay.get('original_records_digest'):
        raise ValueError('Report and replay do not bind the same original records')
    records = replay['records']
    if len(records) != expected or len({row['run'] for row in records}) != expected:
        raise ValueError('Replay ledger has missing or duplicate originals')
    counts = {status: sum(row['status'] == status for row in records)
              for status in ('exact-replay', 'original-operational-failure')}
    if (counts['exact-replay'] != report['coverage']['successful_executions']
            or counts['original-operational-failure'] != report['coverage']['operational_failures']
            or sum(counts.values()) != expected):
        raise ValueError('Execution and replay coverage disagree')
    supplemental = replay['supplemental'].get('records', [])
    original_failures = {row['run'] for row in records if row['status'] == 'original-operational-failure'}
    if (len(supplemental) != len(original_failures) or {row['run'] for row in supplemental} != original_failures
            or any(row['status'] not in ('exact-replay', 'supplemental-operational-failure') for row in supplemental)):
        raise ValueError('Supplemental replay coverage is missing or inconsistent')


def verify_evidence_hashes(report, replay, hashes):
    for failure in report.get('operational_failures', []):
        for evidence in failure.get('interruption', {}).get('evidence', []):
            path = evidence['path']
            if (not safe_name(path) or not path.startswith('incidents/')
                    or hashes.get('worker/' + path) != 'sha256:' + evidence['sha256']):
                raise ValueError('Interrupted execution evidence is missing or differs from its original record')
    for rows, prefix, expected in (
        (replay['records'], 'worker/runs/', report['original_records_digest']),
        (replay['supplemental']['records'], 'supplemental-attempts/', replay['supplemental']['records_digest']),
    ):
        ledger = hashlib.sha256()
        for row in rows:
            ledger.update(rfc8785.dumps([row['run'], hashes[prefix + row['run']]]) + b'\n')
            if row['status'] == 'exact-replay':
                if hashes['audit/' + row['audit_path']] != row['audit_record_digest']:
                    raise ValueError('Archived replay audit differs from its completed report')
        if 'sha256:' + ledger.hexdigest() != expected:
            raise ValueError('Archived execution bytes differ from the report and replay ledger')
        actual = {name for name in hashes if name.startswith(prefix) and name != 'supplemental-attempts/retry-report.json'}
        if actual != {prefix + row['run'] for row in rows}:
            raise ValueError('Unexpected or missing original or supplemental attempt records')


def safe_name(name):
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and '\\' not in name and ':' not in name and all(p not in ('', '.', '..') for p in path.parts)


def verify_archive(path):
    """Hash each archived file by reading it, without extracting or executing it."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or not all(safe_name(name) for name in names):
            raise ValueError('Archive contains duplicate or unsafe paths')
        manifest = json.loads(archive.read('archive-manifest.json'))
        expected = {row['path']: row for row in manifest['files']}
        if len(expected) != len(manifest['files']) or set(names) != set(expected) | {'archive-manifest.json'}:
            raise ValueError('Archive membership differs from its inventory')
        for name, row in expected.items():
            with archive.open(name) as source:
                actual = hashlib.file_digest(source, 'sha256').hexdigest()
            if actual != row['sha256'] or archive.getinfo(name).file_size != row['bytes']:
                raise ValueError('Archive bytes differ: ' + name)
        if manifest.get('version') != 'vah-recovery-archive-1':
            raise ValueError('Unsupported recovery archive version')
        def evidence(name):
            try:
                return json.loads(archive.read(name))
            except KeyError as error:
                raise ValueError('Archive is missing recovery provenance: ' + name) from error
        hashes = {row['path']: 'sha256:' + row['sha256'] for row in expected.values()}
        worker = evidence('worker/manifest.json')
        report = evidence('reports/evaluation.json')
        analysis = evidence('reports/evaluation-analysis.json')
        replay = evidence('audit/replay-report.json')
        freeze = evidence('reporting-tools/research/recovery/evaluation-v1.freeze.json')
        preparation = evidence('reporting-tools/research/recovery/evaluation-v1.preparation.json')
        answers = evidence('retired-answers/answers.json')
        executables = [name for name in hashes if name.startswith('executable/')]
        if len(executables) != 1:
            raise ValueError('Archive must contain exactly one frozen executable')
        model_paths = set()
        for row in worker.get('models', {}).values():
            path = row.get('path')
            if (not isinstance(path, str) or not path.startswith('models/') or not safe_name(path)
                    or digest(evidence('worker/' + path)) != row.get('digest')):
                raise ValueError('Archived worker model differs from its manifest')
            model_paths.add('worker/' + path)
        case_paths, ciphertext_paths = set(), set()
        for row in worker.get('cases', []):
            path = row.get('path')
            if (not isinstance(path, str) or not path.startswith('cases/') or not safe_name(path)
                    or digest(evidence('worker/' + path)) != row.get('digest')):
                raise ValueError('Archived worker case differs from its manifest')
            case_paths.add('worker/' + path)
            ciphertext_digest = row.get('original_ciphertext_digest')
            if ciphertext_digest is not None:
                case_id = row.get('id')
                ciphertext = 'worker/ciphertexts/' + case_id + '.txt' if isinstance(case_id, str) else ''
                if not ciphertext or hashes.get(ciphertext) != ciphertext_digest:
                    raise ValueError('Archived original ciphertext differs from its manifest')
                ciphertext_paths.add(ciphertext)
        if ({name for name in hashes if name.startswith('worker/models/') and name.endswith('.json')} != model_paths
                or {name for name in hashes if name.startswith('worker/cases/') and name.endswith('.json')} != case_paths
                or {name for name in hashes if name.startswith('worker/ciphertexts/')} != ciphertext_paths):
            raise ValueError('Archived worker inputs differ from their manifest')
        validate_ready(worker, report, replay)
        derived = summarize(report)
        derived['source_report_digest'] = hashes['reports/evaluation.json']
        if analysis != derived:
            raise ValueError('Archived recovery analysis differs from its report')
        if (worker.get('version') != 'vah-recovery-inputs-1'
                or report.get('version') != 'vah-recovery-report-2'
                or replay.get('version') != 'vah-panel-replay-2'
                or freeze.get('version') != 'vah-recovery-freeze-1'
                or preparation.get('version') != 'vah-recovery-preparation-1'
                or answers.get('version') != 'vah-recovery-answers-1'
                or manifest.get('worker_manifest_digest') != digest(worker)
                or manifest.get('original_records_digest') != report['original_records_digest']
                or manifest.get('kernel_digest') != worker['kernel_digest']
                or manifest.get('coverage') != report['coverage']
                or worker.get('spec_digest') != digest(worker.get('spec'))
                or report.get('spec') != worker['spec']
                or report.get('spec_digest') != worker['spec_digest']
                or report.get('kernel_digest') != worker['kernel_digest']
                or report.get('answers_commitment') != worker['answers_commitment']
                or replay.get('original_kernel_digest') != worker['kernel_digest']
                or hashes[executables[0]] != worker['kernel_digest']
                or digest(answers) != worker.get('answers_commitment')
                or answers.get('spec_digest') != worker['spec_digest']
                or freeze.get('kernel_digest') != worker['kernel_digest']
                or freeze.get('spec_digest') != worker['spec_digest']
                or preparation.get('worker_manifest_sha256') != hashes['worker/manifest.json'].removeprefix('sha256:')
                or preparation.get('spec_digest') != worker['spec_digest']
                or preparation.get('answers_commitment') != worker['answers_commitment']
                or manifest.get('frozen_source_commit') != preparation.get('freeze_commit')):
            raise ValueError('Archived recovery provenance differs')
        verify_evidence_hashes(report, replay, hashes)
    return {'verified_files': len(expected), 'total_bytes': sum(row['bytes'] for row in expected.values())}


def build_bundle(args):
    worker, audit, retries = args.worker.resolve(), args.audit.resolve(), args.retries.resolve()
    for directory in (worker, audit, retries):
        if (directory / '.running').exists():
            raise ValueError('Finish active research writers before archiving')
    destination = args.out.resolve()
    # A unique output directory makes an interrupted package visible and prevents
    # replacing a previous candidate. Never include an output in its own inputs.
    for source in (worker, audit, retries, args.custodian.resolve(), args.sources.resolve()):
        if destination == source or source in destination.parents or destination in source.parents:
            raise ValueError('Keep the archive destination separate from its inputs')
    report_bytes = args.report.read_bytes()
    manifest, report, replay = load(worker / 'manifest.json'), json.loads(report_bytes), load(audit / 'replay-report.json')
    validate_ready(manifest, report, replay)
    analysis = summarize(report)
    analysis['source_report_digest'] = 'sha256:' + hashlib.sha256(report_bytes).hexdigest()
    preparation = load(ROOT / 'research/recovery/evaluation-v1.preparation.json')
    freeze = load(ROOT / 'research/recovery/evaluation-v1.freeze.json')
    if (file_digest(worker / 'manifest.json') != 'sha256:' + preparation['worker_manifest_sha256']
            or digest(load(args.custodian / 'answers.json')) != manifest['answers_commitment']
            or file_digest(args.binary) != manifest['kernel_digest']
            or freeze['kernel_digest'] != manifest['kernel_digest'] or freeze['spec_digest'] != manifest['spec_digest']):
        raise ValueError('Frozen executable, manifest, or answer commitment differs')

    sources = {}
    def add(path, name):
        if not safe_name(name) or name in sources or path.is_symlink() or not path.is_file():
            raise ValueError('Unsafe, duplicate, or missing archive input: ' + name)
        sources[name] = path
    def tree(directory, prefix, pattern='*'):
        for path in sorted(directory.rglob(pattern)):
            if path.is_file():
                add(path, prefix + '/' + path.relative_to(directory).as_posix())

    add(worker / 'manifest.json', 'worker/manifest.json')
    for name in ('cases', 'models', 'runs'):
        tree(worker / name, 'worker/' + name, '*.json')
    tree(worker / 'ciphertexts', 'worker/ciphertexts')
    tree(worker / 'incidents', 'worker/incidents')
    tree(audit, 'audit', '*.json')
    tree(retries, 'supplemental-attempts', '*.json')
    tree(args.sources, 'sources')
    add(args.custodian / 'answers.json', 'retired-answers/answers.json')
    add(args.binary, 'executable/' + args.binary.name)
    add(args.report, 'reports/evaluation.json')
    for path in sorted((ROOT / 'research/recovery').iterdir()):
        if path.suffix in ('.py', '.json', '.md'):
            add(path, 'reporting-tools/research/recovery/' + path.name)
    for name in ('LICENSE', 'pyproject.toml', 'docs/LICENSING.md', 'docs/SCIENTIFIC-CORRECTIONS.md', 'docs/RESEARCH_PROTOCOL.md'):
        add(ROOT / name, 'reporting-tools/' + name)

    destination.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(dir=destination) as scratch:
        analysis_path = Path(scratch) / 'evaluation-analysis.json'
        analysis_path.write_text(json.dumps(analysis, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        add(analysis_path, 'reports/evaluation-analysis.json')
        frozen_source = Path(scratch) / 'frozen-source.tar'
        subprocess.run(['git', 'archive', '--format=tar', '--output', str(frozen_source), preparation['freeze_commit']], cwd=ROOT, check=True)
        add(frozen_source, 'provenance/frozen-source.tar')
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        archive_path = destination / 'evaluation-v1.zip'
        inventory = []
        with zipfile.ZipFile(archive_path, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
            for index, (name, source) in enumerate(sorted(sources.items()), 1):
                before = file_digest(source)
                if name == 'reports/evaluation.json' and before != analysis['source_report_digest']:
                    raise ValueError('Report changed after deriving its recovery analysis')
                size = source.stat().st_size
                archive.write(source, name)
                if file_digest(source) != before:
                    raise ValueError('Input changed during archiving: ' + name)
                inventory.append({'path': name, 'sha256': before.removeprefix('sha256:'), 'bytes': size})
                if index % 10000 == 0:
                    print(json.dumps({'archived_files': index, 'total_files': len(sources)}), flush=True)
            hashes = {row['path']: 'sha256:' + row['sha256'] for row in inventory}
            verify_evidence_hashes(report, replay, hashes)
            archive_manifest = {'version': 'vah-recovery-archive-1', 'created_at': datetime.now(timezone.utc).isoformat(),
                'worker_manifest_digest': digest(manifest), 'original_records_digest': report['original_records_digest'],
                'frozen_source_commit': preparation['freeze_commit'], 'reporting_tools_base_commit': revision,
                'kernel_digest': manifest['kernel_digest'], 'coverage': report['coverage'], 'files': inventory,
                'interpretation': 'Complete frozen study; operational retries remain separate. Project-run reproduction is not independent scientific review. No manuscript recovery range is admitted by this archive.'}
            manifest_path = Path(scratch) / 'archive-manifest.json'
            with manifest_path.open('w', encoding='utf-8') as stream:
                json.dump(archive_manifest, stream, separators=(',', ':'), ensure_ascii=False)
            archive.write(manifest_path, 'archive-manifest.json')
        verified = verify_archive(archive_path)
        receipt = {'version': 'vah-recovery-archive-verification-1', 'archive': archive_path.name,
                   'sha256': file_digest(archive_path).removeprefix('sha256:'), 'bytes': archive_path.stat().st_size,
                   **verified, 'verified_at': datetime.now(timezone.utc).isoformat(), 'published': False}
        (destination / 'verification.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        (destination / 'SHA256SUMS').write_text(receipt['sha256'] + '  ' + archive_path.name + '\n', encoding='utf-8')
        print(json.dumps(receipt), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build')
    for name in ('worker', 'custodian', 'sources', 'binary', 'report', 'audit', 'retries', 'out'):
        build.add_argument('--' + name, type=Path, required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    args = parser.parse_args()
    if args.command == 'build':
        build_bundle(args)
    else:
        print(json.dumps(verify_archive(args.archive)))


if __name__ == '__main__':
    main()
