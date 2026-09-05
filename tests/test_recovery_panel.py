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
