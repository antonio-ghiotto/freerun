// Favorites persisted in localStorage. Small enough to skip IndexedDB.
const KEY = "freerun:favorites";

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function isFavorite(id: string): boolean {
  return getFavorites().includes(id);
}

export function toggleFavorite(id: string): boolean {
  const set = new Set(getFavorites());
  const now = !set.has(id);
  if (now) set.add(id);
  else set.delete(id);
  localStorage.setItem(KEY, JSON.stringify([...set]));
  return now;
}
