# Shasta Land Atlas

## License

Copyright 2026 Aaron Sullivan. This project is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). Commercial use is not
permitted. This is source-available software, not Open Source Initiative
(OSI)-approved open-source software.

Static GitHub Pages map combining the two `~/suite/bin/shasta_*land*` workflows:

- Siskiyou MLS private land, farm, home, and commercial-for-sale listings, plus residential and commercial sold history. Sold records are mapped only when a parcel match is verified; unmatched sold listings are omitted. Listings from other MLS systems are not covered by this feed.
- Siskiyou County tax-sale PDF records
- Siskiyou County parcel polygons and attributes
- Esri satellite imagery

## Local use

```sh
npm install
npm run refresh
npm run dev
```

`npm run dev` starts Vite at `http://127.0.0.1:3100` with hot reload.
For a production build and local preview:

```sh
npm run build
npm start
```

Vite writes the production site to `build/`.

## Data model

GitHub Pages cannot run server code and the upstream sites do not consistently allow browser CORS requests. `npm run refresh` therefore performs the JavaScript ingestion at build time and writes `data/parcels.json`. The browser remains entirely static and provides map interaction, filters, search, hover details, and click details.

Private listings without MLS coordinates cannot be assigned an APN automatically and are omitted from the parcel map. Public records remain visible as historical records and are marked `EXPIRED` once their advertised closing date passes.

Every refresh snapshots mapped MLS listings in `data/mls-listing-archive.json`. Once a listing no longer appears in the active MLS feed, it remains available under **Previously listed**, with the first refresh date on which it disappeared. That date means only that the public feed stopped advertising it—not necessarily that it sold or was withdrawn.

California Outdoor Properties listings in `data/external-listings.json` are separate from the MLS feed. The refresh checks their individual pages for the dealer's sold image badge and shows confirmed sales as previous listings without inventing a sale price or date. When the dealer blocks automated requests or the page has no conclusive status badge, the saved status is retained and a warning is logged; review those warnings and update the saved status manually when necessary. An entry with `referenceListing: true` links to a different parcel's page and skips automatic status detection; replace it with the parcel's own URL and remove that flag when published.

## Data refresh

To refresh the county parcel outlines (independently of the daily sales-data refresh):

```sh
npm run refresh:parcel-boundaries
npm run build # or npm run deploy to publish
```

This downloads the current Siskiyou County parcel GIS into `data/raw/parcels.geojson`, updates `data/generated/apn-index.json`, and rebuilds `data/generated/parcels.pmtiles`. Commit the updated data files and deploy to make the new boundaries visible to visitors. Requires `tippecanoe` and the `pmtiles` CLI. It does not refresh listing geometry in `data/parcels.json`; run `npm run refresh` separately if those listing footprints also need updating. The `Refresh parcel boundaries` GitHub Actions workflow runs monthly on the 3rd at 15:00 UTC (or manually from Actions) and only rebuilds, commits, and deploys when the downloaded county parcel data changes.

Run the sales-data refresh independently when needed:

```sh
npm run refresh
```

The `Refresh sales data` GitHub Actions workflow is scheduled daily at 12:17 UTC (4:17 AM PST / 5:17 AM PDT) and can be started manually from the Actions tab. GitHub may delay scheduled runs. It commits updated files under `data/` to the default branch, then builds and deploys the refreshed site to `gh-pages`.

The countywide tax-delinquency crawl runs on the 1st of each month at 16:00 UTC. It checkpoints and continues across workflow runs until complete; continuation dispatch requires `TAX_CRAWL_DISPATCH_TOKEN`. The separate tax refresh runs Tuesdays and Fridays at 18:00 UTC, rechecks crawl-discovered APNs against the County's current tax system, commits `data/siskiyou-tax-delinquent.json`, and deploys. Both workflows can also be started manually from Actions. GitHub scheduled runs may start late.

### Utility service and hookup evidence

Use **Utility service & hookup evidence** in the map sidebar to toggle independent overlays. Alt/Option-click a shaded area to inspect it without changing the selected parcel. Zoom in and click a mapped meter or sewer line for its source. When you select a parcel, **Mapped utilities** automatically compares the county parcel polygon with the local snapshot; a parcel that straddles a boundary can match multiple records. This lookup does not require the overlays to be visible. Meter and line matches appear before provider areas. Expand **Coverage and limits** for unmatched records and source limitations.

| Evidence | Source and coverage | What it does not show |
| --- | --- | --- |
| Electric territory | CEC [IOU/POU territories](https://www.arcgis.com/home/item.html?id=30410214d637434ba1003cbdcc32cf55) and [other territories](https://www.arcgis.com/home/item.html?id=07224640a2fe42f89399be796e7b8810) filtered to co-op/tribal providers, excluding CCA and administrative polygons. Siskiyou-area extract; electric polygons are generalized. | Local distribution facilities, meter, active hookup, or approved service. Transmission lines are not distribution hookup evidence. |
| Drinking-water service area | California Water Boards [SABL](https://www.arcgis.com/home/item.html?id=fbba842bf134497c9d611ad506ec48cc) records for active systems, including unverified boundaries flagged as such. | Private wells, a main at the frontage, capacity, or connection approval. |
| Public sewer district | [CSDA / FEMA Region 9 district boundaries](https://www.arcgis.com/home/item.html?id=35bc7aa8625b421a8e4d6e0287504eda) for Lake Shastina, McCloud and Tennant, corroborated by the [County General Plan background report](https://siskiyou2050.com/images/docs/SKYGP_BR_FULL_2024-05-07-RL-Reduced.pdf), PFSI-3–6. | Actual sewer service areas, municipal coverage, or all county sewer providers. Happy Camp is omitted because the source polygon is meter-sized. City limits and water service areas are not used as sewer proxies. |
| Mapped sewer lines | [Siskiyou County GIS inventory](https://www.arcgis.com/home/item.html?id=70d03b743c904077be50fda6897e5150), Fort Jones only. The Yreka sewer map's operational layers require authentication. | Parcel laterals, current condition, capacity, or active hookup. |
| Mapped potable-water meters | [City of Yreka public meter inventory](https://www.arcgis.com/home/item.html?id=7c87c5ba3f2d423d91e2620f40581fad), potable meters not marked retired. Published snapshot omits customer, address, and contact fields. | A verified parcel assignment, live account, operability, or new-service approval. A meter may sit on a parcel boundary or in a right-of-way. |

A match is screening evidence, not a service determination; no match is not evidence of unavailable service. Verify existing service and get written new-service eligibility, cost, and capacity from the provider. Refresh the committed snapshot with `npm run refresh:utilities`; the downloader validates counts/IDs and only replaces the snapshot after all feeds succeed. Test geometry and snapshot integrity with `npm run test:utilities`.

### Refreshable map layers

The following downloaded GIS layers can change upstream. Their identifiers are the arguments to `npm run layers:download -- <names>` and `npm run layers:build -- <names>`:

| Map data | Layer identifiers | Automatic refresh |
| --- | --- | --- |
| County parcel boundaries | `parcels` | Monthly parcel-boundaries workflow |
| County and municipal zoning | `zoning`, `municipal_zoning` | None |
| Roads, forest roads, railroads, and bridge locations | `roads`, `forest_roads`, `railroads`, `bridges` | None |
| Electric transmission lines and power plants | `transmission_lines`, `power_plants` | None |
| Utility evidence (service areas, districts, lines, meters) | `data/utility-evidence.geojson` | None; `npm run refresh:utilities` |
| FAA charted IFR routes (not actual traffic) | `ifr_routes` | None |
| Fatal motor-vehicle crash locations (2015–2024) | `data/fatal-traffic-crashes.geojson` | None; `npm run refresh:fatal-traffic-crashes` after checking annual release status |
| Dams (national inventory) | `dams` | None |
| **Recorded landslides and debris flows (points and footprints)** | **`landslides`, `landslide_footprints`** | **None** |
| Rivers, lakes, springs, summits, towns, and incorporated places | `waterways`, `waterbodies`, `springs`, `summits`, `towns`, `incorporated_places` | None |
| Surface geology and fire hazard | `geology`, `fire_hazard` | None |
| Historic and recent wildfire perimeters | `wildfire_perimeters`, `recent_wildfire_perimeters` | None |
| Federal public land and FEMA flood zones | `public_land`, `flood` | None |
| Soils, septic screening geometry, farmland, and hazardous-waste handlers | `soils`, `farmland`, `rcra_sites` | Septic screening also uses a separately refreshed USDA tabular snapshot |
| Watersheds and wetlands | `huc12`, `wetlands` | None (wetlands displayed from a live USFWS WMS, not the downloaded copy) |
| Final and proposed critical habitat | `critical_habitat_final`, `critical_habitat_proposed` | None (the proposed map layer is currently empty) |
| Cellular coverage and Pacific Crest Trail | `cell_att`, `cell_tmobile`, `cell_verizon`, `pct`, `pct_markers` | None |
| Groundwater basins and reported wells | `groundwater_basins`, `groundwater_wells` | None |
| Groundwater monitoring stations and history | `data/groundwater-monitoring.geojson`, `data/groundwater-monitoring-history.json` | None; `python3 scripts/refresh-groundwater-monitoring.py` |

**Reported wells** uses the [DWR Well Completion Reports](https://data.cnra.ca.gov/dataset/well-completion-reports) ArcGIS index for Siskiyou County (10,836 reports in this refresh). The cards distinguish drilled from completed depth and show available dates, perforations, casing, drilling method, test details, and original PDF links. Map colors use completed depth, falling back to drilled depth when needed. The one-mile summaries use mapped report points, include all report types (not unique wells), and omit blank/non-numeric values from statistics. Many locations are section centroids; verify fields against the original report. Refresh with `npm run layers:download -- groundwater_wells && npm run layers:build -- groundwater_wells`.

**Groundwater monitoring history** uses DWR's [Periodic Groundwater Level Measurements](https://data.cnra.ca.gov/dataset/periodic-groundwater-level-measurements) stations, perforations and readings, plus [Continuous Groundwater Level Measurements](https://data.cnra.ca.gov/dataset/continuous-groundwater-level-measurements) stations and monthly means. The snapshot has 236 mapped Siskiyou stations, 223 with usable depth readings, from a periodic archive extracted 2026-11-25. Click an amber station for depth-below-ground charts and a station CSV. Periodic, automated readings from the periodic archive, and monthly means are separate series; their records may overlap. Entries without usable depths are omitted; remaining quality flags are retained. Continuous daily/hourly archives, USGS-only stations, water quality, and unreported or unlocated records are not included. Completion cards link to stations only by the report reference published by DWR (current or legacy ID), never by proximity. The public source feeds are downloaded at refresh time, not queried by the browser, and no reading implies today's water level or conditions at another parcel.

To refresh the federal land overlay, run `npm run layers:download -- public_land` and then `npm run layers:build -- public_land`. The PAD-US downloader uses ArcGIS ring geometry (rather than its flattened GeoJSON response) to preserve private inholding holes before tile generation. This layer is screening data, not proof of title.

For the repeatable PDF-to-parcel workflow—including curve calculations, alignment, validation, and lessons from Castle Oaks—see [Survey reconstruction guide](SURVEY_RECONSTRUCTION_GUIDE.md).

The app bundles seven **Castle Oaks road-aligned survey drafts** in `assets/map/default-drawings.js`. On each browser/origin, missing default IDs are seeded once into Draw; existing edits, names, and hidden states are preserved. The one narrowly scoped correction described below only upgrades the exact unedited Parcel 7 export. A separate delivered-ID ledger remembers deletions. **Draw → ☰ → Restore missing defaults** restores deleted bundled shapes without resetting surviving edits, and **Zoom to shown drawings** locates them without moving the map on startup. The main sidebar reset changes display preferences, not drawing geometry or deletion history. If browser storage is unavailable, defaults still appear in memory, but local changes cannot persist. These are shared starting drawings, **not cross-device synchronization**: later edits stay on that device. New devices receive them once the updated app is deployed; no private Desktop path, import bookmark, or login is required. The known 1.41-ft C12 closure gap remains flagged; these are not verified legal boundaries. Keep seed IDs stable; changing existing seed geometry does not override local copies. New IDs are delivered on a future load.

Final survey review found and corrected a missing section 32/33 corner in Parcel 7’s exported north boundary. Its 1,723.46-ft and 1,268.62-ft courses now meet at their recorded bearing change rather than being joined as one straight line (previous maximum deviation about 6.12 ft). Computed area is now 42.0123 acres versus the printed 42.02. On load, only the exact prior five-vertex Parcel 7 is repaired, after saving a backup under `shasta-land-atlas.polygon-drawings.v1.backup.survey-north-bend-v2`; renamed/hidden state is retained. User-modified geometry is not overwritten. This is a specific export-error correction, not automatic replacement of seed revisions.

The **Draw → ☰** manager includes **Show measurements**, saved across reloads, and **Reset display to defaults** (also reset by the main sidebar reset). Road-aligned Castle Oaks drafts show one recorded radius/arc-length label per recognized curve instead of hundreds of chord labels. Shared labels are deduplicated and avoid overlap; intermediate curve vertices stay hidden until **Edit curve vertices** is selected in the manager or a curve-label popup. **Done editing curves** returns to the clean view. These are display-only changes: polygon coordinates are untouched. Curve metadata is tied to coordinate fingerprints; editing a curve invalidates its recorded label rather than displaying stale survey values. Arbitrary polygons retain their normal straight-edge labels.

The **Road distance** map control measures the shortest connected path along currently loaded `roads` and `forest_roads` map lines: click once for the start and once for the end. It snaps each click to a mapped road, draws the traced line, and reports feet and miles. Drag either endpoint to update the path and distance; × clears the result. Zoom out enough to load the whole route before placing the first point. This is an approximate map-line measurement, **not driving directions**: missing roads, tile seams, overpasses, and crossings without shared vertices can prevent a route, and access restrictions or one-way rules are not modeled.

The **Public webcams** toggle (Infrastructure & access, off by default) shows Siskiyou County Caltrans road cameras in blue and ALERTCalifornia lookout cameras in gold. Click a site for updating still images, manual refresh, full-size imagery, and the original source; co-located cameras from the same provider share a marker and camera selector. Only the selected camera loads images. Automatic refresh pauses in hidden tabs and stops on popup close or layer disable. The layer preference persists across reloads; **Reset all controls** restores its unchecked markup default and clears the saved preference. Images can be stale or unavailable: check the provider timestamp within the frame, not the browser's image-received time. These are not continuous video, emergency alerts, or proof of road conditions.

Refresh the small committed location inventory with `npm run refresh:webcams`, review `data/webcams.geojson`, and commit/deploy it. The initial inventory contains 25 Caltrans cameras and 38 ALERTCalifornia cameras at 45 provider sites. Inventory refresh is manual; imagery is requested directly from providers while the viewer is open. Caltrans reports still-image intervals in minutes (currently 5–60); ALERTCalifornia is polled every 30 seconds. Provider status in the inventory is a snapshot, not a live health check. No images are archived by this app. The refresh validates both feeds and atomically replaces the inventory only after both succeed.

Sources: [Caltrans District 2 CCTV](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm), subject to [Caltrans conditions](https://dot.ca.gov/conditions-of-use); [ALERTCalifornia | UC San Diego](https://alertcalifornia.org/), [CC BY-NC-ND 4.0 / noncommercial use](https://alertcalifornia.org/terms/). Preserve full image frames, black information bars, partner logos, and visible ALERTCalifornia credit. Commercial use requires separate permission. ALERTCalifornia's public image endpoints worked in browser testing but are not a documented/stable embed API; source-viewer links remain available if they change.

The **community-mapped surveillance** toggle displays a snapshot of all OpenStreetMap nodes tagged `man_made=surveillance` in a bounding box around Siskiyou, not only license-plate readers. The current snapshot has eight nodes: six cameras, one ALPR tagged Flock Safety, and one gunshot detector. Colors distinguish types; clicking a point links to its OSM record. These are community reports, not verified current installations or a complete camera inventory. The snapshot is © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); preserve that attribution and license when redistributing `data/surveillance.geojson`. Refresh with `npm run refresh:surveillance` (QLever spatial search and OSM node API), review points and types—especially new records near the bounding-box edges that may be outside Siskiyou—and commit the GeoJSON. The browser uses the committed snapshot rather than contacting third-party query servers on page load.

The **fatal traffic crash** toggle uses [NHTSA FARS annual CSV archives](https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/FARS/) for Siskiyou County (2015–2024, 125 mapped crashes; 2024 initial and earlier years final). FARS archives extend back to 1975, but older geocoded locations and decades-old road conditions are less useful for current land decisions. A point represents one crash, even when multiple people died; missing/invalid coordinates are excluded. The crash point is not necessarily the place of death and can be approximate or revised. Fatal incidents alone cannot rank intersections without traffic volume and other crash/severity data; a blank stretch is not evidence of safety. Refresh with `npm run refresh:fatal-traffic-crashes` (Node.js; cached ZIPs in `.cache/fars/`). After checking the new year's release notes and CSV fields, update `LAST_YEAR` and release labels in `scripts/refresh-fatal-traffic-crashes.js`, rerun, and commit the GeoJSON. Do not confuse preliminary and final releases.

The **USDA soil overlay** uses existing SSURGO map-unit polygons joined by `mukey` to the largest-percentage component and its shallowest representative classified horizon. A single toggle shows subtly colored exact texture classes; the legend lists Sand, Silt, and Clay beneath each texture. Tapping a location highlights the matched texture and its three rows and fills those rows with the selected map unit’s reported percentages, or “Not reported” when unavailable. Selecting a parcel keeps its usual details while updating the soil legend; tapping soil outside a parcel shows soil details. Refresh with `npm run layers:download -- soils && npm run layers:build -- soils`; to re-enrich existing polygons, run `node scripts/enrich-soils.js && npm run layers:build -- soils`. SSURGO map units can contain multiple soils: more attribute detail does **not** mean finer surveyed boundaries or parcel soil tests. Source: [USDA NRCS Soil Data Access](https://sdmdataaccess.nrcs.usda.gov/).

The **Septic soil screening (USDA)** toggle colors the existing SSURGO soil polygons by the [NRCS Septic Tank Absorption Fields interpretation](https://websoilsurvey.nrcs.usda.gov/). Click a mapped unit for its rating, the estimated share of the unit carrying that rating, and documented reasons such as slow water movement, slope, or depth to bedrock. The lookup was retrieved November 26, 2026 from [USDA Soil Data Access](https://sdmdataaccess.nrcs.usda.gov/): 1,549 rated and 27 unrated map units in the Siskiyou-area soil envelope, not counts of parcels. The map groups rated component percentages by class, takes the class with the greatest total (more limiting class wins ties), and lists positive-score NRCS reasons for components in that class. This is a local dominant-condition summary; different aggregation settings, soil survey updates, or site conditions can produce different results. Gray includes both unrated units and keys not matched to the snapshot. “Not limited” does not establish suitability, a successful perc test, or a permit. The toggle is off by default and follows the existing saved-layer and reset behavior. Run `npm run refresh:septic-screening` (Node.js and curl), then `npm run test:septic-screening`; commit the refreshed `assets/data/septic-screening.json`. No tile rebuild is needed for tabular-only updates.

**Siskiyou County septic permit history** is not mapped. The County’s [Individual Sewage Disposal program](https://www.siskiyoucounty.gov/environmentalhealth/page/individual-sewage-disposal) verifies its role in review, permitting, and inspections; its [Property Information Inquiry Form](https://www.siskiyoucounty.gov/sites/default/files/fileattachments/environmental_health/page/1361/property_information_inquiry_form.pdf) asks for the APN and has a Septic checkbox. No public APN-searchable septic register or bulk GIS permit feed was verified through the county program, permit pages, or public GIS catalog. Parcel details show the selected APN and link to the form, not a claim that County files are empty. Ask Environmental Health for the original record and any final inspection; old records may be incomplete or filed under an earlier APN.

The separate **LANDFIRE 2025 Existing Vegetation Type** raster comes from the [USGS/USFS CONUS image service](https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2025/LF2025_EVT_CONUS/ImageServer); its scrollable legend uses the official class names and RGB colors from the [LANDFIRE attribute table](https://www.landfire.gov/vegetation/evt). Tap the map or select a parcel to highlight its class. Some distinct ecological systems share colors, so color alone is not an identifier. Regenerate the lookup with `node scripts/download-vegetation-legend.js`. Modelled ecological communities are not observed species; LANDFIRE cautions against interpreting individual 30 m pixels as parcel-level evidence. Both datasets are U.S. government public data; cite the source and version.

For example, refresh the newly added infrastructure/history layers without rebuilding unrelated datasets:

```sh
npm run layers:download -- bridges power_plants transmission_lines ifr_routes dams landslides landslide_footprints
npm run layers:build -- bridges power_plants transmission_lines ifr_routes dams landslides landslide_footprints
npm run build # or npm run deploy to publish
```

Commit the changed `data/raw/*.geojson`, `data/generated/*.pmtiles`, and `data/generated/sources.json` to retain them across deployments. Both `layers:download` and `layers:build` **without arguments** operate on every configured layer; this can take a long time and fail if an upstream service is unavailable. Downloads are not atomic, and `npm run build`, `npm run deploy`, `npm run refresh`, and the scheduled sales/tax workflows do **not** refresh these GIS archives. The browser instead fetches land cover from USGS/MRLC, wetlands from the USFWS WMS, and satellite imagery from Esri at viewing time; those are not refreshed by these commands. Requires `tippecanoe` and the `pmtiles` CLI to rebuild tiles.

### Evidence-backed APN research

Use the persistent research queue for unresolved land listings:

```sh
npm run research -- sync
npm run research -- list
npm run research -- candidates <MLS>
npm run research -- show <MLS>
```

Candidate generation uses the MLS point only to create a review set; it never maps a listing. Add source-linked evidence with `research evidence`, select a candidate, explicitly rule out competing candidates, then run `research assess`. `research resolve` is blocked unless every APN is verified in county GIS and the independent-evidence and ambiguity gates pass. Run `npm run research -- help` for all commands. Research state is stored in `data/apn-research.json` and survives later syncs.

For bulk research, split the current unmapped listings into non-overlapping review batches. Check public broker flyers and alternate syndications for APNs and parcel counts. Compare numbered parcel maps, lot dimensions, official address points, or road access against county GIS rather than relying on approximate listing pins. An “Additional Parcels” field may omit the primary APN; verify the complete parcel set before applying an override. Record unresolved leads and acreage discrepancies so later reviews can pick up where you left off. Have one reviewer apply verified overrides to avoid concurrent writes.

### Listing-image parcel research

For a lot-only MLS listing, download all public IDX photos—including plats and assessor maps—without relying on the broker page:

```sh
npm run parcel-evidence -- <MLS>
```

Review `.cache/parcel-evidence/<MLS>/`, correlate the numbered lot or printed APN with county GIS, then persist it with `npm run override -- add ...`. The `/parcel-research` skill documents the complete evidence and verification procedure.

### Manual parcel overrides

After identifying a listing's parcel on the map, copy its APN and run:

```sh
npm run override
```

The interactive helper asks for the listing/MLS number (or the full listing URL), APN(s), and notes/address. It accepts identifiers such as `MC26015313`, validates APNs against the county GIS, and safely updates `data/parcel-overrides.json`. For a one-line command:

```sh
npm run override -- add 20261234 021-520-380 --notes "Poplar Court, Weed, CA 96094"
```

Multiple parcels can be comma-separated. The helper immediately patches `data/parcels.json` using only the selected county parcel geometry, so a full `npm run refresh` is not required; reload an already-open map to see it. A later refresh will reproduce the same mapping from `data/parcel-overrides.json`. Use `--no-map-patch` to save only the override, or `npm run override -- help` for list, show, remove, and replacement commands.

### Persistent MLS parcel links

Each refresh writes trusted programmatic and manual MLS-to-APN matches to `data/mls-apn-links.json`. Active and sold MLS feeds join through the MLS number, with precedence given to manual overrides, then explicit listing APNs, then the persisted linkage. This lets sold history reuse previously established parcel matches instead of repeating or weakening the match.

## Future data acquisition

The current ingestion uses brokers’ public website search endpoints, not direct MLS credentials. Their available feeds can change; public accessibility does not itself grant permission to republish the data.

Explore a direct data license with the **Siskiyou Association of REALTORS®**:

- **Email:** [siskiyouaor@gmail.com](mailto:siskiyouaor@gmail.com)
- **Phone:** [530-926-5083](tel:+15309265083)
- **Website:** [siskiyouaor.com](https://www.siskiyouaor.com/)

Their [2026 MLS rules](https://www.siskiyouaor.com/wp-content/uploads/2026/02/2026-MLS-Rules-adopted-Jan-22-2026.pdf) provide feeds to participants or their designated vendors for licensed uses (§11.14), protect MLS access with passcodes (§12.12), and allow third-party licensing agreements (§12.20). No anonymous direct API was identified in the published documentation.

Ask whether this project qualifies for a third-party agreement without brokerage membership, and confirm fees, API/feed availability, listing and sold-history coverage, refresh limits, and permitted display, archival, photo, and redistribution uses. Eligibility and terms have not yet been confirmed with the association.

## Deployment

```sh
npm run release
```

This validates the existing data, builds `build/`, and publishes through `gh-pages`; it does not refresh or commit sales data. Configure the repository's Pages deployment to use the `gh-pages` branch.
