#!/usr/bin/env python3
"""Moon-vs-Earth terrain classifier with SHAP explanations (issue #46, experiment).

Step 2 of the issue #46 experiment. Reads the tiles written by
``pipeline/analog_tiles.py`` (``data/derived/analog_tiles.csv``), trains a
gradient-boosted tree classifier to tell Moon tiles from Earth tiles, and
explains it with SHAP. Nothing here feeds Terrain Match, the ranking or the app.

Method
* Model: scikit-learn ``HistGradientBoostingClassifier`` with default settings,
  balanced class weights and a fixed seed. No tuning, so there is nothing to
  overfit to the test folds.
* Training data: the ``random`` tiles only.
* Held-out evaluation: leave one group out. A group is one Earth site (all
  random tiles from its DEM tiles) or one 45-degree Moon longitude sector. Every
  random tile gets a prediction from a model that never saw its group.
* Feature sets, each run separately:
  - ``app3``: the three Terrain Match features.
  - ``all``: all ten features from analog_tiles.py.
  - ``no_fine``: ``all`` without ``roughness_m`` and ``curvature_abs_mean``, the
    two features that track LOLA's distance from the pole (see the shortcut check).
* Site windows: each Earth site's 12 km window tiles are scored by the model
  trained without that site. Each lunar target's window tiles are scored by a
  model trained without the random Moon tiles whose centres lie within
  (site window / 2 + tile size) of the target, so no training tile overlaps.
* Explanations: SHAP TreeExplainer values in log-odds of "Moon". Global
  importance is mean |SHAP| over all random tiles, from a model trained on all of
  them. Per site, the mean SHAP over the site's window tiles, from the held-out
  model, shows which features push the site toward Moon (positive) or Earth.
* Shortcut checks: Spearman correlation between distance from the pole and the
  held-out P(Moon) for random Moon tiles, and held-out accuracy for Moon tiles
  nearer and farther than the median distance.

* ``uv run pipeline/analog_classifier.py``            -> results/analog_classifier.json
* ``uv run pipeline/analog_classifier.py --selftest`` -> synthetic check, no data needed
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time

import numpy as np

import analog_tiles as A
import terrain as T

OUT_JSON = A.ROOT / "results" / "analog_classifier.json"
SEED = A.SEED

FEATURE_SETS = {
    "app3": ["slope_mean_deg", "slope_p90_deg", "roughness_m"],
    "all": list(A.FEATURES),
    "no_fine": [f for f in A.FEATURES if f not in ("roughness_m", "curvature_abs_mean")],
}


def make_model():
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(class_weight="balanced", random_state=SEED)


def shap_values(model, X: np.ndarray) -> np.ndarray:
    import shap

    sv = shap.TreeExplainer(model).shap_values(X)
    sv = np.asarray(sv)
    if sv.ndim == 3:  # some versions return one array per class
        sv = sv[..., 1] if sv.shape[-1] == 2 else sv[1]
    return sv


def finite(x):
    return T.finite_or_null(None if x is None else float(x))


def load_rows() -> list[dict]:
    if not A.TILES_CSV.exists():
        raise FileNotFoundError(f"missing {A.TILES_CSV}; run `uv run pipeline/analog_tiles.py` first")
    rows = []
    with A.TILES_CSV.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            for k in A.FEATURES + A.DIAGNOSTICS + ["lat", "lon"]:
                r[k] = float(r[k])
            rows.append(r)
    return rows


def matrix(rows, feats) -> np.ndarray:
    return np.array([[r[f] for f in feats] for r in rows], dtype="float64")


def labels(rows) -> np.ndarray:
    return np.array([1 if r["body"] == "moon" else 0 for r in rows])


def moon_distance_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return T.MOON_RADIUS_M * math.acos(max(-1.0, min(1.0, c)))


def run_feature_set(name, feats, rnd, windows, targets, exclusion_m) -> dict:
    from scipy.stats import spearmanr
    from sklearn.metrics import accuracy_score, roc_auc_score

    X, y = matrix(rnd, feats), labels(rnd)
    groups = np.array([r["group"] for r in rnd])
    oof = np.full(len(rnd), np.nan)
    per_group = {}
    site_out = {}

    for g in sorted(set(groups)):
        test = groups == g
        model = make_model().fit(X[~test], y[~test])
        oof[test] = model.predict_proba(X[test])[:, 1]
        per_group[g] = {
            "n": int(test.sum()), "body": "moon" if y[test][0] == 1 else "earth",
            "accuracy": finite(accuracy_score(y[test], oof[test] >= 0.5)),
            "mean_p_moon": finite(oof[test].mean()),
        }
        if g.startswith("earth_"):
            site = g[len("earth_"):]
            win = [r for r in windows if r["near"] == site]
            if win:
                site_out[site] = explain_site(model, win, feats)

    # Lunar targets: drop random Moon tiles that overlap the target's window.
    for tid, tlat, tlon in targets:
        win = [r for r in windows if r["near"] == tid]
        if not win:
            continue
        keep = np.array([
            not (r["body"] == "moon" and moon_distance_m(r["lat"], r["lon"], tlat, tlon) < exclusion_m)
            for r in rnd
        ])
        model = make_model().fit(X[keep], y[keep])
        site_out[tid] = {**explain_site(model, win, feats), "random_moon_tiles_excluded": int((~keep).sum())}

    pred = oof >= 0.5
    moon = y == 1
    dist = np.array([90.0 + r["lat"] for r in rnd])
    md = float(np.median(dist[moon]))
    near_m, far_m = moon & (dist <= md), moon & (dist > md)
    rho, p = spearmanr(dist[moon], oof[moon])

    full = make_model().fit(X, y)
    sv = shap_values(full, X)
    importance = {f: finite(v) for f, v in zip(feats, np.abs(sv).mean(axis=0))}

    return {
        "features": feats,
        "held_out": {
            "auc": finite(roc_auc_score(y, oof)),
            "accuracy": finite(accuracy_score(y, pred)),
            "moon_recall": finite(pred[moon].mean()),
            "earth_recall": finite((~pred[~moon]).mean()),
            "per_group": per_group,
        },
        "pole_distance_check": {
            "spearman_rho_vs_p_moon": finite(rho), "p": finite(p),
            "median_distance_deg": finite(md),
            "moon_accuracy_near_pole": finite(pred[near_m].mean()),
            "moon_accuracy_far_from_pole": finite(pred[far_m].mean()),
        },
        "shap_mean_abs_log_odds": dict(sorted(importance.items(), key=lambda kv: -(kv[1] or 0))),
        "sites": site_out,
    }


def explain_site(model, win, feats) -> dict:
    Xw = matrix(win, feats)
    p = model.predict_proba(Xw)[:, 1]
    sv = shap_values(model, Xw).mean(axis=0)
    return {
        "n_tiles": len(win),
        "mean_p_moon": finite(p.mean()),
        "share_classified_moon": finite((p >= 0.5).mean()),
        "mean_shap_log_odds": dict(sorted(((f, finite(v)) for f, v in zip(feats, sv)), key=lambda kv: kv[1] or 0)),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()

    t0 = time.time()
    rows = load_rows()
    rnd = [r for r in rows if r["role"] == "random"]
    windows = [r for r in rows if r["role"] == "site_window"]

    sizes = T.load_window_sizes()
    exclusion_m = (max(sizes) / 2 + min(sizes)) * 1000.0
    sites = json.loads(T.SITES_PATH.read_text(encoding="utf-8"))
    check = json.loads(A.CHECK_JSON.read_text(encoding="utf-8"))
    mal_lat, mal_lon = check["malapert_located"]
    targets = [(t["id"], t["lat"] if t["lat"] is not None else mal_lat,
                t["lon"] if t["lon"] is not None else mal_lon) for t in sites["lunar"]]

    out = {
        "_note": ("Experiment output for issue #46. A Moon-vs-Earth tile classifier and its SHAP "
                  "explanations. Not used by Terrain Match, the ranking or the app."),
        "settings": {
            "model": "sklearn HistGradientBoostingClassifier, defaults, class_weight=balanced",
            "seed": SEED, "evaluation": "leave one group out (Earth site or 45-degree Moon sector)",
            "threshold_p_moon": 0.5, "target_exclusion_radius_m": exclusion_m,
            "random_tiles": {"moon": sum(r["body"] == "moon" for r in rnd), "earth": sum(r["body"] == "earth" for r in rnd)},
        },
        "feature_sets": {},
    }
    for name, feats in FEATURE_SETS.items():
        out["feature_sets"][name] = run_feature_set(name, feats, rnd, windows, targets, exclusion_m)
        print(f"{name}: held-out AUC {out['feature_sets'][name]['held_out']['auc']:.3f} ({time.time() - t0:.0f} s)")

    OUT_JSON.write_text(json.dumps(out, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(A.ROOT)}")
    return 0


def selftest() -> int:
    """One informative feature among noise: it must lead the SHAP importance."""
    rng = np.random.default_rng(0)
    n = 600
    y = rng.integers(0, 2, n)
    X = rng.normal(size=(n, 4))
    X[:, 2] += 2.0 * y
    model = make_model().fit(X, y)
    imp = np.abs(shap_values(model, X)).mean(axis=0)
    assert int(np.argmax(imp)) == 2, imp
    assert model.score(X, y) > 0.8
    print("selftest: PASS (informative feature leads SHAP importance)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
