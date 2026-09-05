"""Oracle-score Caesar transforms solely to exercise foundation contracts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def decrypt(ciphertext: str, key: int) -> str:
    normalized_key = key % len(ALPHABET)
    table = str.maketrans(
        ALPHABET, ALPHABET[-normalized_key:] + ALPHABET[:-normalized_key]
    )
    return ciphertext.translate(table)


def match_count(candidate: str, answer: str) -> int:
    if len(candidate) != len(answer):
        return -1
    return sum(left == right for left, right in zip(candidate, answer, strict=True))


def search(ciphertext: str, answer: str, start: int, end: int) -> dict[str, int | str]:
    if end < start:
        raise ValueError("end must not precede start")

    scored = [
        (match_count(decrypt(ciphertext, key), answer), key)
        for key in range(start, end + 1)
    ]
    best_score, best_key = max(scored, key=lambda item: (item[0], -item[1]))
    return {
        "best_key": best_key,
        "best_score": best_score,
        "candidates_evaluated": len(scored),
        "score_unit": "matching_codepoints",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ciphertext", type=Path, required=True)
    parser.add_argument("--answer", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    result = search(
        args.ciphertext.read_text(encoding="ascii"),
        args.answer.read_text(encoding="ascii"),
        args.start,
        args.end,
    )
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
