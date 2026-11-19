const CHROMATIC_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DEFAULT_SWARA_INTERVALS = {
  S: 0,
  R: 2,
  G: 4,
  M: 5,
  P: 7,
  D: 9,
  N: 11,
};
const NUMBERED_SWARA_INTERVALS = {
  R1: 1, R2: 2, R3: 3,
  G1: 2, G2: 3, G3: 4,
  M1: 5, M2: 6,
  D1: 8, D2: 9, D3: 10,
  N1: 9, N2: 10, N3: 11,
};

export const CARNATIC_INSTRUMENTS = [
  { id: "veena", label: "Indian Veena" },
  { id: "flute", label: "Indian Flute" },
  { id: "violin", label: "Indian Violin" },
  { id: "nadaswaram", label: "Nadaswaram" },
  { id: "piano", label: "Piano" },
];

function getShruthiFrequency(shruthi) {
  const [, octave, noteName] = shruthi.match(/^(lower|normal|higher)-(.+)$/) || [];
  const noteIndex = CHROMATIC_NOTES.indexOf(noteName);
  if (noteIndex < 0) return 392;
  const octaveOffset = octave === "lower" ? -1 : octave === "higher" ? 1 : 0;
  return 261.63 * 2 ** ((noteIndex + octaveOffset * 12) / 12);
}

export function createCarnaticAudio() {
  let context = null;
  let activeVoice = null;
  let activeBellNodes = [];

  function getContext() {
    if (!context || context.state === "closed") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported.");
      context = new AudioContextClass();
    }
    return context;
  }

  function stopVoice() {
    if (!activeVoice || !context || context.state === "closed") return;
    const stopAt = context.currentTime + 0.04;
    activeVoice.gain.gain.cancelScheduledValues(context.currentTime);
    activeVoice.gain.gain.setValueAtTime(activeVoice.gain.gain.value, context.currentTime);
    activeVoice.gain.gain.linearRampToValueAtTime(0.0001, stopAt);
    activeVoice.nodes.forEach((node) => {
      try {
        node.stop(stopAt);
      } catch {
        // The node may already have ended.
      }
    });
    activeVoice = null;
  }

  function stopBell() {
    activeBellNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // The bell may already have ended.
      }
    });
    activeBellNodes = [];
  }

  function stop() {
    stopVoice();
    stopBell();
  }

  function playNote(
    note,
    shruthi,
    volume,
    swaraIntervals = DEFAULT_SWARA_INTERVALS,
    instrument = "veena",
    duration = 0.8,
    gamakamAmount = 0,
  ) {
    const audioContext = getContext();
    if (audioContext.state === "suspended") audioContext.resume();
    stopVoice();

    const match = note.match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
    if (!match) return;
    const [, swara, swaraNumber, , octaveMark] = match;
    const octaveOffset = octaveMark === "+" ? 12 : octaveMark === "-" ? -12 : 0;
    const interval = swaraNumber
      ? NUMBERED_SWARA_INTERVALS[`${swara}${swaraNumber}`]
      : Number((swaraIntervals || DEFAULT_SWARA_INTERVALS)[swara]);
    if (!Number.isFinite(interval)) return;
    const frequency = getShruthiFrequency(shruthi) * 2 ** ((interval + octaveOffset) / 12);
    const start = audioContext.currentTime;
    const isSustained = ["flute", "violin", "nadaswaram"].includes(instrument);
    const end = start + Math.max(duration, isSustained ? 0.2 : 0.12);
    const attack = isSustained ? Math.min(0.06, (end - start) * 0.25) : 0.015;
    const release = isSustained ? Math.min(0.1, (end - start) * 0.3) : 0.06;
    const releaseStart = Math.max(start + attack, end - release);
    const peakVolume = Math.max(volume, 0.0001);
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peakVolume, start + attack);
    gain.gain.setValueAtTime(peakVolume, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(audioContext.destination);

    const oscillators = [];
    const addOscillator = (type, multiplier, level = 1) => {
      const oscillator = audioContext.createOscillator();
      const overtoneGain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency * multiplier, start);
      overtoneGain.gain.value = level;
      oscillator.connect(overtoneGain);
      overtoneGain.connect(gain);
      oscillator.start(start);
      oscillator.stop(end);
      oscillators.push(oscillator);
      if (gamakamAmount > 0) {
        const lfo = audioContext.createOscillator();
        const lfoGain = audioContext.createGain();
        lfo.frequency.value = 5.5;
        lfoGain.gain.value = gamakamAmount * 0.6;
        lfo.connect(lfoGain);
        lfoGain.connect(oscillator.detune);
        lfo.start(start);
        lfo.stop(end);
        oscillators.push(lfo);
      }
    };

    if (instrument === "flute") {
      addOscillator("sine", 1);
      addOscillator("triangle", 2, 0.12);
    } else if (instrument === "violin") {
      addOscillator("sawtooth", 1, 0.35);
      addOscillator("triangle", 1.01, 0.7);
    } else if (instrument === "nadaswaram") {
      addOscillator("sawtooth", 1, 0.55);
      addOscillator("square", 2, 0.2);
      addOscillator("sine", 3, 0.1);
    } else if (instrument === "piano") {
      addOscillator("triangle", 1);
      addOscillator("sine", 2, 0.18);
    } else {
      addOscillator("triangle", 1);
      addOscillator("sawtooth", 2, 0.14);
      addOscillator("sine", 3, 0.07);
    }
    activeVoice = { gain, nodes: oscillators };
  }

  function playBell(shruthi, volume = 0.14) {
    const audioContext = getContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const start = audioContext.currentTime;
    const end = start + 0.42;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(audioContext.destination);

    const nodes = [1, 2.01, 2.99].map((partial, index) => {
      const oscillator = audioContext.createOscillator();
      const partialGain = audioContext.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(getShruthiFrequency(shruthi) * partial, start);
      partialGain.gain.value = index === 0 ? 1 : index === 1 ? 0.35 : 0.16;
      oscillator.connect(partialGain);
      partialGain.connect(gain);
      oscillator.start(start);
      oscillator.stop(end);
      return oscillator;
    });
    activeBellNodes.push(...nodes);
  }

  return {
    playNote,
    playBell,
    stop,
    async resume() {
      const ctx = getContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
    },
    close() {
      stop();
      if (context && context.state !== "closed") context.close();
      context = null;
    },
  };
}
