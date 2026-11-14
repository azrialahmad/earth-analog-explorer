# References

Terrain datasets used by P1 (#2). The library and other product references will
be added as their corresponding pipeline and app work lands.

| Name | Owner | What we use it for | Link | Licence if stated | NASA |
|---|---|---|---|---|---|
| LOLA LDEM 85S 20 m float DEM | NASA Goddard Space Flight Center, LOLA Team | Lunar elevation for Shackleton and the Malapert search area | [PDS Geosciences Node product directory](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/) | not stated | yes |
| SRTM 1 arc-second (Skadi tiles) | NASA / USGS; tiles served by the AWS elevation-tiles mirror | Earth elevation for sites between 60°S and 60°N | [AWS Skadi tile archive](https://s3.amazonaws.com/elevation-tiles-prod/skadi/) | not stated | yes |
| Copernicus DEM GLO-30 | Copernicus DEM programme / ESA | Approved substitute for the four high-latitude Earth sites | [AWS Copernicus DEM GLO-30 archive](https://copernicus-dem-30m.s3.amazonaws.com/) | not stated | no |

## P1 input metadata and provenance

- **LOLA:** The downloaded PDS3 label identifies `PC_REAL`, 32-bit samples, 15,168 × 15,168, 20 m/pixel, values in kilometres relative to a 1,737.4 km sphere, and a spherical south-polar stereographic projection true at the pole. The projection offsets are 7583.5 in PDS 1-based sample/line coordinates. The label does not specify a nodata code; the pipeline marks non-finite samples invalid. Used for `shackleton_rim` and the data-driven `malapert` search. Coordinates in `config/sites.json` remain unconfirmed.
- **SRTM:** The 12 downloaded `.hgt` tiles are EPSG:4326, signed 16-bit, 3601 × 3601, with 1-arc-second steps and nodata `-32768`; elevations are metres. Used for the eight Earth sites at or below 60° absolute latitude. The AWS archive is a public tile mirror; source attribution remains NASA SRTM.
- **Copernicus DEM GLO-30:** The four used COGs are EPSG:4326 float32. Their longitude/latitude pixel steps vary by tile (longitude 2–3 arc-seconds, latitude 1 arc-second); the GeoTIFF nodata tag is absent. Masked reads are preserved, then each window is resampled to the common 30 m metric grid. Used for Askja, Haughton, McMurdo Dry Valleys, and Svalbard under the user's approved fallback. Their manifest coordinates remain unconfirmed.
- All lunar and Earth windows use the issue's common local metric grid at 30 m. Source strings in `results/terrain.json` record native and resampled spacing.

## P3 evidence and display assets

- **LuMon Table 2:** cited depth-from-image `delta1` values required by issue #4: Etna-LRNT 1.00, Etna-S3LI 0.88, Chang'e-3 0.95, and CHERI 0.32. Source: A. Sekmen et al., *LuMon: A Comprehensive Benchmark and Development Suite with Novel Datasets for Lunar Monocular Depth Estimation*, arXiv:2604.09352, Table 2 ([arXiv](https://arxiv.org/abs/2604.09352)). These are cited evidence, not project-computed metrics.
- **Hillshade rendering:** display-only grayscale images are generated from each available 12 km elevation window on the shared 30 m grid using Matplotlib `LightSource` (azimuth 315°, altitude 45°, vertical exaggeration 1). This is a cartographic rendering choice, not an analysis or scoring input. Jezero has no elevation input in P3, so no image is fabricated for it.
