import { StructureMusic, holdAt } from './structure-music.js';

const MAX_VOICES = 36;
export { soundImpression } from './structure-captions.js';

export function voiceProfile(member) {
  const load = Number.isFinite(member.mass)
    ? Math.abs(member.force) / (Math.max(10, member.mass * 9.81) * 0.7 + 20)
    : Math.max(0, member.utilization ?? 0) * 3;
  const grip = load / (1 + load);
  return {
    grip,
    frequency: (260 / Math.max(0.4, member.span) ** 0.12) * (1 - grip * 0.35),
    decay: 0.3 * (1 - grip * 0.78),
    ratios: [1, 1.72, 2.8],
    volume: 0.66 + grip * 0.34,
    waveform: 'triangle',
  };
}

export class StructureAudio {
  constructor() {
    this.enabled = true;
    this.events = 0;
    this.voices = 0;
    this.musicVolume = 0.4;
    this.visible = true;
    this.collapseStops = new Set();
    this.crashEvents = 0;
    this.floorEvents = 0;
  }
  async unlock() {
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return false;
        const c = (this.context = new Audio());
        this.output = c.createGain();
        this.output.gain.value = this.enabled ? 0.42 : 0;
        const limiter = c.createDynamicsCompressor();
        limiter.threshold.value = -18;
        limiter.ratio.value = 8;
        this.output.connect(limiter);
        limiter.connect(c.destination);
        this.music = new StructureMusic(c, this.output, this.musicVolume);
        this.prepareRumble();
        // 電話や他アプリで中断されたあと running に戻ったら音楽を再開する
        c.addEventListener('statechange', () => this.updateMusic());
      }
      if (this.context.state !== 'running')
        // 一部のブラウザはジェスチャー外の resume を保留したままにするので、待ちすぎない
        await Promise.race([this.context.resume(), new Promise((resolve) => setTimeout(resolve, 1500))]);
      this.updateMusic();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.cancelCollapse();
    this.output?.gain.setTargetAtTime(this.enabled ? 0.42 : 0, this.context.currentTime, 0.03);
    this.updateMusic();
    return this.enabled;
  }
  updateMusic() {
    if (this.enabled && this.visible && this.musicVolume > 0) this.music?.start();
    else this.music?.stop();
  }
  setMusicVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.music?.setVolume(this.musicVolume);
    this.updateMusic();
  }
  setVisible(visible) {
    this.visible = visible;
    if (!visible) this.cancelCollapse();
    this.updateMusic();
  }
  strike(member, pan = 0) {
    this.cancelProbe();
    this.music?.duck(0.8);
    const profile = voiceProfile(member);
    this.probeStops = [
      this.tone(profile, pan),
      this.knock(profile, pan),
      profile.grip > 0.01
        ? this.tone({ frequency: 78, decay: 0.12, ratios: [1], volume: profile.grip * 0.45 }, pan)
        : null,
    ];
    return profile;
  }
  cancelProbe() {
    this.probeStops?.forEach((stop) => stop?.());
    this.probeStops = [];
  }
  knock(profile, pan) {
    const c = this.context;
    if (!this.enabled || c?.state !== 'running' || this.voices >= MAX_VOICES) return;
    if (!this.knockNoise) {
      this.knockNoise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.09), c.sampleRate);
      const data = this.knockNoise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const noise = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      panner = c.createStereoPanner(),
      start = c.currentTime;
    noise.buffer = this.knockNoise;
    filter.type = 'bandpass';
    filter.frequency.value = 850 + profile.grip * 2500;
    filter.Q.value = 0.75;
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.output);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.1 + profile.grip * 0.22, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.023);
    gain.gain.linearRampToValueAtTime(0.04 * (1 - profile.grip) ** 2 + 0.001, start + 0.033);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
    this.voices++;
    this.events++;
    noise.onended = () => {
      [noise, filter, gain, panner].forEach((node) => node.disconnect());
      this.voices--;
    };
    noise.start(start);
    noise.stop(start + 0.085);
    return () => noise.stop(c.currentTime);
  }
  tone(profile, pan = 0, delay = 0) {
    const c = this.context;
    if (!this.enabled || c?.state !== 'running' || this.voices >= MAX_VOICES) return;
    const start = c.currentTime + delay;
    const panner = c.createStereoPanner();
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    panner.connect(this.output);
    this.events++;
    const voices = [];
    let remaining = profile.ratios.length;
    profile.ratios.forEach((ratio, i) => {
      const osc = c.createOscillator(),
        gain = c.createGain();
      const duration = profile.decay / (1 + i * 0.45);
      osc.frequency.value = profile.frequency * ratio;
      osc.type = profile.waveform ?? 'sine';
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(((profile.volume ?? 1) * 0.32) / (1 + i * 1.9), start + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(panner);
      this.voices++;
      voices.push({ osc, gain });
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        this.voices--;
        if (--remaining === 0) panner.disconnect();
      };
      osc.start(start);
      osc.stop(start + duration + 0.01);
    });
    return () =>
      voices.forEach(({ osc, gain }) => {
        holdAt(gain.gain, c.currentTime);
        gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.008);
        osc.stop(c.currentTime + 0.04);
      });
  }
  remove() {
    this.music?.duck(0.45);
    this.tone({ frequency: 145, decay: 0.13, ratios: [1, 1.83, 3.61] });
  }
  success() {
    this.music?.duck(1.8);
    [0, 4, 7, 12].forEach((note, i) =>
      this.tone({ frequency: 370 * 2 ** (note / 12), decay: 0.85, ratios: [1, 2.01] }, 0, i * 0.12),
    );
  }
  cancelCollapse() {
    for (const stop of this.collapseStops) stop();
    this.collapseStops.clear();
    this.lastImpact = this.lastFloorImpact = this.lastHeavyImpact = -Infinity;
    this.ground = null;
  }
  crashLayer({
    frequency,
    duration,
    level,
    pan = 0,
    delay = 0,
    noise = false,
    type = 'sine',
    drop = 0.85,
    attack = 0.012,
    cutoff = 260,
    drive = false,
  }) {
    const c = this.context;
    if (!this.enabled || !this.visible || !c || this.voices >= MAX_VOICES) return;
    const now = c.currentTime + delay;
    const source = noise ? c.createBufferSource() : c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    const panner = c.createStereoPanner();
    if (noise) {
      if (!this.impactNoise) {
        this.impactNoise = c.createBuffer(1, Math.ceil(c.sampleRate * 1.5), c.sampleRate);
        const data = this.impactNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      source.buffer = this.impactNoise;
    } else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, now);
      source.frequency.exponentialRampToValueAtTime(
        Math.max(25, frequency * drop),
        now + Math.min(0.15, duration * 0.3),
      );
    }
    filter.type = 'lowpass';
    filter.Q.value = 0.65;
    filter.frequency.setValueAtTime(noise ? frequency : cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(
      noise ? Math.max(55, frequency * drop) : cutoff * 0.75,
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.35), now + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    const shaper = drive ? c.createWaveShaper() : null;
    if (shaper) {
      this.crashCurve ??= Float32Array.from(
        { length: 512 },
        (_, i) => Math.tanh((i / 255.5 - 1) * 2.2) / Math.tanh(2.2),
      );
      shaper.curve = this.crashCurve;
      source.connect(shaper);
      shaper.connect(filter);
    } else source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.output);
    const stop = () => {
      holdAt(gain.gain, c.currentTime);
      gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.008);
      source.stop(c.currentTime + 0.04);
    };
    this.collapseStops.add(stop);
    this.voices++;
    this.events++;
    source.onended = () => {
      for (const node of [source, filter, gain, panner, shaper]) node?.disconnect();
      this.voices--;
      this.collapseStops.delete(stop);
    };
    if (noise) source.start(now, Math.random() * 0.2);
    else source.start(now);
    source.stop(now + duration + 0.015);
  }
  prepareRumble() {
    const c = this.context;
    if (!this.rumbleNoise) {
      this.rumbleNoise = c.createBuffer(2, c.sampleRate * 3, c.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = this.rumbleNoise.getChannelData(channel);
        let brown = 0;
        for (let i = 0; i < data.length; i++) {
          brown = (brown + (Math.random() * 2 - 1) * 0.035) / 1.035;
          data[i] = brown * 4;
        }
      }
    }
  }
  groundRumble(strength) {
    const c = this.context;
    if (!this.enabled || !this.visible || c?.state !== 'running') return;
    if (!this.ground) {
      this.prepareRumble();
      if (this.voices >= MAX_VOICES) return;
      const source = c.createBufferSource(),
        low = c.createBiquadFilter(),
        high = c.createBiquadFilter(),
        gain = c.createGain();
      source.buffer = this.rumbleNoise;
      source.loop = true;
      high.type = 'highpass';
      high.frequency.value = 24;
      high.Q.value = 0.6;
      low.type = 'lowpass';
      low.frequency.value = 135;
      low.Q.value = 0.75;
      gain.gain.value = 0;
      source.connect(high);
      high.connect(low);
      low.connect(gain);
      gain.connect(this.output);
      const ground = { source, gain, strength: 0 };
      this.ground = ground;
      const stop = () => {
        holdAt(gain.gain, c.currentTime);
        gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.008);
        source.stop(c.currentTime + 0.04);
      };
      this.collapseStops.add(stop);
      this.voices++;
      this.events++;
      source.onended = () => {
        [source, high, low, gain].forEach((node) => node.disconnect());
        this.voices--;
        this.collapseStops.delete(stop);
        if (this.ground === ground) this.ground = null;
      };
      source.start();
    }
    const now = c.currentTime;
    this.ground.strength = Math.max(strength, this.ground.strength * 0.85);
    const gain = this.ground.gain.gain;
    holdAt(gain, now);
    gain.setTargetAtTime(0.18 + this.ground.strength * 0.42, now, 0.04);
    gain.setTargetAtTime(0.0001, now + 0.22, 0.65);
    this.ground.source.stop(now + 4);
  }
  collapse() {
    this.cancelCollapse();
    if (!this.enabled || this.context?.state !== 'running') return;
    this.music?.duck(5);
    this.crashLayer({ frequency: 190, duration: 0.5, level: 0.11, noise: true, drop: 0.5 });
    this.crashLayer({ frequency: 58, duration: 0.65, level: 0.13, drop: 0.82, drive: true });
  }
  impact({ speed, mass, point, floor = false, material = 'stone', pan = point[0] * 0.12 }) {
    const c = this.context;
    if (!this.enabled || !this.visible || c?.state !== 'running' || speed < 0.6) return;
    const now = c.currentTime;
    const strength = Math.min(1, (Math.sqrt(mass) * speed) / 9);
    if (floor && strength > 0.12) this.groundRumble(strength);
    const clock = floor ? 'lastFloorImpact' : 'lastImpact';
    if (now - (this[clock] ?? -Infinity) < (floor ? 0.055 : 0.095) || this.voices > 28) return;
    this[clock] = now;
    this.crashEvents++;
    if (floor) this.floorEvents++;
    this.music?.duck(2.2);
    const heavy =
      ((floor && strength > 0.16) || strength > 0.72) && now - (this.lastHeavyImpact ?? -Infinity) > 0.26;
    if (heavy) {
      this.lastHeavyImpact = now;
      this.crashLayer({
        frequency: 53,
        duration: 1.2 + strength * 0.35,
        level: 0.22 + strength * 0.4,
        pan: pan * 0.2,
        drop: 0.75,
        drive: true,
        cutoff: 190,
      });
      this.crashLayer({
        frequency: 87,
        duration: 0.72,
        level: 0.1 + strength * 0.2,
        pan: pan * 0.35,
        drop: 0.82,
        drive: true,
      });
      this.crashLayer({
        frequency: 240,
        duration: 0.75 + strength * 0.4,
        level: 0.24 + strength * 0.33,
        pan: pan * 0.4,
        noise: true,
        drop: 0.25,
      });
    } else {
      this.crashLayer({
        frequency: material === 'wood' ? 105 : 125,
        duration: 0.32,
        level: 0.025 + strength * 0.08,
        pan,
        drop: 0.88,
        cutoff: 220,
      });
    }
    const wood = material === 'wood';
    this.crashLayer({
      frequency: wood ? 750 : 1500,
      duration: wood ? 0.075 : 0.12,
      level: (floor ? 0.07 : 0.035) + strength * (floor ? 0.32 : 0.14),
      pan,
      noise: true,
      attack: 0.002,
      drop: wood ? 0.38 : 0.24,
    });
    if (wood)
      this.crashLayer({
        frequency: 185 / Math.max(1, mass / 3) ** 0.12,
        duration: 0.16,
        level: 0.035 + strength * 0.16,
        pan,
        attack: 0.003,
        drop: 0.94,
        cutoff: 520,
        type: 'triangle',
      });
  }
}
