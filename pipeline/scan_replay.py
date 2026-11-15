#!/usr/bin/env python3
"""Replay a recorded candidate selection without DEM reads or network requests."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from scan_provenance import ROOT, ReplayPrerequisiteError, replay_selection, selftest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provenance", nargs="?", type=Path, help="scan provenance JSON to replay")
    parser.add_argument("--output", type=Path, help="write replay report here; default is stdout")
    parser.add_argument("--selftest", action="store_true", help="run offline deterministic replay checks")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0
    if args.provenance is None:
        parser.error("provenance JSON path is required")
    if args.output is not None:
        output = args.output.resolve()
        public_data = (ROOT / "frontend" / "public" / "data").resolve()
        if output == public_data or public_data in output.parents:
            parser.error("replay report must be written outside frontend/public/data")

    try:
        document: dict[str, Any] = json.loads(args.provenance.read_text(encoding="utf-8"))
        report = replay_selection(document)
    except (OSError, json.JSONDecodeError, ReplayPrerequisiteError, KeyError, TypeError, ValueError) as exc:
        report = {"status": "invalid-or-incomplete-evidence", "reason": str(exc)}

    encoded = json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n"
    if args.output is None:
        sys.stdout.write(encoded)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
        print(f"Wrote research-only replay report to {args.output}")
    return 0 if report.get("status") == "matched" else 2


if __name__ == "__main__":
    raise SystemExit(main())
