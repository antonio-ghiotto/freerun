import { openDB, type IDBPDatabase } from "idb";
import type { GpxTrack } from "./gpx";

const DB_NAME = "sentierolab";
const DB_VERSION = 1;
const TRACKS = "tracks";
const PREFS = "prefs";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TRACKS)) {
          db.createObjectStore(TRACKS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PREFS)) {
          db.createObjectStore(PREFS);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveTrack(t: GpxTrack): Promise<void> {
  const db = await getDb();
  await db.put(TRACKS, t);
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(TRACKS, id);
}

export async function listTracks(): Promise<GpxTrack[]> {
  const db = await getDb();
  return db.getAll(TRACKS);
}

export async function getPref<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return db.get(PREFS, key) as Promise<T | undefined>;
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put(PREFS, value, key);
}
