"""Prepare, execute, and evaluate auditable recovery panels.

The worker directory contains ciphertexts, models, public search seeds and run
budgets. Answers and encoding randomness live in a separate custodian directory.
This is input separation, not independent administration or an OS sandbox.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import secrets
import subprocess
import sys
import tempfile
import time

import psutil
import rfc8785

from prepare import ROOT, ALPHABET


def digest(value):
    return 'sha256:' + hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def file_digest(path):
    return 'sha256:' + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_job(job, model_bytes=None):
    # Public contract keys are ASCII. Reuse the immutable, already-verified
    # model's canonical bytes; re-encoding 279,841 integers per start otherwise
    # dominates orchestration without changing any scientific computation.
    if any(not key.isascii() for key in job):
        raise ValueError('Search job contract keys must be ASCII')
    encoded_model = model_bytes if model_bytes is not None else rfc8785.dumps(job['model'])
    return b'{' + b','.join(rfc8785.dumps(key) + b':' + (encoded_model if key == 'model' else rfc8785.dumps(job[key])) for key in sorted(job)) + b'}'


def job_digest(job, model_bytes=None):
    return 'sha256:' + hashlib.sha256(canonical_job(job, model_bytes)).hexdigest()


def validate_result(job, result, model_bytes=None):
    if result['job_digest'] != job_digest(job, model_bytes) or result['result_digest'] != digest({**result, 'result_digest': ''}):
        raise ValueError('Native result identity mismatch')
    key = result['key']
    if len(key) != job['symbol_count'] or any(type(c) is not int or not 0 <= c < 23 for c in key):
        raise ValueError('Invalid decoder key')
    counts = Counter(key)
    if job['encoding'] in ('substitution', 'balanced-homophonic') and any(counts[c] != len(key) // 23 for c in range(23)):
        raise ValueError('Decoder violates registered symbol multiplicities')
    symbols = [key[c] for c in job['ciphertext']]
    if result['plaintext'] != ''.join(ALPHABET[c] for c in symbols):
        raise ValueError('Result is not the unchanged decoder output')
    score = sum(job['model']['quadgrams'][((a * 23 + b) * 23 + c) * 23 + d]
                for a, b, c, d in zip(symbols, symbols[1:], symbols[2:], symbols[3:]))
    if score != result['score'] or result['algorithm'] != job['algorithm'] or not 0 <= result['evaluations'] <= job['iterations']:
        raise ValueError('Result score, algorithm, or computation budget differs')


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_bytes(rfc8785.dumps(value))
    temporary.replace(path)


def kernel_path():
    return ROOT / 'kernel/target/release' / ('vah-search.exe' if os.name == 'nt' else 'vah-search')


def validate_spec(spec):
    expected = {'version', 'split', 'cases', 'languages', 'lengths', 'encodings',
                'controls', 'starts', 'iterations', 'beam_width', 'timeout_seconds'}
    if set(spec) != expected or spec['version'] != 'vah-recovery-panel-1':
        raise ValueError('Unsupported panel specification')
    if spec['split'] not in ('development', 'evaluation'):
        raise ValueError('Unsupported source split')
    if type(spec['cases']) is not int or not 1 <= spec['cases'] <= 100:
        raise ValueError('Use 1–100 cases per condition')
    if spec['split'] == 'evaluation' and spec['cases'] != 100:
        raise ValueError('Reported final conditions require 100 new message-and-key cases')
    allowed = {'languages': {'latin', 'italian'}, 'lengths': {1000, 5000, 20000},
               'encodings': {'substitution', 'balanced-homophonic', 'naibbe-global-permutation'},
               'controls': {'message', 'shuffled', 'generated-unigram'}, 'starts': {1, 8, 64}}
    for key, choices in allowed.items():
        values = spec[key]
        if not isinstance(values, list) or not values or len(set(values)) != len(values) or not set(values) <= choices:
            raise ValueError(f'Invalid {key}')
    if spec['starts'] != sorted(spec['starts']) or spec['controls'] != ['message', 'shuffled', 'generated-unigram']:
        raise ValueError('Register ordered budgets and all comparison types')
    for key, lower, upper in [('iterations', 1, 100000), ('beam_width', 1, 64), ('timeout_seconds', 1, 600)]:
        if type(spec[key]) is not int or not lower <= spec[key] <= upper:
            raise ValueError(f'Invalid {key}')
    return spec


def encode(plain, family, private_seed, binary, temp):
    rng = random.Random(private_seed)
    key = list(range(23 if family != 'balanced-homophonic' else 46))
    rng.shuffle(key)
    if family == 'balanced-homophonic':
        cipher = [key[2 * ALPHABET.index(c) + rng.randrange(2)] for c in plain]
        return cipher, key, None
    if family == 'substitution':
        return [key[ALPHABET.index(c)] for c in plain], key, None
    (temp / 'plain.txt').write_text(plain, encoding='ascii')
    save(temp / 'key.json', key)
    subprocess.run([str(binary), 'encode-naibbe', '--input', str(temp / 'plain.txt'),
                    '--key', str(temp / 'key.json'), '--seed', str(private_seed),
                    '--out', str(temp / 'cipher.txt')], check=True, timeout=600, capture_output=True)
    subprocess.run([str(binary), 'parse-naibbe', '--input', str(temp / 'cipher.txt'),
                    '--out', str(temp / 'parsed.json')], check=True, timeout=600, capture_output=True)
    return load(temp / 'parsed.json'), key, (temp / 'cipher.txt').read_text(encoding='ascii')


def prepare_panel(args):
    spec = validate_spec(load(args.spec))
    worker, custodian = args.worker.resolve(), args.custodian.resolve()
    if worker == custodian or worker in custodian.parents or custodian in worker.parents:
        raise ValueError('Worker and custodian directories must be separate, not nested')
    if worker.exists() or custodian.exists():
        raise ValueError('Preparation requires new directories; never overwrite a panel')
    binary = kernel_path()
    frozen = None
    if spec['split'] == 'evaluation':
        if not args.freeze:
            raise ValueError('Freeze settings before final evaluation preparation')
        frozen = load(args.freeze)
        if frozen['spec_digest'] != digest(spec) or frozen['kernel_digest'] != file_digest(binary):
            raise ValueError('Frozen specification or search executable differs')
    cache = ROOT / 'data/recovery'
    sources = load(cache / 'manifest.json')
    # Reject accidental source-work overlap before reading any target messages.
    works = {}
    for source in sources:
        previous = works.setdefault(source['work_id'], source['split'])
        if previous != source['split']:
            raise ValueError('One source work appears in multiple splits')
    worker.mkdir(parents=True)
    custodian.mkdir(parents=True, mode=0o700)
    index = {'version': 'vah-recovery-inputs-1', 'spec': spec, 'spec_digest': digest(spec),
             'kernel_digest': file_digest(binary), 'cases': [], 'models': {}, 'preparation_failures': []}
    answers = {'version': 'vah-recovery-answers-1', 'spec_digest': digest(spec), 'cases': {}}
    with tempfile.TemporaryDirectory(dir=custodian) as directory:
        temp = Path(directory)
        for language in spec['languages']:
            training = next(s for s in sources if s['language'] == language and s['split'] == 'training')
            target = next(s for s in sources if s['language'] == language and s['split'] == spec['split'])
            model_path = cache / f'{language}.model.json'
            model = load(model_path)
            if model['training_sources'] != [training['normalized_sha256']]:
                raise ValueError('Language model training provenance differs')
            model_id = file_digest(model_path)
            save(worker / 'models' / f'{language}.json', model)
            index['models'][language] = {'path': f'models/{language}.json', 'digest': digest(model),
                                         'training': training, 'original_model_file': model_id}
            source_path = cache / (target['id'] + '.normalized.txt')
            if file_digest(source_path) != 'sha256:' + target['normalized_sha256']:
                raise ValueError('Target source bytes changed')
            text = source_path.read_text(encoding='ascii')
            for length in spec['lengths']:
                if len(text) < length:
                    raise ValueError('Target work is too short')
                for family in spec['encodings']:
                    for number in range(spec['cases']):
                        case_id = secrets.token_hex(16)
                        private_seed = secrets.randbits(64)
                        offset = secrets.randbelow(len(text) - length + 1)
                        plain = text[offset:offset + length]
                        metadata = {'id': case_id, 'language': language, 'length': length,
                                    'family': family, 'number': number}
                        answers['cases'][case_id] = {'plaintext': plain, 'encoding_seed': str(private_seed),
                            'source': target, 'offset': offset}
                        try:
                            cipher, key, original = encode(plain, family, private_seed, binary, temp)
                        except (subprocess.SubprocessError, ValueError) as error:
                            index['preparation_failures'].append({**metadata, 'error': str(error)[:300]})
                            continue  # Count the failed case; never replace it with an easier draw.
                        answers['cases'][case_id] = {'plaintext': plain, 'encoding_key': key,
                            'encoding_seed': str(private_seed), 'source': target, 'offset': offset,
                            'published_naibbe_identity_check': family == 'naibbe-global-permutation'}
                        if original is not None:
                            (worker / 'ciphertexts').mkdir(exist_ok=True)
                            (worker / 'ciphertexts' / f'{case_id}.txt').write_text(original, encoding='ascii')
                            metadata['original_ciphertext_digest'] = file_digest(worker / 'ciphertexts' / f'{case_id}.txt')
                            # The published, unrandomized construction is directly invertible
                            # with its documented parser. Record a real identity-key round trip.
                            (temp / 'plain.txt').write_text(plain, encoding='ascii')
                            save(temp / 'key.json', list(range(23)))
                            subprocess.run([str(binary), 'encode-naibbe', '--input', str(temp / 'plain.txt'), '--key', str(temp / 'key.json'), '--seed', str(private_seed), '--out', str(temp / 'published.txt')], check=True, capture_output=True, timeout=600)
                            subprocess.run([str(binary), 'parse-naibbe', '--input', str(temp / 'published.txt'), '--out', str(temp / 'published.json')], check=True, capture_output=True, timeout=600)
                            recovered = ''.join(ALPHABET[c] for c in load(temp / 'published.json'))
                            answers['cases'][case_id]['published_naibbe_identity_check'] = recovered == plain
                            # This published-construction check includes plaintext by design,
                            # so its record remains with the custodian until evaluation closes.
                            answers['cases'][case_id]['published_ciphertext'] = (temp / 'published.txt').read_text(encoding='ascii')
                        comparisons = {'message': cipher}
                        control_rng = random.Random(secrets.randbits(64))
                        shuffled = cipher.copy()
                        control_rng.shuffle(shuffled)
                        comparisons['shuffled'] = shuffled
                        comparisons['generated-unigram'] = control_rng.choices(cipher, k=len(cipher))
                        for control, symbols in comparisons.items():
                            public = {**metadata, 'control': control, 'ciphertext': symbols,
                                      'symbol_count': 46 if family == 'balanced-homophonic' else 23,
                                      'encoding': 'balanced-homophonic' if family == 'balanced-homophonic' else 'substitution',
                                      'search_seed': secrets.randbits(32)}
                            path = f'cases/{case_id}-{control}.json'
                            save(worker / path, public)
                            index['cases'].append({'path': path, 'digest': digest(public), **metadata, 'control': control})
    index['answers_commitment'] = digest(answers)
    save(worker / 'manifest.json', index)
    save(custodian / 'answers.json', answers)
    print(json.dumps({'prepared': len(index['cases']), 'preparation_failures': len(index['preparation_failures']),
                      'answers_commitment': index['answers_commitment']}))


def jobs(worker, manifest):
    spec = manifest['spec']
    models = {}
    for language, row in manifest['models'].items():
        model = load(worker / row['path'])
        if digest(model) != row['digest']:
            raise ValueError('Model integrity mismatch')
        models[language] = model
    for row in manifest['cases']:
        case = load(worker / row['path'])
        if digest(case) != row['digest']:
            raise ValueError('Case integrity mismatch')
        model = models[case['language']]
        for algorithm in ['beam-v1', 'restart-anneal-v1']:
            for start in range(1 if algorithm == 'beam-v1' else max(spec['starts'])):
                job = {'version': 'vah-search-1', 'experiment': manifest['spec_digest'],
                       'ciphertext': case['ciphertext'], 'symbol_count': case['symbol_count'],
                       'encoding': case['encoding'], 'algorithm': algorithm, 'seed': case['search_seed'],
                       'start': start, 'iterations': spec['iterations'], 'beam_width': spec['beam_width'], 'model': model}
                name = f"{case['id']}-{case['control']}-{algorithm}-{start:02}.json"
                yield row, job, worker / 'runs' / name


def execute(job, binary, directory, timeout, model_bytes=None):
    (directory / 'job.json').write_bytes(canonical_job(job, model_bytes))
    result_path = directory / 'result.json'
    result_path.unlink(missing_ok=True)
    began = time.perf_counter()
    peak = 0
    sampled = 0
    with (directory / 'stderr.txt').open('wb') as errors:
        process = subprocess.Popen([str(binary), 'run', '--job', str(directory / 'job.json'),
                                    '--out', str(result_path)], cwd=directory, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=errors)
        monitor = psutil.Process(process.pid)
        timed_out = False
        try:
            while process.poll() is None:
                try:
                    peak = max(peak, monitor.memory_info().rss)
                    sampled += 1
                except psutil.NoSuchProcess:
                    pass
                if time.perf_counter() - began > timeout:
                    timed_out = True
                    process.kill()
                    break
                time.sleep(0.005)
            code = process.wait()
        except BaseException:
            process.kill()
            process.wait()
            raise
    record = {'job_digest': job_digest(job, model_bytes), 'elapsed_ms': (time.perf_counter() - began) * 1000,
              'peak_sampled_rss_bytes': peak or None, 'memory_samples': sampled,
              'measurement': 'Process RSS sampled every 5 ms; may miss peaks. Wall time includes process startup and JSON I/O.',
              'exit_code': code, 'status': 'timeout' if timed_out else 'complete' if code == 0 else 'execution_error'}
    if record['status'] == 'complete':
        result = load(result_path)
        validate_result(job, result, model_bytes)
        record['result'] = result
    else:
        record['error'] = (directory / 'stderr.txt').read_text(encoding='utf-8', errors='replace')[:2000]
    return record


def run_panel(args):
    worker = args.worker.resolve()
    manifest = load(worker / 'manifest.json')
    binary = kernel_path()
    if manifest['kernel_digest'] != file_digest(binary):
        raise ValueError('Recorded native executable differs; preserve the panel toolchain')
    lock = worker / '.running'
    with lock.open('x') as file:
        file.write(str(os.getpid()))
    count = 0
    model, model_bytes = None, None
    try:
        with tempfile.TemporaryDirectory(dir=worker) as directory:
            for row, job, output in jobs(worker, manifest):
                if job['model'] is not model:
                    model, model_bytes = job['model'], rfc8785.dumps(job['model'])
                if output.exists():
                    existing = load(output)
                    if existing['job_digest'] != job_digest(job, model_bytes):
                        raise ValueError('Saved run differs; refusing to overwrite it')
                    continue
                record = execute(job, binary, Path(directory), manifest['spec']['timeout_seconds'], model_bytes)
                record.update({'case': row, 'algorithm': job['algorithm'], 'start': job['start'],
                               'host': {'os': platform.platform(), 'python': platform.python_version(), 'psutil': psutil.__version__},
                               'kernel_digest': manifest['kernel_digest']})
                save(output, record)
                count += 1
                print(json.dumps({'run': output.name, 'status': record['status'], 'elapsed_ms': round(record['elapsed_ms']),
                                  'peak_sampled_rss_bytes': record['peak_sampled_rss_bytes']}), flush=True)
                if args.limit and count >= args.limit:
                    break
    finally:
        lock.unlink()


def evaluate_panel(args):
    worker = args.worker.resolve()
    manifest = load(worker / 'manifest.json')
    answers = load(args.custodian / 'answers.json')
    if digest(answers) != manifest['answers_commitment']:
        raise ValueError('Original answer commitment differs')
    all_records = {}
    model, model_bytes = None, None
    for row, job, path in jobs(worker, manifest):
        if job['model'] is not model:
            model, model_bytes = job['model'], rfc8785.dumps(job['model'])
        key = (row['id'], row['control'], job['algorithm'])
        if path.exists():
            record = load(path)
            if record['job_digest'] != job_digest(job, model_bytes):
                raise ValueError('Run identity differs')
            if record['status'] == 'complete':
                validate_result(job, record['result'], model_bytes)
            all_records.setdefault(key, []).append(record)
    summaries = []
    for row in manifest['cases']:
        plain = answers['cases'][row['id']]['plaintext']
        for algorithm in ['beam-v1', 'restart-anneal-v1']:
            records = all_records.get((row['id'], row['control'], algorithm), [])
            for starts in manifest['spec']['starts']:
                selected = [r for r in records if r['start'] < (1 if algorithm == 'beam-v1' else starts)]
                complete = [r for r in selected if r['status'] == 'complete']
                best = max(complete, key=lambda r: (r['result']['score'], -r['start']), default=None)
                valid_readings = {r['result']['plaintext'] for r in complete}
                summary = {**{k: row[k] for k in ('id', 'language', 'length', 'family', 'control')},
                           'algorithm': algorithm, 'budget_starts': starts, 'executed_starts': len(selected),
                           'complete_starts': len(complete), 'expected_starts': 1 if algorithm == 'beam-v1' else starts,
                           'elapsed_ms': sum(r['elapsed_ms'] for r in selected),
                           'actual_evaluations': sum(r['result']['evaluations'] for r in complete),
                           'peak_sampled_rss_bytes': max((r['peak_sampled_rss_bytes'] or 0 for r in selected), default=0),
                           'distinct_valid_decoder_outputs': len(valid_readings),
                           'tied_best_outputs': len({r['result']['plaintext'] for r in complete if best and r['result']['score'] == best['result']['score']}),
                           'note': 'Beam is deterministic and executes once; additional starts have no defined meaning.' if algorithm == 'beam-v1' else None,
                           'score': best['result']['score'] if best else None,
                           'result_digest': best['result']['result_digest'] if best else None}
                summary['character_recovery'] = (sum(a == b for a, b in zip(plain, best['result']['plaintext'])) / len(plain)
                    if best and row['control'] == 'message' else None)
                summary['exact_recovery'] = best['result']['plaintext'] == plain if best and row['control'] == 'message' else None
                summaries.append(summary)
    # Matched controls use the same number of starts and fixed per-start budget.
    for row in summaries:
        if row['control'] != 'message' or row['score'] is None:
            continue
        controls = [c for c in summaries if c['id'] == row['id'] and c['control'] != 'message'
                    and c['algorithm'] == row['algorithm'] and c['budget_starts'] == row['budget_starts']]
        row['controls_scoring_at_least_as_high'] = sum(c['score'] is not None and c['score'] >= row['score'] for c in controls)
    report = {'version': 'vah-recovery-report-1', 'spec': manifest['spec'], 'spec_digest': manifest['spec_digest'],
              'answers_commitment': manifest['answers_commitment'], 'kernel_digest': manifest['kernel_digest'],
              'administration': 'Project-controlled; concealed from worker inputs, not independently administered.',
              'interpretation': 'Development observations only.' if manifest['spec']['split'] == 'development' else 'Frozen-condition evaluation; generalization is limited to the registered works and encodings.',
              'sampling': 'Random contiguous passages within separate source works. Cases can overlap and do not represent 100 independent source works.',
              'preparation_failures': manifest['preparation_failures'], 'conditions': summaries}
    report['complete'] = bool(summaries) and all(r['executed_starts'] == r['expected_starts'] for r in summaries)
    report['all_searches_succeeded_operationally'] = not manifest['preparation_failures'] and all(r['complete_starts'] == r['expected_starts'] for r in summaries)
    save(args.out, report)
    print(json.dumps({'complete': report['complete'], 'rows': len(summaries), 'report': str(args.out)}))


def freeze_settings(args):
    spec = validate_spec(load(args.spec))
    development = load(args.development_report)
    if spec['split'] != 'evaluation' or development['spec']['split'] != 'development' or not development['complete']:
        raise ValueError('Complete the development panel before freezing a 100-case evaluation')
    if any(p['split'] == 'evaluation' for p in load(ROOT / 'data/recovery/manifest.json')):
        raise ValueError('Evaluation texts were already fetched; record exposure and design a fresh source split')
    for source in load(Path(__file__).parent / 'sources.json')['sources']:
        if source['split'] == 'evaluation' and any(path.exists() for path in [ROOT / 'data/recovery' / ('pg' + source['work_id'] + '.txt'), ROOT / 'data/recovery' / (source['id'] + '.normalized.txt')]):
            raise ValueError('Evaluation source files already exist; record exposure instead of erasing it')
    if args.out.exists():
        raise ValueError('Never overwrite a freeze record; start a new version')
    save(args.out, {'version': 'vah-recovery-freeze-1', 'spec_digest': digest(spec),
        'kernel_digest': file_digest(kernel_path()), 'development_report_digest': digest(development),
        'frozen_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'selection': 'Highest fixed integer n-gram score, earliest start breaks ties; no answer-based selection.',
        'reporting': 'Every condition and operational failure; character recovery, alternative decoder outputs, matched control scores, time, and sampled RSS.',
        'administration': 'Project-controlled, not independently administered.'})
    print('Settings frozen; publish this record before fetching evaluation works.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--spec', type=Path, required=True)
    prepare.add_argument('--worker', type=Path, required=True)
    prepare.add_argument('--custodian', type=Path, required=True)
    prepare.add_argument('--freeze', type=Path)
    run = commands.add_parser('run')
    run.add_argument('--worker', type=Path, required=True)
    run.add_argument('--limit', type=int, default=0)
    evaluate = commands.add_parser('evaluate')
    evaluate.add_argument('--worker', type=Path, required=True)
    evaluate.add_argument('--custodian', type=Path, required=True)
    evaluate.add_argument('--out', type=Path, required=True)
    freeze = commands.add_parser('freeze')
    freeze.add_argument('--spec', type=Path, required=True)
    freeze.add_argument('--development-report', type=Path, required=True)
    freeze.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    {'prepare': prepare_panel, 'run': run_panel, 'evaluate': evaluate_panel, 'freeze': freeze_settings}[args.command](args)


if __name__ == '__main__':
    main()
