//! Bounded compatibility wrapper for the original generator identities.
//! One seed per checkpoint keeps browser work interruptible between replicates.
use serde::{Deserialize, Serialize};
use vah_core::{digest_json, Job, SeedResult, WorkResult};

type Res<T> = Result<T, String>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub version: String,
    pub experiment: String,
    // Retain exact supplied JSON in the outer identity, including compatibility
    // fields. The legacy executor still checks its own target/resource digests.
    pub job: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub version: String,
    pub job_digest: String,
    pub done: u32,
    pub seeds: Vec<SeedResult>,
}
fn identity<T: Serialize>(v: &T) -> Res<String> {
    digest_json(v).map_err(|e| e.to_string())
}
fn validated(input: &Input) -> Res<Job> {
    if input.version != "vah-generation-input-1"
        || !input.experiment.starts_with("sha256:")
        || input.experiment.len() != 71
    {
        return Err("invalid generation envelope".into());
    }
    let job: Job = serde_json::from_value(input.job.clone()).map_err(|e| e.to_string())?;
    let tokens: usize = job.layout.lines.iter().map(|l| l.words as usize).sum();
    if job.work_unit.seed_count > 8
        || job.work_unit.seed_start > u32::MAX as u64 - 8
        || job.layout.lines.len() > 10_000
        || tokens > 50_000
    {
        return Err("generation exceeds the hosted replicate or layout bound".into());
    }
    vah_core::validate_job(&job).map_err(|e| e.to_string())?;
    Ok(job)
}
pub fn step(input: &Input, checkpoint: Option<Checkpoint>) -> Res<Checkpoint> {
    let job = validated(input)?;
    let id = identity(input)?;
    let mut checkpoint = checkpoint.unwrap_or(Checkpoint {
        version: "vah-generation-checkpoint-1".into(),
        job_digest: id.clone(),
        done: 0,
        seeds: Vec::new(),
    });
    if checkpoint.version != "vah-generation-checkpoint-1"
        || checkpoint.job_digest != id
        || checkpoint.done as usize != checkpoint.seeds.len()
        || checkpoint.done > job.work_unit.seed_count
    {
        return Err("generation checkpoint differs".into());
    }
    if checkpoint.done < job.work_unit.seed_count {
        let mut single = job;
        single.work_unit.seed_start += u64::from(checkpoint.done);
        single.work_unit.seed_count = 1;
        // stream_id deliberately excludes seed range, preserving old streams.
        let result = vah_core::run_job(&single, |_, _| {}).map_err(|e| e.to_string())?;
        checkpoint.seeds.extend(result.seeds);
        checkpoint.done += 1;
    }
    Ok(checkpoint)
}
pub fn finish(input: &Input, checkpoint: Checkpoint) -> Res<serde_json::Value> {
    let job = validated(input)?;
    let wu = &job.work_unit;
    if checkpoint.version != "vah-generation-checkpoint-1"
        || checkpoint.job_digest != identity(input)?
        || checkpoint.done != wu.seed_count
        || checkpoint.seeds.len() != wu.seed_count as usize
    {
        return Err("incomplete generation checkpoint".into());
    }
    for (i, seed) in checkpoint.seeds.iter().enumerate() {
        if seed.seed != wu.seed_start + i as u64
            || seed.fingerprint.len() != vah_core::vah_stats::STAT_NAMES.len()
            || seed.fingerprint.iter().any(|v| !v.is_finite())
            || !seed.distance.is_finite()
        {
            return Err("invalid generation replicate".into());
        }
        let fp = vah_core::vah_stats::Fingerprint {
            version: wu.fingerprint_version.clone(),
            values: seed.fingerprint.clone(),
        };
        if vah_core::unit_distance(&wu.metric, &fp, &job.target).map_err(|e| e.to_string())?
            != seed.distance
        {
            return Err("generation distance differs".into());
        }
    }
    let distances: Vec<f64> = checkpoint.seeds.iter().map(|s| s.distance).collect();
    let specimen = checkpoint
        .seeds
        .iter()
        .min_by(|a, b| a.distance.total_cmp(&b.distance).then(a.seed.cmp(&b.seed)))
        .ok_or("no generation replicates")?;
    let result = WorkResult {
        schema_version: vah_core::RESULT_SCHEMA.into(),
        work_unit_id: wu.id().map_err(|e| e.to_string())?,
        stream_id: wu.stream_id().map_err(|e| e.to_string())?,
        kernel_version: vah_core::KERNEL_VERSION.into(),
        fingerprint_version: wu.fingerprint_version.clone(),
        numeric_profile: vah_core::NUMERIC_PROFILE.into(),
        replicates: vah_core::Replicates {
            n: wu.seed_count,
            distance_median: vah_core::vah_stats::median(&distances),
            distance_mean: distances.iter().sum::<f64>() / distances.len() as f64,
            distance_min: distances.iter().copied().fold(f64::INFINITY, f64::min),
            distance_max: distances.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        },
        specimen_seed: specimen.seed,
        specimen_distance: specimen.distance,
        result_hash: vah_core::digest(&WorkResult::canonical_bytes(&checkpoint.seeds)),
        seeds: checkpoint.seeds,
    };
    Ok(
        serde_json::json!({"version":"vah-generation-result-1","job_digest":identity(input)?,"generation":result}),
    )
}
pub fn run(input: &Input) -> Res<serde_json::Value> {
    let count = validated(input)?.work_unit.seed_count;
    let mut checkpoint = None;
    for _ in 0..count {
        checkpoint = Some(step(input, checkpoint)?);
    }
    finish(input, checkpoint.ok_or("no generation replicates")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_legacy_goldens_keep_exact_outputs_across_resumed_replicates() {
        for name in [
            "selfcite",
            "gibberish",
            "slotgram",
            "bagofwords",
            "charmarkov",
            "selfcite-full-layout",
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../golden")
                .join(format!("{name}.job.json"));
            let raw: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let job: Job = serde_json::from_value(raw.clone()).unwrap();
            let expected = vah_core::run_job(&job, |_, _| {}).unwrap();
            let input = Input {
                version: "vah-generation-input-1".into(),
                experiment: format!("sha256:{}", "a".repeat(64)),
                job: raw,
            };
            assert_eq!(
                run(&input).unwrap()["generation"],
                serde_json::to_value(expected).unwrap()
            );
            let mut cp = step(&input, None).unwrap();
            cp.seeds[0].distance += 1.0;
            while cp.done < job.work_unit.seed_count {
                cp = step(&input, Some(cp)).unwrap();
            }
            assert!(finish(&input, cp).is_err());
        }
    }
}
