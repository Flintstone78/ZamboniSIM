import * as THREE from 'three';
import {
  RINK_LENGTH,
  RINK_WIDTH,
  SWATH_WIDTH,
  GRID_COLS,
  GRID_ROWS,
  REVISIT_SECONDS,
} from './constants';
import { rinkSignedDistance } from './rink';
import { inGoalZone } from './goals';

interface Strip {
  prevLeft: THREE.Vector2;
  prevRight: THREE.Vector2;
  hasPrev: boolean;
}

const TEX_W = 1024;
const TEX_H = 512;
const ROUGH_DIRTY = 168; // canvas grey level for scuffed ice
const ROUGH_CLEAN = 26; // freshly resurfaced = near-mirror

/**
 * Owns the "freshly resurfaced" state of the ice. Visually this is a canvas
 * used as the ice material's roughness map (scuffed = matte, resurfaced =
 * glossy). For scoring, a coarse grid tracks which 0.5 m cells have been
 * painted and how often, so coverage and overlap fall out of the same data.
 */
export class IceResurfacer {
  readonly texture: THREE.CanvasTexture;
  /** Wet-strip overlay: painted swaths as an RGBA canvas draped just above
   *  the ice, so the big markings texture never has to re-upload. */
  readonly tintTexture: THREE.CanvasTexture;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly tintCtx: CanvasRenderingContext2D;
  private colorDirty = false;
  private lastColorFlush = -1;
  // One strip state per blade (two in co-op)
  private strips: Strip[] = [0, 1].map(() => ({
    prevLeft: new THREE.Vector2(),
    prevRight: new THREE.Vector2(),
    hasPrev: false,
  }));

  // Per-cell: -1 = not paintable (outside rink), 0 = paintable & untouched,
  // > 0 = timestamp of last paint + 1 (so 0 stays falsy-free).
  private readonly lastPaint = new Float32Array(GRID_COLS * GRID_ROWS);
  private paintableCells = 0;
  private paintedCells = 0;
  private overlapEvents = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    // Re-uploaded every painting frame – skipping the mip chain makes that a
    // cheap single-level upload instead of a full-pyramid rebuild
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    const tintCanvas = document.createElement('canvas');
    tintCanvas.width = TEX_W;
    tintCanvas.height = TEX_H;
    this.tintCtx = tintCanvas.getContext('2d')!;
    this.tintTexture = new THREE.CanvasTexture(tintCanvas);
    this.tintTexture.colorSpace = THREE.SRGBColorSpace;
    this.tintTexture.generateMipmaps = false;
    this.tintTexture.minFilter = THREE.LinearFilter;
    this.reset();
  }

  reset(): void {
    const { ctx } = this;
    const g = ROUGH_DIRTY;
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Random skate scuffs so the dirty ice reads as used, not flat grey
    ctx.strokeStyle = `rgba(210,210,210,0.5)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * TEX_W;
      const y = Math.random() * TEX_H;
      const a = Math.random() * Math.PI * 2;
      const len = 10 + Math.random() * 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    this.texture.needsUpdate = true;

    this.tintCtx.clearRect(0, 0, TEX_W, TEX_H);
    this.tintTexture.needsUpdate = true;
    this.colorDirty = false;
    this.lastColorFlush = -1;

    for (const s of this.strips) s.hasPrev = false;
    this.paintableCells = 0;
    this.paintedCells = 0;
    this.overlapEvents = 0;
    const cellL = RINK_LENGTH / GRID_COLS;
    const cellW = RINK_WIDTH / GRID_ROWS;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = -RINK_LENGTH / 2 + (c + 0.5) * cellL;
        const z = -RINK_WIDTH / 2 + (r + 0.5) * cellW;
        // Cells hugging the boards can't be reached by the blade centre-line
        // sampling, and the goal cages can't be driven through – exclude both
        // from the coverage goal.
        const paintable = rinkSignedDistance(x, z) < -0.45 && !inGoalZone(x, z);
        this.lastPaint[r * GRID_COLS + c] = paintable ? 0 : -1;
        if (paintable) this.paintableCells++;
      }
    }
  }

  /** Call when the blade is lifted (reversing/stopped) to break the strip. */
  liftBlade(strip = 0): void {
    this.strips[strip].hasPrev = false;
    // Composite any tint still buffered in the throttle window so the last
    // metre of the wet strip isn't silently dropped
    if (this.colorDirty) this.flushColor(this.lastColorFlush, true);
  }

  /**
   * Lay down a strip of clean ice across the blade located at (x, z), facing
   * along `heading`. `time` is elapsed game time in seconds.
   */
  paint(x: number, z: number, heading: number, time: number, strip = 0): void {
    const s = this.strips[strip];
    const rightX = Math.sin(heading + Math.PI / 2) * (SWATH_WIDTH / 2);
    const rightZ = Math.cos(heading + Math.PI / 2) * (SWATH_WIDTH / 2);
    const left = new THREE.Vector2(x - rightX, z - rightZ);
    const right = new THREE.Vector2(x + rightX, z + rightZ);

    if (s.hasPrev) {
      const g = ROUGH_CLEAN;
      this.fillQuad(this.ctx, s, left, right, `rgb(${g},${g},${g})`);
      this.texture.needsUpdate = true;

      // Opaque mask – no alpha build-up at the seams between frame quads
      this.fillQuad(this.tintCtx, s, left, right, 'rgb(96, 140, 178)');
      this.colorDirty = true;
      this.flushColor(time);

      this.markGrid(s.prevLeft, s.prevRight, left, right, time);
    }

    s.prevLeft.copy(left);
    s.prevRight.copy(right);
    s.hasPrev = true;
  }

  get coverage(): number {
    return this.paintableCells === 0 ? 0 : this.paintedCells / this.paintableCells;
  }

  /** Running tallies (read by the combo system to detect clean vs overlap). */
  get painted(): number {
    return this.paintedCells;
  }
  get overlaps(): number {
    return this.overlapEvents;
  }

  /** 1.0 = no ground covered twice; falls as overlap accumulates. */
  get precision(): number {
    const total = this.paintedCells + this.overlapEvents;
    return total === 0 ? 1 : this.paintedCells / total;
  }

  /** True if the paintable cell at grid (col, row) has been resurfaced. */
  isCellPainted(col: number, row: number): boolean {
    return this.lastPaint[row * GRID_COLS + col] > 0;
  }

  isCellPaintable(col: number, row: number): boolean {
    return this.lastPaint[row * GRID_COLS + col] >= 0;
  }

  /** Find an unpainted paintable cell that's boxed in by resurfaced ice – a
   *  "missed spot" the player skipped. Returns its world centre, or null.
   *  Scans from a random offset so repeated calls surface different holes. */
  findMissedSpot(): { x: number; z: number } | null {
    const cellL = RINK_LENGTH / GRID_COLS;
    const cellW = RINK_WIDTH / GRID_ROWS;
    const total = GRID_COLS * GRID_ROWS;
    const start = Math.floor(Math.random() * total);
    for (let n = 0; n < total; n++) {
      const idx = (start + n) % total;
      if (this.lastPaint[idx] !== 0) continue; // painted (>0) or not paintable (<0)
      const c = idx % GRID_COLS;
      const r = (idx / GRID_COLS) | 0;
      if (c < 1 || c >= GRID_COLS - 1 || r < 1 || r >= GRID_ROWS - 1) continue;
      let painted = 0;
      let paintable = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const v = this.lastPaint[(r + dr) * GRID_COLS + (c + dc)];
          if (v < 0) continue;
          paintable++;
          if (v > 0) painted++;
        }
      }
      // Mostly hemmed in by resurfaced ice – a gap you left behind, not the
      // straight frontier of the strip you're currently laying
      if (paintable >= 6 && painted >= paintable - 2) {
        return {
          x: -RINK_LENGTH / 2 + (c + 0.5) * cellL,
          z: -RINK_WIDTH / 2 + (r + 0.5) * cellW,
        };
      }
    }
    return null;
  }

  /** Fraction of paintable cells inside a world rectangle that are resurfaced.
   *  Used to detect when the strip behind a goal cage has been cleaned. */
  regionCoverage(xMin: number, xMax: number, zMin: number, zMax: number): number {
    const cellL = RINK_LENGTH / GRID_COLS;
    const cellW = RINK_WIDTH / GRID_ROWS;
    const c0 = Math.max(0, Math.floor((xMin + RINK_LENGTH / 2) / cellL));
    const c1 = Math.min(GRID_COLS - 1, Math.floor((xMax + RINK_LENGTH / 2) / cellL));
    const r0 = Math.max(0, Math.floor((zMin + RINK_WIDTH / 2) / cellW));
    const r1 = Math.min(GRID_ROWS - 1, Math.floor((zMax + RINK_WIDTH / 2) / cellW));
    let painted = 0;
    let total = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = this.lastPaint[r * GRID_COLS + c];
        if (v < 0) continue;
        total++;
        if (v > 0) painted++;
      }
    }
    return total === 0 ? 1 : painted / total;
  }

  /** Push the wet-strip canvas to the GPU, throttled to ~7 Hz. Just a small
   *  single-level upload – the markings texture is never touched. */
  private flushColor(time: number, force = false): void {
    if (!this.colorDirty) return;
    if (!force && this.lastColorFlush >= 0 && time - this.lastColorFlush < 0.15) return;
    this.lastColorFlush = time;
    this.colorDirty = false;
    this.tintTexture.needsUpdate = true;
  }

  private fillQuad(
    ctx: CanvasRenderingContext2D,
    strip: Strip,
    left: THREE.Vector2,
    right: THREE.Vector2,
    style: string,
  ): void {
    ctx.fillStyle = style;
    ctx.strokeStyle = style;
    ctx.lineWidth = 2; // hide hairline seams between frame quads
    ctx.beginPath();
    ctx.moveTo(...this.toCanvas(strip.prevLeft));
    ctx.lineTo(...this.toCanvas(strip.prevRight));
    ctx.lineTo(...this.toCanvas(right));
    ctx.lineTo(...this.toCanvas(left));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private toCanvas(p: THREE.Vector2): [number, number] {
    return [
      ((p.x + RINK_LENGTH / 2) / RINK_LENGTH) * TEX_W,
      ((p.y + RINK_WIDTH / 2) / RINK_WIDTH) * TEX_H,
    ];
  }

  /** Stamp the quad (pl, pr, cl, cr) into the coverage grid. */
  private markGrid(
    pl: THREE.Vector2,
    pr: THREE.Vector2,
    cl: THREE.Vector2,
    cr: THREE.Vector2,
    time: number,
  ): void {
    const cellL = RINK_LENGTH / GRID_COLS;
    const cellW = RINK_WIDTH / GRID_ROWS;
    const prevMid = pl.clone().add(pr).multiplyScalar(0.5);
    const currMid = cl.clone().add(cr).multiplyScalar(0.5);
    const travel = currMid.distanceTo(prevMid);
    const alongSteps = Math.max(1, Math.ceil(travel / 0.2));
    const acrossSteps = Math.ceil(SWATH_WIDTH / 0.2);

    for (let i = 0; i <= alongSteps; i++) {
      const t = i / alongSteps;
      const lx = pl.x + (cl.x - pl.x) * t;
      const lz = pl.y + (cl.y - pl.y) * t;
      const rx = pr.x + (cr.x - pr.x) * t;
      const rz = pr.y + (cr.y - pr.y) * t;
      for (let j = 0; j <= acrossSteps; j++) {
        const s = j / acrossSteps;
        const x = lx + (rx - lx) * s;
        const z = lz + (rz - lz) * s;
        const c = Math.floor((x + RINK_LENGTH / 2) / cellL);
        const r = Math.floor((z + RINK_WIDTH / 2) / cellW);
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) continue;
        const idx = r * GRID_COLS + c;
        const last = this.lastPaint[idx];
        if (last < 0) continue; // not paintable
        if (last === 0) {
          this.paintedCells++;
        } else if (time + 1 - last > REVISIT_SECONDS) {
          this.overlapEvents++;
        }
        this.lastPaint[idx] = time + 1;
      }
    }
  }
}
