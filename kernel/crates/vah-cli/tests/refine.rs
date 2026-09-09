//! Coarse-to-fine refinement on a tiny planted problem: the final level
//! must land closer to the hidden parameters than the coarse level did,
//! and every level must leave a ledger.
use std::path::PathBuf;
use std::process::Command;

fn voynich() -> Command {
    Command::new(env!("CARGO_BIN_EXE_voynich"))
}

#[test]
fn refinement_moves_toward_the_hidden_point() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let layout = root.join("pipeline/targets/layout_v1.json");
    let dir = std::env::temp_dir().join(format!("vah-refine-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let planted = dir.join("planted");
    // hidden point off the coarse grid: len_p 0.47, zipf_s 0.9
    let out = voynich()
        .args([
            "plant",
            "--family",
            "gibberish",
            "--params",
            r#"{"len_n":9,"len_p":0.47,"zipf_s":0.9}"#,
            "--seed",
            "5",
            "--max-tokens",
            "3000",
            "--resamples",
            "40",
        ])
        .arg("--layout")
        .arg(&layout)
        .arg("--out")
        .arg(&planted)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let grid = dir.join("grid.json");
    std::fs::write(&grid, r#"{"experiment_id":"refine-test","family":"gibberish","fixed":{"len_n":9},
        "axes":{"len_p":[0.3,0.5,0.7],"zipf_s":[0.0,1.0,2.0]},"replicates":6,"layout_tokens":3000}"#).unwrap();
    let outdir = dir.join("refine");
    let out = voynich()
        .args([
            "refine",
            "--levels",
            "3",
            "--shrink",
            "0.5",
            "--threads",
            "2",
        ])
        .arg("--grid")
        .arg(&grid)
        .arg("--target")
        .arg(planted.join("fingerprint_v1.json"))
        .arg("--layout")
        .arg(planted.join("layout_v1.json"))
        .arg("--out")
        .arg(&outdir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let r: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(outdir.join("refine-report.json")).unwrap())
            .unwrap();
    let levels = r["levels"].as_array().unwrap();
    assert_eq!(levels.len(), 3);
    for (i, l) in levels.iter().enumerate() {
        assert!(outdir.join(format!("level-{i}.ledger.jsonl")).exists());
        assert!(outdir.join(format!("level-{i}.grid.json")).exists());
        assert_eq!(l["level"], serde_json::json!(i));
    }
    let dist = |l: &serde_json::Value| {
        let p = &l["best_params"];
        ((p["len_p"].as_f64().unwrap() - 0.47) / 0.2).abs()
            + ((p["zipf_s"].as_f64().unwrap() - 0.9) / 1.0).abs()
    };
    let first = dist(&levels[0]);
    let last = dist(&levels[2]);
    assert!(
        last <= first,
        "final level {last} should be at least as close as coarse level {first}: {r}"
    );
    assert!(
        r["final_best_median"].as_f64().unwrap()
            <= levels[0]["best_median"].as_f64().unwrap() + 1e-9
    );
    // steps shrink and the grid stays inside the registered domain
    let lvl2: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(outdir.join("level-2.grid.json")).unwrap())
            .unwrap();
    for v in lvl2["axes"]["len_p"].as_array().unwrap() {
        let x = v.as_f64().unwrap();
        assert!((0.3..=0.7).contains(&x), "{x}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
