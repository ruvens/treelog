# Treelog 🌳

Eine kleine Browser-App, um die Bäume auf einem Grundstück zu dokumentieren:
genauer Standort, Stammumfang, Baumart und beliebig viele Fotos pro Baum.

Es ist eine statische Web-App (reines HTML/CSS/JS, ohne Build-Schritt), gehostet auf GitHub Pages.
Sie läuft auf Handy und Computer und funktioniert nach dem ersten Öffnen auch offline im Garten.

## Funktionen

- **Karte** mit Luftbild (Esri), dem amtlichen bayerischen Orthofoto (DOP40) und OpenStreetMap.
- **Genauer Standort**: Baum mit dem Fadenkreuz auf dem Luftbild setzen oder per GPS messen.
  Die GPS-Messung wird über 20 s gemittelt (gewichtet nach Genauigkeit); die Genauigkeit (± m) wird mitgespeichert.
  Koordinaten lassen sich auch eintippen oder später anpassen.
- **Stammumfang** in cm in 1 m Höhe. Mehrstämmige Bäume: `45+38+30` eingeben, Summe und Durchmesser werden berechnet.
  Bäume ab 80 cm werden hervorgehoben (Schwelle der Münchner Baumschutzverordnung).
- **Baumart** mit Vorschlägen (lateinisch + deutsch), freie Eingabe möglich.
- Höhe, Kronendurchmesser (wird auf der Karte eingezeichnet), Zustand, Aufnahmedatum, Notizen.
- **Fotos**: mit der Kamera aufnehmen oder mehrere Dateien auf einmal wählen; Verkleinerung auf max. 2400 px; Bildbetrachter.
- **Liste** mit Suche und Sortierung.
- **Export**: Komplettsicherung als `.zip` (data.json, CSV, GeoJSON und alle Fotos in Ordnern pro Baum),
  CSV für Excel (Semikolon, Dezimalkomma, UTF-8), GeoJSON für QGIS. **Import** von Sicherungen, um Daten auf andere Geräte zu übertragen.
- Als App installierbar (PWA) und offline nutzbar; angesehene Kartenkacheln werden zwischengespeichert.

## Adresse des Grundstücks

Die Adresse steht nicht im Code. Sie wird einmal im Tab *Daten* → *Grundstück* eingegeben,
auf der Karte gesucht und nur im Browser (und in den Sicherungen) gespeichert.

## Wo werden die Daten gespeichert?

**Nur im Browser des jeweiligen Geräts** (IndexedDB). Es wird nichts hochgeladen,
die Fotos des Grundstücks bleiben also privat, auch wenn die App öffentlich ist.
Daraus folgt:

- Im Tab *Daten* regelmäßig eine **Komplettsicherung** erstellen (z. B. in iCloud/Google Drive ablegen).
- Um auf einem anderen Gerät weiterzuarbeiten, die Sicherung dort importieren.
- Auf dem iPhone die App zum Home-Bildschirm hinzufügen („Teilen → Zum Home-Bildschirm“), damit Safari die Daten nicht löscht.

## Veröffentlichen auf GitHub Pages

1. Im Repository: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**,
   Branch **`main`**, Ordner **`/ (root)`** → *Save*.
2. Nach ein bis zwei Minuten ist die App unter `https://ruvens.github.io/treelog/` erreichbar.
   Jeder Push auf `main` wird automatisch neu veröffentlicht.

Hinweis: Mit einem kostenlosen GitHub-Konto muss das Repository dafür öffentlich sein. Öffentlich ist dann nur der Code,
nicht die Baumdaten (die liegen im Browser).

## Lokal starten

Jeder statische Webserver funktioniert, z. B.

```sh
python3 -m http.server 8000
# http://localhost:8000 öffnen
```

GPS funktioniert nur über HTTPS oder `localhost`.

## Aufbau

```
index.html            Oberfläche
css/app.css           Styles
js/app.js             App-Logik (Karte, Erfassung, Fotos, Export/Import)
js/db.js              Speicherung in IndexedDB
js/species.js         Vorschlagsliste Baumarten
sw.js                 Service Worker (offline)
vendor/               Leaflet 1.9.4, JSZip 3.10.1
```

Kartendaten: © OpenStreetMap-Mitwirkende · Luftbild © Esri · Orthofoto © Bayerische Vermessungsverwaltung (CC BY 4.0).
