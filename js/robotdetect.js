/*
 * robotdetect.js - leichte Roboter-Erkennung per Template-Matching (NCC), ohne externe Libs.
 * Läuft im Browser (window.RobotDetect) und in Node (module.exports) für Tests.
 * Idee: die runde Roboterbasis als Vorlage über mehrere Skalen im Layout suchen,
 * normalisierte Kreuzkorrelation (NCC) als Konfidenz, Non-Max-Suppression.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RobotDetect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // RGBA (Uint8ClampedArray) -> Graustufen (Float32)
  function grayFromRGBA(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return { data: g, w: w, h: h };
  }

  // Bilineare Skalierung eines Graubilds
  function resizeGray(src, nw, nh) {
    const data = src.data, w = src.w, h = src.h;
    const out = new Float32Array(nw * nh);
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      let fy = (y + 0.5) * sy - 0.5; let y0 = Math.floor(fy); const dy = fy - y0;
      let y1 = y0 + 1; if (y0 < 0) y0 = 0; if (y0 > h - 1) y0 = h - 1; if (y1 < 0) y1 = 0; if (y1 > h - 1) y1 = h - 1;
      for (let x = 0; x < nw; x++) {
        let fx = (x + 0.5) * sx - 0.5; let x0 = Math.floor(fx); const dx = fx - x0;
        let x1 = x0 + 1; if (x0 < 0) x0 = 0; if (x0 > w - 1) x0 = w - 1; if (x1 < 0) x1 = 0; if (x1 > w - 1) x1 = w - 1;
        const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
        out[y * nw + x] = a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
      }
    }
    return { data: out, w: nw, h: nh };
  }

  // Integralbilder (Summe + Quadratsumme) mit (w+1)x(h+1)-Rand
  function integrals(img) {
    const data = img.data, w = img.w, h = img.h, W = w + 1;
    const S = new Float64Array(W * (h + 1)), Q = new Float64Array(W * (h + 1));
    for (let y = 1; y <= h; y++) {
      let rs = 0, rq = 0;
      for (let x = 1; x <= w; x++) {
        const v = data[(y - 1) * w + (x - 1)];
        rs += v; rq += v * v;
        S[y * W + x] = S[(y - 1) * W + x] + rs;
        Q[y * W + x] = Q[(y - 1) * W + x] + rq;
      }
    }
    return { S: S, Q: Q, W: W };
  }
  function boxSum(I, x, y, tw, th) {
    const W = I.W, x2 = x + tw, y2 = y + th;
    return I.S[y2 * W + x2] - I.S[y * W + x2] - I.S[y2 * W + x] + I.S[y * W + x];
  }
  function boxSqSum(I, x, y, tw, th) {
    const W = I.W, x2 = x + tw, y2 = y + th;
    return I.Q[y2 * W + x2] - I.Q[y * W + x2] - I.Q[y2 * W + x] + I.Q[y * W + x];
  }

  // NCC-Scoremap von tpl (klein) über img (groß)
  function matchTemplate(img, tpl) {
    const iw = img.w, ih = img.h, tw = tpl.w, th = tpl.h;
    const mw = iw - tw + 1, mh = ih - th + 1;
    if (mw <= 0 || mh <= 0) return { map: new Float32Array(0), mw: 0, mh: 0 };
    const map = new Float32Array(mw * mh);
    const n = tw * th;
    let tmean = 0; for (let i = 0; i < n; i++) tmean += tpl.data[i]; tmean /= n;
    const tp = new Float32Array(n); let tss = 0;
    for (let i = 0; i < n; i++) { const v = tpl.data[i] - tmean; tp[i] = v; tss += v * v; }
    const invTss = tss > 1e-6 ? 1 / Math.sqrt(tss) : 0;
    const I = integrals(img);
    for (let v = 0; v < mh; v++) {
      for (let u = 0; u < mw; u++) {
        let corr = 0;
        for (let j = 0; j < th; j++) {
          const irow = (v + j) * iw + u, trow = j * tw;
          for (let i = 0; i < tw; i++) corr += img.data[irow + i] * tp[trow + i];
        }
        const s = boxSum(I, u, v, tw, th);
        const q = boxSqSum(I, u, v, tw, th);
        const varSum = q - s * s / n;
        const denom = varSum > 1e-6 ? Math.sqrt(varSum) : 0;
        map[v * mw + u] = (denom > 0 && invTss > 0) ? corr * invTss / denom : 0;
      }
    }
    return { map: map, mw: mw, mh: mh };
  }

  /*
   * detect(layoutGray, tplGray, opts) -> [{x, y, score}] (x,y normiert 0..1 = Zentrum)
   * opts: workW (Arbeitsbreite), baseFrac (Basis/Layoutbreite), scales[], threshold, maxResults
   */
  // Gradientenbetrag (Sobel) – für Kanten-Matching bei Strichzeichnungen.
  function sobelMag(img) {
    const w = img.w, h = img.h, d = img.data;
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1];
        const e = d[i - 1], f = d[i + 1];
        const g = d[i + w - 1], hh = d[i + w], k = d[i + w + 1];
        const gx = (c + 2 * f + k) - (a + 2 * e + g);
        const gy = (g + 2 * hh + k) - (a + 2 * b + c);
        out[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return { data: out, w: w, h: h };
  }

  function detect(layout, tpl, opts) {
    opts = opts || {};
    const workW = opts.workW || 300;
    const baseFrac = opts.baseFrac || 0.161;
    const scales = opts.scales || [0.72, 0.86, 1.0, 1.16, 1.32];
    const thr = opts.threshold != null ? opts.threshold : 0.6;
    const maxResults = opts.maxResults || 12;
    const workH = Math.max(1, Math.round(layout.h * workW / layout.w));
    const Lg = resizeGray(layout, workW, workH);
    const Le = (opts.edge || opts.combine) ? sobelMag(Lg) : null;
    const baseTpl = Math.max(12, Math.round(baseFrac * workW));
    const cands = [];
    for (let s = 0; s < scales.length; s++) {
      const tw = Math.max(10, Math.round(baseTpl * scales[s]));
      if (tw >= workW || tw >= workH) continue;
      const Tg = resizeGray(tpl, tw, tw);
      let r;
      if (opts.combine) {
        const rg = matchTemplate(Lg, Tg), re = matchTemplate(Le, sobelMag(Tg));
        const n = rg.map.length, map = new Float32Array(n);
        for (let q = 0; q < n; q++) map[q] = 0.5 * (rg.map[q] + re.map[q]);
        r = { map: map, mw: rg.mw, mh: rg.mh };
      } else if (opts.edge) {
        r = matchTemplate(Le, sobelMag(Tg));
      } else {
        r = matchTemplate(Lg, Tg);
      }
      for (let y = 0; y < r.mh; y++) {
        for (let x = 0; x < r.mw; x++) {
          const sc = r.map[y * r.mw + x];
          if (sc >= thr) cands.push({ score: sc, cx: x + tw / 2, cy: y + tw / 2, tw: tw });
        }
      }
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    const kept = [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]; let ok = true;
      for (let k = 0; k < kept.length; k++) {
        const md = Math.max(c.tw, kept[k].tw) * 0.5;
        const ddx = c.cx - kept[k].cx, ddy = c.cy - kept[k].cy;
        if (ddx * ddx + ddy * ddy < md * md) { ok = false; break; }
      }
      if (ok) { kept.push(c); if (kept.length >= maxResults) break; }
    }
    return kept.map(function (c) { return { x: c.cx / workW, y: c.cy / workH, score: c.score }; });
  }

  return { grayFromRGBA: grayFromRGBA, resizeGray: resizeGray, matchTemplate: matchTemplate, detect: detect, detectMulti: detectMulti, similarity: similarity };

  // Erkennung mit mehreren Vorlagen + optionalen Negativ-Vorlagen (Hard Negatives).
  function detectMulti(layout, templates, opts) {
    opts = opts || {};
    var negs = opts.negatives || [];
    var all = [];
    for (var i = 0; i < templates.length; i++) {
      if (!templates[i]) continue;
      var r = detect(layout, templates[i], opts);
      for (var j = 0; j < r.length; j++) all.push(r[j]);
    }
    all.sort(function (a, b) { return b.score - a.score; });
    var minD = opts.mergeDist || 0.05, kept = [];
    for (var k = 0; k < all.length; k++) {
      var c = all[k], ok = true;
      for (var m = 0; m < kept.length; m++) {
        var dx = c.x - kept[m].x, dy = c.y - kept[m].y;
        if (dx * dx + dy * dy < minD * minD) { ok = false; break; }
      }
      if (ok) kept.push(c);
    }
    // Hard Negatives: Treffer verwerfen, an denen eine Negativ-Vorlage mindestens ähnlich stark matcht.
    if (negs.length && kept.length) {
      var negHits = [];
      var nOpts = { workW: opts.workW, edge: opts.edge, combine: opts.combine, threshold: (opts.negThreshold != null ? opts.negThreshold : 0.5), scales: opts.scales };
      for (var n = 0; n < negs.length; n++) {
        if (!negs[n]) continue;
        var rn = detect(layout, negs[n], nOpts);
        for (var p = 0; p < rn.length; p++) negHits.push(rn[p]);
      }
      var margin = opts.negMargin != null ? opts.negMargin : 0.08;
      kept = kept.filter(function (c2) {
        return !negHits.some(function (nh) {
          var ddx = c2.x - nh.x, ddy = c2.y - nh.y;
          return (ddx * ddx + ddy * ddy < minD * minD) && nh.score >= c2.score - margin;
        });
      });
    }
    return kept;
  }

  // NCC-Ähnlichkeit zweier gleich großer Graubilder (für Dedupe). 1 = identisch.
  function similarity(a, b) {
    if (!a || !b || a.w !== b.w || a.h !== b.h) return 0;
    var r = matchTemplate(a, b);
    return r.map.length ? r.map[0] : 0;
  }
});
