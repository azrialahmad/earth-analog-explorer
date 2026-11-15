"""Safe staging and publication helpers for the generated static app data."""
from __future__ import annotations

import json
import math
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class PublicationError(RuntimeError):
    """A release could not be prepared or published safely."""


def load_candidates(path: Path, *, reference_only: bool = False) -> list[dict[str, Any]]:
    """Load a non-empty candidate intermediate, unless reference-only was explicit."""
    if reference_only:
        return []
    if not path.is_file():
        raise PublicationError(
            f"candidate input is missing: {path}; run pipeline/scan.py first, "
            "or pass --reference-only to intentionally build without scanned candidates"
        )
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PublicationError(f"candidate input cannot be read as JSON: {path}: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("candidates"), list):
        raise PublicationError(f"candidate input must be an object containing a candidates array: {path}")
    candidates = document["candidates"]
    if not candidates:
        raise PublicationError(
            f"candidate input contains no candidates: {path}; refusing an implicit reference-only build; "
            "pass --reference-only only when that output is intentional"
        )

    ids: list[str] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise PublicationError(f"candidate at index {index} is not an object")
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, str) or not candidate_id:
            raise PublicationError(f"candidate at index {index} has no non-empty string id")
        if candidate.get("known_analog") is not False:
            raise PublicationError(f"candidate {candidate_id} must have known_analog=false")
        ids.append(candidate_id)
    duplicates = sorted({candidate_id for candidate_id in ids if ids.count(candidate_id) > 1})
    if duplicates:
        raise PublicationError(f"duplicate candidate ids: {', '.join(duplicates)}")
    return candidates


@contextmanager
def staged_public_dirs(data_dir: Path, img_dir: Path, *, root: Path) -> Iterator[tuple[Path, Path]]:
    """Yield staged copies of both public asset roots on the same filesystem as live output."""
    try:
        with tempfile.TemporaryDirectory(prefix=".build-stage-", dir=root) as temporary:
            stage_root = Path(temporary)
            staged_data = stage_root / "data"
            staged_img = stage_root / "img"
            if data_dir.exists():
                shutil.copytree(data_dir, staged_data)
            else:
                staged_data.mkdir(parents=True)
            if img_dir.exists():
                shutil.copytree(img_dir, staged_img)
            else:
                staged_img.mkdir(parents=True)
            yield staged_data, staged_img
    except PublicationError:
        raise
    except Exception as exc:
        raise PublicationError(f"could not prepare staged public output: {exc}") from exc


def publish_staged_dirs(
    staged_data: Path,
    staged_img: Path,
    data_dir: Path,
    img_dir: Path,
    *,
    after_install: Any = None,
) -> None:
    """Replace data/img directories with rollback if either replacement raises.

    The directories are swapped sequentially, not as one atomic filesystem action.
    A failed operation in this process restores the previous directories before it
    returns. Callers must validate the complete staged release before invoking this.
    """
    root = data_dir.parent.parent
    try:
        backup_root = Path(tempfile.mkdtemp(prefix=".build-backup-", dir=root))
    except OSError as exc:
        raise PublicationError(f"could not create publication backup: {exc}") from exc

    pairs = ((staged_data, data_dir), (staged_img, img_dir))
    states: list[dict[str, Any]] = []
    try:
        for index, (staged, live) in enumerate(pairs):
            backup = backup_root / str(index)
            state = {"live": live, "backup": backup, "had_old": live.exists(), "installed": False}
            states.append(state)
            if state["had_old"]:
                os.replace(live, backup)
            os.replace(staged, live)
            state["installed"] = True
            if after_install is not None:
                after_install(index, live)
    except Exception as exc:
        rollback_errors: list[str] = []
        for state in reversed(states):
            live, backup = state["live"], state["backup"]
            try:
                if state["installed"] and live.exists():
                    shutil.rmtree(live)
                if backup.exists():
                    os.replace(backup, live)
                elif not state["had_old"] and live.exists():
                    shutil.rmtree(live)
            except Exception as rollback_exc:  # keep attempting to restore the other output root
                rollback_errors.append(f"{live}: {rollback_exc}")
        if rollback_errors:
            raise PublicationError(
                f"publication failed ({exc}); rollback also failed: {'; '.join(rollback_errors)}; "
                f"recovery backup retained at {backup_root}"
            ) from exc
        shutil.rmtree(backup_root, ignore_errors=True)
        raise PublicationError(f"publication failed and previous outputs were restored: {exc}") from exc
    else:
        shutil.rmtree(backup_root, ignore_errors=True)


def validate_asset_references(
    targets: list[dict[str, Any]],
    sites: list[dict[str, Any]],
    evidence: dict[str, Any],
    *,
    staged_data: Path,
    staged_img: Path,
) -> None:
    """Reject missing or path-escaping assets referenced by the staged JSON."""
    def check(path_value: Any, root: Path, expected_prefix: str, label: str, *, optional: bool) -> None:
        if path_value is None or path_value == "":
            if optional:
                return
            raise PublicationError(f"required {label} asset path is empty")
        if not isinstance(path_value, str) or not path_value.startswith(expected_prefix):
            raise PublicationError(f"invalid {label} asset path: {path_value!r}")
        relative = Path(path_value[len(expected_prefix):])
        if "\\" in path_value:
            raise PublicationError(f"invalid {label} asset path: {path_value!r}")
        if relative.is_absolute() or ".." in relative.parts:
            raise PublicationError(f"invalid {label} asset path: {path_value!r}")
        asset = root / relative
        try:
            asset.resolve().relative_to(root.resolve())
        except ValueError as exc:
            raise PublicationError(f"{label} asset path escapes public output: {path_value}") from exc
        if not asset.is_file():
            raise PublicationError(f"referenced {label} asset is missing from staged output: {path_value}")

    for entry in (*targets, *sites):
        identity = entry.get("id", "<unknown>")
        check(entry.get("hillshade"), staged_img, "img/", f"{identity} hillshade", optional=True)
        check(entry.get("relief"), staged_data, "data/", f"{identity} relief", optional=True)
    for index, image in enumerate(evidence.get("ours", {}).get("images", [])):
        if isinstance(image, dict):
            check(image.get("src"), staged_img, "img/", f"evidence image {index}", optional=False)


def validate_unique_ids(targets: list[dict[str, Any]], sites: list[dict[str, Any]]) -> None:
    """Reject duplicates before converting IDs to a set for manifest comparison."""
    ids = [entry.get("id") for entry in (*targets, *sites)]
    duplicates = sorted({identifier for identifier in ids if ids.count(identifier) > 1}, key=str)
    if duplicates:
        raise PublicationError(f"duplicate app output ids: {', '.join(map(str, duplicates))}")


def validate_output_shapes(targets: list[dict[str, Any]], sites: list[dict[str, Any]]) -> None:
    """Check that entries retain the current app contract's required top-level fields."""
    required = {
        "target": {"id", "name", "lat", "lon", "note", "body", "params", "windows",
                   "low_sun_share", "hillshade", "relief"},
        "site": {"id", "name", "lat", "lon", "why", "elev_m", "params", "windows",
                 "conditions", "depth_evidence", "known_analog", "flags", "hillshade", "relief"},
    }
    for kind, entries in (("target", targets), ("site", sites)):
        for entry in entries:
            missing = sorted(required[kind] - entry.keys())
            if missing:
                raise PublicationError(
                    f"{kind} {entry.get('id', '<unknown>')} is missing required fields: {', '.join(missing)}"
                )


def validate_finite_json_tree(root: Path) -> None:
    """Parse every staged JSON file and reject invalid constants/non-finite values."""
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-standard JSON number {value}")

    def check(value: Any, path: str) -> None:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"non-finite number at {path}")
        if isinstance(value, dict):
            for key, child in value.items():
                check(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                check(child, f"{path}[{index}]")

    for path in sorted(root.rglob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)
            check(value, str(path))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            raise PublicationError(f"invalid staged JSON {path}: {exc}") from exc


def selftest() -> int:
    """Small synthetic checks for fail-closed input and staged publication behavior."""
    import json

    with tempfile.TemporaryDirectory(prefix="earth-analog-publication-test-") as temporary:
        root = Path(temporary)
        candidates_path = root / "candidates.json"
        assert load_candidates(candidates_path, reference_only=True) == []
        try:
            load_candidates(candidates_path)
        except PublicationError:
            pass
        else:
            raise AssertionError("missing candidate file was accepted")

        candidates_path.write_text("{broken", encoding="utf-8")
        try:
            load_candidates(candidates_path)
        except PublicationError:
            pass
        else:
            raise AssertionError("corrupt candidate JSON was accepted")

        candidates_path.write_text('{"candidates": []}', encoding="utf-8")
        try:
            load_candidates(candidates_path)
        except PublicationError:
            pass
        else:
            raise AssertionError("empty candidate array was accepted by default")

        candidate = {"id": "cand_test_1", "known_analog": False}
        candidates_path.write_text(json.dumps({"candidates": [candidate]}), encoding="utf-8")
        assert load_candidates(candidates_path) == [candidate]
        candidates_path.write_text(json.dumps({"candidates": [candidate, candidate]}), encoding="utf-8")
        try:
            load_candidates(candidates_path)
        except PublicationError:
            pass
        else:
            raise AssertionError("duplicate candidate ids were accepted")
        candidates_path.write_text(
            json.dumps({"candidates": [{"id": "not-candidate", "known_analog": True}]}), encoding="utf-8",
        )
        try:
            load_candidates(candidates_path)
        except PublicationError:
            pass
        else:
            raise AssertionError("known analogue was accepted as scan candidate")

        try:
            validate_unique_ids([{"id": "target"}], [{"id": "site"}, {"id": "site"}])
        except PublicationError:
            pass
        else:
            raise AssertionError("duplicate final app ids were accepted")

        try:
            validate_output_shapes([], [{"id": "incomplete"}])
        except PublicationError:
            pass
        else:
            raise AssertionError("incomplete site output was accepted")

        data_dir, img_dir = root / "public" / "data", root / "public" / "img"
        data_dir.mkdir(parents=True)
        img_dir.mkdir(parents=True)
        (data_dir / "old.json").write_text("{}", encoding="utf-8")
        (img_dir / "old.png").write_bytes(b"old image")
        before_data = {p.relative_to(data_dir).as_posix(): p.read_bytes() for p in data_dir.rglob("*") if p.is_file()}
        before_img = {p.relative_to(img_dir).as_posix(): p.read_bytes() for p in img_dir.rglob("*") if p.is_file()}
        with staged_public_dirs(data_dir, img_dir, root=root) as (staged_data, staged_img):
            (staged_data / "data").mkdir(exist_ok=True)
            try:
                validate_asset_references(
                    [{"id": "target", "hillshade": "img/missing.png", "relief": None}], [], {},
                    staged_data=staged_data, staged_img=staged_img,
                )
            except PublicationError:
                pass
            else:
                raise AssertionError("missing staged asset was accepted")
            assert {p.relative_to(data_dir).as_posix(): p.read_bytes() for p in data_dir.rglob("*") if p.is_file()} == before_data
            assert {p.relative_to(img_dir).as_posix(): p.read_bytes() for p in img_dir.rglob("*") if p.is_file()} == before_img

            try:
                validate_asset_references(
                    [{"id": "target", "hillshade": "img/../data/old.json", "relief": None}], [], {},
                    staged_data=staged_data, staged_img=staged_img,
                )
            except PublicationError:
                pass
            else:
                raise AssertionError("asset path traversal was accepted")

            (staged_img / "new.png").write_bytes(b"new image")
            (staged_data / "relief").mkdir(exist_ok=True)
            (staged_data / "relief" / "new.json").write_text('{"id": "new"}', encoding="utf-8")
            validate_asset_references(
                [{"id": "target", "hillshade": "img/new.png", "relief": "data/relief/new.json"}],
                [], {"ours": {"images": []}}, staged_data=staged_data, staged_img=staged_img,
            )
            validate_finite_json_tree(staged_data)
            bad_json = staged_data / "bad.json"
            bad_json.write_text('{"value": NaN}', encoding="utf-8")
            try:
                validate_finite_json_tree(staged_data)
            except PublicationError:
                pass
            else:
                raise AssertionError("non-finite staged JSON was accepted")
            bad_json.unlink()

            def fail_after_first_install(index: int, _path: Path) -> None:
                if index == 0:
                    raise OSError("injected failure after data directory install")

            try:
                publish_staged_dirs(
                    staged_data, staged_img, data_dir, img_dir, after_install=fail_after_first_install,
                )
            except PublicationError:
                pass
            else:
                raise AssertionError("injected publication failure was not reported")

            after_data = {p.relative_to(data_dir).as_posix(): p.read_bytes() for p in data_dir.rglob("*") if p.is_file()}
            after_img = {p.relative_to(img_dir).as_posix(): p.read_bytes() for p in img_dir.rglob("*") if p.is_file()}
            assert after_data == before_data, "data output was not restored after failed publication"
            assert after_img == before_img, "image output was not preserved after failed publication"

        staged_data, staged_img = root / "stage-data", root / "stage-img"
        staged_data.mkdir()
        staged_img.mkdir()
        (staged_data / "new.json").write_text('{"result": "new data"}', encoding="utf-8")
        (staged_img / "new.png").write_bytes(b"new image")
        publish_staged_dirs(staged_data, staged_img, data_dir, img_dir)
        assert json.loads((data_dir / "new.json").read_text(encoding="utf-8")) == {"result": "new data"}
        assert (img_dir / "new.png").read_bytes() == b"new image"

    print("selftest: PASS (candidate intent, malformed/empty/duplicate inputs, staged asset checks, rollback and successful publish)")
    return 0
