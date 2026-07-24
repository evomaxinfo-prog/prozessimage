/*
 * robotworker.js - fuehrt die (synchrone, rechenintensive) Roboter-Erkennung im Web Worker aus,
 * damit der Hauptthread frei bleibt (kein "Seite reagiert nicht"). Laedt robotdetect.js per importScripts.
 */
importScripts('robotdetect.js?v=1.2.49');

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var RD = self.RobotDetect;
    var fn = RD.detectMultiFast || RD.detectMulti; // Fast-Variante (Coarse-to-Fine), Fallback alte
    var found = fn(d.layout, d.templates, d.opts);
    self.postMessage({ ok: true, found: found });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
