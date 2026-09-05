//! Parallel sweep over a parameter grid on one machine, with a complete
//! ledger of every evaluated point. Parallelism is across work units only;
//! every unit is computed by the deterministic kernel, so the ledger does
//! not depend on the number of threads.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use vah_core::grid::Grid;
use vah_core::vah_generators::{Layout, Params, Resources};
use vah_core::vah_stats::Target;

pub const LEDGER_SCHEMA: &str = "vah-sweep-ledger-0.1";

/// First line of a ledger file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LedgerHeader {
    pub ledger: String,
    pub grid_digest: String,
    pub experiment_id: String,
    pub family: String,
    #[serde(default = "legacy_metric")]
    pub metric: String,
    pub target_digest: String,
    pub layout_digest: String,
    pub resources_digest: Option<String>,
    pub kernel_version: String,
    pub numeric_profile: String,
    pub points: usize,
    pub replicates: u32,
}

/// One evaluated parameter point.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub index: usize,
    pub params: Params,
    pub work_unit_id: String,
    pub stream_id: String,
    pub result_hash: String,
    pub distances: Vec<f64>,
    /// Fingerprint of every replicate (needed by rule B).
    pub fingerprints: Vec<Vec<f64>>,
    pub median: f64,
    pub mean: f64,
    pub min: f64,
    pub max: f64,
    pub specimen_seed: u64,
}

fn legacy_metric() -> String {
    "z".into()
}

type Res<T> = Result<T, Box<dyn std::error::Error>>;

/// Run every point of the grid; entries come back sorted by index.
pub fn run_grid(
    grid: &Grid,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
    threads: usize,
    progress: bool,
) -> Res<Vec<LedgerEntry>> {
    grid.validate()?;
    let layout = if grid.layout_tokens > 0 {
        layout.truncate_tokens(grid.layout_tokens)
    } else {
        layout.clone()
    };
    let n = grid.len();
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let entries: Mutex<Vec<LedgerEntry>> = Mutex::new(Vec::with_capacity(n));
    let failure: Mutex<Option<String>> = Mutex::new(None);
    let threads = threads.max(1).min(n.max(1));
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= n || failure.lock().map(|f| f.is_some()).unwrap_or(true) {
                    break;
                }
                let params = grid.point(i);
                let run = (|| -> Result<LedgerEntry, vah_core::CoreError> {
                    let mut wu = vah_core::make_work_unit(
                        &grid.experiment_id,
                        &grid.family,
                        params.clone(),
                        target,
                        &layout,
                        resources,
                        0,
                        grid.replicates,
                    )?;
                    wu.metric = grid.metric.clone();
                    let r = vah_core::run_work_unit(&wu, target, &layout, resources, |_, _| {})?;
                    Ok(LedgerEntry {
                        index: i,
                        params,
                        work_unit_id: r.work_unit_id,
                        stream_id: r.stream_id,
                        result_hash: r.result_hash,
                        distances: r.seeds.iter().map(|s| s.distance).collect(),
                        fingerprints: r.seeds.iter().map(|s| s.fingerprint.clone()).collect(),
                        median: r.replicates.distance_median,
                        mean: r.replicates.distance_mean,
                        min: r.replicates.distance_min,
                        max: r.replicates.distance_max,
                        specimen_seed: r.specimen_seed,
                    })
                })();
                match run {
                    Ok(e) => {
                        if let Ok(mut v) = entries.lock() {
                            v.push(e);
                        }
                        let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                        if progress && (d % 20 == 0 || d == n) {
                            eprintln!("sweep: {d}/{n} points");
                        }
                    }
                    Err(e) => {
                        if let Ok(mut f) = failure.lock() {
                            *f = Some(format!("point {i}: {e}"));
                        }
                        break;
                    }
                }
            });
        }
    });
    if let Some(msg) = failure.into_inner().unwrap_or(None) {
        return Err(msg.into());
    }
    let mut v = entries.into_inner().map_err(|_| "poisoned")?;
    v.sort_by_key(|e| e.index);
    Ok(v)
}

/// Header for a ledger of `grid` against the given artifacts.
pub fn header(
    grid: &Grid,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
) -> Res<LedgerHeader> {
    let layout = if grid.layout_tokens > 0 {
        grid_layout(grid, layout)
    } else {
        layout.clone()
    };
    Ok(LedgerHeader {
        ledger: LEDGER_SCHEMA.to_string(),
        grid_digest: vah_core::digest_json(grid)?,
        experiment_id: grid.experiment_id.clone(),
        family: grid.family.clone(),
        metric: grid.metric.clone(),
        target_digest: vah_core::digest_json(target)?,
        layout_digest: vah_core::digest_json(&layout)?,
        resources_digest: match resources {
            Some(r) => Some(vah_core::digest_json(r)?),
            None => None,
        },
        kernel_version: vah_core::KERNEL_VERSION.to_string(),
        numeric_profile: vah_core::NUMERIC_PROFILE.to_string(),
        points: grid.len(),
        replicates: grid.replicates,
    })
}

/// The layout a grid actually uses (possibly truncated).
pub fn grid_layout(grid: &Grid, layout: &Layout) -> Layout {
    if grid.layout_tokens > 0 {
        layout.truncate_tokens(grid.layout_tokens)
    } else {
        layout.clone()
    }
}

/// Write a ledger (header line, then one entry per line).
pub fn write_ledger(path: &Path, header: &LedgerHeader, entries: &[LedgerEntry]) -> Res<()> {
    let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
    writeln!(f, "{}", serde_json::to_string(header)?)?;
    for e in entries {
        writeln!(f, "{}", serde_json::to_string(e)?)?;
    }
    f.flush()?;
    Ok(())
}

/// Read a ledger.
pub fn read_ledger(path: &Path) -> Res<(LedgerHeader, Vec<LedgerEntry>)> {
    let f = BufReader::new(std::fs::File::open(path)?);
    let mut lines = f.lines();
    let first = lines.next().ok_or("empty ledger")??;
    let header: LedgerHeader = serde_json::from_str(&first)?;
    if header.ledger != LEDGER_SCHEMA {
        return Err(format!("unsupported ledger schema {}", header.ledger).into());
    }
    let mut entries = Vec::with_capacity(header.points);
    for line in lines {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        entries.push(serde_json::from_str(&line)?);
    }
    entries.sort_by_key(|e: &LedgerEntry| e.index);
    Ok((header, entries))
}
