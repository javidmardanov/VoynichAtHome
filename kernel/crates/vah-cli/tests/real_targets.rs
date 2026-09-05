//! The committed target artifact must be exactly reproducible from the
//! transliteration file and the partition manifest it names. Skipped when
//! the data file is not present.
use std::path::PathBuf;

use vah_core::partition::{self, Manifest};
use vah_core::TargetFile;

#[test]
fn committed_target_is_reproducible() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let tf: TargetFile = serde_json::from_str(
        &std::fs::read_to_string(root.join("pipeline/targets/fingerprint_v1.json")).unwrap(),
    )
    .unwrap();
    let candidates = [
        root.join("data/ZL3b-n.txt"),
        root.join("data/ZL3b-n_updated.txt"),
    ];
    let Some(path) = candidates.iter().find(|p| {
        p.exists()
            && std::fs::read(p)
                .map(|b| vah_core::digest(&b) == tf.provenance.source_digest)
                .unwrap_or(false)
    }) else {
        eprintln!(
            "skipped: no data file with digest {}",
            tf.provenance.source_digest
        );
        return;
    };
    let src = std::fs::read_to_string(path).unwrap();
    let doc = vah_ivtff::parse(&src).unwrap();
    let policy = match tf.provenance.view_id.as_str() {
        "para-v1" => vah_ivtff::ViewPolicy::paragraph_text_v1(),
        "all-v1" => vah_ivtff::ViewPolicy::all_text_v1(),
        other => panic!("unknown view {other}"),
    };
    let mut corpus = vah_ivtff::build_corpus(&doc, &policy);
    if let Some(pd) = &tf.provenance.partition_digest {
        let manifest: Manifest = serde_json::from_str(
            &std::fs::read_to_string(root.join("pipeline/partitions_v1.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            &vah_core::digest_json(&manifest).unwrap(),
            pd,
            "committed partition manifest differs from the one the target names"
        );
        assert_eq!(manifest.source_digest, tf.provenance.source_digest);
        // the manifest itself must be reproducible from the corpus
        let fractions: Vec<(&str, f64)> = manifest
            .fractions
            .iter()
            .map(|(r, f)| (r.as_str(), *f))
            .collect();
        let rebuilt = partition::assign(
            &corpus,
            &manifest.source_digest,
            &manifest.view_id,
            &fractions,
        );
        assert_eq!(
            rebuilt, manifest,
            "partition manifest differs from a fresh assignment"
        );
        corpus = partition::filter(&corpus, &manifest, &tf.provenance.roles);
        // confirmation quires never feed the target
        assert!(!tf.provenance.roles.iter().any(|r| r == "confirmation"));
    }
    assert_eq!(corpus.word_count(), tf.provenance.words);
    assert_eq!(corpus.lines.len(), tf.provenance.lines);
    let rebuilt = vah_core::build_target(
        &corpus,
        tf.provenance.resamples,
        tf.provenance.bootstrap_seed,
    );
    assert_eq!(
        rebuilt, tf.target,
        "committed target differs from a fresh build"
    );
    let fp = vah_stats::fingerprint(&corpus);
    assert_eq!(vah_stats::distance(&fp, &tf.target).unwrap(), 0.0);
}
