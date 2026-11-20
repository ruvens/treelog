# Treedoc 🌳

A small browser app to document the trees on a property:
exact position, trunk circumference, species, and any number of photos per tree.

It is a static web app (plain HTML/CSS/JS, no build step) hosted on GitHub Pages and works
on phone and desktop, including offline in the garden once it has been opened.

## Features

- **Map** with satellite imagery (Esri), the official Bavarian orthophoto (DOP40) and OpenStreetMap.
- **Exact positioning**: place a tree with a crosshair on the aerial image, or measure it by GPS.
  GPS is averaged over 20 s (accuracy-weighted) and the accuracy (± m) is stored with the tree.
  Coordinates can also be typed in or adjusted later.
- **Circumference** in cm at 1 m height. Multi-stem trees: enter `45+38+30`; the sum and diameter are computed.
  Trees ≥ 80 cm are highlighted (threshold of the Munich *Baumschutzverordnung*).
- **Species** with suggestions (Latin + German names), free text allowed.
- Height, crown diameter (drawn on the map), condition, survey date, notes.
- **Photos**: take with the camera or pick several files at once; resized to max. 2400 px; gallery viewer.
- **List** with search and sorting.
- **Export**: full backup `.zip` (data.json, CSV, GeoJSON and all photos in folders per tree),
  CSV for Excel (semicolon-separated, UTF-8), GeoJSON for QGIS. **Import** of backups for moving data between devices.
- Installable as an app (PWA) and usable offline; viewed map tiles are cached.

## Property address

The address is not part of the code. Enter it once in the *Data* tab → *Property*;
it is looked up on the map and stored only in your browser (and in your backups).

## Where is the data stored?

Only **in the browser of the device you use** (IndexedDB). Nothing is uploaded anywhere,
so the photos of the property stay private even though the app is public.
Consequences:

- Make a **Full backup** from the *Data* tab regularly (e.g. into iCloud/Google Drive).
- To continue on another device, import the backup there.
- On iPhone, add the app to the home screen ("Share → Add to Home Screen") so Safari doesn't evict the data.

## Deploy on GitHub Pages

1. Merge this branch into `main` (or push it to `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` publishes the site on every push to `main`
   (or run it manually under *Actions → Deploy to GitHub Pages → Run workflow*).
4. The app is then available at `https://ruvens.github.io/treelog/`.

Note: GitHub Pages on free accounts requires the repository to be public. The code is public then, the tree data is not (it lives in your browser).

## Run locally

Any static web server works, e.g.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

GPS access needs HTTPS or `localhost`.

## Project layout

```
index.html            UI
css/app.css           styles
js/app.js             app logic (map, editor, photos, export/import)
js/db.js              IndexedDB storage
js/species.js         species suggestions
sw.js                 service worker (offline)
vendor/               Leaflet 1.9.4, JSZip 3.10.1
```

Map data: © OpenStreetMap contributors · Imagery © Esri · Orthophoto © Bayerische Vermessungsverwaltung (CC BY 4.0).
