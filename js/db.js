// Minimal IndexedDB wrapper. Stores:
//   trees:  { id, number, species, lat, lng, accuracy, circumference, ... , photoIds[], createdAt, updatedAt }
//   photos: { id, treeId, blob, thumb, name, takenAt, width, height }
//   meta:   { key, value }
(function () {
  const DB_NAME = 'treelog';
  const DB_VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('trees')) db.createObjectStore('trees', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('treeId', 'treeId');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }

  const DB = {
    async allTrees() {
      return tx(['trees'], 'readonly', (t) => reqP(t.objectStore('trees').getAll()));
    },
    async getTree(id) {
      return tx(['trees'], 'readonly', (t) => reqP(t.objectStore('trees').get(id)));
    },
    async putTree(tree) {
      return tx(['trees'], 'readwrite', (t) => reqP(t.objectStore('trees').put(tree)));
    },
    async deleteTree(id) {
      return tx(['trees', 'photos'], 'readwrite', async (t) => {
        const keys = await reqP(t.objectStore('photos').index('treeId').getAllKeys(id));
        keys.forEach((k) => t.objectStore('photos').delete(k));
        t.objectStore('trees').delete(id);
      });
    },
    async photosForTree(id) {
      return tx(['photos'], 'readonly', (t) => reqP(t.objectStore('photos').index('treeId').getAll(id)));
    },
    async allPhotos() {
      return tx(['photos'], 'readonly', (t) => reqP(t.objectStore('photos').getAll()));
    },
    async putPhoto(photo) {
      return tx(['photos'], 'readwrite', (t) => reqP(t.objectStore('photos').put(photo)));
    },
    async deletePhoto(id) {
      return tx(['photos'], 'readwrite', (t) => reqP(t.objectStore('photos').delete(id)));
    },
    async getMeta(key) {
      const r = await tx(['meta'], 'readonly', (t) => reqP(t.objectStore('meta').get(key)));
      return r ? r.value : undefined;
    },
    async setMeta(key, value) {
      return tx(['meta'], 'readwrite', (t) => reqP(t.objectStore('meta').put({ key, value })));
    },
    async wipe() {
      return tx(['trees', 'photos'], 'readwrite', (t) => {
        t.objectStore('trees').clear();
        t.objectStore('photos').clear();
      });
    },
  };

  window.DB = DB;
})();
