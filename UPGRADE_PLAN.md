# Siskiyou County Land Buyer Map — Upgrade Plan

## Objective

Upgrade the existing Siskiyou land-sale and tax-auction scouts into an interactive land-buyer map inspired by Land id, while using official public data wherever possible and clearly identifying inferred, incomplete, or commercially licensed information.

The first release should focus on Siskiyou County rather than attempting nationwide coverage.

## Current foundation

The repository already contains two useful data pipelines:

- `~/suite/bin/shasta_private_land_sales.py`
  - Fetches all pages of the Mt. Shasta Realty Siskiyou County IDX search.
  - Filters to land/farm listings and a configurable minimum acreage.
  - Uses each MLS coordinate to perform a point-in-polygon query against the county parcel service and infer an APN.
- `~/suite/bin/shasta_land_auctions.py`
  - Extracts APNs and sale details from Siskiyou County tax-sale documents.
  - Joins auction APNs to county parcel geometry and attributes.
  - Can query nearby parcels and generate parcel-boundary links.

These scripts are a suitable ingestion foundation, but listing-to-parcel matching needs an explicit confidence model because MLS map coordinates can be approximate and a listing can contain multiple parcels.

## Validated public data

### 1. Siskiyou parcel boundaries

Official service:

```text
https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0
```

Validated characteristics:

- 53,720 parcel polygons.
- Every current feature has an APN.
- 14,377 parcels are at least 20 acres.
- Public, unauthenticated ArcGIS queries.
- Browser CORS is enabled.
- GeoJSON and paginated queries work.
- Maximum geometry response is approximately 2,000 features per query.
- County metadata describes the layer as intended for public distribution.

Useful fields include:

- `APN`
- `Asmt` — an assessment identifier, **not an assessed dollar value**
- `Acres`
- `LandUse1`
- `FeeParcel`
- `TRA`
- `NeighborhoodCode`
- `Section`, `Township`, `Range`
- `TimberPreserve`, `AgPreserve`

The service does not include ownership or assessed-value information. Boundaries are for screening and must not be represented as a survey or legal boundary determination.

### 2. Zoning

The `Zoning1` field in the parcel service is effectively unusable: it is blank for all but a few current records. Zoning must be spatially joined from the separate official layer:

```text
https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/CDD_Zoning_Districts_Public/FeatureServer/0
```

Validated characteristics:

- 3,391 polygons.
- Fields: `zoning`, `zoneclass`.

Zoning should be shown with a source date, links to county planning/code resources, and a warning that overlays, permitted uses, setbacks, subdivision potential, legal nonconforming status, and buildability require confirmation. Incorporated cities may maintain separate zoning authority.

### 3. Roads

Official county road service:

```text
https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Roads_Public/FeatureServer/0
```

Validated characteristics:

- 4,498 road features.
- Fields include road name, surface type, lane count, and label category.

Mapped road proximity must never be described as proof of legal access. A parcel may border a mapped road without having a legal entrance or recorded easement.

### 4. Fire hazard

Official county service:

```text
https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/FireHazardSeverity_Public/FeatureServer/0
```

Validated characteristics:

- 3,821 polygons.
- Fields include hazard code, hazard class, and responsibility area.

This supports parcel-level fire-hazard screening, but not an insurance quote or guarantee of insurability.

### 5. Public land

Use the USGS PAD-US Federal Fee Managers authoritative layer for the green public-land overlay:

```text
https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Federal_Fee_Managers_Authoritative_PADUS/FeatureServer/0
```

Validated around Mt. Shasta:

- Shasta National Forest
- Klamath National Forest
- BLM Redding Field Office

Use fee ownership rather than broad administrative or designation boundaries. Management boundaries can overlap private inholdings and must not be presented as ownership.

For agency-specific due diligence, supplement PAD-US with current USFS and BLM services.

### 6. Imagery, terrain, and environmental layers

The following official services were live and accessible during validation:

- NAIP imagery:
  `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer`
- USGS 3DEP elevation:
  `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`
- USGS topo:
  `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer`
- FEMA National Flood Hazard Layer:
  `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`
- USFWS National Wetlands Inventory:
  `https://www.fws.gov/wetlandsmapservice/rest/services/Wetlands/MapServer`
- USDA NRCS soils/SSURGO:
  `https://sdmdataaccess.nrcs.usda.gov/`

Potential buyer-facing information includes:

- Aerial imagery and acquisition year.
- 3D terrain, hillshade, elevation, slope, and aspect.
- FEMA flood zones.
- Mapped wetlands.
- Soil drainage, hydric rating, restrictive depth, farmland class, erosion risk, and septic limitations.

Each environmental layer needs its source disclaimer. In particular, NWI is not a regulatory wetland delineation, soil data is survey-scale rather than site engineering, and map overlays are not official buildability determinations.

## Information not available in the public parcel service

The official county parcel layer intentionally excludes:

- Owner name and mailing address.
- Assessed land and improvement values.
- Property taxes.
- Deed and sale history.
- Mortgage and lien information.

These require a separately licensed source, a county data agreement, or individual research through an authorized service.

Potential commercial providers include ParcelQuest, Regrid, ATTOM, PropertyRadar, and RentCast. Coverage and correctness should be tested against a representative set of rural, vacant, agricultural, urban, and multi-parcel Siskiyou properties before selecting one.

## ParcelQuest Lite assisted workflow

### Constraints discovered

Siskiyou County links to ParcelQuest Lite for individual APN/address and assessment research. It is not a bulk public API.

Known constraints include:

- Approximately 50 searches per month and 25 parcel maps per month under Lite usage.
- Intended for individual research, not high-volume retrieval.
- Proprietary content and restrictions on republication/resale.
- Session cookies and anti-forgery state.
- `X-Frame-Options: SAMEORIGIN`, preventing embedding in our site.
- No cross-origin access header, preventing JavaScript on our site from directly fetching and reading ParcelQuest pages.

Consequently, a normal web button cannot silently fetch ParcelQuest into our page or cache its response in browser storage. Browser same-origin security blocks that design, and bypassing it through our server would create both terms-of-use and data-licensing concerns.

### Recommended compliant UX

Add a **Research in ParcelQuest Lite** button to every parcel detail panel.

On first use, show a warning such as:

> ParcelQuest Lite is a separate third-party research service with limited monthly searches/maps. Its information is not part of this map and may not be republished. Continue to ParcelQuest and verify the parcel yourself.

Behavior:

1. Open ParcelQuest Lite in a new tab rather than an iframe.
2. Display the selected APN beside the button with a one-click copy action.
3. Keep an in-browser research log containing only our own metadata:
   - APN researched.
   - Date/time opened.
   - User-entered notes.
   - Optional user-entered owner/value observations marked private and unverified.
4. Store that log in `localStorage` or IndexedDB on the user's device.
5. Provide **Clear private research data** and export/import controls.
6. Do not upload these notes to a server by default.
7. Do not claim to track ParcelQuest's authoritative remaining quota; at most show a local estimate based on buttons pressed in this browser.

A useful detail-panel flow would be:

- `Open ParcelQuest Lite`
- `Copy APN`
- `Mark researched`
- `Add private note`
- `Last researched locally: …`
- `Estimated opens from this browser this month: N / 50`

The estimate must say that searches performed elsewhere, failed searches, and ParcelQuest's own accounting are not visible to us.

### Future enhanced integration

Only implement automatic owner/value retrieval if one of these becomes available:

- A documented ParcelQuest API and an agreement permitting the intended display/cache behavior.
- A licensed county bulk assessor roll.
- A commercial data agreement permitting customer-facing display, caching, and derived analysis.

A browser extension or bookmarklet could technically operate on ParcelQuest's own origin after explicit user action, but it should not be developed without confirming ParcelQuest's terms and obtaining permission. It is not part of the initial plan.

## Listing-to-parcel matching model

The MLS feed does not expose an APN. Current matching uses the MLS coordinate and selects the county polygon containing it.

A live sample produced APNs for 9 of 10 listings, but also demonstrated these failure cases:

- A 277-acre listing point landed in a 90.9-acre parcel, suggesting a multi-parcel sale.
- A road-position marker matched a right-of-way APN.
- A 30.6-acre listing landed in a 236-acre parcel.
- One listing had no usable Siskiyou parcel match.

The map must preserve this uncertainty.

Recommended status values:

- `provided` — APN came from a reliable listing/source document.
- `coordinate_match` — MLS coordinate lies inside this parcel.
- `probable` — coordinate match and GIS acreage are reasonably consistent.
- `possible_multi_parcel` — listing acreage materially exceeds the matched parcel.
- `ambiguous` — acreage is inconsistent or marker appears approximate.
- `unmatched` — no parcel was found.

Display language should use **Possible parcel** rather than **Parcel** for inferred matches.

Potential matching improvements:

1. Compare MLS acreage with county acreage.
2. Search adjacent parcels when listing acreage is larger than the point-matched parcel.
3. Group contiguous parcels and test combinations near the advertised acreage.
4. Detect right-of-way and zero-acre records and downgrade confidence.
5. Preserve all candidates and the reason for the chosen confidence level.
6. Allow a user to correct or attach multiple APNs locally.

## Proposed architecture

### Front end

- MapLibre GL JS.
- Satellite, topo, and street basemaps.
- 2D/3D toggle.
- Clickable parcel vector layer.
- Layer controls for public land, zoning, fire, flood, wetlands, soils, roads, listings, and auctions.
- Parcel detail drawer with provenance and warnings.
- URL-addressable map state and selected APN.

### Data preparation

A 15-mile Mt. Shasta-area viewport contains roughly 16,478 parcels, so loading raw countywide GeoJSON on every pan is not appropriate.

Recommended process:

1. Paginate all 53,720 county parcels from ArcGIS.
2. Normalize geometry to WGS84.
3. Preserve official APN and attribute values without inventing missing fields.
4. Generate vector tiles or a PMTiles archive.
5. Publish version and retrieval metadata.
6. Refresh on a scheduled basis and retain the previous successful snapshot.

Smaller layers can initially be queried from their official ArcGIS services, but production should cache/version important layers to prevent third-party downtime from breaking the map.

### Application API/data products

Suggested generated artifacts:

```text
data/generated/parcels.pmtiles
data/generated/public_land.pmtiles
data/generated/zoning.pmtiles
data/generated/fire_hazard.pmtiles
data/generated/listings.json
data/generated/auctions.json
data/generated/sources.json
```

`sources.json` should record, per layer:

- Source organization and URL.
- ArcGIS item/service/layer ID.
- Retrieval timestamp.
- Dataset version or source edit date.
- License/terms URL and required attribution.
- Known limitations and disclaimer.
- Feature count and build completeness.

Data builds should fail rather than publish partial parcel snapshots when pagination or feature counts do not reconcile.

## MVP user experience

### Map

- Start centered near Mt. Shasta.
- Parcel outlines appear at an appropriate zoom level.
- Federal/public land is shaded green.
- Active private listings and tax-auction properties use distinct markers.
- Selecting a listing highlights its candidate parcel or parcels.
- 3D mode drapes parcels and overlays over terrain.

### Search and filters

- APN search.
- Address/place search.
- Minimum and maximum acreage.
- Distance from Mt. Shasta or a chosen point.
- Listed / auction / not currently listed.
- Public-land adjacency.
- Zoning class.
- Fire hazard class.
- Flood/wetland intersection.
- Road proximity, carefully labeled as mapped-road proximity rather than legal access.

### Parcel details

Show:

- APN and GIS acreage.
- Land-use code.
- Spatially joined zoning.
- Section/township/range.
- Public-land adjacency.
- Fire, flood, wetlands, terrain, and soil summaries.
- Active listing/auction information where applicable.
- Matching confidence and evidence.
- Official-source links.
- ParcelQuest-assisted research controls.

Always show a compact screening disclaimer and expandable per-layer provenance.

## Implementation phases

### Phase 1 — Data build and basic map

- Add a repeatable parcel downloader with count reconciliation and tests.
- Produce a local vector-tile/PMTiles artifact.
- Create a MapLibre page with parcel selection.
- Add existing private listing and auction feeds.
- Add APN search and source metadata.

### Phase 2 — Buyer context

- Add PAD-US public land.
- Add county zoning, roads, and fire hazard.
- Add topo/aerial basemaps.
- Add listing-to-parcel confidence classification.
- Add ParcelQuest Lite external research workflow and local notes.

### Phase 3 — Due-diligence overlays

- Add FEMA flood, NWI wetlands, and SSURGO soils.
- Add terrain-derived elevation, slope, and aspect summaries.
- Add public-land adjacency and mapped-road proximity analysis.
- Add 3D terrain.

### Phase 4 — Licensed assessor data, optional

- Evaluate commercial providers against known Siskiyou samples.
- Obtain explicit customer-facing display/cache/redistribution rights.
- Add owner, assessment, tax, and transaction fields only after licensing.

## Validation requirements

For each data build:

- Reconcile downloaded parcel count with the API-advertised count.
- Verify no APNs were dropped or unintentionally duplicated.
- Test pagination beyond the first 2,000 records.
- Validate representative urban, rural, vacant, agricultural, right-of-way, and multi-parcel records.
- Confirm geometry output is WGS84 before mapping.
- Record source edit/retrieval dates.

For listing joins:

- Include tests for exact coordinate matches.
- Include tests for missing coordinates.
- Include tests for right-of-way matches.
- Include tests for advertised acreage larger/smaller than GIS acreage.
- Include tests for multiple candidate parcels.

For the web application:

- Test parcel selection in 2D and 3D.
- Test large viewport and zoom performance.
- Test source failures and stale cached data behavior.
- Verify every layer has attribution and an appropriate warning.
- Verify ParcelQuest is opened externally and no prohibited cross-origin proxying occurs.
- Verify local research notes can be cleared and are not transmitted unintentionally.

## Legal and product guardrails

- Do not copy Land id's private APIs, tiles, styles, or saved-map data.
- Do not scrape or proxy ParcelQuest Lite.
- Do not expose MLS/IDX data beyond applicable display terms.
- Do not represent tax parcel geometry as surveyed boundaries.
- Do not represent mapped roads as legal access.
- Do not represent zoning or environmental overlays as buildability approval.
- Do not imply government endorsement.
- Keep attribution, version, and limitation metadata for every layer.
- Review state, county, nonprofit, and commercial terms individually; they are not automatically public domain merely because the data is publicly viewable.

## Recommended next step

Implement Phase 1 as a narrow vertical slice:

1. Download and validate all official parcel polygons.
2. Generate a parcel PMTiles archive.
3. Build a MapLibre page with aerial/topo choices.
4. Select/search parcels by APN.
5. Overlay current private listings and auctions with matching-confidence labels.
6. Add the external ParcelQuest research button, local usage estimate, and private browser notes.

This yields a genuinely useful Siskiyou land-buyer map without waiting for owner/value licensing, while preserving a clean path to add licensed assessor data later.
