import { buildTalamRows, noteDurationUnits } from "./carnatic.js";

const CHROMATIC_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DEFAULT_SWARA_INTERVALS = { S: 0, R: 2, G: 4, M: 5, P: 7, D: 9, N: 11 };
const NUMBERED_SWARA_INTERVALS = {
  R1: 1, R2: 2, R3: 3,
  G1: 2, G2: 3, G3: 4,
  M1: 5, M2: 6,
  D1: 8, D2: 9, D3: 10,
  N1: 9, N2: 10, N3: 11,
};
const SWARA_ORDER = ["S", "R", "G", "M", "P", "D", "N"];
const CANONICAL_SWARA_BY_INTERVAL = {
  0: "S",
  1: "R1",
  2: "R2",
  3: "R3",
  4: "G3",
  5: "M1",
  6: "M2",
  7: "P",
  8: "D1",
  9: "D2",
  10: "D3",
  11: "N3",
};
const ANALYSIS_SAMPLE_RATE = 24000;
const FRAME_SIZE = 2048;
const MAX_ANALYSIS_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ANALYSIS_DURATION_SECONDS = 600;
const MIN_ANALYSIS_FREQUENCY = 60;
const MAX_ANALYSIS_FREQUENCY = 2000;
const MIN_CONFIDENCE = 0.65;
const TUNING_TOLERANCE_CENTS = 75;

function getShruthiFrequency(shruthi) {
  const [, octave, noteName] = String(shruthi || "").match(/^(lower|normal|higher)-(.+)$/) || [];
  const noteIndex = CHROMATIC_NOTES.indexOf(noteName);
  if (noteIndex < 0) return null;
  const octaveOffset = octave === "lower" ? -1 : octave === "higher" ? 1 : 0;
  return 261.63 * 2 ** ((noteIndex + octaveOffset * 12) / 12);
}

function getExpectedFrequency(note, shruthi, swaraIntervals) {
  const match = String(note).match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
  const baseFrequency = getShruthiFrequency(shruthi);
  if (!match || !baseFrequency) return null;

  const [, swara, number, , octaveMark] = match;
  const interval = number
    ? NUMBERED_SWARA_INTERVALS[`${swara}${number}`]
    : Number((swaraIntervals || DEFAULT_SWARA_INTERVALS)[swara]);
  if (!Number.isFinite(interval)) return null;
  const octaveOffset = octaveMark === "+" ? 12 : octaveMark === "-" ? -12 : 0;
  return baseFrequency * 2 ** ((interval + octaveOffset) / 12);
}

export function buildExpectedNoteTimeline(playbackSchedule) {
  const timeline = [];
  let noteNumber = 0;

  for (const [tableIndex, table] of (playbackSchedule || []).entries()) {
    const {
      notes = [],
      beats,
      notesPerBeat,
      cyclesPerRow,
      tableStartTime = 0,
      bpm = 60,
      repeatCount = 1,
      repeatToCompleteTalam = true,
      completeTalamWithEmptyNotes = false,
    } = table;
    if (!beats || !notesPerBeat || !bpm) continue;

    const rows = buildTalamRows(
      notes,
      beats,
      notesPerBeat,
      cyclesPerRow || 1,
      repeatToCompleteTalam,
      completeTalamWithEmptyNotes,
    );
    const rowNotes = rows.flat(2);
    const secondsPerUnit = 60 / bpm / notesPerBeat / 4;
    const duration = rowNotes.reduce(
      (total, note) => total + noteDurationUnits(note) * secondsPerUnit,
      0,
    );

    for (let repeatIndex = 0; repeatIndex < Math.max(1, repeatCount); repeatIndex += 1) {
      let elapsed = 0;
      let tableNoteIndex = 0;
      let lastSoundingNote = null;
      for (const note of rowNotes) {
        const noteDuration = noteDurationUnits(note) * secondsPerUnit;
        if (note.startsWith(";")) {
          if (lastSoundingNote) lastSoundingNote.endTime += noteDuration;
        } else {
          lastSoundingNote = {
            index: noteNumber,
            tableIndex,
            partKey: table.partKey,
            sectionIndex: table.sectionIndex,
            tableNoteIndex,
            repeatIndex,
            note,
            startTime: tableStartTime + repeatIndex * duration + elapsed,
            endTime: tableStartTime + repeatIndex * duration + elapsed + noteDuration,
          };
          timeline.push(lastSoundingNote);
          noteNumber += 1;
          tableNoteIndex += 1;
        }
        elapsed += noteDuration;
      }
    }
  }

  return timeline;
}

export function getNoteRange(reportNotes, startNoteIndex, endNoteIndex) {
  const startNote = reportNotes.find((note) => String(note.index) === String(startNoteIndex));
  const endNote = reportNotes.find((note) => String(note.index) === String(endNoteIndex));
  if (!startNote || !endNote || startNote.startTime >= endNote.endTime) return null;
  return {
    startTime: startNote.startTime,
    endTime: endNote.endTime,
    startNote,
    endNote,
  };
}

export function chooseNoteSelectionCandidate(noteResults, target, startNoteIndex, endNoteIndex) {
  if (!noteResults?.length || !["from", "to"].includes(target)) return null;
  const candidates = [...noteResults].sort((a, b) => a.index - b.index);
  let startIndex = Number(startNoteIndex);
  let endIndex = Number(endNoteIndex);

  if (target === "from") {
    const eligible = candidates.filter((note) => note.index <= endIndex);
    const selected = eligible.length ? eligible[eligible.length - 1] : candidates[0];
    startIndex = selected.index;
    if (selected.index > endIndex) endIndex = selected.index;
  } else {
    const eligible = candidates.filter((note) => note.index >= startIndex);
    const selected = eligible.length ? eligible[0] : candidates[candidates.length - 1];
    endIndex = selected.index;
    if (selected.index < startIndex) startIndex = selected.index;
  }

  return {
    startIndex: String(startIndex),
    endIndex: String(endIndex),
  };
}

function downsampleAudioBuffer(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sourceLength = audioBuffer.length;
  const sourceRate = audioBuffer.sampleRate;
  const ratio = sourceRate / ANALYSIS_SAMPLE_RATE;
  const outputLength = Math.floor(sourceLength / ratio);
  const mono = new Float32Array(outputLength);
  const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourceStart = Math.floor(outputIndex * ratio);
    const sourceEnd = Math.min(sourceLength, Math.floor((outputIndex + 1) * ratio));
    let total = 0;
    let count = 0;
    for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
      for (const channel of channels) total += channel[sourceIndex] / channelCount;
      count += 1;
    }
    mono[outputIndex] = count ? total / count : 0;
  }
  return mono;
}

function estimatePitch(samples, startIndex) {
  let mean = 0;
  for (let index = 0; index < FRAME_SIZE; index += 1) mean += samples[startIndex + index];
  mean /= FRAME_SIZE;

  const frame = new Float32Array(FRAME_SIZE);
  let energy = 0;
  for (let index = 0; index < FRAME_SIZE; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FRAME_SIZE - 1));
    const value = (samples[startIndex + index] - mean) * window;
    frame[index] = value;
    energy += value * value;
  }
  if (energy < 1e-5) return null;

  const minimumLag = Math.floor(ANALYSIS_SAMPLE_RATE / MAX_ANALYSIS_FREQUENCY);
  const maximumLag = Math.min(
    Math.floor(ANALYSIS_SAMPLE_RATE / MIN_ANALYSIS_FREQUENCY),
    Math.floor(FRAME_SIZE / 2),
  );
  const difference = new Float64Array(maximumLag + 1);
  let cumulativeDifference = 0;
  const normalizedDifference = new Float64Array(maximumLag + 1);

  for (let lag = 1; lag <= maximumLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < FRAME_SIZE - lag; index += 1) {
      const delta = frame[index] - frame[index + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
    cumulativeDifference += sum;
    normalizedDifference[lag] = cumulativeDifference
      ? (sum * lag) / cumulativeDifference
      : 1;
  }

  let bestLag = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    if (
      normalizedDifference[lag] < 0.18 &&
      (lag === maximumLag || normalizedDifference[lag] <= normalizedDifference[lag + 1])
    ) {
      bestLag = lag;
      break;
    }
  }
  if (!bestLag) {
    for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
      if (!bestLag || normalizedDifference[lag] < normalizedDifference[bestLag]) bestLag = lag;
    }
  }

  const confidence = 1 - normalizedDifference[bestLag];
  if (confidence < MIN_CONFIDENCE) return null;

  const previous = normalizedDifference[bestLag - 1];
  const current = normalizedDifference[bestLag];
  const next = normalizedDifference[bestLag + 1];
  const denominator = 2 * (2 * current - previous - next);
  const adjustment = denominator ? (previous - next) / denominator : 0;
  const period = bestLag + Math.max(-0.5, Math.min(0.5, adjustment));
  return { frequency: ANALYSIS_SAMPLE_RATE / period, confidence };
}

function pitchName(frequency) {
  const midiNote = Math.round(69 + 12 * Math.log2(frequency / 440));
  const noteName = CHROMATIC_NOTES[((midiNote % 12) + 12) % 12];
  return `${noteName}${Math.floor(midiNote / 12) - 1}`;
}

function getCarnaticSwara(frequency, shruthi, swaraIntervals) {
  const tonicFrequency = getShruthiFrequency(shruthi);
  if (!tonicFrequency) return null;
  const semitoneOffset = Math.round(12 * Math.log2(frequency / tonicFrequency));
  const interval = ((semitoneOffset % 12) + 12) % 12;
  const intervals = swaraIntervals || DEFAULT_SWARA_INTERVALS;

  const matchingSwara = SWARA_ORDER.find((swara) => Number(intervals[swara]) === interval);
  let swaraName = null;
  if (matchingSwara) {
    swaraName = Object.entries(NUMBERED_SWARA_INTERVALS)
      .find(([name, value]) => name.startsWith(matchingSwara) && value === interval)?.[0]
      || (matchingSwara === "S" || matchingSwara === "P"
        ? matchingSwara
        : CANONICAL_SWARA_BY_INTERVAL[interval]);
  }
  swaraName ||= CANONICAL_SWARA_BY_INTERVAL[interval];

  return {
    name: swaraName,
    octave: Math.floor(semitoneOffset / 12),
  };
}

function getPitchClassCentsOff(centsOff) {
  return ((centsOff + 600) % 1200 + 1200) % 1200 - 600;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleNotePitch(samples, note) {
  const start = Math.max(0, Math.round(note.startTime * ANALYSIS_SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round(note.endTime * ANALYSIS_SAMPLE_RATE));
  const noteLength = end - start;
  if (noteLength < FRAME_SIZE) return { status: "tooShort" };

  const lastStart = end - FRAME_SIZE;
  const positions = [0.25, 0.5, 0.75].map((fraction) => (
    Math.round(start + Math.max(0, lastStart - start) * fraction)
  ));
  const estimates = [...new Set(positions)]
    .map((position) => estimatePitch(samples, position))
    .filter(Boolean);
  if (!estimates.length) return { status: "notRecognized" };

  return {
    frequency: median(estimates.map((estimate) => estimate.frequency)),
    confidence: median(estimates.map((estimate) => estimate.confidence)),
  };
}

export function analyzePracticeAudioBuffer(audioBuffer, settings) {
  const timeline = buildExpectedNoteTimeline(settings.playbackSchedule);
  const samples = downsampleAudioBuffer(audioBuffer);
  const notes = timeline.map((item) => {
    const expectedFrequency = getExpectedFrequency(
      item.note,
      settings.shruthi,
      settings.swaraIntervals,
    );
    if (!expectedFrequency) {
      return { ...item, expectedFrequency: null, status: "notRecognized", detectedNote: null, centsOff: null };
    }

    const estimate = sampleNotePitch(samples, item);
    if (estimate.status) {
      return {
        ...item,
        expectedFrequency,
        status: estimate.status,
        detectedNote: null,
        centsOff: null,
      };
    }
    const centsOff = 1200 * Math.log2(estimate.frequency / expectedFrequency);
    const pitchClassCentsOff = getPitchClassCentsOff(centsOff);
    const octaveDifference = Math.round(centsOff / 1200);
    const detectedCarnaticSwara = getCarnaticSwara(
      estimate.frequency,
      settings.shruthi,
      settings.swaraIntervals,
    );
    return {
      ...item,
      expectedFrequency,
      detectedFrequency: estimate.frequency,
      detectedNote: pitchName(estimate.frequency),
      detectedSwara: detectedCarnaticSwara?.name || null,
      detectedRegister: detectedCarnaticSwara?.octave ?? null,
      confidence: estimate.confidence,
      centsOff,
      pitchClassCentsOff,
      octaveDifference,
      direction: pitchClassCentsOff > 0 ? "sharp" : "flat",
      semitoneDifference: Math.max(1, Math.round(Math.abs(pitchClassCentsOff) / 100)),
      status: Math.abs(pitchClassCentsOff) <= TUNING_TOLERANCE_CENTS ? "correct" : "incorrect",
    };
  });

  const correct = notes.filter((note) => note.status === "correct").length;
  const incorrect = notes.filter((note) => note.status === "incorrect").length;
  const notRecognized = notes.filter((note) => note.status === "notRecognized").length;
  const tooShort = notes.filter((note) => note.status === "tooShort").length;
  const scored = correct + incorrect;
  return {
    notes,
    summary: {
      correct,
      incorrect,
      notRecognized,
      tooShort,
      total: notes.length,
      accuracy: scored ? Math.round((correct / scored) * 100) : null,
      toleranceCents: TUNING_TOLERANCE_CENTS,
    },
  };
}

export async function analyzePracticeRecording(blob, settings) {
  if (blob.size > MAX_ANALYSIS_FILE_BYTES) {
    throw new Error("This recording is too large for in-browser pitch analysis (25 MB maximum).");
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio frequency analysis is not supported in this browser.");
  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (audioBuffer.duration > MAX_ANALYSIS_DURATION_SECONDS) {
      throw new Error("This recording is longer than the 10-minute in-browser analysis limit.");
    }
    return analyzePracticeAudioBuffer(audioBuffer, settings);
  } finally {
    await context.close();
  }
}
