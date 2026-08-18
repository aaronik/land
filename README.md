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

## Data refresh

Run the sales-data refresh independently when needed:

```sh
npm run refresh
```

The `Refresh sales data` GitHub Actions workflow also runs daily at 12:00 UTC (4 AM PST / 5 AM PDT) and can be started manually from the Actions tab. It commits updated files under `data/` to the default branch, then builds and deploys the refreshed site to `gh-pages`.

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

## Deployment

```sh
npm run release
```

This validates the existing data, builds `build/`, and publishes through `gh-pages`; it does not refresh or commit sales data. Configure the repository's Pages deployment to use the `gh-pages` branch.
