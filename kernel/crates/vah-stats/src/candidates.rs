//! Candidate statistics for `fingerprint-v2`.
//!
//! These are **not** part of the registered `fingerprint-v1` vector and do
//! not affect any golden hash. They are computed by `voynich fingerprint
//! --candidates` so that the domain advisor and the statistician can see
//! them on the manuscript and on generated corpora before any of them is
//! frozen into a new version. Definitions are stated here in full; where a
//! statistic is inspired by a published one (line-position effects after
//! Currier, "LAAFU"; directional constraints after Parisel 2026; slot
//! conformance after Zattera 2022), the name says "inspired by" and the
//! exact published definition must be checked against the paper before
//! registration.
//!
//! All arithmetic follows the kernel's numeric profile (libm, ordered
//! maps, fixed summation order).

use std::collections::BTreeMap;

use vah_corpus::Corpus;

const SPACE: u8 = b' ';

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

fn conditional_entropy(bi: &BTreeMap<(u8, u8), u64>) -> f64 {
    let total: u64 = bi.values().sum();
    if total == 0 {
        return 0.0;
    }
    let mut first: BTreeMap<u8, u64> = BTreeMap::new();
    for ((x, _), c) in bi {
        *first.entry(*x).or_insert(0) += c;
    }
    entropy(bi.values(), total) - entropy(first.values(), total)
}

/// A slot table parser (the same rule as the `slotgram` generator): does a
/// word parse as the table's slots in order, each slot filled with one of
/// its alternatives or left empty?
pub struct SlotTable {
    slots: Vec<Vec<Vec<u8>>>,
}

impl SlotTable {
    /// Parse a table: slots separated by `|`, alternatives by `,`, `_` empty.
    pub fn parse(table: &str) -> Option<SlotTable> {
        let mut slots = Vec::new();
        for slot in table.split('|') {
            let alts: Vec<Vec<u8>> = slot
                .split(',')
                .map(str::trim)
                .filter(|a| !a.is_empty() && *a != "_")
                .map(|a| {
                    a.bytes()
                        .filter(|b| b.is_ascii_alphanumeric())
                        .collect::<Vec<u8>>()
                })
                .filter(|a| !a.is_empty())
                .collect();
            if alts.is_empty() {
                return None;
            }
            slots.push(alts);
        }
        if slots.is_empty() {
            None
        } else {
            Some(SlotTable { slots })
        }
    }

    pub fn conforms(&self, word: &[u8]) -> bool {
        let n = word.len();
        let mut reach = vec![false; n + 1];
        reach[0] = true;
        for alts in &self.slots {
            let mut next = reach.clone();
            for pos in 0..=n {
                if !reach[pos] {
                    continue;
                }
                for a in alts {
                    if word[pos..].starts_with(a) {
                        next[pos + a.len()] = true;
                    }
                }
            }
            reach = next;
        }
        reach[n]
    }
}

/// The default slot table used for the conformance statistic (the same
/// approximation of Zattera's structure as the `slotgram` generator's
/// default; to be verified by the domain advisor).
pub const DEFAULT_SLOT_TABLE: &str =
    "q,_|o,y,s,d,_|l,r,_|t,k,p,f,_|ch,sh,_|e,ee,eee,_|t,k,p,f,_|o,a,_|i,ii,iii,_|d,l,r,m,n,_|y,_";

/// Compute the candidate statistics. Keys are stable names; values are
/// finite for a non-empty corpus and zero for an empty one.
pub fn candidate_stats(c: &Corpus, slot_table: Option<&SlotTable>) -> BTreeMap<String, f64> {
    let mut out: BTreeMap<String, f64> = BTreeMap::new();
    let mut put = |k: &str, v: f64| {
        out.insert(k.to_string(), if v == 0.0 { 0.0 } else { v });
    };

    // --- line-position effects (inspired by Currier's LAAFU observations) ---
    let mut line_first_initial: BTreeMap<u8, u64> = BTreeMap::new();
    let mut other_initial: BTreeMap<u8, u64> = BTreeMap::new();
    let mut line_last_final: BTreeMap<u8, u64> = BTreeMap::new();
    let mut other_final: BTreeMap<u8, u64> = BTreeMap::new();
    let (mut n_first, mut n_other_i, mut n_last, mut n_other_f) = (0u64, 0u64, 0u64, 0u64);
    // word length by relative position in the line (slope of a least-squares fit)
    let (mut sx, mut sy, mut sxx, mut sxy, mut npos) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0u64);
    // cross-word: previous word's last glyph -> next word's first glyph
    let mut cross: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    // forward and backward glyph bigrams within words
    let mut fwd: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    let mut bwd: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    let mut conforming = 0u64;
    let mut words_total = 0u64;
    let mut para_first_initial: BTreeMap<u8, u64> = BTreeMap::new();
    let mut n_para_first = 0u64;

    for line in &c.lines {
        let n = line.words.len();
        if n == 0 {
            continue;
        }
        for (i, w) in line.words.iter().enumerate() {
            let b = w.as_bytes();
            if b.is_empty() {
                continue;
            }
            words_total += 1;
            let first = b[0];
            let last = b[b.len() - 1];
            if i == 0 {
                *line_first_initial.entry(first).or_insert(0) += 1;
                n_first += 1;
                if line.para_start {
                    *para_first_initial.entry(first).or_insert(0) += 1;
                    n_para_first += 1;
                }
            } else {
                *other_initial.entry(first).or_insert(0) += 1;
                n_other_i += 1;
            }
            if i + 1 == n {
                *line_last_final.entry(last).or_insert(0) += 1;
                n_last += 1;
            } else {
                *other_final.entry(last).or_insert(0) += 1;
                n_other_f += 1;
            }
            if n > 1 {
                let x = i as f64 / (n - 1) as f64;
                let y = b.len() as f64;
                sx += x;
                sy += y;
                sxx += x * x;
                sxy += x * y;
                npos += 1;
            }
            if i > 0 {
                let prev = line.words[i - 1].as_bytes();
                if let Some(&pl) = prev.last() {
                    *cross.entry((pl, first)).or_insert(0) += 1;
                }
            }
            for k in 1..b.len() {
                *fwd.entry((b[k - 1], b[k])).or_insert(0) += 1;
                *bwd.entry((b[k], b[k - 1])).or_insert(0) += 1;
            }
            if let Some(t) = slot_table {
                if t.conforms(b) {
                    conforming += 1;
                }
            }
        }
    }

    put(
        "line_first_initial_h",
        entropy(line_first_initial.values(), n_first),
    );
    put(
        "other_initial_h",
        entropy(other_initial.values(), n_other_i),
    );
    put(
        "line_last_final_h",
        entropy(line_last_final.values(), n_last),
    );
    put("other_final_h", entropy(other_final.values(), n_other_f));
    put(
        "para_first_initial_h",
        entropy(para_first_initial.values(), n_para_first),
    );
    // Jensen-Shannon-style divergence between line-first and other initial glyph distributions
    put(
        "line_first_initial_js",
        js_divergence(&line_first_initial, n_first, &other_initial, n_other_i),
    );
    put(
        "line_last_final_js",
        js_divergence(&line_last_final, n_last, &other_final, n_other_f),
    );
    let slope = if npos > 1 {
        let m = npos as f64;
        let mx = sx / m;
        let my = sy / m;
        let var = sxx / m - mx * mx;
        if var > 0.0 {
            (sxy / m - mx * my) / var
        } else {
            0.0
        }
    } else {
        0.0
    };
    put("wlen_position_slope", slope);

    // --- directional constraints (inspired by Parisel 2026) ---
    put("cross_word_h2", conditional_entropy(&cross));
    put("h2_forward", conditional_entropy(&fwd));
    put("h2_backward", conditional_entropy(&bwd));
    put(
        "h2_backward_minus_forward",
        conditional_entropy(&bwd) - conditional_entropy(&fwd),
    );
    // asymmetry: share of ordered-pair mass whose reverse pair is rarer, over pairs of distinct glyphs
    let total_fwd: u64 = fwd
        .iter()
        .filter(|((a, b), _)| a != b)
        .map(|(_, c)| *c)
        .sum();
    let mut dominant = 0u64;
    let mut one_way = 0u64;
    for ((a, b), cnt) in &fwd {
        if a == b {
            continue;
        }
        let rev = fwd.get(&(*b, *a)).copied().unwrap_or(0);
        if *cnt > rev {
            dominant += cnt;
        }
        if rev == 0 {
            one_way += cnt;
        }
    }
    put(
        "bigram_asymmetry",
        if total_fwd == 0 {
            0.0
        } else {
            dominant as f64 / total_fwd as f64
        },
    );
    put(
        "bigram_one_way_mass",
        if total_fwd == 0 {
            0.0
        } else {
            one_way as f64 / total_fwd as f64
        },
    );

    // --- slot conformance (inspired by Zattera 2022) ---
    if slot_table.is_some() {
        put(
            "slot_conformance",
            if words_total == 0 {
                0.0
            } else {
                conforming as f64 / words_total as f64
            },
        );
    }
    let _ = SPACE;
    out
}

fn js_divergence(a: &BTreeMap<u8, u64>, na: u64, b: &BTreeMap<u8, u64>, nb: u64) -> f64 {
    if na == 0 || nb == 0 {
        return 0.0;
    }
    let mut keys: Vec<u8> = a.keys().chain(b.keys()).copied().collect();
    keys.sort_unstable();
    keys.dedup();
    let mut js = 0.0f64;
    for k in keys {
        let p = a.get(&k).copied().unwrap_or(0) as f64 / na as f64;
        let q = b.get(&k).copied().unwrap_or(0) as f64 / nb as f64;
        let m = 0.5 * (p + q);
        if p > 0.0 {
            js += 0.5 * p * libm::log2(p / m);
        }
        if q > 0.0 {
            js += 0.5 * q * libm::log2(q / m);
        }
    }
    js
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
    fn slot_table_parses_and_conforms() {
        let t = SlotTable::parse(DEFAULT_SLOT_TABLE).unwrap();
        assert!(t.conforms(b"qokeedy"));
        assert!(t.conforms(b"daiin"));
        assert!(!t.conforms(b"kkkk"));
        assert!(SlotTable::parse("_,_").is_none());
        assert!(SlotTable::parse("").is_none());
    }

    #[test]
    fn statistics_are_finite_and_sensible() {
        let c = corpus(&[
            "daiin.chol.chor.qokedy.shedy",
            "qokeedy.daiin.ol.chey.dar",
            "otedy.daiin.qokain.chedy.okal",
        ]);
        let t = SlotTable::parse(DEFAULT_SLOT_TABLE).unwrap();
        let s = candidate_stats(&c, Some(&t));
        assert!(s.values().all(|v| v.is_finite()));
        assert_eq!(s["slot_conformance"], 1.0);
        assert!(s["bigram_asymmetry"] > 0.5, "{}", s["bigram_asymmetry"]);
        assert!(s.contains_key("cross_word_h2") && s.contains_key("wlen_position_slope"));
        // a symmetric text has no asymmetry and equal forward/backward entropies
        let sym = corpus(&["abba.abba.abba", "baab.baab.baab"]);
        let s = candidate_stats(&sym, None);
        assert_eq!(s["bigram_asymmetry"], 0.0);
        assert_eq!(s["h2_backward_minus_forward"], 0.0);
        assert!(!s.contains_key("slot_conformance"));
        assert!(candidate_stats(&Corpus::default(), None)
            .values()
            .all(|v| *v == 0.0));
        // words that get longer along the line give a positive slope
        let grow = corpus(&["a.bb.ccc.dddd", "e.ff.ggg.hhhh"]);
        assert!(candidate_stats(&grow, None)["wlen_position_slope"] > 0.0);
    }
}
