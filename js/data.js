/* ProModXgOEM2 – ausgelagerte Daten/Konstanten (Modularisierung D1) */
(function () {
  'use strict';
  window.PMX = window.PMX || {};
  window.PMX.I18N_EN = {
    // Profil
    'Profil': 'Profile', 'Einstellungen & Passwort': 'Settings & password',
    'Name': 'Name', 'E-Mail': 'E-mail', 'Rolle': 'Role', 'Gruppe': 'Group', 'Mandant': 'Tenant',
    'Sprache': 'Language', 'Deutsch': 'German', 'Englisch': 'English',
    'Passwort ändern': 'Change password', 'Aktuelles Passwort': 'Current password',
    'Eintrag hinzufügen': 'Add entry', 'Verkleinern': 'Zoom out', 'Vergrößern': 'Zoom in',
    'Passwort vergessen?': 'Forgot password?',
    'Reset anfordern Hinweis': 'Enter your email address. If an account exists, we will send you a link to reset it.',
    'RESET-LINK ANFORDERN': 'REQUEST RESET LINK',
    'Neues Passwort setzen': 'Set new password',
    'Neues Passwort waehlen Hinweis': 'Choose a new password for your account.',
    'Neues Passwort': 'New password', 'Neues Passwort bestätigen': 'Confirm new password',
    'Passwort speichern': 'Save password', 'Schließen': 'Close', 'Abbrechen': 'Cancel',
    'Bitte das aktuelle Passwort eingeben.': 'Please enter your current password.',
    'Neues Passwort: mindestens 8 Zeichen.': 'New password: at least 8 characters.',
    'Neues Passwort muss sich vom aktuellen unterscheiden.': 'New password must differ from the current one.',
    'Die neuen Passwörter stimmen nicht überein.': 'The new passwords do not match.',
    'Wird gespeichert …': 'Saving …', 'Passwort geändert': 'Password changed',
    // Rollen / Status
    'Administrator': 'Administrator', 'Werk-Admin': 'Plant admin', 'Editor': 'Editor', 'Betrachter': 'Viewer',
    'aktiv': 'active', 'deaktiviert': 'disabled',
    // Admin-Panel
    'Verwaltung': 'Administration', 'Benutzer': 'Users', 'Gruppen': 'Groups', 'Ebenen': 'Layers',
    'Anmeldungen': 'Logins', 'Anmelde-Zähler zurücksetzen': 'Reset login counter', 'Anmelde-Zähler von „{n}“ auf 0 zurücksetzen?': 'Reset login counter of "{n}" to 0?', 'Anmelde-Zähler zurückgesetzt': 'Login counter reset', 'Zurücksetzen fehlgeschlagen': 'Reset failed', 'Status': 'Status', 'Werke': 'Plants', 'Mitglieder': 'Members',
    '+ Benutzer hinzufügen': '+ Add user', '+ Gruppe hinzufügen': '+ Add group',
    'Noch keine Benutzer.': 'No users yet.', 'Noch keine Gruppen.': 'No groups yet.',
    'zuletzt': 'last', 'noch nie': 'never', 'alle Werke': 'all plants',
    'Bearbeiten': 'Edit', 'Löschen': 'Delete', 'Passwort zurücksetzen': 'Reset password',
    // Palette / eigenes Symbol
    'Eigenes Symbol': 'Custom symbol', 'Symbol bearbeiten': 'Edit symbol',
    'Bild (PNG, JPG oder SVG)': 'Image (PNG, JPG or SVG)', 'Bild ersetzen (optional)': 'Replace image (optional)',
    'Bild wählen …': 'Choose image …', 'Metatag-Felder': 'Metatag fields', '+ Feld': '+ Field',
    'Feld entfernen': 'Remove field', 'Überschrift': 'Heading', 'Text': 'Text', 'Auswahl': 'Selection', 'Mehrfachauswahl': 'Multiple choice',
    'Optionen, mit Komma getrennt': 'Options, comma-separated', 'Hochladen': 'Upload', 'Speichern': 'Save',
    'Bitte einen Namen eingeben.': 'Please enter a name.', 'Bitte ein Bild wählen.': 'Please choose an image.',
    'Bild ist zu groß (max. 2 MB).': 'Image too large (max. 2 MB).',
    'Kein Werk / keine Ebene aktiv': 'No plant / layer active',
    'Dieses eigene Symbol aus der Palette löschen?': 'Delete this custom symbol from the palette?',
    'Symbol gelöscht': 'Symbol deleted', 'Eigenes Symbol hochladen': 'Upload custom symbol',
    // Metatag-Fenster
    '– bitte wählen –': '– please select –', 'Keine Optionen konfiguriert': 'No options configured',
    'frei belegbar …': 'free text …', 'Metatags gespeichert': 'Metatags saved', 'Metatags nicht gespeichert': 'Metatags not saved',
    '— bitte wählen —': '— please select —',
    // häufige Toasts
    'platziert': 'placed', 'Position nicht gespeichert': 'Position not saved',
    'mind. 8 Zeichen': 'min. 8 characters', 'Fehler': 'Error',
    'z. B. Sondergreifer': 'e.g. custom gripper', 'Wird hochgeladen …': 'Uploading …',
    'Verwaltung konnte nicht geladen werden': 'Administration could not be loaded',
    'Benutzer „{n}“ wirklich löschen?': 'Really delete user “{n}”?',
    'Gruppe „{n}“ wirklich löschen?': 'Really delete group “{n}”?',
    'Ebene „{n}“ wirklich löschen?': 'Really delete layer “{n}”?',
    // Login / Header / Baum
    'Anmelden': 'Sign in', 'Benutzer · E-Mail': 'User · e-mail', 'Passwort': 'Password',
    'Passwort anzeigen': 'Show password', 'ANMELDEN': 'SIGN IN', 'PASSWORT SPEICHERN': 'SAVE PASSWORD',
    'Benutzerverwaltung': 'User administration', 'Profil & Einstellungen': 'Profile & settings', 'Abmelden': 'Sign out',
    'Anlagenstruktur': 'Plant structure', 'Alles aufklappen': 'Expand all', 'Alles zuklappen': 'Collapse all', 'Alles auf-/zuklappen': 'Expand / collapse all', 'Baum einklappen': 'Collapse panel', 'Anlagenstruktur einblenden': 'Show plant structure', 'Am Raster ausrichten': 'Snap to grid', 'Raster': 'Grid', 'Dokumente': 'Documents', 'Dokument hochladen': 'Upload document', 'Noch keine Dokumente.': 'No documents yet.', 'Öffnen / Herunterladen': 'Open / download', 'Dokument wirklich löschen?': 'Really delete this document?', 'Nur PDF, Word oder Excel erlaubt.': 'Only PDF, Word or Excel allowed.', 'Datei zu groß (max. 25 MB).': 'File too large (max. 25 MB).', 'Wird geladen …': 'Loading …', 'Symbolgröße ziehen': 'Drag to resize symbols', 'Icon kopiert': 'Icon copied', 'Icons kopiert': 'icons copied', 'Icon eingefügt': 'Icon pasted', 'Icons eingefügt': 'icons pasted', 'Icon gelöscht': 'Icon deleted', 'Icons gelöscht': 'icons deleted', 'Versionen': 'Versions', 'Bezeichnung (optional)': 'Label (optional)', 'Version speichern': 'Save version', 'Objekte': 'objects', 'Version': 'Version', 'Wiederherstellen': 'Restore', 'Noch keine Versionen gespeichert.': 'No versions saved yet.', 'Diese Version wiederherstellen?': 'Restore this version?', 'Der aktuelle Stand wird vorher automatisch gesichert.': 'The current state is backed up automatically first.', 'Version wiederhergestellt': 'Version restored', 'Version gespeichert': 'Version saved', 'Version wirklich löschen?': 'Really delete this version?', 'Direktlink kopieren': 'Copy direct link', 'Doppelklick zum Umbenennen': 'Double-click to rename', 'Direktlink kopiert': 'Direct link copied', 'Direktlink:': 'Direct link:', 'Verlinkte Anlage nicht gefunden': 'Linked station not found', 'QR-Code zur Anlage': 'QR code to station', 'Aktionen': 'Actions', 'hinzufügen': 'add', 'QR-Code konnte nicht erzeugt werden': 'Could not generate QR code', 'Direktlink zur Anlage – scannen zum Öffnen': 'Direct link to station – scan to open', 'PNG herunterladen': 'Download PNG', 'Drucken': 'Print', 'Popup wurde blockiert': 'Popup was blocked', 'Kommentar-Position konnte nicht gespeichert werden': 'Comment position could not be saved', 'Ein unerwarteter Fehler ist aufgetreten. Bitte laden Sie die Seite neu (Strg+Umschalt+R).': 'An unexpected error occurred. Please reload the page (Ctrl+Shift+R).', 'Umbenennen': 'Rename', 'Version umbenannt': 'Version renamed', 'Speichern': 'Save', 'Abbrechen': 'Cancel',
    // Editor-Toolbar
    'EDITIEREN': 'EDIT', 'SPEICHERN': 'SAVE', 'LAYOUT HOCHLADEN': 'UPLOAD LAYOUT', 'LAYOUT ERSETZEN': 'REPLACE LAYOUT',
    'ZURÜCK': 'BACK', 'FÖRDERWEG': 'CONVEYOR PATH', 'ZEICHNEN AKTIV': 'DRAWING ACTIVE',
    'Journaleinträge': 'journal entries', 'Ohne Kategorie': 'No category', 'Journaleintrag fehlgeschlagen': 'Journal entry failed',
    // Detail-Ansicht
    'MODELLIEREN': 'MODEL', 'Stammdaten': 'Master data', 'Bearbeitung': 'Editing',
    'Anlagenname': 'System name', 'Bereich': 'Area', 'Anlagenversion': 'System version',
    'Erstellt am': 'Created on', 'Letzte Änderung': 'Last change', 'Beschreibung': 'Description',
    'SPS-Konfiguration': 'PLC configuration', 'SPS-Bereich': 'PLC area', 'Roboter erkennen': 'Detect robots', 'Gelernte Vorlagen': 'Learned templates', 'Kommentar': 'Comment', 'Kommentar (ziehen zum Verschieben)': 'Comment (drag to move)', 'Noch keine Nachrichten – schreib den ersten Kommentar.': 'No messages yet - write the first comment.', 'Nachricht …': 'Message …', 'Senden': 'Send', 'Schließen': 'Close', 'Fehlbeispiele': 'Negatives', 'Positive Vorlagen': 'Positive templates', 'Als Fehlbeispiel gemerkt': 'Saved as negative', 'Ähnliche Vorlage bereits vorhanden – übersprungen.': 'Similar template already exists - skipped.', 'Noch keine gelernten Vorlagen.': 'No learned templates yet.', 'Alle zurücksetzen': 'Reset all', 'Fehlbeispiele zurückgesetzt.': 'Negatives reset.', 'Löschen': 'Delete', 'zurücksetzen': 'reset', 'Als Vorlage gelernt': 'Learned as template', 'Gelernte Vorlagen zurückgesetzt.': 'Learned templates reset.', 'Roboter im Layout automatisch finden': 'Auto-find robots in the layout', 'Erkenne …': 'Detecting …', 'Erkenne Roboter …': 'Detecting robots …', 'Roboter erkannt – bitte bestätigen': 'robots detected – please confirm', 'Keine (neuen) Roboter erkannt.': 'No (new) robots detected.', 'Erkennung fehlgeschlagen.': 'Detection failed.', 'Kein Layout vorhanden.': 'No layout available.', 'Alle verwerfen': 'Dismiss all', 'Konfidenz': 'Confidence', 'Übernehmen': 'Accept', 'Verwerfen': 'Dismiss', 'Roboter-Ebene fehlt.': 'Robot layer missing.', 'Speichern fehlgeschlagen.': 'Save failed.', 'Bereich': 'area', 'Bereiche': 'areas', 'Zugeordnete Funktionsgruppen / Schutzbereiche': 'Assigned function groups / safety zones', '— keine —': '— none —', 'Steuerungen': 'controllers',
    'Zykluszeit [ms]': 'Cycle time [ms]', 'Remanenz [Byte]': 'Retentive [bytes]', 'Code-AS [kByte]': 'Code AS [kB]',
    'Keine SPS erfasst.': 'No PLCs recorded.', 'SPS HINZUFÜGEN': 'ADD PLC',
    'Änderungsjournal': 'Change journal', 'Neuer Eintrag …': 'New entry …', 'Änderung': 'change', 'Änderungen': 'changes',
    'Vorherige: ': 'Previous: ', 'Erste Station': 'First station', 'Nächste: ': 'Next: ', 'Letzte Station': 'Last station',
    'Layout ersetzen': 'Replace layout', 'Layout hochladen': 'Upload layout',
    'eigenes Layout': 'custom layout', 'Schema-Layout · L1–L5': 'Schematic layout · L1–L5', 'Schema-Layout': 'Schematic layout',
    // Linien-/Übersicht
    'Anlage auswählen': 'Select system', 'Gesamtübersicht': 'Overview', 'Linien-Dashboard': 'Line dashboard',
    'Anlagen': 'Systems', 'Center': 'Centers', 'SPS gesamt': 'PLCs total', 'Dokumentiert': 'Documented',
    'Stationen': 'Stations', 'Objekte': 'Objects',
    // Baum-Aktionen / Toasts
    'Neues Werk': 'New plant', 'Neue ': 'New ', 'Anlegen fehlgeschlagen: ': 'Creation failed: ',
    'Station konnte nicht geladen werden': 'Station could not be loaded',
    'Detail konnte nicht geladen werden.': 'Details could not be loaded.', 'Noch keine Einträge.': 'No entries yet.',
    'Gespeichert': 'Saved', 'Speichern fehlgeschlagen: ': 'Save failed: ', 'Export fehlgeschlagen': 'Export failed',
    'Umbenennen fehlgeschlagen': 'Rename failed', 'Löschen fehlgeschlagen': 'Delete failed', 'Gelöscht': 'Deleted',
    // Fachterminologie – Ebenennamen (Anzeige; DB-Wert bleibt Schlüssel)
    'Materialfluss': 'Material flow', 'Funktionsgruppen': 'Function groups', 'Steuerungstechnik': 'Control technology',
    'Saferobot / Technologie': 'Safe robot / technology', 'Antriebstechnik / Ident': 'Drive technology / ident',
    'Not-Halt': 'Emergency stop', 'Sicherheitslayout': 'Safety layout', 'Prozesstypen': 'Process types',
    // Paletten-Farbgruppen / Metatag-Gruppen / Badges
    'Aktiv': 'Active', 'Passiv': 'Passive', 'Weiß': 'White',
    'Betriebszustände': 'Operating states', 'MPS-Meldungen': 'MPS messages', 'Informationen': 'Information',
    'Pflicht': 'Required', 'Optional': 'Optional', 'Technologien': 'Technologies',
    'Roboter · Safe & Technologie': 'Robots · Safe & Technology',
    'Keine Objekte dieser Ebene auf dieser Linie.': 'No objects of this layer on this line.',
    'Objekt': 'Object',
  };
})();
