import { GRID_COLS, GRID_ROWS } from './constants';
import type { RinkStandard } from './constants';
import type { IceResurfacer } from './ice';
import type { LevelDef } from './levels';
import { isUnlocked } from './levels';
import {
  fetchTop,
  careerScore,
  getName,
  setName,
  leaderboardEnabled,
} from './leaderboard';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface FinishStats {
  success: boolean;
  title?: string;
  coverage: number;
  coverageScore: number;
  precisionScore: number;
  timeScore: number;
  collisionPenalty: number;
  conePenalty: number;
  flowBonus: number;
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
  onResume: () => void;
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
  private progressLabel = el('progress-label');
  private statLabel1 = el('stat-label-1');
  private statLabel2 = el('stat-label-2');
  private statLabel3 = el('stat-label-3');
  private statRow4 = el('stat-row-4');
  private toast = el('toast');
  private finishOverlay = el('finish-overlay');
  private menuOverlay = el('menu-overlay');
  private splashOverlay = el('splash-overlay');
  private pauseOverlay = el('pause-overlay');
  private minimapCtx = el<HTMLCanvasElement>('minimap').getContext('2d')!;
  private toastTimer = 0;

  /** Cover art served from /assets (base-aware for GitHub Pages subpath). */
  private readonly coverUrl = import.meta.env.BASE_URL + 'assets/cover.png';

  constructor(private callbacks: HudCallbacks) {
    el('restart-btn').addEventListener('click', callbacks.onRestart);
    el('menu-btn').addEventListener('click', callbacks.onMenu);
    el('next-btn').addEventListener('click', callbacks.onNext);
    el('pause-resume').addEventListener('click', callbacks.onResume);
    el('pause-restart').addEventListener('click', callbacks.onRestart);
    el('pause-menu').addEventListener('click', callbacks.onMenu);
    el<HTMLImageElement>('splash-img').src = this.coverUrl;
    el('splash-play').addEventListener('click', callbacks.onPlay);
    // Tint the level-select menu with a darkened cover for cohesion
    this.menuOverlay.style.backgroundImage =
      `linear-gradient(rgba(4,8,14,0.78), rgba(4,8,14,0.9)), url("${this.coverUrl}")`;

    const nameInput = el<HTMLInputElement>('player-name');
    nameInput.value = getName();
    nameInput.addEventListener('change', () => {
      setName(nameInput.value);
      nameInput.value = getName();
      void this.renderLeaderboard();
    });
  }

  /** Fetch and render the global career-score board (best-effort, async). */
  async renderLeaderboard(): Promise<void> {
    const list = el('lb-list');
    const you = el('lb-you');
    const career = careerScore();
    if (!leaderboardEnabled()) {
      list.innerHTML =
        '<li id="lb-empty">Global board is offline — your local career score still counts.</li>';
      you.textContent = `Your career score: ${career} pts`;
      return;
    }
    list.innerHTML = '<li id="lb-empty">Loading…</li>';
    const rows = await fetchTop(8);
    const myName = getName().toUpperCase();
    if (rows.length === 0) {
      list.innerHTML = '<li id="lb-empty">No scores yet — be the first!</li>';
    } else {
      list.innerHTML = '';
      rows.forEach((r, i) => {
        const li = document.createElement('li');
        if (r.name.toUpperCase() === myName) li.classList.add('you');
        li.innerHTML =
          `<span class="rank">${i + 1}</span>` +
          `<span>${escapeHtml(r.name)}</span>` +
          `<span class="pts">${r.score}</span>`;
        list.appendChild(li);
      });
    }
    const idx = rows.findIndex((r) => r.name.toUpperCase() === myName);
    you.textContent =
      idx >= 0 ? `You: #${idx + 1} · ${career} pts` : `Your career score: ${career} pts`;
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
              ? 'Needs 2 stars on every level.'
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

  private boostEl = el('boost');
  private boostFill = el('boost-fill');
  private combo = el('combo');
  private comboMult = this.combo.querySelector('.mult') as HTMLElement;
  private comboBar = this.combo.querySelector('.bar i') as HTMLElement;
  private popupEl = el('popup');
  private popupTimer = 0;

  /** Show the live combo multiplier (hidden at x1) and its decay bar (0..1). */
  setCombo(multiplier: number, fill: number): void {
    const shown = multiplier > 1 ? '1' : '0';
    if (this.combo.style.opacity !== shown) this.combo.style.opacity = shown;
    if (multiplier <= 1) return;
    this.setText(this.comboMult, `x${multiplier}`);
    this.setWidth(this.comboBar, `${(Math.max(0, Math.min(1, fill)) * 100).toFixed(1)}%`);
  }

  /** Turbo reserve bar (0..1) and whether it's currently firing. */
  setBoost(meter: number, active: boolean): void {
    this.setWidth(this.boostFill, `${(Math.max(0, Math.min(1, meter)) * 100).toFixed(1)}%`);
    this.boostEl.classList.toggle('active', active);
    this.boostEl.classList.toggle('low', meter < 0.15);
  }

  /** Big celebratory popup (combo up, net cleared, perfect line). */
  popup(text: string): void {
    this.popupEl.textContent = text;
    this.popupEl.classList.remove('show');
    void this.popupEl.offsetWidth; // restart the CSS animation
    this.popupEl.classList.add('show');
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => this.popupEl.classList.remove('show'), 900);
  }

  setBlade(down: boolean): void {
    this.bladeValue.textContent = down ? 'BLADE DOWN' : 'BLADE UP – press SPACE';
    this.bladeValue.classList.toggle('down', down);
  }

  /** Repurpose the blade indicator for modes where SPACE does something else. */
  setActionHint(text: string): void {
    this.bladeValue.textContent = text;
    this.bladeValue.classList.remove('down');
  }

  // The HUD refreshes every frame; only touch the DOM when a value changes
  private textCache = new WeakMap<HTMLElement, string>();
  private widthCache = new WeakMap<HTMLElement, string>();
  private setText(e: HTMLElement, v: string): void {
    if (this.textCache.get(e) === v) return;
    this.textCache.set(e, v);
    e.textContent = v;
  }
  private setWidth(e: HTMLElement, v: string): void {
    if (this.widthCache.get(e) === v) return;
    this.widthCache.set(e, v);
    e.style.width = v;
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
    this.setText(this.progressPct, `${(coverage * 100).toFixed(1)}%`);
    this.setWidth(this.progressFill, `${(coverage * 100).toFixed(1)}%`);
    const m = Math.floor(timeLeftSeconds / 60);
    const s = Math.floor(timeLeftSeconds % 60);
    this.setText(this.timeValue, `${m}:${s.toString().padStart(2, '0')}`);
    this.timeValue.classList.toggle('low', timeLeftSeconds < 30);
    this.setText(this.precisionValue, `${Math.round(precision * 100)}%`);
    this.setText(this.collisionValue, `${collisions}`);
    this.setText(this.coneValue, `${coneHits}`);
    this.setText(this.scoreValue, `${Math.max(0, Math.round(score))} pts`);
    this.setText(this.speedValue, `${Math.round(Math.abs(speedMs) * 3.6)}`);
  }

  /** Restore the rink HUD labels (after a parking round). */
  setRinkLabels(): void {
    this.setText(this.progressLabel, 'Resurfaced');
    this.setText(this.statLabel1, 'Time');
    this.setText(this.statLabel2, 'Precision');
    this.setText(this.statLabel3, 'Crashes');
    this.statRow4.style.display = '';
  }

  /** HUD for the parking-lot bonus: snowed stalls, time, cars, crashes. */
  updateParking(
    snowed: number,
    total: number,
    timeLeftSeconds: number,
    cars: number,
    crashes: number,
    score: number,
    speedMs: number,
  ): void {
    this.setText(this.progressLabel, 'Snowed stalls');
    this.setText(this.statLabel1, 'Time');
    this.setText(this.statLabel2, 'Cars');
    this.setText(this.statLabel3, 'Crashes');
    if (this.statRow4.style.display !== 'none') this.statRow4.style.display = 'none';
    this.setText(this.progressPct, `${snowed} / ${total}`);
    this.setWidth(this.progressFill, `${(total ? snowed / total : 0) * 100}%`);
    const m = Math.floor(timeLeftSeconds / 60);
    const s = Math.floor(timeLeftSeconds % 60);
    this.setText(this.timeValue, `${m}:${s.toString().padStart(2, '0')}`);
    this.timeValue.classList.toggle('low', timeLeftSeconds < 15);
    this.setText(this.precisionValue, `${cars}`);
    this.setText(this.collisionValue, `${crashes}`);
    this.setText(this.scoreValue, `${Math.max(0, Math.round(score))} pts`);
    this.setText(this.speedValue, `${Math.round(Math.abs(speedMs) * 3.6)}`);
  }

  /** Let a level draw its own minimap (e.g. the parking-lot stall map). */
  drawCustomMinimap(fn: (ctx: CanvasRenderingContext2D) => void): void {
    fn(this.minimapCtx);
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
    el('finish-title').textContent =
      stats.title ?? (stats.success ? 'Ice resurfaced!' : "Time's up!");
    el('finish-stars').textContent = stats.success ? starString(stats.stars) : '—';
    el('finish-coverage').textContent = stats.success
      ? `+${Math.round(stats.coverageScore)}`
      : `${Math.round(stats.coverage * 100)} %`;
    el('finish-precision').textContent = `+${Math.round(stats.precisionScore)}`;
    el('finish-time').textContent = `+${Math.round(stats.timeScore)}`;
    el('finish-flow').textContent = `+${Math.round(stats.flowBonus)}`;
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

  showPause(): void {
    this.pauseOverlay.style.display = 'flex';
    el<HTMLButtonElement>('pause-resume').focus({ preventScroll: true });
  }

  hidePause(): void {
    this.pauseOverlay.style.display = 'none';
    if (this.pauseOverlay.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  /** The overlay currently taking input, if any (topmost first). */
  private activeOverlay(): HTMLElement | null {
    for (const o of [this.pauseOverlay, this.finishOverlay, this.menuOverlay, this.splashOverlay]) {
      if (o.style.display === 'flex') return o;
    }
    return null;
  }

  /** Move keyboard/gamepad focus to the next (+1) or previous (−1) button of
   *  the open overlay. Returns false when no overlay is open. */
  moveFocus(dir: 1 | -1): boolean {
    const root = this.activeOverlay();
    if (!root) return false;
    const items = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(
      (b) => b.offsetParent !== null,
    );
    if (items.length === 0) return true;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = i < 0 ? (dir > 0 ? items[0] : items[items.length - 1]) : items[(i + dir + items.length) % items.length];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** Press the focused overlay button (gamepad A). Returns true if handled. */
  confirmFocus(): boolean {
    const root = this.activeOverlay();
    if (!root) return false;
    const a = document.activeElement;
    if (a instanceof HTMLButtonElement && root.contains(a)) {
      a.click();
      return true;
    }
    this.moveFocus(1); // nothing focused yet – highlight the first choice
    return true;
  }
}
