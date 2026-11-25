import type { RinkStandard } from './constants';

/**
 * Two regional career ladders. Picking Europe or North America on the menu
 * sets both the rink width (via each level's region) and which ladder of
 * divisions you climb:
 *   Europe        – Training Hall up to the SHL, plus a National Team bonus.
 *   North America – Juniors up to the NHL, plus an All-Star bonus.
 * Each region tracks its own stars/unlocks (level ids are unique), so the two
 * ladders are independent careers. The rink itself is regulation-sized; what
 * varies per level is the hall, obstacle count and time limit.
 */
export interface LevelDef {
  id: string;
  region: RinkStandard;
  name: string;
  division: string;
  description: string;
  /** Seconds before the resurfacing shift is over. */
  timeLimit: number;
  /** Which sides get spectator stands. */
  stands: 'none' | 'long-sides' | 'all';
  /** Centre-hung scoreboard cube. */
  scoreboard: boolean;
  cones: number;
  pucks: number;
  /** Hall ambience tweaks. */
  hallColor: string;
  lightIntensity: number;
  /** 0..4 – drives how grand the arena looks (barn → domed showpiece). */
  tier: number;
  /** Bonus level: requires 3 stars on every regular level in the region. */
  bonus?: boolean;
  /** Parking-lot bonus minigame (different gameplay from the rink). */
  parking?: boolean;
}

/** The parking-lot bonus minigame – always available, shown for both regions. */
export const PARKING_LEVEL: LevelDef = {
  id: 'parking',
  region: 'europa',
  name: 'The Lot',
  division: 'Bonus minigame',
  description: 'Out on the lot: dump snow on free stalls before the cars grab them. SPACE dumps.',
  timeLimit: 80,
  stands: 'none',
  scoreboard: false,
  cones: 0,
  pucks: 0,
  hallColor: '#070a12',
  lightIntensity: 1,
  tier: 0,
  parking: true,
};

// Shared difficulty curve for both ladders (tier 0..4). Cones are gone (they
// made a perfect score impossible); the late-game hazard is roaming skaters,
// and `pucks` seeds how many loose pucks they get to play with.
const TIERS = [
  { timeLimit: 6 * 60, stands: 'none', scoreboard: false, cones: 0, pucks: 4, hallColor: '#151b22', lightIntensity: 0.85 },
  { timeLimit: 5 * 60, stands: 'long-sides', scoreboard: false, cones: 0, pucks: 6, hallColor: '#0f141b', lightIntensity: 0.95 },
  { timeLimit: 4.5 * 60, stands: 'all', scoreboard: false, cones: 0, pucks: 7, hallColor: '#0c1117', lightIntensity: 1.05 },
  { timeLimit: 4 * 60, stands: 'all', scoreboard: true, cones: 0, pucks: 8, hallColor: '#0a0e14', lightIntensity: 1.1 },
  { timeLimit: 3.5 * 60, stands: 'all', scoreboard: true, cones: 0, pucks: 10, hallColor: '#0b1018', lightIntensity: 1.15 },
] as const;

interface TierLabel {
  id: string;
  name: string;
  division: string;
  description: string;
  bonus?: boolean;
}

function buildLadder(region: RinkStandard, labels: TierLabel[]): LevelDef[] {
  return labels.map((l, i) => ({
    region,
    name: l.name,
    division: l.division,
    description: l.description,
    bonus: l.bonus,
    ...TIERS[i],
    tier: i,
    id: l.id,
  }));
}

export const EUROPE_LEVELS = buildLadder('europa', [
  { id: 'eu1', division: 'Div 5', name: 'Training Hall', description: 'Cold little practice rink, no crowd. Take it easy and learn the machine.' },
  { id: 'eu2', division: 'Div 2', name: 'Local Rink', description: 'Stands along the long sides and a league game in five minutes.' },
  { id: 'eu3', division: 'Allsvenskan', name: 'Allsvenskan Arena', description: 'A crowd all the way around. Now it is getting serious.' },
  { id: 'eu4', division: 'SHL', name: 'Top Arena', description: 'Sold-out top-flight arena with a media cube. Flood it fast and flawless.' },
  { id: 'eu5', division: 'Bonus', name: 'National Team Camp', description: 'Three stars all the way here. The national-team coach is watching.', bonus: true },
]);

export const NA_LEVELS = buildLadder('nordamerika', [
  { id: 'na1', division: 'Juniors', name: 'Practice Rink', description: 'Empty junior practice barn. Get a feel for the machine.' },
  { id: 'na2', division: 'ECHL', name: 'Minor-League Barn', description: 'Minor-league rink with fans on the long sides. Five minutes to puck drop.' },
  { id: 'na3', division: 'AHL', name: 'AHL Arena', description: 'Packed AHL building. The call-up is on the line.' },
  { id: 'na4', division: 'NHL', name: 'NHL Arena', description: 'Sold-out NHL arena under the media cube. Perfect ice, fast.' },
  { id: 'na5', division: 'Bonus', name: 'All-Star Game', description: 'Three stars everywhere got you here. The All-Star spotlight is on.', bonus: true },
]);

export const ALL_LEVELS = [...EUROPE_LEVELS, ...NA_LEVELS];

export function levelsForRegion(region: RinkStandard): LevelDef[] {
  // The parking minigame is shown after each region's ladder
  return [...(region === 'europa' ? EUROPE_LEVELS : NA_LEVELS), PARKING_LEVEL];
}

export function levelById(id: string): LevelDef {
  if (id === PARKING_LEVEL.id) return PARKING_LEVEL;
  return ALL_LEVELS.find((l) => l.id === id) ?? EUROPE_LEVELS[0];
}

const PROGRESS_KEY = 'zambonisim.progress';

export function loadStars(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    // Guard against a corrupt/foreign value under the key ('null', '5', '[]'…)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveStars(levelId: string, stars: number): void {
  const all = loadStars();
  if ((all[levelId] ?? 0) < stars) {
    all[levelId] = stars;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  }
}

/** Unlocked when the previous level in the same region has been cleared (any
 *  stars). The bonus arena (the nationals showpiece) needs 2 stars on every
 *  regular level in the region. */
export function isUnlocked(level: LevelDef, stars: Record<string, number>): boolean {
  if (level.parking) return true; // the minigame is always open
  const ladder = levelsForRegion(level.region);
  if (level.bonus) {
    // 2 stars on every regular rink level (the parking minigame doesn't count)
    return ladder.filter((l) => !l.bonus && !l.parking).every((l) => (stars[l.id] ?? 0) >= 2);
  }
  const i = ladder.findIndex((l) => l.id === level.id);
  if (i <= 0) return true;
  return (stars[ladder[i - 1].id] ?? 0) >= 1;
}

/** The next level in the same region's ladder, if unlocked. */
export function nextLevel(
  current: LevelDef,
  stars: Record<string, number>,
): LevelDef | null {
  const ladder = levelsForRegion(current.region);
  const i = ladder.findIndex((l) => l.id === current.id);
  const next = ladder[i + 1];
  return next && isUnlocked(next, stars) ? next : null;
}
