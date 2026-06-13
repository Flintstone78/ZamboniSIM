/**
 * Career ladder: work your way up from Div 5 to SHL, with a national-team
 * bonus camp for a perfect run. The rink itself is regulation-sized
 * everywhere – what varies is the hall, the obstacle count and the time
 * limit. Progress (stars per level) is persisted in localStorage.
 */
export interface LevelDef {
  id: string;
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
  /** Bonus level: requires 3 stars on every regular level. */
  bonus?: boolean;
}

export const LEVELS: LevelDef[] = [
  {
    id: 'div5',
    name: 'Träningshallen',
    division: 'Div 5',
    description: 'Kall liten hall utan publik. Lugnt tempo – lär dig maskinen.',
    timeLimit: 6 * 60,
    stands: 'none',
    scoreboard: false,
    cones: 2,
    pucks: 4,
    hallColor: '#151b22',
    lightIntensity: 0.85,
  },
  {
    id: 'div2',
    name: 'Lokala ishallen',
    division: 'Div 2',
    description: 'Läktare på långsidorna och seriematch om fem minuter.',
    timeLimit: 5 * 60,
    stands: 'long-sides',
    scoreboard: false,
    cones: 3,
    pucks: 6,
    hallColor: '#0f141b',
    lightIntensity: 0.95,
  },
  {
    id: 'allsvenskan',
    name: 'Allsvenska arenan',
    division: 'HockeyAllsvenskan',
    description: 'Publik runt hela rinken. Nu börjar det bli allvar.',
    timeLimit: 4.5 * 60,
    stands: 'all',
    scoreboard: false,
    cones: 4,
    pucks: 7,
    hallColor: '#0c1117',
    lightIntensity: 1.05,
  },
  {
    id: 'shl',
    name: 'Storarenan',
    division: 'SHL',
    description: 'Fullsatt storarena med mediakub. Spola perfekt och snabbt.',
    timeLimit: 4 * 60,
    stands: 'all',
    scoreboard: true,
    cones: 5,
    pucks: 8,
    hallColor: '#0a0e14',
    lightIntensity: 1.1,
  },
  {
    id: 'landslagscampen',
    name: 'Landslagscampen',
    division: 'Bonus',
    description: 'Tre stjärnor hela vägen hit. Förbundskaptenen tittar på.',
    timeLimit: 3.5 * 60,
    stands: 'all',
    scoreboard: true,
    cones: 7,
    pucks: 10,
    hallColor: '#0b1018',
    lightIntensity: 1.15,
    bonus: true,
  },
];

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

const PROGRESS_KEY = 'zambonisim.progress';

export function loadStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
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

/** A level is unlocked when the one before it has been cleared (any stars).
 *  The bonus camp needs 3 stars on every regular level. */
export function isUnlocked(level: LevelDef, stars: Record<string, number>): boolean {
  if (level.bonus) {
    return LEVELS.filter((l) => !l.bonus).every((l) => (stars[l.id] ?? 0) >= 3);
  }
  const i = LEVELS.findIndex((l) => l.id === level.id);
  if (i <= 0) return true;
  return (stars[LEVELS[i - 1].id] ?? 0) >= 1;
}

/** The next level in the ladder, if there is one and it is unlocked. */
export function nextLevel(
  current: LevelDef,
  stars: Record<string, number>,
): LevelDef | null {
  const i = LEVELS.findIndex((l) => l.id === current.id);
  const next = LEVELS[i + 1];
  return next && isUnlocked(next, stars) ? next : null;
}
