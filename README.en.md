# OpenPlex

Self-hosted media library. Local files, official metadata, optional plugins.

Korean README is canonical: [README.md](README.md).

```bash
git clone https://github.com/MovieHolic-Plex/openplex.git
cd openplex
cp .env.example .env
npm install
npm run build
npm start
```

Open `http://127.0.0.1:33888`.

This repository does not include scrapers, DRM circumvention, or third-party playback catalogs. Drop your own adapter under `plugins/` (gitignored). See `docs/adapters.md`.

MIT licensed. Use it with media you own.
