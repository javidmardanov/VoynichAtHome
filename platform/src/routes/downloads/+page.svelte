<svelte:head>
  <title>Build, reproduce, and contribute — Voynich@home</title>
  <meta name="description" content="Build Voynich@home from source, reproduce the development records, and understand which release downloads are currently available."/>
</svelte:head>

<div class="page narrow prose">
  <p class="eyebrow">Source and reproduction</p>
  <h1>Build, reproduce, and contribute</h1>
  <p class="lede">The Rust program performs generation, search, scoring, and verification. The browser runs the same scientific code through WebAssembly, while the website assigns tasks and records checked results.</p>

  <h2>Build the reviewed development source</h2>
  <p>No production release is available. The commands below check out the exact commit containing the current development records, then run its tests and build the native programs.</p>
  <pre>git clone https://github.com/javidmardanov/VoynichAtHome.git
cd VoynichAtHome
git checkout 33debe761229e99816cd6d0f1efc1bc65c775b4d
cd kernel
cargo test --workspace
cargo build --release</pre>
  <p>Run a declared search using its complete input, including the quantized language model:</p>
  <pre>vah-search run --job job.json --out result.json</pre>
  <p>The search receives no hidden original message or encoding key. The separate evaluation harness compares its output with the concealed answer.</p>

  <h2>Reproduce downloaded campaign records</h2>
  <p>A campaign download contains its manifest, exact inputs, checked results, and approved worker module. From the platform directory, replay a complete downloaded record without contacting the project server:</p>
  <pre>npm run reproduce -- --offline --out ./campaign</pre>
  <p>No hosted campaign record is available in this preview. <a href="https://github.com/javidmardanov/VoynichAtHome/blob/33debe761229e99816cd6d0f1efc1bc65c775b4d/platform/README.md">Read the complete setup and operating instructions ↗</a></p>

  <h2>Command-line participation</h2>
  <p>No public campaign is accepting work, so the command-line volunteer workflow is currently closed. When a campaign opens, its page will provide a complete command using the real server address and campaign ID. The worker uses one native process at 25% intensity by default; Ctrl+C stops it, and the same private state directory resumes a saved checkpoint or retries an unconfirmed result.</p>

  <h2>Useful contributions</h2>
  <ul>
    <li>Review the source-work splits and normalization rules for Latin and Italian.</li>
    <li>Improve bounded search methods and compare them under the same budgets.</li>
    <li>Reproduce a published record on a different browser or native platform.</li>
    <li>Test keyboard access, mobile layouts, offline recovery, and operating procedures.</li>
  </ul>
  <div class="actions"><a class="button" href="https://github.com/javidmardanov/VoynichAtHome">Browse the source ↗</a><a class="button secondary" href="https://github.com/javidmardanov/VoynichAtHome/issues">Find or report a task ↗</a></div>

  <h2>Code and data rights</h2>
  <p>Original project code uses the MIT license. Imported code, transcriptions, comparison texts, images, and fonts keep their own terms. The repository records their sources and hashes separately. This website bundles no manuscript images or third-party fonts.</p>
  <p><a href="https://github.com/javidmardanov/VoynichAtHome/blob/33debe761229e99816cd6d0f1efc1bc65c775b4d/docs/LICENSING.md">Read the rights and provenance register ↗</a></p>
  <p><a href="/notices/README.txt">Review distributed dependency notices</a></p>

  <h2>Release downloads</h2>
  <p>No release binaries are available in this development preview. The planned release package includes binaries, signatures, and build provenance after the release checks pass.</p>
</div>
