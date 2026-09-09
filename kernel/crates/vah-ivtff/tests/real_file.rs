//! Parses a real transliteration file when one is available. The file is not
//! part of the repository (see pipeline/fetch_data.sh); the test is skipped
//! when it is missing so that `cargo test` works in a fresh checkout.
use std::path::PathBuf;

fn find_file() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("VAH_IVTFF_FILE") {
        return Some(PathBuf::from(p));
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data");
    for name in ["ZL3b-n.txt", "ZL3b-n_updated.txt"] {
        let p = root.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[test]
fn parses_zl3b_when_present() {
    let Some(path) = find_file() else {
        eprintln!("skipped: no transliteration file found (set VAH_IVTFF_FILE)");
        return;
    };
    let src = std::fs::read_to_string(&path).unwrap();
    let doc = vah_ivtff::parse(&src).unwrap();
    assert_eq!(doc.header.version, "2.0");
    assert_eq!(doc.pages.len(), 227, "ZL3b has 227 pages (incl. fRos)");
    assert_eq!(doc.locus_count(), 5385, "ZL3b has 5385 loci");

    // Structure preservation: every locus renders back to its source text.
    let mut internal_ws = 0usize;
    for page in &doc.pages {
        for locus in &page.loci {
            assert_eq!(
                vah_ivtff::render(&locus.items),
                locus.text,
                "{}.{}",
                page.name,
                locus.number
            );
            if locus.text.chars().any(char::is_whitespace) {
                internal_ws += 1;
            }
        }
    }
    eprintln!("loci with internal whitespace: {internal_ws}");

    let para = vah_ivtff::build_corpus(&doc, &vah_ivtff::ViewPolicy::paragraph_text_v1());
    let all = vah_ivtff::build_corpus(&doc, &vah_ivtff::ViewPolicy::all_text_v1());
    eprintln!(
        "para-v1: {} lines, {} words, {} glyphs; all-v1: {} lines, {} words",
        para.lines.len(),
        para.word_count(),
        para.glyph_count(),
        all.lines.len(),
        all.word_count()
    );
    assert!(para.word_count() > 30_000 && para.word_count() < 40_000);
    assert!(all.word_count() > para.word_count());
    let a = para.currier('A').word_count();
    let b = para.currier('B').word_count();
    eprintln!("Currier A words: {a}, B words: {b}");
    assert!(a > 5_000 && b > 5_000);
    let para_starts = para.lines.iter().filter(|l| l.para_start).count();
    let para_ends = para.lines.iter().filter(|l| l.para_end).count();
    eprintln!("paragraph starts: {para_starts}, ends: {para_ends}");
    assert!(para_starts > 500 && para_ends > 500);
}
