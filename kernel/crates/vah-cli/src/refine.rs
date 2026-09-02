//! Coarse-to-fine refinement: a sequence of registered grid levels, each a
//! neighbourhood of the best point of the previous level (by median
//! replicate distance), with a complete ledger per level.
//!
//! Rules, so that the procedure is registrable:
//! * the domain of every axis is the range of the level-0 grid; refined
//!   values are clamped to it;
//! * an axis declared in the grid's `integer_axes` (or, when none are
//!   declared, an axis whose level-0 values are all integers) stays
//!   integer; its step never drops below 1, and an axis whose step would
//!   drop below 1 is frozen at the best value;
//! * non-numeric axes are frozen at the best value after level 0;
//! * each level's grid is `{best - step, best, best + step}` per axis
//!   (deduplicated), with `step = previous step * shrink`;
//! * the procedure stops after `levels` levels or when no axis can move.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vah_core::grid::Grid;
use vah_core::vah_generators::{Layout, Params, Resources};
use vah_core::vah_stats::Target;

use crate::sweep::{self, LedgerEntry};

type Res<T> = Result<T, Box<dyn std::error::Error>>;

/// One level of the refinement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Level {
    pub level: usize,
    pub grid_digest: String,
    pub points: usize,
    pub replicates: u32,
    pub best_index: usize,
    pub best_params: Params,
    pub best_median: f64,
    pub best_distances: Vec<f64>,
    /// Points whose median is at or below `epsilon_median`, if one was given.
    pub compatible: Vec<Params>,
    pub steps: Vec<(String, f64)>,
}

/// The refinement report.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub schema_version: String,
    pub experiment_id: String,
    pub family: String,
    pub target_digest: String,
    pub shrink: f64,
    pub epsilon_median: Option<f64>,
    pub levels: Vec<Level>,
    pub final_best_params: Params,
    pub final_best_median: f64,
    pub simulations: u64,
}

struct Axis {
    name: String,
    numeric: bool,
    integer: bool,
    lo: f64,
    hi: f64,
    step: f64,
}

fn axes_of(grid: &Grid) -> Vec<Axis> {
    let declared = !grid.integer_axes.is_empty();
    grid.axes
        .iter()
        .map(|(name, values)| {
            let nums: Option<Vec<f64>> = values.iter().map(|v| v.as_f64()).collect();
            match nums {
                Some(nums) if !nums.is_empty() => {
                    let lo = nums.iter().copied().fold(f64::INFINITY, f64::min);
                    let hi = nums.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                    let step = if nums.len() > 1 {
                        (hi - lo) / (nums.len() - 1) as f64
                    } else {
                        0.0
                    };
                    let integer = if declared {
                        grid.integer_axes.contains(name)
                    } else {
                        nums.iter().all(|x| x.fract() == 0.0)
                            && values.iter().all(|v| v.is_i64() || v.is_u64())
                    };
                    Axis {
                        name: name.clone(),
                        numeric: true,
                        integer,
                        lo,
                        hi,
                        step,
                    }
                }
                _ => Axis {
                    name: name.clone(),
                    numeric: false,
                    integer: false,
                    lo: 0.0,
                    hi: 0.0,
                    step: 0.0,
                },
            }
        })
        .collect()
}

/// Round to 10 decimals so that refined values print cleanly and stay
/// identical across platforms (only basic IEEE operations are used).
fn tidy(x: f64) -> f64 {
    (x * 1e10).round() / 1e10
}

fn number(x: f64, integer: bool) -> Value {
    if integer {
        Value::from(x.round() as i64)
    } else {
        serde_json::Number::from_f64(tidy(x))
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

/// Build the next level's grid around `best`. Returns `None` when no axis can move.
fn next_grid(
    prev: &Grid,
    axes: &mut [Axis],
    best: &Params,
    shrink: f64,
    replicates: u32,
) -> Option<Grid> {
    let mut new_axes = std::collections::BTreeMap::new();
    let mut moved = false;
    for ax in axes.iter_mut() {
        let b = &best[&ax.name];
        if !ax.numeric {
            new_axes.insert(ax.name.clone(), vec![b.clone()]);
            continue;
        }
        let bv = b.as_f64().unwrap_or(ax.lo);
        let mut step = ax.step * shrink;
        if ax.integer {
            step = step.round();
            if step < 1.0 {
                new_axes.insert(ax.name.clone(), vec![b.clone()]);
                ax.step = 0.0;
                continue;
            }
        }
        ax.step = step;
        if step <= 0.0 {
            new_axes.insert(ax.name.clone(), vec![b.clone()]);
            continue;
        }
        let mut vals: Vec<Value> = Vec::new();
        for k in [-1.0, 0.0, 1.0] {
            let x = (bv + k * step).clamp(ax.lo, ax.hi);
            let v = number(x, ax.integer);
            if !vals.contains(&v) {
                vals.push(v);
            }
        }
        if vals.len() > 1 {
            moved = true;
        }
        new_axes.insert(ax.name.clone(), vals);
    }
    if !moved {
        return None;
    }
    Some(Grid {
        // The experiment identity is kept across levels so that a parameter point
        // evaluated at two levels shares one random stream (re-chunking rule).
        experiment_id: prev.experiment_id.clone(),
        family: prev.family.clone(),
        fixed: prev.fixed.clone(),
        axes: new_axes,
        replicates,
        layout_tokens: prev.layout_tokens,
        integer_axes: prev.integer_axes.clone(),
    })
}

fn best_of(entries: &[LedgerEntry]) -> &LedgerEntry {
    entries
        .iter()
        .min_by(|a, b| a.median.total_cmp(&b.median).then(a.index.cmp(&b.index)))
        .expect("non-empty ledger")
}

/// Run the refinement.
#[allow(clippy::too_many_arguments)]
pub fn refine(
    grid0: &Grid,
    target: &Target,
    layout: &Layout,
    resources: Option<&Resources>,
    levels: usize,
    shrink: f64,
    final_replicates: Option<u32>,
    epsilon_median: Option<f64>,
    threads: usize,
    out: &Path,
) -> Res<Report> {
    grid0.validate()?;
    if !(shrink > 0.0 && shrink < 1.0) {
        return Err("shrink must be in (0, 1)".into());
    }
    std::fs::create_dir_all(out)?;
    let mut axes = axes_of(grid0);
    let mut grid = grid0.clone();
    let mut report_levels: Vec<Level> = Vec::new();
    let mut simulations = 0u64;
    for level in 0..levels.max(1) {
        if level + 1 == levels {
            if let Some(r) = final_replicates {
                grid.replicates = r;
            }
        }
        let header = sweep::header(&grid, target, layout, resources)?;
        eprintln!(
            "refine level {level}: {} points x {} replicates",
            grid.len(),
            grid.replicates
        );
        let entries = sweep::run_grid(&grid, target, layout, resources, threads, true)?;
        sweep::write_ledger(
            &out.join(format!("level-{level}.ledger.jsonl")),
            &header,
            &entries,
        )?;
        std::fs::write(
            out.join(format!("level-{level}.grid.json")),
            serde_json::to_string_pretty(&grid)? + "\n",
        )?;
        simulations += entries.len() as u64 * grid.replicates as u64;
        let best = best_of(&entries).clone();
        let compatible: Vec<Params> = match epsilon_median {
            Some(e) => entries
                .iter()
                .filter(|x| x.median <= e)
                .map(|x| x.params.clone())
                .collect(),
            None => Vec::new(),
        };
        eprintln!(
            "  best median {:.3} at {}",
            best.median,
            serde_json::to_string(&best.params)?
        );
        report_levels.push(Level {
            level,
            grid_digest: header.grid_digest.clone(),
            points: entries.len(),
            replicates: grid.replicates,
            best_index: best.index,
            best_params: best.params.clone(),
            best_median: best.median,
            best_distances: best.distances.clone(),
            compatible,
            steps: axes.iter().map(|a| (a.name.clone(), a.step)).collect(),
        });
        if level + 1 == levels {
            break;
        }
        match next_grid(&grid, &mut axes, &best.params, shrink, grid.replicates) {
            Some(g) => grid = g,
            None => {
                eprintln!("  no axis can move further; stopping");
                break;
            }
        }
    }
    let last = report_levels.last().expect("at least one level");
    let report = Report {
        schema_version: "vah-refine-0.1".to_string(),
        experiment_id: grid0.experiment_id.clone(),
        family: grid0.family.clone(),
        target_digest: vah_core::digest_json(target)?,
        shrink,
        epsilon_median,
        final_best_params: last.best_params.clone(),
        final_best_median: last.best_median,
        levels: report_levels.clone(),
        simulations,
    };
    std::fs::write(
        out.join("refine-report.json"),
        serde_json::to_string_pretty(&report)? + "\n",
    )?;
    Ok(report)
}
