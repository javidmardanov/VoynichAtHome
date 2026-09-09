//! Known-answer tests: every job in kernel/golden must reproduce the hash in
//! expected.json. Any change in the science code that alters a single bit
//! of a result fails here, on purpose.
use std::path::PathBuf;
use std::process::Command;

#[test]
fn golden_hashes_match() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden");
    let out = Command::new(env!("CARGO_BIN_EXE_voynich"))
        .arg("golden")
        .arg("--dir")
        .arg(&dir)
        .output()
        .expect("run voynich golden");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "golden check failed:\n{stdout}\n{stderr}"
    );
    assert!(
        stdout.lines().filter(|l| l.starts_with("ok")).count() >= 5,
        "{stdout}"
    );
}
