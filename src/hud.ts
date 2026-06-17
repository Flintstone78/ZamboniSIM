import type { Level, HudState, FinishResult } from './level';
import type { Vehicle } from './vehicle';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export class Hud {
  private levelName = el('level-name');
  private progressLabel = el('progress-label');
  private progressPct = el('progress-pct');
  private progressFill = el('progress-bar-fill');
  private statRows = el('stat-rows');
  private scoreValue = el('score-value');
  private speedValue = el('speed-value');
  private helpHint = el('help-hint');
  private toast = el('toast');
  private finishOverlay = el('finish-overlay');
  private finishBreakdown = el('finish-breakdown');
  private minimapCtx = el<HTMLCanvasElement>('minimap').getContext('2d')!;
  private toastTimer = 0;

  constructor(onRestart: () => void) {
    el('restart-btn').addEventListener('click', onRestart);
  }

  setHelp(levelHelp: string): void {
    this.helpHint.textContent = levelHelp;
  }

  update(state: HudState, speedMs: number): void {
    this.levelName.textContent = state.levelName;
    this.progressLabel.textContent = state.progressLabel;
    this.progressPct.textContent = state.progressText;
    this.progressFill.style.width = `${Math.min(100, state.progress * 100).toFixed(1)}%`;

    while (this.statRows.children.length < state.rows.length) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="rowlabel"></span><span class="value"></span>';
      this.statRows.appendChild(row);
    }
    while (this.statRows.children.length > state.rows.length) {
      this.statRows.lastChild!.remove();
    }
    state.rows.forEach((r, i) => {
      const row = this.statRows.children[i];
      row.querySelector('.rowlabel')!.textContent = r.label;
      row.querySelector('.value')!.textContent = r.value;
    });

    this.scoreValue.textContent = `${Math.max(0, Math.round(state.score))} p`;
    this.speedValue.textContent = `${Math.round(Math.abs(speedMs) * 3.6)}`;
  }

  drawMinimap(level: Level, vehicle: Vehicle): void {
    level.drawMinimap(this.minimapCtx, vehicle);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.opacity = '0'), 1400);
  }

  showFinish(result: FinishResult): void {
    el('finish-title').textContent = result.title;
    el('finish-stars').textContent =
      '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    this.finishBreakdown.innerHTML = '';
    for (const r of result.rows) {
      const div = document.createElement('div');
      div.innerHTML = `${r.label}<span class="value"></span>`;
      div.querySelector('.value')!.textContent = r.value;
      this.finishBreakdown.appendChild(div);
    }
    const totalRow = document.createElement('div');
    totalRow.style.marginTop = '8px';
    totalRow.innerHTML = `Totalt<span class="value" id="finish-total"></span>`;
    totalRow.querySelector('.value')!.textContent = `${Math.max(0, Math.round(result.total))} p`;
    this.finishBreakdown.appendChild(totalRow);

    this.finishOverlay.style.display = 'flex';
  }

  hideFinish(): void {
    this.finishOverlay.style.display = 'none';
  }
}
