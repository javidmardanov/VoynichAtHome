//! Parser for the Intermediate Voynich Transliteration File Format (IVTFF),
//! format version 2.0, as published by René Zandbergen at voynich.nu.
//!
//! The parser is lossless: every construct in a locus is kept as an [`Item`]
//! so that a corpus view can decide what to do with alternatives, ligatures,
//! rare glyphs and uncertain spaces. [`build_corpus`] applies a
//! [`ViewPolicy`] to turn a parsed [`Document`] into a [`Corpus`].
//!
//! This code was written from the format description only. It does not copy
//! the IVTT reference implementation, whose source has no open license.
//!
//! Format summary (the subset this parser understands):
//!
//! * First line: `#=IVTFF <alphabet> <version> ...`.
//! * Lines starting with `#` are comments.
//! * `<f1r>` starts a page. An optional `<! $Q=A $P=A ...>` on the same line
//!   carries page variables.
//! * `<f1r.3,+P0>` starts a locus: page, locus number, and a three-character
//!   locus type (position marker, category, detail). The text follows.
//! * In text: `.` certain word space, `,` uncertain word space,
//!   `<->` drawing gap, `<~>` drawing gap without a word break,
//!   `<%>` paragraph start, `<$>` paragraph end, `<!...>` comment,
//!   `<@H=n>` change of hand, `[a:b]` alternative readings (first preferred),
//!   `{...}` ligature, `@nnn;` rare glyph code, `?` unreadable glyph.
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fmt;

use vah_corpus::{Corpus, Line, PageMeta};

/// The `#=IVTFF` header line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    /// Transliteration alphabet, e.g. `Eva-`.
    pub alphabet: String,
    /// Format version, e.g. `2.0`.
    pub version: String,
    /// Remaining header fields, verbatim.
    pub extra: String,
}

/// A parsed file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub header: Header,
    pub pages: Vec<Page>,
}

/// One page with its variables and loci.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub name: String,
    /// Page variables keyed by letter (`Q`, `P`, `F`, `B`, `I`, `L`, `H`, `C`, `X`).
    pub vars: BTreeMap<char, String>,
    pub loci: Vec<Locus>,
}

/// Three-character locus type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocusType {
    /// Position marker: `@` `+` `*` `=` `&` `~` and others.
    pub position: char,
    /// Category: `P` paragraph text, `L` label, `C` circular, `R` radial, ...
    pub category: char,
    /// Detail character.
    pub detail: char,
}

/// One locus (normally one line of text).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Locus {
    /// Locus number within the page, e.g. `3` or `12a`.
    pub number: String,
    pub kind: LocusType,
    pub items: Vec<Item>,
    /// Source line number (1-based) for diagnostics.
    pub line_no: usize,
}

/// A lossless element of locus text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Item {
    /// Plain ASCII letter or digit.
    Glyph(char),
    /// Rare glyph: an `@nnn;` code (stored as-is) or a non-ASCII character.
    Rare(String),
    /// `?` unreadable glyph.
    Unreadable,
    /// `'` mark attached to the previous glyph.
    Mark,
    /// `.` certain word space.
    Space,
    /// `,` uncertain word space.
    UncertainSpace,
    /// `<->` the text is interrupted by a drawing.
    DrawingGap,
    /// `<~>` the text is interrupted by a drawing, word may continue.
    DrawingGapNoBreak,
    /// `<%>` start of paragraph.
    ParaStart,
    /// `<$>` end of paragraph.
    ParaEnd,
    /// `[a:b:...]` alternative readings; the first is preferred.
    Alternatives(Vec<Vec<Item>>),
    /// `{...}` glyphs written as a ligature.
    Ligature(Vec<Item>),
    /// `<!...>` inline comment.
    Comment(String),
    /// `<@H=n>` change of hand inside a locus.
    HandChange(char),
    /// Any other `<...>` tag, content verbatim.
    Tag(String),
    /// `!` or `%` filler characters outside tags.
    Filler,
    /// Any other ASCII character.
    Other(char),
}

/// Parse failure with the source line number.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseError {
    MissingHeader,
    BadHeader(String),
    BadLocus { line: usize, text: String },
    Unbalanced { line: usize, text: String },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::MissingHeader => write!(f, "missing #=IVTFF header line"),
            ParseError::BadHeader(h) => write!(f, "malformed header: {h}"),
            ParseError::BadLocus { line, text } => {
                write!(f, "line {line}: malformed locus: {text}")
            }
            ParseError::Unbalanced { line, text } => {
                write!(f, "line {line}: unbalanced bracket or tag: {text}")
            }
        }
    }
}

impl std::error::Error for ParseError {}

/// Parse a whole IVTFF file.
pub fn parse(src: &str) -> Result<Document, ParseError> {
    let mut lines = src
        .lines()
        .enumerate()
        .map(|(i, l)| (i + 1, l.trim_end_matches('\r')));

    let header = loop {
        match lines.next() {
            None => return Err(ParseError::MissingHeader),
            Some((_, l)) if l.trim().is_empty() => continue,
            Some((_, l)) => break parse_header(l)?,
        }
    };

    let mut pages: Vec<Page> = Vec::new();
    for (line_no, raw) in lines {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if !line.starts_with('<') {
            // Text outside a locus is not expected; keep parsing leniently.
            continue;
        }
        let close = line.find('>').ok_or_else(|| ParseError::Unbalanced {
            line: line_no,
            text: line.to_string(),
        })?;
        let id = &line[1..close];
        let rest = &line[close + 1..];
        if id.contains('.') {
            let (page_name, number, kind) =
                parse_locus_id(id).ok_or_else(|| ParseError::BadLocus {
                    line: line_no,
                    text: line.to_string(),
                })?;
            let items = parse_items(rest.trim(), line_no)?;
            let locus = Locus {
                number,
                kind,
                items,
                line_no,
            };
            match pages.last_mut() {
                Some(p) if p.name == page_name => p.loci.push(locus),
                _ => pages.push(Page {
                    name: page_name,
                    vars: BTreeMap::new(),
                    loci: vec![locus],
                }),
            }
        } else {
            let vars = parse_page_vars(rest);
            pages.push(Page {
                name: id.to_string(),
                vars,
                loci: Vec::new(),
            });
        }
    }
    Ok(Document { header, pages })
}

fn parse_header(line: &str) -> Result<Header, ParseError> {
    let body = line
        .strip_prefix("#=IVTFF")
        .ok_or_else(|| ParseError::BadHeader(line.to_string()))?;
    let mut fields = body.split_whitespace();
    let alphabet = fields
        .next()
        .ok_or_else(|| ParseError::BadHeader(line.to_string()))?;
    let version = fields
        .next()
        .ok_or_else(|| ParseError::BadHeader(line.to_string()))?;
    let extra = fields.collect::<Vec<_>>().join(" ");
    Ok(Header {
        alphabet: alphabet.to_string(),
        version: version.to_string(),
        extra,
    })
}

fn parse_locus_id(id: &str) -> Option<(String, String, LocusType)> {
    let (page, rest) = id.split_once('.')?;
    let (number, kind) = rest.split_once(',')?;
    let mut k = kind.chars();
    let kind = LocusType {
        position: k.next()?,
        category: k.next()?,
        detail: k.next()?,
    };
    if k.next().is_some() || page.is_empty() || number.is_empty() {
        return None;
    }
    Some((page.to_string(), number.to_string(), kind))
}

fn parse_page_vars(rest: &str) -> BTreeMap<char, String> {
    let mut vars = BTreeMap::new();
    let mut s = rest;
    while let Some(pos) = s.find('$') {
        s = &s[pos + 1..];
        let mut chars = s.chars();
        let (Some(key), Some('=')) = (chars.next(), chars.next()) else {
            continue;
        };
        let value: String = chars
            .take_while(|c| !c.is_whitespace() && *c != '>')
            .collect();
        vars.insert(key, value);
    }
    vars
}

/// Parse the text part of a locus into items.
pub fn parse_items(text: &str, line_no: usize) -> Result<Vec<Item>, ParseError> {
    let chars: Vec<char> = text.chars().collect();
    let mut pos = 0;
    let items = parse_seq(&chars, &mut pos, None, line_no)?;
    if pos != chars.len() {
        return Err(ParseError::Unbalanced {
            line: line_no,
            text: text.to_string(),
        });
    }
    Ok(items)
}

/// Parse until `stop` (exclusive) or end of input.
fn parse_seq(
    chars: &[char],
    pos: &mut usize,
    stop: Option<&[char]>,
    line_no: usize,
) -> Result<Vec<Item>, ParseError> {
    let unbalanced = || ParseError::Unbalanced {
        line: line_no,
        text: chars.iter().collect(),
    };
    let mut items = Vec::new();
    while *pos < chars.len() {
        let c = chars[*pos];
        if let Some(stop) = stop {
            if stop.contains(&c) {
                return Ok(items);
            }
        }
        *pos += 1;
        match c {
            '<' => {
                let start = *pos;
                while *pos < chars.len() && chars[*pos] != '>' {
                    *pos += 1;
                }
                if *pos >= chars.len() {
                    return Err(unbalanced());
                }
                let content: String = chars[start..*pos].iter().collect();
                *pos += 1; // skip '>'
                items.push(match content.as_str() {
                    "-" => Item::DrawingGap,
                    "~" => Item::DrawingGapNoBreak,
                    "%" => Item::ParaStart,
                    "$" => Item::ParaEnd,
                    s if s.starts_with('!') => Item::Comment(s[1..].to_string()),
                    s if s.starts_with("@H=") && s.len() == 4 => {
                        Item::HandChange(s.chars().nth(3).unwrap_or('?'))
                    }
                    s => Item::Tag(s.to_string()),
                });
            }
            '[' => {
                let mut branches = Vec::new();
                loop {
                    let branch = parse_seq(chars, pos, Some(&[':', ']']), line_no)?;
                    branches.push(branch);
                    match chars.get(*pos) {
                        Some(':') => *pos += 1,
                        Some(']') => {
                            *pos += 1;
                            break;
                        }
                        _ => return Err(unbalanced()),
                    }
                }
                items.push(Item::Alternatives(branches));
            }
            '{' => {
                let inner = parse_seq(chars, pos, Some(&['}']), line_no)?;
                if chars.get(*pos) != Some(&'}') {
                    return Err(unbalanced());
                }
                *pos += 1;
                items.push(Item::Ligature(inner));
            }
            '@' => {
                let start = *pos;
                while *pos < chars.len() && chars[*pos].is_ascii_digit() {
                    *pos += 1;
                }
                if chars.get(*pos) == Some(&';') && *pos > start {
                    let code: String = chars[start..*pos].iter().collect();
                    *pos += 1;
                    items.push(Item::Rare(format!("@{code};")));
                } else {
                    items.push(Item::Other('@'));
                }
            }
            '.' => items.push(Item::Space),
            ',' => items.push(Item::UncertainSpace),
            '?' => items.push(Item::Unreadable),
            '\'' => items.push(Item::Mark),
            '!' | '%' => items.push(Item::Filler),
            c if c.is_ascii_alphanumeric() => items.push(Item::Glyph(c)),
            c if c.is_whitespace() => {}
            c if !c.is_ascii() => items.push(Item::Rare(c.to_string())),
            c => items.push(Item::Other(c)),
        }
    }
    Ok(items)
}

impl Document {
    /// Total number of loci.
    pub fn locus_count(&self) -> usize {
        self.pages.iter().map(|p| p.loci.len()).sum()
    }
}

impl Page {
    /// Page metadata for the corpus.
    pub fn meta(&self) -> PageMeta {
        let first = |k: char| self.vars.get(&k).and_then(|v| v.chars().next());
        PageMeta {
            name: self.name.clone(),
            quire: self.vars.get(&'Q').cloned(),
            page_in_quire: self.vars.get(&'P').cloned(),
            illustration: first('I'),
            currier: first('L').filter(|c| *c == 'A' || *c == 'B'),
            hand: first('H'),
        }
    }
}

/// How a parsed document becomes a corpus. Every choice here is a policy in
/// the sense of the research protocol: a result holds only under its view.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewPolicy {
    /// Identifier recorded with every result, e.g. `para-v1`.
    pub id: String,
    /// Locus categories to include (second character of the locus type).
    pub categories: Vec<char>,
    /// Treat `,` (uncertain space) as a word boundary.
    pub uncertain_space_splits: bool,
    /// Treat `<->` (drawing gap) as a word boundary.
    pub drawing_gap_splits: bool,
    /// Treat `<~>` (drawing gap, word may continue) as a word boundary.
    pub tilde_gap_splits: bool,
    /// Drop words that contain an unreadable glyph `?`.
    pub drop_unreadable_words: bool,
    /// Drop words that contain a rare glyph (`@nnn;` or non-ASCII).
    pub drop_rare_words: bool,
}

impl ViewPolicy {
    /// Paragraph text only, first alternative reading, both space kinds and
    /// drawing gaps split words, words with unreadable or rare glyphs dropped.
    pub fn paragraph_text_v1() -> Self {
        ViewPolicy {
            id: "para-v1".to_string(),
            categories: vec!['P'],
            uncertain_space_splits: true,
            drawing_gap_splits: true,
            tilde_gap_splits: false,
            drop_unreadable_words: true,
            drop_rare_words: true,
        }
    }

    /// Like `paragraph_text_v1` but every locus category (labels, circular
    /// and radial text included).
    pub fn all_text_v1() -> Self {
        ViewPolicy {
            id: "all-v1".to_string(),
            categories: vec!['P', 'L', 'C', 'R', 'T', 'X'],
            ..Self::paragraph_text_v1()
        }
    }
}

struct WordBuilder {
    buf: String,
    unreadable: bool,
    rare: bool,
}

impl WordBuilder {
    fn new() -> Self {
        WordBuilder {
            buf: String::new(),
            unreadable: false,
            rare: false,
        }
    }

    fn flush(&mut self, policy: &ViewPolicy, words: &mut Vec<String>) {
        let dropped = (policy.drop_unreadable_words && self.unreadable)
            || (policy.drop_rare_words && self.rare);
        if !self.buf.is_empty() && !dropped {
            words.push(std::mem::take(&mut self.buf));
        }
        self.buf.clear();
        self.unreadable = false;
        self.rare = false;
    }

    fn walk(&mut self, items: &[Item], policy: &ViewPolicy, line: &mut Line) {
        for it in items {
            match it {
                Item::Glyph(c) => self.buf.push(*c),
                Item::Rare(_) => {
                    self.rare = true;
                    self.buf.push('*');
                }
                Item::Unreadable => {
                    self.unreadable = true;
                    self.buf.push('?');
                }
                Item::Space => self.flush(policy, &mut line.words),
                Item::UncertainSpace => {
                    if policy.uncertain_space_splits {
                        self.flush(policy, &mut line.words)
                    }
                }
                Item::DrawingGap => {
                    if policy.drawing_gap_splits {
                        self.flush(policy, &mut line.words)
                    }
                }
                Item::DrawingGapNoBreak => {
                    if policy.tilde_gap_splits {
                        self.flush(policy, &mut line.words)
                    }
                }
                Item::ParaStart => line.para_start = true,
                Item::ParaEnd => line.para_end = true,
                Item::Alternatives(branches) => {
                    if let Some(first) = branches.first() {
                        self.walk(first, policy, line)
                    }
                }
                Item::Ligature(inner) => self.walk(inner, policy, line),
                Item::Mark
                | Item::Comment(_)
                | Item::HandChange(_)
                | Item::Tag(_)
                | Item::Filler
                | Item::Other(_) => {}
            }
        }
    }
}

/// Apply a view policy to a parsed document.
///
/// Every page of the document becomes a [`PageMeta`] (so page indices are
/// stable); every included locus with at least one surviving word becomes a
/// [`Line`].
pub fn build_corpus(doc: &Document, policy: &ViewPolicy) -> Corpus {
    let mut corpus = Corpus {
        pages: Vec::with_capacity(doc.pages.len()),
        lines: Vec::new(),
    };
    for (pi, page) in doc.pages.iter().enumerate() {
        corpus.pages.push(page.meta());
        for locus in &page.loci {
            if !policy.categories.contains(&locus.kind.category) {
                continue;
            }
            let mut line = Line {
                page: pi as u32,
                ..Line::default()
            };
            let mut wb = WordBuilder::new();
            wb.walk(&locus.items, policy, &mut line);
            wb.flush(policy, &mut line.words);
            if !line.words.is_empty() {
                corpus.lines.push(line);
            }
        }
    }
    corpus
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "#=IVTFF Eva- 2.0 M 5\n\
# comment line\n\
<f1r>      <! $Q=A $P=A $F=a $B=1 $I=T $L=A $H=1 $C=1 $X=V>\n\
# text only\n\
<f1r.1,@P0>       <%>fachys.ykal.ar<->ataiin,shol<!þ>\n\
<f1r.2,+P0>       sory.ck[h:e]ar.{ck}ey.qo?ar.@181;dy.d'y.chy<~>ol\n\
<f1r.3,=P0>       <@H=2>daiin.chol<$>\n\
<f1r.4,@L0>       otaly\n\
<f2v>      <! $Q=A $P=D $I=H $L=B $H=2>\n\
<f2v.1,@P0>       <%>qokeedy<$>\n";

    #[test]
    fn parses_header_pages_and_loci() {
        let doc = parse(FIXTURE).unwrap();
        assert_eq!(doc.header.alphabet, "Eva-");
        assert_eq!(doc.header.version, "2.0");
        assert_eq!(doc.header.extra, "M 5");
        assert_eq!(doc.pages.len(), 2);
        assert_eq!(doc.locus_count(), 5);
        let p = &doc.pages[0];
        assert_eq!(p.name, "f1r");
        assert_eq!(p.vars[&'L'], "A");
        assert_eq!(p.vars[&'H'], "1");
        assert_eq!(p.vars[&'X'], "V");
        assert_eq!(
            p.loci[0].kind,
            LocusType {
                position: '@',
                category: 'P',
                detail: '0'
            }
        );
        assert_eq!(p.loci[3].kind.category, 'L');
        let m = p.meta();
        assert_eq!(m.currier, Some('A'));
        assert_eq!(m.hand, Some('1'));
        assert_eq!(m.illustration, Some('T'));
        assert_eq!(m.quire.as_deref(), Some("A"));
        assert_eq!(doc.pages[1].meta().currier, Some('B'));
    }

    #[test]
    fn items_are_lossless() {
        let doc = parse(FIXTURE).unwrap();
        let l1 = &doc.pages[0].loci[0].items;
        assert_eq!(l1[0], Item::ParaStart);
        assert!(l1.contains(&Item::DrawingGap));
        assert!(l1.contains(&Item::UncertainSpace));
        assert_eq!(l1.last(), Some(&Item::Comment("þ".to_string())));

        let l2 = &doc.pages[0].loci[1].items;
        assert!(l2.contains(&Item::Alternatives(vec![
            vec![Item::Glyph('h')],
            vec![Item::Glyph('e')]
        ])));
        assert!(l2.contains(&Item::Ligature(vec![Item::Glyph('c'), Item::Glyph('k')])));
        assert!(l2.contains(&Item::Unreadable));
        assert!(l2.contains(&Item::Rare("@181;".to_string())));
        assert!(l2.contains(&Item::Mark));
        assert!(l2.contains(&Item::DrawingGapNoBreak));

        let l3 = &doc.pages[0].loci[2].items;
        assert_eq!(l3[0], Item::HandChange('2'));
        assert_eq!(l3.last(), Some(&Item::ParaEnd));
    }

    #[test]
    fn paragraph_view() {
        let doc = parse(FIXTURE).unwrap();
        let c = build_corpus(&doc, &ViewPolicy::paragraph_text_v1());
        assert_eq!(c.pages.len(), 2);
        // Label locus f1r.4 is excluded; four P loci remain.
        assert_eq!(c.lines.len(), 4);
        assert_eq!(
            c.lines[0].words,
            vec!["fachys", "ykal", "ar", "ataiin", "shol"]
        );
        assert!(c.lines[0].para_start && !c.lines[0].para_end);
        // first alternative, ligature flattened, '?' word and rare word dropped,
        // mark dropped, <~> does not split.
        assert_eq!(
            c.lines[1].words,
            vec!["sory", "ckhar", "ckey", "dy", "chyol"]
        );
        assert_eq!(c.lines[2].words, vec!["daiin", "chol"]);
        assert!(c.lines[2].para_end);
        assert_eq!(c.lines[3].page, 1);
        assert_eq!(c.lines[3].words, vec!["qokeedy"]);
    }

    #[test]
    fn all_text_view_includes_labels() {
        let doc = parse(FIXTURE).unwrap();
        let c = build_corpus(&doc, &ViewPolicy::all_text_v1());
        assert_eq!(c.lines.len(), 5);
        assert_eq!(c.lines[3].words, vec!["otaly"]);
    }

    #[test]
    fn keep_uncertain_words_when_policy_says_so() {
        let doc = parse(FIXTURE).unwrap();
        let mut p = ViewPolicy::paragraph_text_v1();
        p.drop_unreadable_words = false;
        p.drop_rare_words = false;
        let c = build_corpus(&doc, &p);
        assert_eq!(
            c.lines[1].words,
            vec!["sory", "ckhar", "ckey", "qo?ar", "*dy", "dy", "chyol"]
        );
    }

    #[test]
    fn errors_are_reported_with_line_numbers() {
        let bad = "#=IVTFF Eva- 2.0\n<f1r>\n<f1r.1,@P0> dai[n:m\n";
        match parse(bad) {
            Err(ParseError::Unbalanced { line, .. }) => assert_eq!(line, 3),
            other => panic!("unexpected: {other:?}"),
        }
        assert_eq!(parse("").unwrap_err(), ParseError::MissingHeader);
        assert!(matches!(
            parse("# no header\n").unwrap_err(),
            ParseError::BadHeader(_)
        ));
    }
}
