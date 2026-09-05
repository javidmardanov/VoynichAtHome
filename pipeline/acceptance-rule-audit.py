"""Read-only numerical audit of VoynichAtHome's committed calibration reports.

Usage: python acceptance-rule-audit.py --repo PATH_TO_CHECKOUT
Uses only Python's standard library; does not run or modify the Rust kernel.
"""
import argparse
import json
import math
from pathlib import Path


def subset_median_distribution(values, n):
    """Exact distribution of an even-n median sampled without replacement."""
    xs = sorted(values)
    m = len(xs)
    assert n % 2 == 0 and 0 < n <= m
    k = n // 2
    total = math.comb(m, n)
    counts = {}
    # Exactly k-1 selected indices below i and k-1 above j; none between.
    for i in range(k - 1, m - k):
        for j in range(i + 1, m - k + 1):
            count = math.comb(i, k - 1) * math.comb(m - j - 1, k - 1)
            median = (xs[i] + xs[j]) / 2
            counts[median] = counts.get(median, 0) + count
    assert sum(counts.values()) == total
    return sorted(counts.items()), total


def quantile_exact(dist, total, numerator=99, denominator=100):
    cumulative = 0
    for value, count in dist:
        cumulative += count
        if cumulative * denominator >= numerator * total:
            return value
    raise AssertionError("Missing quantile")


def binomial_tail(n, p, minimum):
    return sum(math.comb(n, k) * p**k * (1-p)**(n-k)
               for k in range(minimum, n + 1))


def audit(repo):
    results = {"calibration_reports": [], "scale_floors": []}
    for path in sorted((repo / "pipeline/calibration").glob("report-*.json")):
        report = json.loads(path.read_text(encoding="utf-8"))
        threshold = report["rule_c"]["epsilon_median"]
        row = {"file": path.name, "reported_epsilon_N8": threshold,
               "reported_rule_A_hidden_compatible": report["hidden_point"]["acceptance"]["compatible"],
               "reported_rule_A_hidden_k_n": [report["hidden_point"]["acceptance"][key]
                                                for key in ("k", "n")],
               "control_medians": {name: value["rule_c"]["median"]
                                   for name, value in report["controls"].items()}}
        for n in (8, 16):
            dist, total = subset_median_distribution(report["self_distances_raw"], n)
            row[f"exact_finite_pool_q99_N{n}"] = quantile_exact(dist, total)
            row[f"finite_pool_probability_above_reported_threshold_N{n}"] = (
                sum(count for value, count in dist if value > threshold) / total)
        results["calibration_reports"].append(row)
    paths = [repo / "pipeline/targets/fingerprint_v1.json"]
    paths += sorted((repo / "pipeline/calibration").glob("planted-*/fingerprint_v1.json"))
    for path in paths:
        target = json.loads(path.read_text(encoding="utf-8"))["target"]
        results["scale_floors"].append({
            "file": path.relative_to(repo).as_posix(),
            "floor_statistics": [name for name, scale in zip(target["names"], target["scale"])
                                 if scale <= 1.00001e-6]})
    # Analytic counterexample, NOT an estimate of Voynich generator error.
    # Corpus summary is 0 with probability .9, 100 with probability .1.
    # Unit scale, N=8, fixed planted target 0. Even an oracle q99 is 0.
    reject_majority = binomial_tail(8, .1, 4)
    reject_minority = binomial_tail(8, .9, 4)
    results["analytic_two_mode_counterexample"] = {
        "N": 8, "planted_target": 0, "oracle_median_q99": 0,
        "rejection_given_majority_target": reject_majority,
        "rejection_given_minority_target": reject_minority,
        "rejection_across_fresh_true_targets": .9*reject_majority + .1*reject_minority}
    results["zero_errors_one_sided_95pct_upper_bound"] = {
        str(n): 1 - .05**(1/n) for n in (5, 64, 298, 299, 300)}
    results["minimum_zero_error_trials_for_1pct_upper_bound"] = math.ceil(math.log(.05)/math.log(.99))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.repo), indent=2, allow_nan=False))
