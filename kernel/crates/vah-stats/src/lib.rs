//! The fingerprint: a fixed vector of statistics of a text corpus, and the
//! distance between a fingerprint and a registered target.
//!
//! Determinism rules (see docs/SYNTHESIS.md, section 5):
//! * every transcendental goes through `libm`;
//! * every map is a `BTreeMap`, every sort is stable with a total order;
//! * summation order is fixed by the code, never by a hash map;
//! * no SIMD, no threads, no fused multiply-add.
//!
//! Version `fingerprint-v1` contains 30 alphabet-agnostic statistics. It is
//! frozen once an experiment registers it; changes create `fingerprint-v2`.
#![forbid(unsafe_code)]

pub mod candidates;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use vah_corpus::Corpus;

/// Identifier of this statistics vector definition.
pub const VERSION: &str = "fingerprint-v1";

/// Word boundary symbol in the glyph stream.
const SPACE: u8 = b' ';

/// Names of the statistics, in vector order.
pub const STAT_NAMES: [&str; 30] = [
    "h0",        // log2 of the number of distinct glyphs
    "h1",        // glyph entropy, word boundary included as a symbol
    "h2",        // conditional glyph entropy H(next | current), boundary included
    "h2_word",   // conditional glyph entropy inside words only
    "h_initial", // entropy of the word-initial glyph
    "h_final",   // entropy of the word-final glyph
    "wlen_mean", // mean word length in glyphs
    "wlen_sd",   // population standard deviation of word length
    "wlen_1",    // fraction of words of length 1
    "wlen_2",
    "wlen_3",
    "wlen_4",
    "wlen_5",
    "wlen_6",
    "wlen_7",
    "wlen_8",
    "wlen_9",
    "wlen_10",              // fraction of words of length 10 or more
    "zipf_slope",           // log-log slope of frequency against rank, top 500 types
    "hapax_frac",           // fraction of types that occur once
    "mattr500",             // moving-average type/token ratio, window 500
    "adjacent_same",        // fraction of adjacent token pairs that are identical
    "adjacent_edit1",       // fraction of adjacent token pairs at edit distance exactly 1
    "line_edit1", // fraction of tokens with a distinct token at edit distance <= 1 in the same line
    "recent_repeat_10", // fraction of tokens whose word occurred within the previous 10 tokens
    "recent_repeat_100", // ... within the previous 100 tokens
    "line_first_len_delta", // mean length of line-first words minus mean word length
    "line_last_len_delta", // mean length of line-last words minus mean word length
    "para_first_len_delta", // mean length of paragraph-first words minus mean word length
    "line_len_mean", // mean number of words per line
];

/// A computed statistics vector.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fingerprint {
    pub version: String,
    pub values: Vec<f64>,
}

impl Fingerprint {
    /// Value by statistic name.
    pub fn get(&self, name: &str) -> Option<f64> {
        STAT_NAMES
            .iter()
            .position(|n| *n == name)
            .map(|i| self.values[i])
    }

    /// Canonical bytes: every value as little-endian IEEE-754 binary64, in
    /// vector order. Two fingerprints are equal iff their bytes are equal.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.values.len() * 8);
        for v in &self.values {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Named view of the values.
    pub fn named(&self) -> BTreeMap<String, f64> {
        STAT_NAMES
            .iter()
            .zip(&self.values)
            .map(|(n, v)| (n.to_string(), *v))
            .collect()
    }
}

/// A registered target: the fingerprint of the manuscript with a scale
/// (typical variation) and a weight per statistic.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Target {
    pub version: String,
    pub names: Vec<String>,
    pub mean: Vec<f64>,
    pub scale: Vec<f64>,
    pub weight: Vec<f64>,
}

/// Why a distance could not be computed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetError {
    VersionMismatch { fingerprint: String, target: String },
    Shape,
    Invalid(String),
    NonFinite(String),
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TargetError::VersionMismatch {
                fingerprint,
                target,
            } => {
                write!(
                    f,
                    "fingerprint version {fingerprint} does not match target version {target}"
                )
            }
            TargetError::Shape => write!(f, "target vectors have inconsistent lengths"),
            TargetError::Invalid(s) => write!(f, "invalid target: {s}"),
            TargetError::NonFinite(s) => write!(f, "non-finite value: {s}"),
        }
    }
}

impl std::error::Error for TargetError {}

impl Target {
    /// Check internal consistency: shape and names, every value finite,
    /// every scale strictly positive, every weight non-negative with a
    /// positive total.
    pub fn validate(&self) -> Result<(), TargetError> {
        let n = STAT_NAMES.len();
        if self.names.len() != n
            || self.mean.len() != n
            || self.scale.len() != n
            || self.weight.len() != n
        {
            return Err(TargetError::Shape);
        }
        if self
            .names
            .iter()
            .zip(STAT_NAMES.iter())
            .any(|(a, b)| a != b)
        {
            return Err(TargetError::Shape);
        }
        for i in 0..n {
            if !self.mean[i].is_finite()
                || !self.scale[i].is_finite()
                || !self.weight[i].is_finite()
            {
                return Err(TargetError::Invalid(format!(
                    "{}: non-finite value",
                    self.names[i]
                )));
            }
            if self.scale[i] <= 0.0 {
                return Err(TargetError::Invalid(format!(
                    "{}: scale must be > 0",
                    self.names[i]
                )));
            }
            if self.weight[i] < 0.0 {
                return Err(TargetError::Invalid(format!(
                    "{}: weight must be >= 0",
                    self.names[i]
                )));
            }
        }
        if self.weight.iter().sum::<f64>() <= 0.0 {
            return Err(TargetError::Invalid(
                "weights must not all be zero".to_string(),
            ));
        }
        Ok(())
    }
}

/// Weighted root-mean-square z-distance between a fingerprint and a target:
/// `sqrt(sum_i w_i ((f_i - m_i) / s_i)^2 / sum_i w_i)`.
/// Note: this treats the statistics as uncorrelated. Several of them are
/// strongly correlated (the word-length histogram sums to one), so the
/// registered primary metric may instead be a Mahalanobis distance with a
/// regularised bootstrap covariance; that is a Gate 2 decision.
pub fn distance(f: &Fingerprint, t: &Target) -> Result<f64, TargetError> {
    t.validate()?;
    if f.version != t.version {
        return Err(TargetError::VersionMismatch {
            fingerprint: f.version.clone(),
            target: t.version.clone(),
        });
    }
    if f.values.len() != t.mean.len() {
        return Err(TargetError::Shape);
    }
    let mut acc = 0.0f64;
    let mut wsum = 0.0f64;
    for (i, v) in f.values.iter().enumerate() {
        if !v.is_finite() {
            return Err(TargetError::NonFinite(STAT_NAMES[i].to_string()));
        }
        let z = (v - t.mean[i]) / t.scale[i];
        acc += t.weight[i] * z * z;
        wsum += t.weight[i];
    }
    let d = libm::sqrt(acc / wsum);
    if !d.is_finite() {
        return Err(TargetError::NonFinite("distance".to_string()));
    }
    Ok(d)
}

/// Compute the `fingerprint-v1` vector of a corpus.
pub fn fingerprint(c: &Corpus) -> Fingerprint {
    let mut v = Vec::with_capacity(STAT_NAMES.len());
    let g = glyph_stats(c);
    v.extend_from_slice(&[g.h0, g.h1, g.h2, g.h2_word, g.h_initial, g.h_final]);
    let w = word_stats(c);
    v.push(w.wlen_mean);
    v.push(w.wlen_sd);
    v.extend_from_slice(&w.wlen_hist);
    v.extend_from_slice(&[
        w.zipf_slope,
        w.hapax_frac,
        w.mattr500,
        w.adjacent_same,
        w.adjacent_edit1,
        w.line_edit1,
        w.recent_repeat_10,
        w.recent_repeat_100,
        w.line_first_len_delta,
        w.line_last_len_delta,
        w.para_first_len_delta,
        w.line_len_mean,
    ]);
    debug_assert_eq!(v.len(), STAT_NAMES.len());
    // Canonical output: negative zero becomes positive zero so that equal
    // statistics have equal bytes on every platform.
    for x in v.iter_mut() {
        if *x == 0.0 {
            *x = 0.0;
        }
    }
    Fingerprint {
        version: VERSION.to_string(),
        values: v,
    }
}

/// Median of a slice (deterministic: total-order sort, mean of the middle
/// two for even counts). Returns 0 for an empty slice.
pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

struct GlyphStats {
    h0: f64,
    h1: f64,
    h2: f64,
    h2_word: f64,
    h_initial: f64,
    h_final: f64,
}

/// Shannon entropy in bits of a count distribution, summed in the given order.
fn entropy<'a, I: Iterator<Item = &'a u64>>(counts: I, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    let t = total as f64;
    let mut h = 0.0f64;
    for &c in counts {
        if c > 0 {
            let p = c as f64 / t;
            h -= p * libm::log2(p);
        }
    }
    h
}

/// Conditional entropy H(Y|X) = H(X,Y) - H(X) from bigram counts.
fn conditional_entropy(bi: &BTreeMap<(u8, u8), u64>) -> f64 {
    let total: u64 = bi.values().sum();
    if total == 0 {
        return 0.0;
    }
    let mut first: BTreeMap<u8, u64> = BTreeMap::new();
    for ((x, _), c) in bi {
        *first.entry(*x).or_insert(0) += c;
    }
    let joint = entropy(bi.values(), total);
    let marginal = entropy(first.values(), total);
    joint - marginal
}

fn glyph_stats(c: &Corpus) -> GlyphStats {
    let mut uni: BTreeMap<u8, u64> = BTreeMap::new();
    let mut bi: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    let mut bi_word: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    let mut initial: BTreeMap<u8, u64> = BTreeMap::new();
    let mut fin: BTreeMap<u8, u64> = BTreeMap::new();
    let mut words = 0u64;
    for line in &c.lines {
        let mut prev = SPACE;
        for w in &line.words {
            let b = w.as_bytes();
            if b.is_empty() {
                continue;
            }
            words += 1;
            *initial.entry(b[0]).or_insert(0) += 1;
            *fin.entry(b[b.len() - 1]).or_insert(0) += 1;
            for &g in b {
                *uni.entry(g).or_insert(0) += 1;
                *bi.entry((prev, g)).or_insert(0) += 1;
                if prev != SPACE {
                    *bi_word.entry((prev, g)).or_insert(0) += 1;
                }
                prev = g;
            }
            *uni.entry(SPACE).or_insert(0) += 1;
            *bi.entry((prev, SPACE)).or_insert(0) += 1;
            prev = SPACE;
        }
    }
    let distinct = uni.keys().filter(|k| **k != SPACE).count();
    let total: u64 = uni.values().sum();
    GlyphStats {
        h0: if distinct == 0 {
            0.0
        } else {
            libm::log2(distinct as f64)
        },
        h1: entropy(uni.values(), total),
        h2: conditional_entropy(&bi),
        h2_word: conditional_entropy(&bi_word),
        h_initial: entropy(initial.values(), words),
        h_final: entropy(fin.values(), words),
    }
}

struct WordStats {
    wlen_mean: f64,
    wlen_sd: f64,
    wlen_hist: [f64; 10],
    zipf_slope: f64,
    hapax_frac: f64,
    mattr500: f64,
    adjacent_same: f64,
    adjacent_edit1: f64,
    line_edit1: f64,
    recent_repeat_10: f64,
    recent_repeat_100: f64,
    line_first_len_delta: f64,
    line_last_len_delta: f64,
    para_first_len_delta: f64,
    line_len_mean: f64,
}

/// Levenshtein distance between two byte strings, with early exit above `cap`.
pub fn edit_distance(a: &[u8], b: &[u8], cap: usize) -> usize {
    if a.len().abs_diff(b.len()) > cap {
        return cap + 1;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        let mut row_min = cur[0];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            row_min = row_min.min(cur[j]);
        }
        if row_min > cap {
            return cap + 1;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn word_stats(c: &Corpus) -> WordStats {
    let tokens: Vec<&str> = c.words().collect();
    let n = tokens.len();
    let zero = WordStats {
        wlen_mean: 0.0,
        wlen_sd: 0.0,
        wlen_hist: [0.0; 10],
        zipf_slope: 0.0,
        hapax_frac: 0.0,
        mattr500: 0.0,
        adjacent_same: 0.0,
        adjacent_edit1: 0.0,
        line_edit1: 0.0,
        recent_repeat_10: 0.0,
        recent_repeat_100: 0.0,
        line_first_len_delta: 0.0,
        line_last_len_delta: 0.0,
        para_first_len_delta: 0.0,
        line_len_mean: 0.0,
    };
    if n == 0 {
        return zero;
    }
    let nf = n as f64;

    // Word length distribution.
    let mut len_sum = 0u64;
    let mut hist = [0u64; 10];
    for w in &tokens {
        let l = w.len();
        len_sum += l as u64;
        hist[l.clamp(1, 10) - 1] += 1;
    }
    let wlen_mean = len_sum as f64 / nf;
    let mut var = 0.0f64;
    for w in &tokens {
        let d = w.len() as f64 - wlen_mean;
        var += d * d;
    }
    let wlen_sd = libm::sqrt(var / nf);
    let mut wlen_hist = [0.0f64; 10];
    for i in 0..10 {
        wlen_hist[i] = hist[i] as f64 / nf;
    }

    // Type frequencies.
    let mut types: BTreeMap<&str, u64> = BTreeMap::new();
    for w in &tokens {
        *types.entry(w).or_insert(0) += 1;
    }
    let mut freq: Vec<(&str, u64)> = types.iter().map(|(w, c)| (*w, *c)).collect();
    freq.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let hapax = freq.iter().filter(|(_, c)| *c == 1).count();
    let hapax_frac = hapax as f64 / freq.len() as f64;

    // Zipf slope over the top 500 ranks (least squares in log-log space).
    let top = freq.len().min(500);
    let zipf_slope = if top < 2 {
        0.0
    } else {
        let mut sx = 0.0f64;
        let mut sy = 0.0f64;
        for (i, (_, cnt)) in freq.iter().take(top).enumerate() {
            sx += libm::log((i + 1) as f64);
            sy += libm::log(*cnt as f64);
        }
        let mx = sx / top as f64;
        let my = sy / top as f64;
        let mut sxy = 0.0f64;
        let mut sxx = 0.0f64;
        for (i, (_, cnt)) in freq.iter().take(top).enumerate() {
            let dx = libm::log((i + 1) as f64) - mx;
            let dy = libm::log(*cnt as f64) - my;
            sxy += dx * dy;
            sxx += dx * dx;
        }
        if sxx == 0.0 {
            0.0
        } else {
            sxy / sxx
        }
    };

    // Moving-average type/token ratio.
    let window = n.min(500);
    let mattr500 = {
        let mut counts: BTreeMap<&str, u64> = BTreeMap::new();
        let mut distinct = 0u64;
        for w in tokens.iter().take(window) {
            let e = counts.entry(w).or_insert(0);
            if *e == 0 {
                distinct += 1;
            }
            *e += 1;
        }
        let mut acc = distinct as f64;
        let mut windows = 1u64;
        for i in window..n {
            let out = tokens[i - window];
            let e = counts.get_mut(out).expect("token present");
            *e -= 1;
            if *e == 0 {
                distinct -= 1;
            }
            let e = counts.entry(tokens[i]).or_insert(0);
            if *e == 0 {
                distinct += 1;
            }
            *e += 1;
            acc += distinct as f64;
            windows += 1;
        }
        acc / windows as f64 / window as f64
    };

    // Adjacent-pair statistics over the token stream.
    let mut same = 0u64;
    let mut edit1 = 0u64;
    for i in 1..n {
        if tokens[i] == tokens[i - 1] {
            same += 1;
        } else if edit_distance(tokens[i].as_bytes(), tokens[i - 1].as_bytes(), 1) == 1 {
            edit1 += 1;
        }
    }
    let pairs = (n - 1).max(1) as f64;
    let adjacent_same = same as f64 / pairs;
    let adjacent_edit1 = edit1 as f64 / pairs;

    // Recent repeats.
    let mut last: BTreeMap<&str, usize> = BTreeMap::new();
    let mut r10 = 0u64;
    let mut r100 = 0u64;
    for (i, w) in tokens.iter().enumerate() {
        if let Some(&j) = last.get(w) {
            let d = i - j;
            if d <= 10 {
                r10 += 1;
            }
            if d <= 100 {
                r100 += 1;
            }
        }
        last.insert(w, i);
    }

    // Line-level statistics.
    let mut line_edit1_hits = 0u64;
    let mut first_len = 0u64;
    let mut last_len = 0u64;
    let mut para_first_len = 0u64;
    let mut para_lines = 0u64;
    let mut lines = 0u64;
    for line in &c.lines {
        if line.words.is_empty() {
            continue;
        }
        lines += 1;
        first_len += line.words[0].len() as u64;
        last_len += line.words[line.words.len() - 1].len() as u64;
        if line.para_start {
            para_lines += 1;
            para_first_len += line.words[0].len() as u64;
        }
        for (i, a) in line.words.iter().enumerate() {
            let hit = line
                .words
                .iter()
                .enumerate()
                .any(|(j, b)| j != i && edit_distance(a.as_bytes(), b.as_bytes(), 1) <= 1);
            if hit {
                line_edit1_hits += 1;
            }
        }
    }
    let lf = lines.max(1) as f64;
    WordStats {
        wlen_mean,
        wlen_sd,
        wlen_hist,
        zipf_slope,
        hapax_frac,
        mattr500,
        adjacent_same,
        adjacent_edit1,
        line_edit1: line_edit1_hits as f64 / nf,
        recent_repeat_10: r10 as f64 / nf,
        recent_repeat_100: r100 as f64 / nf,
        line_first_len_delta: first_len as f64 / lf - wlen_mean,
        line_last_len_delta: last_len as f64 / lf - wlen_mean,
        para_first_len_delta: if para_lines == 0 {
            0.0
        } else {
            para_first_len as f64 / para_lines as f64 - wlen_mean
        },
        line_len_mean: nf / lf,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vah_corpus::Line;

    fn corpus(lines: &[&str]) -> Corpus {
        let mut c = Corpus::single_page("t");
        for (i, l) in lines.iter().enumerate() {
            c.lines.push(Line {
                page: 0,
                words: l.split('.').map(str::to_string).collect(),
                para_start: i == 0,
                para_end: i + 1 == lines.len(),
            });
        }
        c
    }

    #[test]
    fn entropies_of_a_periodic_text() {
        // "ab ab ab": glyphs a, b and space each appear 3 times.
        let c = corpus(&["ab.ab.ab"]);
        let f = fingerprint(&c);
        assert_eq!(f.values.len(), STAT_NAMES.len());
        assert_eq!(f.get("h0"), Some(1.0));
        let h1 = f.get("h1").unwrap();
        assert!((h1 - libm::log2(3.0)).abs() < 1e-12, "h1 = {h1}");
        // Every glyph fully determines the next one.
        assert_eq!(f.get("h2"), Some(0.0));
        assert_eq!(f.get("h2_word"), Some(0.0));
        assert_eq!(f.get("h_initial"), Some(0.0));
        assert_eq!(f.get("wlen_mean"), Some(2.0));
        assert_eq!(f.get("wlen_2"), Some(1.0));
        assert_eq!(f.get("adjacent_same"), Some(1.0));
        assert_eq!(f.get("hapax_frac"), Some(0.0));
        assert_eq!(f.get("line_len_mean"), Some(3.0));
    }

    #[test]
    fn edit_distance_basics() {
        assert_eq!(edit_distance(b"daiin", b"daiin", 1), 0);
        assert_eq!(edit_distance(b"daiin", b"dain", 1), 1);
        assert_eq!(edit_distance(b"daiin", b"chol", 1), 2); // capped
        assert_eq!(edit_distance(b"", b"a", 1), 1);
        assert_eq!(edit_distance(b"kitten", b"sitting", 10), 3);
    }

    #[test]
    fn similarity_statistics() {
        let c = corpus(&["daiin.dain.chol", "chol.chor.qokedy.daiin"]);
        let f = fingerprint(&c);
        // pairs: daiin/dain (edit1), dain/chol, chol/chol (same), chol/chor (edit1),
        // chor/qokedy, qokedy/daiin  -> 6 pairs
        assert!((f.get("adjacent_same").unwrap() - 1.0 / 6.0).abs() < 1e-12);
        assert!((f.get("adjacent_edit1").unwrap() - 2.0 / 6.0).abs() < 1e-12);
        // line 1: daiin~dain, dain~daiin hit; chol no. line 2: chol~chor, chor~chol hit.
        assert!((f.get("line_edit1").unwrap() - 4.0 / 7.0).abs() < 1e-12);
        // daiin repeats at distance 6 -> within 10; chol at distance 1.
        assert!((f.get("recent_repeat_10").unwrap() - 2.0 / 7.0).abs() < 1e-12);
        assert_eq!(f.get("hapax_frac"), Some(3.0 / 5.0));
    }

    #[test]
    fn empty_corpus_is_all_zero_and_finite() {
        let f = fingerprint(&Corpus::default());
        assert!(f.values.iter().all(|v| v.is_finite()));
        assert!(f.values.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn distance_to_self_is_zero_and_bytes_are_stable() {
        let c = corpus(&["daiin.dain.chol", "chol.chor.qokedy.daiin"]);
        let f = fingerprint(&c);
        let t = Target {
            version: VERSION.to_string(),
            names: STAT_NAMES.iter().map(|s| s.to_string()).collect(),
            mean: f.values.clone(),
            scale: vec![0.1; STAT_NAMES.len()],
            weight: vec![1.0; STAT_NAMES.len()],
        };
        assert_eq!(distance(&f, &t).unwrap(), 0.0);
        let mut shifted = f.clone();
        shifted.values[0] += 0.1;
        let d = distance(&shifted, &t).unwrap();
        assert!((d - libm::sqrt(1.0 / 30.0)).abs() < 1e-12, "d = {d}");
        assert_eq!(f.canonical_bytes().len(), 30 * 8);
        assert_eq!(fingerprint(&c).canonical_bytes(), f.canonical_bytes());
        let mut bad = t.clone();
        bad.version = "other".into();
        assert!(matches!(
            distance(&f, &bad),
            Err(TargetError::VersionMismatch { .. })
        ));
        let mut bad = t.clone();
        bad.scale[3] = 0.0;
        assert!(matches!(distance(&f, &bad), Err(TargetError::Invalid(_))));
        let mut bad = t.clone();
        bad.weight[3] = -1.0;
        assert!(matches!(bad.validate(), Err(TargetError::Invalid(_))));
        let mut bad = t.clone();
        bad.mean[3] = f64::NAN;
        assert!(matches!(bad.validate(), Err(TargetError::Invalid(_))));
        let mut bad = t.clone();
        bad.weight = vec![0.0; STAT_NAMES.len()];
        assert!(matches!(bad.validate(), Err(TargetError::Invalid(_))));
        let mut nan = f.clone();
        nan.values[0] = f64::NAN;
        assert!(matches!(distance(&nan, &t), Err(TargetError::NonFinite(_))));
    }

    #[test]
    fn output_has_no_negative_zero_and_median_is_deterministic() {
        let f = fingerprint(&corpus(&["ab.ab.ab"]));
        assert!(f.values.iter().all(|v| v.to_bits() != (-0.0f64).to_bits()));
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&[4.0, 1.0, 3.0, 2.0]), 2.5);
        assert_eq!(median(&[]), 0.0);
    }
}
