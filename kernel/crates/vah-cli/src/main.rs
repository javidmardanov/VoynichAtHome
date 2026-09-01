//! `voynich` — native front end of the science kernel.
//!
//! Pipeline side (needs the transliteration files, never shipped to clients):
//!   voynich fingerprint <ivtff>            print the fingerprint of a file
//!   voynich build-targets <ivtff> --out D  write target, layout and resources
//!   voynich compare <ivtff> --targets D    sanity checks against the target
//!
//! Worker side (self-contained JSON in, JSON out):
//!   voynich make-job ...                   assemble a job JSON
//!   voynich run-wu <job.json>              execute a job
//!   voynich show-seed <job.json> --seed N  print the generated text
//!   voynich golden --dir D [--update]      known-answer checks
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use vah_core::vah_generators::{GlyphModel, Layout, Params, Resources, WordBag};
use vah_core::vah_stats::{self, Target};
use vah_core::{build_target, Job, TargetFile, TargetProvenance, WorkResult};
use vah_ivtff::ViewPolicy;

#[derive(Parser)]
#[command(name = "voynich", version, about = "Voynich@Home science kernel")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the fingerprint of a transliteration file.
    Fingerprint {
        file: PathBuf,
        /// Corpus view: para-v1 (paragraph text) or all-v1 (all text).
        #[arg(long, default_value = "para-v1")]
        view: String,
        /// Restrict to one Currier language (A or B).
        #[arg(long)]
        currier: Option<char>,
    },
    /// Build the target, layout and resources artifacts from a transliteration file.
    BuildTargets {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value = "para-v1")]
        view: String,
        /// Bootstrap resamples for the per-statistic scale.
        #[arg(long, default_value_t = 200)]
        resamples: u32,
        #[arg(long, default_value_t = 1)]
        seed: u64,
        /// Order of the glyph n-gram model in the resources.
        #[arg(long, default_value_t = 3)]
        markov_order: usize,
        /// Keep only the most frequent words in the word bag (0 = all).
        #[arg(long, default_value_t = 0)]
        bag_limit: usize,
    },
    /// Sanity checks: distances of the manuscript, its halves, and controls to the target.
    Compare {
        file: PathBuf,
        #[arg(long)]
        targets: PathBuf,
        #[arg(long, default_value_t = 3)]
        seeds: u32,
    },
    /// Assemble a self-contained job JSON.
    MakeJob {
        #[arg(long)]
        experiment: String,
        #[arg(long)]
        family: String,
        /// Generator parameters as a JSON object.
        #[arg(long, default_value = "{}")]
        params: String,
        #[arg(long)]
        target: PathBuf,
        #[arg(long)]
        layout: PathBuf,
        #[arg(long)]
        resources: Option<PathBuf>,
        #[arg(long, default_value_t = 0)]
        seed_start: u64,
        #[arg(long, default_value_t = 4)]
        seed_count: u32,
        /// Truncate the layout to at most this many words (0 = full).
        #[arg(long, default_value_t = 0)]
        max_tokens: usize,
    },
    /// Execute a job and print the result JSON.
    RunWu {
        job: PathBuf,
        #[arg(long)]
        progress: bool,
    },
    /// Print the text generated for one seed of a job.
    ShowSeed {
        job: PathBuf,
        #[arg(long)]
        seed: u64,
    },
    /// Run every job in a golden directory and compare with expected.json.
    Golden {
        #[arg(long)]
        dir: PathBuf,
        /// Rewrite expected.json from the current results.
        #[arg(long)]
        update: bool,
    },
}

fn main() {
    if let Err(e) = run(Cli::parse()) {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn policy(view: &str) -> Res<ViewPolicy> {
    match view {
        "para-v1" => Ok(ViewPolicy::paragraph_text_v1()),
        "all-v1" => Ok(ViewPolicy::all_text_v1()),
        other => Err(format!("unknown view {other}").into()),
    }
}

fn load_corpus(file: &Path, view: &str) -> Res<(vah_core::vah_corpus::Corpus, String)> {
    let src = fs::read_to_string(file)?;
    let doc = vah_ivtff::parse(&src)?;
    let corpus = vah_ivtff::build_corpus(&doc, &policy(view)?);
    Ok((corpus, vah_core::digest(src.as_bytes())))
}

fn read_json<T: for<'de> Deserialize<'de>>(p: &Path) -> Res<T> {
    Ok(serde_json::from_str(&fs::read_to_string(p)?)?)
}

fn write_json<T: Serialize>(p: &Path, v: &T) -> Res<()> {
    fs::write(p, serde_json::to_string_pretty(v)? + "\n")?;
    Ok(())
}

/// Read a target artifact: either a bare Target or a TargetFile with provenance.
fn read_target(p: &Path) -> Res<Target> {
    let text = fs::read_to_string(p)?;
    if let Ok(tf) = serde_json::from_str::<TargetFile>(&text) {
        return Ok(tf.target);
    }
    Ok(serde_json::from_str::<Target>(&text)?)
}

#[derive(Serialize, Deserialize, Default)]
struct Expected {
    #[serde(flatten)]
    jobs: BTreeMap<String, ExpectedEntry>,
}

#[derive(Serialize, Deserialize, PartialEq)]
struct ExpectedEntry {
    result_hash: String,
    best_seed: u64,
    best_distance: f64,
}

fn run(cli: Cli) -> Res<()> {
    match cli.cmd {
        Cmd::Fingerprint {
            file,
            view,
            currier,
        } => {
            let (mut corpus, digest) = load_corpus(&file, &view)?;
            if let Some(c) = currier {
                corpus = corpus.currier(c);
            }
            let fp = vah_stats::fingerprint(&corpus);
            let out = serde_json::json!({
                "source_digest": digest,
                "view_id": view,
                "currier": currier,
                "words": corpus.word_count(),
                "lines": corpus.lines.len(),
                "version": fp.version,
                "stats": fp.named(),
            });
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
        Cmd::BuildTargets {
            file,
            out,
            view,
            resamples,
            seed,
            markov_order,
            bag_limit,
        } => {
            let (corpus, source_digest) = load_corpus(&file, &view)?;
            fs::create_dir_all(&out)?;
            let target = build_target(&corpus, resamples, seed);
            let tf = TargetFile {
                target,
                provenance: TargetProvenance {
                    source_digest,
                    view_id: view.clone(),
                    resamples,
                    bootstrap_seed: seed,
                    kernel_version: vah_core::KERNEL_VERSION.to_string(),
                    words: corpus.word_count(),
                    lines: corpus.lines.len(),
                },
            };
            write_json(&out.join("fingerprint_v1.json"), &tf)?;
            let layout = Layout::from_corpus(&corpus);
            write_json(&out.join("layout_v1.json"), &layout)?;
            let mut bag = WordBag::from_corpus(&corpus);
            if bag_limit > 0 {
                bag.words.truncate(bag_limit);
            }
            let resources = Resources {
                glyph_model: Some(GlyphModel::train(&corpus, markov_order)),
                word_bag: Some(bag),
            };
            write_json(&out.join("resources_v1.json"), &resources)?;
            eprintln!(
                "wrote {} (target {}), layout ({} lines, {} words), resources (order {}, {} words)",
                out.display(),
                vah_core::digest_json(&tf.target)?,
                layout.lines.len(),
                layout.tokens(),
                markov_order,
                resources
                    .word_bag
                    .as_ref()
                    .map(|b| b.words.len())
                    .unwrap_or(0)
            );
        }
        Cmd::Compare {
            file,
            targets,
            seeds,
        } => {
            let (corpus, _) = load_corpus(&file, "para-v1")?;
            let target = read_target(&targets.join("fingerprint_v1.json"))?;
            let layout: Layout = read_json(&targets.join("layout_v1.json"))?;
            let resources: Resources = read_json(&targets.join("resources_v1.json"))?;
            println!("{:<28} {:>10}", "corpus", "distance");
            let d = |c: &vah_core::vah_corpus::Corpus| {
                vah_stats::distance(&vah_stats::fingerprint(c), &target)
                    .map(|d| format!("{d:10.3}"))
                    .unwrap_or_else(|e| e.to_string())
            };
            println!("{:<28} {}", "manuscript (para-v1)", d(&corpus));
            println!("{:<28} {}", "manuscript Currier A", d(&corpus.currier('A')));
            println!("{:<28} {}", "manuscript Currier B", d(&corpus.currier('B')));
            for family in vah_core::vah_generators::FAMILIES {
                let wu = vah_core::make_work_unit(
                    "sanity",
                    family,
                    Params::new(),
                    &target,
                    &layout,
                    Some(&resources),
                    0,
                    seeds,
                )?;
                let job = Job {
                    work_unit: wu,
                    target: target.clone(),
                    layout: layout.clone(),
                    resources: Some(resources.clone()),
                };
                let r = vah_core::run_job(&job, |_, _| {})?;
                let ds: Vec<String> = r
                    .seeds
                    .iter()
                    .map(|s| format!("{:.3}", s.distance))
                    .collect();
                println!(
                    "{:<28} {:>10}   seeds: {}",
                    format!("{family} (defaults)"),
                    format!("{:.3}", r.best_distance),
                    ds.join(" ")
                );
            }
        }
        Cmd::MakeJob {
            experiment,
            family,
            params,
            target,
            layout,
            resources,
            seed_start,
            seed_count,
            max_tokens,
        } => {
            let params: Params = serde_json::from_str(&params)?;
            let target = read_target(&target)?;
            let mut layout: Layout = read_json(&layout)?;
            if max_tokens > 0 {
                layout = layout.truncate_tokens(max_tokens);
            }
            let resources: Option<Resources> = match resources {
                Some(p) => Some(read_json(&p)?),
                None => None,
            };
            let wu = vah_core::make_work_unit(
                &experiment,
                &family,
                params,
                &target,
                &layout,
                resources.as_ref(),
                seed_start,
                seed_count,
            )?;
            let job = Job {
                work_unit: wu,
                target,
                layout,
                resources,
            };
            vah_core::validate_job(&job)?;
            println!("{}", serde_json::to_string(&job)?);
        }
        Cmd::RunWu { job, progress } => {
            let job: Job = read_json(&job)?;
            let result = vah_core::run_job(&job, |done, total| {
                if progress {
                    eprintln!("seed {done}/{total}");
                }
            })?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Cmd::ShowSeed { job, seed } => {
            let job: Job = read_json(&job)?;
            let corpus = vah_core::generate_seed(&job, seed)?;
            // Ignore a closed pipe (e.g. `| head`) instead of panicking.
            use std::io::Write;
            let _ = std::io::stdout()
                .lock()
                .write_all(corpus.to_text().as_bytes());
        }
        Cmd::Golden { dir, update } => {
            let (results, expected) = run_golden_dir(&dir)?;
            if update {
                write_json(&dir.join("expected.json"), &Expected { jobs: results })?;
                eprintln!("updated {}", dir.join("expected.json").display());
                return Ok(());
            }
            let mut failures = 0;
            for (name, got) in &results {
                match expected.jobs.get(name) {
                    Some(exp) if exp == got => println!("ok    {name} {}", got.result_hash),
                    Some(exp) => {
                        failures += 1;
                        println!(
                            "FAIL  {name}\n      expected {}\n      got      {}",
                            exp.result_hash, got.result_hash
                        );
                    }
                    None => {
                        failures += 1;
                        println!("NEW   {name} {} (not in expected.json)", got.result_hash);
                    }
                }
            }
            for name in expected.jobs.keys() {
                if !results.contains_key(name) {
                    failures += 1;
                    println!("MISSING {name} (in expected.json but no job file)");
                }
            }
            if failures > 0 {
                return Err(format!("{failures} golden check(s) failed").into());
            }
        }
    }
    Ok(())
}

/// Run every `*.job.json` in `dir`; return results and the expected file (if any).
fn run_golden_dir(dir: &Path) -> Res<(BTreeMap<String, ExpectedEntry>, Expected)> {
    let mut results = BTreeMap::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(".job.json"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort();
    for p in entries {
        let job: Job = read_json(&p)?;
        let r: WorkResult = vah_core::run_job(&job, |_, _| {})?;
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();
        results.insert(
            name,
            ExpectedEntry {
                result_hash: r.result_hash,
                best_seed: r.best_seed,
                best_distance: r.best_distance,
            },
        );
    }
    let expected_path = dir.join("expected.json");
    let expected = if expected_path.exists() {
        read_json(&expected_path)?
    } else {
        Expected::default()
    };
    Ok((results, expected))
}
