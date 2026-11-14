# References

Datasets, cited results, models, and software directly used by the pipeline and app.
NASA indicates whether the item is a NASA source, not whether NASA funded the work.

| Name | Owner | What we use it for | Link | Licence if stated | NASA |
|---|---|---|---|---|---|
| LOLA LDEM 85S 20 m float DEM | NASA Goddard Space Flight Center, LOLA Team | Lunar elevation for Shackleton and the Malapert search area | [PDS Geosciences Node product directory](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/) | not stated | yes |
| SRTM 1 arc-second (Skadi tiles) | NASA / USGS; tiles served by the AWS elevation-tiles mirror | Earth elevation for sites between 60°S and 60°N | [AWS Skadi tile example](https://s3.amazonaws.com/elevation-tiles-prod/skadi/N37/N37E014.hgt.gz) | not stated | yes |
| Copernicus DEM GLO-30 | Copernicus DEM programme / ESA | Approved substitute for the four high-latitude Earth sites | [AWS Copernicus DEM GLO-30 archive](https://copernicus-dem-30m.s3.amazonaws.com/) | not stated | no |
| Mars 2020 TRN CTX DTM Mosaic | Fergason et al.; USGS Astrogeology Science Center; NASA MRO CTX source imagery | Jezero crater terrain windows and display relief | [USGS DOI 10.5066/P906QQT8](https://doi.org/10.5066/P906QQT8) | CC0 | yes |
| Etna-LRNT dataset | Original owner not identified in the cited source; result reported by LuMon authors | Cited Etna depth-from-image result | [LuMon, Table 2](https://arxiv.org/abs/2604.09352) | not stated | no |
| Etna-S3LI dataset | DLR S3LI project | Cited Etna depth-from-image result | [DLR S3LI dataset page](https://datasets.arches-projekt.de/s3li_dataset/) | CC BY-NC-SA 4.0 | no |
| Chang'e-3 benchmark data | LuMon authors (Table 2 result; original mission-data owner not stated in the cited source) | Cited lunar depth-from-image result | [LuMon, Table 2](https://arxiv.org/abs/2604.09352) | not stated | no |
| CHERI dataset | LuMon authors (Table 2 result) | Cited lunar-analog depth-from-image result | [LuMon, Table 2](https://arxiv.org/abs/2604.09352) | not stated | no |
| LuMon paper | A. Sekmen et al. | Source of the four cited `delta1` rows shown in the evidence panel | [arXiv:2604.09352](https://arxiv.org/abs/2604.09352) | arXiv perpetual non-exclusive license | no |
| Depth Anything V2 model | Lihe Yang et al.; official project repository | Model named for the LuMon Table 2 values; this app does not run the model | [Official project and paper](https://github.com/DepthAnything/Depth-Anything-V2) | cited checkpoint variant not specified; repository lists variant-specific terms | no |
| Matplotlib | Matplotlib Development Team | Render grayscale hillshade PNGs from available elevation windows | [PyPI](https://pypi.org/project/matplotlib/) | Python Software Foundation License | no |
| NumPy | NumPy Developers | Terrain arrays, validity masks, and finite-value operations | [PyPI](https://pypi.org/project/numpy/) | BSD-3-Clause; bundled components have additional notices | no |
| pandas | pandas Development Team | Generate hourly UTC timestamps for the solar-position calculation | [PyPI](https://pypi.org/project/pandas/) | BSD-3-Clause | no |
| pvlib | pvlib-python community | Compute hourly solar positions for Earth sites | [pvlib-python repository](https://github.com/pvlib/pvlib-python) | BSD-3-Clause | no |
| PyYAML | YAML and Python communities | Read the authoritative terrain windows and app weights from YAML | [PyYAML repository](https://github.com/yaml/pyyaml) | MIT | no |
| Rasterio | Rasterio maintainers | Read source DEMs and reproject/resample terrain windows | [Rasterio documentation](https://rasterio.readthedocs.io/) | BSD-3-Clause | no |
| SciPy | SciPy Developers | Sample processed elevation arrays onto the relief-grid output | [SciPy repository](https://github.com/scipy/scipy) | BSD-3-Clause | no |
| React | React team | App component rendering and state | [React repository](https://github.com/react/react) | MIT | no |
| React DOM | React team | Mount the app in the browser DOM | [React repository](https://github.com/react/react) | MIT | no |
| Three.js | Three.js contributors | Render the split 3D terrain scenes | [Three.js repository](https://github.com/mrdoob/three.js) | MIT | no |
| `@types/node` | DefinitelyTyped contributors | Type declarations for the Vite configuration | [DefinitelyTyped `node` declarations](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) | MIT | no |
| `@types/react` | DefinitelyTyped contributors | Type declarations for React components | [DefinitelyTyped `react` declarations](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) | MIT | no |
| `@types/react-dom` | DefinitelyTyped contributors | Type declarations for React DOM mounting | [DefinitelyTyped `react-dom` declarations](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) | MIT | no |
| `@types/three` | DefinitelyTyped contributors | Type declarations for Three.js scene rendering | [DefinitelyTyped `three` declarations](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three) | MIT | no |
| `@vitejs/plugin-react` | Vite team | React transform used by the Vite configuration | [Plugin repository](https://github.com/vitejs/vite-plugin-react) | MIT | no |
| TypeScript | Microsoft | Type-check and compile the frontend | [TypeScript repository](https://github.com/microsoft/TypeScript) | Apache-2.0 | no |
| Vite | Vite team | Frontend development server and production build | [Vite repository](https://github.com/vitejs/vite) | MIT | no |
| Vitest | Vitest contributors | Run frontend unit tests | [Vitest repository](https://github.com/vitest-dev/vitest) | MIT | no |

## P1 input metadata and provenance

- **LOLA:** The downloaded PDS3 label identifies `PC_REAL`, 32-bit samples, 15,168 × 15,168, 20 m/pixel, values in kilometres relative to a 1,737.4 km sphere, and a spherical south-polar stereographic projection true at the pole. The projection offsets are 7583.5 in PDS 1-based sample/line coordinates. The label does not specify a nodata code; the pipeline marks non-finite samples invalid. Used for `shackleton_rim` and the data-driven `malapert` search. Coordinates in `config/sites.json` remain unconfirmed.
- **SRTM:** The 12 downloaded `.hgt` tiles are EPSG:4326, signed 16-bit, 3601 × 3601, with 1-arc-second steps and nodata `-32768`; elevations are metres. Used for the eight Earth sites at or below 60° absolute latitude. The AWS archive is a public tile mirror; source attribution remains NASA SRTM.
- **Copernicus DEM GLO-30:** The four used COGs are EPSG:4326 float32. Their longitude/latitude pixel steps vary by tile (longitude 2–3 arc-seconds, latitude 1 arc-second); the GeoTIFF nodata tag is absent. Masked reads are preserved, then each window is resampled to the common 30 m metric grid. Used for Askja, Haughton, McMurdo Dry Valleys, and Svalbard under the user's approved fallback. Their manifest coordinates remain unconfirmed.
- All lunar and Earth windows use the issue's common local metric grid at 30 m. Source strings in `results/terrain.json` record native and resampled spacing.

## P3 evidence and display assets

- **LuMon Table 2:** cited depth-from-image `delta1` values required by issue #4: Etna-LRNT 1.00, Etna-S3LI 0.88, Chang'e-3 0.95, and CHERI 0.32. Source: A. Sekmen et al., *LuMon: A Comprehensive Benchmark and Development Suite with Novel Datasets for Lunar Monocular Depth Estimation*, arXiv:2604.09352, Table 2 ([arXiv](https://arxiv.org/abs/2604.09352)). These are cited evidence, not project-computed metrics.
- **Hillshade rendering:** display-only grayscale images are generated from each available 12 km elevation window on the shared 30 m grid using Matplotlib `LightSource` (azimuth 315°, altitude 45°, vertical exaggeration 1). This is a cartographic rendering choice, not an analysis or scoring input. The Jezero image uses the Mars 2020 TRN CTX DTM row above.

## P4 Jezero input metadata

- The downloaded single-band GeoTIFF is float32, 1596 × 1512, with 20 m projected pixel spacing and nodata `-3.4028226550889045e+38`. Its source CRS is equirectangular (`+proj=eqc`, true-scale latitude 0°) with the source-encoded spherical radius 3,396,190 m. USGS catalog metadata states vertical coordinate units are metres. The local Azimuthal Equidistant analysis grid uses the same radius and 30 m cells; nodata is not filled.
