#!/usr/bin/env python3
"""Generate deterministic test-only fixtures from the current Python terrain scorer."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import yaml

from scan import PARAM_KEYS, similarity, terrain_match

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "weights.yaml"
SCORER_PATH = ROOT / "pipeline" / "scan.py"
GENERATOR_PATH = Path(__file__).resolve()
DEFAULT_OUTPUT = ROOT / "frontend" / "public" / "data" / "test-fixtures" / "terrain-scoring.json"
SCHEMA_VERSION = 1
NONFINITE_VALUES = {
    "not-a-number": math.nan,
    "positive-infinite": math.inf,
    "negative-infinite": -math.inf,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def marker(value: str) -> dict[str, str]:
    """Represent a non-finite input without writing invalid JSON numbers."""
    if value not in NONFINITE_VALUES:
        raise ValueError(f"unsupported non-finite fixture marker: {value}")
    return {"non_finite": value}


def decode_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, dict) and set(value) == {"non_finite"}:
        return NONFINITE_VALUES[value["non_finite"]]
    return float(value)


def numeric_values(values: dict[str, Any]) -> dict[str, float | None]:
    return {key: decode_value(values.get(key)) for key in PARAM_KEYS}


def score_case(case: dict[str, Any], params: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Call scan.py's actual scorer and derive its intermediate support breakdown."""
    weighted_params = {
        key: {"range": float(params[key]["range"]), "weight": float(case["weights"][key])}
        for key in PARAM_KEYS
    }
    target = numeric_values(case["target_values"])
    results: dict[str, dict[str, Any]] = {}
    scores: dict[str, float | None] = {}
    for site in case["sites"]:
        values = numeric_values(site["values"])
        per_similarity = {
            key: similarity(values[key], target[key], weighted_params[key]["range"])
            for key in PARAM_KEYS
        }
        missing = [key for key in PARAM_KEYS if per_similarity[key] is None]
        included_weight = sum(
            weighted_params[key]["weight"] for key in PARAM_KEYS if per_similarity[key] is not None
        )
        total_weight = sum(weighted_params[key]["weight"] for key in PARAM_KEYS)
        weighted_sum = sum(
            weighted_params[key]["weight"] * per_similarity[key]
            for key in PARAM_KEYS
            if per_similarity[key] is not None
        )
        score = terrain_match(values, target, weighted_params)
        completeness = included_weight / total_weight if total_weight > 0 else 0.0
        results[site["id"]] = {
            "per_parameter_similarity": per_similarity,
            "weighted_sum": weighted_sum,
            "included_weight": included_weight,
            "total_weight": total_weight,
            "completeness": completeness,
            "missing": missing,
            "terrain_match": score,
        }
        scores[site["id"]] = score

    # This is the app's documented rank tie rule, distinct from scan.select's
    # geospatial coordinate ordering for selecting windows on the same score.
    ranked = sorted(
        scores,
        key=lambda site_id: (
            scores[site_id] is None,
            -scores[site_id] if scores[site_id] is not None else 0.0,
            site_id,
        ),
    )
    return {"sites": results, "ranked_site_ids": ranked}


def _site(site_id: str, values: dict[str, Any]) -> dict[str, Any]:
    return {"id": site_id, "values": {key: values[key] for key in PARAM_KEYS}}


def make_cases(config: dict[str, Any]) -> list[dict[str, Any]]:
    params = config["params"]
    ranges = {key: float(params[key]["range"]) for key in PARAM_KEYS}
    base_weights = {key: float(params[key]["weight"]) for key in PARAM_KEYS}
    if any(not math.isfinite(v) or v <= 0 for v in base_weights.values()):
        raise ValueError("fixture generation expects positive finite configured default weights")
    target = {key: 0.0 for key in PARAM_KEYS}
    cases: list[dict[str, Any]] = []

    def add(
        case_id: str,
        description: str,
        sites: list[dict[str, Any]],
        *,
        weights: dict[str, float] | None = None,
        window_km: float | None = None,
        body: str = "moon",
        target_values: dict[str, Any] | None = None,
    ) -> None:
        item = {
            "id": case_id,
            "kind": "synthetic",
            "description": description,
            "target_body": body,
            "target_values": {key: (target_values or target)[key] for key in PARAM_KEYS},
            "weights": {key: float((weights or base_weights)[key]) for key in PARAM_KEYS},
            "sites": sites,
        }
        if window_km is not None:
            # Metadata for the consumer: scoring receives these already-computed
            # window descriptors; scan.py itself selects using its configured main window.
            item["window_km"] = window_km
        item["expected"] = score_case(item, params)
        cases.append(item)

    exact = _site("site_exact", target)
    add("identical-values", "All available parameters match the synthetic target.", [exact])

    boundary_sites = []
    beyond_sites = []
    for key in PARAM_KEYS:
        at_range = dict(target)
        at_range[key] = ranges[key]
        beyond_range = dict(target)
        beyond_range[key] = 2.0 * ranges[key]
        boundary_sites.append(_site(f"boundary-{key}", at_range))
        beyond_sites.append(_site(f"beyond-{key}", beyond_range))
    add("each-parameter-at-range", "One parameter at its configured range; other values match.", boundary_sites)
    add("each-parameter-beyond-range", "One parameter beyond its configured range; similarity remains at its floor.", beyond_sites)

    unequal_weights = dict(base_weights)
    first, *rest = PARAM_KEYS
    unequal_weights[first] = sum(base_weights[key] for key in rest)
    partial_a = dict(target)
    partial_a[first] = None
    partial_b = dict(target)
    partial_b[rest[0]] = None
    add(
        "partial-missing-unequal-weights",
        "Missing support on opposite parameters with a deterministic unequal-weight case.",
        [_site("partial-a", partial_a), _site("partial-b", partial_b)],
        weights=unequal_weights,
    )

    partial_target = dict(target)
    partial_target[rest[1]] = None
    add(
        "partial-target-missing",
        "One target parameter is missing, so the corresponding site comparison is unavailable.",
        [_site("target-missing", target)], target_values=partial_target,
    )

    add(
        "all-values-missing",
        "Every site parameter is missing; score is unscored and missing keys remain explicit.",
        [_site("all-missing", {key: None for key in PARAM_KEYS})],
    )

    zero_weight = dict(base_weights)
    zero_weight[first] = 0.0
    zero_weight_different = dict(target)
    zero_weight_different[first] = 2.0 * ranges[first]
    zero_weight_only_support = {key: None for key in PARAM_KEYS}
    zero_weight_only_support[first] = target[first]
    add(
        "one-zero-weight",
        "A difference on a zero-weight parameter does not change the weighted mean.",
        [_site("zero-weight-difference", zero_weight_different)],
        weights=zero_weight,
    )
    add(
        "zero-weight-only-support",
        "Only the zero-weight parameter is available, so no positive-weight score denominator exists.",
        [_site("zero-weight-only", zero_weight_only_support)],
        weights=zero_weight,
    )
    add(
        "all-zero-weights",
        "All values are present but all weights are zero; score is unscored and completeness is zero.",
        [_site("zero-weights", target)],
        weights={key: 0.0 for key in PARAM_KEYS},
    )

    tie_values = dict(target)
    tie_values[first] = ranges[first]
    add(
        "ties-and-unscored-order",
        "Equal scores are ordered by site id; null scores follow scored sites.",
        [_site("tie-z", tie_values), _site("tie-a", tie_values),
         _site("unscored", {key: None for key in PARAM_KEYS})],
    )

    nonfinite_sites = []
    for label in ("not-a-number", "positive-infinite", "negative-infinite"):
        values = dict(target)
        values[first] = marker(label)
        nonfinite_sites.append(_site(f"nonfinite-{label.lower()}", values))
    add(
        "nonfinite-input-markers",
        "JSON-safe markers decode to non-finite numbers for scorer tests; those parameter comparisons are missing.",
        nonfinite_sites,
    )

    # Synthetic descriptors are tagged for every supported window and both body
    # variants. Body is metadata here: terrain_match intentionally ignores it.
    for window_km in config["window_sizes_km"]:
        for body in ("moon", "mars"):
            add(
                f"window-{int(window_km)}-{body}",
                "Same terrain-scoring contract for this supported window/body label; values are synthetic descriptors.",
                [exact], window_km=float(window_km), body=body,
            )

    return cases


def fixture_document(config_path: Path = CONFIG_PATH, scorer_path: Path = SCORER_PATH,
                     generator_path: Path = GENERATOR_PATH) -> dict[str, Any]:
    config_text = config_path.read_text(encoding="utf-8")
    config = yaml.safe_load(config_text)
    cases = make_cases(config)
    return {
        "schema_version": SCHEMA_VERSION,
        "purpose": "test-only synthetic fixtures; not production app data or observed site measurements",
        "producer": {
            "scorer": "pipeline/scan.py:similarity and terrain_match",
            "scorer_sha256": sha256(scorer_path),
            "generator": "pipeline/scoring_fixtures.py",
            "generator_sha256": sha256(generator_path),
            "config": "config/weights.yaml",
            "config_sha256": hashlib.sha256(config_text.encode("utf-8")).hexdigest(),
            "parameter_order": list(PARAM_KEYS),
            "configured_params": {
                key: {
                    "label": config["params"][key]["label"],
                    "unit": config["params"][key]["unit"],
                    "weight": float(config["params"][key]["weight"]),
                    "range": float(config["params"][key]["range"]),
                }
                for key in PARAM_KEYS
            },
            "configured_window_sizes_km": [float(value) for value in config["window_sizes_km"]],
        },
        "ordering_note": (
            "Fixture ranking uses the frontend contract: score descending, null last, site id ascending for ties. "
            "pipeline/scan.py selection instead breaks equal window scores by latitude then longitude."
        ),
        "window_note": (
            "window_km labels synthetic precomputed descriptors for the consumer; the Python scan scorer itself "
            "uses its configured main window. No new terrain windows are computed by this fixture generator."
        ),
        "nonfinite_note": (
        "A values object with a non_finite label is a JSON-safe test marker; labels are "
        "not-a-number, positive-infinite, or negative-infinite. A consumer decodes the label to its "
        "corresponding non-finite number before calling similarity."
        ),
        "cases": cases,
    }


def serialize(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def selftest() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    first = serialize(fixture_document())
    second = serialize(fixture_document())
    assert first == second, "fixture generation is not deterministic"
    document = json.loads(first)
    assert len(document["cases"]) >= 10
    assert set(document["producer"]["parameter_order"]) == set(PARAM_KEYS)
    cases = {case["id"]: case for case in document["cases"]}
    assert cases["identical-values"]["expected"]["sites"]["site_exact"]["terrain_match"] == 1.0
    assert cases["all-values-missing"]["expected"]["sites"]["all-missing"]["terrain_match"] is None
    assert cases["all-zero-weights"]["expected"]["sites"]["zero-weights"]["completeness"] == 0.0
    assert cases["ties-and-unscored-order"]["expected"]["ranked_site_ids"] == ["tie-a", "tie-z", "unscored"]
    for key in PARAM_KEYS:
        boundary = cases["each-parameter-at-range"]["expected"]["sites"][f"boundary-{key}"]
        beyond = cases["each-parameter-beyond-range"]["expected"]["sites"][f"beyond-{key}"]
        assert boundary["per_parameter_similarity"][key] == 0.0
        assert beyond["per_parameter_similarity"][key] == 0.0
    partial = cases["partial-missing-unequal-weights"]["expected"]["sites"]
    assert partial["partial-a"]["missing"] == [PARAM_KEYS[0]]
    assert partial["partial-b"]["missing"] == [PARAM_KEYS[1]]
    assert len(set(cases["partial-missing-unequal-weights"]["weights"].values())) > 1
    assert cases["partial-target-missing"]["expected"]["sites"]["target-missing"]["missing"] == [PARAM_KEYS[2]]
    assert cases["zero-weight-only-support"]["expected"]["sites"]["zero-weight-only"]["terrain_match"] is None
    for site in cases["nonfinite-input-markers"]["sites"]:
        expected = cases["nonfinite-input-markers"]["expected"]["sites"][site["id"]]
        assert expected["missing"] == [PARAM_KEYS[0]]
        assert expected["per_parameter_similarity"][PARAM_KEYS[0]] is None
    assert set(config["window_sizes_km"]) == {
        case["window_km"] for case in document["cases"] if "window_km" in case
    }
    assert {case["target_body"] for case in document["cases"] if "window_km" in case} == {"moon", "mars"}
    for case in document["cases"]:
        assert case["expected"] == score_case(case, config["params"])
    # The actual scan scorer treats NaN and either infinity as unavailable, not zero.
    for invalid in (math.nan, math.inf, -math.inf):
        assert similarity(invalid, 0.0, float(config["params"][PARAM_KEYS[0]]["range"])) is None
    print(f"selftest: PASS ({len(document['cases'])} generated cases; repeats byte-identical)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="fixture JSON output path")
    parser.add_argument("--check", action="store_true", help="fail if the generated fixture differs from output")
    parser.add_argument("--selftest", action="store_true", help="run generator determinism/coverage checks")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0

    generated = serialize(fixture_document())
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != generated:
            print(f"fixture is stale or missing: {args.output}", file=sys.stderr)
            return 1
        print(f"fixture matches generated output: {args.output.relative_to(ROOT)}")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(generated)
    print(f"Wrote {len(json.loads(generated)['cases'])} deterministic scoring cases to {args.output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
