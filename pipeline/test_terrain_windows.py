"""Synthetic square-footprint regression for terrain.build_row (#57).

Run: uv run python -m unittest discover -s pipeline -p 'test_terrain_windows.py'
Also called by terrain.py --selftest so the existing CI executes it.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

import terrain


class SquareWindowTests(unittest.TestCase):
    def check_windows(self, sizes):
        largest = max(sizes)
        n_max = terrain.window_cells(largest)
        side = n_max + 2 * terrain.BUFFER_CELLS
        row, col = np.indices((side, side))
        # Curved and asymmetric so retaining the outer columns changes metrics.
        z = (row * row + col * col * col / side).astype("float64")
        valid = np.ones_like(z, dtype=bool)
        center = slice(terrain.BUFFER_CELLS, side - terrain.BUFFER_CELLS)
        calls = []

        def loader(km):
            calls.append(km)
            return z, valid, center

        slope, rough = terrain.slope_and_roughness(z)
        summarize = terrain.summarize
        shapes = []

        def recording_summary(window, mask, slopes, roughness):
            shapes.append(window.shape)
            self.assertEqual(window.shape, mask.shape)
            self.assertEqual(window.shape, slopes.shape)
            self.assertEqual(window.shape, roughness.shape)
            return summarize(window, mask, slopes, roughness)

        with patch.object(terrain, "summarize", recording_summary):
            actual = terrain.build_row({"id": "synthetic"}, "synthetic", terrain.WORK_RES_M, sizes, loader)
        self.assertEqual(calls, [largest])
        expected_shapes = [(terrain.window_cells(km),) * 2 for km in sizes]
        # Main-summary fallback performs an additional largest-square summary.
        if 6 not in sizes:
            expected_shapes.append((n_max, n_max))
        self.assertEqual(shapes, expected_shapes, "a window must crop BOTH raster axes and exclude its buffer")
        expectations = {}
        for km in sizes:
            n = terrain.window_cells(km)
            start = terrain.BUFFER_CELLS + (n_max - n) // 2
            box = (slice(start, start + n), slice(start, start + n))
            expected = summarize(z[box], valid[box], slope[box], rough[box])
            expectations[km] = expected
            self.assertEqual(expected["cells"], n * n)
            self.assertEqual(actual["windows"][str(int(km))], {
                key: expected[key] for key in ("slope_mean_deg", "slope_p90_deg", "roughness_m")
            })
        main = expectations[6 if 6 in sizes else largest]
        self.assertEqual(actual["elev_m"], main["mean_elev_m"])
        self.assertEqual(actual["flat_share"], main["flat_share"])

    def test_configured_square_windows(self):
        self.check_windows(terrain.load_window_sizes())

    def test_largest_summary_fallback_is_square(self):
        self.check_windows([max(terrain.load_window_sizes())])

    def test_nodata_outside_small_window_cannot_change_its_summary(self):
        sizes = terrain.load_window_sizes()
        n = terrain.window_cells(max(sizes))
        side = n + 2 * terrain.BUFFER_CELLS
        z = np.full((side, side), 100.0)
        valid = np.ones_like(z, dtype=bool)
        # Entire columns outside the smallest square are missing. They must not
        # contribute cells or make the small-square statistics incomplete.
        small_n = terrain.window_cells(min(sizes))
        # NaN columns stop BUFFER_CELLS before the small square, preserving its
        # slope and roughness neighborhoods.
        left = (n - small_n) // 2
        z[:, :left] = np.nan
        valid[:, :left] = False
        center = slice(terrain.BUFFER_CELLS, side - terrain.BUFFER_CELLS)
        summarize = terrain.summarize
        counts = []

        def capture(*args):
            result = summarize(*args)
            counts.append(result["cells"])
            return result

        with patch.object(terrain, "summarize", capture):
            actual = terrain.build_row({"id": "nodata"}, "synthetic", terrain.WORK_RES_M,
                                       sizes, lambda km: (z, valid, center))
        self.assertEqual(counts[0], small_n * small_n)
        first = actual["windows"][str(int(min(sizes)))]
        self.assertEqual(first["slope_mean_deg"], 0.0)

    def test_absent_source_stays_missing(self):
        sizes = terrain.load_window_sizes()
        actual = terrain.build_row({"id": "missing"}, None, None, sizes, lambda km: (None, None, None))
        self.assertIsNone(actual["elev_m"])
        self.assertIsNone(actual["flat_share"])
        self.assertTrue(all(value is None for row in actual["windows"].values() for value in row.values()))


def run_selftests():
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(SquareWindowTests))
    if not result.wasSuccessful():
        raise AssertionError("square-window regressions failed")


if __name__ == "__main__":
    unittest.main()
