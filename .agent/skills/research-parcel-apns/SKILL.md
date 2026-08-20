---
name: research-parcel-apns
description: Safely research unmapped land listings, inspect listing maps/photos, and resolve only evidence-backed APN links.
---

# Evidence-backed parcel/APN research

## Arguments

```text
/research-parcel-apns [limit]
```

- `limit` is the number of listings to review in this run (integer `1–25`; default: `5`).
- Process exactly up to that many queue items, stopping early only when the remaining items lack viable evidence. Do not exceed the requested limit.

Work one listing at a time. The goal is not to guess the closest parcel: resolve an MLS listing only when its mapping is supported by durable evidence.

## Safety limits

- **Never read, search, print, or diff** `data/raw/`, `data/generated/`, `build/`, `node_modules/`, or any `*.pmtiles` file.
- Do not load `data/parcels.json` wholesale. Use `npm run research -- candidates <MLS>`; it makes a bounded county-GIS request.
- Process no more than the requested `limit` (default `5`, maximum `25`) in one run. Stop early if no listing has strong evidence.
- Do not resolve based only on an approximate MLS point, matching acreage, nearby road name, visual resemblance, or a photo without an unambiguous boundary/map.
- Do not use a listing page's bot/challenge response as evidence. Record it as inaccessible and leave the listing unresolved.

## Preferred route: exact-address property records

Use this route first for listings with a numbered street address. It is more scalable than visual map triangulation and does **not** require listing photos.

1. Search the exact address and MLS number in public indexes:

   ```text
   "<MLS>" "<street address>"
   "<street address>" "<city>" APN
   ```

   Check alternate broker syndications and public property-record pages (for example, Xome) for a property facts section. A search result is only a lead; open the underlying page.
2. Require the property-record page to explicitly state an APN/parcel number and the same normalized street address. Its stated acreage or square footage must agree with the MLS within normal rounding.
3. Verify the APN directly with Siskiyou County GIS and record both sources. If a public record supplies an explicit APN outside the initial geographic candidate set, add it through the GIS-verified path first:

   ```sh
   npm run research -- add-candidate <MLS> <APN>
   ```

   Resolve only after the normal `assess` gates pass.
4. If the listing uses a lot/block description or has no exact situs address, do not infer the APN from an address record. Fall back to photo/plat/map research or leave it unresolved.

Example of sufficient evidence: MLS 20240760 advertised **151 S Dewitt Way, Yreka**, 0.27 acres; a public property-record page explicitly printed parcel **061-021-260-000** for that address and 11,761 sq ft; county GIS independently returned APN **061-021-260**, 0.27 acres.

## Photo and plat route

1. Refresh the queue and choose only unreviewed candidates:

   ```sh
   npm run research -- sync
   npm run research -- list --status open
   npm run research -- show <MLS>
   ```

   Never select `inconclusive` items for a normal rerun; they are a documented terminal outcome. Reopen one only when the user supplies new evidence or explicitly asks to revisit it.

   Prioritize listings whose titles contain lot/block numbers, specific roads, subdivisions, or addresses. Deprioritize ZIP-centroid locations.

2. Generate a **bounded review set**:

   ```sh
   npm run research -- candidates <MLS> --radius 3000
   ```

   This query is only a candidate generator. It does not establish a match. Use a smaller radius when the listing location is precise; do not expand the radius merely to force a result.

3. If the original is blocked, search by MLS ID and exact address for an alternate public listing or property-record page. A public property record that explicitly prints an APN can count as `assessor` evidence only when its displayed address and acreage independently match the MLS listing. Do not treat a search-result snippet, a map pin, or a generic aerial as APN evidence.

4. Review original listing media when available. Look specifically for:

   - survey, plat, assessor, GIS, or aerial image with a boundary;
   - an APN printed in the listing, flyer, photo, caption, or linked document;
   - lot/block/subdivision labels that uniquely connect the pictured boundary to county GIS;
   - named roads, landmarks, and acreage that independently corroborate the boundary.

   Save only the individual, stable photo/document URL (or listing URL if it is the only stable source). Note exactly what it shows. Treat generic aerial photos, unlabeled maps, and screenshots with no parcel identifiers as insufficient.

5. Independently verify every selected APN in county GIS. `candidates` output may be used as the county-GIS evidence. Add it to the queue, then add listing/photo evidence:

   ```sh
   npm run research -- evidence <MLS> --type county_gis \
     --signals acreage,location --source 'Siskiyou County GIS' \
     --url 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query' \
     --apns <APN> --note 'County GIS: <acres>, <section/township/range>; why it matches.'

   npm run research -- evidence <MLS> --type photo \
     --signals boundary_image,road,acreage --url '<PHOTO_OR_DOCUMENT_URL>' \
     --apns <APN> --note 'Photo <number>: boundary/map identifies <APN or unique lot>; visible corroborating details: ...'
   ```

6. If a reviewed listing cannot meet the confidence standard, record the blocker and mark it terminally inconclusive so the next run does not select it again:

   ```sh
   npm run research -- inconclusive <MLS> --note 'Checked <sources>; blocker: <why>; next evidence needed: <what>.'
   ```

   Do not use `inconclusive` for an item that is likely resolvable with a source already in hand.

7. Select only the parcel(s) visibly/evidentially supported. Rule out every competing candidate with source-linked evidence; do not rule out candidates merely because they are farther from an approximate point.

   ```sh
   npm run research -- select <MLS> <APN[,APN]>
   npm run research -- rule-out <MLS> <APN[,APN]> --evidence <evidence-id>
   npm run research -- assess <MLS>
   ```

8. Resolve only if `assess` is ready, then validate:

   ```sh
   npm run research -- resolve <MLS>
   npm run research -- validate
   ```

## Required confidence standard

Resolution requires all of the following:

1. Every selected APN has `county_gis` evidence.
2. Either an explicit APN or an unambiguous parcel-boundary image, **or** at least three corroborating signals from two sources, including location/road/landmark and acreage/lot/subdivision.
3. Every competing GIS candidate is explicitly ruled out with linked evidence.

If any part is missing, leave the item at `needs_evidence` or `candidate`; that is a useful result. Report the listing ID, candidate APNs, what was checked, why it was inconclusive, and the exact next evidence needed.

## Completion report

For each of the 3–5 reviewed listings, state one of:

- **Resolved:** MLS → APN(s), evidence IDs, and short rationale.
- **Inconclusive:** candidate count/APNs, photo/map availability, blocker, and next action.
- **No viable candidate:** why the county-GIS review set did not support a match.

Never claim a mapping was made unless `npm run research -- resolve <MLS>` completed successfully.
