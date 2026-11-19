import { NOTES, NOTE_SECONDS } from "./notes";

export const INSTRUMENTS = [
  { id: "veena", label: "Indian Veena" },
  { id: "flute", label: "Indian Flute" },
  { id: "classic", label: "Classic" },
];

export function scheduleNotes(ctx, startAt, outputs, instrument = "veena") {
  NOTES.forEach((note, index) => {
    const start = startAt + index * NOTE_SECONDS;
    const master = ctx.createGain();
    outputs.forEach((output) => master.connect(output));

    if (instrument === "flute") {
      scheduleFlute(ctx, note.frequency, start, master);
    } else if (instrument === "classic") {
      scheduleClassic(ctx, note.frequency, start, master);
    } else {
      scheduleVeena(ctx, note.frequency, start, master);
    }
  });
}

function scheduleClassic(ctx, frequency, start, output) {
  const fundamental = createOscillator(ctx, "triangle", frequency, start, output);
  const overtone = createOscillator(ctx, "sine", frequency * 2, start, output, 0.18);
  applyEnvelope(output, start, 0.22, 0.14, 0.99);
  stopOscillators([fundamental, overtone], start + NOTE_SECONDS);
}

function scheduleVeena(ctx, frequency, start, output) {
  const fundamental = createOscillator(ctx, "triangle", frequency, start, output);
  const second = createOscillator(ctx, "sawtooth", frequency * 2, start, output, 0.14);
  const third = createOscillator(ctx, "sine", frequency * 3, start, output, 0.07);
  fundamental.detune.setValueAtTime(-5, start);
  fundamental.detune.linearRampToValueAtTime(0, start + 0.16);
  applyEnvelope(output, start, 0.23, 0.15, 1.02);
  stopOscillators([fundamental, second, third], start + NOTE_SECONDS);
}

function scheduleFlute(ctx, frequency, start, output) {
  const breath = createOscillator(ctx, "sine", frequency, start, output);
  const body = createOscillator(ctx, "triangle", frequency * 2, start, output, 0.11);
  const vibrato = ctx.createOscillator();
  const vibratoGain = ctx.createGain();
  vibrato.frequency.value = 5.2;
  vibratoGain.gain.value = 2.4;
  vibrato.connect(vibratoGain);
  vibratoGain.connect(breath.detune);
  vibrato.start(start);
  applyEnvelope(output, start, 0.2, 0.16, 0.99, 0.1);
  stopOscillators([breath, body, vibrato], start + NOTE_SECONDS);
}

function createOscillator(ctx, type, frequency, start, output, volume = 1) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  return oscillator;
}

function applyEnvelope(output, start, peak, sustain, end, attack = 0.02) {
  output.gain.setValueAtTime(0, start);
  output.gain.linearRampToValueAtTime(peak, start + attack);
  output.gain.linearRampToValueAtTime(sustain, start + 0.2);
  output.gain.linearRampToValueAtTime(0, start + end);
}

function stopOscillators(oscillators, stopAt) {
  oscillators.forEach((oscillator) => oscillator.stop(stopAt));
}
