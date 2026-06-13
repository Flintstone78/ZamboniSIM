/**
 * Global leaderboard over total career score (the sum of your best result on
 * every level). Backed by a single shared JSON document on jsonblob.com – a
 * no-account, CORS-enabled JSON store – so the board is best-effort and openly
 * writable, not anti-cheat secured. If no blob is configured the feature stays
 * gracefully offline and only the local career score is used.
 *
 * Submitting is a read-modify-write of one shared array, so simultaneous
 * submissions can race; acceptable for a casual board.
 */
const BLOB_ID: string = '019ec18d-0e0a-7e4f-8ae4-fa54fc4303e7';
const BLOB_URL = `https://jsonblob.com/api/jsonBlob/${BLOB_ID}`;
const MAX_ROWS = 200;

const NAME_KEY = 'zambonisim.name';
const BESTS_KEY = 'zambonisim.levelBest';

export interface LeaderRow {
  name: string;
  score: number;
}

export function leaderboardEnabled(): boolean {
  return BLOB_ID !== '';
}

// --- Player handle ------------------------------------------------------
export function getName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}
export function setName(name: string): void {
  localStorage.setItem(NAME_KEY, sanitizeName(name));
}
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 16);
}

// --- Local per-level bests + career total -------------------------------
export function loadLevelBests(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Record a level's total; returns true if it was a new personal best. */
export function saveLevelBest(levelId: string, total: number): boolean {
  const all = loadLevelBests();
  if (total <= (all[levelId] ?? 0)) return false;
  all[levelId] = Math.round(total);
  localStorage.setItem(BESTS_KEY, JSON.stringify(all));
  return true;
}

export function careerScore(): number {
  return Object.values(loadLevelBests()).reduce((a, b) => a + b, 0);
}

// --- Remote board (shared JSON array on jsonblob) -----------------------
async function fetchAll(): Promise<LeaderRow[]> {
  const res = await fetch(BLOB_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`board ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r && typeof r.name === 'string' && Number.isFinite(Number(r.score)))
    .map((r) => ({ name: String(r.name), score: Number(r.score) }));
}

/** Fetch the top `count` rows (highest score first). Empty on any failure. */
export async function fetchTop(count = 10): Promise<LeaderRow[]> {
  if (!leaderboardEnabled()) return [];
  try {
    const rows = await fetchAll();
    return rows.sort((a, b) => b.score - a.score).slice(0, count);
  } catch {
    return [];
  }
}

/** Submit a career score, keeping one row per name (their best). */
export async function submitScore(name: string, score: number): Promise<void> {
  const clean = sanitizeName(name);
  if (!leaderboardEnabled() || !clean) return;
  const rounded = Math.round(score);
  try {
    const rows = await fetchAll();
    const key = clean.toUpperCase();
    const existing = rows.find((r) => r.name.toUpperCase() === key);
    if (existing) {
      if (rounded <= existing.score) return; // board already holds a better run
      existing.score = rounded;
    } else {
      rows.push({ name: clean, score: rounded });
    }
    const trimmed = rows.sort((a, b) => b.score - a.score).slice(0, MAX_ROWS);
    await fetch(BLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(trimmed),
    });
  } catch {
    /* best-effort */
  }
}
