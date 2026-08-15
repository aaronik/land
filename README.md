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

## Data refresh

Run the sales-data refresh independently when needed:

```sh
npm run refresh
```

The `Refresh sales data` GitHub Actions workflow also runs daily at 12:00 UTC (4 AM PST / 5 AM PDT) and can be started manually from the Actions tab. It commits updated files under `data/` to the default branch when the refresh produces changes.

## Deployment

```sh
npm run release
```

This validates the existing data, builds `build/`, and publishes through `gh-pages`; it does not refresh or commit sales data. Configure the repository's Pages deployment to use the `gh-pages` branch.
