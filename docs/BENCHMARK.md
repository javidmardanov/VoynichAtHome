# Benchmark: does the first experiment need volunteer computing?

*Answers the second go/no-go test from the second review ("benchmark the complete proposed search and demonstrate what volunteer scale adds"). Measured on 2026-09-02 with the draft 2 kernel (commit f180e24). Reproduce with the commands at the end.*

## What one simulation costs

One simulation = generate one corpus on the full discovery + validation layout (3,306 lines, 28,367 words), compute the 30 statistics of `fingerprint-v1`, and score the distance. Times are per simulation, measured as the difference between a 17-seed and a 1-seed job divided by 16, so that JSON parsing and process start-up are excluded.

| Family | Native (Rust, release) | WebAssembly (Node 22, V8) |
|---|---|---|
| `gibberish` | 66 ms | 84 ms |
| `bagofwords` | 43 ms | 58 ms |
| `charmarkov` (order 3) | 79 ms | 82 ms |
| `selfcite` | 69 ms | 84 ms |

Machine: one core of an Intel Xeon at 2.1 GHz (a slow cloud core; a 2024 laptop core is two to three times faster). The manuscript's own fingerprint (parse, view, 30 statistics) takes 75 ms warm. The wasm module runs at 80–95% of native speed here.

The review assumed five seconds per simulation. The measured figure is 0.04–0.08 s, sixty to a hundred times less. Both numbers lead to the same conclusion, with different margins.

## What the first experiment would cost

Assumptions are stated; change them and the arithmetic follows. Two cost scenarios: **v1** at 0.08 s per simulation (measured, rounded up), and **v2** at 0.5 s per simulation (a guess for a heavier `fingerprint-v2` with slot-grammar, line-position and signature statistics, plus heavier generators such as a verbose cipher over a substrate text).

| Sweep | Simulations | Core-hours at 0.08 s | Core-hours at 0.5 s |
|---|---|---|---|
| A. Screening as outlined in the synthesis: 4 families × 10,000 parameter points × 16 replicates × 2 views | 1.3 million | 28 | 180 |
| B. Wider: 7 families × 100,000 points × 16 replicates × 3 views | 34 million | 750 | 4,700 |
| C. Adaptive refinement around compatible regions, one billion simulations | 1,000 million | 22,000 | 140,000 |

What one machine and what volunteers deliver, per day:

| Resource | Simulations per day at 0.08 s |
|---|---|
| One laptop core (this benchmark's speed) | 1.1 million |
| One 32-core server, fully used | 35 million |
| One volunteer: 4-core laptop, 1 hour per day, 50% duty cycle | 90,000 |
| 100 such volunteers | 9 million |
| 1,000 such volunteers | 90 million |

Read together: sweep A is an overnight job on a laptop. Sweep B is one day on one rented 32-core server, or four days for 100 volunteers. Only sweep C, or the heavier v2 scenario at sweep-B scale, exceeds what one owned or rented machine does in a week, and even sweep C at v1 cost is about a month on one 32-core server.

## Conclusion

The first registered experiment does not need volunteer computing. It needs one machine for a day. The review's threshold ("below roughly 10,000–50,000 core-hours, distributed browsers are primarily an engagement, transparency and reproduction mechanism") is met with a wide margin by sweeps A and B in both cost scenarios.

Volunteer scale becomes a computational necessity only for:

- adaptive sweeps of the order of a billion simulations with a heavier fingerprint (sweep C at v2 cost is 140,000 core-hours: sixteen years of one core, or 45 days of 1,000 volunteers);
- workload 2, the verbose-cipher glyph-grouping search, whose space is combinatorial and has not been benchmarked because it is not implemented;
- workload 3, decipherment-susceptibility grids that run a language model per candidate.

## What this changes in the plan

1. **Run experiment 1 on owned or rented hardware**, with the same kernel and the same registered contracts. The coordinator is not on the critical path of the first result.
2. **Reposition the browser tier for experiment 1 as verification, not capacity.** A static page that runs one registered work unit in the visitor's browser and shows that the hash matches the published one needs no coordinator, no leases and no accounts. The WebAssembly module and the parity scripts already exist. This is the honest version of "citizen science people can inspect and reproduce".
3. **Build the public coordinator only if a registered workload needs it** (the three cases above) and only after the three go/no-go tests of the second review pass: a statistician and a domain advisor on board, this benchmark extended to the registered workload, and twenty explicit pilot commitments.
4. Do not enlarge a parameter search to justify the platform. The registered search size follows from the calibration at Gate 2, not from the platform.

## Reproduce

```sh
cd kernel && cargo build --release -p vah-cli && cargo build --release --target wasm32-unknown-unknown -p vah-wasm
V=target/release/voynich; T=../pipeline/targets/fingerprint_v1.json; L=../pipeline/targets/layout_v1.json; R=../pipeline/targets/resources_v1.json
$V make-job --experiment bench --family selfcite --params '{}' --target $T --layout $L --seed-count 1  > /tmp/s1.json
$V make-job --experiment bench --family selfcite --params '{}' --target $T --layout $L --seed-count 17 > /tmp/s17.json
time $V run-wu /tmp/s1.json > /dev/null; time $V run-wu /tmp/s17.json > /dev/null   # native: (t17 - t1) / 16
node scripts/wasm-bench.mjs /tmp/s1.json /tmp/s17.json                                # wasm
```
