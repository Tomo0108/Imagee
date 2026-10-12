export interface Project { id: string; name: string; type: string; size: number; width: number; height: number; added: number; opened: number; favorite: boolean; thumbnail?: Blob; edits?: import('./editor/document').SavedEdits; edited?: number }

// Image bytes are stored once in `sources`; library reads and edits only touch metadata.
// Opened on first use; opened again if the browser closed it (storage cleared, another tab upgraded it) or opening failed.
let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  return opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('imagee-library', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
      // Painted layer pixels, keyed "<project id>/<surface key>".
      if (!db.objectStoreNames.contains('pixels')) db.createObjectStore('pixels', { keyPath: 'id' });
      // Imported .cube colour tables, shared by all projects.
      if (!db.objectStoreNames.contains('luts')) db.createObjectStore('luts', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      db.onclose = () => { opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted'));
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function readProjects(): Promise<Project[]> {
  const db = await database();
  return result(db.transaction('projects').objectStore('projects').getAll());
}
export async function readSource(id: string): Promise<Blob | undefined> {
  const db = await database();
  return (await result(db.transaction('sources').objectStore('sources').get(id)))?.blob;
}
export async function addProject(project: Project, source: Blob): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['projects', 'sources'], 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('projects').put(project);
  transaction.objectStore('sources').put({ id: project.id, blob: source });
  await done;
}
export async function updateProject(project: Project): Promise<void> {
  const db = await database();
  const transaction = db.transaction('projects', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('projects').put(project);
  await done;
}
export async function removeProjects(ids: string[]): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['projects', 'sources', 'pixels'], 'readwrite');
  const done = completed(transaction);
  for (const id of ids) {
    transaction.objectStore('projects').delete(id); transaction.objectStore('sources').delete(id);
    transaction.objectStore('pixels').delete(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`));
  }
  await done;
}
export async function readPixels(projectId: string): Promise<Map<string, Blob>> {
  const db = await database();
  const rows: { id: string; blob: Blob }[] = await result(db.transaction('pixels').objectStore('pixels').getAll(IDBKeyRange.bound(`${projectId}/`, `${projectId}/\uffff`)));
  return new Map(rows.map(row => [row.id.slice(projectId.length + 1), row.blob]));
}
/** Writes changed surfaces and removes ones no longer used. */
export async function writePixels(projectId: string, changed: Map<string, Blob>, keep: Set<string>): Promise<void> {
  const db = await database();
  const existing: string[] = (await result(db.transaction('pixels').objectStore('pixels').getAllKeys(IDBKeyRange.bound(`${projectId}/`, `${projectId}/\uffff`)))).map(String);
  const transaction = db.transaction('pixels', 'readwrite');
  const done = completed(transaction);
  const store = transaction.objectStore('pixels');
  for (const [key, blob] of changed) store.put({ id: `${projectId}/${key}`, blob });
  for (const id of existing) if (!keep.has(id.slice(projectId.length + 1))) store.delete(id);
  await done;
}

export interface StoredLut { id: string; name: string; size: number; data: Float32Array }
export async function readLuts(): Promise<StoredLut[]> {
  const db = await database();
  return result(db.transaction('luts').objectStore('luts').getAll());
}
export async function addLut(lut: StoredLut): Promise<void> {
  const db = await database();
  const transaction = db.transaction('luts', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('luts').put(lut);
  await done;
}
export async function removeLut(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction('luts', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('luts').delete(id);
  await done;
}
