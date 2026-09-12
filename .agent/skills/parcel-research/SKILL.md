---
name: parcel-research
description: Resolve an unmapped Siskiyou MLS listing to its county GIS APN polygon using listing images and assessor/plat evidence.
---

# Parcel research

Given an MLS number, complete the mapping rather than only producing candidates.

1. Refresh current data if needed: `npm run refresh`.
2. Download every accessible IDX photo: `npm run parcel-evidence -- <MLS>`.
3. Inspect `.cache/parcel-evidence/<MLS>/`, especially maps, assessor pages, highlighted plats, legal descriptions, and printed APNs. Do not stop because the listing HTML is blocked—the photo CDN is public.
4. Search the exact MLS, title, unit, lot, and road on syndicated sites. Prefer an explicit APN. Otherwise use a numbered listing/assessor plat.
5. Align the plat to county GIS using road topology, parks/greenbelts, parcel shape, lot acreage, and neighboring parcels. Never select from acreage, approximate coordinates, road name, or APN sequence alone.
6. Verify the APN directly in the county feature service.
7. Persist and immediately add the polygon to the app:

```sh
npm run override -- add <MLS> <APN[,APN]> \
  --source "<listing/map evidence URLs>" \
  --confidence "high; image/assessor evidence reviewed" \
  --notes "<why the numbered lot matches this GIS polygon>"
```

8. Confirm the MLS moved out of `unmappedListings`, appears on the selected APN polygon in `data/parcels.json`, and run `npm test`.

For many listings, partition immutable MLS lists among subagents. Each subagent researches and returns APN + evidence + rationale; the coordinator alone runs `override` to avoid conflicting writes. Reuse a proven subdivision plat for other lots in that same unit.
