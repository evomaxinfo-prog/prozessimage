  async function onLayoutFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Bitte eine Bilddatei wählen'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('Bild zu groß (max. 8 MB)'); return; }
    if (!state.detail) { toast('Bitte zuerst eine Anlage wählen'); return; }
    if (state.uploadingLayout) { return; } // Doppel-Upload verhindern (Rate-Limit)
    state.uploadingLayout = true;
    toast('Layout wird hochgeladen …');
    try {
      await Api.uploadLayout(state.detail.id, f);
      state.detail.hasLayout = true;
      state.layoutBlobStation = null;
      await ensureLayoutBlob();
      toast('Layout hochgeladen');
      if (state.view === 'editor') renderEditor(); else renderDetail();
    } catch (e2) {
      const msg = /429|too many/i.test(e2 && e2.message ? e2.message : '') ? 'Zu viele Uploads in kurzer Zeit – bitte kurz warten und erneut versuchen.' : ('Upload fehlgeschlagen: ' + (e2 && e2.message ? e2.message : e2));
      toast(msg);
    } finally { state.uploadingLayout = false; }
  }

  let _h2cPromise = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'js/html2canvas.min.js?v=1.2.39';
      sc.onload = () => resolve(window.html2canvas);
      sc.onerror = () => { _h2cPromise = null; reject(new Error('html2canvas nicht geladen')); };
      document.head.appendChild(sc);
    });
    return _h2cPromise;
  }
  // Nimmt die gerenderte Modellierung (#canvasDoc) 1:1 als PNG auf – fuer ein PDF, das exakt der App-Ansicht entspricht.
  async function captureMapImage() {
    const el = document.getElementById('canvasDoc');
    if (!el) throw new Error('Editor-Ansicht (canvasDoc) nicht gefunden');
    const h2c = await loadHtml2Canvas();
    if (typeof h2c !== 'function') throw new Error('html2canvas nicht verfuegbar');
    const prevTransform = el.style.transform;
    el.style.transform = 'none'; // Zoom fuer die Aufnahme neutralisieren
    try {
      const rect = el.getBoundingClientRect();
      const scale = Math.max(1, Math.min(3, 1600 / Math.max(1, rect.width)));
      // Roboter-Maske (grau: weisse Form auf schwarz = Luminanz-Maske) einmalig in eine Alpha-Maske umwandeln.
      let alphaMask = null, mw = 24, mh = 24;
      try {
        const maskImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('mask')); im.src = new URL('img/robot-mask.png', location.href).href; });
        mw = maskImg.naturalWidth || 24; mh = maskImg.naturalHeight || 24;
        const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
        const mx = mc.getContext('2d'); mx.drawImage(maskImg, 0, 0, mw, mh);
        const mid = mx.getImageData(0, 0, mw, mh); const md = mid.data;
        for (let i = 0; i < md.length; i += 4) { const lum = (md[i] + md[i + 1] + md[i + 2]) / 3; md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = lum; }
        mx.putImageData(mid, 0, 0); alphaMask = mc;
      } catch (e) { alphaMask = null; }
      const tintCache = {};
      const tintedRobot = function (color) {
        if (!alphaMask) return null;
        if (tintCache[color]) return tintCache[color];
        const c = document.createElement('canvas'); c.width = mw; c.height = mh;
        const cc = c.getContext('2d');
        cc.fillStyle = color; cc.fillRect(0, 0, mw, mh);
        cc.globalCompositeOperation = 'destination-in'; cc.drawImage(alphaMask, 0, 0);
        return (tintCache[color] = c.toDataURL('image/png'));
      };
      const canvas = await h2c(el, {
        scale: scale, backgroundColor: '#ffffff', useCORS: true, allowTaint: false, logging: false,
        onclone: function (doc) {
          try {
            // Editier-Raster (Snap-/Zeichenraster) nicht ins PDF aufnehmen
            doc.querySelectorAll('.snap-grid, .draw-grid').forEach(function (el) { el.style.display = 'none'; });
            const vw = doc.defaultView || window;
            doc.querySelectorAll('rect').forEach(function (r) {
              if ((r.getAttribute('mask') || '').indexOf('robotMask') < 0) return;
              let col = '#ffffff';
              try { const cs = vw.getComputedStyle(r); col = (cs.fill && cs.fill !== 'none' && cs.fill !== 'currentcolor') ? cs.fill : (cs.color || '#ffffff'); } catch (e) { /* ignore */ }
              const data = tintedRobot(col); if (!data) return;
              const img = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
              img.setAttribute('x', '0'); img.setAttribute('y', '0'); img.setAttribute('width', '24'); img.setAttribute('height', '24');
              img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', data); img.setAttribute('href', data);
              if (r.parentNode) r.parentNode.replaceChild(img, r);
            });
          } catch (e) { /* ignore */ }
        },
      });
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl || dataUrl.length < 100) throw new Error('leeres Bild erzeugt');
      return dataUrl;
    } finally {
      el.style.transform = prevTransform;
    }
  }
  async function exportFile(kind) {
    try {
      if (kind === 'pdf') {
        toast('PDF wird erstellt …');
        let mapImage = null;
        try { mapImage = await captureMapImage(); }
        catch (e) { toast('Modellierung nicht aufgenommen: ' + (e && e.message ? e.message : e)); }
        const res = await Api.raw('/stations/' + state.detail.id + '/export.pdf', { method: 'POST', body: { mapImage: mapImage } });
        if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
        const url = URL.createObjectURL(await res.blob());
        const fn = (state.detail.anlagenname || 'Anlage').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'Anlage';
        const a = document.createElement('a'); a.href = url; a.download = fn + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      const res = await Api.raw('/stations/' + state.detail.id + '/export.' + kind);
      if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = (state.detail.anlagenname || 'anlage').replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(t('Export fehlgeschlagen')); }
  }

  // Editor-spezifische Content-Handler (Drag & Drop, Move, Doppelklick)
  function onContentDragStart(e) {
    const p = e.target.closest('.pal-item'); if (!p) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ sym: p.getAttribute('data-sym'), name: p.getAttribute('data-name'), color: p.getAttribute('data-color') }));
    e.dataTransfer.effectAllowed = 'copy';
  }
  function onContentDragOver(e) { const doc = e.target.closest('#canvasDoc'); if (doc) { e.preventDefault(); doc.classList.add('drop-hi'); } }
  function onContentDragLeave(e) { const doc = e.target.closest('#canvasDoc'); if (doc) doc.classList.remove('drop-hi'); }
  function onContentDrop(e) {
    if (!canEdit()) return;
    const doc = e.target.closest('#canvasDoc'); if (!doc) return;
    e.preventDefault(); doc.classList.remove('drop-hi');
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
    if (data && data.sym) placeFromDrop(e.clientX, e.clientY, data.sym, data.name, data.color);
  }
  function onContentDblClick(e) {
    if (!canEdit() || state.drawZone) return;
    const pl = e.target.closest('.placed');
    if (pl) { e.preventDefault(); openTagModal(pl.getAttribute('data-obj')); }
  }

