#!/usr/bin/env node
/*
 * build.js — fügt die Quell-Fragmente aus src/*.js in fester Reihenfolge
 * wieder zu js/app.js zusammen (ein einziges IIFE, wie zuvor).
 *
 * WORKFLOW:
 *   1. Logik in src/<NN>-<name>.js bearbeiten (nach Feature getrennt).
 *   2. `node build.js` ausführen  →  regeneriert js/app.js.
 *   3. BEIDE committen (src/ UND js/app.js) und pushen.
 *      Plesk liefert js/app.js direkt aus – KEIN Build auf dem Server.
 *
 * Die Dateien werden ALPHABETISCH nach Name konkateniert (Präfix 00,10,20…90
 * bestimmt die Reihenfolge). Reine Text-Konkatenation → keine Semantik-Änderung.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'js', 'app.js');

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
if (!files.length) { console.error('Keine src/*.js gefunden – Abbruch.'); process.exit(1); }

let out = '';
for (const f of files) out += fs.readFileSync(path.join(SRC, f), 'utf8');

fs.writeFileSync(OUT, out, 'utf8');
console.log('js/app.js gebaut aus ' + files.length + ' Fragmenten:');
files.forEach((f) => console.log('  ' + f));
console.log('Gesamt: ' + out.split('\n').length + ' Zeilen, ' + out.length + ' Bytes.');
