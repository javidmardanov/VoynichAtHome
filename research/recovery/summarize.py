"""Derive recovery and additional-start costs from a report, without worker inputs or answers."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from itertools import product
import json
import math
from pathlib import Path


DIMENSIONS = ('language', 'family', 'length')
ALGORITHMS = ('beam-v1', 'restart-anneal-v1')
COUNTS = ('expected_starts', 'executed_starts', 'complete_starts', 'actual_evaluations')


def stratum(row):
    return tuple(row[k] for k in DIMENSIONS)


def identity(row):
    return row['id'], row['control'], row['algorithm'], row['budget_starts']


def measured(row):
    return row.get('measured_elapsed_ms', row['elapsed_ms'])


def resources(rows):
    """Totals for disjoint executions only; callers remove nested budget views."""
    totals = {key: sum(r[key] for r in rows) for key in COUNTS}
    unknown = sum(r.get('unmeasured_elapsed_starts', 0) for r in rows)
    elapsed = math.fsum(measured(r) for r in rows)
    missing = totals['expected_starts'] - totals['executed_starts']
    return {'expected_searches': totals['expected_starts'], 'recorded_searches': totals['executed_starts'],
            'successful_executions': totals['complete_starts'],
            'operational_failures': totals['executed_starts'] - totals['complete_starts'],
            'unrecorded_searches': missing, 'successful_evaluations': totals['actual_evaluations'],
            'elapsed_ms': None if missing or unknown else elapsed,
            'measured_elapsed_ms': elapsed, 'unmeasured_elapsed_searches': unknown}


def suffix(before, after):
    """Nested prefixes share failures: subtract measured time and unknown counts separately."""
    result = {key: after[key] - before[key] for key in COUNTS}
    result['elapsed_ms'] = measured(after) - measured(before)
    result['unmeasured_elapsed_starts'] = after.get('unmeasured_elapsed_starts', 0) - before.get('unmeasured_elapsed_starts', 0)
    if (any(result[k] < 0 for k in COUNTS) or result['elapsed_ms'] < -1e-6
            or not 0 <= result['complete_starts'] <= result['executed_starts'] <= result['expected_starts']
            or not 0 <= result['unmeasured_elapsed_starts'] <= result['executed_starts']):
        raise ValueError('Inconsistent nested execution counts or measurements')
    result['elapsed_ms'] = max(0, result['elapsed_ms'])
    return result


def validate(report):
    if report.get('version') not in ('vah-recovery-report-1', 'vah-recovery-report-2'):
        raise ValueError('Unsupported recovery report version')
    spec, rows = report['spec'], report['conditions']
    starts, controls = spec['starts'], spec['controls']
    if starts != [1, 8, 64] or controls != ['message', 'shuffled', 'generated-unigram']:
        raise ValueError('Expected registered 1/8/64 budgets and both controls')
    cells = list(product(spec['languages'], spec['encodings'], spec['lengths']))
    if (len(cells) != len(set(cells)) or type(spec['cases']) is not int or spec['cases'] < 1
            or type(spec['iterations']) is not int or spec['iterations'] < 1):
        raise ValueError('Invalid registered case counts')
    cases, index = {}, {}
    for row in rows:
        key = identity(row)
        if key in index or key[1] not in controls or key[2] not in ALGORITHMS or key[3] not in starts:
            raise ValueError('Duplicate or unexpected condition identity')
        index[key] = row
        if stratum(row) not in cells or cases.setdefault(row['id'], stratum(row)) != stratum(row):
            raise ValueError('Case metadata differs from registered conditions')
        if any(type(row[k]) is not int or row[k] < 0 for k in COUNTS):
            raise ValueError('Invalid execution counts')
        if (row['expected_starts'] != (1 if row['algorithm'] == 'beam-v1' else row['budget_starts'])
                or not 0 <= row['complete_starts'] <= row['executed_starts'] <= row['expected_starts']
                or row['actual_evaluations'] > row['complete_starts'] * spec['iterations']):
            raise ValueError('Invalid execution coverage')
        unknown = row.get('unmeasured_elapsed_starts', 0)
        if (type(unknown) is not int or not 0 <= unknown <= row['executed_starts']
                or (row['elapsed_ms'] is None) != bool(unknown)
                or type(measured(row)) not in (int, float) or not math.isfinite(measured(row)) or measured(row) < 0
                or (row['elapsed_ms'] is not None and (type(row['elapsed_ms']) not in (int, float) or row['elapsed_ms'] != measured(row)))):
            raise ValueError('Invalid elapsed-time measurements')
        has_output = row['complete_starts'] > 0
        if has_output != (row['score'] is not None):
            raise ValueError('Output and execution coverage disagree')
        if has_output and (type(row['score']) is not int or not row['result_digest']):
            raise ValueError('Invalid selected scientific output')
        if row['control'] == 'message' and has_output:
            if (type(row['exact_recovery']) is not bool or type(row['character_recovery']) not in (int, float)
                    or not 0 <= row['character_recovery'] <= 1
                    or row['exact_recovery'] != (row['character_recovery'] == 1)):
                raise ValueError('Invalid recovery observation')
        elif row['exact_recovery'] is not None or row['character_recovery'] is not None:
            raise ValueError('Unavailable outputs and controls have no recovery observation')
    failures = report['preparation_failures']
    failure_ids = [r['id'] for r in failures]
    if len(set(failure_ids)) != len(failure_ids) or set(failure_ids) & cases.keys() or any(stratum(r) not in cells for r in failures):
        raise ValueError('Invalid preparation-failure identities')
    for cell in cells:
        if sum(s == cell for s in cases.values()) + sum(stratum(r) == cell for r in failures) != spec['cases']:
            raise ValueError('Missing registered cases or preparation failures')
    for case in cases:
        for control, algorithm in product(controls, ALGORITHMS):
            views = [index.get((case, control, algorithm, n)) for n in starts]
            if any(row is None for row in views):
                raise ValueError('Missing condition rows; incomplete execution still requires all budget views')
            if algorithm == 'beam-v1':
                # Only the display budget and old/new derived control counts may differ.
                normalized = [{k: v for k, v in r.items() if k not in ('budget_starts', 'controls_scoring_at_least_as_high')} for r in views]
                if any(r != normalized[0] for r in normalized[1:]):
                    raise ValueError('Deterministic beam budget views disagree')
            else:
                for before, after in zip(views, views[1:]):
                    added = suffix(before, after)
                    if added['actual_evaluations'] > added['complete_starts'] * spec['iterations']:
                        raise ValueError('Added successful evaluations exceed the added execution budget')
                    if before['score'] is not None and (after['score'] is None or after['score'] < before['score']):
                        raise ValueError('Nested best score cannot decrease')
                    if before['score'] == after['score'] and any(before[k] != after[k] for k in ('result_digest', 'exact_recovery', 'character_recovery')):
                        raise ValueError('Tied nested scores must retain the earliest selected output')
    return cells, cases, index


def budget_summary(rows, index, planned, failures):
    full = [r for r in rows if r['complete_starts'] == r['expected_starts']]
    observed = Counter('unavailable' if r['exact_recovery'] is None else 'exact' if r['exact_recovery'] else 'wrong' for r in rows)
    comparisons = []
    for row in rows:
        controls = [index[(row['id'], c, row['algorithm'], row['budget_starts'])] for c in ('shuffled', 'generated-unigram')]
        if all(r['complete_starts'] == r['expected_starts'] for r in [row, *controls]):
            comparisons.append((row, all(row['score'] > c['score'] for c in controls)))
    return {'planned_cases': planned, 'preparation_failures': failures, 'prepared_cases': len(rows),
            'terminal_cases': sum(r['executed_starts'] == r['expected_starts'] for r in rows),
            'fully_successful_budgets': len(full),
            'operationally_affected_cases': sum(r['complete_starts'] < r['executed_starts'] for r in rows),
            'cases_with_missing_searches': sum(r['executed_starts'] < r['expected_starts'] for r in rows),
            'observed_outputs': {k: observed[k] for k in ('exact', 'wrong', 'unavailable')},
            'exact_at_full_budget': sum(r['exact_recovery'] is True for r in full),
            'wrong_at_full_budget': sum(r['exact_recovery'] is False for r in full),
            'mean_character_recovery_at_full_budget': math.fsum(r['character_recovery'] for r in full) / len(full) if full else None,
            'matched_control_cases': len(comparisons),
            'wrong_outputs_above_both_controls': sum(not r['exact_recovery'] and above for r, above in comparisons),
            'message_resources': resources(rows)}


def compare_starts(case_ids, index, before, after):
    pairs = [(index[(case, 'message', 'restart-anneal-v1', before)], index[(case, 'message', 'restart-anneal-v1', after)]) for case in case_ids]
    comparable = [(a, b) for a, b in pairs if all(r['complete_starts'] == r['expected_starts'] for r in (a, b))]
    transitions = Counter(('exact' if a['exact_recovery'] else 'wrong') + '_to_' + ('exact' if b['exact_recovery'] else 'wrong') for a, b in comparable)
    all_pairs = [(index[(case, c, 'restart-anneal-v1', before)], index[(case, c, 'restart-anneal-v1', after)])
                 for case, c in product(case_ids, ('message', 'shuffled', 'generated-unigram'))]
    return {'from_starts': before, 'to_starts': after, 'prepared_pairs': len(pairs), 'comparable_pairs': len(comparable),
            'excluded_pairs': len(pairs) - len(comparable),
            **{k: transitions[k] for k in ('wrong_to_exact', 'exact_to_wrong', 'exact_to_exact', 'wrong_to_wrong')},
            'net_exact_gain': transitions['wrong_to_exact'] - transitions['exact_to_wrong'],
            'mean_character_recovery_change': math.fsum(b['character_recovery'] - a['character_recovery'] for a, b in comparable) / len(comparable) if comparable else None,
            'added_message_resources': resources([suffix(a, b) for a, b in pairs]),
            'added_all_comparison_resources': resources([suffix(a, b) for a, b in all_pairs])}


def summarize(report):
    cells, cases, index = validate(report)
    spec = report['spec']
    conditions, comparisons, overview = [], [], []
    budgets = [('beam-v1', 1), *[('restart-anneal-v1', n) for n in spec['starts']]]
    for cell in [None, *cells]:
        ids = [case for case, value in cases.items() if cell is None or value == cell]
        failed = sum(cell is None or stratum(r) == cell for r in report['preparation_failures'])
        planned = spec['cases'] * (len(cells) if cell is None else 1)
        for algorithm, starts in budgets:
            rows = [index[(case, 'message', algorithm, starts)] for case in ids]
            result = {'algorithm': algorithm, 'effective_starts': starts, **budget_summary(rows, index, planned, failed)}
            if cell is None:
                overview.append(result)
            else:
                conditions.append({**dict(zip(DIMENSIONS, cell)), **result})
        for before, after in zip(spec['starts'], spec['starts'][1:]):
            comparisons.append({'scope': 'overview' if cell is None else 'condition',
                                **(dict(zip(DIMENSIONS, cell)) if cell is not None else {}),
                                **compare_starts(ids, index, before, after)})
    unique = [r for r in index.values() if r['budget_starts'] == (1 if r['algorithm'] == 'beam-v1' else max(spec['starts']))]
    total = resources(unique)
    if 'coverage' in report and any(report['coverage'].get(k) != total[k] for k in ('expected_searches', 'recorded_searches', 'successful_executions', 'operational_failures', 'unrecorded_searches')):
        raise ValueError('Report coverage disagrees with unique execution counts')
    terminal = bool(unique) and total['unrecorded_searches'] == 0
    if bool(report['complete']) != terminal:
        raise ValueError('Report completion flag disagrees with execution coverage')
    return {'version': 'vah-recovery-analysis-1', 'source_report_version': report['version'], 'split': spec['split'],
            'complete': terminal, 'provenance': {k: report[k] for k in ('spec_digest', 'answers_commitment', 'kernel_digest', 'worker_manifest_digest', 'original_records_digest') if k in report},
            'interpretation': 'Descriptive registered-condition observations only. Overlapping passages are not independent source works. No manuscript decipherment or operating range is established.',
            'measurement': 'Nested budgets count once in whole-study resources. Added costs subtract shared prefixes, including their missing measurements. Resource totals include all prepared pairs, including operationally affected pairs excluded from recovery transitions. Successful evaluations exclude aborted work. Wall time includes startup and depends on machine load. Supplemental attempts are excluded.',
            'recovery_policy': 'Observed outputs retain partial-budget results. Full-budget recovery and paired changes require every expected execution to succeed. Control comparisons require full successful message and both control budgets; score separation does not establish correctness.',
            'preparation_failures': report['preparation_failures'], 'resources': total,
            'overview': overview, 'conditions': conditions, 'start_comparisons': comparisons}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    data = args.report.read_bytes()
    result = summarize(json.loads(data))
    result['source_report_digest'] = 'sha256:' + hashlib.sha256(data).hexdigest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(result, output, indent=2, allow_nan=False)
        output.write('\n')
    print(json.dumps({'complete': result['complete'], 'conditions': len(result['conditions']), 'out': str(args.out)}))


if __name__ == '__main__':
    main()
