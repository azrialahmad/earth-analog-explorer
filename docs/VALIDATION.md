# Proof-of-concept findings

This is a faithful summary of `FINDINGS.md` from the PoC repository, retrieved using the command in Issue #12. The source says its first pass is superseded by its same-day follow-up where the results differ. The figures below are PoC findings, not measurements produced by this app's current pipeline.

## What we tested

- The first vision run used all 168 POLAR Terrain left-camera images and 100 evenly spaced Chang'e-3 image/depth pairs. It compared `depth-anything/Depth-Anything-V2-Small-hf` and `facebook/dinov2-small`; the run took about 3 minutes on the reported GPU.
- The follow-up added POLAR Terrain 11 (222 left images) to Terrain 1 and Chang'e-3, for 490 images total. It added a plane-removed relief-skill measure and compared shadowed with lit pixels.
- Terrain work covered 12 Earth sites and 2 lunar targets. The initial test used 6 km windows resampled to a 30 m grid; the follow-up included 3 km, 6 km, and 12 km windows.
- The PoC used the cited LuMon `delta1` protocol, a separate inverse-depth alignment, a flat-ground baseline, shadow fractions, and DINOv2 embedding distance. Its follow-up compared model error against a fitted ground plane.

## What held

- Terrain scores separated the sites in the PoC: the range was 0.20 to 0.91 against Shackleton rim and 0.37 to 0.91 against Malapert. The two targets ordered sites differently.
- On the first vision run, shadowed pixels scored lower than lit pixels in both datasets: 0.94 vs 1.00 on POLAR and 0.73 vs 0.80 on Chang'e-3.
- In the follow-up, shadowed pixels had worse error relative to the flat-ground baseline than lit pixels on sun-on POLAR images; shadow was the worse of the two in 78% of those images.
- In the follow-up terrain table, Askja had a Malapert terrain match of 0.91 and a low-sun share of 0.36; the PoC reported no mismatch warning for that pair.

## What did not hold

- In the first vision run, pooled Spearman correlation was +0.06 (p = 0.35) for shadow fraction against `delta1`, and −0.04 (p = 0.50) for DINOv2 kNN distance against `delta1`.
- The flat-ground fit scored `delta1` 1.00 on POLAR and 0.94 on Chang'e-3, matching or exceeding the model on those mostly flat scenes. At the 5% tolerance, the model scored 0.48 (POLAR) and 0.25 (Chang'e-3), versus 0.98 and 0.63 for the plane.
- In the follow-up, median relief skill was −0.86 on POLAR Terrain 11 sun-on images and +0.05 on Chang'e-3. Only 0.6% of Terrain 11 sun-on images beat the plane, compared with 55% of Chang'e-3 images.
- The first-run within-POLAR DINOv2 correlation was attributed to camera-position effects; only 3 viewpoints were present in one terrain. The source reports that the within-sun-on correlation was +0.72 (p < 0.001), while its interpretation cautions against treating it as a general relation.
- Etna data extraction time was not measured: the DLR S3LI source requires a form, and no Etna-LRNT source was found in the PoC research.

## What we do not know

- The PoC used one POLAR terrain of twelve and 3 viewpoints; its 168 images were not independent. Its authors identify Terrain 11 as a fairer relief test.
- The shadow mask depended on the PoC's conversion of POLAR frames from linear 12-bit to 8-bit with a 2.2 gamma and no auto-exposure.
- The PoC notes that Chang'e-3 `masks/` files are shadow masks, not validity masks; its validity mask was finite depth between 0 and 25 m.
- The PoC's approximate Earth test-area coordinates, Svalbard's fjord position, and the intended Shackleton and Malapert target windows still needed a human choice or confirmation in that report.
- Etna extraction time and access to the data remained unknown; the PoC reports that the source makes S3LI available after a form and states CC BY-NC-SA 4.0, while Etna-LRNT's source was not found.
- The PoC explicitly says its POLAR result cannot stand in for CHERI as evidence about polar lighting, and it did not reproduce the cited CHERI result.

## New candidate scan (issue #48)

These figures come from this app's own pipeline (`uv run pipeline/scan.py`), not from the PoC. Settings are in the `scan:` section of `config/weights.yaml`. The extra regions are listed in `config/scan_regions.json`.

- **Scanned:** 40 DEM tiles: the 17 around the known sites, plus 23 downloaded for 11 new regions (Afar, Lut, Qaidam, Tibesti, Haruj, Harrat Khaybar, Puna de Atacama, southern Altiplano, Pilbara, Holuhraun, Axel Heiberg). That gave 8,686 window centres on a 6 km grid.
- **Dropped:** 1,563 below sea level, 225 water-like (too flat), 130 close to a known site, 0 with DEM gaps. That left 6,768 usable windows.
- **Kept:** 18 candidates after the WorldCover bare-ground and land checks, at most 2 per region. 10 are in new regions (Afar, southern Altiplano ×2, Axel Heiberg, Harrat Khaybar ×2, Puna ×2, Qaidam ×2, Tibesti). 8 are within 100 km of a known site and are named after it (Askja ×2, Haughton, Mauna Kea ×2, Atacama Yungay ×2). One of those is the Holuhraun area, south of Askja. Haruj and Pilbara gave no candidate.
- **Ranks with default weights (30 sites):**
  - Shackleton rim: southern Altiplano candidate 1 is first (0.87), and the best known site is third.
  - Malapert: Atacama Yungay area candidate 1 is first (0.92), and the best known site is third.
  - Jezero: the top five are all candidates (0.97 to 0.99), led by Qaidam basin candidate 1, and the best known site is sixth.

What this does not show:

- The candidates are terrain and land-cover matches only. Nobody has checked them on imagery, in the field, or for access and permits.
- The regions were chosen by the agent, not found by searching all of Earth. Other good regions were not scanned.
- The Skadi SRTM mirror fills the sea with bathymetry. The scan drops windows with more than 2% of cells below 0 m and keeps only windows that are at least 90% land in WorldCover. The Antarctic tile has no WorldCover data, so it cannot yield a candidate.
- Terrain Match compares slope and roughness at 30 m. It says nothing about grain size, rock type, temperature or radiation.
