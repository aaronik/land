# Shasta Land Atlas

## License

Copyright 2026 Aaron Sullivan. This project is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). Commercial use is not
permitted. This is source-available software, not Open Source Initiative
(OSI)-approved open-source software.

Static GitHub Pages map combining the two `~/suite/bin/shasta_*land*` workflows:

- Siskiyou MLS private land/farm listings
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

Every refresh snapshots mapped MLS listings in `data/mls-listing-archive.json`. Once a listing no longer appears in the active MLS feed, it remains available under **Previously listed (sold)**, with the first refresh date on which it disappeared. That date means only that the public feed stopped advertising it—not necessarily that it sold or was withdrawn.

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

The `Refresh sales data` GitHub Actions workflow also runs daily at 12:00 UTC (4 AM PST / 5 AM PDT) and can be started manually from the Actions tab. It commits updated files under `data/` to the default branch, then builds and deploys the refreshed site to `gh-pages`.

The countywide tax-delinquency crawl runs on the 1st of each month at 16:00 UTC. It checkpoints and continues across workflow runs until complete; continuation dispatch requires `TAX_CRAWL_DISPATCH_TOKEN`. The separate tax refresh runs Tuesdays and Fridays at 18:00 UTC, rechecks crawl-discovered APNs against the County's current tax system, commits `data/siskiyou-tax-delinquent.json`, and deploys. Both workflows can also be started manually from Actions. GitHub scheduled runs may start late.

### Refreshable map layers

The following downloaded GIS layers can change upstream. Their identifiers are the arguments to `npm run layers:download -- <names>` and `npm run layers:build -- <names>`:

| Map data | Layer identifiers | Automatic refresh |
| --- | --- | --- |
| County parcel boundaries | `parcels` | Monthly parcel-boundaries workflow |
| County and municipal zoning | `zoning`, `municipal_zoning` | None |
| Roads, forest roads, and railroads | `roads`, `forest_roads`, `railroads` | None |
| Electric transmission lines | `transmission_lines` | None |
| Dams (national inventory) | `dams` | None |
| **Recorded landslides and debris flows** | **`landslides`** | **None** |
| Rivers, lakes, springs, summits, towns, and incorporated places | `waterways`, `waterbodies`, `springs`, `summits`, `towns`, `incorporated_places` | None |
| Surface geology and fire hazard | `geology`, `fire_hazard` | None |
| Historic and recent wildfire perimeters | `wildfire_perimeters`, `recent_wildfire_perimeters` | None |
| Federal public land and FEMA flood zones | `public_land`, `flood` | None |
| Soils, farmland, and hazardous-waste handlers | `soils`, `farmland`, `rcra_sites` | None |
| Watersheds and wetlands | `huc12`, `wetlands` | None (wetlands displayed from a live USFWS WMS, not the downloaded copy) |
| Final and proposed critical habitat | `critical_habitat_final`, `critical_habitat_proposed` | None (the proposed map layer is currently empty) |
| Cellular coverage and Pacific Crest Trail | `cell_att`, `cell_tmobile`, `cell_verizon`, `pct`, `pct_markers` | None |
| Groundwater basins and reported wells | `groundwater_basins`, `groundwater_wells` | None |

For example, refresh the three newly added infrastructure/history layers without rebuilding unrelated datasets:

```sh
npm run layers:download -- transmission_lines dams landslides
npm run layers:build -- transmission_lines dams landslides
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
