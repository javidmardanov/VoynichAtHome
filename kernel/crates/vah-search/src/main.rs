use clap::{Parser, Subcommand};
use std::io::{BufRead, Write};
use std::path::PathBuf;
#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Perform a bounded, resumable part of an annealing search.
    Step {
        #[arg(long)]
        job: PathBuf,
        #[arg(long)]
        checkpoint: Option<PathBuf>,
        #[arg(long, default_value_t = 256)]
        proposals: u32,
        #[arg(long)]
        out: PathBuf,
    },
    /// Recompute and serialize the result of a completed checkpoint.
    Finish {
        #[arg(long)]
        job: PathBuf,
        #[arg(long)]
        checkpoint: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Construct strict Naibbe v2 benchmark text. Not a worker operation.
    EncodeNaibbe {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        seed: u64,
        #[arg(long)]
        out: PathBuf,
    },
    /// Parse preserved Naibbe word boundaries using the published tables.
    ParseNaibbe {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Train {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        source: String,
        #[arg(long)]
        out: PathBuf,
    },
    Run {
        #[arg(long)]
        job: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// JSON lines on stdin omit model. Output one measured result per line.
    Batch {
        #[arg(long)]
        model: PathBuf,
    },
}
fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    match Args::parse().command {
        Command::Step {
            job,
            checkpoint,
            proposals,
            out,
        } => {
            let job = serde_json::from_slice(&std::fs::read(job)?)?;
            let checkpoint = checkpoint
                .map(std::fs::read)
                .transpose()?
                .map(|bytes| serde_json::from_slice(&bytes))
                .transpose()?;
            let next = vah_search::step(&job, checkpoint, proposals)?;
            std::fs::write(out, serde_json::to_vec(&next)?)?;
        }
        Command::Finish {
            job,
            checkpoint,
            out,
        } => {
            let job = serde_json::from_slice(&std::fs::read(job)?)?;
            let checkpoint = serde_json::from_slice(&std::fs::read(checkpoint)?)?;
            let result = vah_search::finish(&job, checkpoint)?;
            std::fs::write(out, serde_json::to_vec(&result)?)?;
        }
        Command::EncodeNaibbe {
            input,
            key,
            seed,
            out,
        } => {
            let text = std::fs::read_to_string(input)?;
            let plain: Result<Vec<u8>, _> = text
                .trim()
                .chars()
                .map(|c| {
                    vah_search::ALPHABET
                        .find(c)
                        .map(|i| i as u8)
                        .ok_or("invalid normalized text")
                })
                .collect();
            let key: Vec<u8> = serde_json::from_slice(&std::fs::read(key)?)?;
            let cipher = vah_search::naibbe::Tables::new().encrypt(&plain?, &key, seed)?;
            std::fs::write(out, cipher)?;
        }
        Command::ParseNaibbe { input, out } => {
            let cipher = std::fs::read_to_string(input)?;
            let symbols = vah_search::naibbe::Tables::new().parse(&cipher)?;
            std::fs::write(out, serde_json::to_vec(&symbols)?)?;
        }
        Command::Train { input, source, out } => {
            let text = std::fs::read_to_string(input)?;
            let symbols: Result<Vec<u8>, _> = text
                .trim()
                .chars()
                .map(|c| {
                    vah_search::ALPHABET
                        .find(c)
                        .map(|i| i as u8)
                        .ok_or("text is not normalized")
                })
                .collect();
            let model = vah_search::train(&[symbols?], vec![source])?;
            std::fs::write(out, serde_json::to_vec(&model)?)?;
        }
        Command::Run { job, out } => {
            let job: vah_search::Job = serde_json::from_slice(&std::fs::read(job)?)?;
            std::fs::write(out, serde_json::to_vec(&vah_search::run(&job)?)?)?;
        }
        Command::Batch { model } => {
            let model: serde_json::Value = serde_json::from_slice(&std::fs::read(model)?)?;
            for line in std::io::stdin().lock().lines() {
                let line = line?;
                if line.len() > 1_000_000 {
                    return Err("input line exceeds limit".into());
                }
                let mut value: serde_json::Value = serde_json::from_str(&line)?;
                if value.get("model").is_some() {
                    return Err("batch model is fixed".into());
                }
                value["model"] = model.clone();
                let job: vah_search::Job = serde_json::from_value(value)?;
                let began = std::time::Instant::now();
                let result = vah_search::run(&job)?;
                let elapsed_ms = began.elapsed().as_secs_f64() * 1000.0;
                println!(
                    "{}",
                    serde_json::to_string(
                        &serde_json::json!({"result":result,"elapsed_ms":elapsed_ms})
                    )?
                );
                std::io::stdout().flush()?;
            }
        }
    }
    Ok(())
}
