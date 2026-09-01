//! Corpus types shared by the IVTFF parser, the text generators and the
//! statistics module.
//!
//! A [`Corpus`] is a list of lines. Each line belongs to a page and carries
//! the words that were read on it, in order, plus paragraph boundary flags.
//! Words are plain ASCII strings in the EVA transliteration alphabet. The
//! structure is deliberately flat so that generators can produce it cheaply
//! and statistics can walk it without allocation.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// Metadata of one manuscript page, taken from IVTFF page variables.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageMeta {
    /// Page name, e.g. `f1r`.
    pub name: String,
    /// `$Q` quire letter.
    pub quire: Option<String>,
    /// `$P` page position within the quire.
    pub page_in_quire: Option<String>,
    /// `$I` illustration type (H herbal, A astronomical, B biological,
    /// C cosmological, P pharmaceutical, S stars/recipes, T text only, Z zodiac).
    pub illustration: Option<char>,
    /// `$L` Currier language: `A` or `B`.
    pub currier: Option<char>,
    /// `$H` scribal hand as recorded in the transliteration.
    pub hand: Option<char>,
}

/// One line of text (one IVTFF locus, or one generated line).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Line {
    /// Index into [`Corpus::pages`].
    pub page: u32,
    /// Words in reading order. Never empty strings.
    pub words: Vec<String>,
    /// The line starts a paragraph.
    pub para_start: bool,
    /// The line ends a paragraph.
    pub para_end: bool,
}

/// A text corpus with page structure.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Corpus {
    pub pages: Vec<PageMeta>,
    pub lines: Vec<Line>,
}

impl Corpus {
    /// A corpus with one anonymous page and no lines.
    pub fn single_page(name: &str) -> Self {
        Corpus {
            pages: vec![PageMeta {
                name: name.to_string(),
                ..PageMeta::default()
            }],
            lines: Vec::new(),
        }
    }

    /// Number of word tokens.
    pub fn word_count(&self) -> usize {
        self.lines.iter().map(|l| l.words.len()).sum()
    }

    /// Number of glyphs (bytes) over all words, spaces excluded.
    pub fn glyph_count(&self) -> usize {
        self.lines
            .iter()
            .flat_map(|l| l.words.iter())
            .map(|w| w.len())
            .sum()
    }

    /// Iterate over all word tokens in reading order.
    pub fn words(&self) -> impl Iterator<Item = &str> {
        self.lines
            .iter()
            .flat_map(|l| l.words.iter().map(String::as_str))
    }

    /// Keep only lines whose page satisfies `keep`. Pages are re-indexed and
    /// pages that lose all their lines are dropped, so the result is compact.
    pub fn filter_pages<F: Fn(&PageMeta) -> bool>(&self, keep: F) -> Corpus {
        let mut map: Vec<Option<u32>> = vec![None; self.pages.len()];
        let mut pages = Vec::new();
        for (i, p) in self.pages.iter().enumerate() {
            if keep(p) {
                map[i] = Some(pages.len() as u32);
                pages.push(p.clone());
            }
        }
        let lines = self
            .lines
            .iter()
            .filter_map(|l| {
                map[l.page as usize].map(|np| Line {
                    page: np,
                    words: l.words.clone(),
                    para_start: l.para_start,
                    para_end: l.para_end,
                })
            })
            .collect();
        Corpus { pages, lines }
    }

    /// Lines of one Currier language (`'A'` or `'B'`).
    pub fn currier(&self, lang: char) -> Corpus {
        self.filter_pages(|p| p.currier == Some(lang))
    }

    /// Render as plain text: words joined by `.`, one line per text line,
    /// an empty line after each paragraph end.
    pub fn to_text(&self) -> String {
        let mut out = String::new();
        for l in &self.lines {
            out.push_str(&l.words.join("."));
            out.push('\n');
            if l.para_end {
                out.push('\n');
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Corpus {
        Corpus {
            pages: vec![
                PageMeta {
                    name: "p1".into(),
                    currier: Some('A'),
                    ..Default::default()
                },
                PageMeta {
                    name: "p2".into(),
                    currier: Some('B'),
                    ..Default::default()
                },
            ],
            lines: vec![
                Line {
                    page: 0,
                    words: vec!["daiin".into(), "chol".into()],
                    para_start: true,
                    para_end: false,
                },
                Line {
                    page: 1,
                    words: vec!["qokedy".into()],
                    para_start: false,
                    para_end: true,
                },
            ],
        }
    }

    #[test]
    fn counts() {
        let c = sample();
        assert_eq!(c.word_count(), 3);
        assert_eq!(c.glyph_count(), 15);
    }

    #[test]
    fn currier_filter_reindexes_pages() {
        let b = sample().currier('B');
        assert_eq!(b.pages.len(), 1);
        assert_eq!(b.lines.len(), 1);
        assert_eq!(b.lines[0].page, 0);
        assert_eq!(b.lines[0].words[0], "qokedy");
    }

    #[test]
    fn text_rendering() {
        assert_eq!(sample().to_text(), "daiin.chol\nqokedy\n\n");
    }
}
