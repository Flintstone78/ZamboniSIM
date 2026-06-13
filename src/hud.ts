import { GRID_COLS, GRID_ROWS } from './constants';
import type { RinkStandard } from './constants';
import type { IceResurfacer } from './ice';
import type { LevelDef } from './levels';
import { isUnlocked } from './levels';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface FinishStats {
  success: boolean;
  coverage: number;
  coverageScore: number;
  precisionScore: number;
  timeScore: number;
  collisionPenalty: number;
  conePenalty: number;
  total: number;
  stars: number;
  best: number;
  isRecord: boolean;
  hasNext: boolean;
}

export interface HudCallbacks {
  onRestart: () => void;
  onMenu: () => void;
  onNext: () => void;
  onSelectLevel: (id: string) => void;
  onStandard: (standard: RinkStandard) => void;
  onPlay: () => void;
}

const starString = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

export class Hud {
  private progressPct = el('progress-pct');
  private progressFill = el('progress-bar-fill');
  private timeValue = el('time-value');
  private precisionValue = el('precision-value');
  private collisionValue = el('collision-value');
  private coneValue = el('cone-value');
  private scoreValue = el('score-value');
  private speedValue = el('speed-value');
  private bladeValue = el('blade-indicator');
  private levelName = el('level-name');
  private toast = el('toast');
  private finishOverlay = el('finish-overlay');
  private menuOverlay = el('menu-overlay');
  private splashOverlay = el('splash-overlay');
  private minimapCtx = el<HTMLCanvasElement>('minimap').getContext('2d')!;
  private toastTimer = 0;

  /** Cover art served from /assets (base-aware for GitHub Pages subpath). */
  private readonly coverUrl = import.meta.env.BASE_URL + 'assets/cover.png';

  constructor(private callbacks: HudCallbacks) {
    el('restart-btn').addEventListener('click', callbacks.onRestart);
    el('menu-btn').addEventListener('click', callbacks.onMenu);
    el('next-btn').addEventListener('click', callbacks.onNext);
    el<HTMLImageElement>('splash-img').src = this.coverUrl;
    el('splash-play').addEventListener('click', callbacks.onPlay);
    // Tint the level-select menu with a darkened cover for cohesion
    this.menuOverlay.style.backgroundImage =
      `linear-gradient(rgba(4,8,14,0.78), rgba(4,8,14,0.9)), url("${this.coverUrl}")`;
  }

  showSplash(): void {
    this.splashOverlay.style.display = 'flex';
    document.body.classList.add('in-menu'); // hide the gameplay HUD behind it
  }

  hideSplash(): void {
    this.splashOverlay.style.display = 'none';
  }

  renderMenu(
    levels: LevelDef[],
    stars: Record<string, number>,
    standard: RinkStandard,
  ): void {
    for (const std of ['europa', 'nordamerika'] as const) {
      el(`standard-${std}`).classList.toggle('selected', std === standard);
      el(`standard-${std}`).onclick = () => this.callbacks.onStandard(std);
    }

    const list = el('level-list');
    list.innerHTML = '';
    for (const level of levels) {
      const unlocked = isUnlocked(level, stars);
      const card = document.createElement('button');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.disabled = !unlocked;
      const earned = stars[level.id] ?? 0;
      card.innerHTML = `
        <span class="division">${level.division}</span>
        <span class="name">${level.name}</span>
        <span class="stars">${unlocked ? starString(earned) : '🔒'}</span>
        <span class="desc">${
          unlocked
            ? level.description
            : level.bonus
              ? 'Needs 3 stars on every level.'
              : 'Clear the previous level first.'
        }</span>`;
      if (unlocked) card.addEventListener('click', () => this.callbacks.onSelectLevel(level.id));
      list.appendChild(card);
    }
  }

  showMenu(): void {
    this.menuOverlay.style.display = 'flex';
    document.body.classList.add('in-menu');
  }

  hideMenu(): void {
    this.menuOverlay.style.display = 'none';
    document.body.classList.remove('in-menu');
  }

  setLevel(level: LevelDef): void {
    this.levelName.textContent = `${level.name} · ${level.division}`;
  }

  setBlade(down: boolean): void {
    this.bladeValue.textContent = down ? 'BLADE DOWN' : 'BLADE UP – press SPACE';
    this.bladeValue.classList.toggle('down', down);
  }

  update(
    coverage: number,
    precision: number,
    timeLeftSeconds: number,
    collisions: number,
    coneHits: number,
    score: number,
    speedMs: number,
  ): void {
    this.progressPct.textContent = `${(coverage * 100).toFixed(1)}%`;
    this.progressFill.style.width = `${(coverage * 100).toFixed(1)}%`;
    const m = Math.floor(timeLeftSeconds / 60);
    const s = Math.floor(timeLeftSeconds % 60);
    this.timeValue.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.timeValue.classList.toggle('low', timeLeftSeconds < 30);
    this.precisionValue.textContent = `${Math.round(precision * 100)}%`;
    this.collisionValue.textContent = `${collisions}`;
    this.coneValue.textContent = `${coneHits}`;
    this.scoreValue.textContent = `${Math.max(0, Math.round(score))} pts`;
    this.speedValue.textContent = `${Math.round(Math.abs(speedMs) * 3.6)}`;
  }

  drawMinimap(ice: IceResurfacer): void {
    const ctx = this.minimapCtx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cw = w / GRID_COLS;
    const ch = h / GRID_ROWS;
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!ice.isCellPaintable(c, r)) continue;
        ctx.fillStyle = ice.isCellPainted(c, r) ? '#4fc3f7' : '#39424e';
        ctx.fillRect(c * cw, r * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }
  }

  /** Marker for the zamboni on the minimap, in rink-normalised coords (0..1). */
  drawMinimapMarker(u: number, v: number, heading: number): void {
    const ctx = this.minimapCtx;
    const x = u * ctx.canvas.width;
    const y = v * ctx.canvas.height;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2 - heading);
    ctx.fillStyle = '#ffca28';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.opacity = '0'), 1400);
  }

  showFinish(stats: FinishStats): void {
    el('finish-title').textContent = stats.success ? 'Ice resurfaced!' : "Time's up!";
    el('finish-stars').textContent = stats.success ? starString(stats.stars) : '—';
    el('finish-coverage').textContent = stats.success
      ? `+${Math.round(stats.coverageScore)}`
      : `${Math.round(stats.coverage * 100)} %`;
    el('finish-precision').textContent = `+${Math.round(stats.precisionScore)}`;
    el('finish-time').textContent = `+${Math.round(stats.timeScore)}`;
    el('finish-collisions').textContent = `−${Math.round(stats.collisionPenalty)}`;
    el('finish-cones').textContent = `−${Math.round(stats.conePenalty)}`;
    el('finish-total').textContent = `${Math.max(0, Math.round(stats.total))} pts`;
    el('finish-record').textContent = !stats.success
      ? 'Resurface the whole sheet before time runs out.'
      : stats.isRecord
        ? '🏆 New record!'
        : `Record: ${Math.max(0, Math.round(stats.best))} pts`;
    el('next-btn').style.display = stats.hasNext ? 'inline-block' : 'none';
    this.finishOverlay.style.display = 'flex';
  }

  hideFinish(): void {
    this.finishOverlay.style.display = 'none';
  }
}
