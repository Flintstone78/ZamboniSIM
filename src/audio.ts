/** Pick a native English (preferably male, British/American) TTS voice so the
 *  heckles aren't read by the OS's local-language voice with an accent. */
function pickEnglishMaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en[-_]?/i.test(v.lang));
  if (en.length === 0) return null;
  const male = /\b(male|david|daniel|george|james|fred|alex|arthur|guy|mark|tom|oliver|ryan|brian|matthew|google uk english male|microsoft (david|mark|guy))\b/i;
  const female = /\b(female|zira|susan|hazel|samantha|victoria|karen|moira|tessa|fiona|serena|catherine|google us english)\b/i;
  return (
    en.find((v) => male.test(v.name) && /en[-_]?gb/i.test(v.lang)) ??
    en.find((v) => male.test(v.name)) ??
    en.find((v) => !female.test(v.name) && /en[-_]?gb/i.test(v.lang)) ??
    en.find((v) => !female.test(v.name)) ??
    en[0]
  );
}

/**
 * All sound is synthesised with the Web Audio API – no asset files. Engine =
 * detuned saws through a lowpass, scrape = looped noise through a bandpass,
 * crowd = slow noise swells. The context is created lazily on the first user
 * gesture to satisfy autoplay policies, so the game runs silent (and without
 * errors) until the player touches a key. Heckles use the browser's TTS.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private engineLfo!: OscillatorNode;
  private scrapeGain!: GainNode;
  private scrapeHissGain!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private crowdVoicesGain!: GainNode;
  private crowdLevel = 0; // last intensity from setCrowd – gates the whistles
  private whistleTimer = 6;
  private muted = localStorage.getItem('zambonisim.muted') === '1';
  private heckleVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    const unlock = (): void => {
      this.ensureContext();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);

    // Voices load asynchronously; grab an English male one for the heckles
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (synth) {
      const refresh = () => (this.heckleVoice = pickEnglishMaleVoice(synth.getVoices()));
      refresh();
      synth.addEventListener?.('voiceschanged', refresh);
    }
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
    // TTS heckles run outside WebAudio – cut any announcer mid-sentence too
    if (this.muted) window.speechSynthesis?.cancel();
    return this.muted;
  }

  /** Per-frame: engine pitch/volume follow speed, scrape follows the blade. */
  update(speed: number, throttle: number, scraping: boolean, dt = 1 / 60): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = Math.abs(speed);
    const rpm = 46 + s * 9 + Math.abs(throttle) * 8;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.12);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(260 + s * 50, t, 0.12);
    // Diesel chug: the idle wobble slows/steadies as the revs climb
    this.engineLfo.frequency.setTargetAtTime(7 + s * 1.6, t, 0.2);
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
    // Bright shaved-ice hiss rides on top of the scrape, keyed harder to speed
    this.scrapeHissGain.gain.setTargetAtTime(
      scraping ? Math.min(0.035, s * 0.007) : 0,
      t,
      0.08,
    );

    // The odd distant whistle once the crowd is into it
    this.whistleTimer -= dt;
    if (this.whistleTimer <= 0) {
      this.whistleTimer = 5 + Math.random() * 9;
      if (this.crowdLevel > 0.35 && !this.muted) this.whistle();
    }
  }

  /** Swell the crowd murmur with progress/excitement (0..1). */
  setCrowd(intensity: number): void {
    this.crowdLevel = intensity;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.crowdGain) return;
    const t = ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.016 + intensity * 0.05, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(420 + intensity * 900, t, 0.4);
    // The "voices" band only comes up once the building is actually buzzing
    this.crowdVoicesGain.gain.setTargetAtTime(intensity * 0.02, t, 0.5);
  }

  /** A single faraway fan whistle – two quick falling chirps. */
  private whistle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [start, f0] of [[0, 2350], [0.16, 2500]] as const) {
      const t = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.78, t + 0.13);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.011, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.18);
    }
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

  /** Speak a heckle line aloud via the browser's TTS (no-op if unavailable or
   *  muted). A low, slightly slow voice reads like a grumpy rink announcer. */
  speak(text: string): void {
    if (this.muted) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      if (!this.heckleVoice) this.heckleVoice = pickEnglishMaleVoice(synth.getVoices());
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Force English so a Swedish system voice doesn't read it with an accent
      u.lang = this.heckleVoice?.lang ?? 'en-GB';
      if (this.heckleVoice) u.voice = this.heckleVoice;
      u.rate = 0.96;
      u.pitch = 0.8;
      u.volume = 0.95;
      synth.speak(u);
    } catch {
      /* TTS unavailable – the crowd groan still plays */
    }
  }

  /** A disappointed crowd groan – "ooooh, you missed a spot". */
  jeer(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.7); // falling "ohh"
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.1);
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
    // Diesel chug: a slow LFO wobbling the engine volume
    this.engineLfo = ctx.createOscillator();
    this.engineLfo.frequency.value = 7;
    const chugGain = ctx.createGain();
    chugGain.gain.value = 0.014;
    this.engineLfo.connect(chugGain).connect(this.engineGain.gain);
    this.engineLfo.start();

    // Blade scrape, opened by update() while laying clean ice. Two layers:
    // the mid-band grind plus a bright "shaved ice" hiss on top.
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
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 2800;
    this.scrapeHissGain = ctx.createGain();
    this.scrapeHissGain.gain.value = 0;
    scrape.connect(hissFilter).connect(this.scrapeHissGain).connect(this.master);
    scrape.start();

    // Crowd murmur: heavily lowpassed noise with a slow LFO swell, plus a
    // mid "voices" band that only opens when the building is buzzing
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
    const voicesFilter = ctx.createBiquadFilter();
    voicesFilter.type = 'bandpass';
    voicesFilter.frequency.value = 900;
    voicesFilter.Q.value = 0.5;
    this.crowdVoicesGain = ctx.createGain();
    this.crowdVoicesGain.gain.value = 0;
    const voicesLfo = ctx.createOscillator();
    voicesLfo.frequency.value = 0.17;
    const voicesLfoGain = ctx.createGain();
    voicesLfoGain.gain.value = 0.006;
    voicesLfo.connect(voicesLfoGain).connect(this.crowdVoicesGain.gain);
    crowd.connect(voicesFilter).connect(this.crowdVoicesGain).connect(this.master);
    voicesLfo.start();

    return ctx;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
