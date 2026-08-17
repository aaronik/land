# Agent Guidelines

## Large geospatial data

Never read, search, print, diff, or otherwise load the contents of these directories into context:

- `data/raw/`
- `data/generated/`
- `build/data/raw/`
- `build/data/generated/`

These contain very large GeoJSON, JSON indexes, and binary PMTiles archives that can exhaust the context window. Treat all `*.pmtiles` files as binary and never inspect their contents as text.

When searching the repository, always exclude large and generated data, dependencies, and build output. For example:

```sh
rg PATTERN . \
  --glob '!data/raw/**' \
  --glob '!data/generated/**' \
  --glob '!build/**' \
  --glob '!node_modules/**'
```

For file discovery, prefer scoped source paths such as `assets/`, `scripts/`, and top-level configuration files. Metadata-only operations such as `ls`, `du`, `stat`, file counts, and filenames are safe for data directories.

Do not run unrestricted recursive `grep`, `cat`, `sed`, `head`, `tail`, `git diff`, or similar content-reading commands from the repository root unless the large-data paths above are explicitly excluded.
