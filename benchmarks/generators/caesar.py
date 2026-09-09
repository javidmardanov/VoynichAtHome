"""Tiny deterministic fixture generator; not a production cipher benchmark."""

from __future__ import annotations

import argparse
from pathlib import Path

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def shift(text: str, key: int) -> str:
    """Shift ASCII A-Z by an integer key while preserving other bytes as text."""

    normalized_key = key % len(ALPHABET)
    table = str.maketrans(
        ALPHABET, ALPHABET[normalized_key:] + ALPHABET[:normalized_key]
    )
    return text.translate(table)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--key", type=int, required=True)
    args = parser.parse_args()

    plaintext = args.input.read_text(encoding="ascii")
    args.output.write_text(shift(plaintext, args.key), encoding="ascii")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
