//! End-to-end check of the Gate 2 tooling on a tiny problem: plant a
//! pseudo-manuscript, sweep a small grid that contains the hidden point,
//! and require that rule C recovers it and rejects the controls.
use std::path::PathBuf;
use std::process::Command;

fn voynich() -> Command {
    Command::new(env!("CARGO_BIN_EXE_voynich"))
}

#[test]
fn plant_sweep_calibrate_recovers_a_planted_point() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let layout = root.join("pipeline/targets/layout_v1.json");
    let dir = std::env::temp_dir().join(format!("vah-calib-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let planted = dir.join("planted");
    let out = voynich()
        .args([
            "plant",
            "--family",
            "gibberish",
            "--params",
            r#"{"len_n":9,"len_p":0.45,"zipf_s":1.0}"#,
            "--seed",
            "3",
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
    std::fs::write(&grid, r#"{"experiment_id":"test","family":"gibberish","fixed":{"len_n":9},
        "axes":{"len_p":[0.35,0.45,0.55],"zipf_s":[0.5,1.0,1.5]},"replicates":6,"layout_tokens":3000}"#).unwrap();
    let report = dir.join("report.json");
    let out = voynich()
        .args([
            "calibrate",
            "--self-replicates",
            "24",
            "--control-replicates",
            "6",
            "--alpha",
            "0.2",
        ])
        .arg("--planted")
        .arg(&planted)
        .arg("--grid")
        .arg(&grid)
        .arg("--out")
        .arg(&report)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let r: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&report).unwrap()).unwrap();
    assert_eq!(r["hidden_point"]["on_grid"], serde_json::json!(true));
    assert_eq!(
        r["rule_c"]["recovered"],
        serde_json::json!(true),
        "{stdout}"
    );
    assert_eq!(
        r["hidden_point"]["rank_by_median"],
        serde_json::json!(1),
        "{stdout}"
    );
    for fam in ["bagofwords", "charmarkov", "gibberish"] {
        // the gibberish control uses default parameters, a different point of the same family
        assert_eq!(
            r["controls"][fam]["rule_c"]["compatible"],
            serde_json::json!(false),
            "{fam}: {stdout}"
        );
    }
    assert!(
        r["rule_c"]["compatible_fraction"].as_f64().unwrap() <= 0.34,
        "{stdout}"
    );
    // the ledger is reproducible: a second run yields the same report
    let report2 = dir.join("report2.json");
    let out = voynich()
        .args([
            "calibrate",
            "--self-replicates",
            "24",
            "--control-replicates",
            "6",
            "--alpha",
            "0.2",
            "--threads",
            "1",
        ])
        .arg("--planted")
        .arg(&planted)
        .arg("--grid")
        .arg(&grid)
        .arg("--out")
        .arg(&report2)
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(&report).unwrap(),
        std::fs::read_to_string(&report2).unwrap(),
        "thread count must not change results"
    );
    // A different control batch must get its own threshold, not the grid's.
    let report12 = dir.join("report12.json");
    let out = voynich()
        .args([
            "calibrate",
            "--self-replicates",
            "24",
            "--control-replicates",
            "12",
            "--alpha",
            "0.2",
        ])
        .arg("--planted")
        .arg(&planted)
        .arg("--grid")
        .arg(&grid)
        .arg("--out")
        .arg(&report12)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let r12: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&report12).unwrap()).unwrap();
    let self_d: Vec<f64> = serde_json::from_value(r12["self_distances_raw"].clone()).unwrap();
    let expected12 = vah_core::calib::subset_median_quantile(&self_d, 12, 0.99, 2000, 1);
    for fam in ["bagofwords", "charmarkov", "gibberish"] {
        assert_eq!(r12["controls"][fam]["rule_c"]["replicates"], 12);
        assert_eq!(
            r12["controls"][fam]["rule_c"]["epsilon_median"]
                .as_f64()
                .unwrap(),
            expected12
        );
    }
    // The metric must reach actual execution. This target has no precision
    // matrix: silently using z would incorrectly succeed.
    let mut g: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&grid).unwrap()).unwrap();
    g["metric"] = serde_json::json!("mahalanobis");
    std::fs::write(&grid, serde_json::to_string(&g).unwrap()).unwrap();
    let out = voynich()
        .args(["calibrate", "--self-replicates", "24"])
        .arg("--planted")
        .arg(&planted)
        .arg("--grid")
        .arg(&grid)
        .arg("--out")
        .arg(&report12)
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("precision"));
    let _ = std::fs::remove_dir_all(&dir);
}
