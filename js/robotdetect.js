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

  // Ausschnitt eines Graubilds kopieren (geklemmt).
  function cropGray(img, x0, y0, cw, ch) {
    cw = Math.min(cw, img.w); ch = Math.min(ch, img.h);
    x0 = Math.max(0, Math.min(img.w - cw, Math.round(x0)));
    y0 = Math.max(0, Math.min(img.h - ch, Math.round(y0)));
    var out = new Float32Array(cw * ch);
    for (var y = 0; y < ch; y++) {
      var sr = (y0 + y) * img.w + x0, dr = y * cw;
      for (var x = 0; x < cw; x++) out[dr + x] = img.data[sr + x];
    }
    return { data: out, w: cw, h: ch, x0: x0, y0: y0 };
  }

  // Bester NCC-Treffer von Tg (und optional Kanten Te) in einem kleinen Fenster um (cx,cy) von Lg/Le.
  function localBest(Lg, Le, Tg, Te, cx, cy, pad) {
    var tw = Tg.w, th = Tg.h;
    var cw = Math.min(Lg.w, tw + 2 * pad), ch = Math.min(Lg.h, th + 2 * pad);
    var Cg = cropGray(Lg, cx - cw / 2, cy - ch / 2, cw, ch);
    var r;
    if (Le && Te) {
      var rg = matchTemplate(Cg, Tg);
      var Ce = cropGray(Le, cx - cw / 2, cy - ch / 2, cw, ch);
      var re = matchTemplate(Ce, Te);
      var n = rg.map.length, map = new Float32Array(n);
      for (var q = 0; q < n; q++) map[q] = 0.5 * (rg.map[q] + re.map[q]);
      r = { map: map, mw: rg.mw, mh: rg.mh };
    } else {
      r = matchTemplate(Cg, Tg);
    }
    var best = -1, bx = 0, by = 0;
    for (var y = 0; y < r.mh; y++) for (var x = 0; x < r.mw; x++) { var s = r.map[y * r.mw + x]; if (s > best) { best = s; bx = x; by = y; } }
    return { score: best, cx: Cg.x0 + bx + tw / 2, cy: Cg.y0 + by + th / 2 };
  }

  /*
   * Schnelle Mehrvorlagen-Erkennung (Coarse-to-Fine):
   * 1) grobe Vorsuche in kleiner Aufloesung (coarseW) ueber alle Vorlagen/Skalen -> Kandidaten (mit Vorlage+Skala),
   * 2) feine NCC-Nachpruefung nur in kleinen Fenstern um die Kandidaten (workW),
   * 3) Negativ-Vorlagen nur LOKAL an den finalen Treffern pruefen (statt ueber das ganze Bild).
   * Gleiche Ergebnisform wie detectMulti; um Groessenordnungen weniger Rechenarbeit.
   */
  function detectMultiFast(layout, templates, opts) {
    opts = opts || {};
    var workW = opts.workW || 300;
    var baseFrac = opts.baseFrac || 0.161;
    var scales = opts.scales || [0.72, 0.86, 1.0, 1.16, 1.32];
    var thr = opts.threshold != null ? opts.threshold : 0.6;
    var maxResults = opts.maxResults || 12;
    var coarseW = opts.coarseW || 132;
    var negs = opts.negatives || [];
    var workH = Math.max(1, Math.round(layout.h * workW / layout.w));
    var cH = Math.max(1, Math.round(layout.h * coarseW / layout.w));
    var Lc = resizeGray(layout, coarseW, cH);
    var Lec = opts.combine ? sobelMag(Lc) : null;
    var Lg = resizeGray(layout, workW, workH);
    var Le = opts.combine ? sobelMag(Lg) : null;
    // 1) grobe Vorsuche: pro Vorlage/Skala die Top-K-Positionen als Kandidaten weiterreichen (Ranking,
    //    keine absolute Schwelle - bei kleiner Aufloesung sacken NCC-Scores durch Aliasing ab; die echten
    //    Positionen ranken aber weiterhin oben). Die Feinstufe entscheidet mit der echten Schwelle.
    var topK = opts.coarseTopK || 6;
    var cands = [];
    for (var t = 0; t < templates.length; t++) {
      var tpl = templates[t]; if (!tpl) continue;
      for (var s = 0; s < scales.length; s++) {
        var twc = Math.max(8, Math.round(baseFrac * coarseW * scales[s]));
        if (twc >= coarseW || twc >= cH) continue;
        var Tc = resizeGray(tpl, twc, twc);
        var r;
        if (opts.combine) {
          var rg = matchTemplate(Lc, Tc), re = matchTemplate(Lec, sobelMag(Tc));
          var n0 = rg.map.length, map0 = new Float32Array(n0);
          for (var q0 = 0; q0 < n0; q0++) map0[q0] = 0.5 * (rg.map[q0] + re.map[q0]);
          r = { map: map0, mw: rg.mw, mh: rg.mh };
        } else {
          r = matchTemplate(Lc, Tc);
        }
        // alle Positionen sammeln, absteigend sortieren, mit lokalem Abstand (0.7*twc) die Top-K nehmen
        var pos = [];
        for (var yy = 0; yy < r.mh; yy++) for (var xx = 0; xx < r.mw; xx++) pos.push({ sc: r.map[yy * r.mw + xx], px: xx, py: yy });
        pos.sort(function (a, b) { return b.sc - a.sc; });
        var takenC = [], md = 0.7 * twc;
        for (var p0 = 0; p0 < pos.length && takenC.length < topK; p0++) {
          var cnd = pos[p0], okc = true;
          for (var q1 = 0; q1 < takenC.length; q1++) {
            var ddx = cnd.px - takenC[q1].px, ddy = cnd.py - takenC[q1].py;
            if (ddx * ddx + ddy * ddy < md * md) { okc = false; break; }
          }
          if (okc) { takenC.push(cnd); cands.push({ score: cnd.sc, x: (cnd.px + twc / 2) / coarseW, y: (cnd.py + twc / 2) / cH, t: t, s: s }); }
        }
      }
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    // grobe NMS + Deckel (mehr Kandidaten als Endergebnisse zulassen)
    var capD = (opts.mergeDist || 0.05) * 0.8, cap = Math.max(24, maxResults * 3), picks = [];
    for (var k0 = 0; k0 < cands.length; k0++) {
      var c0 = cands[k0], ok0 = true;
      for (var m0 = 0; m0 < picks.length; m0++) {
        var dx0 = c0.x - picks[m0].x, dy0 = c0.y - picks[m0].y;
        if (dx0 * dx0 + dy0 * dy0 < capD * capD) { ok0 = false; break; }
      }
      if (ok0) { picks.push(c0); if (picks.length >= cap) break; }
    }
    // 2) feine Nachpruefung nur um die Kandidaten - je Kandidat ueber ALLE Skalen lokal (kleine Fenster,
    //    billig) und die beste nehmen. Grund: Grobscores sind ueber Skalen hinweg nicht vergleichbar;
    //    die Grob-NMS kann sonst den Kandidaten mit der richtigen Skala zugunsten einer falschen verdraengen.
    var fined = [], tplG = {}, tplE = {};
    for (var k1 = 0; k1 < picks.length; k1++) {
      var c1 = picks[k1], bestB = null, bestTw = 0;
      for (var s1 = 0; s1 < scales.length; s1++) {
        var tw = Math.max(10, Math.round(baseFrac * workW * scales[s1]));
        if (tw >= workW || tw >= workH) continue;
        var key = c1.t + '_' + tw;
        var Tg = tplG[key]; if (!Tg) { Tg = resizeGray(templates[c1.t], tw, tw); tplG[key] = Tg; }
        var Te = null; if (opts.combine) { Te = tplE[key]; if (!Te) { Te = sobelMag(Tg); tplE[key] = Te; } }
        var b1 = localBest(Lg, Le, Tg, Te, c1.x * workW, c1.y * workH, Math.round(tw * 0.55));
        if (!bestB || b1.score > bestB.score) { bestB = b1; bestTw = tw; }
      }
      if (bestB && bestB.score >= thr) fined.push({ x: bestB.cx / workW, y: bestB.cy / workH, score: bestB.score, tw: bestTw });
    }
    fined.sort(function (a, b) { return b.score - a.score; });
    var minD = opts.mergeDist || 0.05, kept = [];
    for (var k2 = 0; k2 < fined.length; k2++) {
      var c2 = fined[k2], ok2 = true;
      for (var m2 = 0; m2 < kept.length; m2++) {
        var dx2 = c2.x - kept[m2].x, dy2 = c2.y - kept[m2].y;
        if (dx2 * dx2 + dy2 * dy2 < minD * minD) { ok2 = false; break; }
      }
      if (ok2) { kept.push(c2); if (kept.length >= maxResults) break; }
    }
    // 3) Hard Negatives: nur lokal an den Treffern pruefen (gleiche Skala wie der Treffer)
    if (negs.length && kept.length) {
      var negThr = opts.negThreshold != null ? opts.negThreshold : 0.5;
      var margin = opts.negMargin != null ? opts.negMargin : 0.08;
      var out = [];
      for (var k3 = 0; k3 < kept.length; k3++) {
        var c3 = kept[k3], isNeg = false;
        for (var n3 = 0; n3 < negs.length; n3++) {
          if (!negs[n3]) continue;
          var Ng = resizeGray(negs[n3], c3.tw, c3.tw);
          var Ne = opts.combine ? sobelMag(Ng) : null;
          var nb = localBest(Lg, Le, Ng, Ne, c3.x * workW, c3.y * workH, Math.round(c3.tw * 0.55));
          if (nb.score >= Math.max(negThr, c3.score - margin)) { isNeg = true; break; }
        }
        if (!isNeg) out.push({ x: c3.x, y: c3.y, score: c3.score });
      }
      return out;
    }
    var res = [];
    for (var k4 = 0; k4 < kept.length; k4++) res.push({ x: kept[k4].x, y: kept[k4].y, score: kept[k4].score });
    return res;
  }

  return { grayFromRGBA: grayFromRGBA, resizeGray: resizeGray, matchTemplate: matchTemplate, detect: detect, detectMulti: detectMulti, detectMultiFast: detectMultiFast, similarity: similarity, sobelMag: sobelMag, cropGray: cropGray, localBest: localBest };

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
