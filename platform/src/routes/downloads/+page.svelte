<svelte:head>
  <title>Source, builds, and reproduction · Voynich@home</title>
  <meta name="description" content="Build Voynich@home from source, reproduce published records, and contribute code or research review."/>
</svelte:head>

<div class="page narrow prose">
  <p class="eyebrow">Source and reproduction</p>
  <h1>Build the tools and reproduce the research</h1>
  <p class="lede">The Rust program generates test data, runs searches, scores output, and verifies results. Browsers run the same scientific code through WebAssembly. The website assigns tasks and records results that the server has reproduced.</p>

  <h2>Build the reviewed development source</h2>
  <p>The project has not published a production release. These commands check out a reviewed development commit, run its tests, and build the native programs.</p>
  <pre>git clone https://github.com/javidmardanov/VoynichAtHome.git
cd VoynichAtHome
git checkout cbbaf5f136d281e70646f2b4ccc8d946401435a3
cd kernel
cargo test --workspace
cargo build --release</pre>
  <p>Run a declared search using its complete input, including the quantized language model:</p>
  <pre>vah-search run --job job.json --out result.json</pre>
  <p>The search receives the declared input without the hidden original message or encoding key. A separate evaluation program compares its output with the concealed answer.</p>

  <h2>Reproduce downloaded campaign records</h2>
  <p>A campaign download contains its manifest, exact inputs, checked results, and approved worker module. From the platform directory, replay the downloaded record without contacting the project server:</p>
  <pre>npm run reproduce -- --offline --out ./campaign</pre>
  <p>This preview has no hosted campaign record to download. <a href="https://github.com/javidmardanov/VoynichAtHome/blob/cbbaf5f136d281e70646f2b4ccc8d946401435a3/platform/README.md">Read the setup and operating instructions ↗</a></p>

  <h2>Command-line participation</h2>
  <p>No public campaign is accepting work, so the command-line worker cannot request new tasks. Once a campaign opens, its page will provide a command with the server address and campaign ID. The worker starts one native process at 25% intensity. Ctrl+C stops it; use the same private state directory to resume a saved checkpoint or retry an unconfirmed result.</p>

  <h2>Useful contributions</h2>
  <ul>
    <li>Review the source-work splits and normalization rules for Latin and Italian.</li>
    <li>Improve bounded search methods and compare them under the same budgets.</li>
    <li>Reproduce a published record on a different browser or native platform.</li>
    <li>Test keyboard access, mobile layouts, recovery after interruptions, and operating procedures.</li>
  </ul>
  <div class="actions"><a class="button" href="https://github.com/javidmardanov/VoynichAtHome">Browse the source ↗</a><a class="button secondary" href="https://github.com/javidmardanov/VoynichAtHome/issues">Find or report a task ↗</a></div>

  <h2>Code and data rights</h2>
  <p>Original project code uses the MIT license. Imported code, transcriptions, comparison texts, images, and fonts keep their own terms. The repository records each source and hash. This website includes no manuscript images or third-party fonts.</p>
  <p><a href="https://github.com/javidmardanov/VoynichAtHome/blob/cbbaf5f136d281e70646f2b4ccc8d946401435a3/docs/LICENSING.md">Read the rights and provenance register ↗</a></p>
  <p><a href="/notices/README.txt">Review distributed dependency notices</a></p>

  <h2>Release downloads</h2>
  <p>A production release would include binaries, signatures, and build provenance after the project accepts the release checks. This development preview has no release binaries.</p>
</div>
