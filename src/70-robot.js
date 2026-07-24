  // ===== Roboter-Erkennung (Vorschlag + Bestätigung) =====
  function loadLayoutGray() {
    return new Promise(function (resolve, reject) {
      if (!state.layoutBlobUrl) { reject(new Error('kein Layout')); return; }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, maxW = 900;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
        var d = cx.getImageData(0, 0, w, h);
        resolve(RobotDetect.grayFromRGBA(d.data, w, h));
      };
      img.onerror = reject; img.src = state.layoutBlobUrl;
    });
  }
  // --- Vorlagen-Bibliothek (browser-lokal): aus bestätigten/gesetzten Robotern lernen ---
  function tplLibKey() { return 'promodx_robot_templates'; }
  function loadTplLib() { try { return JSON.parse(localStorage.getItem(tplLibKey()) || '[]'); } catch (e) { return []; } }
  function saveTplLib(arr) { try { localStorage.setItem(tplLibKey(), JSON.stringify(arr)); } catch (e) { /* Speicher voll */ } }
  function urlToGray(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        var d = cx.getImageData(0, 0, cv.width, cv.height);
        resolve(RobotDetect.grayFromRGBA(d.data, cv.width, cv.height));
      };
      img.onerror = reject; img.src = url;
    });
  }
  function posLib() { return loadTplLib().filter(function (e) { return !e.neg; }); }
  function negLib() { return loadTplLib().filter(function (e) { return e.neg; }); }
  function delTplEntry(id) { saveTplLib(loadTplLib().filter(function (e) { return e.id !== id; })); }
  function loadPosNegGray() {
    var lib = loadTplLib();
    var posUrls = ['img/robot-template.png?v=0.25.52'].concat(lib.filter(function (e) { return !e.neg; }).map(function (e) { return e.url; }));
    var negUrls = lib.filter(function (e) { return e.neg; }).map(function (e) { return e.url; });
    function decode(urls) { return Promise.all(urls.map(function (u) { return urlToGray(u).catch(function () { return null; }); })).then(function (a) { return a.filter(Boolean); }); }
    // Fast identische Vorlagen nur einmal rechnen (NCC-Aehnlichkeit auf 132px) – spart ganze Erkennungslaeufe.
    function dedupe(list) {
      var out = [], small = [];
      for (var i = 0; i < list.length; i++) {
        var g = RobotDetect.resizeGray(list[i], 132, 132), dup = false;
        for (var k = 0; k < small.length; k++) { if (RobotDetect.similarity(small[k], g) >= 0.93) { dup = true; break; } }
        if (!dup) { small.push(g); out.push(list[i]); }
      }
      return out;
    }
    return Promise.all([decode(posUrls), decode(negUrls)]).then(function (a) { return { pos: dedupe(a[0]), neg: dedupe(a[1]) }; });
  }
  // Höchste Ähnlichkeit eines neuen 132er-Graubilds zu den angegebenen Vorlagen-URLs (für Dedupe/Vergiftungsschutz).
  function maxSimilarityTo(newGray, urls) {
    if (!urls.length) return Promise.resolve(0);
    return Promise.all(urls.map(function (u) {
      return urlToGray(u).then(function (g) { return RobotDetect.similarity(RobotDetect.resizeGray(g, 132, 132), newGray); }).catch(function () { return 0; });
    })).then(function (sc) { return sc.length ? Math.max.apply(null, sc) : 0; });
  }
  function captureRobotTemplate(nx, ny) {
    return new Promise(function (resolve, reject) {
      if (!state.layoutBlobUrl) { reject(); return; }
      var img = new Image();
      img.onload = function () {
        var W = img.naturalWidth, H = img.naturalHeight;
        var side = Math.max(24, Math.round(0.161 * W));
        var cx = Math.round(nx * W), cy = Math.round(ny * H);
        var x0 = Math.max(0, Math.min(W - side, cx - Math.round(side / 2)));
        var y0 = Math.max(0, Math.min(H - side, cy - Math.round(side / 2)));
        var out = document.createElement('canvas'); out.width = 132; out.height = 132;
        var o = out.getContext('2d'); o.drawImage(img, x0, y0, side, side, 0, 0, 132, 132);
        var d = o.getImageData(0, 0, 132, 132);
        for (var i = 0; i < d.data.length; i += 4) { var g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]; d.data[i] = d.data[i + 1] = d.data[i + 2] = g; }
        o.putImageData(d, 0, 0);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = reject; img.src = state.layoutBlobUrl;
    });
  }
  function promptLearnTemplate(nx, ny) {
    if (!state.layoutBlobUrl || !window.RobotDetect) return;
    captureRobotTemplate(nx, ny).then(function (url) {
      state.learnPrompt = { url: url };
      renderEditor();
    }).catch(function () { /* kein Layout */ });
  }
  function learnPromptLayer() {
    var lp = state.learnPrompt;
    if (!lp) return '';
    return '<div class="learn-prompt">'
      + '<img class="lp-thumb" src="' + lp.url + '" alt="">'
      + '<div class="lp-body"><div class="lp-txt">' + t('Diesen Ausschnitt als Roboter-Vorlage lernen?') + '</div>'
      + '<div class="lp-btns"><button class="lp-yes" data-act="tpl-learn-yes">' + t('Als Vorlage lernen') + '</button>'
      + '<button class="lp-no" data-act="tpl-learn-no">' + t('Nein') + '</button></div></div></div>';
  }
  function confirmLearnPrompt() {
    var lp = state.learnPrompt; if (!lp) return;
    state.learnPrompt = null;
    urlToGray(lp.url).then(function (ng) {
      return maxSimilarityTo(ng, posLib().map(function (e) { return e.url; }));
    }).then(function (sim) {
      if (sim > 0.92) { toast(t('Ähnliche Vorlage bereits vorhanden – übersprungen.')); renderEditor(); return; }
      var lib = loadTplLib();
      lib.push({ id: 'tpl_' + Date.now(), url: lp.url, neg: false });
      if (lib.length > 24) lib = lib.slice(lib.length - 24);
      saveTplLib(lib);
      toast(t('Als Vorlage gelernt') + ' (' + posLib().length + ')');
      renderEditor();
    }).catch(function () { renderEditor(); });
  }
  function dismissLearnPrompt() { state.learnPrompt = null; renderEditor(); }
  function tplPanelHtml() {
    if (!state.tplPanel) return '';
    var pos = posLib(), neg = negLib();
    var thumbs = pos.length ? pos.map(function (e) {
      return '<div class="tp-item"><img src="' + e.url + '" alt=""><button class="tp-del" data-act="tpl-del" data-id="' + e.id + '" title="' + t('Löschen') + '">×</button></div>';
    }).join('') : '<div class="tp-empty">' + t('Noch keine gelernten Vorlagen.') + '</div>';
    return '<div class="tpl-panel">'
      + '<div class="tp-head">' + t('Positive Vorlagen') + ' (' + pos.length + ')</div>'
      + '<div class="tp-grid">' + thumbs + '</div>'
      + (neg.length ? '<div class="tp-neg">' + t('Fehlbeispiele') + ': ' + neg.length + ' · <button class="tpl-linkbtn" data-act="neg-reset">' + t('zurücksetzen') + '</button></div>' : '')
      + ((pos.length || neg.length) ? '<div class="tp-foot"><button class="tpl-linkbtn" data-act="tpl-reset">' + t('Alle zurücksetzen') + '</button></div>' : '')
      + '</div>';
  }
  // Aus einer Ablehnung lernen: Region als Fehlbeispiel (Negativ) merken – aber nicht, wenn sie einem bekannten Roboter ähnelt.
  function learnNegativeTemplate(nx, ny) {
    if (!state.layoutBlobUrl || !window.RobotDetect) return;
    captureRobotTemplate(nx, ny).then(function (url) {
      return urlToGray(url).then(function (ng) {
        return maxSimilarityTo(ng, posLib().map(function (e) { return e.url; }).concat(['img/robot-template.png?v=0.25.52'])).then(function (simPos) {
          if (simPos > 0.9) return; // ähnelt echtem Roboter -> nicht als Fehlbeispiel merken
          return maxSimilarityTo(ng, negLib().map(function (e) { return e.url; })).then(function (simNeg) {
            if (simNeg > 0.92) return; // schon ähnliches Fehlbeispiel vorhanden
            var lib = loadTplLib();
            lib.push({ id: 'neg_' + Date.now(), url: url, neg: true });
            if (lib.length > 24) lib = lib.slice(lib.length - 24);
            saveTplLib(lib);
            toast(t('Als Fehlbeispiel gemerkt') + ' (' + negLib().length + ')');
          });
        });
      });
    }).catch(function () { /* egal */ });
  }

  // Roboter-Erkennung im Web Worker ausfuehren (Hauptthread bleibt frei -> kein "Seite reagiert nicht").
  // Faellt bei fehlendem/fehlgeschlagenem Worker sauber auf synchrone Ausfuehrung zurueck.
  function runRobotDetect(layout, templates, opts) {
    return new Promise(function (resolve, reject) {
      function syncFallback() { setTimeout(function () { try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e) { reject(e); } }, 30); }
      if (typeof Worker === 'undefined') { syncFallback(); return; }
      var w, done = false, dog = 0;
      try { w = new Worker('js/robotworker.js?v=1.2.50'); } catch (e) { syncFallback(); return; }
      // Watchdog: antwortet der Worker nicht (Haenger), sauber abbrechen statt fuer immer "gruen" zu bleiben.
      dog = setTimeout(function () {
        if (done) return; done = true;
        try { w.terminate(); } catch (_) { /* noop */ }
        reject(new Error('Zeitueberschreitung bei der Erkennung'));
      }, 60000);
      w.onmessage = function (ev) {
        if (done) return; done = true; clearTimeout(dog);
        var r = ev.data || {};
        try { w.terminate(); } catch (_) { /* noop */ }
        if (r.ok) resolve(r.found || []);
        else { try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e2) { reject(e2); } }
      };
      w.onerror = function () {
        if (done) return; done = true; clearTimeout(dog);
        try { w.terminate(); } catch (_) { /* noop */ }
        try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e2) { reject(e2); }
      };
      try { w.postMessage({ layout: layout, templates: templates, opts: opts }); }
      catch (e) { done = true; clearTimeout(dog); try { w.terminate(); } catch (_) { /* noop */ } syncFallback(); }
    });
  }
  function detectRobotsFlow() {
    if (!window.RobotDetect || !state.layoutBlobUrl) { toast(t('Kein Layout vorhanden.')); return; }
    if (state.robotDetecting) return;
    state.robotDetecting = true; toast(t('Erkenne Roboter …'));
    try { var _rb = document.querySelector('.zone-btn[data-act="detect-robots"]'); if (_rb) _rb.classList.add('active'); } catch (_) { /* noop */ }
    Promise.all([loadPosNegGray(), loadLayoutGray()]).then(function (arr) {
      var lib = arr[0], lay = arr[1];
      var opts = { workW: lib.pos.length > 1 ? 260 : 300, threshold: 0.55, combine: true, negatives: lib.neg };
      if (lib.pos.length > 3) opts.scales = [0.8, 1.0, 1.2];
      return runRobotDetect(lay, lib.pos, opts);
    }).then(function (found) {
      var existing = (state.detail.objects || []).filter(function (o) { return o.symbolType === 'robot'; });
      var sugg = found.filter(function (f) { return !existing.some(function (o) { return Math.hypot(o.x - f.x, o.y - f.y) < 0.05; }); });
      state.robotSuggestions = sugg; state.robotDetecting = false; renderEditor();
      toast(sugg.length ? (sugg.length + ' ' + t('Roboter erkannt – bitte bestätigen')) : t('Keine (neuen) Roboter erkannt.'));
    }).catch(function () { state.robotDetecting = false; renderEditor(); toast(t('Erkennung fehlgeschlagen.')); });
  }
  function robotSuggestionLayer() {
    var s = state.robotSuggestions || [];
    if (!s.length) return '';
    return '<div class="robot-sugg-layer">' + s.map(function (r, i) {
      return '<div class="robot-sugg" style="left:' + (r.x * 100) + '%;top:' + (r.y * 100) + '%">'
        + '<div class="rs-ic">' + symInner('robot', 22) + '</div>'
        + '<div class="rs-bar"><span class="rs-score" title="' + t('Konfidenz') + '">' + Math.round(r.score * 100) + '%</span>'
        + '<button class="rs-yes" data-act="rob-confirm" data-idx="' + i + '" title="' + t('Übernehmen') + '">✓</button>'
        + '<button class="rs-no" data-act="rob-dismiss" data-idx="' + i + '" title="' + t('Verwerfen') + '">×</button></div>'
        + '</div>';
    }).join('') + '<button class="rs-clear" data-act="rob-dismiss-all">' + t('Alle verwerfen') + '</button></div>';
  }
  function confirmRobotSuggestion(idx) {
    var s = state.robotSuggestions || []; var r = s[idx]; if (!r) return;
    var L = (state.detail.layers || []).find(function (l) { return l.name === 'Saferobot / Technologie'; });
    if (!L) { toast(t('Roboter-Ebene fehlt.')); return; }
    pushUndo();
    var num = String((state.detail.objects || []).filter(function (o) { return o.symbolType === 'robot'; }).length + 1).padStart(2, '0');
    Api.createObject(state.detail.id, { layerId: L.id, name: 'Roboter_' + num, symbolType: 'robot', color: L.color, x: r.x, y: r.y }).then(function (obj) {
      obj.metatags = obj.metatags || [];
      state.detail.objects.push(obj);
      state.robotSuggestions.splice(idx, 1);
      renderEditor();
    }).catch(function () { toast(t('Speichern fehlgeschlagen.')); });
  }
  function dismissRobotSuggestion(idx) {
    if (!state.robotSuggestions) return;
    var r = state.robotSuggestions[idx];
    if (r && state.layoutBlobUrl) learnNegativeTemplate(r.x, r.y);
    state.robotSuggestions.splice(idx, 1); renderEditor();
  }

  // ===== Kommentare (positionierte Chat-Fenster, Rechtsklick zum Anlegen) =====
