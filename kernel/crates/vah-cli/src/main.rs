//! `voynich` — native front end of the science kernel.
//!
//! Pipeline side (needs the transliteration files, never shipped to clients):
//!   voynich fingerprint <ivtff>              print the fingerprint of a file (optionally one partition role set)
//!   voynich partition <ivtff> --out M        assign quires to discovery / validation / confirmation
//!   voynich build-targets <ivtff> --out D    write target, layout and resources (optionally from partition roles)
//!   voynich compare <ivtff> --targets D      sanity checks against the target
//!
//! Worker side (self-contained JSON in, JSON out):
//!   voynich make-job ...                     assemble a job JSON
//!   voynich run-wu <job.json>                execute a job
//!   voynich show-seed <job.json> --seed N    print the generated text
//!   voynich golden --dir D [--update]        known-answer checks
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use vah_core::partition::{self, Manifest};
use vah_core::vah_corpus::Corpus;
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

/// Options shared by the commands that read a transliteration file.
#[derive(clap::Args, Clone)]
struct CorpusOpts {
    /// Corpus view: para-v1 (paragraph text) or all-v1 (all text).
    #[arg(long, default_value = "para-v1")]
    view: String,
    /// Partition manifest (from `voynich partition`).
    #[arg(long)]
    partition: Option<PathBuf>,
    /// Comma-separated roles to keep when a partition is given
    /// (discovery, validation, confirmation).
    #[arg(long, default_value = "discovery,validation")]
    roles: String,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the fingerprint of a transliteration file.
    Fingerprint {
        file: PathBuf,
        #[command(flatten)]
        corpus: CorpusOpts,
        /// Restrict to one Currier language (A or B).
        #[arg(long)]
        currier: Option<char>,
    },
    /// Assign whole quires to discovery, validation and confirmation roles.
    Partition {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value = "para-v1")]
        view: String,
        #[arg(long, default_value_t = 0.55)]
        discovery: f64,
        #[arg(long, default_value_t = 0.25)]
        validation: f64,
        #[arg(long, default_value_t = 0.20)]
        confirmation: f64,
    },
    /// Build the target, layout and resources artifacts from a transliteration file.
    BuildTargets {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[command(flatten)]
        corpus: CorpusOpts,
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
        #[command(flatten)]
        corpus: CorpusOpts,
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

/// A loaded corpus with the provenance fields that describe it.
struct Loaded {
    corpus: Corpus,
    source_digest: String,
    view_id: String,
    partition_digest: Option<String>,
    roles: Vec<String>,
}

fn load(file: &Path, opts: &CorpusOpts) -> Res<Loaded> {
    let src = fs::read_to_string(file)?;
    let doc = vah_ivtff::parse(&src)?;
    let mut corpus = vah_ivtff::build_corpus(&doc, &policy(&opts.view)?);
    let source_digest = vah_core::digest(src.as_bytes());
    let (partition_digest, roles) = match &opts.partition {
        Some(p) => {
            let manifest: Manifest = read_json(p)?;
            if manifest.source_digest != source_digest || manifest.view_id != opts.view {
                return Err(format!(
                    "partition manifest was built from {} view {}, not this file/view",
                    manifest.source_digest, manifest.view_id
                )
                .into());
            }
            let roles: Vec<String> = opts
                .roles
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            for r in &roles {
                if !partition::ROLES.contains(&r.as_str()) {
                    return Err(format!("unknown role {r}").into());
                }
            }
            corpus = partition::filter(&corpus, &manifest, &roles);
            (Some(vah_core::digest_json(&manifest)?), roles)
        }
        None => (None, Vec::new()),
    };
    Ok(Loaded {
        corpus,
        source_digest,
        view_id: opts.view.clone(),
        partition_digest,
        roles,
    })
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
    distance_median: f64,
    specimen_seed: u64,
    specimen_distance: f64,
}

fn run(cli: Cli) -> Res<()> {
    match cli.cmd {
        Cmd::Fingerprint {
            file,
            corpus: opts,
            currier,
        } => {
            let l = load(&file, &opts)?;
            let mut corpus = l.corpus;
            if let Some(c) = currier {
                corpus = corpus.currier(c);
            }
            let fp = vah_stats::fingerprint(&corpus);
            let out = serde_json::json!({
                "source_digest": l.source_digest,
                "view_id": l.view_id,
                "partition_digest": l.partition_digest,
                "roles": l.roles,
                "currier": currier,
                "words": corpus.word_count(),
                "lines": corpus.lines.len(),
                "version": fp.version,
                "stats": fp.named(),
            });
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
        Cmd::Partition {
            file,
            out,
            view,
            discovery,
            validation,
            confirmation,
        } => {
            let opts = CorpusOpts {
                view: view.clone(),
                partition: None,
                roles: String::new(),
            };
            let l = load(&file, &opts)?;
            let fractions = [
                ("discovery", discovery),
                ("validation", validation),
                ("confirmation", confirmation),
            ];
            if fractions.iter().any(|(_, f)| !(0.0..=1.0).contains(f))
                || (discovery + validation + confirmation - 1.0).abs() > 1e-9
            {
                return Err("fractions must be in [0, 1] and sum to 1".into());
            }
            let manifest = partition::assign(&l.corpus, &l.source_digest, &view, &fractions);
            write_json(&out, &manifest)?;
            eprintln!("{:<6} {:>6} {:>6} {:>6}  role", "quire", "words", "A", "B");
            for q in &manifest.quires {
                eprintln!(
                    "{:<6} {:>6} {:>6} {:>6}  {}",
                    q.quire, q.words, q.words_currier_a, q.words_currier_b, q.role
                );
            }
            for (role, t) in &manifest.roles {
                eprintln!(
                    "{role}: {} words (A {}, B {}) in quires {}",
                    t.words,
                    t.words_currier_a,
                    t.words_currier_b,
                    t.quires.join(",")
                );
            }
            if !manifest.unassigned_pages.is_empty() {
                eprintln!(
                    "unassigned pages (no quire): {}",
                    manifest.unassigned_pages.join(",")
                );
            }
            eprintln!(
                "wrote {} ({})",
                out.display(),
                vah_core::digest_json(&manifest)?
            );
        }
        Cmd::BuildTargets {
            file,
            out,
            corpus: opts,
            resamples,
            seed,
            markov_order,
            bag_limit,
        } => {
            let l = load(&file, &opts)?;
            let corpus = &l.corpus;
            fs::create_dir_all(&out)?;
            let target = build_target(corpus, resamples, seed);
            let tf = TargetFile {
                target,
                provenance: TargetProvenance {
                    source_digest: l.source_digest.clone(),
                    view_id: l.view_id.clone(),
                    partition_digest: l.partition_digest.clone(),
                    roles: l.roles.clone(),
                    resamples,
                    bootstrap_seed: seed,
                    kernel_version: vah_core::KERNEL_VERSION.to_string(),
                    words: corpus.word_count(),
                    lines: corpus.lines.len(),
                },
            };
            write_json(&out.join("fingerprint_v1.json"), &tf)?;
            let layout = Layout::from_corpus(corpus);
            write_json(&out.join("layout_v1.json"), &layout)?;
            let mut bag = WordBag::from_corpus(corpus);
            if bag_limit > 0 {
                bag.words.truncate(bag_limit);
            }
            let resources = Resources {
                glyph_model: Some(GlyphModel::train(corpus, markov_order)),
                word_bag: Some(bag),
            };
            write_json(&out.join("resources_v1.json"), &resources)?;
            eprintln!(
                "wrote {} from {} words in roles [{}]: target {}, layout ({} lines), resources (order {}, {} words)",
                out.display(),
                corpus.word_count(),
                l.roles.join(","),
                vah_core::digest_json(&tf.target)?,
                layout.lines.len(),
                markov_order,
                resources.word_bag.as_ref().map(|b| b.words.len()).unwrap_or(0)
            );
        }
        Cmd::Compare {
            file,
            targets,
            corpus: opts,
            seeds,
        } => {
            let l = load(&file, &opts)?;
            let corpus = &l.corpus;
            let target = read_target(&targets.join("fingerprint_v1.json"))?;
            let layout: Layout = read_json(&targets.join("layout_v1.json"))?;
            let resources: Resources = read_json(&targets.join("resources_v1.json"))?;
            println!("{:<30} {:>9} {:>9}", "corpus", "median", "min");
            let d = |c: &Corpus| {
                vah_stats::distance(&vah_stats::fingerprint(c), &target)
                    .map(|d| format!("{d:9.3}"))
                    .unwrap_or_else(|e| e.to_string())
            };
            let label = if l.roles.is_empty() {
                "manuscript (whole)".to_string()
            } else {
                format!("manuscript [{}]", l.roles.join(","))
            };
            println!("{:<30} {:>9} {:>9}", label, d(corpus), "");
            println!(
                "{:<30} {:>9} {:>9}",
                "  Currier A pages only",
                d(&corpus.currier('A')),
                ""
            );
            println!(
                "{:<30} {:>9} {:>9}",
                "  Currier B pages only",
                d(&corpus.currier('B')),
                ""
            );
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
                println!(
                    "{:<30} {:>9.3} {:>9.3}   n={}",
                    format!("{family} (defaults)"),
                    r.replicates.distance_median,
                    r.replicates.distance_min,
                    r.replicates.n
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
                distance_median: r.replicates.distance_median,
                specimen_seed: r.specimen_seed,
                specimen_distance: r.specimen_distance,
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
