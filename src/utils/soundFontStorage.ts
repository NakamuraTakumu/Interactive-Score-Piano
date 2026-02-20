export interface UserSoundFontMeta {
  id: string;
  name: string;
  createdAt: number;
}

interface StoredSoundFont extends UserSoundFontMeta {
  data: ArrayBuffer;
}

const DB_NAME = 'interactive-score-piano';
const STORE_NAME = 'user_soundfonts';
const DB_VERSION = 1;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

export const listUserSoundFonts = async (): Promise<UserSoundFontMeta[]> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const rows = await runRequest(store.getAll()) as StoredSoundFont[];
    return rows
      .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
};

export const saveUserSoundFont = async (file: File): Promise<UserSoundFontMeta> => {
  const arrayBuffer = await file.arrayBuffer();
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: StoredSoundFont = {
    id,
    name: file.name.replace(/\.sf2$/i, ''),
    createdAt: Date.now(),
    data: arrayBuffer,
  };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await runRequest(store.put(record));
    return { id: record.id, name: record.name, createdAt: record.createdAt };
  } finally {
    db.close();
  }
};

export const getUserSoundFontData = async (id: string): Promise<ArrayBuffer | null> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const record = await runRequest(store.get(id)) as StoredSoundFont | undefined;
    return record?.data ?? null;
  } finally {
    db.close();
  }
};
