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
