//! Deterministic text generators.
//!
//! Every generator turns `(family, parameters, seed, layout)` into a
//! [`Corpus`]. The same inputs give the same corpus on every platform: the
//! random stream is ChaCha8 seeded from a SHA-256 of the salt and seed, and
//! all sampling is done with integer arithmetic or IEEE-754 basic operations.
//!
//! Families in this version:
//! * `gibberish`  — control: random glyphs, binomial word length.
//! * `bagofwords` — control: words drawn independently from a word bag
//!   (keeps unigram statistics, destroys order).
//! * `charmarkov` — adversarial control: glyph n-gram Markov chain trained on
//!   a corpus (matches short-range statistics by construction).
//! * `selfcite`   — candidate mechanism: copy a nearby word and modify it
//!   (the self-citation family of Timm & Schinner, own parameterisation).
//! * `slotgram`   — candidate mechanism: every word is built left to right
//!   from ordered slots, each slot filled with one of its allowed glyph
//!   groups or left empty (the slot-grammar family; the default table is
//!   an approximation of Zattera's twelve-slot structure and must be
//!   verified by the domain advisor).
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fmt;

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use vah_corpus::{Corpus, Line};

/// Generator parameters: a JSON object with sorted keys.
pub type Params = BTreeMap<String, Value>;

/// Generator construction errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GenError {
    UnknownFamily(String),
    BadParam(String),
    MissingResource(&'static str),
}

impl fmt::Display for GenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GenError::UnknownFamily(s) => write!(f, "unknown generator family: {s}"),
            GenError::BadParam(s) => write!(f, "bad parameter: {s}"),
            GenError::MissingResource(s) => write!(f, "missing resource: {s}"),
        }
    }
}

impl std::error::Error for GenError {}

/// Word boundary symbol used by glyph models.
pub const SPACE: u8 = b' ';

// ---------------------------------------------------------------------------
// Random numbers

/// Deterministic random source.
pub struct Rng(ChaCha8Rng);

impl Rng {
    /// Seed from a salt (normally the work unit identity) and a seed index.
    pub fn new(salt: &str, seed: u64) -> Rng {
        let mut h = Sha256::new();
        h.update(salt.as_bytes());
        h.update(b"\0");
        h.update(seed.to_le_bytes());
        let digest = h.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&digest);
        Rng(ChaCha8Rng::from_seed(key))
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0.next_u64()
    }

    /// Uniform integer in `0..n` (n > 0), unbiased by rejection.
    pub fn below(&mut self, n: usize) -> usize {
        assert!(n > 0, "below(0)");
        let n64 = n as u64;
        let zone = u64::MAX - (u64::MAX % n64);
        loop {
            let v = self.next_u64();
            if v < zone {
                return (v % n64) as usize;
            }
        }
    }

    /// Uniform float in `[0, 1)` with 53 random bits.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0)
    }

    /// Bernoulli trial.
    pub fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    /// Index sampled proportionally to integer weights given as a cumulative
    /// sum (`cum[i] = w_0 + ... + w_i`, last element > 0).
    pub fn weighted(&mut self, cum: &[u64]) -> usize {
        let total = *cum.last().expect("non-empty weights");
        let r = (self.next_u64() % total) + 1;
        match cum.binary_search(&r) {
            Ok(i) => {
                // step over duplicates (zero-weight entries)
                let mut i = i;
                while i > 0 && cum[i - 1] == r {
                    i -= 1;
                }
                i
            }
            Err(i) => i,
        }
    }

    /// Binomial(n, p) by n Bernoulli trials (n is small here).
    pub fn binomial(&mut self, n: u32, p: f64) -> u32 {
        let mut k = 0;
        for _ in 0..n {
            if self.chance(p) {
                k += 1;
            }
        }
        k
    }
}

// ---------------------------------------------------------------------------
// Layout

/// Shape of one line of the corpus to generate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineSpec {
    pub words: u16,
    pub para_start: bool,
    pub para_end: bool,
}

/// Line and paragraph shape of a corpus. Generators fill it with words, so
/// layout statistics are comparable between the manuscript and synthetic
/// corpora. A layout is a derived artifact of the reference corpus.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layout {
    pub lines: Vec<LineSpec>,
}

impl Layout {
    /// The layout of an existing corpus.
    pub fn from_corpus(c: &Corpus) -> Layout {
        Layout {
            lines: c
                .lines
                .iter()
                .filter(|l| !l.words.is_empty())
                .map(|l| LineSpec {
                    words: l.words.len().min(u16::MAX as usize) as u16,
                    para_start: l.para_start,
                    para_end: l.para_end,
                })
                .collect(),
        }
    }

    /// A regular layout: `lines` lines of `words_per_line` words, paragraphs
    /// of `lines_per_para` lines.
    pub fn uniform(lines: usize, words_per_line: u16, lines_per_para: usize) -> Layout {
        let lpp = lines_per_para.max(1);
        Layout {
            lines: (0..lines)
                .map(|i| LineSpec {
                    words: words_per_line,
                    para_start: i % lpp == 0,
                    para_end: i % lpp == lpp - 1 || i + 1 == lines,
                })
                .collect(),
        }
    }

    /// Total number of words.
    pub fn tokens(&self) -> usize {
        self.lines.iter().map(|l| l.words as usize).sum()
    }

    /// The prefix of this layout holding at most `max_tokens` words.
    pub fn truncate_tokens(&self, max_tokens: usize) -> Layout {
        let mut out = Layout::default();
        let mut n = 0usize;
        for l in &self.lines {
            if n + l.words as usize > max_tokens {
                break;
            }
            n += l.words as usize;
            out.lines.push(l.clone());
        }
        if let Some(last) = out.lines.last_mut() {
            last.para_end = true;
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Resources derived from a reference corpus

/// Glyph n-gram model with a word boundary symbol.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GlyphModel {
    pub order: usize,
    /// Context (as a string of glyphs, `' '` = boundary) -> next glyph counts.
    pub counts: BTreeMap<String, BTreeMap<char, u64>>,
}

impl GlyphModel {
    /// Train on a corpus; contexts are the previous `order` symbols, padded
    /// with boundaries at line start.
    pub fn train(c: &Corpus, order: usize) -> GlyphModel {
        let order = order.clamp(1, 6);
        let mut counts: BTreeMap<String, BTreeMap<char, u64>> = BTreeMap::new();
        let mut ctx: Vec<u8> = vec![SPACE; order];
        let mut push = |ctx: &mut Vec<u8>, g: u8| {
            let key: String = ctx.iter().map(|b| *b as char).collect();
            *counts.entry(key).or_default().entry(g as char).or_insert(0) += 1;
            ctx.remove(0);
            ctx.push(g);
        };
        for line in &c.lines {
            ctx.iter_mut().for_each(|b| *b = SPACE);
            for w in &line.words {
                for &g in w.as_bytes() {
                    push(&mut ctx, g);
                }
                push(&mut ctx, SPACE);
            }
        }
        GlyphModel { order, counts }
    }
}

/// Word frequency list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordBag {
    /// Words with counts, sorted by count descending then word ascending.
    pub words: Vec<(String, u64)>,
}

impl WordBag {
    pub fn from_corpus(c: &Corpus) -> WordBag {
        let mut m: BTreeMap<&str, u64> = BTreeMap::new();
        for w in c.words() {
            *m.entry(w).or_insert(0) += 1;
        }
        let mut words: Vec<(String, u64)> =
            m.into_iter().map(|(w, n)| (w.to_string(), n)).collect();
        words.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        WordBag { words }
    }
}

/// Derived artifacts a generator may need.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resources {
    pub glyph_model: Option<GlyphModel>,
    pub word_bag: Option<WordBag>,
}

// ---------------------------------------------------------------------------
// Generator trait and registry

/// A text generator family with fixed parameters.
pub trait TextGenerator {
    fn family_id(&self) -> &'static str;
    /// Fill the layout with words.
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus;
}

/// All family identifiers.
pub const FAMILIES: [&str; 5] = [
    "gibberish",
    "bagofwords",
    "charmarkov",
    "selfcite",
    "slotgram",
];

/// Build a generator from its family name and parameters.
pub fn build(
    family: &str,
    params: &Params,
    res: &Resources,
) -> Result<Box<dyn TextGenerator>, GenError> {
    match family {
        "gibberish" => Ok(Box::new(Gibberish::from_params(params)?)),
        "bagofwords" => Ok(Box::new(BagOfWords::from_params(params, res)?)),
        "charmarkov" => Ok(Box::new(CharMarkov::from_params(params, res)?)),
        "selfcite" => Ok(Box::new(SelfCite::from_params(params)?)),
        "slotgram" => Ok(Box::new(SlotGram::from_params(params)?)),
        other => Err(GenError::UnknownFamily(other.to_string())),
    }
}

/// Is `s` a plain decimal literal (`-?(0|[1-9][0-9]*)(\.[0-9]+)?`)? The
/// registered work-unit schema carries numeric parameters as such strings.
fn is_decimal_literal(s: &str) -> bool {
    let s = s.strip_prefix('-').unwrap_or(s);
    let (int, frac) = match s.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (s, None),
    };
    let int_ok = int == "0"
        || (!int.is_empty() && !int.starts_with('0') && int.bytes().all(|b| b.is_ascii_digit()));
    let frac_ok = frac.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
    int_ok && frac_ok
}

fn get_f64(p: &Params, key: &str, default: f64) -> Result<f64, GenError> {
    let err = || GenError::BadParam(format!("{key} must be a finite number or a decimal string"));
    match p.get(key) {
        None => Ok(default),
        Some(Value::String(s)) if is_decimal_literal(s) => s
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite())
            .ok_or_else(err),
        Some(v) => v.as_f64().filter(|x| x.is_finite()).ok_or_else(err),
    }
}

fn get_u64(p: &Params, key: &str, default: u64) -> Result<u64, GenError> {
    let err = || {
        GenError::BadParam(format!(
            "{key} must be a non-negative integer or an integer string"
        ))
    };
    match p.get(key) {
        None => Ok(default),
        Some(Value::String(s))
            if is_decimal_literal(s) && !s.contains('.') && !s.starts_with('-') =>
        {
            s.parse::<u64>().map_err(|_| err())
        }
        Some(v) => v.as_u64().ok_or_else(err),
    }
}

fn get_str(p: &Params, key: &str, default: &str) -> Result<String, GenError> {
    match p.get(key) {
        None => Ok(default.to_string()),
        Some(v) => v
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| GenError::BadParam(format!("{key} must be a string"))),
    }
}

fn prob(p: &Params, key: &str, default: f64) -> Result<f64, GenError> {
    let v = get_f64(p, key, default)?;
    if !(0.0..=1.0).contains(&v) {
        return Err(GenError::BadParam(format!("{key} must be in [0, 1]")));
    }
    Ok(v)
}

fn alphabet(p: &Params, default: &str) -> Result<Vec<u8>, GenError> {
    let s = get_str(p, "alphabet", default)?;
    let a: Vec<u8> = s.bytes().filter(|b| b.is_ascii_alphanumeric()).collect();
    if a.is_empty() {
        return Err(GenError::BadParam(
            "alphabet must contain at least one glyph".into(),
        ));
    }
    Ok(a)
}

/// Fill a layout by calling `next` once per word slot.
fn fill<F: FnMut(&mut Rng, usize, usize) -> String>(
    rng: &mut Rng,
    layout: &Layout,
    mut next: F,
) -> Corpus {
    let mut c = Corpus::single_page("synthetic");
    for (li, spec) in layout.lines.iter().enumerate() {
        let mut line = Line {
            page: 0,
            words: Vec::with_capacity(spec.words as usize),
            para_start: spec.para_start,
            para_end: spec.para_end,
        };
        for wi in 0..spec.words as usize {
            line.words.push(next(rng, li, wi));
        }
        c.lines.push(line);
    }
    c
}

/// Default EVA-like glyph inventory used by controls when none is given.
pub const DEFAULT_ALPHABET: &str = "ocheydaiklrstqnmpfg";

// ---------------------------------------------------------------------------
// gibberish

/// Random glyphs; word length = 1 + Binomial(len_n, len_p); glyph weights
/// uniform or Zipfian with exponent `zipf_s`.
pub struct Gibberish {
    alphabet: Vec<u8>,
    len_n: u32,
    len_p: f64,
    cum: Vec<u64>,
}

impl Gibberish {
    pub fn from_params(p: &Params) -> Result<Self, GenError> {
        let alphabet = alphabet(p, DEFAULT_ALPHABET)?;
        let len_n = get_u64(p, "len_n", 9)?.min(30) as u32;
        let len_p = prob(p, "len_p", 0.45)?;
        let zipf_s = get_f64(p, "zipf_s", 0.0)?;
        if !(0.0..=4.0).contains(&zipf_s) {
            return Err(GenError::BadParam("zipf_s must be in [0, 4]".into()));
        }
        // Integer weights: 1e6 / rank^s, in fixed order of the alphabet.
        let mut cum = Vec::with_capacity(alphabet.len());
        let mut acc = 0u64;
        for i in 0..alphabet.len() {
            let w = if zipf_s == 0.0 {
                1_000_000.0
            } else {
                1_000_000.0 / pow_int_base((i + 1) as f64, zipf_s)
            };
            acc += (w as u64).max(1);
            cum.push(acc);
        }
        Ok(Gibberish {
            alphabet,
            len_n,
            len_p,
            cum,
        })
    }

    fn word(&self, rng: &mut Rng) -> String {
        let len = 1 + rng.binomial(self.len_n, self.len_p) as usize;
        let mut w = String::with_capacity(len);
        for _ in 0..len {
            w.push(self.alphabet[rng.weighted(&self.cum)] as char);
        }
        w
    }
}

/// `base^exp` via exp/log from libm (bit-stable across targets).
fn pow_int_base(base: f64, exp: f64) -> f64 {
    libm::exp(exp * libm::log(base))
}

impl TextGenerator for Gibberish {
    fn family_id(&self) -> &'static str {
        "gibberish"
    }
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus {
        fill(rng, layout, |rng, _, _| self.word(rng))
    }
}

// ---------------------------------------------------------------------------
// bagofwords

/// Words drawn independently from a word bag.
pub struct BagOfWords {
    words: Vec<String>,
    cum: Vec<u64>,
}

impl BagOfWords {
    pub fn from_params(_p: &Params, res: &Resources) -> Result<Self, GenError> {
        let bag = res
            .word_bag
            .as_ref()
            .ok_or(GenError::MissingResource("word_bag"))?;
        if bag.words.is_empty() {
            return Err(GenError::BadParam("word_bag is empty".into()));
        }
        let mut cum = Vec::with_capacity(bag.words.len());
        let mut acc = 0u64;
        for (_, n) in &bag.words {
            acc += n.max(&1);
            cum.push(acc);
        }
        Ok(BagOfWords {
            words: bag.words.iter().map(|(w, _)| w.clone()).collect(),
            cum,
        })
    }
}

impl TextGenerator for BagOfWords {
    fn family_id(&self) -> &'static str {
        "bagofwords"
    }
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus {
        fill(rng, layout, |rng, _, _| {
            self.words[rng.weighted(&self.cum)].clone()
        })
    }
}

// ---------------------------------------------------------------------------
// charmarkov

/// Glyph n-gram Markov chain.
pub struct CharMarkov {
    order: usize,
    /// context -> (symbols, cumulative counts)
    table: BTreeMap<Vec<u8>, (Vec<u8>, Vec<u64>)>,
    max_len: usize,
}

impl CharMarkov {
    pub fn from_params(p: &Params, res: &Resources) -> Result<Self, GenError> {
        let model = res
            .glyph_model
            .as_ref()
            .ok_or(GenError::MissingResource("glyph_model"))?;
        let order = get_u64(p, "order", model.order as u64)? as usize;
        if order != model.order {
            return Err(GenError::BadParam(format!(
                "order {order} does not match the glyph model order {}",
                model.order
            )));
        }
        let max_len = get_u64(p, "max_len", 20)?.clamp(2, 64) as usize;
        let mut table = BTreeMap::new();
        for (ctx, nexts) in &model.counts {
            let key: Vec<u8> = ctx.bytes().collect();
            let mut syms = Vec::with_capacity(nexts.len());
            let mut cum = Vec::with_capacity(nexts.len());
            let mut acc = 0u64;
            for (g, n) in nexts {
                syms.push(*g as u8);
                acc += n;
                cum.push(acc);
            }
            if acc > 0 {
                table.insert(key, (syms, cum));
            }
        }
        if table.is_empty() {
            return Err(GenError::BadParam("glyph model is empty".into()));
        }
        Ok(CharMarkov {
            order,
            table,
            max_len,
        })
    }

    fn sample(&self, rng: &mut Rng, ctx: &[u8]) -> u8 {
        // Back off to shorter contexts (padded with boundaries) if unseen.
        for k in (0..=self.order).rev() {
            let mut key = vec![SPACE; self.order - k];
            key.extend_from_slice(&ctx[ctx.len() - k..]);
            if let Some((syms, cum)) = self.table.get(&key) {
                return syms[rng.weighted(cum)];
            }
        }
        SPACE
    }
}

impl TextGenerator for CharMarkov {
    fn family_id(&self) -> &'static str {
        "charmarkov"
    }
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus {
        let mut ctx: Vec<u8> = vec![SPACE; self.order];
        let mut current_line = usize::MAX;
        fill(rng, layout, |rng, li, _| {
            if li != current_line {
                ctx.iter_mut().for_each(|b| *b = SPACE);
                current_line = li;
            }
            let mut w: Vec<u8> = Vec::new();
            loop {
                let g = self.sample(rng, &ctx);
                if g == SPACE {
                    if w.is_empty() {
                        continue;
                    }
                    ctx.remove(0);
                    ctx.push(SPACE);
                    break;
                }
                w.push(g);
                ctx.remove(0);
                ctx.push(g);
                if w.len() >= self.max_len {
                    ctx.remove(0);
                    ctx.push(SPACE);
                    break;
                }
            }
            String::from_utf8(w).expect("ascii glyphs")
        })
    }
}

// ---------------------------------------------------------------------------
// selfcite

/// Copy-and-modify generation: each new word is a copy of a word from the
/// current line or the previous `window_lines` lines, modified with
/// probability `p_modify` by one or more edits: substitute a glyph by a
/// similar one, insert or delete a glyph, or add/remove a prefix or suffix.
pub struct SelfCite {
    seed: Gibberish,
    window_lines: usize,
    p_current_line: f64,
    p_modify: f64,
    p_new_word: f64,
    max_edits: usize,
    /// cumulative weights: substitute, insert, delete, affix
    edit_cum: [u64; 4],
    alphabet: Vec<u8>,
    similar: Vec<Vec<u8>>,
    prefixes: Vec<Vec<u8>>,
    suffixes: Vec<Vec<u8>>,
    min_len: usize,
    max_len: usize,
}

impl SelfCite {
    pub fn from_params(p: &Params) -> Result<Self, GenError> {
        let alphabet = alphabet(p, DEFAULT_ALPHABET)?;
        let seed = Gibberish::from_params(p)?;
        let window_lines = get_u64(p, "window_lines", 4)?.clamp(0, 50) as usize;
        let p_current_line = prob(p, "p_current_line", 0.3)?;
        let p_modify = prob(p, "p_modify", 0.85)?;
        let p_new_word = prob(p, "p_new_word", 0.01)?;
        let max_edits = get_u64(p, "max_edits", 2)?.clamp(1, 6) as usize;
        let w_sub = get_f64(p, "w_substitute", 4.0)?;
        let w_ins = get_f64(p, "w_insert", 1.0)?;
        let w_del = get_f64(p, "w_delete", 2.0)?;
        let w_aff = get_f64(p, "w_affix", 1.5)?;
        let to_int = |w: f64| -> Result<u64, GenError> {
            if !(0.0..=1000.0).contains(&w) {
                return Err(GenError::BadParam(
                    "edit weights must be in [0, 1000]".into(),
                ));
            }
            Ok((w * 1000.0) as u64)
        };
        let mut edit_cum = [0u64; 4];
        let mut acc = 0u64;
        for (i, w) in [w_sub, w_ins, w_del, w_aff].iter().enumerate() {
            acc += to_int(*w)?;
            edit_cum[i] = acc;
        }
        if acc == 0 {
            return Err(GenError::BadParam(
                "at least one edit weight must be positive".into(),
            ));
        }
        let groups = get_str(p, "similar", "oay|ei|kt|pf|lr|ds|nm|ch")?;
        let similar: Vec<Vec<u8>> = groups
            .split('|')
            .map(|g| {
                g.bytes()
                    .filter(|b| b.is_ascii_alphanumeric())
                    .collect::<Vec<u8>>()
            })
            .filter(|g| g.len() >= 2)
            .collect();
        let list = |key: &str, default: &str| -> Result<Vec<Vec<u8>>, GenError> {
            Ok(get_str(p, key, default)?
                .split(',')
                .map(|s| {
                    s.bytes()
                        .filter(|b| b.is_ascii_alphanumeric())
                        .collect::<Vec<u8>>()
                })
                .filter(|s| !s.is_empty())
                .collect())
        };
        let prefixes = list("prefixes", "qo,o,ch,sh,d,y")?;
        let suffixes = list("suffixes", "y,dy,aiin,ain,al,ar,ol,or,am")?;
        let min_len = get_u64(p, "min_len", 1)?.clamp(1, 10) as usize;
        let max_len = get_u64(p, "max_len", 8)?.clamp(min_len as u64, 40) as usize;
        Ok(SelfCite {
            seed,
            window_lines,
            p_current_line,
            p_modify,
            p_new_word,
            max_edits,
            edit_cum,
            alphabet,
            similar,
            prefixes,
            suffixes,
            min_len,
            max_len,
        })
    }

    fn edit(&self, rng: &mut Rng, w: &[u8]) -> Vec<u8> {
        let mut v = w.to_vec();
        match rng.weighted(&self.edit_cum) {
            0 => {
                // substitute by a similar glyph when possible
                let i = rng.below(v.len());
                let g = v[i];
                let group = self.similar.iter().find(|grp| grp.contains(&g));
                let replacement = match group {
                    Some(grp) if grp.len() >= 2 => {
                        let others: Vec<u8> = grp.iter().copied().filter(|x| *x != g).collect();
                        others[rng.below(others.len())]
                    }
                    _ => self.alphabet[rng.below(self.alphabet.len())],
                };
                v[i] = replacement;
            }
            1 => {
                let i = rng.below(v.len() + 1);
                let g = self.alphabet[rng.below(self.alphabet.len())];
                v.insert(i, g);
            }
            2 => {
                if v.len() > self.min_len {
                    let i = rng.below(v.len());
                    v.remove(i);
                }
            }
            _ => {
                let use_prefix = rng.chance(0.5);
                let pool = if use_prefix {
                    &self.prefixes
                } else {
                    &self.suffixes
                };
                if pool.is_empty() {
                    return v;
                }
                let a = &pool[rng.below(pool.len())];
                let has = if use_prefix {
                    v.starts_with(a)
                } else {
                    v.ends_with(a)
                };
                if has && v.len() > a.len() {
                    if use_prefix {
                        v.drain(..a.len());
                    } else {
                        v.truncate(v.len() - a.len());
                    }
                } else if use_prefix {
                    let mut n = a.clone();
                    n.extend_from_slice(&v);
                    v = n;
                } else {
                    v.extend_from_slice(a);
                }
            }
        }
        v
    }
}

impl TextGenerator for SelfCite {
    fn family_id(&self) -> &'static str {
        "selfcite"
    }
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus {
        let mut c = Corpus::single_page("synthetic");
        let mut lines: Vec<Vec<String>> = Vec::with_capacity(layout.lines.len());
        for spec in &layout.lines {
            let mut cur: Vec<String> = Vec::with_capacity(spec.words as usize);
            for _ in 0..spec.words {
                let word = if rng.chance(self.p_new_word) {
                    self.seed.word(rng)
                } else {
                    // choose the source pool
                    let from_current = !cur.is_empty() && rng.chance(self.p_current_line);
                    let source: Option<&str> = if from_current {
                        Some(cur[rng.below(cur.len())].as_str())
                    } else {
                        let start = lines.len().saturating_sub(self.window_lines);
                        let pool: Vec<&str> = lines[start..]
                            .iter()
                            .flat_map(|l| l.iter().map(String::as_str))
                            .collect();
                        if pool.is_empty() {
                            if cur.is_empty() {
                                None
                            } else {
                                Some(cur[rng.below(cur.len())].as_str())
                            }
                        } else {
                            Some(pool[rng.below(pool.len())])
                        }
                    };
                    match source {
                        None => self.seed.word(rng),
                        Some(src) => {
                            let mut v = src.as_bytes().to_vec();
                            if rng.chance(self.p_modify) {
                                let n = 1 + rng.below(self.max_edits);
                                for _ in 0..n {
                                    let cand = self.edit(rng, &v);
                                    if cand.len() >= self.min_len && cand.len() <= self.max_len {
                                        v = cand;
                                    }
                                }
                            }
                            String::from_utf8(v).expect("ascii glyphs")
                        }
                    }
                };
                cur.push(word);
            }
            c.lines.push(Line {
                page: 0,
                words: cur.clone(),
                para_start: spec.para_start,
                para_end: spec.para_end,
            });
            lines.push(cur);
        }
        c
    }
}

// ---------------------------------------------------------------------------
// slotgram

/// Default slot table: an approximation of the twelve-slot word structure
/// described by Zattera (2022) for the EVA/Slot alphabets. Slots are
/// separated by `|`, alternatives by `,`; `_` is the empty alternative.
/// **To be verified against the published table by the domain advisor
/// before any registered use.** The table is a parameter, so the verified
/// version replaces this default without code changes.
pub const DEFAULT_SLOTS: &str =
    "q,_|o,y,s,d,_|l,r,_|t,k,p,f,_|ch,sh,_|e,ee,eee,_|t,k,p,f,_|o,a,_|i,ii,iii,_|d,l,r,m,n,_|y,_";

/// Slot-grammar word generator.
///
/// Parameters:
/// * `slots`: the table (see [`DEFAULT_SLOTS`]).
/// * `p_fill`: probability that a slot is filled, applied to every slot, or
///   `p_fill_slots`: comma-separated per-slot probabilities.
/// * `zipf_s`: within a slot, alternative weights follow `1/rank^s` in
///   table order (0 = uniform).
/// * `min_len`: words shorter than this are redrawn (default 1).
/// * `p_repeat`: probability that a word repeats the previous word of the
///   line verbatim (0 by default; a cheap way to add the manuscript's
///   adjacent repeats without a copy process).
pub struct SlotGram {
    slots: Vec<Vec<Vec<u8>>>,
    fill: Vec<f64>,
    cums: Vec<Vec<u64>>,
    min_len: usize,
    p_repeat: f64,
}

impl SlotGram {
    pub fn from_params(p: &Params) -> Result<Self, GenError> {
        let table = get_str(p, "slots", DEFAULT_SLOTS)?;
        let mut slots: Vec<Vec<Vec<u8>>> = Vec::new();
        for slot in table.split('|') {
            let alts: Vec<Vec<u8>> = slot
                .split(',')
                .map(|a| a.trim())
                .filter(|a| !a.is_empty() && *a != "_")
                .map(|a| {
                    a.bytes()
                        .filter(|b| b.is_ascii_alphanumeric())
                        .collect::<Vec<u8>>()
                })
                .filter(|a| !a.is_empty())
                .collect();
            if alts.is_empty() {
                return Err(GenError::BadParam(
                    "every slot needs at least one non-empty alternative".into(),
                ));
            }
            slots.push(alts);
        }
        if slots.is_empty() || slots.len() > 32 {
            return Err(GenError::BadParam("slots must have 1..=32 entries".into()));
        }
        let p_fill = prob(p, "p_fill", 0.35)?;
        let fill: Vec<f64> = match p.get("p_fill_slots") {
            None => vec![p_fill; slots.len()],
            Some(v) => {
                let s = v
                    .as_str()
                    .ok_or_else(|| GenError::BadParam("p_fill_slots must be a string".into()))?;
                let vals: Result<Vec<f64>, _> =
                    s.split(',').map(|x| x.trim().parse::<f64>()).collect();
                let vals = vals.map_err(|_| {
                    GenError::BadParam("p_fill_slots must be comma-separated numbers".into())
                })?;
                if vals.len() != slots.len() || vals.iter().any(|x| !(0.0..=1.0).contains(x)) {
                    return Err(GenError::BadParam(format!(
                        "p_fill_slots needs {} values in [0, 1]",
                        slots.len()
                    )));
                }
                vals
            }
        };
        let zipf_s = get_f64(p, "zipf_s", 0.0)?;
        if !(0.0..=4.0).contains(&zipf_s) {
            return Err(GenError::BadParam("zipf_s must be in [0, 4]".into()));
        }
        let cums = slots
            .iter()
            .map(|alts| {
                let mut acc = 0u64;
                alts.iter()
                    .enumerate()
                    .map(|(i, _)| {
                        let w = if zipf_s == 0.0 {
                            1_000_000.0
                        } else {
                            1_000_000.0 / pow_int_base((i + 1) as f64, zipf_s)
                        };
                        acc += (w as u64).max(1);
                        acc
                    })
                    .collect()
            })
            .collect();
        let min_len = get_u64(p, "min_len", 1)?.clamp(1, 8) as usize;
        let p_repeat = prob(p, "p_repeat", 0.0)?;
        Ok(SlotGram {
            slots,
            fill,
            cums,
            min_len,
            p_repeat,
        })
    }

    fn word(&self, rng: &mut Rng) -> String {
        for _ in 0..64 {
            let mut w: Vec<u8> = Vec::new();
            for (i, alts) in self.slots.iter().enumerate() {
                if rng.chance(self.fill[i]) {
                    w.extend_from_slice(&alts[rng.weighted(&self.cums[i])]);
                }
            }
            if w.len() >= self.min_len {
                return String::from_utf8(w).expect("ascii glyphs");
            }
        }
        // extremely unlikely: fall back to the first alternative of the first slot
        String::from_utf8(self.slots[0][0].clone()).expect("ascii glyphs")
    }

    /// Does `word` parse as a sequence of the table's slots in order? Used
    /// as the slot-conformance statistic.
    pub fn conforms(&self, word: &[u8]) -> bool {
        // dynamic programming over (slot index, position)
        let n = word.len();
        let mut reach = vec![false; n + 1];
        reach[0] = true;
        for alts in &self.slots {
            let mut next = reach.clone(); // slot left empty
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

impl TextGenerator for SlotGram {
    fn family_id(&self) -> &'static str {
        "slotgram"
    }
    fn generate(&self, rng: &mut Rng, layout: &Layout) -> Corpus {
        let mut prev: Option<String> = None;
        let mut current_line = usize::MAX;
        fill(rng, layout, |rng, li, _| {
            if li != current_line {
                current_line = li;
                prev = None;
            }
            let w = match &prev {
                Some(p) if rng.chance(self.p_repeat) => p.clone(),
                _ => self.word(rng),
            };
            prev = Some(w.clone());
            w
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(json: &str) -> Params {
        serde_json::from_str(json).unwrap()
    }

    fn sample_corpus() -> Corpus {
        let mut c = Corpus::single_page("t");
        for (i, l) in [
            "daiin.chol.chor.qokedy",
            "shedy.qokeedy.daiin.ol",
            "chey.dar.otedy.daiin",
        ]
        .iter()
        .enumerate()
        {
            c.lines.push(Line {
                page: 0,
                words: l.split('.').map(str::to_string).collect(),
                para_start: i == 0,
                para_end: i == 2,
            });
        }
        c
    }

    #[test]
    fn rng_is_deterministic_and_unbiased_enough() {
        let mut a = Rng::new("salt", 7);
        let mut b = Rng::new("salt", 7);
        let mut c = Rng::new("salt", 8);
        let va: Vec<u64> = (0..4).map(|_| a.next_u64()).collect();
        let vb: Vec<u64> = (0..4).map(|_| b.next_u64()).collect();
        let vc: Vec<u64> = (0..4).map(|_| c.next_u64()).collect();
        assert_eq!(va, vb);
        assert_ne!(va, vc);
        let mut counts = [0u32; 3];
        for _ in 0..3000 {
            counts[a.below(3)] += 1;
        }
        assert!(counts.iter().all(|&n| n > 800 && n < 1200), "{counts:?}");
        let cum = [1u64, 1, 4]; // weights 1, 0, 3
        let mut hits = [0u32; 3];
        for _ in 0..4000 {
            hits[a.weighted(&cum)] += 1;
        }
        assert_eq!(hits[1], 0);
        assert!(hits[0] > 700 && hits[0] < 1300, "{hits:?}");
        let u = a.unit();
        assert!((0.0..1.0).contains(&u));
    }

    #[test]
    fn layout_from_corpus_and_truncation() {
        let l = Layout::from_corpus(&sample_corpus());
        assert_eq!(l.tokens(), 12);
        assert!(l.lines[0].para_start && l.lines[2].para_end);
        let t = l.truncate_tokens(9);
        assert_eq!(t.lines.len(), 2);
        assert!(t.lines[1].para_end);
        assert_eq!(Layout::uniform(5, 3, 2).tokens(), 15);
    }

    #[test]
    fn every_family_fills_the_layout_deterministically() {
        let corpus = sample_corpus();
        let res = Resources {
            glyph_model: Some(GlyphModel::train(&corpus, 2)),
            word_bag: Some(WordBag::from_corpus(&corpus)),
        };
        let layout = Layout::uniform(20, 7, 5);
        for fam in FAMILIES {
            let g = build(fam, &params("{}"), &res).unwrap();
            assert_eq!(g.family_id(), fam);
            let a = g.generate(&mut Rng::new("wu", 1), &layout);
            let b = g.generate(&mut Rng::new("wu", 1), &layout);
            let c = g.generate(&mut Rng::new("wu", 2), &layout);
            assert_eq!(a, b, "{fam} not deterministic");
            assert_ne!(a, c, "{fam} ignores the seed");
            assert_eq!(a.word_count(), 140, "{fam} token count");
            assert!(
                a.words().all(|w| !w.is_empty() && w.is_ascii()),
                "{fam} produced a bad word"
            );
            assert!(a.lines[0].para_start && a.lines[19].para_end);
        }
    }

    #[test]
    fn charmarkov_uses_only_trained_glyphs() {
        let corpus = sample_corpus();
        let res = Resources {
            glyph_model: Some(GlyphModel::train(&corpus, 3)),
            word_bag: None,
        };
        let g = build("charmarkov", &params("{}"), &res).unwrap();
        let out = g.generate(&mut Rng::new("x", 0), &Layout::uniform(50, 8, 10));
        let trained: std::collections::BTreeSet<u8> =
            corpus.words().flat_map(|w| w.bytes()).collect();
        assert!(out
            .words()
            .flat_map(|w| w.bytes())
            .all(|b| trained.contains(&b)));
        assert!(matches!(
            build("charmarkov", &params(r#"{"order": 2}"#), &res),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            build("bagofwords", &params("{}"), &res),
            Err(GenError::MissingResource("word_bag"))
        ));
    }

    #[test]
    fn slotgram_words_conform_to_their_table_and_params_are_checked() {
        let g = SlotGram::from_params(&params("{}")).unwrap();
        let out = g.generate(&mut Rng::new("s", 1), &Layout::uniform(60, 8, 10));
        assert!(
            out.words().all(|w| g.conforms(w.as_bytes())),
            "every generated word parses"
        );
        assert!(g.conforms(b"qokeedy"));
        assert!(g.conforms(b"daiin"));
        assert!(g.conforms(b"chol"));
        assert!(!g.conforms(b"kkkk"));
        assert!(!g.conforms(b"zzz"));
        let custom = SlotGram::from_params(&params(r#"{"slots":"a,b|c,_","p_fill":1.0}"#)).unwrap();
        let out = custom.generate(&mut Rng::new("s", 2), &Layout::uniform(5, 10, 5));
        assert!(out.words().all(|w| w == "ac" || w == "bc"));
        assert!(matches!(
            SlotGram::from_params(&params(r#"{"slots":"_,_"}"#)),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            SlotGram::from_params(&params(r#"{"p_fill_slots":"0.5,0.5"}"#)),
            Err(GenError::BadParam(_))
        ));
        let rep = SlotGram::from_params(&params(r#"{"p_repeat":1.0}"#)).unwrap();
        let out = rep.generate(&mut Rng::new("s", 3), &Layout::uniform(3, 6, 3));
        for l in &out.lines {
            assert!(l.words.iter().all(|w| w == &l.words[0]));
        }
    }

    #[test]
    fn selfcite_reuses_nearby_words() {
        let g = build(
            "selfcite",
            &params(r#"{"p_modify": 0.5, "window_lines": 1}"#),
            &Resources::default(),
        )
        .unwrap();
        let out = g.generate(&mut Rng::new("x", 3), &Layout::uniform(200, 8, 10));
        // a high share of adjacent-or-nearby repeats/near-copies
        let words: Vec<&str> = out.words().collect();
        let repeats = words.windows(9).filter(|w| w[1..].contains(&w[0])).count();
        assert!(
            repeats as f64 / words.len() as f64 > 0.2,
            "repeats {repeats}"
        );
        assert!(words.iter().all(|w| w.len() <= 8));
    }

    #[test]
    fn numeric_parameters_accept_decimal_strings() {
        let a = build(
            "selfcite",
            &params(r#"{"p_modify": "0.6", "window_lines": "3"}"#),
            &Resources::default(),
        )
        .unwrap();
        let b = build(
            "selfcite",
            &params(r#"{"p_modify": 0.6, "window_lines": 3}"#),
            &Resources::default(),
        )
        .unwrap();
        let layout = Layout::uniform(10, 6, 5);
        assert_eq!(
            a.generate(&mut Rng::new("s", 1), &layout),
            b.generate(&mut Rng::new("s", 1), &layout)
        );
        assert!(matches!(
            build(
                "selfcite",
                &params(r#"{"p_modify": "0.60x"}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            build(
                "selfcite",
                &params(r#"{"window_lines": "-3"}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            build(
                "selfcite",
                &params(r#"{"window_lines": "03"}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
    }

    #[test]
    fn parameter_validation() {
        assert!(matches!(
            build("nope", &params("{}"), &Resources::default()),
            Err(GenError::UnknownFamily(_))
        ));
        assert!(matches!(
            build(
                "gibberish",
                &params(r#"{"len_p": 1.5}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            build(
                "gibberish",
                &params(r#"{"alphabet": "..."}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
        assert!(matches!(
            build(
                "selfcite",
                &params(r#"{"w_substitute": 0, "w_insert": 0, "w_delete": 0, "w_affix": 0}"#),
                &Resources::default()
            ),
            Err(GenError::BadParam(_))
        ));
    }
}
