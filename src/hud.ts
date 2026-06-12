import { GRID_COLS, GRID_ROWS } from './constants';
import type { IceResurfacer } from './ice';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface FinishStats {
  coverageScore: number;
  precisionScore: number;
  timeScore: number;
  collisionPenalty: number;
  total: number;
  stars: number;
}

export class Hud {
  private progressPct = el('progress-pct');
  private progressFill = el('progress-bar-fill');
  private timeValue = el('time-value');
  private precisionValue = el('precision-value');
  private collisionValue = el('collision-value');
  private scoreValue = el('score-value');
  private speedValue = el('speed-value');
  private toast = el('toast');
  private finishOverlay = el('finish-overlay');
  private minimapCtx = el<HTMLCanvasElement>('minimap').getContext('2d')!;
  private toastTimer = 0;

  constructor(onRestart: () => void) {
    el('restart-btn').addEventListener('click', onRestart);
  }

  update(
    coverage: number,
    precision: number,
    timeSeconds: number,
    collisions: number,
    score: number,
    speedMs: number,
  ): void {
    this.progressPct.textContent = `${(coverage * 100).toFixed(1)}%`;
    this.progressFill.style.width = `${(coverage * 100).toFixed(1)}%`;
    const m = Math.floor(timeSeconds / 60);
    const s = Math.floor(timeSeconds % 60);
    this.timeValue.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.precisionValue.textContent = `${Math.round(precision * 100)}%`;
    this.collisionValue.textContent = `${collisions}`;
    this.scoreValue.textContent = `${Math.max(0, Math.round(score))} p`;
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
    el('finish-stars').textContent =
      '★'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars);
    el('finish-coverage').textContent = `+${Math.round(stats.coverageScore)}`;
    el('finish-precision').textContent = `+${Math.round(stats.precisionScore)}`;
    el('finish-time').textContent = `+${Math.round(stats.timeScore)}`;
    el('finish-collisions').textContent = `−${Math.round(stats.collisionPenalty)}`;
    el('finish-total').textContent = `${Math.max(0, Math.round(stats.total))} p`;
    this.finishOverlay.style.display = 'flex';
  }

  hideFinish(): void {
    this.finishOverlay.style.display = 'none';
  }
}
