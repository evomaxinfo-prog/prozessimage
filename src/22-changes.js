  async function deleteChangesDay(day) {
    const ids = (_ciDayIds[day] || []).slice();
    if (!ids.length) return;
    if (!window.confirm(t('Alle Änderungseinträge vom {day} löschen?', { day: day }) + '\n\n'
      + t(ids.length === 1 ? '{n} Eintrag wird dauerhaft entfernt – auch im Änderungsjournal der jeweiligen Station.' : '{n} Einträge werden dauerhaft entfernt – auch im Änderungsjournal der jeweiligen Station.', { n: ids.length }))) return;
    const res = await Promise.all(ids.map(function (id) {
      return Api.deleteJournal(id).then(function () { return true; }).catch(function () { return false; });
    }));
    const failed = res.filter(function (ok) { return !ok; }).length;
    toast(failed ? t('{n} von {total} gelöscht, {failed} fehlgeschlagen', { n: ids.length - failed, total: ids.length, failed: failed })
      : t(ids.length === 1 ? '{n} Eintrag gelöscht' : '{n} Einträge gelöscht', { n: ids.length }));
    _linieTab = 'changes'; // nach dem Loeschen auf Tab 4 bleiben
    if (state.selected) selectNode(state.selected); // Ansicht frisch laden
  }
  /* ---- Zentrale Änderungsansicht über ALLE Werke (admin-only) ----
     Holt die Daten über einen eigenen, serverseitig auf die sichtbaren Werke gefilterten
     Endpunkt - nicht über die Stationsabfragen, die pro Anlage den kompletten Bestand laden. */
  let _chgDays = 30, _chgData = null;
  // Sortierung je Tabelle: Standard neueste zuerst. Die Tagesgruppierung bleibt erhalten -
  // sortiert wird innerhalb der Tagesbloecke, bei Sortierung nach Zeit dreht sich auch die Tagesfolge.
  const _chgSort = { col: 'zeit', dir: 'desc' }, _lastSort = { col: 'zeit', dir: 'desc' };
  const FELDER_CHG = {
    pfad: (r) => r.pfad || r.anlage || '', text: (r) => r.text || '',
    zeit: (r) => new Date(r.createdAt || 0).getTime(), autor: (r) => r.author || '',
  };
  const FELDER_LAST = {
    pfad: (r) => r.pfad || r.anlage || '',
    zeit: (r) => new Date(r.letzteAenderung || 0).getTime(), autor: (r) => r.letzterBearbeiter || '',
  };
  function chgSortToggle(tbl, col) {
    const s = tbl === 'last' ? _lastSort : _chgSort;
    if (s.col === col) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    else { s.col = col; s.dir = col === 'zeit' ? 'desc' : 'asc'; }
    const b = $('chgBody'); if (b && _chgData) b.innerHTML = changesOverviewHtml(_chgData);
  }
  function thSort(tbl, col, label) {
    const s = tbl === 'last' ? _lastSort : _chgSort;
    const aktiv = s.col === col;
    const pfeil = aktiv ? (s.dir === 'asc' ? '▲' : '▼') : '▼';
    return '<th class="th-sort' + (aktiv ? ' aktiv' : '') + '" data-act="chg-sort" data-tbl="' + tbl + '" data-col="' + col + '">'
      + esc(label) + '<span class="th-arrow">' + pfeil + '</span></th>';
  }
  function chgSortiere(list, s, felder) {
    const f = felder[s.col]; if (!f) return list;
    const richtung = s.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      const va = f(a), vb = f(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * richtung;
      return String(va).localeCompare(String(vb), 'de') * richtung;
    });
  }
  async function openChangesOverview(days) {
    if (days) _chgDays = days;
    stopCollab();
    state.view = 'changes'; state.selected = null; state.detail = null;
    setStationUrl(null); renderTree();
    const filter = [7, 30, 90].map(function (d) {
      return '<button class="btn chg-day' + (d === _chgDays ? ' active' : '') + '" data-act="chg-days" data-days="' + d + '">' + d + ' ' + t('Tage') + '</button>';
    }).join('');
    $('content').innerHTML = '<div class="pad">'
      + '<div class="ls-section-title">' + t('Änderungen aller Werke') + ' <span>' + t('werksübergreifende Übersicht') + '</span></div>'
      + '<div class="chg-filter">' + filter + '</div>'
      + '<div id="chgBody"><div class="pad" style="color:var(--muted)">' + t('lädt …') + '</div></div></div>';
    try {
      const data = await Api.getChangesOverview(_chgDays);
      if (state.view !== 'changes') return; // zwischenzeitlich weg-navigiert
      _chgData = data;
      $('chgBody').innerHTML = changesOverviewHtml(data);
    } catch (e) {
      const b = $('chgBody'); if (b) b.innerHTML = '<div class="pad" style="color:var(--muted)">' + t('Laden fehlgeschlagen') + '</div>';
    }
  }
  function changesOverviewHtml(data) {
    const rows = (data && data.changes) || [];
    const letzte = (data && data.stations) || [];
    let html = '';
    // "Zuletzt bearbeitet" steht oben: lueckenlos und damit der schnellste Ueberblick.
    if (letzte.length) {
      const body = chgSortiere(letzte, _lastSort, FELDER_LAST).map(function (s) {
        return '<tr><td class="chg-path">' + chgPfadHtml(s) + '</td>'
          + '<td style="white-space:nowrap">' + fmtDateTime(s.letzteAenderung) + '</td>'
          + '<td>' + esc(s.letzterBearbeiter || '–') + '</td></tr>';
      }).join('');
      html += '<div class="ls-section-title">' + t('Zuletzt bearbeitet') + ' <span>' + t('jede Layout-Änderung, unabhängig vom Journal') + '</span></div>'
        + '<div class="ls-scroll"><table class="ls-tbl chg-tbl2"><thead><tr>' + thSort('last', 'pfad', t('Werk / Anlage')) + thSort('last', 'zeit', t('Letzte Änderung')) + thSort('last', 'autor', t('Von wem')) + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    html += '<div class="ls-section-title" style="margin-top:24px">' + t('Protokollierte Änderungen') + ' <span>' + t('nach Tagen gruppiert, neueste zuerst') + '</span></div>';
    if (!rows.length) {
      html += '<div class="pad" style="color:var(--muted)">' + t('Keine protokollierten Änderungen im gewählten Zeitraum.') + '</div>';
    } else {
      const order = [], byDay = {};
      rows.forEach(function (r) {
        const k = fmtDate(r.createdAt);
        if (!byDay[k]) { byDay[k] = []; order.push(k); }
        byDay[k].push(r);
      });
      if (_chgSort.col === 'zeit' && _chgSort.dir === 'asc') order.reverse();
      html += order.map(function (day) {
        const list = chgSortiere(byDay[day], _chgSort, FELDER_CHG);
        const body = list.map(function (r) {
          return '<tr><td class="chg-path">' + chgPfadHtml(r) + '</td>'
            + '<td>' + esc(r.text || '–') + '</td>'
            + '<td style="white-space:nowrap">' + fmtTimeShort(r.createdAt) + '</td>'
            + '<td>' + esc(r.author || '–') + '</td></tr>';
        }).join('');
        return '<div class="ci-day"><div class="ci-day-head">' + esc(day) + '<span>' + t(list.length === 1 ? '{n} Eintrag' : '{n} Einträge', { n: list.length }) + '</span></div>'
          + '<div class="ls-scroll"><table class="ls-tbl chg-tbl"><thead><tr>' + thSort('chg', 'pfad', t('Werk / Anlage')) + thSort('chg', 'text', t('Art der Änderung')) + thSort('chg', 'zeit', t('Uhrzeit')) + thSort('chg', 'autor', t('Von wem')) + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
      }).join('');
    }
    return html;
  }
  // Farbcodierung des Werk-Symbols nach Alter: heute grün, gestern und älter gelb.
  const CHG_HEUTE = '#16A34A', CHG_AELTER = '#E0A21B';
  function istHeute(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    return !isNaN(d) && d.toDateString() === new Date().toDateString();
  }
  // Pfad mit vorangestelltem Werk-Symbol; Werk hervorgehoben, Rest gedaempft.
  function chgPfadHtml(r) {
    const teile = String(r.pfad || r.anlage || '').split(' › ');
    const werk = teile.shift() || '';
    const heute = istHeute(r.createdAt || r.letzteAenderung);
    return '<a href="#" class="chg-link" title="' + esc(r.pfad || r.anlage || '') + '" data-act="goto-node" data-id="' + esc(r.nodeId) + '">'
      + '<svg class="chg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" style="color:' + (heute ? CHG_HEUTE : CHG_AELTER) + '">'
      + '<title>' + (heute ? t('heute geändert') : t('früher geändert')) + '</title>' + ICONS.werk + '</svg>'
      + '<span class="chg-werk">' + esc(werk) + '</span>'
      + (teile.length ? '<span class="chg-rest">' + esc(' › ' + teile.join(' › ')) + '</span>' : '')
      + '</a>';
  }
  function fmtTimeShort(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    return isNaN(d) ? '–' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  // Änderungsindex (admin-only): nach Tagen geclustert, neuester Tag zuerst.
  function linieChangesHtml(rows) {
    if (!rows || !rows.length) return '<div class="pad" style="color:var(--muted)">' + t('Keine protokollierten Änderungen in dieser Linie.') + '</div>';
    const fmtTimeOnly = function (iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
    const sorted = rows.slice().sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    const order = [], byDay = {};
    _ciDayIds = {};
    sorted.forEach(function (r) {
      const key = fmtDate(r.createdAt);
      if (!byDay[key]) { byDay[key] = []; order.push(key); _ciDayIds[key] = []; }
      byDay[key].push(r);
      if (r.id) _ciDayIds[key].push(r.id);
    });
    return order.map(function (day) {
      const list = byDay[day];
      const body = list.map(function (r) {
        return '<tr><td>' + esc(r.station) + '</td><td>' + esc(r.text || '–') + '</td><td style="white-space:nowrap">' + fmtTimeOnly(r.createdAt) + '</td><td>' + esc(r.author || '–') + '</td></tr>';
      }).join('');
      const delBtn = state.isAdmin ? '<button class="ci-del" data-act="ci-del-day" data-day="' + esc(day) + '">' + t('Tag löschen') + '</button>' : '';
      return '<div class="ci-day"><div class="ci-day-head">' + esc(day) + '<span>' + t(list.length === 1 ? '{n} Eintrag' : '{n} Einträge', { n: list.length }) + '</span>' + delBtn + '</div>'
        + '<div class="ls-scroll"><table class="ls-tbl"><thead><tr><th>' + t('Station') + '</th><th>' + t('Art der Änderung') + '</th><th>' + t('Uhrzeit') + '</th><th>' + t('Von wem') + '</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
    }).join('');
  }
