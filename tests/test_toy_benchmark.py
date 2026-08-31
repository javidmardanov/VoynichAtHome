from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = _load("caesar_generator", ROOT / "benchmarks/generators/caesar.py")
worker = _load("caesar_worker", ROOT / "benchmarks/workers/caesar_search.py")


def test_fixture_generator_reproduces_ciphertext() -> None:
    plaintext = (ROOT / "benchmarks/fixtures/synthetic-plaintext.txt").read_text(
        encoding="ascii"
    )
    ciphertext = (ROOT / "benchmarks/fixtures/synthetic-ciphertext.txt").read_text(
        encoding="ascii"
    )

    assert generator.shift(plaintext, 7) == ciphertext


def test_toy_worker_selects_disclosed_key() -> None:
    plaintext = (ROOT / "benchmarks/fixtures/synthetic-plaintext.txt").read_text(
        encoding="ascii"
    )
    ciphertext = (ROOT / "benchmarks/fixtures/synthetic-ciphertext.txt").read_text(
        encoding="ascii"
    )

    result = worker.search(ciphertext, plaintext, 0, 25)

    assert result == {
        "best_key": 7,
        "best_score": 25,
        "candidates_evaluated": 26,
        "score_unit": "matching_codepoints",
    }
