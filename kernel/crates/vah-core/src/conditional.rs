//! Fresh-target Monte Carlo statistic for a fully specified reset generator.
//! Validity depends on exchangeability, which software cannot infer from text.
use crate::{build_target_with, digest_json, CoreError, TargetOptions};
use serde::{Deserialize, Serialize};
use vah_corpus::Corpus;
use vah_generators::{Layout, Params, Resources, Rng};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spec {
    pub version: String,
    pub family: String,
    pub params: Params,
    pub layout: Layout,
    pub resources: Option<Resources>,
    pub target_options: TargetOptions,
    pub reference_count: u32,
    pub simulated_targets: u32,
    pub seed: u64,
    pub alpha: f64,
    /// Only reset is implemented. Selected fragments of a continuing process
    /// cannot silently be treated as reset draws.
    pub initial_state: String,
    pub exposure_record: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub version: String,
    pub spec_digest: String,
    pub observed_digest: String,
    pub reference_fingerprints: Vec<Vec<f64>>,
    pub observed_score: f64,
    pub simulated_scores: Vec<f64>,
    pub rank_p: f64,
    pub rejects_at_declared_alpha: bool,
    pub interpretation: String,
}

/// Conservative upper-tail rank. Empty/nonfinite panels are invalid.
pub fn upper_rank(observed: f64, simulated: &[f64]) -> Result<f64, CoreError> {
    if !observed.is_finite() || simulated.is_empty() || simulated.iter().any(|x| !x.is_finite()) {
        return Err(CoreError::Invalid(
            "rank test requires finite scores and a nonempty panel".into(),
        ));
    }
    Ok(
        (1 + simulated.iter().filter(|x| **x >= observed).count()) as f64
            / (simulated.len() + 1) as f64,
    )
}

/// Build the primary target while excluding supplied line word counts.
/// Legacy target builders deliberately remain unchanged for old fixtures.
pub fn conditional_target(
    corpus: &Corpus,
    opts: &TargetOptions,
) -> Result<vah_stats::Target, CoreError> {
    if opts.covariance_lambda.is_some() {
        return Err(CoreError::Invalid(
            "conditional test v1 supports weighted z only".into(),
        ));
    }
    let mut target = build_target_with(corpus, opts)?;
    for (name, weight) in target.names.iter().zip(&mut target.weight) {
        if name == "line_len_mean" {
            *weight = 0.0;
        }
    }
    target.validate()?;
    Ok(target)
}

pub fn run(spec: &Spec, observed: &Corpus) -> Result<Report, CoreError> {
    if spec.version != "vah-conditional-test-1" || spec.initial_state != "reset" {
        return Err(CoreError::Invalid(
            "unsupported conditional test version or initial state".into(),
        ));
    }
    if !(2..=256).contains(&spec.reference_count)
        || !(19..=9999).contains(&spec.simulated_targets)
        || !(2..=1000).contains(&spec.target_options.resamples)
        || !spec.alpha.is_finite()
        || !(0.0..1.0).contains(&spec.alpha)
        || spec.alpha == 0.0
        || spec.exposure_record.trim().is_empty()
    {
        return Err(CoreError::Invalid(
            "invalid simulation budget, alpha or exposure record".into(),
        ));
    }
    if spec.layout.lines.is_empty()
        || spec.layout.lines.len() > 20_000
        || spec
            .layout
            .lines
            .iter()
            .map(|x| x.words as usize)
            .sum::<usize>()
            > 200_000
        || Layout::from_corpus(observed) != spec.layout
    {
        return Err(CoreError::Invalid(
            "observed layout must match the declared bounded layout".into(),
        ));
    }
    let empty_resources = Resources::default();
    let generator = vah_generators::build(
        &spec.family,
        &spec.params,
        spec.resources.as_ref().unwrap_or(&empty_resources),
    )?;
    let spec_digest = digest_json(spec)?;
    let mut reference_rng = Rng::new(&format!("conditional/reference/{spec_digest}"), spec.seed);
    let reference: Vec<_> = (0..spec.reference_count)
        .map(|_| vah_stats::fingerprint(&generator.generate(&mut reference_rng, &spec.layout)))
        .collect();
    let score = |corpus: &Corpus| -> Result<f64, CoreError> {
        // Rebuild on EVERY pseudo-target, using the identical algorithm.
        let target = conditional_target(corpus, &spec.target_options)?;
        let distances: Result<Vec<f64>, _> = reference
            .iter()
            .map(|f| vah_stats::distance(f, &target))
            .collect();
        Ok(vah_stats::median(&distances?))
    };
    let observed_score = score(observed)?;
    let mut target_rng = Rng::new(&format!("conditional/targets/{spec_digest}"), spec.seed);
    let mut simulated_scores = Vec::with_capacity(spec.simulated_targets as usize);
    for _ in 0..spec.simulated_targets {
        let target_corpus = generator.generate(&mut target_rng, &spec.layout);
        simulated_scores.push(score(&target_corpus)?);
    }
    let rank_p = upper_rank(observed_score, &simulated_scores)?;
    Ok(Report {
        version: "vah-conditional-result-1".into(),
        spec_digest,
        observed_digest: digest_json(observed)?,
        reference_fingerprints: reference.into_iter().map(|x| x.values).collect(),
        observed_score,
        simulated_scores,
        rank_p,
        rejects_at_declared_alpha: rank_p <= spec.alpha,
        interpretation: format!("Conditional rank statistic for a fully specified reset generator; validity requires exchangeability and frozen selection/fitting. No historical conclusion. Exposure: {}", spec.exposure_record),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rank_ties_and_invalid_inputs() {
        assert_eq!(upper_rank(1.0, &[1.0; 999]).unwrap(), 1.0);
        assert_eq!(upper_rank(2.0, &[1.0; 999]).unwrap(), 0.001);
        assert!(upper_rank(f64::NAN, &[0.0]).is_err());
        assert!(upper_rank(0.0, &[]).is_err());
        assert!(upper_rank(0.0, &[f64::INFINITY]).is_err());
    }
    #[test]
    fn fresh_target_pipeline_is_reproducible_and_checks_layout() {
        let layout = Layout {
            lines: (0..12)
                .map(|_| vah_generators::LineSpec {
                    words: 8,
                    para_start: true,
                    para_end: true,
                })
                .collect(),
        };
        let generator =
            vah_generators::build("gibberish", &Params::new(), &Resources::default()).unwrap();
        let mut rng = Rng::new("external-test-observation", 9281);
        let observed = generator.generate(&mut rng, &layout);
        let spec = Spec {
            version: "vah-conditional-test-1".into(),
            family: "gibberish".into(),
            params: Params::new(),
            layout,
            resources: None,
            target_options: TargetOptions::block_bootstrap(4, 91),
            reference_count: 2,
            simulated_targets: 19,
            seed: 82,
            alpha: 0.05,
            initial_state: "reset".into(),
            exposure_record: "synthetic integration test, not a performance study".into(),
        };
        let a = run(&spec, &observed).unwrap();
        assert_eq!(a, run(&spec, &observed).unwrap());
        assert_eq!(a.simulated_scores.len(), 19);
        assert!(a.simulated_scores.windows(2).any(|w| w[0] != w[1]));
        let target = conditional_target(&observed, &spec.target_options).unwrap();
        assert_eq!(
            target.weight[target
                .names
                .iter()
                .position(|x| x == "line_len_mean")
                .unwrap()],
            0.0
        );
        let mut bad = spec;
        bad.layout.lines.pop();
        assert!(run(&bad, &observed).is_err());
    }
}
