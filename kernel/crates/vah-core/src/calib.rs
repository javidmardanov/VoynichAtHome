//! Calibration arithmetic: quantiles, binomial confidence bounds and the
//! acceptance rule applied to the replicates of one parameter point.
//!
//! The rule is deliberately simple and fully registered: a point is
//! *compatible* when the lower confidence bound of its acceptance
//! probability `P(d <= epsilon)` exceeds a registered level. A single
//! replicate inside epsilon never decides anything.

use serde::{Deserialize, Serialize};

/// Linear-interpolation quantile of an ascending slice (`q` in 0..=1).
pub fn quantile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let q = q.clamp(0.0, 1.0);
    let pos = q * (sorted.len() - 1) as f64;
    let lo = pos as usize; // floor for non-negative pos
    let hi = (lo + 1).min(sorted.len() - 1);
    let frac = pos - lo as f64;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

/// Sort a copy ascending with a total order.
pub fn sorted(values: &[f64]) -> Vec<f64> {
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    v
}

/// Wilson score interval lower bound for `k` successes in `n` trials at
/// normal quantile `z` (1.959964 for 95%).
pub fn wilson_lower(k: u32, n: u32, z: f64) -> f64 {
    if n == 0 {
        return 0.0;
    }
    let n = n as f64;
    let p = k as f64 / n;
    let z2 = z * z;
    let denom = 1.0 + z2 / n;
    let centre = p + z2 / (2.0 * n);
    let margin = z * libm::sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n));
    ((centre - margin) / denom).max(0.0)
}

/// Wilson score interval upper bound.
pub fn wilson_upper(k: u32, n: u32, z: f64) -> f64 {
    if n == 0 {
        return 1.0;
    }
    let n = n as f64;
    let p = k as f64 / n;
    let z2 = z * z;
    let denom = 1.0 + z2 / n;
    let centre = p + z2 / (2.0 * n);
    let margin = z * libm::sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n));
    ((centre + margin) / denom).min(1.0)
}

/// The registered acceptance rule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    /// Distance threshold.
    pub epsilon: f64,
    /// A point is compatible when the Wilson lower bound of P(d <= epsilon)
    /// exceeds this level.
    pub level: f64,
    /// Normal quantile of the interval (1.959964 = 95%).
    pub z: f64,
}

impl Rule {
    pub fn new(epsilon: f64, level: f64) -> Rule {
        Rule {
            epsilon,
            level,
            z: 1.959964,
        }
    }
}

/// Acceptance of one parameter point.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Acceptance {
    pub k: u32,
    pub n: u32,
    pub p_hat: f64,
    pub lower: f64,
    pub upper: f64,
    pub median: f64,
    pub compatible: bool,
}

/// Apply the rule to the replicate distances of one point.
pub fn acceptance(distances: &[f64], rule: &Rule) -> Acceptance {
    let n = distances.len() as u32;
    let k = distances.iter().filter(|d| **d <= rule.epsilon).count() as u32;
    let lower = wilson_lower(k, n, rule.z);
    let upper = wilson_upper(k, n, rule.z);
    Acceptance {
        k,
        n,
        p_hat: if n == 0 { 0.0 } else { k as f64 / n as f64 },
        lower,
        upper,
        median: vah_stats::median(distances),
        compatible: n > 0 && lower > rule.level,
    }
}

/// Rule B: is the target inside the point's own replicate cloud?
///
/// For each replicate `i`, its distance `r_i` to the leave-one-out centroid
/// of the other replicates is compared with the target's distance `r_t` to
/// the full centroid, both as root-mean-square z-scores under the target's
/// scales. The rank p-value is `(1 + #{i : r_i >= r_t}) / (n + 1)`. This
/// needs no global epsilon and adapts to the spread of each point; a point
/// whose replicates scatter widely is judged by its own scatter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CentroidTest {
    pub n: usize,
    pub r_target: f64,
    pub r_replicates_median: f64,
    pub r_replicates_max: f64,
    pub p_value: f64,
}

pub fn centroid_test(
    fingerprints: &[Vec<f64>],
    target_mean: &[f64],
    scale: &[f64],
) -> Option<CentroidTest> {
    let n = fingerprints.len();
    let dims = target_mean.len();
    if n < 2 || dims == 0 || fingerprints.iter().any(|f| f.len() != dims) || scale.len() != dims {
        return None;
    }
    let mut sum = vec![0.0f64; dims];
    for f in fingerprints {
        for (acc, v) in sum.iter_mut().zip(f) {
            *acc += v;
        }
    }
    let rms = |a: &[f64], b: &[f64]| -> f64 {
        let mut acc = 0.0f64;
        for i in 0..dims {
            let z = (a[i] - b[i]) / scale[i];
            acc += z * z;
        }
        libm::sqrt(acc / dims as f64)
    };
    let centroid: Vec<f64> = sum.iter().map(|v| v / n as f64).collect();
    let r_target = rms(target_mean, &centroid);
    let mut r_reps = Vec::with_capacity(n);
    for f in fingerprints {
        let loo: Vec<f64> = sum
            .iter()
            .zip(f)
            .map(|(s, v)| (s - v) / (n - 1) as f64)
            .collect();
        r_reps.push(rms(f, &loo));
    }
    let farther = r_reps.iter().filter(|r| **r >= r_target).count();
    let sorted_r = sorted(&r_reps);
    Some(CentroidTest {
        n,
        r_target,
        r_replicates_median: vah_stats::median(&r_reps),
        r_replicates_max: sorted_r.last().copied().unwrap_or(0.0),
        p_value: (1 + farther) as f64 / (n + 1) as f64,
    })
}

/// Rule C: median rule. `epsilon_median` is a high quantile of the medians
/// of random `n`-subsets of the true generator's self-distances, so that a
/// heavy tail of degenerate replicates does not inflate the threshold. A
/// point is compatible when the median of its `n` replicate distances is at
/// or below `epsilon_median`. Deterministic: subsets are drawn with the
/// kernel's own random source from `seed`.
pub fn subset_median_quantile(
    self_distances: &[f64],
    n: usize,
    q: f64,
    draws: u32,
    seed: u64,
) -> f64 {
    if self_distances.is_empty() || n == 0 {
        return 0.0;
    }
    let n = n.min(self_distances.len());
    let mut rng = vah_generators::Rng::new("subset-median", seed);
    let mut medians = Vec::with_capacity(draws as usize);
    let mut pool: Vec<f64> = self_distances.to_vec();
    for _ in 0..draws {
        // partial Fisher-Yates: the first n entries are a random subset
        for i in 0..n {
            let j = i + rng.below(pool.len() - i);
            pool.swap(i, j);
        }
        medians.push(vah_stats::median(&pool[..n]));
    }
    quantile(&sorted(&medians), q)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantiles() {
        let v = sorted(&[3.0, 1.0, 2.0, 4.0]);
        assert_eq!(quantile(&v, 0.0), 1.0);
        assert_eq!(quantile(&v, 1.0), 4.0);
        assert_eq!(quantile(&v, 0.5), 2.5);
        assert!((quantile(&v, 0.99) - 3.97).abs() < 1e-12);
        assert_eq!(quantile(&[], 0.5), 0.0);
    }

    #[test]
    fn wilson_bounds_are_sane() {
        let z = 1.959964;
        assert!((wilson_lower(8, 8, z) - 0.6756).abs() < 1e-3);
        assert!((wilson_lower(7, 8, z) - 0.5291).abs() < 1e-3);
        assert!((wilson_lower(0, 8, z)).abs() < 1e-12);
        assert!((wilson_upper(0, 8, z) - 0.3244).abs() < 1e-3);
        assert_eq!(wilson_lower(0, 0, z), 0.0);
        assert!(wilson_lower(50, 100, z) < 0.5 && wilson_upper(50, 100, z) > 0.5);
    }

    #[test]
    fn centroid_test_ranks_target_against_replicates() {
        let scale = vec![1.0, 1.0];
        // replicates scattered around (0,0); target at the centre -> high p
        let reps = vec![
            vec![1.0, 0.0],
            vec![-1.0, 0.0],
            vec![0.0, 1.0],
            vec![0.0, -1.0],
        ];
        let t = centroid_test(&reps, &[0.0, 0.0], &scale).unwrap();
        assert_eq!(t.n, 4);
        assert_eq!(t.r_target, 0.0);
        assert_eq!(t.p_value, 1.0);
        // target far away -> lowest possible p = 1/(n+1)
        let t = centroid_test(&reps, &[10.0, 10.0], &scale).unwrap();
        assert!((t.p_value - 0.2).abs() < 1e-12);
        assert!(centroid_test(&reps[..1], &[0.0, 0.0], &scale).is_none());
        assert!(centroid_test(&reps, &[0.0], &scale).is_none());
    }

    #[test]
    fn subset_median_quantile_is_robust_to_a_heavy_tail() {
        let mut d: Vec<f64> = (0..60).map(|i| 1.0 + i as f64 * 0.02).collect(); // 1.0 .. 2.18
        d.extend_from_slice(&[50.0, 200.0, 900.0, 5000.0]); // 4 degenerate replicates of 64
        let e = subset_median_quantile(&d, 8, 0.99, 2000, 1);
        assert!(e > 1.5 && e < 3.0, "epsilon_median = {e}");
        assert_eq!(
            subset_median_quantile(&d, 8, 0.99, 2000, 1),
            e,
            "deterministic"
        );
        assert_eq!(subset_median_quantile(&[], 8, 0.99, 10, 1), 0.0);
    }

    #[test]
    fn acceptance_rule() {
        let rule = Rule::new(2.0, 0.5);
        let a = acceptance(&[1.0, 1.5, 1.9, 2.0, 0.5, 1.2, 1.8, 1.1], &rule);
        assert_eq!((a.k, a.n), (8, 8));
        assert!(a.compatible);
        let b = acceptance(&[1.0, 1.5, 1.9, 2.5, 0.5, 1.2, 1.8, 3.0], &rule);
        assert_eq!(b.k, 6);
        assert!(!b.compatible, "6/8 has lower bound {:.3}", b.lower);
        let c = acceptance(&[5.0; 8], &rule);
        assert_eq!(c.k, 0);
        assert!(!c.compatible);
        assert_eq!(c.median, 5.0);
        assert!(!acceptance(&[], &rule).compatible);
    }
}
