const STEP = 60 / 76 / 2;
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);

export class StructureMusic {
  constructor(context, output, volume = 0.4) {
    this.context = context;
    this.volume = volume;
    this.playing = false;
    this.index = 0;
    this.notes = 0;
    this.voices = new Set();
    this.input = context.createGain();
    this.level = context.createGain();
    this.ducker = context.createGain();
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 4200;
    this.filter.Q.value = 0.4;
    this.reverb = context.createConvolver();
    const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 2.8), context.sampleRate);
    let noise = 6389;
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        const t = i / context.sampleRate;
        data[i] = (noise / 2147483648 - 1) * Math.exp(-t * 2.4) * Math.min(1, t * 40);
      }
    }
    this.reverb.buffer = impulse;
    this.wet = context.createGain();
    this.wet.gain.value = 0.32;
    this.level.gain.value = 0;
    this.input.connect(this.filter);
    this.filter.connect(this.level);
    this.filter.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.wet.connect(this.level);
    this.level.connect(this.ducker);
    this.ducker.connect(output);
  }
  start() {
    if (this.playing || !this.volume || this.context.state !== 'running') return;
    this.playing = true;
    this.nextTime = this.context.currentTime + 0.04;
    this.level.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.7);
    this.pump();
    this.timer = setInterval(() => this.pump(), 40);
  }
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.context.currentTime;
    this.level.gain.cancelScheduledValues(now);
    this.level.gain.setTargetAtTime(0, now, 0.025);
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.025);
      voice.carrier.stop(now + 0.14);
      voice.modulator.stop(now + 0.14);
    }
  }
  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    if (!this.volume) this.stop();
    else if (this.playing) this.level.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.12);
  }
  duck(duration = 0.8) {
    const now = this.context.currentTime;
    this.duckUntil = Math.max(this.duckUntil ?? 0, now + duration);
    this.ducker.gain.cancelScheduledValues(now);
    this.ducker.gain.setTargetAtTime(0.14, now, 0.008);
    this.ducker.gain.setTargetAtTime(1, this.duckUntil, 0.35);
  }
  pump() {
    if (!this.playing || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.03;
    while (this.nextTime < now + 0.18) {
      this.schedule(this.index++, this.nextTime);
      this.nextTime += STEP;
    }
  }
  schedule(index, time) {
    const root = [38, 38, 36, 41][Math.floor(index / 64) % 4];
    if (index % 16 === 0) this.note(root, time, 6.2, 0.1, 0, 'bed');
    if (index % 32 === 0) {
      this.note(root + 19, time, 9.2, 0.035, -0.35, 'bed');
      this.note(root + 26, time + 0.16, 8.8, 0.025, 0.4, 'bed');
    }
    if (index % 5 === 0 || index % 5 === 3) {
      const cell = Math.floor(index / 5);
      const pitch = [0, 7, 14, 19, 12][(cell + (index % 5 === 3 ? 2 : 0)) % 5];
      this.note(root + 24 + pitch, time, 1.9, 0.12, Math.sin(index * 2.39996) * 0.6, 'crystal');
    }
    if (index % 7 === 2)
      this.note(root + 36 + [7, 2, 0, 9][Math.floor(index / 7) % 4], time, 1.1, 0.045, 0.55, 'crystal');
  }
  note(midi, time, duration, volume, pan, kind) {
    const c = this.context;
    const carrier = c.createOscillator(),
      modulator = c.createOscillator();
    const modulation = c.createGain(),
      gain = c.createGain(),
      panner = c.createStereoPanner();
    const hz = frequency(midi);
    const bed = kind === 'bed';
    carrier.frequency.value = hz;
    modulator.frequency.value = hz * (bed ? 1 : 2.003);
    modulation.gain.setValueAtTime(hz * (bed ? 0.08 : 0.6), time);
    modulation.gain.exponentialRampToValueAtTime(hz * 0.015, time + duration * 0.8);
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + (bed ? 1.5 : 0.045));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    panner.pan.setValueAtTime(pan, time);
    panner.pan.linearRampToValueAtTime(-pan * 0.5, time + duration);
    carrier.connect(gain);
    gain.connect(panner);
    panner.connect(this.input);
    const voice = { carrier, modulator, gain };
    this.voices.add(voice);
    this.notes++;
    carrier.onended = () => {
      for (const node of [carrier, modulator, modulation, gain, panner]) node.disconnect();
      this.voices.delete(voice);
    };
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + duration + 0.04);
    modulator.stop(time + duration + 0.04);
  }
  get snapshot() {
    return {
      playing: this.playing,
      volume: this.volume,
      notes: this.notes,
      voices: this.voices.size,
      ducking: this.context.currentTime < (this.duckUntil ?? 0),
    };
  }
}
