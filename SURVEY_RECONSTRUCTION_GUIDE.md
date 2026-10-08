# Recorded survey map → editable map drawings

A reusable procedure, based on reconstructing the seven Castle Oaks parcels from **Siskiyou County Parcel Map Book 12, pages 78–79** and loading them into Land Atlas.

## The essential distinction

Keep these separate:

1. **Relative geometry:** compute the parcel shapes from recorded bearings, distances, curves, and monument ties.
2. **Geographic placement:** position and orient that geometry using control coordinates or an explicitly approved imagery alignment.
3. **Presentation:** render curved boundaries, labels, and editable handles without changing the geometry.

Moving county GIS polygons to match a pin is **not** reconstructing a survey. We initially tried that, rejected it, and computed the boundaries from the recorded calls instead.

This produces a map reconstruction, not a licensed boundary retracement. It can closely reproduce recorded dimensions without establishing the same accuracy on the ground.

## 1. Assemble and preserve the evidence

Collect:

- Every sheet of the parcel map, not just the overview.
- Detail insets, line/curve tables, legend, scale, and basis-of-bearings note.
- Referenced records when a connection or bearing basis cannot be resolved from the supplied sheets.
- Known field markers, their coordinates, how those coordinates were obtained, and reported accuracy.
- County GIS and aerial imagery as **secondary comparison layers**, not authoritative replacement geometry.

Keep originals unchanged. Put derived crops, calculations, exports, and reports in a separate property-specific directory. Archive previous outputs before corrections.

Example layout:

```text
property/docs/
  survey-sheet-1.pdf
  survey-sheet-2.pdf
  boundary-reconstruction/
    evidence/
    calls.json
    reconstruct.py
    local-corners.json
    traverse-report.json
    survey-parcels.geojson
    drawings.json
    alignment.json
    drawings-road-aligned.json
    final-verification/
      call-audit.json
      survey-trace-overlay.svg
      REPORT.md
```

In this repository, never inspect large `data/raw/`, `data/generated/`, or their `build/` equivalents in tool context. Avoid recursive searches through vendor libraries, dependencies, and build output. A small, targeted service query is preferable when a GIS comparison is needed.

## 2. Read the actual map, not just its OCR

### Determine whether it is vector/text or a scan

```sh
pdfinfo /path/to/survey.pdf
pdftotext -layout /path/to/survey.pdf /tmp/survey-text.txt
pdfimages -list /path/to/survey.pdf
pdftoppm -f 1 -l 1 -r 350 -png -singlefile \
  /path/to/survey.pdf /tmp/survey-sheet
```

A blank text extraction can mean the PDF is just an embedded image. Castle Oaks was a scan. Rendering near its native image resolution helped; enlarging further made characters easier to examine but did not add source information.

### Crop and rotate slanted calls

A full-page OCR pass missed or misread many important dimensions. Crop tightly, rotate the lettering toward horizontal, and try a few angles or contrast settings:

```sh
magick /tmp/survey-sheet.png \
  -crop 600x800+1200+250 +repage \
  -background white -rotate -45 -resize 300% \
  /tmp/survey-call.png
```

Crop coordinates are specific to each rendered sheet. Do not reuse Castle Oaks pixel coordinates on another map.

On macOS, Vision provides local OCR without installing Tesseract. A minimal Swift script:

```swift
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let image = NSImage(contentsOf: url)!
var rect = CGRect(origin: .zero, size: image.size)
let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([request])
for observation in request.results ?? [] {
    print(observation.topCandidates(1).first?.string ?? "")
}
```

Save as `ocr.swift`, then run `swift ocr.swift /tmp/survey-call.png`.

**Treat OCR as a transcription aid, not confirmation.** It confused digits, quadrant letters, curve numbers, feet symbols, and angle components here. Compare the main sheet, enlarged insets, repeated dimensions, and independent closure checks. Save evidence crops for difficult calls.

If the tooling cannot actually display an image to the agent, say so. Generating a screenshot, OCR-reading it, or returning its bytes is not equivalent to visually inspecting it. Do not claim a pixel-by-pixel visual verification that did not happen.

## 3. Build a call ledger and shared corner network

Do this before trying to draw polygons.

Assign stable names to corners and junctions: A, B, D, etc. Keep a separate record for each:

- Legal parcel corner.
- Road or pavement centerline junction.
- Witness corner, often labeled **W.C.**.
- Section/control monument.
- Curve start, curve end, and tangent point.
- Easement or right-of-way boundary.

Do not assume a physical marker is the legal corner, or that a pavement centerline is always the ownership boundary. Resolve which lines actually bound the parcel from that map's graphic, legend, and detail sheets.

Record each straight course with start/end nodes, quadrant bearing, distance, units, source sheet/detail, and transcription confidence. Record each curve with radius, delta, arc length, turn direction, initial tangent/radial information, and source.

Example schema:

```json
{
  "name": "parcel-3-northeast-side",
  "from": "D",
  "to": "A",
  "bearing": {"ns": "N", "degrees": 44, "minutes": 17, "seconds": 0, "ew": "W"},
  "distanceFeet": 813.35,
  "source": "PMB12 p79; corroborated by p78 Detail D"
}
```

One node must represent the same shared corner everywhere. One sampled curve must be reused, reversed if necessary, for the two parcels sharing it. Computing each polygon independently can introduce tiny gaps or overlaps.

### Witness ties mattered here

Detail D gives **813.35 ft total** and **783.01 ft to W.C.** along the Parcel 3 diagonal. The difference is **30.34 ft**. That distinction changes geographic anchoring; it does not change the underlying parcel geometry.

Detail E also distinguishes **939.65 / 982.05 ft** and **1681.06 / 1723.46 ft** ties across the road. These are not interchangeable distances. Do not infer which applies merely from whichever number OCR reads first.

## 4. Compute in a local survey coordinate system

Use east/north coordinates in the map's distance units. Do not start by clicking vertices on a web map or repeatedly applying geographic destination calculations.

Check units: international foot and US survey foot are not identical. Record the choice. Castle Oaks used international feet for conversion; for a new survey, inspect its stated units and coordinate system rather than copying that assumption.

### Straight calls

Convert the quadrant angle θ to an azimuth A measured clockwise from north:

| Bearing | Azimuth |
|---|---:|
| N θ E | θ |
| S θ E | 180° − θ |
| S θ W | 180° + θ |
| N θ W | 360° − θ |

For distance L:

```text
Δeast  = L × sin(A)
Δnorth = L × cos(A)
next   = previous + (Δeast, Δnorth)
```

Convert degrees to radians before using trigonometric functions. Reverse a course with `(A + 180°) mod 360°`, not by casually swapping just one quadrant letter.

A wrong reverse-bearing sign temporarily caused a western closure discrepancy here. Correcting the quadrant arithmetic fixed it; moving corners by eye would have hidden the error.

### Circular curves

Radius and delta alone do not locate an arc. Establish its start point, tangent direction, and left/right turn from connected calls, radial bearings, and the map.

For starting tangent azimuth A and radius R:

```text
right turn: center = start + vector(A + 90°, R)
left turn:  center = start + vector(A − 90°, R)
```

The starting radial direction from center to start is respectively `A − 90°` or `A + 90°`. Sweep it clockwise for a right turn, counterclockwise for a left turn. In this azimuth convention, right/clockwise delta is positive.

Useful checks:

```text
arc length   = R × |delta in radians|
chord length = 2R × sin(|delta| / 2)
end tangent  = start tangent + signed delta
```

Compare radius × delta against the printed arc length. This is an excellent way to catch an OCR error. Do not force tangency at a junction unless the plat supports it; compound/reverse curves and non-tangent connections need explicit interpretation.

### Sample arcs without changing their shape

The current Draw tool stores polygons as straight segments. Approximate an arc with enough short chords to bound the sagitta error ε:

```text
maximum angular step = 2 × acos(1 − ε/R)
segment count = ceil(|delta| / maximum angular step)
```

Castle Oaks used **ε = 0.05 ft**. These intermediate vertices are rendering samples, not surveyed monuments. Preserve the original radius/delta/arc metadata alongside them.

### Keep every actual bearing-change vertex

Never discard a nearly collinear survey corner simply because its bend looks small.

Our final audit found the most important export error this way: Parcel 7's north side was computed in two steps but exported as a single chord. Adding its intermediate section 32/33 corner corrected a maximum deviation of **6.12 ft** and reduced its area from **42.2225 to 42.0123 acres**, versus **42.02** printed.

The two courses were **1723.46 ft at S89°25′00″E** and **1268.62 ft at S89°53′47″E**. Their endpoint calculation had been right; the exported polygon had been wrong. Audit the actual exported vertices, not just calculation variables.

## 5. Validate shape before georeferencing

Use several independent checks. None alone is sufficient.

### Traverse and shared-junction closure

Calculate the same corner through different available paths. Record the residual vector and its length, not just a rounded “closed” verdict.

Castle Oaks Parcel 3 could be reached by exterior straight calls and by the road curve chain. The two results differed by **0.0099 ft**. That supported the transcription and curve sequence; it did not prove geographic placement.

Do not silently apply a least-squares adjustment, distribute error, or add a fictitious survey call. If a tiny common endpoint is selected for rendering, document the change. If you retain an explicit closing connector, identify it as unrecorded.

### Areas

Compute planar area using the shoelace formula; divide square feet by **43,560** for acres. Compare with the printed areas, allowing for their rounding and any stated exclusions.

Area mismatch is a diagnostic, not permission to scale the polygon until it matches. Here it exposed:

- Parcel 4's southern lot extension, initially omitted in an early interpretation.
- Parcel 7's omitted north-boundary bend in the exported ring.

### Independent call audit

From the final exported geometry, verify:

- All real straight sides and their intermediate corners.
- Split distances sum to the printed total; e.g. L3's 115.75 + 160 = 275.75 ft.
- Curve center/radius fits, arc lengths, sweep direction, and tangent continuity.
- Shared boundaries use identical coordinates in reverse order.
- No proper self-intersections, unintended duplicates, or missing closure.
- No unknown short closing segment is mislabeled as a recorded call.

Whenever possible, compare with a separately re-read transcription rather than merely testing that a function reproduces its own inputs.

### Visual/scan cross-check

Create an overlay of reconstructed **local** outlines on the original plat and inspect parcel order, shape, road bends, boundary intersections, and detail insets.

The scan can be skewed, stretched, thick-lined, and crowded with text/easements. A scan-only affine registration can help overlay the drawing; never apply that raster-distortion transform to the survey geometry. A nearest-dark-pixel metric can latch onto lettering or the wrong line and is not a survey-accuracy measure.

Use the diagram to check interpretation and topology, not to override clearly printed calls or to measure fractions of a foot from a low-resolution scan.

## 6. Georeference only after the local shape works

### Control coordinates

One known point fixes translation, not orientation. The plat's north may be record north, grid north, assumed north, or geographic north. Read the basis-of-bearings statement.

Two correctly identified points can determine orientation and test baseline length. Compare the coordinate-derived separation with the recorded call before fitting anything. Do not stretch survey distances to fit uncertain GPS pins.

Here the two reported positions were about **851.43 ft apart**, versus a relevant recorded full line of **813.35 ft**, or **783.01 ft to the witness corner**. The second pin was later treated as unreliable and excluded.

Treat displayed coordinate precision separately from field accuracy. Decimal places are not proof of a survey-quality fix.

### Geographic conversion

For small sites, a documented WGS84 local tangent-plane conversion is suitable for visualization. A known survey CRS and proper projection transformation are preferable when provided. Record ground/grid scale, datum, foot definition, and bearing corrections where relevant; do not assume they are known.

For Castle Oaks, local survey feet were converted to WGS84 through a tangent plane at the initial anchor. The first placement assumed true north and a specific witness corner; both were explicitly provisional.

### Road/imagery alignment when accepted by the user

If reliable geodetic control is unavailable but the road shape is distinctive:

1. Hide labels, handles, and misleading parcel layers.
2. Inspect aerial pavement separately from the GIS road overlay.
3. Compare multiple bends over the whole frontage, not just one point.
4. Test a **rigid** transform: translation + rotation, **scale = 1**.
5. Use the same transform on all parcels and shared corners.
6. Show original and candidate placement separately before replacing anything.
7. Get approval and retain the exact transform and original geometry.

For east/north coordinates x,y and a counterclockwise angle α:

```text
x′ = cos(α)x − sin(α)y + tx
y′ = sin(α)x + cos(α)y + ty
```

The approved Castle Oaks fit used approximately **42.02 ft west, 11.22 ft south, and 0.2352° clockwise**, with no scaling. Against the county road vector, RMS separation fell from about **32.86 to 5.62 ft**. That statistic was a GIS comparison, not independent pavement truth. The user confirmed that the pink comparison followed the visible road and authorized applying it.

This supported a placement-offset explanation, not a reason to deform the survey curves. The original pin was no longer treated as an exact constraint.

A visual alignment does not establish legal corners. Pavement, survey-era centerlines, and imagery registration can differ. Preserve that distinction in names and documentation.

## 7. Export, import, and make it readable

### GeoJSON and Draw

Use `[longitude, latitude]`, not the reverse.

- GeoJSON Polygon rings repeat the first coordinate at the end.
- Land Atlas Draw's `vertices` array **does not** repeat the first vertex; the renderer closes it.
- Keep stable drawing IDs and meaningful names.
- Carry provenance, assumptions, revision, and unresolved checks in the portable exports/report.

Minimal Draw record:

```json
{
  "id": "project-parcel-3",
  "name": "Project Parcel 3 — survey-call draft",
  "vertices": [[-122.0, 41.0], [-122.001, 41.0], [-122.0, 41.001]],
  "visible": true
}
```

Before replacing drawings, back up the saved collection and match exact IDs. Preserve unrelated drawings. Repeating an import must not duplicate or repeatedly transform coordinates.

### Browser storage is origin- and profile-specific

`http://localhost:3100` and `http://127.0.0.1:3100` have separate storage. So do other ports, HTTPS origins, deployed sites, and browser profiles.

An isolated Playwright session is not the user's normal browser. Importing successfully there proves the workflow, not that the user's drawings changed. Opening a URL without checking its execution is also insufficient; a background tab did not immediately execute an update here.

Verify the actual destination through the app: saved revision, drawing count, visible state, rendering, and reload. Do not modify Chrome profile databases directly or bypass browser automation security settings.

### Display curves as curves, not hundreds of calls

For known reconstructed arcs:

- One label per arc with recorded radius and arc length.
- Straight bearing/distance labels on genuine straight sides.
- Hidden intermediate arc handles until explicit editing.
- Collision avoidance and deduplication of shared-edge labels.
- A persisted **Show measurements** option and reset behavior.

In this app, `survey-curve-labels.js` maps original calls to vertex ranges and fingerprints their coordinates. Edits invalidate stale recorded labels. Do not infer a “surveyed arc” merely because arbitrary user vertices look circular.

The ordinary Draw edge measurements use a spherical model, while this reconstruction used a survey plane and WGS84 placement. Some long-edge UI lengths differed by up to **4.43 ft**. Displayed geographic bearings also include the approved road rotation. Distinguish original survey calls from computed geographic/chord labels; audit in the survey frame.

## 8. Bundle reusable defaults safely

Current app organization:

| File | Purpose |
|---|---|
| `assets/map/default-drawings.js` | Seven approved road-aligned default drawings and narrowly scoped legacy-correction metadata |
| `assets/map/drawing-seeds.js` | Seed once per ID; preserve local edits/hides/deletions; safe correction logic |
| `assets/map/survey-curve-labels.js` | Validated recorded arc-label metadata |
| `assets/map/polygon-draw.js` | Draw storage, editing, labels, manager, restore and zoom controls |

Relevant storage keys:

```text
shasta-land-atlas.polygon-drawings.v1
shasta-land-atlas.polygon-seeds.v1
shasta-land-atlas.polygon-display.v1
```

Default seeding is not cross-device synchronization. New devices receive bundled defaults after deployment; later edits remain device-local. Preserve stable IDs, remember deleted defaults, and offer **Restore missing defaults** without overwriting surviving edits.

For a verified shipped-geometry error, match the exact known old geometry, back it up, correct only that shape, preserve rename/visibility, and skip user-modified versions. Parcel 7's five-to-six-vertex correction followed this approach. Its correction metadata was consolidated into `default-drawings.js`; a separate correction module is not needed.

The temporary import/comparison HTML pages were removed once defaults were bundled. They are not required parts of the final app.

## 9. Completion means testing the running application

Do not stop at a script or successful build.

Automated checks:

```sh
node scripts/test-polygon-draw-geometry.js
node scripts/test-polygon-draw-display.js
node scripts/test-drawing-seeds.js
npm run test
npm run build
```

Manual running-app checks:

- Fresh browser profile gets the intended defaults, with no private local-file dependency.
- Every expected polygon renders, and the manager has the correct revision/count.
- Zoom-to-drawings, measurement toggle, hide/show, editing and reset work.
- Reload preserves edits, visibility, and deletions.
- Deleted defaults can be restored without erasing other edits.
- Existing manual imports do not duplicate.
- Geometry corrections are backed up and do not overwrite customized shapes.
- A second fresh/mobile profile receives the same starting defaults.
- Inspect the map at both overview and detailed road-bend zooms.
- Verify exported geometry separately from labels and source calculation variables.

Leave unresolved issues visible. A successful closure/build/test is not evidence that a field boundary is legally correct.

## Castle Oaks final results and remaining issue

After the omitted Parcel 7 corner was repaired:

| Parcel | Computed acres | Printed acres |
|---|---:|---:|
| 1 | 56.8672 | 56.87 |
| 2 | 40.1557 | 40.16 |
| 3 | 40.0995 | 40.10 |
| 4 | 40.2098 | 40.21 |
| 5 | 40.3355 | 40.33 |
| 6 | 40.0731 | 40.08 |
| 7 | 42.0123 | 42.02 |

Final checks recorded:

- 26 straight course/tie checks: maximum length residual **0.0612 ft**; maximum endpoint residual **0.09095 ft**.
- Printed curve table versus radius × angle: maximum arc-length difference **0.00458 ft**.
- 22 plotted arc occurrences: maximum fitted-radius difference **0.04523 ft** and arc-length difference **0.00458 ft**.
- Parcel 3 independent traverse closure: **0.00988 ft**.
- **Still unresolved:** C12-to-section tie has an explicit **1.41061-ft unrecorded connector**, affecting Parcels 1 and 4. Do not conceal it or label it a recorded course.

These establish consistency with the interpreted recorded calls, not equivalent positional certainty on the ground. The scan overlay was a coarse linework cross-check, not a few-feet visual certification.

## Local evidence and scripts from this job

Original maps:

```text
/Users/aaron/Desktop/castle_lake_rd/docs/P012_078.pdf
/Users/aaron/Desktop/castle_lake_rd/docs/P012_079.pdf
```

Working record:

```text
/Users/aaron/Desktop/castle_lake_rd/docs/boundary-reconstruction/
```

Key artifacts:

- `reconstruct.py`: survey-only local computation, topology, curves, geographic export.
- `align-to-road.py`: exact approved rigid placement; writes separate aligned outputs.
- `drawings-road-aligned.json`, `survey-parcels-road-aligned.geojson`: geometry exports.
- `traverse-report.json`: local corners, closure checks, computed areas.
- `final-verification/REPORT.md`, `call-audit.json`: final findings and individual checks.
- `final-verification/survey-trace-overlay.svg` / `.png`: registered scan comparison.
- `final-verification/before-*`: pre-correction versions.

The scripts are **case-specific references**, not a general survey parser. Some audit/overlay scripts reference `/tmp` renders and the land repository working directory. Recreate those inputs and inspect paths before rerunning. `reconstruct.py` writes derived outputs when run; archive them first. The app's bundled defaults contain deployment metadata that is not necessarily regenerated by those property scripts.

For another plot, copy the structure and algorithms—not its bearings, foot definition, witness-corner assumptions, alignment transform, or geographic anchor.

## Short checklist for the next plot

- [ ] All sheets/details/legend and basis of bearings collected.
- [ ] Source PDFs preserved; evidence crops and call ledger saved.
- [ ] Legal corners, witness markers, road lines and easements distinguished.
- [ ] Local straight/arc graph constructed with shared nodes.
- [ ] Quadrants, curve turns, tangents, splits and intermediate corners verified.
- [ ] Independent closures, areas, exported calls, and self-intersections checked.
- [ ] Visual topology compared against the plat, with scan limitations stated.
- [ ] Geographic placement assumptions and control accuracy documented.
- [ ] No unapproved scaling or GIS-shape substitution.
- [ ] Original and transformed outputs retained; residuals not hidden.
- [ ] Readable labels/handles; browser origin and actual user session verified.
- [ ] Default seeding, backups, upgrades and deletion behavior tested.
- [ ] Manual application workflow tested; unresolved issues reported plainly.
