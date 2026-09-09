//! Native entry point for exactly the approved WebAssembly operations.
use clap::Parser;
use std::path::PathBuf;
#[derive(Parser)]
struct Args {
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    out: PathBuf,
}
fn main() {
    let args = Args::parse();
    let result = std::fs::read_to_string(&args.input)
        .map_err(|e| e.to_string())
        .and_then(|text| {
            if text.len() > 8_000_000 {
                return Err("input exceeds bound".into());
            }
            vah_search_wasm::execute(&text)
        })
        .and_then(|result| std::fs::write(&args.out, result).map_err(|e| e.to_string()));
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
