//! Content digests must survive a JSON round trip: what the coordinator
//! serialises is what the worker digests.
use vah_core::{build_target, canonical_json, digest_json};
use vah_corpus::{Corpus, Line};

fn corpus() -> Corpus {
    let mut c = Corpus::single_page("t");
    for (i, l) in [
        "daiin.chol.chor.qokedy.shedy",
        "qokeedy.daiin.ol.chey.dar",
        "otedy.daiin.qokain.chedy.okal",
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
fn target_digest_survives_json_round_trip() {
    let t = build_target(&corpus(), 10, 1);
    let before = canonical_json(&t).unwrap();
    let json = serde_json::to_string(&t).unwrap();
    let back: vah_stats::Target = serde_json::from_str(&json).unwrap();
    let after = canonical_json(&back).unwrap();
    assert_eq!(before, after);
    assert_eq!(digest_json(&t).unwrap(), digest_json(&back).unwrap());
    // and the canonical text itself parses back to the same value
    let back2: vah_stats::Target = serde_json::from_str(&before).unwrap();
    assert_eq!(back2, t);
}
