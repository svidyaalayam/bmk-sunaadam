const NOTES = [
  { name: "C", frequency: 261.63 },
  { name: "C#", frequency: 277.18 },
  { name: "D", frequency: 293.66 },
  { name: "D#", frequency: 311.13 },
  { name: "E", frequency: 329.63 },
  { name: "F", frequency: 349.23 },
  { name: "F#", frequency: 369.99 },
  { name: "G", frequency: 392.0 },
  { name: "G#", frequency: 415.3 },
  { name: "A", frequency: 440.0 },
  { name: "A#", frequency: 466.16 },
  { name: "B", frequency: 493.88 },
];

export { NOTES as SHRUTHI_NOTES };

const DRONE_INTERVALS = {
  ma: 5,
  pa: 7,
  ni: 11,
  null: null,
};

export function createShruthiBox() {
  let context = null;
  let masterGain = null;
  let voices = [];
  let patternTimer = null;
  let activeIndex = -1;
  let currentVolume = 0.14;

  function ensureContext() {
    if (!context || context.state === "closed") {
      context = new AudioContext();
      masterGain = context.createGain();
      masterGain.gain.value = currentVolume;
      masterGain.connect(context.destination);
    }
  }

  async function play(index, drone = "pa") {
    const note = NOTES[index];
    if (!note) return;

    ensureContext();

    if (context.state === "suspended") {
      await context.resume();
    }

    stop();

    const filter = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.4;
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.25;
    filter.connect(compressor);
    compressor.connect(masterGain);

    const interval = DRONE_INTERVALS[drone];
    const droneFrequency =
      interval === null ? note.frequency : note.frequency * 2 ** (interval / 12);
    const pattern = [
      droneFrequency / 2,
      note.frequency,
      note.frequency,
      note.frequency / 2,
    ];
    let step = 0;
    const pluck = () => {
      voices.push(...playPluck(pattern[step], filter));
      step = (step + 1) % pattern.length;
    };

    pluck();
    patternTimer = window.setInterval(pluck, 1000);

    activeIndex = index;
  }

  function stop() {
    if (patternTimer !== null) {
      window.clearInterval(patternTimer);
      patternTimer = null;
    }

    const currentVoices = voices;
    voices = [];
    currentVoices.forEach(({ oscillator, voiceGain }) => {
      const now = context?.currentTime ?? 0;
      voiceGain.gain.cancelScheduledValues(now);
      voiceGain.gain.setTargetAtTime(0.0001, now, 0.08);
      oscillator.stop(now + 0.32);
    });
    activeIndex = -1;
  }

  function close() {
    stop();
    if (context && context.state !== "closed") {
      context.close();
    }
    context = null;
    masterGain = null;
  }

  function setVolume(val) {
    currentVolume = val;
    if (masterGain) {
      masterGain.gain.value = val;
    }
  }

  return {
    play,
    stop,
    close,
    setVolume,
    get activeIndex() {
      return activeIndex;
    },
  };
}

function playPluck(frequency, output) {
  const context = output.context;
  const partials = [
    { ratio: 1, level: 0.17, type: "triangle", decay: 3.6 },
    { ratio: 2, level: 0.08, type: "sawtooth", decay: 5.4 },
    { ratio: 3, level: 0.045, type: "sine", decay: 5.4 },
    { ratio: 4, level: 0.02, type: "sine", decay: 5.4 },
  ];

  return partials.map(({ ratio, level, type, decay }) => {
    const oscillator = context.createOscillator();
    const voiceGain = context.createGain();
    const start = context.currentTime + 0.015;
    oscillator.type = type;
    oscillator.frequency.value = frequency * ratio;
    oscillator.detune.value = ratio === 1 ? -2 : ratio * 1.5;
    voiceGain.gain.setValueAtTime(0.0001, start);
    voiceGain.gain.linearRampToValueAtTime(level, start + 0.018);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    oscillator.connect(voiceGain);
    voiceGain.connect(output);
    oscillator.start(start);
    oscillator.stop(start + decay + 0.04);
    return { oscillator, voiceGain };
  });
}
