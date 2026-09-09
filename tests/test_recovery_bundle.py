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


def rewrite_archive(path, target, member, value):
    with zipfile.ZipFile(path) as source:
        files = {name: source.read(name) for name in source.namelist()}
    files[member] = value if isinstance(value, bytes) else json.dumps(value, separators=(',', ':')).encode()
    if member != 'archive-manifest.json':
        manifest = json.loads(files['archive-manifest.json'])
        row = next(row for row in manifest['files'] if row['path'] == member)
        row['bytes'] = len(files[member])
        row['sha256'] = hashlib.sha256(files[member]).hexdigest()
        files['archive-manifest.json'] = json.dumps(manifest, separators=(',', ':')).encode()
    with zipfile.ZipFile(target, 'w') as output:
        for name, value in files.items():
            output.writestr(name, value)


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
    with pytest.raises(ValueError, match='Unsupported recovery archive version'):
        bundle.verify_archive(archive('valid.zip', content))
    with pytest.raises(ValueError, match='bytes differ'):
        bundle.verify_archive(archive('changed.zip', b'changed research evidence'))
    with pytest.raises(ValueError, match='unsafe paths'):
        bundle.verify_archive(archive('unsafe.zip', content, True))


@pytest.mark.parametrize('change_report', [False, True])
def test_complete_bundle_includes_original_text_and_interruption_evidence(tmp_path, monkeypatch, change_report):
    from types import SimpleNamespace
    from panel import save
    root, worker, custodian, audit, retries, sources = [tmp_path / name for name in
        ('project', 'worker', 'custodian', 'audit', 'retries', 'sources')]
    for path in (root / 'research/recovery', worker / 'ciphertexts', custodian, audit, retries, sources):
        path.mkdir(parents=True)
    monkeypatch.setattr(bundle, 'ROOT', root)
    binary = root / 'frozen.exe'; binary.write_bytes(b'fixture executable')
    spec = {'starts': [1]}
    answers = {'version': 'vah-recovery-answers-1', 'spec_digest': bundle.digest(spec), 'cases': {}}
    save(custodian / 'answers.json', answers)
    model = {'fixture': 'model'}
    save(worker / 'models/latin.json', model)
    (worker / 'ciphertexts/fixture.txt').write_bytes(b'original spaced ciphertext')
    case = {'id': 'fixture', 'language': 'latin', 'ciphertext': [1]}
    save(worker / 'cases/fixture-message.json', case)
    manifest = {'version': 'vah-recovery-inputs-1', 'cases': [{'id': 'fixture', 'path': 'cases/fixture-message.json',
        'digest': bundle.digest(case), 'original_ciphertext_digest': bundle.file_digest(worker / 'ciphertexts/fixture.txt')}],
        'models': {'latin': {'path': 'models/latin.json', 'digest': bundle.digest(model)}}, 'spec': spec,
        'answers_commitment': bundle.digest(answers), 'kernel_digest': bundle.file_digest(binary), 'preparation_failures': []}
    manifest['spec_digest'] = bundle.digest(spec)
    save(worker / 'manifest.json', manifest)
    save(root / 'research/recovery/evaluation-v1.preparation.json', {'version': 'vah-recovery-preparation-1',
        'worker_manifest_sha256': bundle.file_digest(worker / 'manifest.json').removeprefix('sha256:'),
        'spec_digest': manifest['spec_digest'], 'answers_commitment': manifest['answers_commitment'], 'freeze_commit': 'fixture'})
    save(root / 'research/recovery/evaluation-v1.freeze.json', {'version': 'vah-recovery-freeze-1',
        'kernel_digest': manifest['kernel_digest'], 'spec_digest': manifest['spec_digest']})
    for name in ('LICENSE', 'pyproject.toml', 'docs/LICENSING.md', 'docs/SCIENTIFIC-CORRECTIONS.md', 'docs/RESEARCH_PROTOCOL.md'):
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('fixture')
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
    report = {**binding, 'version': 'vah-recovery-report-2', 'complete': True, 'spec': manifest['spec'], 'spec_digest': manifest['spec_digest'], 'kernel_digest': manifest['kernel_digest'], 'answers_commitment': manifest['answers_commitment'], 'coverage': {'expected_searches': 2, 'recorded_searches': 2,
        'unrecorded_searches': 0, 'successful_executions': 0, 'operational_failures': 2},
        'operational_failures': [{'interruption': {'evidence': [evidence]}}]}
    report_path = tmp_path / 'report.json'; save(report_path, report)
    # Summary calculation is checked against real reports in test_recovery_summary.
    # This fixture isolates archive membership and binding to exact report bytes.
    monkeypatch.setattr(bundle, 'summarize', lambda actual: {'fixture_analysis': actual['coverage']})
    save(audit / 'replay-report.json', {**binding, 'version': 'vah-panel-replay-2', 'original_kernel_digest': manifest['kernel_digest'], 'all_recorded_successes_reproduced': True,
        'records': [{'run': name, 'status': 'original-operational-failure'} for name in ('first.json', 'second.json')],
        'supplemental': {'all_outputs_reproduced': True, 'records_digest': 'sha256:' + retry_ledger.hexdigest(),
            'records': [{'run': name, 'status': 'supplemental-operational-failure'} for name in ('first.json', 'second.json')]}})
    def archive_source(command, **_):
        Path(command[command.index('--output') + 1]).write_bytes(b'fixture source archive')
        if change_report:
            report_path.write_text('{}')
    monkeypatch.setattr(bundle.subprocess, 'run', archive_source)
    monkeypatch.setattr(bundle.subprocess, 'check_output', lambda *_args, **_kwargs: 'fixture\n')
    out = tmp_path / 'complete'
    args = SimpleNamespace(worker=worker, custodian=custodian, audit=audit, retries=retries,
        sources=sources, binary=binary, report=report_path, out=out)
    if change_report:
        with pytest.raises(ValueError, match='Report changed'):
            bundle.build_bundle(args)
        assert not (out / 'verification.json').exists()
        return
    bundle.build_bundle(args)
    assert (out / 'verification.json').exists()
    with zipfile.ZipFile(out / 'evaluation-v1.zip') as archive:
        assert archive.read('worker/ciphertexts/fixture.txt') == b'original spaced ciphertext'
        assert archive.read('worker/incidents/stopped/native-stderr.txt') == b'interruption evidence'
        analysis = json.loads(archive.read('reports/evaluation-analysis.json'))
        assert analysis['source_report_digest'] == bundle.file_digest(report_path)
        assert analysis['fixture_analysis'] == report['coverage']
    archive_path = out / 'evaluation-v1.zip'
    with zipfile.ZipFile(archive_path) as archive:
        archive_manifest = json.loads(archive.read('archive-manifest.json'))
        analysis = json.loads(archive.read('reports/evaluation-analysis.json'))
        freeze = json.loads(archive.read('reporting-tools/research/recovery/evaluation-v1.freeze.json'))
        preparation = json.loads(archive.read('reporting-tools/research/recovery/evaluation-v1.preparation.json'))
        worker = json.loads(archive.read('worker/manifest.json'))
        replay = json.loads(archive.read('audit/replay-report.json'))
    rewrite_archive(archive_path, out / 'changed-analysis.zip', 'reports/evaluation-analysis.json', {**analysis, 'source_report_digest': 'sha256:changed'})
    with pytest.raises(ValueError, match='analysis differs'):
        bundle.verify_archive(out / 'changed-analysis.zip')
    rewrite_archive(archive_path, out / 'changed-freeze.zip', 'reporting-tools/research/recovery/evaluation-v1.freeze.json', {**freeze, 'spec_digest': 'changed'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-freeze.zip')
    rewrite_archive(archive_path, out / 'changed-preparation.zip', 'reporting-tools/research/recovery/evaluation-v1.preparation.json',
                    {**preparation, 'answers_commitment': 'sha256:changed'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-preparation.zip')
    rewrite_archive(archive_path, out / 'changed-preparation-spec.zip', 'reporting-tools/research/recovery/evaluation-v1.preparation.json',
                    {**preparation, 'spec_digest': 'sha256:changed'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-preparation-spec.zip')
    rewrite_archive(archive_path, out / 'changed-preparation-version.zip', 'reporting-tools/research/recovery/evaluation-v1.preparation.json',
                    {**preparation, 'version': 'unknown'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-preparation-version.zip')
    rewrite_archive(archive_path, out / 'changed-model.zip', 'worker/models/latin.json', {'fixture': 'forged model'})
    with pytest.raises(ValueError, match='worker model differs'):
        bundle.verify_archive(out / 'changed-model.zip')
    rewrite_archive(archive_path, out / 'changed-case.zip', 'worker/cases/fixture-message.json', {'id': 'fixture', 'language': 'latin', 'ciphertext': [2]})
    with pytest.raises(ValueError, match='worker case differs'):
        bundle.verify_archive(out / 'changed-case.zip')
    rewrite_archive(archive_path, out / 'changed-ciphertext.zip', 'worker/ciphertexts/fixture.txt', b'forged ciphertext')
    with pytest.raises(ValueError, match='original ciphertext differs'):
        bundle.verify_archive(out / 'changed-ciphertext.zip')
    rewrite_archive(archive_path, out / 'changed-worker.zip', 'worker/manifest.json', {**worker, 'kernel_digest': 'changed'})
    with pytest.raises(ValueError, match='different worker manifest'):
        bundle.verify_archive(out / 'changed-worker.zip')
    changed_report = out / 'changed-report-source.zip'
    rewrite_archive(archive_path, changed_report, 'reports/evaluation.json', {**report, 'spec': {'starts': [2]}})
    with zipfile.ZipFile(changed_report) as archive:
        changed_analysis = json.loads(archive.read('reports/evaluation-analysis.json'))
        report_digest = 'sha256:' + hashlib.sha256(archive.read('reports/evaluation.json')).hexdigest()
    rewrite_archive(changed_report, out / 'changed-report.zip', 'reports/evaluation-analysis.json', {**changed_analysis, 'source_report_digest': report_digest})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-report.zip')
    rewrite_archive(archive_path, out / 'changed-replay.zip', 'audit/replay-report.json', {**replay, 'original_records_digest': 'changed'})
    with pytest.raises(ValueError, match='same original records'):
        bundle.verify_archive(out / 'changed-replay.zip')
    rewrite_archive(archive_path, out / 'changed-replay-kernel.zip', 'audit/replay-report.json', {**replay, 'original_kernel_digest': 'changed'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-replay-kernel.zip')
    rewrite_archive(archive_path, out / 'changed-executable.zip', 'executable/frozen.exe', b'forged executable')
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-executable.zip')
    rewrite_archive(archive_path, out / 'changed-answers.zip', 'retired-answers/answers.json', {'fixture': 'forged answer'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-answers.zip')
    rewrite_archive(archive_path, out / 'changed-manifest.zip', 'archive-manifest.json', {**archive_manifest, 'kernel_digest': 'changed'})
    with pytest.raises(ValueError, match='provenance differs'):
        bundle.verify_archive(out / 'changed-manifest.zip')
    missing_version = {key: value for key, value in archive_manifest.items() if key != 'version'}
    rewrite_archive(archive_path, out / 'missing-version.zip', 'archive-manifest.json', missing_version)
    with pytest.raises(ValueError, match='Unsupported recovery archive version'):
        bundle.verify_archive(out / 'missing-version.zip')
