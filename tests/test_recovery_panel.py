import copy
import importlib.util
from pathlib import Path
import sys

import pytest

directory = Path(__file__).parents[1] / 'research/recovery'
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location('recovery_panel', directory / 'panel.py')
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)


def test_final_panel_cannot_silently_reduce_cases_or_omit_controls():
    spec = panel.load(directory / 'panel-development.json')
    spec['split'] = 'evaluation'
    with pytest.raises(ValueError, match='100 new'):
        panel.validate_spec(spec)
    spec['cases'] = 100
    panel.validate_spec(spec)
    spec['controls'] = ['message']
    with pytest.raises(ValueError, match='comparison'):
        panel.validate_spec(spec)


def test_encoder_uses_valid_balanced_keys_and_hides_key_from_job():
    cipher, key, _ = panel.encode('abcabc', 'balanced-homophonic', 928764, None, None)
    inverse = {symbol: letter for letter in range(23) for symbol in key[letter * 2:letter * 2 + 2]}
    assert ''.join(panel.ALPHABET[inverse[c]] for c in cipher) == 'abcabc'
    assert sorted(key) == list(range(46))


def test_report_rechecks_actual_decoder_output_and_score():
    job = {'ciphertext': [0, 1, 2, 3], 'symbol_count': 23, 'encoding': 'substitution',
           'algorithm': 'beam-v1', 'iterations': 100, 'model': {'quadgrams': [-17] * 23**4}}
    result = {'job_digest': panel.digest(job), 'result_digest': '', 'key': list(range(23)),
              'plaintext': 'abcd', 'score': -17, 'algorithm': 'beam-v1', 'evaluations': 40}
    result['result_digest'] = panel.digest(result)
    panel.validate_result(job, result)
    for field, value in [('plaintext', 'test'), ('score', 0), ('evaluations', 101)]:
        tampered = copy.deepcopy(result)
        tampered[field] = value
        tampered['result_digest'] = ''
        tampered['result_digest'] = panel.digest(tampered)
        with pytest.raises(ValueError):
            panel.validate_result(job, tampered)


def test_shared_model_encoding_preserves_the_native_canonical_identity():
    job = panel.load(Path(__file__).parents[1] / 'platform/tests/fixtures/search-job.json')
    assert panel.canonical_job(job) == panel.rfc8785.dumps(job)
    assert panel.job_digest(job, panel.rfc8785.dumps(job['model'])) == panel.digest(job)


def test_run_rejects_wrong_explicit_executable_before_locking_or_computing(tmp_path):
    from types import SimpleNamespace
    worker = tmp_path / 'worker'; worker.mkdir()
    binary = tmp_path / 'binary'; binary.write_bytes(b'wrong executable')
    panel.save(worker / 'manifest.json', {'kernel_digest': 'sha256:' + '0' * 64})
    with pytest.raises(ValueError, match='executable differs'):
        panel.run_panel(SimpleNamespace(worker=worker, binary=binary, limit=0))
    assert not (worker / '.running').exists()


def test_operational_retry_keeps_original_and_never_retries_successes(tmp_path, monkeypatch):
    from types import SimpleNamespace
    worker = tmp_path / 'worker'; worker.mkdir()
    binary = tmp_path / 'binary'; binary.write_bytes(b'frozen fixture')
    panel.save(worker / 'manifest.json', {'kernel_digest': panel.file_digest(binary), 'spec': {'timeout_seconds': 1}})
    job = {'model': {}, 'fixture': True}
    failed, successful = worker / 'failed.json', worker / 'successful.json'
    panel.save(failed, {'status': 'execution_error', 'job_digest': panel.job_digest(job), 'exit_code': 1})
    panel.save(successful, {'status': 'complete', 'job_digest': panel.job_digest(job)})
    original = failed.read_bytes()
    monkeypatch.setattr(panel, 'jobs', lambda *_: iter([({}, job, failed), ({}, job, successful)]))
    executions = []
    def execute(*_):
        executions.append(1)
        return {'status': 'complete', 'result': {'fixture': True}}
    monkeypatch.setattr(panel, 'execute', execute)
    args = SimpleNamespace(worker=worker, binary=binary, out=tmp_path / 'retry', limit=0)
    panel.retry_panel(args); panel.retry_panel(args)
    assert failed.read_bytes() == original
    assert len(executions) == 1
    assert not (args.out / successful.name).exists()
    assert panel.load(args.out / failed.name)['original_record_digest'] == panel.digest(panel.load(failed))


@pytest.mark.parametrize('interrupted', [False, True])
def test_evaluation_separates_terminal_coverage_from_operational_success(tmp_path, monkeypatch, interrupted):
    from types import SimpleNamespace
    worker, custodian = tmp_path / 'worker', tmp_path / 'custodian'
    worker.mkdir(); custodian.mkdir()
    controls = ['message', 'shuffled', 'generated-unigram']
    rows = [{'id': 'case', 'control': control, 'language': 'latin', 'length': 4, 'family': 'substitution'} for control in controls]
    answers = {'cases': {'case': {'plaintext': 'abcd'}}}; panel.save(custodian / 'answers.json', answers)
    spec = {'starts': [1], 'controls': controls, 'split': 'evaluation'}
    panel.save(worker / 'manifest.json', {'cases': rows, 'answers_commitment': panel.digest(answers), 'kernel_digest': 'fixture',
               'spec': spec, 'spec_digest': panel.digest(spec), 'preparation_failures': []})
    jobs = []
    for row in rows:
        for algorithm in ['beam-v1', 'restart-anneal-v1']:
            job = {'model': {}, 'algorithm': algorithm, 'start': 0}
            path = worker / (row['control'] + algorithm + '.json')
            success = not (row['control'] == 'shuffled' and algorithm == 'beam-v1')
            record = {'case': row, 'algorithm': algorithm, 'start': 0, 'job_digest': panel.job_digest(job),
                      'status': 'complete' if success else 'execution_error', 'exit_code': 0 if success else 1,
                      'elapsed_ms': 1, 'peak_sampled_rss_bytes': 1}
            if success: record['result'] = {'plaintext': 'abcd', 'score': 1, 'result_digest': 'fixture', 'evaluations': 1}
            if not success and interrupted:
                record.update({'elapsed_ms': None, 'exit_code': None, 'peak_sampled_rss_bytes': None,
                               'interruption': {'classification': 'runner-interruption', 'evidence': []}})
            panel.save(path, record); jobs.append((row, job, path))
    monkeypatch.setattr(panel, 'jobs', lambda *_: iter(jobs))
    monkeypatch.setattr(panel, 'validate_result', lambda *_: None)
    out = tmp_path / 'report.json'
    panel.evaluate_panel(SimpleNamespace(worker=worker, custodian=custodian, out=out))
    report = panel.load(out)
    assert report['complete'] and not report['all_searches_succeeded_operationally']
    assert report['coverage'] == {'expected_searches': 6, 'recorded_searches': 6, 'successful_executions': 5, 'operational_failures': 1, 'unrecorded_searches': 0}
    message = next(r for r in report['conditions'] if r['control'] == 'message' and r['algorithm'] == 'beam-v1')
    assert message['controls_scoring_at_least_as_high'] is None  # A failed control cannot certify score separation.
    if interrupted:
        failure = report['operational_failures'][0]
        assert failure['exit_code'] is None and failure['interruption']['classification'] == 'runner-interruption'
        condition = next(r for r in report['conditions'] if r['control'] == 'shuffled' and r['algorithm'] == 'beam-v1')
        assert condition['elapsed_ms'] is None
        assert condition['unmeasured_elapsed_starts'] == 1 and condition['measured_elapsed_ms'] == 0
        assert condition['peak_sampled_rss_bytes'] is None and condition['unmeasured_memory_starts'] == 1
    jobs[-1][2].unlink()
    panel.evaluate_panel(SimpleNamespace(worker=worker, custodian=custodian, out=out))
    partial = panel.load(out)
    assert not partial['complete']
    message = next(r for r in partial['conditions'] if r['control'] == 'message' and r['algorithm'] == 'restart-anneal-v1')
    assert message['controls_scoring_at_least_as_high'] is None


def test_replay_retains_operational_failures_and_rejects_changed_audit_inputs(tmp_path, monkeypatch):
    from types import SimpleNamespace
    worker, out = tmp_path / 'worker', tmp_path / 'audit'
    worker.mkdir()
    binary = tmp_path / 'fixture-worker'; binary.write_bytes(b'fixture only')
    monkeypatch.setattr(panel, 'kernel_path', lambda: binary)
    manifest = {'kernel_digest': panel.file_digest(binary), 'cases': [{}],
                'spec': {'starts': [1], 'timeout_seconds': 1}}
    panel.save(worker / 'manifest.json', manifest)
    job, expected = {'model': {}, 'fixture': True}, {'trace': ['fixture-trace']}
    paths = [worker / 'first.json', worker / 'second.json']
    for path in paths:
        panel.save(path, {'job_digest': panel.job_digest(job), 'status': 'complete', 'result': expected})
    monkeypatch.setattr(panel, 'jobs', lambda *_: iter([({}, job, path) for path in paths]))
    calls = []
    def execute(*_):
        calls.append(1)
        row = {'status': 'timeout' if len(calls) == 1 else 'complete', 'exit_code': -1 if len(calls) == 1 else 0,
               'elapsed_ms': 1, 'peak_sampled_rss_bytes': 1}
        if len(calls) > 1:
            row['result'] = expected
        return row
    monkeypatch.setattr(panel, 'execute', execute)
    args = SimpleNamespace(worker=worker, out=out, limit=0, retry_operational=False)
    with pytest.raises(ValueError, match='Replay differs'):
        panel.replay_panel(args)
    assert panel.load(out / 'first.json')['status'] == 'replay-operational-failure'
    args.retry_operational = True
    panel.replay_panel(args)
    assert panel.load(out / 'replay-report.json')['complete']
    assert panel.load(out / 'first.json')['status'] == 'replay-operational-failure'
    assert len(list((out / 'retries').glob('*.json'))) == 1
    original = panel.load(paths[0]); original['result'] = {'trace': ['changed']}; panel.save(paths[0], original)
    with pytest.raises(ValueError, match='different inputs'):
        panel.replay_panel(args)


def test_replay_includes_supplemental_outputs_without_replacing_original_failures(tmp_path, monkeypatch):
    from types import SimpleNamespace
    worker, retries, out = tmp_path / 'worker', tmp_path / 'supplemental', tmp_path / 'audit'
    worker.mkdir()
    binary = tmp_path / 'binary'; binary.write_bytes(b'frozen fixture')
    manifest = {'kernel_digest': panel.file_digest(binary), 'cases': [{}], 'spec': {'starts': [1], 'timeout_seconds': 1}}
    panel.save(worker / 'manifest.json', manifest)
    job = {'model': {}, 'fixture': True}
    result = {'trace': ['original deterministic trace']}
    failed, successful = worker / 'failed.json', worker / 'successful.json'
    original = {'status': 'execution_error', 'job_digest': panel.job_digest(job), 'exit_code': 1}
    execution = {'status': 'complete', 'job_digest': panel.job_digest(job), 'result': result}
    panel.save(failed, original); panel.save(successful, execution)
    panel.save(retries / failed.name, {'original_run': failed.name, 'original_record_digest': panel.digest(original),
        'kernel_digest': manifest['kernel_digest'], 'execution': execution})
    monkeypatch.setattr(panel, 'jobs', lambda *_: iter([({}, job, failed), ({}, job, successful)]))
    calls = []
    def execute(*_):
        calls.append(1)
        return {**execution, 'exit_code': 0, 'elapsed_ms': 1, 'peak_sampled_rss_bytes': 1}
    monkeypatch.setattr(panel, 'execute', execute)
    args = SimpleNamespace(worker=worker, out=out, binary=binary, supplemental_retries=retries, limit=0, retry_operational=False)
    panel.replay_panel(args)
    report = panel.load(out / 'replay-report.json')
    assert not report['complete'] and report['all_recorded_successes_reproduced']
    assert report['supplemental']['all_outputs_reproduced']
    assert report['coverage']['statuses'] == {'original-operational-failure': 1, 'exact-replay': 1}
    assert panel.load(out / 'supplemental' / failed.name)['status'] == 'exact-replay'
    assert panel.load(failed) == original
    panel.replay_panel(args)
    assert len(calls) == 2
    assert not (out / '.running').exists()


def test_scientific_mismatch_is_preserved_and_cannot_be_retried_away(tmp_path, monkeypatch):
    from types import SimpleNamespace
    worker, out = tmp_path / 'worker', tmp_path / 'audit'
    worker.mkdir()
    binary = tmp_path / 'binary'; binary.write_bytes(b'fixture')
    panel.save(worker / 'manifest.json', {'kernel_digest': panel.file_digest(binary), 'cases': [{}], 'spec': {'starts': [1], 'timeout_seconds': 1}})
    job = {'model': {}}
    path = worker / 'first.json'
    panel.save(path, {'job_digest': panel.job_digest(job), 'status': 'complete', 'result': {'trace': ['expected']}})
    monkeypatch.setattr(panel, 'jobs', lambda *_: iter([({}, job, path)]))
    calls = []
    def execute(*_):
        calls.append(1)
        return {'status': 'complete', 'result': {'trace': ['different']}, 'exit_code': 0, 'elapsed_ms': 1, 'peak_sampled_rss_bytes': 1}
    monkeypatch.setattr(panel, 'execute', execute)
    args = SimpleNamespace(worker=worker, out=out, binary=binary, limit=0, retry_operational=True)
    for _ in range(2):
        with pytest.raises(ValueError, match='Replay differs'):
            panel.replay_panel(args)
        report = panel.load(out / 'replay-report.json')
        assert not report['all_recorded_successes_reproduced'] and report['error']
        assert not (out / '.running').exists()
    assert len(calls) == 1
    assert panel.load(out / path.name)['actual_result']['trace'] == ['different']
    (out / '.running').write_text('another process')
    with pytest.raises(FileExistsError):
        panel.replay_panel(args)
    assert (out / '.running').read_text() == 'another process'
