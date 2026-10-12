export interface Project { id: string; name: string; type: string; size: number; width: number; height: number; added: number; opened: number; favorite: boolean; thumbnail?: Blob; edits?: import('./editor/document').SavedEdits; edited?: number }

// Image bytes are stored once in `sources`; library reads and edits only touch metadata.
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('imagee-library', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('projects', { keyPath: 'id' });
    db.createObjectStore('sources', { keyPath: 'id' });
  };
  request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
  request.onerror = () => reject(request.error);
});
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
  const db = await dbPromise;
  return result(db.transaction('projects').objectStore('projects').getAll());
}
export async function readSource(id: string): Promise<Blob | undefined> {
  const db = await dbPromise;
  return (await result(db.transaction('sources').objectStore('sources').get(id)))?.blob;
}
export async function addProject(project: Project, source: Blob): Promise<void> {
  const db = await dbPromise;
  const transaction = db.transaction(['projects', 'sources'], 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('projects').put(project);
  transaction.objectStore('sources').put({ id: project.id, blob: source });
  await done;
}
export async function updateProject(project: Project): Promise<void> {
  const db = await dbPromise;
  const transaction = db.transaction('projects', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('projects').put(project);
  await done;
}
export async function removeProjects(ids: string[]): Promise<void> {
  const db = await dbPromise;
  const transaction = db.transaction(['projects', 'sources'], 'readwrite');
  const done = completed(transaction);
  for (const id of ids) { transaction.objectStore('projects').delete(id); transaction.objectStore('sources').delete(id); }
  await done;
}
