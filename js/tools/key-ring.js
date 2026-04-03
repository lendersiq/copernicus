/**
 * Copernicus.KeyRing — local-only secret storage (IndexedDB, localStorage fallback).
 * Not encrypted at rest; suitable for API keys the user chooses to store in-browser.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var DB_NAME = 'luci_keyring';
  var DB_VERSION = 1;
  var STORE = 'secrets';
  var LS_PREFIX = 'luci_kr_';

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        resolve(null);
        return;
      }
      try {
        var req = global.indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = function () { resolve(null); };
        req.onsuccess = function () { resolve(req.result); };
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbGet(db, id) {
    return new Promise(function (resolve) {
      if (!db) {
        resolve(null);
        return;
      }
      try {
        var tx = db.transaction(STORE, 'readonly');
        var q = tx.objectStore(STORE).get(id);
        q.onsuccess = function () {
          var v = q.result;
          resolve(v && v.value != null ? String(v.value) : null);
        };
        q.onerror = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbSet(db, id, value) {
    return new Promise(function (resolve) {
      if (!db) {
        resolve(false);
        return;
      }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id: id, value: String(value), updatedAt: Date.now() });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function idbRemove(db, id) {
    return new Promise(function (resolve) {
      if (!db) {
        resolve(false);
        return;
      }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function lsGet(id) {
    try {
      if (!global.localStorage) return null;
      var raw = global.localStorage.getItem(LS_PREFIX + id);
      return raw != null ? String(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(id, value) {
    try {
      if (!global.localStorage) return false;
      global.localStorage.setItem(LS_PREFIX + id, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function lsRemove(id) {
    try {
      if (!global.localStorage) return false;
      global.localStorage.removeItem(LS_PREFIX + id);
      return true;
    } catch (e) {
      return false;
    }
  }

  LA.KeyRingIds = {
    /** Storage id kept as vendor slug so keys saved under the old app still load */
    BANKERSIQ_TRATES_API: 'bankersiq_luci_api'
  };

  LA.KeyRing = {
    get: function (id) {
      return openDb().then(function (db) {
        return idbGet(db, id).then(function (v) {
          if (v != null && v !== '') return v;
          return lsGet(id);
        });
      });
    },

    set: function (id, value) {
      if (value == null || String(value).trim() === '') {
        return this.remove(id);
      }
      var s = String(value).trim();
      return openDb().then(function (db) {
        return idbSet(db, id, s).then(function (ok) {
          if (ok) {
            try {
              lsRemove(id);
            } catch (e2) { /* ignore */ }
            return true;
          }
          return lsSet(id, s);
        });
      });
    },

    remove: function (id) {
      return openDb().then(function (db) {
        return idbRemove(db, id).then(function () {
          lsRemove(id);
          return true;
        });
      });
    }
  };
})(typeof window !== 'undefined' ? window : this);
