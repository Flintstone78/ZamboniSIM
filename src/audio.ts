/**
 * All sound is synthesised with the Web Audio API – no asset files. Engine =
 * detuned saws through a lowpass, scrape = looped noise through a bandpass,
 * crowd = slow noise swells. The context is created lazily on the first user
 * gesture to satisfy autoplay policies, so the game runs silent (and without
 * errors) until the player touches a key.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private scrapeGain!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private muted = localStorage.getItem('zambonisim.muted') === '1';

  constructor() {
    const unlock = (): void => {
      this.ensureContext();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('zambonisim.muted', this.muted ? '1' : '0');
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  /** Per-frame: engine pitch/volume follow speed, scrape follows the blade. */
  update(speed: number, throttle: number, scraping: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = Math.abs(speed);
    const rpm = 46 + s * 9 + Math.abs(throttle) * 8;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.12);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(260 + s * 50, t, 0.12);
    this.engineGain.gain.setTargetAtTime(
      0.05 + s * 0.008 + Math.abs(throttle) * 0.015,
      t,
      0.1,
    );
    this.scrapeGain.gain.setTargetAtTime(
      scraping ? Math.min(0.07, 0.015 + s * 0.012) : 0,
      t,
      0.08,
    );
  }

  /** Swell the crowd murmur with progress/excitement (0..1). */
  setCrowd(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.crowdGain) return;
    const t = ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.016 + intensity * 0.05, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(420 + intensity * 900, t, 0.4);
  }

  /** A quick crowd cheer (combo milestone, net cleared, finish). */
  cheer(strength = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.06 * strength, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 1);
  }

  /** Board impact: low thump + noise burst, scaled by impact speed. */
  crash(impact: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const amp = Math.min(0.5, 0.18 + impact * 0.08);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(amp, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.32);

    const burst = ctx.createBufferSource();
    burst.buffer = this.noiseBuffer(ctx, 0.3);
    const burstFilter = ctx.createBiquadFilter();
    burstFilter.type = 'lowpass';
    burstFilter.frequency.value = 900;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(amp * 0.7, t);
    burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    burst.connect(burstFilter).connect(burstGain).connect(this.master);
    burst.start(t);
  }

  /** Hollow plastic thunk for tipping a cone. */
  cone(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /** Sharp little click when a puck is shunted away. */
  puck(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const tick = ctx.createBufferSource();
    tick.buffer = this.noiseBuffer(ctx, 0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    tick.connect(filter).connect(gain).connect(this.master);
    tick.start(t);
  }

  /** Small ascending jingle when the ice is done. */
  finish(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.14;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return null; // unsupported environment – stay silent
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // Engine drone: two detuned saws an octave-and-a-fifth apart
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 280;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 46;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = 69;
    this.engineOsc2.detune.value = 9;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc.start();
    this.engineOsc2.start();

    // Blade scrape, opened by update() while laying clean ice
    const scrape = ctx.createBufferSource();
    scrape.buffer = this.noiseBuffer(ctx, 2);
    scrape.loop = true;
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'bandpass';
    scrapeFilter.frequency.value = 950;
    scrapeFilter.Q.value = 0.7;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrape.connect(scrapeFilter).connect(this.scrapeGain).connect(this.master);
    scrape.start();

    // Crowd murmur: heavily lowpassed noise with a slow LFO swell
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noiseBuffer(ctx, 4);
    crowd.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'lowpass';
    crowdFilter.frequency.value = 420;
    const crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.018;
    this.crowdGain = crowdGain;
    this.crowdFilter = crowdFilter;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(crowdGain.gain);
    crowd.connect(crowdFilter).connect(crowdGain).connect(this.master);
    crowd.start();
    lfo.start();

    return ctx;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
