# Shasta Land Atlas

Static GitHub Pages map combining the two `~/suite/bin/shasta_*land*` workflows:

- Siskiyou MLS private land/farm listings
- Siskiyou County tax-sale PDF records
- Siskiyou County parcel polygons and attributes
- Esri satellite imagery

## Local use

```sh
npm install
npm run refresh
npm start
```

Set `BROWSER=none npm start` to run without opening a browser.

## Data model

GitHub Pages cannot run server code and the upstream sites do not consistently allow browser CORS requests. `npm run refresh` therefore performs the JavaScript ingestion at build time and writes `data/parcels.json`. The browser remains entirely static and provides map interaction, filters, search, hover details, and click details.

Private listings without MLS coordinates cannot be assigned an APN automatically and are omitted from the parcel map. Public records remain visible as historical records and are marked `EXPIRED` once their advertised closing date passes.

## Deployment

```sh
npm run release
```

This refreshes data, validates it, builds `build/`, and publishes through `gh-pages`. Configure the repository's Pages deployment to use the `gh-pages` branch.
