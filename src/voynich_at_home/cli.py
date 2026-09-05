"""Command-line interface for Voynich@Home contracts."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from .contracts import (
    SCHEMAS,
    ContractError,
    content_digest,
    load_json,
    validate_document,
    verify_bundle,
    verify_work_unit,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vah",
        description="Validate and identify Voynich@Home scientific contracts.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate one JSON contract")
    validate.add_argument("kind", choices=sorted(SCHEMAS))
    validate.add_argument("path")

    digest = subparsers.add_parser(
        "digest", help="print an RFC 8785 / SHA-256 identity"
    )
    digest.add_argument("path")

    verify = subparsers.add_parser(
        "verify-work-unit",
        help="validate a work unit and verify its content-derived work_unit_id",
    )
    verify.add_argument("path")

    bundle = subparsers.add_parser(
        "verify-bundle",
        help="verify cross-document identities and artifacts in a reproduction bundle",
    )
    bundle.add_argument("path")

    subparsers.add_parser("list-kinds", help="list available contract kinds")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "list-kinds":
            for kind in sorted(SCHEMAS):
                print(kind)
            return 0

        if args.command == "verify-bundle":
            counts = verify_bundle(args.path)
            summary = ", ".join(f"{key}={value}" for key, value in counts.items())
            print(f"valid bundle ({summary}): {args.path}")
            return 0

        document = load_json(args.path)
        if args.command == "validate":
            validate_document(args.kind, document)
            print(f"valid {args.kind}: {args.path}")
        elif args.command == "digest":
            print(content_digest(document))
        elif args.command == "verify-work-unit":
            identity = verify_work_unit(document)
            print(f"valid work-unit {identity}: {args.path}")
        else:  # pragma: no cover - argparse prevents this path.
            parser.error(f"unhandled command: {args.command}")
    except (ContractError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
