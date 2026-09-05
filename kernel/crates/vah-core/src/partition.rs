//! Grouped partitions of the manuscript.
//!
//! Confirmation data must be whole codicological groups (quires), never
//! random lines: nearby loci share scribe, section, vocabulary and
//! transcription decisions. This module assigns every quire to exactly one
//! role (discovery, validation, confirmation) with a deterministic rule that
//! balances word mass per Currier stratum, and filters a corpus to a set of
//! roles. The rule has no random element, so there is nothing to pick.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use vah_corpus::Corpus;

pub const PARTITION_SCHEMA: &str = "vah-partition-0.1";
/// Identifier of the assignment rule implemented by [`assign`].
pub const ASSIGNMENT_RULE: &str = "largest-first-language-deficit-v1";
/// Roles in tie-break order.
pub const ROLES: [&str; 3] = ["discovery", "validation", "confirmation"];

/// One quire and its role.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QuireAssignment {
    pub quire: String,
    pub role: String,
    pub pages: Vec<String>,
    pub words: usize,
    pub words_currier_a: usize,
    pub words_currier_b: usize,
}

/// Totals per role.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RoleTotals {
    pub quires: Vec<String>,
    pub words: usize,
    pub words_currier_a: usize,
    pub words_currier_b: usize,
}

/// The partition manifest (a registered artifact).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: String,
    pub source_digest: String,
    pub view_id: String,
    pub grouping_unit: String,
    /// The assignment rule (see [`ASSIGNMENT_RULE`]).
    pub rule: String,
    /// Target word fractions per role.
    pub fractions: BTreeMap<String, f64>,
    pub quires: Vec<QuireAssignment>,
    pub roles: BTreeMap<String, RoleTotals>,
    /// Pages without a quire variable; excluded from every role.
    pub unassigned_pages: Vec<String>,
}

impl Manifest {
    /// Role of a quire, if assigned.
    pub fn role_of(&self, quire: &str) -> Option<&str> {
        self.quires
            .iter()
            .find(|q| q.quire == quire)
            .map(|q| q.role.as_str())
    }
}

/// Assign quires to roles.
///
/// Quires are visited from the largest to the smallest (ties by name). Each
/// quire goes to the role whose remaining word deficit, summed over the
/// strata Currier A, Currier B and unlabelled, it fills best (ties in
/// `ROLES` order). The largest quires therefore land in the largest roles
/// first, and the medium quires then balance every role across languages,
/// which a random visiting order does not guarantee when two quires hold
/// most of one language.
pub fn assign(
    corpus: &Corpus,
    source_digest: &str,
    view_id: &str,
    fractions: &[(&str, f64)],
) -> Manifest {
    // Canonical role order, independent of the order the caller used, so the
    // tie-break rule is part of the algorithm and not of the call site.
    let fractions: Vec<(&str, f64)> = ROLES
        .iter()
        .filter_map(|r| {
            fractions
                .iter()
                .find(|(name, _)| name == r)
                .map(|(_, f)| (*r, *f))
        })
        .collect();
    let fractions = fractions.as_slice();
    // Word counts per page, per stratum.
    let mut per_page: Vec<[usize; 3]> = vec![[0; 3]; corpus.pages.len()];
    for line in &corpus.lines {
        let p = line.page as usize;
        let stratum = match corpus.pages[p].currier {
            Some('A') => 0,
            Some('B') => 1,
            _ => 2,
        };
        per_page[p][stratum] += line.words.len();
    }
    // Group by quire.
    let mut quires: BTreeMap<String, (Vec<String>, [usize; 3])> = BTreeMap::new();
    let mut unassigned = Vec::new();
    for (i, page) in corpus.pages.iter().enumerate() {
        match &page.quire {
            Some(q) => {
                let e = quires
                    .entry(q.clone())
                    .or_insert_with(|| (Vec::new(), [0; 3]));
                e.0.push(page.name.clone());
                for (dst, src) in e.1.iter_mut().zip(per_page[i]) {
                    *dst += src;
                }
            }
            None => unassigned.push(page.name.clone()),
        }
    }
    let totals = quires.values().fold([0usize; 3], |mut acc, (_, w)| {
        for (dst, src) in acc.iter_mut().zip(w) {
            *dst += src;
        }
        acc
    });
    // Largest first, ties by name.
    let mut order: Vec<String> = quires.keys().cloned().collect();
    order.sort_by(|a, b| {
        let wa: usize = quires[a].1.iter().sum();
        let wb: usize = quires[b].1.iter().sum();
        wb.cmp(&wa).then_with(|| a.cmp(b))
    });
    // Greedy deficit assignment.
    let mut assigned: BTreeMap<&str, [usize; 3]> =
        fractions.iter().map(|(r, _)| (*r, [0; 3])).collect();
    let mut result: Vec<QuireAssignment> = Vec::new();
    for q in &order {
        let (pages, w) = &quires[q];
        let mut best: Option<(&str, f64)> = None;
        for (role, frac) in fractions {
            let a = assigned[role];
            let mut score = 0.0f64;
            for ((total, have), want) in totals.iter().zip(a).zip(w) {
                let target = frac * *total as f64;
                let deficit = (target - have as f64).max(0.0);
                score += deficit.min(*want as f64);
            }
            if best.is_none_or(|(_, b)| score > b) {
                best = Some((role, score));
            }
        }
        let role = best.map(|(r, _)| r).unwrap_or(ROLES[0]);
        let a = assigned.get_mut(role).expect("role");
        for (dst, src) in a.iter_mut().zip(w) {
            *dst += src;
        }
        result.push(QuireAssignment {
            quire: q.clone(),
            role: role.to_string(),
            pages: pages.clone(),
            words: w[0] + w[1] + w[2],
            words_currier_a: w[0],
            words_currier_b: w[1],
        });
    }
    result.sort_by(|a, b| a.quire.cmp(&b.quire));
    let mut roles: BTreeMap<String, RoleTotals> = fractions
        .iter()
        .map(|(r, _)| (r.to_string(), RoleTotals::default()))
        .collect();
    for q in &result {
        let t = roles.get_mut(&q.role).expect("role totals");
        t.quires.push(q.quire.clone());
        t.words += q.words;
        t.words_currier_a += q.words_currier_a;
        t.words_currier_b += q.words_currier_b;
    }
    Manifest {
        schema_version: PARTITION_SCHEMA.to_string(),
        source_digest: source_digest.to_string(),
        view_id: view_id.to_string(),
        grouping_unit: "quire".to_string(),
        rule: ASSIGNMENT_RULE.to_string(),
        fractions: fractions.iter().map(|(r, f)| (r.to_string(), *f)).collect(),
        quires: result,
        roles,
        unassigned_pages: unassigned,
    }
}

/// Keep only the pages whose quire has one of `roles`. Pages without a
/// quire are dropped.
pub fn filter(corpus: &Corpus, manifest: &Manifest, roles: &[String]) -> Corpus {
    corpus.filter_pages(|p| {
        p.quire
            .as_deref()
            .and_then(|q| manifest.role_of(q))
            .map(|r| roles.iter().any(|x| x == r))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use vah_corpus::{Line, PageMeta};

    fn corpus() -> Corpus {
        // 6 quires: sizes 60, 10, 30, 5, 20, 15 words; languages alternate.
        let sizes = [
            ("A", 60, 'A'),
            ("B", 10, 'B'),
            ("C", 30, 'A'),
            ("D", 5, 'B'),
            ("E", 20, 'A'),
            ("F", 15, 'B'),
        ];
        let mut c = Corpus::default();
        for (q, n, lang) in sizes {
            c.pages.push(PageMeta {
                name: format!("f{q}"),
                quire: Some(q.to_string()),
                currier: Some(lang),
                ..Default::default()
            });
            let page = (c.pages.len() - 1) as u32;
            c.lines.push(Line {
                page,
                words: (0..n).map(|i| format!("w{i}")).collect(),
                para_start: true,
                para_end: true,
            });
        }
        c.pages.push(PageMeta {
            name: "fRos".into(),
            ..Default::default()
        });
        c.lines.push(Line {
            page: 6,
            words: vec!["x".into()],
            para_start: true,
            para_end: true,
        });
        c
    }

    #[test]
    fn assignment_is_deterministic_balanced_and_whole_quire() {
        let fr = [
            ("discovery", 0.55),
            ("validation", 0.25),
            ("confirmation", 0.20),
        ];
        let m1 = assign(&corpus(), "sha256:x", "para-v1", &fr);
        let m2 = assign(&corpus(), "sha256:x", "para-v1", &fr);
        assert_eq!(m1, m2);
        assert_eq!(m1.rule, ASSIGNMENT_RULE);
        assert_eq!(m1.quires.len(), 6);
        assert_eq!(m1.unassigned_pages, vec!["fRos".to_string()]);
        let total: usize = m1.roles.values().map(|r| r.words).sum();
        assert_eq!(total, 140);
        // the largest quire goes to the largest role
        assert_eq!(m1.role_of("A"), Some("discovery"));
        for r in ROLES {
            assert!(m1.roles[r].words > 0, "{r} is empty: {m1:?}");
        }
    }

    #[test]
    fn fraction_order_does_not_change_the_assignment() {
        let a = assign(
            &corpus(),
            "sha256:x",
            "para-v1",
            &[
                ("discovery", 0.55),
                ("validation", 0.25),
                ("confirmation", 0.20),
            ],
        );
        let b = assign(
            &corpus(),
            "sha256:x",
            "para-v1",
            &[
                ("confirmation", 0.20),
                ("discovery", 0.55),
                ("validation", 0.25),
            ],
        );
        assert_eq!(a, b);
    }

    #[test]
    fn filter_keeps_only_requested_roles() {
        let fr = [
            ("discovery", 0.55),
            ("validation", 0.25),
            ("confirmation", 0.20),
        ];
        let m = assign(&corpus(), "sha256:x", "para-v1", &fr);
        let conf = filter(&corpus(), &m, &["confirmation".to_string()]);
        assert_eq!(conf.word_count(), m.roles["confirmation"].words);
        let dv = filter(
            &corpus(),
            &m,
            &["discovery".to_string(), "validation".to_string()],
        );
        assert_eq!(dv.word_count() + conf.word_count(), 140);
        assert!(dv.pages.iter().all(|p| p.quire.is_some()));
    }
}
