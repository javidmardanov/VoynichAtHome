//! Bounded known-message recovery. Solver inputs contain no plaintext or key.
//! Integer n-gram scores and deterministic random streams support replay.
#![forbid(unsafe_code)]
pub mod naibbe;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use vah_generators::Rng;

pub const ALPHABET: &str = "abcdefghilmnopqrstuvxyz";
pub const A: usize = 23;
pub const VERSION: &str = "vah-search-1";
type Res<T> = Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Model {
    pub version: String,
    pub alphabet: String,
    pub training_sources: Vec<String>,
    /// Quantized natural log probabilities, scale 1000; higher is better.
    pub quadgrams: Vec<i32>,
    pub unigrams: Vec<i32>,
}

pub fn train(texts: &[Vec<u8>], sources: Vec<String>) -> Res<Model> {
    if texts.is_empty() || sources.is_empty() {
        return Err("training needs texts and source identities".into());
    }
    let mut counts = vec![0u64; A.pow(4)];
    let mut uni = vec![0u64; A];
    for text in texts {
        if text.iter().any(|x| *x as usize >= A) {
            return Err("invalid training symbol".into());
        }
        for c in text {
            uni[*c as usize] += 1;
        }
        for w in text.windows(4) {
            counts[index(w)] += 1;
        }
    }
    let logs = |counts: Vec<u64>| {
        let total = counts.iter().sum::<u64>() as f64 + 0.1 * counts.len() as f64;
        counts
            .into_iter()
            .map(|n| (libm::log((n as f64 + 0.1) / total) * 1000.0).round() as i32)
            .collect()
    };
    let model = Model {
        version: "vah-ngram-1".into(),
        alphabet: ALPHABET.into(),
        training_sources: sources,
        quadgrams: logs(counts),
        unigrams: logs(uni),
    };
    model.validate()?;
    Ok(model)
}
fn index(w: &[u8]) -> usize {
    w.iter().fold(0, |i, c| i * A + *c as usize)
}
impl Model {
    pub fn validate(&self) -> Res<()> {
        if self.version != "vah-ngram-1"
            || self.alphabet != ALPHABET
            || self.quadgrams.len() != A.pow(4)
            || self.unigrams.len() != A
            || self.training_sources.is_empty()
            || self
                .quadgrams
                .iter()
                .chain(&self.unigrams)
                .any(|x| !(-1_000_000..=0).contains(x))
        {
            return Err("unsupported or malformed language model".into());
        }
        Ok(())
    }
    pub fn score(&self, plain: &[u8]) -> i64 {
        plain
            .windows(4)
            .map(|w| self.quadgrams[index(w)] as i64)
            .sum()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    pub version: String,
    pub experiment: String,
    pub ciphertext: Vec<u8>,
    pub symbol_count: usize,
    /// substitution or homophonic; verbose encodings have a declared parser
    /// before this substitution stage and retain their original ciphertext.
    pub encoding: String,
    pub algorithm: String,
    pub seed: u32,
    pub start: u32,
    pub iterations: u32,
    pub beam_width: usize,
    pub model: Model,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub version: String,
    pub job_digest: String,
    pub iteration: u32,
    pub key: Vec<u8>,
    pub best_key: Vec<u8>,
    pub score: i64,
    pub best_score: i64,
    /// Every 128 proposals, a hash of the full deterministic search state.
    pub trace: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResultRecord {
    pub version: String,
    pub job_digest: String,
    pub algorithm: String,
    pub key: Vec<u8>,
    pub plaintext: String,
    pub score: i64,
    pub evaluations: u32,
    pub trace: Vec<String>,
    pub result_digest: String,
}
pub fn digest<T: Serialize>(x: &T) -> Res<String> {
    vah_core::digest_json(x).map_err(|e| e.to_string())
}

impl Job {
    pub fn validate(&self) -> Res<()> {
        self.model.validate()?;
        if self.version != VERSION
            || self.experiment.is_empty()
            || self.experiment.len() > 160
            || !(4..=20_000).contains(&self.ciphertext.len())
            || !(2..=92).contains(&self.symbol_count)
            || self
                .ciphertext
                .iter()
                .any(|c| *c as usize >= self.symbol_count)
            || !(1..=100_000).contains(&self.iterations)
            || !(1..=64).contains(&self.beam_width)
            || !["substitution", "homophonic", "balanced-homophonic"]
                .contains(&self.encoding.as_str())
            || !["restart-anneal-v1", "beam-v1"].contains(&self.algorithm.as_str())
            || (self.encoding == "substitution" && self.symbol_count != A)
            || (self.encoding == "balanced-homophonic" && self.symbol_count % A != 0)
        {
            return Err("invalid or unsupported bounded search job".into());
        }
        Ok(())
    }
    fn decode(&self, key: &[u8]) -> Vec<u8> {
        self.ciphertext.iter().map(|c| key[*c as usize]).collect()
    }
    fn valid_key(&self, key: &[u8]) -> bool {
        (self.encoding != "balanced-homophonic"
            || (0..A as u8)
                .all(|c| key.iter().filter(|x| **x == c).count() == self.symbol_count / A))
            && key.len() == self.symbol_count
            && key.iter().all(|c| (*c as usize) < A)
            && (self.encoding != "substitution" || key.iter().collect::<BTreeSet<_>>().len() == A)
    }
    pub fn initial(&self) -> Res<Checkpoint> {
        self.validate()?;
        let job_digest = digest(self)?;
        let mut rng = Rng::new(&format!("search/start/{job_digest}"), self.seed as u64);
        let mut key: Vec<u8> = (0..self.symbol_count).map(|x| (x % A) as u8).collect();
        for i in (1..key.len()).rev() {
            let j = rng.below(i + 1);
            key.swap(i, j);
        }
        let score = self.model.score(&self.decode(&key));
        Ok(Checkpoint {
            version: "vah-search-checkpoint-1".into(),
            job_digest,
            iteration: 0,
            key: key.clone(),
            best_key: key,
            score,
            best_score: score,
            trace: Vec::new(),
        })
    }
    pub fn check_checkpoint(&self, cp: &Checkpoint) -> Res<()> {
        if cp.version != "vah-search-checkpoint-1"
            || cp.job_digest != digest(self)?
            || cp.iteration > self.iterations
            || !self.valid_key(&cp.key)
            || !self.valid_key(&cp.best_key)
            || cp.trace.len() != cp.iteration as usize / 128
            || cp.score != self.model.score(&self.decode(&cp.key))
            || cp.best_score != self.model.score(&self.decode(&cp.best_key))
            || cp.best_score < cp.score
        {
            return Err("checkpoint does not match job or candidate scores".into());
        }
        Ok(())
    }
}

/// Bounded proposals. Host may persist checkpoint between calls. A checkpoint
/// supplied by an untrusted client still requires trusted replay before credit.
pub fn step(job: &Job, checkpoint: Option<Checkpoint>, proposals: u32) -> Res<Checkpoint> {
    job.validate()?;
    if job.algorithm != "restart-anneal-v1" || !(1..=1024).contains(&proposals) {
        return Err("step requires annealing and 1..=1024 proposals".into());
    }
    let cp = match checkpoint {
        Some(c) => {
            job.check_checkpoint(&c)?;
            c
        }
        None => job.initial()?,
    };
    advance(job, cp, proposals)
}

fn advance(job: &Job, mut cp: Checkpoint, proposals: u32) -> Res<Checkpoint> {
    let mut plain = job.decode(&cp.key);
    // Index windows affected by a cipher symbol. A swap only rescans their union.
    let mut affected = vec![Vec::<usize>::new(); job.symbol_count];
    for (i, w) in job.ciphertext.windows(4).enumerate() {
        for c in w {
            let v = &mut affected[*c as usize];
            if v.last() != Some(&i) {
                v.push(i);
            }
        }
    }
    let mut positions = vec![Vec::<usize>::new(); job.symbol_count];
    for (i, c) in job.ciphertext.iter().enumerate() {
        positions[*c as usize].push(i);
    }
    let mut marks = vec![0u32; plain.len()];
    let mut windows = Vec::new();
    let end = cp.iteration.saturating_add(proposals).min(job.iterations);
    while cp.iteration < end {
        let mut rng = Rng::new(
            &format!("search/proposal/{}", cp.job_digest),
            cp.iteration as u64,
        );
        let a = rng.below(job.symbol_count);
        let b = rng.below(job.symbol_count);
        let old_a = cp.key[a];
        let old_b = cp.key[b];
        let reassign = job.encoding == "homophonic" && rng.below(2) == 0;
        let new_a = if reassign { rng.below(A) as u8 } else { old_b };
        let new_b = if reassign { old_b } else { old_a };
        if a != b {
            windows.clear();
            let tag = cp.iteration + 1;
            for &i in affected[a].iter().chain(&affected[b]) {
                if marks[i] != tag {
                    marks[i] = tag;
                    windows.push(i);
                }
            }
            let before: i64 = windows
                .iter()
                .map(|i| job.model.quadgrams[index(&plain[*i..*i + 4])] as i64)
                .sum();
            for &i in &positions[a] {
                plain[i] = new_a;
            }
            for &i in &positions[b] {
                plain[i] = new_b;
            }
            let after: i64 = windows
                .iter()
                .map(|i| job.model.quadgrams[index(&plain[*i..*i + 4])] as i64)
                .sum();
            let delta = after - before;
            // Linear cooling, scaled with length. libm is shared by WASM/native;
            // all candidate scores themselves are integers.
            let remaining = (job.iterations - cp.iteration) as f64 / job.iterations as f64;
            let temperature = (job.ciphertext.len() as f64 * 0.7 * remaining).max(1.0);
            if delta >= 0 || rng.unit() < libm::exp(delta as f64 / temperature) {
                cp.key[a] = new_a;
                cp.key[b] = new_b;
                cp.score += delta;
                if cp.score > cp.best_score || (cp.score == cp.best_score && cp.key < cp.best_key) {
                    cp.best_score = cp.score;
                    cp.best_key = cp.key.clone();
                }
            } else {
                for &i in &positions[a] {
                    plain[i] = old_a;
                }
                for &i in &positions[b] {
                    plain[i] = old_b;
                }
            }
        }
        cp.iteration += 1;
        if cp.iteration % 128 == 0 {
            cp.trace.push(digest(&(
                cp.iteration,
                &cp.key,
                &cp.best_key,
                cp.score,
                cp.best_score,
            ))?);
        }
    }
    Ok(cp)
}

fn record(job: &Job, key: Vec<u8>, evaluations: u32, trace: Vec<String>) -> Res<ResultRecord> {
    let plain = job.decode(&key);
    let mut result = ResultRecord {
        version: "vah-search-result-1".into(),
        job_digest: digest(job)?,
        algorithm: job.algorithm.clone(),
        key,
        plaintext: plain
            .iter()
            .map(|c| ALPHABET.as_bytes()[*c as usize] as char)
            .collect(),
        score: job.model.score(&plain),
        evaluations,
        trace,
        result_digest: String::new(),
    };
    result.result_digest = digest(&result)?;
    Ok(result)
}

pub fn finish(job: &Job, cp: Checkpoint) -> Res<ResultRecord> {
    job.validate()?;
    job.check_checkpoint(&cp)?;
    if cp.iteration != job.iterations {
        return Err("search budget not completed".into());
    }
    record(job, cp.best_key, cp.iteration, cp.trace)
}

/// Frequency-ordered partial key beam. Unknown quadgrams use a unigram
/// backoff; complete keys are scored with the same fixed quadgram model.
/// Budget counts candidate expansions. Unexpanded letters are completed in
/// sorted order if the budget runs out; the limitation is reported by budget.
pub fn beam(job: &Job) -> Res<ResultRecord> {
    job.validate()?;
    if job.algorithm != "beam-v1" {
        return Err("wrong beam algorithm".into());
    }
    let mut counts = vec![0usize; job.symbol_count];
    for c in &job.ciphertext {
        counts[*c as usize] += 1;
    }
    let mut order: Vec<usize> = (0..job.symbol_count).collect();
    order.sort_by_key(|i| (std::cmp::Reverse(counts[*i]), *i));
    let mut beam = vec![(vec![255u8; job.symbol_count], i64::MIN)];
    let mut evaluations = 0;
    let mut trace = Vec::new();
    for &symbol in &order {
        let mut candidates = Vec::new();
        for (key, _) in &beam {
            for letter in 0..A as u8 {
                if evaluations >= job.iterations {
                    break;
                }
                if (job.encoding == "substitution" && key.contains(&letter))
                    || (job.encoding == "balanced-homophonic"
                        && key.iter().filter(|x| **x == letter).count() >= job.symbol_count / A)
                {
                    continue;
                }
                let mut k = key.clone();
                k[symbol] = letter;
                let mut score = 0i64;
                for w in job.ciphertext.windows(4) {
                    let plain = [
                        k[w[0] as usize],
                        k[w[1] as usize],
                        k[w[2] as usize],
                        k[w[3] as usize],
                    ];
                    score += if plain.contains(&255) {
                        plain
                            .iter()
                            .map(|c| {
                                if *c == 255 {
                                    -3300
                                } else {
                                    job.model.unigrams[*c as usize] as i64
                                }
                            })
                            .sum()
                    } else {
                        job.model.quadgrams[index(&plain)] as i64
                    };
                }
                candidates.push((k, score));
                evaluations += 1;
            }
        }
        if candidates.is_empty() {
            break;
        }
        candidates.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        candidates.truncate(job.beam_width);
        trace.push(digest(&candidates)?);
        beam = candidates;
        if evaluations >= job.iterations {
            break;
        }
    }
    let mut complete = Vec::new();
    for (mut key, _) in beam {
        let capacity = if job.encoding == "substitution" {
            1
        } else {
            job.symbol_count / A
        };
        let unused: Vec<_> = (0..A as u8)
            .flat_map(|c| {
                std::iter::repeat_n(
                    c,
                    capacity.saturating_sub(key.iter().filter(|x| **x == c).count()),
                )
            })
            .collect();
        let mut it = unused.into_iter();
        for c in &mut key {
            if *c == 255 {
                *c = if job.encoding != "homophonic" {
                    it.next().ok_or("beam completion failed")?
                } else {
                    0
                };
            }
        }
        complete.push((job.model.score(&job.decode(&key)), key));
    }
    complete.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    record(job, complete.remove(0).1, evaluations, trace)
}

pub fn run(job: &Job) -> Res<ResultRecord> {
    if job.algorithm == "beam-v1" {
        return beam(job);
    }
    let mut cp = job.initial()?;
    while cp.iteration < job.iterations {
        cp = advance(job, cp, 1024)?;
    }
    finish(job, cp)
}

/// Verify the actual candidate output and fixed score, separately from trusted
/// replay of how the candidate was found. This alone does not prove execution.
pub fn check_candidate(job: &Job, result: &ResultRecord) -> Res<()> {
    job.validate()?;
    if !job.valid_key(&result.key)
        || result.evaluations > job.iterations
        || result.trace.len() > (job.iterations as usize / 128 + job.symbol_count)
    {
        return Err("invalid candidate shape".into());
    }
    let expected = record(
        job,
        result.key.clone(),
        result.evaluations,
        result.trace.clone(),
    )?;
    if &expected != result {
        return Err("candidate output, score or identity differs".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> Job {
        let text: Vec<u8> = (0..120).map(|i| (i % 9) as u8).collect();
        Job {
            version: VERSION.into(),
            experiment: "unit-test-only".into(),
            ciphertext: text.clone(),
            symbol_count: A,
            encoding: "substitution".into(),
            algorithm: "restart-anneal-v1".into(),
            seed: 5,
            start: 0,
            iterations: 257,
            beam_width: 2,
            model: train(&[text], vec!["synthetic-test".into()]).unwrap(),
        }
    }
    #[test]
    fn resume_replays_and_candidates_are_checked() {
        let j = job();
        let expected = run(&j).unwrap();
        let cp = step(&j, None, 63).unwrap();
        let cp: Checkpoint = serde_json::from_str(&serde_json::to_string(&cp).unwrap()).unwrap();
        let cp = step(&j, Some(cp), 194).unwrap();
        assert_eq!(expected, finish(&j, cp).unwrap());
        check_candidate(&j, &expected).unwrap();
        let mut bad = expected;
        bad.score += 1;
        assert!(check_candidate(&j, &bad).is_err());
        let mut cp = step(&j, None, 1).unwrap();
        cp.key[0] = 255;
        assert!(step(&j, Some(cp), 1).is_err());
    }
    #[test]
    fn reject_unbounded_and_hidden_answer_fields() {
        let mut j = job();
        j.iterations = 100001;
        assert!(run(&j).is_err());
        let mut value = serde_json::to_value(job()).unwrap();
        value["answer"] = serde_json::json!("not allowed");
        assert!(serde_json::from_value::<Job>(value).is_err());
    }
    #[test]
    fn beam_and_homophonic_are_bounded() {
        let mut j = job();
        j.algorithm = "beam-v1".into();
        let result = run(&j).unwrap();
        check_candidate(&j, &result).unwrap();
        assert!(result.evaluations <= j.iterations);
        j.algorithm = "restart-anneal-v1".into();
        j.encoding = "homophonic".into();
        j.symbol_count = 46;
        check_candidate(&j, &run(&j).unwrap()).unwrap();
    }
}
