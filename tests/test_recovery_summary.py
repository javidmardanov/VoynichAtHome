import copy
import importlib.util
import json
from pathlib import Path

import pytest


directory = Path(__file__).parents[1] / 'research/recovery'
spec = importlib.util.spec_from_file_location('recovery_summary', directory / 'summarize.py')
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


@pytest.fixture
def report():
    return json.loads((directory / 'results/development-2026-09-05/report.json').read_text())


def first_case(report, algorithm='restart-anneal-v1', control='message'):
    case = report['conditions'][0]['id']
    return [r for r in report['conditions'] if r['id'] == case and r['algorithm'] == algorithm and r['control'] == control]


@pytest.mark.parametrize('version', ['vah-recovery-report-1', 'vah-recovery-report-2'])
def test_published_development_oracle_counts_disjoint_work_and_paired_gains(report, version):
    report['version'] = version
    original = copy.deepcopy(report)
    result = summary.summarize(report)
    assert report == original
    assert len(result['conditions']) == 72
    assert result['resources']['expected_searches'] == 3510
    assert result['resources']['successful_evaluations'] == 34863805
    assert result['resources']['elapsed_ms'] == pytest.approx(2920879.4940069783)
    assert [r['exact_at_full_budget'] for r in result['overview']] == [12, 14, 17, 17]
    assert [r['wrong_outputs_above_both_controls'] for r in result['overview']] == [6, 4, 1, 1]
    first, second = [r for r in result['start_comparisons'] if r['scope'] == 'overview']
    assert [first[k] for k in ('comparable_pairs', 'wrong_to_exact', 'exact_to_wrong', 'exact_to_exact', 'wrong_to_wrong')] == [18, 3, 0, 14, 1]
    assert [second[k] for k in ('comparable_pairs', 'wrong_to_exact', 'exact_to_wrong', 'exact_to_exact', 'wrong_to_wrong')] == [18, 0, 0, 17, 1]
    assert first['added_message_resources']['elapsed_ms'] == pytest.approx(106145.99729911424)
    assert second['added_message_resources']['elapsed_ms'] == pytest.approx(838814.8998038378)
    assert first['added_all_comparison_resources']['elapsed_ms'] == pytest.approx(318938.69230058044)
    assert second['added_all_comparison_resources']['elapsed_ms'] == pytest.approx(2525292.0356071554)
    assert first['added_message_resources']['successful_evaluations'] == 1260000
    assert second['added_all_comparison_resources']['successful_evaluations'] == 30240000


def test_missing_searches_retain_observations_without_claiming_full_budget_recovery(report):
    row = first_case(report)[-1]
    row.update(executed_starts=63, complete_starts=62, actual_evaluations=620000)
    report['complete'] = False
    result = summary.summarize(report)
    budget = result['overview'][-1]
    assert budget['observed_outputs']['exact'] == 17
    assert budget['exact_at_full_budget'] == 16
    assert budget['operationally_affected_cases'] == 1 and budget['cases_with_missing_searches'] == 1
    assert result['resources']['operational_failures'] == result['resources']['unrecorded_searches'] == 1
    assert result['resources']['elapsed_ms'] is None
    comparison = result['start_comparisons'][1]
    assert comparison['comparable_pairs'] == 17 and comparison['excluded_pairs'] == 1
    assert comparison['added_message_resources']['elapsed_ms'] is None


def test_shared_unknown_prefix_does_not_hide_measured_suffix_cost(report):
    views = first_case(report)
    original_first = views[0]['elapsed_ms']
    for row in views:
        row.update(measured_elapsed_ms=row['elapsed_ms'] - original_first, elapsed_ms=None, unmeasured_elapsed_starts=1)
    result = summary.summarize(report)
    assert result['resources']['elapsed_ms'] is None
    first, second = result['start_comparisons'][:2]
    assert first['added_message_resources']['elapsed_ms'] == pytest.approx(106145.99729911424)
    assert second['added_message_resources']['elapsed_ms'] == pytest.approx(838814.8998038378)
    views[-1]['unmeasured_elapsed_starts'] = 2
    views[-1]['measured_elapsed_ms'] -= 10
    result = summary.summarize(report)
    assert result['start_comparisons'][1]['added_message_resources']['elapsed_ms'] is None
    assert result['start_comparisons'][1]['added_message_resources']['unmeasured_elapsed_searches'] == 1


def test_recovery_can_regress_when_score_selected_output_changes(report):
    views = first_case(report)
    score = max(r['score'] for r in views) + 1
    for row in views[1:]:
        row.update(score=score, result_digest='new-higher-score-result', exact_recovery=False, character_recovery=.99)
    first = summary.summarize(report)['start_comparisons'][0]
    assert first['wrong_to_exact'] == 3 and first['exact_to_wrong'] == 1
    assert first['net_exact_gain'] == 2


def test_failed_control_cannot_be_interpreted_as_score_separation(report):
    for row in first_case(report, 'beam-v1', 'shuffled'):
        row.update(complete_starts=0, score=None, result_digest=None, actual_evaluations=0)
    beam = summary.summarize(report)['overview'][0]
    assert beam['matched_control_cases'] == 17
    assert beam['wrong_outputs_above_both_controls'] == 5


def test_preparation_failure_keeps_planned_condition_and_denominator(report):
    failed = report['conditions'][0]
    report['conditions'] = [r for r in report['conditions'] if r['id'] != failed['id']]
    report['preparation_failures'].append({k: failed[k] for k in ('id', *summary.DIMENSIONS)})
    result = summary.summarize(report)
    assert result['complete']  # Every prepared search finished; one case never encoded.
    assert result['overview'][0]['planned_cases'] == 18
    assert result['overview'][0]['prepared_cases'] == 17
    assert result['overview'][0]['preparation_failures'] == 1
    failed_cell = next(r for r in result['conditions'] if summary.stratum(r) == summary.stratum(failed))
    assert failed_cell['prepared_cases'] == 0 and failed_cell['preparation_failures'] == 1
    assert failed_cell['mean_character_recovery_at_full_budget'] is None


@pytest.mark.parametrize('error', ['duplicate', 'missing', 'nested', 'beam', 'coverage', 'elapsed', 'evaluations', 'suffix_evaluations', 'tie'])
def test_rejects_ambiguous_or_inconsistent_report_accounting(report, error):
    if error == 'duplicate':
        report['conditions'].append(copy.deepcopy(report['conditions'][0]))
    elif error == 'missing':
        report['conditions'].pop()
    elif error == 'nested':
        first_case(report)[1]['actual_evaluations'] = 0
    elif error == 'beam':
        first_case(report, 'beam-v1')[1]['elapsed_ms'] += 1
    elif error == 'elapsed':
        first_case(report)[0]['measured_elapsed_ms'] = 0
    elif error == 'evaluations':
        first_case(report)[0]['actual_evaluations'] += 1
    elif error == 'suffix_evaluations':
        first_case(report)[0]['actual_evaluations'] -= 1
    elif error == 'tie':
        first_case(report)[1].update(exact_recovery=False, character_recovery=.99)
    else:
        report['coverage'] = {'expected_searches': 0}
    with pytest.raises(ValueError):
        summary.summarize(report)
