import type { Input } from './vehicle';

/**
 * On-screen controls for touch devices: a horizontal steering pad bottom-left
 * and GAS / REV / BLADE / TURBO buttons bottom-right. Built only when the
 * device reports coarse-pointer/touch capability, and feeds the shared Input
 * so keyboard play is untouched. BLADE fires the same tap handler as SPACE.
 */
export function setupTouchControls(input: Input): void {
  const isTouch =
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window;
  if (!isTouch) return;

  const root = document.createElement('div');
  root.id = 'touch-controls';
  document.body.appendChild(root);
  document.body.classList.add('touch-mode'); // shifts the bottom-left HUD up

  // --- Steering pad (drag horizontally, continuous -1..1) ---
  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  pad.appendChild(knob);
  root.appendChild(pad);

  let padPointer: number | null = null;
  const setSteer = (clientX: number): void => {
    const r = pad.getBoundingClientRect();
    const rel = (clientX - (r.left + r.width / 2)) / (r.width / 2 - 24);
    const v = Math.max(-1, Math.min(1, rel));
    input.touchSteer = -v; // left drag = steer left (positive steer)
    knob.style.transform = `translateX(${v * (r.width / 2 - 32)}px)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    padPointer = e.pointerId;
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic/stale pointer – tracking still works via move events */
    }
    setSteer(e.clientX);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === padPointer) setSteer(e.clientX);
  });
  const padRelease = (e: PointerEvent): void => {
    if (e.pointerId !== padPointer) return;
    padPointer = null;
    input.touchSteer = 0;
    knob.style.transform = 'translateX(0)';
  };
  pad.addEventListener('pointerup', padRelease);
  pad.addEventListener('pointercancel', padRelease);

  // --- Buttons ---
  const buttons = document.createElement('div');
  buttons.className = 'touch-buttons';
  root.appendChild(buttons);

  const makeButton = (
    label: string,
    cls: string,
    onDown: () => void,
    onUp?: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = `touch-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic/stale pointer – press still registers */
      }
      b.classList.add('held');
      onDown();
    });
    const release = (): void => {
      b.classList.remove('held');
      onUp?.();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    buttons.appendChild(b);
    return b;
  };

  makeButton('⟲', 'rev', () => (input.touchThrottle = -1), () => {
    if (input.touchThrottle === -1) input.touchThrottle = 0;
  });
  makeButton('GAS', 'gas', () => (input.touchThrottle = 1), () => {
    if (input.touchThrottle === 1) input.touchThrottle = 0;
  });
  makeButton('⚡', 'turbo', () => (input.touchBoost = true), () => (input.touchBoost = false));
  makeButton('BLADE', 'blade', () => input.onTap['Space']?.());
}
