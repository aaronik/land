# Finding a Property APN from a Land Listing

## Goal

Identify and **verify** the county Assessor's Parcel Number (APN) for a land listing when the listing itself may not display it.

## Reliable workflow

### 1. Extract identifying facts from the listing

Capture all information that can distinguish the parcel:

- Street address / road name and city
- Lot number (for example, `Lot 1`)
- Acreage
- MLS number
- Price, broker, and listing description
- Nearby landmarks, access road, subdivision, or cross street
- Listing-map location, if available

Land listings often use a non-address such as `0 Road Name` or `Lot 1`; that is not enough by itself to identify an APN.

### 2. Find an alternate copy of the listing

Listing aggregators may block automated access, but the same MLS listing is often syndicated elsewhere. Search for:

```text
"MLS_NUMBER"
"Lot 1 Road Name" "City"
"Road Name" "acreage" "City"
```

Useful alternate sources include the listing broker's site, Redfin, Realtor.com, Zillow, Land.com/LandSearch/LandWatch, Homes.com, and Google/DuckDuckGo indexed snippets.

The broker site is often best: it can expose the full description, photographs, and more precise location cues.

### 3. Use the county's authoritative parcel GIS

Find the county Assessor or GIS page. Look for a public parcel viewer, ArcGIS map, open-data portal, or ParcelQuest link. The county GIS is the source of truth for APN geometry and recorded acreage.

For Siskiyou County, use:

- GIS / map viewer: https://experience.arcgis.com/experience/c9a297953b9745198a47ac596aacece6
- Assessor parcel lookup information: https://www.siskiyoucounty.gov/assessor-recorder/page/assessors-office-parcel-values-and-maps-online

The GIS parcel layer can be queried by location and returns fields such as `APN`, `Acres`, and assessment number.

### 4. Match the listing to a parcel using multiple signals

Do **not** select an APN solely because its acreage matches. Match at least two or three independent facts:

1. **Location:** parcel lies on/adjacent to the named road or the listing-map pin.
2. **Acreage:** county acreage closely matches the listing acreage. Small rounding differences are normal.
3. **Context:** parcel matches a stated landmark or relationship, e.g. “across from Mt. Shasta Resort,” “near Bunny Flat,” or adjacent to a trailhead.
4. **Lot/subdivision layout:** lot number and parcel position are consistent with the subdivision or map.
5. **Parcel count:** if a listing says it includes two parcels, the matched parcels’ acreages should sum to the stated total.

### 5. Validate and report confidence

Before reporting an APN:

- Recheck the parcel polygon against the road / landmark.
- Check whether nearby parcels have the same acreage; common subdivision lots can create ambiguity.
- If the listing’s map pin is approximate, state that the APN is a likely match rather than certain.
- For a purchase, title, entitlement, or legal decision, confirm with the county Assessor and recorded documents.

## What worked in these examples

### Everitt Memorial Hwy listing

- Search results revealed the listing was **154.3 acres across two parcels** and located by Bunny Flat Trailhead.
- Siskiyou County parcel GIS showed adjacent parcels of **77.2** and **77.1** acres.
- Their sum exactly matched 154.3 acres.
- Result: `028-020-210` and `028-020-220`.

### Lot 1 S Old Stage Rd listing

- The listing was identified as **MLS 20250848**, `Lot 1 S Old Stage Rd`, **2.51 acres**.
- An alternate broker listing supplied the key context: it is **across from Mt. Shasta Resort**.
- County GIS was filtered to 2.51-acre parcels around the resort and S Old Stage Rd.
- The APN was selected by combining road-side/location context with the exact 2.51-acre match.
- Result reported: `036-550-011`.

## Common failure modes

- **Listing site is blocked:** use search snippets and alternate syndications; do not attempt to bypass CAPTCHAs.
- **Road name is long:** a county GIS road layer helps map the entire road and narrow the correct segment.
- **Many matching lots:** a parcel map, listing photos, survey, broker confirmation, or the county assessor is needed.
- **Acreage is rounded:** treat acreage as supporting evidence, not proof.
- **APN format varies:** preserve the county display format (e.g. `036-550-011`), while the assessment number may appear without dashes (e.g. `036550011000`).

## Minimal checklist

```text
[ ] Capture address/lot, acreage, MLS, and landmarks
[ ] Find an alternate listing source if the original is blocked
[ ] Open the official county parcel GIS
[ ] Match location + acreage + contextual clue(s)
[ ] Confirm all parcels if the listing includes more than one
[ ] State confidence and recommend assessor/title verification for consequential use
```
