/* ProModXgOEM – API-Client
 * Kapselt Basis-URL, Token-Verwaltung (localStorage) und alle Endpunkt-Aufrufe.
 */
(function (global) {
  'use strict';

  const API_BASE = 'https://api.prozessimage.de/api/v1';
  const TOKEN_KEY = 'promodx_token';

  class ApiError extends Error {
    constructor(status, message, data) {
      super(message || ('HTTP ' + status));
      this.status = status;
      this.data = data;
    }
  }

  const Api = {
    ApiError,

    get token() { return localStorage.getItem(TOKEN_KEY); },
    set token(v) {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    },
    get isAuthenticated() { return !!this.token; },

    async request(path, opts) {
      opts = opts || {};
      const hasBody = opts.body !== undefined && opts.body !== null;
      const res = await fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Accept': 'application/json' },
          hasBody ? { 'Content-Type': 'application/json' } : {},
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {},
          opts.headers || {}
        ),
        body: hasBody ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      if (res.status === 204) return null;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(res.status, (data && data.message) || 'Serverfehler.', data);
      }
      return data;
    },

    /** Rohantwort (für Downloads/Bilder), gibt die fetch-Response zurück. */
    async raw(path, opts) {
      opts = opts || {};
      const res = await fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Accept': '*/*' },
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {},
          opts.headers || {}
        ),
      });
      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      return res;
    },

    // ---- Auth ----
    login(email, password) { return this.request('/auth/login', { method: 'POST', body: { email, password } }); },
    me() { return this.request('/auth/me'); },
    logout() { return this.request('/auth/logout', { method: 'POST' }); },
    changePassword(currentPassword, newPassword) {
      return this.request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    },

    // ---- Baum ----
    getTree() { return this.request('/tree'); },
    createNode(parentId, type, name) { return this.request('/nodes', { method: 'POST', body: { parentId, type, name } }); },
    updateNode(id, patch) { return this.request('/nodes/' + id, { method: 'PATCH', body: patch }); },
    deleteNode(id) { return this.request('/nodes/' + id, { method: 'DELETE' }); },
    getWerkOverview(id) { return this.request('/nodes/' + id + '/overview'); },

    // ---- Anlage / Stammdaten (ab Schritt 2) ----
    getStationFull(id) { return this.request('/stations/' + id + '/full'); },
    updateStation(id, patch) { return this.request('/stations/' + id, { method: 'PATCH', body: patch }); },
    addJournal(stationId, text) { return this.request('/stations/' + stationId + '/journal', { method: 'POST', body: { text } }); },
    addPlc(stationId, plc) { return this.request('/stations/' + stationId + '/plcs', { method: 'POST', body: plc }); },
    updatePlc(id, patch) { return this.request('/plcs/' + id, { method: 'PATCH', body: patch }); },
    deletePlc(id) { return this.request('/plcs/' + id, { method: 'DELETE' }); },

    // ---- Editor / Objekte / Layout (ab Schritt 3) ----
    setLayerVisibility(stationId, layerId, visible) {
      return this.request('/stations/' + stationId + '/layers/' + layerId, { method: 'PATCH', body: { visible } });
    },
    createObject(stationId, obj) { return this.request('/stations/' + stationId + '/objects', { method: 'POST', body: obj }); },
    updateObject(id, patch) { return this.request('/objects/' + id, { method: 'PATCH', body: patch }); },
    deleteObject(id) { return this.request('/objects/' + id, { method: 'DELETE' }); },
    setMetatags(objectId, metatags) { return this.request('/objects/' + objectId + '/metatags', { method: 'PUT', body: { metatags } }); },
    async uploadLayout(stationId, file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(API_BASE + '/stations/' + stationId + '/layout', {
        method: 'POST',
        headers: Object.assign(
          { 'Accept': 'application/json' },
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {}
        ),
        body: fd, // KEIN Content-Type setzen – Browser setzt multipart-Boundary
      });
      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.message) || 'Upload fehlgeschlagen.', data);
      return data;
    },
    layoutUrl(stationId) { return API_BASE + '/stations/' + stationId + '/layout'; },
    exportCsvUrl(stationId) { return API_BASE + '/stations/' + stationId + '/export.csv'; },
    exportPdfUrl(stationId) { return API_BASE + '/stations/' + stationId + '/export.pdf'; },
  };

  global.Api = Api;
})(window);
