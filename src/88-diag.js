  /* ============ TEMPORAERE Diagnose fuer Undo/Redo ============
     Aktivierung: einmal mit ?diag=1 aufrufen (bleibt fuer den Tab aktiv),
     Abschalten:  mit ?diag=0 aufrufen oder Tab schliessen.
     Nach der Fehlersuche ersatzlos entfernbar (diese Datei + die diagLog-Aufrufe). */
  const DIAG = (function () {
    try {
      if (/[?&]diag=1/.test(location.search)) sessionStorage.setItem('pmx_diag', '1');
      if (/[?&]diag=0/.test(location.search)) sessionStorage.removeItem('pmx_diag');
      return sessionStorage.getItem('pmx_diag') === '1';
    } catch (e) { return /[?&]diag=1/.test(location.search); }
  })();
  const _diagLines = [];

  // Ermittelt den ausloesenden Funktionsnamen aus dem Aufruf-Stapel (keine Aenderung an den Aufrufstellen noetig).
  function diagCaller() {
    try {
      const st = String((new Error()).stack || '').split('\n');
      const names = [];
      for (let i = 2; i < st.length && names.length < 2; i++) {
        const m = /at ([A-Za-z_$][\w$]*)/.exec(st[i]);
        if (m && !/^(diag|pushUndo|pushUndoSnap|Object)/i.test(m[1])) names.push(m[1]);
      }
      if (names.length) return names.join(' ← ');
    } catch (e) { /* egal */ }
    return '?';
  }

  function diagLog(kind, text) {
    if (!DIAG) return;
    const d = new Date();
    const ts = d.toLocaleTimeString('de-DE', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    _diagLines.push(ts + '  ' + kind + '  ' + text);
    if (_diagLines.length > 300) _diagLines.shift();
    renderDiag();
  }

  function diagNames(list) {
    const n = (list || []).map(function (o) { return (o.name || o.id || '?'); });
    return n.length ? n.join(', ') : '–';
  }

  // Welche Felder unterscheiden sich zwischen zwei Staenden desselben Objekts?
  function diagDiff(a, b) {
    const f = [];
    const c = function (k, x, y) { if (x !== y) f.push(k); };
    c('name', a.name, b.name); c('farbe', a.color, b.color); c('ebene', a.layerId, b.layerId);
    c('typ', a.symbolType, b.symbolType); c('x', a.x, b.x); c('y', a.y, b.y);
    c('drehung', a.rotation || 0, b.rotation || 0);
    c('größe', a.scale == null ? 1 : a.scale, b.scale == null ? 1 : b.scale);
    c('sichtbar', a.visible !== false, b.visible !== false);
    c('sps', a.plcConfigId || '', b.plcConfigId || '');
    if (JSON.stringify(a.points || null) !== JSON.stringify(b.points || null)) f.push('punkte');
    if (JSON.stringify(a.metatags || []) !== JSON.stringify(b.metatags || [])) f.push('tags');
    return f.length ? f.join('+') : '?';
  }
  function diagErr(e) {
    if (!e) return 'unbekannt';
    return (e.status ? e.status + ' ' : '') + (e.message || String(e));
  }
  function renderDiag() {
    if (!DIAG) return;
    let box = document.getElementById('diagBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'diagBox';
      box.className = 'diag-box';
      const head = document.createElement('div');
      head.className = 'diag-head';
      head.appendChild(document.createTextNode('Undo/Redo-Diagnose'));
      const bCopy = document.createElement('button'); bCopy.textContent = 'kopieren';
      const bClear = document.createElement('button'); bClear.textContent = 'leeren';
      const bHide = document.createElement('button'); bHide.textContent = '–';
      head.appendChild(bCopy); head.appendChild(bClear); head.appendChild(bHide);
      const pre = document.createElement('pre'); pre.id = 'diagPre';
      box.appendChild(head); box.appendChild(pre);
      document.body.appendChild(box);
      bCopy.addEventListener('click', function () {
        const txt = _diagLines.join('\n');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); toast('Diagnose kopiert'); return; }
        } catch (e) { /* Fallback unten */ }
        window.prompt('Diagnose (kopieren mit Strg+C):', txt);
      });
      bClear.addEventListener('click', function () { _diagLines.length = 0; renderDiag(); });
      bHide.addEventListener('click', function () { box.classList.toggle('mini'); });
    }
    const pre = document.getElementById('diagPre');
    if (pre) { pre.textContent = _diagLines.slice(-60).join('\n'); pre.scrollTop = pre.scrollHeight; }
  }

