/* Treelog – tree inventory */
(function () {
  'use strict';

  // Shown until the property address has been entered (Data tab). The address itself
  // is user data and lives only in IndexedDB / backups, never in the code.
  const FALLBACK_SITE = { lat: 48.1374, lng: 11.5755, zoom: 12 };
  const PROTECTED_CM = 80; // Munich Baumschutzverordnung: >= 80 cm at 1 m height
  const PHOTO_MAX = 2400;
  const THUMB_MAX = 320;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    trees: [],
    site: null,
    address: '',
    map: null,
    layer: null,
    markers: new Map(),
    // editor draft
    draft: null,          // tree object being edited
    draftIsNew: false,
    draftPhotos: [],      // [{id, blob, thumb, name, ..., _new?}]
    removedPhotoIds: [],
    thumbUrls: [],
    placingFor: null,     // 'new' | 'edit'
  };

  // ---------- helpers ----------
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  function toast(msg, ms = 2600) {
    const el = $('#toast');
    // modal dialogs live in the top layer – move the toast into the open one so it stays visible
    const host = $('dialog[open]') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  // "112" -> {total:112, stems:[112]}, "45+38, 30" -> {total:113, stems:[45,38,30]}
  function parseCirc(str) {
    const stems = String(str ?? '')
      .split(/[+,;/\s]+/)
      .map((s) => parseFloat(s.replace(',', '.')))
      .filter((n) => Number.isFinite(n) && n > 0);
    return { stems, total: stems.reduce((a, b) => a + b, 0) };
  }

  function speciesShort(s) {
    if (!s) return 'Unknown species';
    return s;
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function nextNumber() {
    const nums = state.trees.map((t) => parseInt(t.number, 10)).filter(Number.isFinite);
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  }

  // ---------- map ----------
  function initMap() {
    const map = L.map('map', { zoomControl: true, maxZoom: 22 });
    state.map = map;

    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22, maxNativeZoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    const bayern = L.tileLayer.wms('https://geoservices.bayern.de/od/wms/dop/v1/dop40', {
      layers: 'by_dop40c', format: 'image/jpeg', maxZoom: 22,
      attribution: 'Orthophoto © Bayerische Vermessungsverwaltung (CC BY 4.0)',
    });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22, maxNativeZoom: 19,
      attribution: '© OpenStreetMap contributors',
    });
    esri.addTo(map);
    L.control.layers({ 'Satellite (Esri)': esri, 'Orthophoto Bayern (DOP40)': bayern, 'Street map (OSM)': osm }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, maxWidth: 140 }).addTo(map);

    state.layer = L.layerGroup().addTo(map);
    state.youLayer = L.layerGroup().addTo(map);
  }

  function treeIcon(t) {
    const { total } = parseCirc(t.circumference);
    const cls = ['tree-pin'];
    if (total >= PROTECTED_CM) cls.push('protected');
    if (t.condition === 'dead') cls.push('dead');
    return L.divIcon({
      className: '',
      html: `<div class="${cls.join(' ')}">${esc(t.number || '?')}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  function renderMarkers() {
    state.layer.clearLayers();
    state.markers.clear();
    for (const t of state.trees) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
      if (t.crown > 0) {
        L.circle([t.lat, t.lng], { radius: t.crown / 2, color: '#7bd389', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(state.layer);
      }
      const { total } = parseCirc(t.circumference);
      const m = L.marker([t.lat, t.lng], { icon: treeIcon(t), title: `#${t.number} ${t.species || ''}` })
        .bindTooltip(`<b>#${esc(t.number)}</b> ${esc(t.species || '')}<br>${total ? total + ' cm' : '–'}`, { direction: 'top', offset: [0, -14] })
        .on('click', () => openEditor(t.id));
      m.addTo(state.layer);
      state.markers.set(t.id, m);
    }
  }

  function goToSite() {
    const s = state.site || FALLBACK_SITE;
    state.map.setView([s.lat, s.lng], s.zoom || 19);
  }

  async function geocodeSite() {
    const address = $('#site-address').value.trim();
    if (!address) { toast('Enter the property address first'); return false; }
    state.address = address;
    await DB.setMeta('address', address);
    renderSiteName();
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
      const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
      const j = await res.json();
      if (j && j[0]) {
        state.site = { lat: +j[0].lat, lng: +j[0].lon, zoom: 19 };
        await DB.setMeta('site', state.site);
        toast('Address found: ' + j[0].display_name.split(',').slice(0, 3).join(','));
        goToSite();
        renderSiteInfo();
        return true;
      }
    } catch (e) { /* offline */ }
    toast('Address lookup failed – pan to the property and use "Use current map centre".');
    return false;
  }

  function renderSiteName() {
    $('#site-name').textContent = state.address || 'Tree inventory';
    $('#site-address').value = state.address;
  }

  function renderSiteInfo() {
    const s = state.site || FALLBACK_SITE;
    $('#site-coords').textContent = `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}${state.site ? '' : ' (not set yet)'}`;
  }

  // ---------- GPS ----------
  // Collects fixes for `seconds` and returns an accuracy-weighted mean.
  function measureGps(seconds = 20, onProgress) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Geolocation not supported'));
      const fixes = [];
      const started = Date.now();
      const id = navigator.geolocation.watchPosition(
        (p) => {
          fixes.push(p.coords);
          onProgress && onProgress(fixes.length, p.coords.accuracy, Math.max(0, seconds - (Date.now() - started) / 1000));
        },
        (err) => { if (!fixes.length) { navigator.geolocation.clearWatch(id); clearTimeout(timer); reject(err); } },
        { enableHighAccuracy: true, maximumAge: 0, timeout: seconds * 1000 }
      );
      const timer = setTimeout(() => {
        navigator.geolocation.clearWatch(id);
        if (!fixes.length) return reject(new Error('No GPS fix'));
        const best = Math.min(...fixes.map((f) => f.accuracy));
        // ignore fixes much worse than the best one
        const good = fixes.filter((f) => f.accuracy <= Math.max(best * 2, best + 5));
        let w = 0, lat = 0, lng = 0;
        for (const f of good) { const wi = 1 / (f.accuracy * f.accuracy); w += wi; lat += f.latitude * wi; lng += f.longitude * wi; }
        resolve({ lat: lat / w, lng: lng / w, accuracy: Math.round(best * 10) / 10, samples: good.length });
      }, seconds * 1000);
    });
  }

  async function gpsWithUi(seconds = 20) {
    toast('Measuring GPS… stand next to the trunk', seconds * 1000);
    try {
      const r = await measureGps(seconds, (n, acc, left) => {
        $('#toast').textContent = `GPS: ${n} fixes, ±${Math.round(acc)} m, ${Math.ceil(left)} s left…`;
      });
      toast(`GPS: ±${r.accuracy} m from ${r.samples} fixes`);
      return r;
    } catch (e) {
      toast('GPS failed: ' + (e.message || e));
      return null;
    }
  }

  function showYou(lat, lng, acc) {
    state.youLayer.clearLayers();
    L.circle([lat, lng], { radius: acc, color: '#3b82f6', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(state.youLayer);
    L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(state.youLayer);
  }

  // ---------- placing mode ----------
  function startPlacing(mode, center) {
    state.placingFor = mode;
    switchView('map');
    if (center) state.map.setView(center, Math.max(state.map.getZoom(), 20));
    $('#placing').classList.remove('hidden');
    $('#btn-add').classList.add('hidden');
  }

  function stopPlacing() {
    state.placingFor = null;
    $('#placing').classList.add('hidden');
    $('#btn-add').classList.remove('hidden');
  }

  function finishPlacing(lat, lng, accuracy) {
    const mode = state.placingFor;
    stopPlacing();
    const pos = { lat: +lat.toFixed(7), lng: +lng.toFixed(7), accuracy: accuracy ?? null, positionSource: accuracy != null ? 'gps' : 'map' };
    if (mode === 'new') {
      newTree(pos);
    } else if (mode === 'edit' && state.draft) {
      setFormPos(pos);
      $('#editor').showModal();
    }
  }

  // ---------- editor ----------
  const form = () => $('#tree-form');

  function newTree(pos) {
    const t = {
      id: uid(), number: nextNumber(), species: '', circumference: '', height: null, crown: null,
      condition: '', notes: '', surveyed: today(), createdAt: new Date().toISOString(), ...pos,
    };
    openEditorWith(t, true, []);
  }

  async function openEditor(id) {
    const t = state.trees.find((x) => x.id === id);
    if (!t) return;
    const photos = await DB.photosForTree(id);
    photos.sort((a, b) => naturalCompare(a.addedAt || '', b.addedAt || ''));
    openEditorWith({ ...t }, false, photos);
  }

  function openEditorWith(t, isNew, photos) {
    state.draft = t;
    state.draftIsNew = isNew;
    state.draftPhotos = photos;
    state.removedPhotoIds = [];
    const f = form();
    f.reset();
    f.number.value = t.number ?? '';
    f.surveyed.value = t.surveyed || '';
    f.species.value = t.species || '';
    f.circumference.value = t.circumference ?? '';
    f.height.value = t.height ?? '';
    f.crown.value = t.crown ?? '';
    f.condition.value = t.condition || '';
    f.notes.value = t.notes || '';
    setFormPos(t);
    $('#editor-title').textContent = isNew ? 'New tree' : `Tree #${t.number}`;
    $('#btn-delete').classList.toggle('hidden', isNew);
    updateCircHint();
    renderPhotoGrid();
    $('#editor').showModal();
  }

  function setFormPos(p) {
    const f = form();
    f.lat.value = p.lat != null ? (+p.lat).toFixed(7) : '';
    f.lng.value = p.lng != null ? (+p.lng).toFixed(7) : '';
    state.draft.accuracy = p.accuracy ?? null;
    state.draft.positionSource = p.positionSource || state.draft.positionSource || 'map';
    const src = state.draft.positionSource === 'gps' ? `GPS, ±${state.draft.accuracy} m` : 'placed on map';
    $('#pos-hint').textContent = `Source: ${src}`;
  }

  function updateCircHint() {
    const { stems, total } = parseCirc(form().circumference.value);
    const el = $('#circ-hint');
    if (!stems.length) {
      el.textContent = `Munich tree protection ordinance: protected from ${PROTECTED_CM} cm circumference at 1 m height (multi-stem: sum of stems).`;
      el.className = 'hint';
      return;
    }
    const size = stems.length > 1
      ? `${stems.length} stems, sum ${total} cm`
      : `≈ ${(total / Math.PI).toFixed(1)} cm diameter`;
    const prot = total >= PROTECTED_CM ? ' · likely protected (BaumschutzV)' : '';
    el.textContent = size + prot;
    el.className = 'hint' + (total >= PROTECTED_CM ? ' warn' : '');
  }

  function closeEditor() {
    state.thumbUrls.forEach(URL.revokeObjectURL);
    state.thumbUrls = [];
    state.draft = null;
    state.draftPhotos = [];
    $('#editor').close();
  }

  async function saveEditor(e) {
    e.preventDefault();
    const f = form();
    const lat = parseFloat(f.lat.value), lng = parseFloat(f.lng.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { toast('Position is missing'); return; }
    const num = f.number.value.trim();
    const dup = state.trees.find((t) => t.id !== state.draft.id && String(t.number) === num);
    if (dup && !confirm(`Tree number ${num} already exists. Save anyway?`)) return;

    const prev = state.trees.find((t) => t.id === state.draft.id);
    const posChanged = !prev || prev.lat !== lat || prev.lng !== lng;
    const t = {
      ...state.draft,
      number: num,
      surveyed: f.surveyed.value,
      species: f.species.value.trim(),
      circumference: f.circumference.value.trim(),
      height: f.height.value === '' ? null : +f.height.value,
      crown: f.crown.value === '' ? null : +f.crown.value,
      condition: f.condition.value,
      notes: f.notes.value.trim(),
      lat: +lat.toFixed(7),
      lng: +lng.toFixed(7),
      updatedAt: new Date().toISOString(),
    };
    // Manually typed coordinates
    if (prev && posChanged && t.positionSource === prev.positionSource && t.accuracy === prev.accuracy) {
      t.positionSource = 'manual';
      t.accuracy = null;
    }
    t.circumferenceTotal = parseCirc(t.circumference).total || null;

    for (const id of state.removedPhotoIds) await DB.deletePhoto(id);
    for (const p of state.draftPhotos) {
      if (p._new) { const { _new, ...rest } = p; await DB.putPhoto({ ...rest, treeId: t.id }); }
    }
    t.photoCount = state.draftPhotos.length;
    await DB.putTree(t);
    closeEditor();
    await reload();
    toast(`Tree #${t.number} saved`);
  }

  async function deleteCurrent() {
    const t = state.draft;
    if (!t || !confirm(`Delete tree #${t.number} and all its photos?`)) return;
    await DB.deleteTree(t.id);
    closeEditor();
    await reload();
    toast('Tree deleted');
  }

  // ---------- photos ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read image ' + file.name)); };
      img.src = url;
    });
  }

  async function resize(img, max, quality) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return { blob, width: w, height: h };
  }

  async function addFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    toast(`Processing ${list.length} photo(s)…`, 10000);
    let ok = 0;
    for (const file of list) {
      try {
        const img = await loadImage(file); // browsers apply EXIF orientation automatically
        const full = await resize(img, PHOTO_MAX, 0.85);
        const thumb = await resize(img, THUMB_MAX, 0.7);
        state.draftPhotos.push({
          id: uid(), blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height,
          name: file.name || 'photo.jpg',
          takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          addedAt: new Date().toISOString(), _new: true,
        });
        ok++;
      } catch (e) {
        console.error(e);
        toast(e.message);
      }
    }
    renderPhotoGrid();
    toast(`${ok} photo(s) added – press Save to keep them`);
  }

  function renderPhotoGrid() {
    state.thumbUrls.forEach(URL.revokeObjectURL);
    state.thumbUrls = [];
    const grid = $('#photo-grid');
    grid.innerHTML = '';
    if (!state.draftPhotos.length) {
      grid.innerHTML = '<p class="hint">No photos yet.</p>';
      return;
    }
    state.draftPhotos.forEach((p, i) => {
      const url = URL.createObjectURL(p.thumb || p.blob);
      state.thumbUrls.push(url);
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = `<img src="${url}" alt="Photo ${i + 1}" loading="lazy"><button type="button" class="thumb-del" aria-label="Remove photo">✕</button>`;
      d.querySelector('img').addEventListener('click', () => openViewer(state.draftPhotos, i));
      d.querySelector('.thumb-del').addEventListener('click', () => {
        if (!confirm('Remove this photo?')) return;
        const [rm] = state.draftPhotos.splice(i, 1);
        if (!rm._new) state.removedPhotoIds.push(rm.id);
        renderPhotoGrid();
      });
      grid.appendChild(d);
    });
  }

  // ---------- photo viewer ----------
  const viewer = { photos: [], i: 0, url: null };
  function openViewer(photos, i) {
    viewer.photos = photos; viewer.i = i;
    showViewerPhoto();
    $('#viewer').showModal();
  }
  function showViewerPhoto() {
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    const p = viewer.photos[viewer.i];
    viewer.url = URL.createObjectURL(p.blob);
    $('#viewer-img').src = viewer.url;
    const when = p.takenAt ? new Date(p.takenAt).toLocaleString() : '';
    $('#viewer-caption').textContent = `${viewer.i + 1} / ${viewer.photos.length}  ${when}`;
  }
  function stepViewer(d) {
    viewer.i = (viewer.i + d + viewer.photos.length) % viewer.photos.length;
    showViewerPhoto();
  }
  function closeViewer() {
    $('#viewer').close();
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer.url = null;
  }

  // ---------- list ----------
  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const sort = $('#sort').value;
    let items = state.trees.filter((t) => !q || [t.number, t.species, t.notes, t.condition].join(' ').toLowerCase().includes(q));
    const cmp = {
      number: (a, b) => naturalCompare(a.number, b.number),
      species: (a, b) => naturalCompare(a.species || '~', b.species || '~') || naturalCompare(a.number, b.number),
      'circ-desc': (a, b) => (parseCirc(b.circumference).total - parseCirc(a.circumference).total),
      updated: (a, b) => naturalCompare(b.updatedAt || '', a.updatedAt || ''),
    }[sort];
    items.sort(cmp);

    const ul = $('#tree-list');
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML = `<li class="empty">${state.trees.length ? 'No matches.' : 'No trees yet. Go to the map and tap “＋ Tree”.'}</li>`;
    }
    for (const t of items) {
      const { stems, total } = parseCirc(t.circumference);
      const li = document.createElement('li');
      li.className = 'tree-item';
      li.innerHTML = `
        <div class="num ${total >= PROTECTED_CM ? 'protected' : ''}">${esc(t.number)}</div>
        <div class="info">
          <div class="title">${esc(speciesShort(t.species))}</div>
          <div class="meta">
            ${total ? `Circ. ${total} cm${stems.length > 1 ? ` (${stems.length} stems)` : ''}` : 'no circumference'}
            ${t.height ? ` · ${t.height} m high` : ''}
            ${t.condition ? ` · ${esc(t.condition)}` : ''}
            · 📷 ${t.photoCount || 0}
          </div>
          <div class="meta coords">${(+t.lat).toFixed(6)}, ${(+t.lng).toFixed(6)}${t.accuracy ? ` ±${t.accuracy} m` : ''}</div>
        </div>
        <button class="icon-btn" title="Show on map">⌖</button>`;
      li.querySelector('.info').addEventListener('click', () => openEditor(t.id));
      li.querySelector('.num').addEventListener('click', () => openEditor(t.id));
      li.querySelector('.icon-btn').addEventListener('click', () => {
        switchView('map');
        state.map.setView([t.lat, t.lng], 21);
        state.markers.get(t.id)?.openTooltip();
      });
      ul.appendChild(li);
    }

    const prot = state.trees.filter((t) => parseCirc(t.circumference).total >= PROTECTED_CM).length;
    const photos = state.trees.reduce((a, t) => a + (t.photoCount || 0), 0);
    $('#summary').textContent = `${state.trees.length} trees · ${prot} with ≥ ${PROTECTED_CM} cm circumference · ${photos} photos`;
  }

  // ---------- views ----------
  function switchView(name) {
    if (name !== 'map' && state.placingFor === 'new') stopPlacing();
    $$('.tabs button').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'map') setTimeout(() => state.map.invalidateSize(), 0);
    if (name === 'list') renderList();
    if (name === 'data') renderStorageInfo();
  }

  async function reload() {
    state.trees = await DB.allTrees();
    $('#count').textContent = state.trees.length;
    renderMarkers();
    renderList();
  }

  // ---------- export / import ----------
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safe = (s) => String(s).replace(/[^\w.-]+/g, '_');

  async function exportZip() {
    toast('Building backup…', 20000);
    const zip = new JSZip();
    const photos = await DB.allPhotos();
    const byTree = {};
    const photoMeta = [];
    for (const p of photos) {
      const t = state.trees.find((x) => x.id === p.treeId);
      byTree[p.treeId] = (byTree[p.treeId] || 0) + 1;
      const folder = t ? `tree-${safe(t.number)}` : 'orphans';
      const file = `photos/${folder}/${String(byTree[p.treeId]).padStart(2, '0')}_${p.id.slice(0, 8)}.jpg`;
      zip.file(file, p.blob);
      photoMeta.push({ id: p.id, treeId: p.treeId, file, name: p.name, takenAt: p.takenAt, addedAt: p.addedAt, width: p.width, height: p.height });
    }
    const data = { app: 'treelog', version: 1, exportedAt: new Date().toISOString(), address: state.address, site: state.site, trees: state.trees, photos: photoMeta };
    zip.file('data.json', JSON.stringify(data, null, 2));
    zip.file('trees.csv', toCsv());
    zip.file('trees.geojson', JSON.stringify(toGeoJson(), null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, `treelog-backup-${stamp()}.zip`);
    await DB.setMeta('lastBackup', new Date().toISOString());
    toast(`Backup with ${state.trees.length} trees and ${photos.length} photos created`);
  }

  function toCsv() {
    const cols = ['number', 'species', 'lat', 'lng', 'accuracy_m', 'position_source', 'circumference_cm', 'circumference_stems', 'diameter_cm', 'height_m', 'crown_m', 'condition', 'surveyed', 'photos', 'notes', 'id'];
    const q = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [...state.trees].sort((a, b) => naturalCompare(a.number, b.number)).map((t) => {
      const { stems, total } = parseCirc(t.circumference);
      return [t.number, t.species, t.lat, t.lng, t.accuracy, t.positionSource, total || '', stems.join('+'), total ? (total / Math.PI).toFixed(1) : '', t.height, t.crown, t.condition, t.surveyed, t.photoCount || 0, t.notes, t.id].map(q).join(';');
    });
    return '﻿' + [cols.join(';'), ...rows].join('\r\n');
  }

  function toGeoJson() {
    return {
      type: 'FeatureCollection',
      features: state.trees.map((t) => {
        const { total } = parseCirc(t.circumference);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
          properties: { number: t.number, species: t.species, circumference_cm: total || null, circumference_stems: t.circumference, height_m: t.height, crown_m: t.crown, condition: t.condition, surveyed: t.surveyed, accuracy_m: t.accuracy, notes: t.notes, photos: t.photoCount || 0, id: t.id },
        };
      }),
    };
  }

  async function importZip(file) {
    try {
      toast('Importing…', 30000);
      const zip = await JSZip.loadAsync(file);
      const dataFile = zip.file('data.json');
      if (!dataFile) throw new Error('data.json not found in archive');
      const data = JSON.parse(await dataFile.async('string'));
      if (data.app !== 'treelog' && data.app !== 'treedoc') throw new Error('Not a Treelog backup');
      let nTrees = 0, nPhotos = 0, skipped = 0;
      for (const t of data.trees || []) {
        const existing = await DB.getTree(t.id);
        if (existing && (existing.updatedAt || '') > (t.updatedAt || '')) { skipped++; continue; }
        await DB.putTree(t);
        nTrees++;
      }
      const existingPhotoIds = new Set((await DB.allPhotos()).map((p) => p.id));
      for (const p of data.photos || []) {
        if (existingPhotoIds.has(p.id)) continue;
        const f = zip.file(p.file);
        if (!f) continue;
        const blob = new Blob([await f.async('arraybuffer')], { type: 'image/jpeg' });
        let thumb = null;
        try { thumb = (await resize(await loadImage(blob), THUMB_MAX, 0.7)).blob; } catch (e) { /* ignore */ }
        const { file: _f, ...meta } = p;
        await DB.putPhoto({ ...meta, blob, thumb });
        nPhotos++;
      }
      // recount photos per tree
      const all = await DB.allPhotos();
      for (const t of await DB.allTrees()) {
        const c = all.filter((p) => p.treeId === t.id).length;
        if (t.photoCount !== c) await DB.putTree({ ...t, photoCount: c });
      }
      if (data.site && !state.site) { state.site = data.site; await DB.setMeta('site', data.site); renderSiteInfo(); goToSite(); }
      if (data.address && !state.address) { state.address = data.address; await DB.setMeta('address', data.address); renderSiteName(); }
      await reload();
      toast(`Imported ${nTrees} trees, ${nPhotos} photos${skipped ? `, ${skipped} skipped (local version newer)` : ''}`, 5000);
    } catch (e) {
      console.error(e);
      toast('Import failed: ' + e.message, 5000);
    } finally {
      $('#import-file').value = '';
    }
  }

  async function renderStorageInfo() {
    const el = $('#storage-info');
    let txt = '';
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      txt += `Used ${(e.usage / 1048576).toFixed(1)} MB of ~${(e.quota / 1048576).toFixed(0)} MB. `;
    }
    if (navigator.storage?.persisted) {
      txt += (await navigator.storage.persisted()) ? 'Storage is persistent. ' : 'Storage may be cleared by the browser under pressure. ';
    }
    const lb = await DB.getMeta('lastBackup');
    txt += lb ? `Last backup: ${new Date(lb).toLocaleString()}.` : 'No backup made yet.';
    el.textContent = txt;
  }

  // ---------- wiring ----------
  function wire() {
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

    $('#btn-add').addEventListener('click', () => startPlacing('new'));
    $('#btn-place-cancel').addEventListener('click', () => {
      const mode = state.placingFor;
      stopPlacing();
      if (mode === 'edit' && state.draft) $('#editor').showModal();
    });
    $('#btn-place-ok').addEventListener('click', () => {
      const c = state.map.getCenter();
      finishPlacing(c.lat, c.lng, null);
    });
    $('#btn-place-gps').addEventListener('click', async () => {
      const r = await gpsWithUi(20);
      if (!r) return;
      showYou(r.lat, r.lng, r.accuracy);
      state.map.setView([r.lat, r.lng], Math.max(state.map.getZoom(), 20));
      if (confirm(`GPS position ±${r.accuracy} m.\nOK = use the GPS position directly.\nCancel = fine-tune with the crosshair (map is centred on GPS).`)) {
        finishPlacing(r.lat, r.lng, r.accuracy);
      }
    });

    $('#btn-locate').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Geolocation not supported');
      navigator.geolocation.getCurrentPosition(
        (p) => { showYou(p.coords.latitude, p.coords.longitude, p.coords.accuracy); state.map.setView([p.coords.latitude, p.coords.longitude], 20); toast(`±${Math.round(p.coords.accuracy)} m`); },
        (e) => toast('Location error: ' + e.message),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
    $('#btn-site').addEventListener('click', goToSite);

    // editor
    form().addEventListener('submit', saveEditor);
    $$('#editor [data-close]').forEach((b) => b.addEventListener('click', () => {
      if (state.draftPhotos.some((p) => p._new) && !confirm('Discard unsaved photos?')) return;
      closeEditor();
    }));
    $('#editor').addEventListener('cancel', (e) => { e.preventDefault(); $('#editor [data-close]').click(); });
    $('#btn-delete').addEventListener('click', deleteCurrent);
    form().circumference.addEventListener('input', updateCircHint);
    $('#btn-pos-gps').addEventListener('click', async () => {
      const r = await gpsWithUi(20);
      if (r) setFormPos({ ...r, positionSource: 'gps' });
    });
    $('#btn-pos-map').addEventListener('click', () => {
      const f = form();
      // keep typed values in the draft while the dialog is hidden
      $('#editor').close();
      startPlacing('edit', [parseFloat(f.lat.value) || state.map.getCenter().lat, parseFloat(f.lng.value) || state.map.getCenter().lng]);
    });
    $('#photo-camera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    $('#photo-files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    // viewer
    $('#viewer-prev').addEventListener('click', () => stepViewer(-1));
    $('#viewer-next').addEventListener('click', () => stepViewer(1));
    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer').addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
    document.addEventListener('keydown', (e) => {
      if (!$('#viewer').open) return;
      if (e.key === 'ArrowLeft') stepViewer(-1);
      if (e.key === 'ArrowRight') stepViewer(1);
    });

    // list
    $('#search').addEventListener('input', renderList);
    $('#sort').addEventListener('change', renderList);

    // data
    $('#btn-export-zip').addEventListener('click', exportZip);
    $('#btn-export-csv').addEventListener('click', () => download(new Blob([toCsv()], { type: 'text/csv;charset=utf-8' }), `treelog-${stamp()}.csv`));
    $('#btn-export-geojson').addEventListener('click', () => download(new Blob([JSON.stringify(toGeoJson(), null, 2)], { type: 'application/geo+json' }), `treelog-${stamp()}.geojson`));
    $('#import-file').addEventListener('change', (e) => e.target.files[0] && importZip(e.target.files[0]));
    $('#btn-site-set').addEventListener('click', async () => {
      const c = state.map.getCenter();
      state.site = { lat: c.lat, lng: c.lng, zoom: state.map.getZoom() };
      await DB.setMeta('site', state.site);
      renderSiteInfo();
      toast('Property location saved');
    });
    $('#btn-site-geocode').addEventListener('click', geocodeSite);
    $('#site-address').addEventListener('keydown', (e) => { if (e.key === 'Enter') geocodeSite(); });
    $('#btn-persist').addEventListener('click', async () => {
      if (!navigator.storage?.persist) return toast('Not supported in this browser');
      const ok = await navigator.storage.persist();
      toast(ok ? 'Storage is now persistent' : 'Browser declined (installing the app to the home screen helps)');
      renderStorageInfo();
    });
    $('#btn-wipe').addEventListener('click', async () => {
      if (!confirm('Really delete ALL trees and photos on this device?')) return;
      if (prompt('Type DELETE to confirm') !== 'DELETE') return;
      await DB.wipe();
      await reload();
      toast('All data deleted');
    });
  }

  async function init() {
    $('#species-list').innerHTML = (window.TREE_SPECIES || []).map((s) => `<option value="${esc(s)}">`).join('');
    initMap();
    wire();
    state.site = (await DB.getMeta('site')) || null;
    state.address = (await DB.getMeta('address')) || '';
    goToSite();
    renderSiteInfo();
    renderSiteName();
    if (!state.site) setTimeout(() => toast('Tip: enter the property address in the Data tab', 5000), 800);
    await reload();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
    }
  }

  init().catch((e) => { console.error(e); toast('Startup error: ' + e.message, 8000); });
})();
