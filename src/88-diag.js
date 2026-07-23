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
      for (let i = 2; i < st.length; i++) {
        const m = /at ([A-Za-z_$][\w$]*)/.exec(st[i]);
        if (m && !/^(diag|pushUndo|pushUndoSnap|Object)/i.test(m[1])) return m[1];
      }
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

