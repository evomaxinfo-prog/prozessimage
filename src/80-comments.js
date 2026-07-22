  function commentsKey() { return 'promodx_comments_' + (state.detail && state.detail.id); }
  function ensureComments() {
    var sid = state.detail && state.detail.id;
    if (state.commentsStation === sid) return;
    state.commentsStation = sid;
    // Sofortiger lokaler Uebergangsstand (kein Flackern), dann Server drueber.
    try { state.comments = JSON.parse(localStorage.getItem(commentsKey()) || '[]'); } catch (e) { state.comments = []; }
    state.commentsServer = false;
    loadComments(sid);
  }
  async function loadComments(sid) {
    try {
      var list = await Api.getComments(sid);
      if (state.commentsStation !== sid) return;
      state.comments = Array.isArray(list) ? list : [];
      state.commentsServer = true;
      state.commentsSig = commentsSig(state.comments);
      renderEditor();
    } catch (e) { state.commentsServer = false; /* Backend (noch) nicht da -> lokaler Fallback bleibt aktiv */ }
  }
  const commentsSig = window.PMX.commentsSig;
  // Kommentare aus dem Poll uebernehmen, ohne die offene Eingabe/den Fokus zu verlieren.
  function applyCommentsUpdate(list) {
    var winMap = {}; (state.comments || []).forEach(function (c) { if (c.winX != null) winMap[c.id] = { winX: c.winX, winY: c.winY }; });
    state.comments = (list || []).map(function (c) { var w = winMap[c.id]; return w ? Object.assign({}, c, w) : c; });
    var inp = $('cwText'); var pending = inp ? inp.value : null; var hadFocus = inp && document.activeElement === inp;
    renderEditor();
    if (pending != null) { var ni = $('cwText'); if (ni) { ni.value = pending; if (hadFocus) ni.focus(); } var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; }
  }
  function saveComments() { try { localStorage.setItem(commentsKey(), JSON.stringify(state.comments || [])); } catch (e) { /* voll */ } }
  function fmtCommentTime(ts) {
    try { return new Date(ts).toLocaleString(state.lang === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  async function createCommentAt(x, y) {
    ensureComments();
    if (state.commentsServer) {
      try {
        var sc = await Api.createComment(state.detail.id, { x: x, y: y, layerId: state.activeLayer || null });
        state.comments.push(sc); state.commentsSig = commentsSig(state.comments);
        state.openComment = sc.id; renderEditor();
        setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30);
      } catch (e) { toast(t('Speichern fehlgeschlagen.')); }
      return;
    }
    var c = { id: 'cm_' + Date.now(), x: x, y: y, messages: [], created: Date.now() };
    state.comments.push(c); saveComments();
    state.openComment = c.id; renderEditor();
    setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30);
  }
  function commentPinLayer() {
    ensureComments();
    var cs = state.comments || [];
    if (!cs.length) return '';
    return '<div class="comment-pin-layer">' + cs.map(function (c) {
      var n = (c.messages || []).length;
      return '<div class="comment-pin' + (c.id === state.openComment ? ' active' : '') + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%" ' + (canEdit() ? '' : 'data-act="comment-open" ') + 'data-id="' + c.id + '" title="' + t('Kommentar (ziehen zum Verschieben)') + '">'
        + '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>'
        + (n ? '<span class="cp-badge">' + n + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function commentWindowLayer() {
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; });
    if (!c) return '';
    var left = c.winX != null ? Math.max(0, Math.min(96, c.winX * 100)) : Math.max(2, Math.min(60, c.x * 100));
    var top = c.winY != null ? Math.max(0, Math.min(92, c.winY * 100)) : Math.max(2, Math.min(48, c.y * 100));
    var me = (state.user && state.user.email) || '';
    var msgs = (c.messages || []).map(function (m) {
      var own = m.author === me;
      return '<div class="cm-msg' + (own ? ' own' : '') + '"><div class="cm-meta">' + esc(m.author || '') + ' · ' + fmtCommentTime(m.ts) + '</div><div class="cm-bubble">' + esc(m.text) + '</div></div>';
    }).join('') || '<div class="cm-empty">' + t('Noch keine Nachrichten – schreib den ersten Kommentar.') + '</div>';
    return '<div class="comment-window" style="left:' + left + '%;top:' + top + '%">'
      + '<div class="cw-head"><span class="cw-ttl">' + t('Kommentar') + '</span>'
      + '<button class="cw-del" data-act="comment-delete" data-id="' + c.id + '" title="' + t('Löschen') + '">🗑</button>'
      + '<button class="cw-x" data-act="comment-close" title="' + t('Schließen') + '">×</button></div>'
      + '<div class="cw-body" id="cwBody">' + msgs + '</div>'
      + '<div class="cw-input"><input id="cwText" type="text" placeholder="' + t('Nachricht …') + '" autocomplete="off" maxlength="1000">'
      + '<button class="cw-send" data-act="comment-send" data-id="' + c.id + '" title="' + t('Senden') + '">➤</button></div>'
      + '</div>';
  }
  async function sendCommentMsg() {
    var inp = $('cwText'); if (!inp) return;
    var text = inp.value.trim(); if (!text) return;
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; }); if (!c) return;
    if (state.commentsServer) {
      inp.value = '';
      try {
        var upd = await Api.addCommentMessage(c.id, text);
        var idx = state.comments.findIndex(function (x) { return x.id === c.id; });
        if (idx >= 0) { if (c.winX != null) { upd.winX = c.winX; upd.winY = c.winY; } state.comments[idx] = upd; }
        state.commentsSig = commentsSig(state.comments); renderEditor();
        setTimeout(function () { var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; var i = $('cwText'); if (i) i.focus(); }, 20);
      } catch (e) { toast(t('Speichern fehlgeschlagen.')); inp.value = text; }
      return;
    }
    c.messages.push({ author: (state.user && state.user.email) || 'Ich', ts: Date.now(), text: text });
    saveComments(); renderEditor();
    setTimeout(function () { var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; var i = $('cwText'); if (i) i.focus(); }, 20);
  }
  function closeCommentWindow() {
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; });
    state.openComment = null;
    if (c && (!c.messages || !c.messages.length)) {
      if (state.commentsServer) { Api.deleteComment(c.id).catch(function () { toast('Kommentar konnte nicht gelöscht werden'); }); }
      state.comments = state.comments.filter(function (x) { return x.id !== c.id; });
      if (!state.commentsServer) saveComments();
    }
    renderEditor();
  }
  async function deleteComment(id) {
    if (state.commentsServer) {
      try { await Api.deleteComment(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    }
    state.comments = (state.comments || []).filter(function (x) { return x.id !== id; });
    if (!state.commentsServer) saveComments();
    if (state.openComment === id) state.openComment = null; renderEditor();
  }

