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
