//! Naibbe v2 mechanism, whitespace-preserved output, ChaCha8 random stream.
//! Tables and construction: Michael A. Greshko (2025), modified MIT.
//! Cite doi:10.1080/01611194.2025.2566408. See third_party/naibbe/LICENSE.
//! This port fails closed at the retry bound (upstream emits its last attempt).
//! Global plaintext permutations preserve the table collision restrictions;
//! this extension reduces to substitution after parsing the known structure.
use crate::{Res, A, ALPHABET};
use std::collections::{BTreeMap, BTreeSet};
use vah_generators::Rng;

const CSV: &str = include_str!("../../../../third_party/naibbe/references/naibbe_tables.csv");
const TABLES: [&str; 6] = ["alpha", "beta1", "beta2", "beta3", "gamma1", "gamma2"];
pub struct Tables {
    glyphs: BTreeMap<String, String>,
    unigram: BTreeMap<String, u8>,
    /// Combined glyphs -> all distinct prefix/suffix codes. The encoder
    /// rejects cross-bigram collisions even if their plaintext happens to match.
    pairs: BTreeMap<String, Vec<(String, String, u8, u8)>>,
}
impl Default for Tables {
    fn default() -> Self {
        Self::new()
    }
}
impl Tables {
    pub fn new() -> Self {
        let glyphs: BTreeMap<_, _> = CSV
            .lines()
            .skip(1)
            .filter_map(|l| l.trim().split_once(','))
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect();
        let mut unigram = BTreeMap::new();
        let mut pairs: BTreeMap<String, Vec<(String, String, u8, u8)>> = BTreeMap::new();
        for table in TABLES {
            for (i, c) in ALPHABET.chars().enumerate() {
                unigram.insert(glyphs[&format!("unigram_{table}_{c}")].clone(), i as u8);
            }
        }
        for t1 in TABLES {
            for (i, a) in ALPHABET.chars().enumerate() {
                for t2 in TABLES {
                    for (j, b) in ALPHABET.chars().enumerate() {
                        let pc = format!("prefix_{t1}_{a}");
                        let sc = format!("suffix_{t2}_{b}");
                        let combined = glyphs[&pc].clone() + &glyphs[&sc];
                        pairs
                            .entry(combined)
                            .or_default()
                            .push((pc, sc, i as u8, j as u8));
                    }
                }
            }
        }
        Self {
            glyphs,
            unigram,
            pairs,
        }
    }
    /// Known published parser. No hidden key enters this function.
    pub fn parse(&self, text: &str) -> Res<Vec<u8>> {
        let mut out = Vec::new();
        for token in text.split_whitespace() {
            if let Some(c) = self.unigram.get(token) {
                out.push(*c);
            } else if let Some(p) = self.pairs.get(token) {
                if p.len() != 1 {
                    return Err(format!("ambiguous Naibbe token: {token}"));
                }
                out.extend([p[0].2, p[0].3]);
            } else {
                return Err(format!("unparsed Naibbe token: {token}"));
            }
        }
        Ok(out)
    }
    pub fn encrypt(&self, plain: &[u8], key: &[u8], seed: u64) -> Res<String> {
        if plain.iter().any(|c| *c as usize >= A)
            || key.len() != A
            || key.iter().any(|c| *c as usize >= A)
            || key.iter().collect::<BTreeSet<_>>().len() != A
        {
            return Err("invalid Naibbe text or global key".into());
        }
        let mut rng = Rng::new("naibbe-v2-strict-chacha8", seed);
        // Respacing is completed before deck draws, as in the published code.
        let mut tokens = Vec::new();
        let mut i = 0;
        while i < plain.len() {
            let len = if i + 1 == plain.len() || rng.unit() < 17.0 / 36.0 {
                1
            } else {
                2
            };
            tokens.push(&plain[i..i + len]);
            i += len;
        }
        let mut deck = Vec::new();
        let mut cursor = 0;
        let mut out = Vec::new();
        fn draw(rng: &mut Rng, deck: &mut Vec<usize>, cursor: &mut usize) -> usize {
            if *cursor >= deck.len() {
                deck.clear();
                for (table, count) in [28, 14, 11, 11, 7, 7].iter().enumerate() {
                    deck.extend(std::iter::repeat_n(table, *count));
                }
                for i in (1..deck.len()).rev() {
                    let j = rng.below(i + 1);
                    deck.swap(i, j);
                }
                *cursor = 0;
            }
            let t = deck[*cursor];
            *cursor += 1;
            t
        }
        for token in tokens {
            let a = ALPHABET.as_bytes()[key[token[0] as usize] as usize] as char;
            if token.len() == 1 {
                let t = TABLES[draw(&mut rng, &mut deck, &mut cursor)];
                out.push(self.glyphs[&format!("unigram_{t}_{a}")].clone());
            } else {
                let b = ALPHABET.as_bytes()[key[token[1] as usize] as usize] as char;
                let mut accepted = None;
                for _ in 0..10_000 {
                    let t1 = TABLES[draw(&mut rng, &mut deck, &mut cursor)];
                    let t2 = TABLES[draw(&mut rng, &mut deck, &mut cursor)];
                    let pc = format!("prefix_{t1}_{a}");
                    let sc = format!("suffix_{t2}_{b}");
                    let word = self.glyphs[&pc].clone() + &self.glyphs[&sc];
                    if !self.unigram.contains_key(&word)
                        && self
                            .pairs
                            .get(&word)
                            .is_some_and(|p| p.len() == 1 && p[0].0 == pc && p[0].1 == sc)
                    {
                        accepted = Some(word);
                        break;
                    }
                }
                out.push(accepted.ok_or(
                    "Naibbe collision retry budget exhausted; no ambiguous output emitted",
                )?);
            }
        }
        Ok(out.join(" "))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn published_table_tokens_and_global_permutation_roundtrip() {
        let t = Tables::new();
        let plain: Vec<_> = (0..1000).map(|i| (i % A) as u8).collect();
        let key: Vec<_> = (0..A).map(|i| ((i + 7) % A) as u8).collect();
        assert_eq!(t.parse("ol qokchdy chey").unwrap(), vec![0, 1, 2]);
        for seed in [1, 2, 3, 99] {
            let cipher = t.encrypt(&plain, &key, seed).unwrap();
            assert_eq!(
                t.parse(&cipher).unwrap(),
                plain.iter().map(|c| key[*c as usize]).collect::<Vec<_>>()
            );
        }
        assert!(t.parse("invalid-glyph").is_err());
    }
}
