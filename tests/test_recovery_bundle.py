import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import zipfile

import pytest

directory = Path(__file__).parents[1] / 'research/recovery'
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location('recovery_bundle', directory / 'bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def test_retiring_answers_requires_consistent_complete_execution_and_replay():
    manifest = {'cases': [{}], 'spec': {'starts': [1]}}
    binding = {'worker_manifest_digest': bundle.digest(manifest), 'original_records_digest': 'sha256:fixture'}
    report = {**binding, 'complete': True, 'coverage': {'recorded_searches': 2, 'expected_searches': 2,
        'unrecorded_searches': 0, 'successful_executions': 1, 'operational_failures': 1}}
    replay = {**binding, 'all_recorded_successes_reproduced': True, 'supplemental': {'all_outputs_reproduced': True,
        'records': [{'run': 'failure.json', 'status': 'exact-replay'}]},
        'records': [{'run': 'success.json', 'status': 'exact-replay'}, {'run': 'failure.json', 'status': 'original-operational-failure'}]}
    bundle.validate_ready(manifest, report, replay)
    with pytest.raises(ValueError, match='every planned'):
        bundle.validate_ready(manifest, {**report, 'complete': False}, replay)
    with pytest.raises(ValueError, match='supplemental scientific'):
        bundle.validate_ready(manifest, report, {**replay, 'supplemental': {'all_outputs_reproduced': False}})
    with pytest.raises(ValueError, match='same original records'):
        bundle.validate_ready(manifest, report, {**replay, 'original_records_digest': 'changed'})
    with pytest.raises(ValueError, match='missing or duplicate'):
        bundle.validate_ready(manifest, report, {**replay, 'records': [replay['records'][0]] * 2})
    with pytest.raises(ValueError, match='coverage disagree'):
        bundle.validate_ready(manifest, {**report, 'coverage': {**report['coverage'], 'successful_executions': 2}}, replay)
    with pytest.raises(ValueError, match='Supplemental replay coverage'):
        bundle.validate_ready(manifest, report, {**replay, 'supplemental': {'all_outputs_reproduced': True, 'records': []}})


def test_archive_binds_originals_supplemental_attempts_and_actual_audit_files():
    hashes = {'worker/runs/first.json': 'sha256:original', 'supplemental-attempts/failed.json': 'sha256:retry',
              'audit/first.json': 'sha256:first-audit', 'audit/supplemental/failed.json': 'sha256:retry-audit'}
    def ledger(name, value):
        return 'sha256:' + hashlib.sha256(bundle.rfc8785.dumps([name, value]) + b'\n').hexdigest()
    report = {'original_records_digest': ledger('first.json', 'sha256:original')}
    replay = {'records': [{'run': 'first.json', 'status': 'exact-replay', 'audit_path': 'first.json', 'audit_record_digest': 'sha256:first-audit'}],
        'supplemental': {'records_digest': ledger('failed.json', 'sha256:retry'), 'records': [
            {'run': 'failed.json', 'status': 'exact-replay', 'audit_path': 'supplemental/failed.json', 'audit_record_digest': 'sha256:retry-audit'}]}}
    bundle.verify_evidence_hashes(report, replay, hashes)
    incident_path = 'incidents/stopped/job.json'
    incident_report = {**report, 'operational_failures': [{'interruption': {
        'evidence': [{'path': incident_path, 'sha256': 'retained-job'}]}}]}
    bundle.verify_evidence_hashes(incident_report, replay, {**hashes, 'worker/' + incident_path: 'sha256:retained-job'})
    for evidence_hashes in (hashes, {**hashes, 'worker/' + incident_path: 'sha256:changed'}):
        with pytest.raises(ValueError, match='Interrupted execution evidence'):
            bundle.verify_evidence_hashes(incident_report, replay, evidence_hashes)
    for path in ('worker/runs/first.json', 'supplemental-attempts/failed.json', 'audit/first.json', 'audit/supplemental/failed.json'):
        with pytest.raises(ValueError, match='differs|differ'):
            bundle.verify_evidence_hashes(report, replay, {**hashes, path: 'sha256:changed'})


def test_archive_readback_rejects_changed_bytes_and_unsafe_members(tmp_path):
    content = b'original research evidence'
    manifest = {'files': [{'path': 'worker/runs/result.json', 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
    def archive(name, data, extra=False):
        path = tmp_path / name
        with zipfile.ZipFile(path, 'w') as out:
            out.writestr('archive-manifest.json', json.dumps(manifest))
            out.writestr('worker/runs/result.json', data)
            if extra:
                out.writestr('../outside.json', b'unsafe')
        return path
    assert bundle.verify_archive(archive('valid.zip', content)) == {'verified_files': 1, 'total_bytes': len(content)}
    with pytest.raises(ValueError, match='bytes differ'):
        bundle.verify_archive(archive('changed.zip', b'changed research evidence'))
    with pytest.raises(ValueError, match='unsafe paths'):
        bundle.verify_archive(archive('unsafe.zip', content, True))


def test_complete_bundle_includes_original_text_and_interruption_evidence(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from panel import save
    root, worker, custodian, audit, retries, sources = [tmp_path / name for name in
        ('project', 'worker', 'custodian', 'audit', 'retries', 'sources')]
    for path in (root / 'research/recovery', worker / 'ciphertexts', custodian, audit, retries, sources):
        path.mkdir(parents=True)
    monkeypatch.setattr(bundle, 'ROOT', root)
    binary = root / 'frozen.exe'; binary.write_bytes(b'fixture executable')
    answers = {'fixture': 'retired answer'}; save(custodian / 'answers.json', answers)
    manifest = {'cases': [{}], 'spec': {'starts': [1]}, 'spec_digest': 'fixture',
        'answers_commitment': bundle.digest(answers), 'kernel_digest': bundle.file_digest(binary)}
    save(worker / 'manifest.json', manifest)
    save(root / 'research/recovery/evaluation-v1.preparation.json', {
        'worker_manifest_sha256': bundle.file_digest(worker / 'manifest.json').removeprefix('sha256:'), 'freeze_commit': 'fixture'})
    save(root / 'research/recovery/evaluation-v1.freeze.json', {
        'kernel_digest': manifest['kernel_digest'], 'spec_digest': manifest['spec_digest']})
    for name in ('LICENSE', 'pyproject.toml', 'docs/LICENSING.md', 'docs/SCIENTIFIC-CORRECTIONS.md', 'docs/RESEARCH_PROTOCOL.md'):
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('fixture')
    (worker / 'ciphertexts/original.txt').write_bytes(b'original spaced ciphertext')
    incident = worker / 'incidents/stopped/native-stderr.txt'
    incident.parent.mkdir(parents=True); incident.write_bytes(b'interruption evidence')
    evidence = {'path': incident.relative_to(worker).as_posix(), 'sha256': bundle.file_digest(incident).removeprefix('sha256:')}
    original_ledger, retry_ledger = hashlib.sha256(), hashlib.sha256()
    for name in ('first.json', 'second.json'):
        save(worker / 'runs' / name, {'status': 'execution_error', 'interruption': {'evidence': [evidence]}})
        save(retries / name, {'execution': {'status': 'execution_error'}})
        original_ledger.update(bundle.rfc8785.dumps([name, bundle.file_digest(worker / 'runs' / name)]) + b'\n')
        retry_ledger.update(bundle.rfc8785.dumps([name, bundle.file_digest(retries / name)]) + b'\n')
    binding = {'worker_manifest_digest': bundle.digest(manifest), 'original_records_digest': 'sha256:' + original_ledger.hexdigest()}
    report = {**binding, 'complete': True, 'coverage': {'expected_searches': 2, 'recorded_searches': 2,
        'unrecorded_searches': 0, 'successful_executions': 0, 'operational_failures': 2},
        'operational_failures': [{'interruption': {'evidence': [evidence]}}]}
    report_path = tmp_path / 'report.json'; save(report_path, report)
    save(audit / 'replay-report.json', {**binding, 'all_recorded_successes_reproduced': True,
        'records': [{'run': name, 'status': 'original-operational-failure'} for name in ('first.json', 'second.json')],
        'supplemental': {'all_outputs_reproduced': True, 'records_digest': 'sha256:' + retry_ledger.hexdigest(),
            'records': [{'run': name, 'status': 'supplemental-operational-failure'} for name in ('first.json', 'second.json')]}})
    def archive_source(command, **_):
        Path(command[command.index('--output') + 1]).write_bytes(b'fixture source archive')
    monkeypatch.setattr(bundle.subprocess, 'run', archive_source)
    monkeypatch.setattr(bundle.subprocess, 'check_output', lambda *_args, **_kwargs: 'fixture\n')
    out = tmp_path / 'complete'
    bundle.build_bundle(SimpleNamespace(worker=worker, custodian=custodian, audit=audit, retries=retries,
        sources=sources, binary=binary, report=report_path, out=out))
    assert (out / 'verification.json').exists()
    with zipfile.ZipFile(out / 'evaluation-v1.zip') as archive:
        assert archive.read('worker/ciphertexts/original.txt') == b'original spaced ciphertext'
        assert archive.read('worker/incidents/stopped/native-stderr.txt') == b'interruption evidence'
