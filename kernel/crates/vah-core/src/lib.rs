//! Work-unit executor.
//!
//! A [`Job`] bundles everything a worker needs: the [`WorkUnit`] (what to
//! compute), the registered [`Target`], the [`Layout`] and optional
//! [`Resources`]. The executor checks that the bundled artifacts match the
//! digests named in the work unit, validates every input, runs every seed,
//! and produces a [`WorkResult`] whose `result_hash` is a SHA-256 over
//! canonical bytes. Two honest workers on any platform produce the same hash
//! under the numeric profile [`NUMERIC_PROFILE`].
//!
//! Identities follow the content-addressing rule of the merged design:
//! `work_unit_id = sha256(RFC 8785 canonical JSON of the work unit)`.
//!
//! The per-seed results are replicates of one parameter point. The
//! [`Replicates`] summary (median, mean, min, max of the distance) is what
//! scientific acceptance rules operate on; the `specimen_*` fields point at
//! one seed for visualisation and must never decide acceptance.
#![forbid(unsafe_code)]

pub mod calib;
pub mod grid;
mod jcs;
pub mod partition;

use std::fmt;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vah_corpus::Corpus;
use vah_generators::{Layout, Params, Resources, Rng};
use vah_stats::{Fingerprint, Target};

pub use jcs::{canonicalize, es6_number, JcsError};
pub use vah_corpus;
pub use vah_generators;
pub use vah_stats;

/// Version of the science kernel, recorded in every result.
pub const KERNEL_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const WORK_UNIT_SCHEMA: &str = "vah-work-unit-0.2";
pub const RESULT_SCHEMA: &str = "vah-result-0.2";
/// The numeric profile every worker must implement: IEEE-754 binary64,
/// hardware `+ - * / sqrt`, `libm` transcendentals, no FMA, no SIMD, no
/// threads, ordered maps, canonical little-endian output, no NaN, no
/// negative zero in outputs.
pub const NUMERIC_PROFILE: &str = "wasm32-ieee754-libm-scalar-v1";

/// Hard caps that keep results small and bounded.
pub const MAX_SEEDS_PER_UNIT: u32 = 256;
pub const MAX_LAYOUT_LINES: usize = 200_000;
pub const MAX_LAYOUT_TOKENS: usize = 2_000_000;

// ---------------------------------------------------------------------------
// Canonical JSON and digests

/// RFC 8785 canonical JSON of a serialisable value.
pub fn canonical_json<T: Serialize>(v: &T) -> Result<String, CoreError> {
    let value = serde_json::to_value(v)?;
    Ok(jcs::canonicalize(&value)?)
}

/// `sha256:<hex>` of bytes.
pub fn digest(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("sha256:{:x}", h.finalize())
}

/// Digest of the canonical JSON of a value.
pub fn digest_json<T: Serialize>(v: &T) -> Result<String, CoreError> {
    Ok(digest(canonical_json(v)?.as_bytes()))
}

// ---------------------------------------------------------------------------
// Contracts

/// What to compute. Immutable and content-addressed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkUnit {
    pub schema_version: String,
    /// Registered experiment this unit belongs to.
    pub experiment_id: String,
    /// Generator family.
    pub family: String,
    /// Generator parameters (numbers, decimal strings, strings, booleans).
    pub params: Params,
    /// Statistics vector definition, e.g. `fingerprint-v1`.
    pub fingerprint_version: String,
    /// Digest of the target JSON.
    pub target_digest: String,
    /// Digest of the layout JSON.
    pub layout_digest: String,
    /// Digest of the resources JSON, when the family needs resources.
    pub resources_digest: Option<String>,
    /// First seed index.
    pub seed_start: u64,
    /// Number of seeds (replicates of this parameter point in this unit).
    pub seed_count: u32,
}

impl WorkUnit {
    /// Content identity.
    pub fn id(&self) -> Result<String, CoreError> {
        digest_json(self)
    }

    /// The random stream identity: everything that defines the science, but
    /// not the seed range. Seed `s` means the same corpus in every unit of
    /// the same stream, so re-chunking a sweep never changes results.
    pub fn stream_id(&self) -> Result<String, CoreError> {
        #[derive(Serialize)]
        struct Stream<'a> {
            experiment_id: &'a str,
            family: &'a str,
            params: &'a Params,
            fingerprint_version: &'a str,
            layout_digest: &'a str,
            resources_digest: &'a Option<String>,
        }
        digest_json(&Stream {
            experiment_id: &self.experiment_id,
            family: &self.family,
            params: &self.params,
            fingerprint_version: &self.fingerprint_version,
            layout_digest: &self.layout_digest,
            resources_digest: &self.resources_digest,
        })
    }
}

/// A self-contained unit of work.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Job {
    pub work_unit: WorkUnit,
    pub target: Target,
    pub layout: Layout,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<Resources>,
}

/// Result for one seed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SeedResult {
    pub seed: u64,
    pub fingerprint: Vec<f64>,
    pub distance: f64,
}

/// Distributional summary over the replicates of this unit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Replicates {
    pub n: u32,
    pub distance_median: f64,
    pub distance_mean: f64,
    pub distance_min: f64,
    pub distance_max: f64,
}

/// The output of a work unit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkResult {
    pub schema_version: String,
    pub work_unit_id: String,
    pub stream_id: String,
    pub kernel_version: String,
    pub fingerprint_version: String,
    pub numeric_profile: String,
    pub seeds: Vec<SeedResult>,
    pub replicates: Replicates,
    /// Seed with the smallest distance (ties: smallest seed). For
    /// visualisation only; never an input to scientific acceptance.
    pub specimen_seed: u64,
    pub specimen_distance: f64,
    /// SHA-256 over canonical bytes of all seed results.
    pub result_hash: String,
}

impl WorkResult {
    /// Canonical bytes: for each seed in order, the seed as u64 LE, the
    /// fingerprint values as f64 LE, the distance as f64 LE.
    pub fn canonical_bytes(seeds: &[SeedResult]) -> Vec<u8> {
        let mut out = Vec::new();
        for s in seeds {
            out.extend_from_slice(&s.seed.to_le_bytes());
            for v in &s.fingerprint {
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.extend_from_slice(&s.distance.to_le_bytes());
        }
        out
    }
}

/// Executor errors.
#[derive(Debug)]
pub enum CoreError {
    Json(serde_json::Error),
    Jcs(JcsError),
    Schema(String),
    Invalid(String),
    DigestMismatch {
        what: &'static str,
        expected: String,
        actual: String,
    },
    Generator(vah_generators::GenError),
    Target(vah_stats::TargetError),
    NonFinite {
        seed: u64,
        what: String,
    },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::Json(e) => write!(f, "json: {e}"),
            CoreError::Jcs(e) => write!(f, "canonical json: {e}"),
            CoreError::Schema(s) => write!(f, "schema: {s}"),
            CoreError::Invalid(s) => write!(f, "invalid job: {s}"),
            CoreError::DigestMismatch {
                what,
                expected,
                actual,
            } => {
                write!(f, "{what} digest mismatch: work unit says {expected}, bundled artifact is {actual}")
            }
            CoreError::Generator(e) => write!(f, "generator: {e}"),
            CoreError::Target(e) => write!(f, "target: {e}"),
            CoreError::NonFinite { seed, what } => write!(f, "seed {seed}: non-finite {what}"),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Json(e)
    }
}
impl From<JcsError> for CoreError {
    fn from(e: JcsError) -> Self {
        CoreError::Jcs(e)
    }
}
impl From<vah_generators::GenError> for CoreError {
    fn from(e: vah_generators::GenError) -> Self {
        CoreError::Generator(e)
    }
}
impl From<vah_stats::TargetError> for CoreError {
    fn from(e: vah_stats::TargetError) -> Self {
        CoreError::Target(e)
    }
}

// ---------------------------------------------------------------------------
// Execution

fn valid_param_key(k: &str) -> bool {
    let mut chars = k.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && k.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Check a job's internal consistency without running it.
pub fn validate_job(job: &Job) -> Result<(), CoreError> {
    validate_work_unit(
        &job.work_unit,
        &job.target,
        &job.layout,
        job.resources.as_ref(),
    )
}

/// Check a work unit against its artifacts without running it.
pub fn validate_work_unit(
    wu: &WorkUnit,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
) -> Result<(), CoreError> {
    if wu.schema_version != WORK_UNIT_SCHEMA {
        return Err(CoreError::Schema(format!(
            "unsupported work unit schema {}",
            wu.schema_version
        )));
    }
    if wu.fingerprint_version != vah_stats::VERSION {
        return Err(CoreError::Schema(format!(
            "this kernel computes {} but the work unit asks for {}",
            vah_stats::VERSION,
            wu.fingerprint_version
        )));
    }
    if !vah_generators::FAMILIES.contains(&wu.family.as_str()) {
        return Err(CoreError::Generator(
            vah_generators::GenError::UnknownFamily(wu.family.clone()),
        ));
    }
    for (k, v) in &wu.params {
        if !valid_param_key(k) {
            return Err(CoreError::Invalid(format!(
                "parameter key {k:?} is not [a-z][a-z0-9_]{{0,63}}"
            )));
        }
        if v.is_object() || v.is_array() {
            return Err(CoreError::Invalid(format!(
                "parameter {k} must be a scalar"
            )));
        }
        if let Some(n) = v.as_f64() {
            if !n.is_finite() {
                return Err(CoreError::Invalid(format!("parameter {k} is not finite")));
            }
        }
    }
    if wu.seed_count == 0 || wu.seed_count > MAX_SEEDS_PER_UNIT {
        return Err(CoreError::Invalid(format!(
            "seed_count must be in 1..={MAX_SEEDS_PER_UNIT}"
        )));
    }
    if wu
        .seed_start
        .checked_add(u64::from(wu.seed_count))
        .is_none()
    {
        return Err(CoreError::Invalid("seed range overflows u64".into()));
    }
    if layout.lines.is_empty() {
        return Err(CoreError::Invalid("layout has no lines".into()));
    }
    if layout.lines.len() > MAX_LAYOUT_LINES {
        return Err(CoreError::Invalid(format!(
            "layout has more than {MAX_LAYOUT_LINES} lines"
        )));
    }
    if layout.lines.iter().any(|l| l.words == 0) {
        return Err(CoreError::Invalid("layout line with zero words".into()));
    }
    if layout.tokens() > MAX_LAYOUT_TOKENS {
        return Err(CoreError::Invalid(format!(
            "layout has more than {MAX_LAYOUT_TOKENS} words"
        )));
    }
    target.validate()?;
    if target.version != wu.fingerprint_version {
        return Err(CoreError::Schema(
            "target version differs from the work unit's fingerprint version".into(),
        ));
    }
    let check = |what: &'static str, expected: &str, actual: String| {
        if expected != actual {
            Err(CoreError::DigestMismatch {
                what,
                expected: expected.to_string(),
                actual,
            })
        } else {
            Ok(())
        }
    };
    check("target", &wu.target_digest, digest_json(&target)?)?;
    check("layout", &wu.layout_digest, digest_json(&layout)?)?;
    match (&wu.resources_digest, resources) {
        (Some(d), Some(r)) => check("resources", d, digest_json(r)?)?,
        (Some(_), None) => {
            return Err(CoreError::Schema(
                "work unit names resources but none are bundled".into(),
            ))
        }
        (None, Some(_)) => {
            return Err(CoreError::Schema(
                "resources bundled but not named in the work unit".into(),
            ))
        }
        (None, None) => {}
    }
    Ok(())
}

/// Generate the corpus for one seed of a job (used by the executor and by
/// dashboards that regenerate a specimen).
pub fn generate_seed(job: &Job, seed: u64) -> Result<Corpus, CoreError> {
    let res = job.resources.clone().unwrap_or_default();
    let gen = vah_generators::build(&job.work_unit.family, &job.work_unit.params, &res)?;
    let salt = job.work_unit.stream_id()?;
    let mut rng = Rng::new(&salt, seed);
    Ok(gen.generate(&mut rng, &job.layout))
}

/// Run a job. `progress(done, total)` is called after every seed.
pub fn run_job<F: FnMut(u32, u32)>(job: &Job, progress: F) -> Result<WorkResult, CoreError> {
    run_work_unit(
        &job.work_unit,
        &job.target,
        &job.layout,
        job.resources.as_ref(),
        progress,
    )
}

/// Run a work unit against its artifacts (the same as [`run_job`] without
/// building a `Job`; sweeps use this to share one target, layout and
/// resource set across many units).
pub fn run_work_unit<F: FnMut(u32, u32)>(
    wu: &WorkUnit,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
    mut progress: F,
) -> Result<WorkResult, CoreError> {
    validate_work_unit(wu, target, layout, resources)?;
    let empty = Resources::default();
    let res = resources.unwrap_or(&empty);
    let gen = vah_generators::build(&wu.family, &wu.params, res)?;
    let stream_id = wu.stream_id()?;
    let mut seeds = Vec::with_capacity(wu.seed_count as usize);
    let mut specimen_seed = wu.seed_start;
    let mut specimen_distance = f64::INFINITY;
    let mut distances = Vec::with_capacity(wu.seed_count as usize);
    for i in 0..wu.seed_count {
        let seed = wu.seed_start + u64::from(i);
        let mut rng = Rng::new(&stream_id, seed);
        let corpus = gen.generate(&mut rng, layout);
        let fp: Fingerprint = vah_stats::fingerprint(&corpus);
        if let Some(i) = fp.values.iter().position(|v| !v.is_finite()) {
            return Err(CoreError::NonFinite {
                seed,
                what: vah_stats::STAT_NAMES[i].to_string(),
            });
        }
        let d = vah_stats::distance(&fp, target)?;
        if d < specimen_distance {
            specimen_distance = d;
            specimen_seed = seed;
        }
        distances.push(d);
        seeds.push(SeedResult {
            seed,
            fingerprint: fp.values,
            distance: d,
        });
        progress(i + 1, wu.seed_count);
    }
    let n = distances.len() as f64;
    let replicates = Replicates {
        n: wu.seed_count,
        distance_median: vah_stats::median(&distances),
        distance_mean: distances.iter().sum::<f64>() / n,
        distance_min: distances.iter().copied().fold(f64::INFINITY, f64::min),
        distance_max: distances.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    };
    let result_hash = digest(&WorkResult::canonical_bytes(&seeds));
    Ok(WorkResult {
        schema_version: RESULT_SCHEMA.to_string(),
        work_unit_id: wu.id()?,
        stream_id,
        kernel_version: KERNEL_VERSION.to_string(),
        fingerprint_version: vah_stats::VERSION.to_string(),
        numeric_profile: NUMERIC_PROFILE.to_string(),
        seeds,
        replicates,
        specimen_seed,
        specimen_distance,
        result_hash,
    })
}

/// Parse a job from JSON.
pub fn parse_job(json: &str) -> Result<Job, CoreError> {
    Ok(serde_json::from_str(json)?)
}

/// Serialise a result to compact JSON.
pub fn result_to_json(r: &WorkResult) -> Result<String, CoreError> {
    Ok(serde_json::to_string(r)?)
}

/// JSON in, JSON out (the interface used by the wasm module and the CLI).
pub fn run_job_json(job_json: &str) -> Result<String, CoreError> {
    let job = parse_job(job_json)?;
    let result = run_job(&job, |_, _| {})?;
    result_to_json(&result)
}

/// Build a work unit for a job, filling in the artifact digests.
#[allow(clippy::too_many_arguments)]
pub fn make_work_unit(
    experiment_id: &str,
    family: &str,
    params: Params,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
    seed_start: u64,
    seed_count: u32,
) -> Result<WorkUnit, CoreError> {
    Ok(WorkUnit {
        schema_version: WORK_UNIT_SCHEMA.to_string(),
        experiment_id: experiment_id.to_string(),
        family: family.to_string(),
        params,
        fingerprint_version: vah_stats::VERSION.to_string(),
        target_digest: digest_json(target)?,
        layout_digest: digest_json(layout)?,
        resources_digest: match resources {
            Some(r) => Some(digest_json(r)?),
            None => None,
        },
        seed_start,
        seed_count,
    })
}

// ---------------------------------------------------------------------------
// Target construction (pipeline side)

/// Provenance of a target, stored next to it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TargetProvenance {
    pub source_digest: String,
    pub view_id: String,
    /// Digest of the partition manifest the corpus was filtered with, if any.
    #[serde(default)]
    pub partition_digest: Option<String>,
    /// Partition roles included in the corpus (empty = whole corpus).
    #[serde(default)]
    pub roles: Vec<String>,
    pub resamples: u32,
    pub bootstrap_seed: u64,
    pub kernel_version: String,
    pub words: usize,
    pub lines: usize,
}

/// A target with its provenance (the committed artifact).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TargetFile {
    pub target: Target,
    pub provenance: TargetProvenance,
}

/// Paragraph blocks of a corpus: runs of lines from a `para_start` to a
/// `para_end`, as `(start, end)` line ranges.
pub fn paragraph_blocks(corpus: &Corpus) -> Vec<(usize, usize)> {
    let mut blocks: Vec<(usize, usize)> = Vec::new();
    let mut start = 0usize;
    for (i, l) in corpus.lines.iter().enumerate() {
        if l.para_start && i > start {
            blocks.push((start, i));
            start = i;
        }
        if l.para_end {
            blocks.push((start, i + 1));
            start = i + 1;
        }
    }
    if start < corpus.lines.len() {
        blocks.push((start, corpus.lines.len()));
    }
    blocks
}

/// One paragraph-block bootstrap resample with at least as many words as
/// the corpus.
pub fn resample_blocks(corpus: &Corpus, blocks: &[(usize, usize)], rng: &mut Rng) -> Corpus {
    let total_words = corpus.word_count();
    let mut sample = Corpus {
        pages: corpus.pages.clone(),
        lines: Vec::with_capacity(corpus.lines.len()),
    };
    let mut words = 0usize;
    while words < total_words && !blocks.is_empty() {
        let (a, b) = blocks[rng.below(blocks.len())];
        for l in &corpus.lines[a..b] {
            words += l.words.len();
            sample.lines.push(l.clone());
        }
    }
    sample
}

/// Distances of `resamples` paragraph-block bootstrap resamples of a corpus
/// to a target: the spread a "true generator" of that corpus would show.
pub fn bootstrap_distances(
    corpus: &Corpus,
    target: &Target,
    resamples: u32,
    seed: u64,
) -> Result<Vec<f64>, CoreError> {
    let blocks = paragraph_blocks(corpus);
    let mut rng = Rng::new("bootstrap-distance", seed);
    let mut out = Vec::with_capacity(resamples as usize);
    for _ in 0..resamples {
        let sample = resample_blocks(corpus, &blocks, &mut rng);
        out.push(vah_stats::distance(
            &vah_stats::fingerprint(&sample),
            target,
        )?);
    }
    Ok(out)
}

/// Build a target from a reference corpus. `mean` is the corpus fingerprint;
/// `scale` is the standard deviation of the fingerprint over `resamples`
/// paragraph-block bootstrap resamples (the corpus's own variability), with
/// a floor of 1e-6 so that a constant statistic still has a usable scale.
pub fn build_target(corpus: &Corpus, resamples: u32, bootstrap_seed: u64) -> Target {
    let base = vah_stats::fingerprint(corpus);
    let n = base.values.len();
    let mut names: Vec<String> = vah_stats::STAT_NAMES
        .iter()
        .map(|s| s.to_string())
        .collect();
    names.truncate(n);
    let blocks = paragraph_blocks(corpus);

    let mut sum = vec![0.0f64; n];
    let mut sumsq = vec![0.0f64; n];
    let mut rng = Rng::new("bootstrap", bootstrap_seed);
    let done = if blocks.is_empty() { 0 } else { resamples };
    for _ in 0..done {
        let sample = resample_blocks(corpus, &blocks, &mut rng);
        let fp = vah_stats::fingerprint(&sample);
        for i in 0..n {
            sum[i] += fp.values[i];
            sumsq[i] += fp.values[i] * fp.values[i];
        }
    }
    let mut scale = vec![1.0f64; n];
    if done > 1 {
        let m = done as f64;
        for i in 0..n {
            let mean = sum[i] / m;
            let var = (sumsq[i] / m - mean * mean).max(0.0);
            scale[i] = libm::sqrt(var).max(1e-6);
        }
    }
    Target {
        version: base.version,
        names,
        mean: base.values,
        scale,
        weight: vec![1.0; n],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vah_corpus::Line;

    fn corpus() -> Corpus {
        let mut c = Corpus::single_page("t");
        let text = [
            "daiin.chol.chor.qokedy.shedy",
            "qokeedy.daiin.ol.chey.dar",
            "otedy.daiin.qokain.chedy.okal",
            "shol.cthy.daiin.otaiin.qokal",
            "chol.daiin.okeedy.qol.sheedy",
            "ykeedy.qokedy.dal.chedy.dain",
        ];
        for (i, l) in text.iter().enumerate() {
            c.lines.push(Line {
                page: 0,
                words: l.split('.').map(str::to_string).collect(),
                para_start: i % 3 == 0,
                para_end: i % 3 == 2,
            });
        }
        c
    }

    fn job(family: &str, params: &str, seeds: u32) -> Job {
        let c = corpus();
        let target = build_target(&c, 20, 1);
        let layout = Layout::uniform(12, 5, 3);
        let resources = if family == "gibberish" || family == "selfcite" {
            None
        } else {
            Some(Resources {
                glyph_model: Some(vah_generators::GlyphModel::train(&c, 2)),
                word_bag: Some(vah_generators::WordBag::from_corpus(&c)),
            })
        };
        let params: Params = serde_json::from_str(params).unwrap();
        let wu = make_work_unit(
            "test",
            family,
            params,
            &target,
            &layout,
            resources.as_ref(),
            0,
            seeds,
        )
        .unwrap();
        Job {
            work_unit: wu,
            target,
            layout,
            resources,
        }
    }

    #[test]
    fn canonical_json_is_rfc8785() {
        #[derive(Serialize)]
        struct S {
            b: f64,
            a: u32,
            z: Option<u32>,
        }
        assert_eq!(
            canonical_json(&S {
                b: 2.0,
                a: 1,
                z: None
            })
            .unwrap(),
            r#"{"a":1,"b":2,"z":null}"#
        );
        assert_eq!(
            digest(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn work_unit_identity_and_stream() {
        let j = job("gibberish", "{}", 3);
        let id1 = j.work_unit.id().unwrap();
        let mut other = j.work_unit.clone();
        other.seed_start = 100;
        assert_ne!(id1, other.id().unwrap());
        assert_eq!(
            j.work_unit.stream_id().unwrap(),
            other.stream_id().unwrap(),
            "seed range must not change the stream"
        );
        let mut p2 = j.work_unit.clone();
        p2.params.insert("len_p".into(), serde_json::json!(0.3));
        assert_ne!(j.work_unit.stream_id().unwrap(), p2.stream_id().unwrap());
    }

    #[test]
    fn runs_every_family_and_hashes_are_reproducible() {
        for fam in vah_generators::FAMILIES {
            let j = job(fam, "{}", 4);
            let mut calls = 0;
            let r1 = run_job(&j, |_, _| calls += 1).unwrap();
            let r2 = run_job(&j, |_, _| {}).unwrap();
            assert_eq!(calls, 4);
            assert_eq!(r1, r2, "{fam}");
            assert_eq!(r1.seeds.len(), 4);
            assert_eq!(r1.numeric_profile, NUMERIC_PROFILE);
            assert!(r1
                .seeds
                .iter()
                .all(|s| s.fingerprint.len() == 30 && s.distance.is_finite()));
            assert_eq!(r1.specimen_distance, r1.replicates.distance_min);
            assert!(r1.replicates.distance_min <= r1.replicates.distance_median);
            assert!(r1.replicates.distance_median <= r1.replicates.distance_max);
            assert_eq!(r1.replicates.n, 4);
            assert!(r1.result_hash.starts_with("sha256:"));
            let json = serde_json::to_string(&j).unwrap();
            let via_json: WorkResult = serde_json::from_str(&run_job_json(&json).unwrap()).unwrap();
            assert_eq!(
                via_json.result_hash, r1.result_hash,
                "{fam} json path differs"
            );
        }
    }

    #[test]
    fn re_chunking_does_not_change_seed_results() {
        let a = job("selfcite", "{}", 6);
        let mut b = a.clone();
        b.work_unit.seed_start = 4;
        b.work_unit.seed_count = 2;
        let ra = run_job(&a, |_, _| {}).unwrap();
        let rb = run_job(&b, |_, _| {}).unwrap();
        assert_eq!(ra.seeds[4], rb.seeds[0]);
        assert_eq!(ra.seeds[5], rb.seeds[1]);
    }

    #[test]
    fn tampered_or_malformed_jobs_are_rejected() {
        let mut j = job("charmarkov", "{}", 1);
        j.layout.lines[0].words += 1;
        assert!(matches!(
            run_job(&j, |_, _| {}),
            Err(CoreError::DigestMismatch { what: "layout", .. })
        ));
        let mut j = job("charmarkov", "{}", 1);
        j.target.weight[0] = 2.0;
        assert!(matches!(
            run_job(&j, |_, _| {}),
            Err(CoreError::DigestMismatch { what: "target", .. })
        ));
        let mut j = job("charmarkov", "{}", 1);
        j.resources = None;
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Schema(_))));
        let mut j = job("gibberish", "{}", 1);
        j.work_unit.fingerprint_version = "fingerprint-v9".into();
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Schema(_))));
        let mut j = job("gibberish", "{}", 1);
        j.work_unit.seed_count = 0;
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Invalid(_))));
        let mut j = job("gibberish", "{}", 2);
        j.work_unit.seed_start = u64::MAX;
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Invalid(_))));
        let mut j = job("gibberish", "{}", 1);
        j.work_unit.family = "nope".into();
        assert!(matches!(
            run_job(&j, |_, _| {}),
            Err(CoreError::Generator(_))
        ));
        let mut j = job("gibberish", "{}", 1);
        j.work_unit
            .params
            .insert("Bad-Key".into(), serde_json::json!(1));
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Invalid(_))));
        let mut j = job("gibberish", "{}", 1);
        j.work_unit
            .params
            .insert("nested".into(), serde_json::json!({"a": 1}));
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Invalid(_))));
        // a zero-word line or a bad target is rejected before the digest check
        let mut j = job("gibberish", "{}", 1);
        j.layout.lines[0].words = 0;
        j.work_unit.layout_digest = digest_json(&j.layout).unwrap();
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Invalid(_))));
        let mut j = job("gibberish", "{}", 1);
        j.target.scale[0] = 0.0;
        j.work_unit.target_digest = digest_json(&j.target).unwrap();
        assert!(matches!(run_job(&j, |_, _| {}), Err(CoreError::Target(_))));
    }

    #[test]
    fn target_of_corpus_has_zero_self_distance_and_positive_scales() {
        let c = corpus();
        let t = build_target(&c, 30, 7);
        assert_eq!(t.names.len(), 30);
        assert!(t.scale.iter().all(|s| *s >= 1e-6 && s.is_finite()));
        assert!(
            t.scale.iter().any(|s| *s > 1e-3),
            "bootstrap should show variation"
        );
        let fp = vah_stats::fingerprint(&c);
        assert_eq!(vah_stats::distance(&fp, &t).unwrap(), 0.0);
        assert_eq!(
            build_target(&c, 30, 7),
            t,
            "target building is deterministic"
        );
    }
}
