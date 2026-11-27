import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePracticeAudioBuffer,
  buildExpectedNoteTimeline,
  chooseNoteSelectionCandidate,
  getNoteRange,
} from "./frequencyAnalysis.js";

function createToneBuffer(segments, duration) {
  const sampleRate = 24000;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const segment = segments.find((item) => time >= item.start && time < item.end);
    if (segment) {
      samples[index] = 0.5 * Math.sin(2 * Math.PI * segment.frequency * (time - segment.start));
    }
  }
  return {
    length: samples.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

const settings = {
  shruthi: "normal-C",
  swaraIntervals: { S: 0, R: 2, G: 4, M: 5, P: 7, D: 9, N: 11 },
  playbackSchedule: [{
    notes: ["S", "R"],
    beats: 1,
    notesPerBeat: 4,
    cyclesPerRow: 1,
    tableStartTime: 0,
    bpm: 60,
    repeatCount: 1,
    repeatToCompleteTalam: false,
    completeTalamWithEmptyNotes: false,
  }],
};

test("buildExpectedNoteTimeline merges held-note markers into the preceding note", () => {
  const timeline = buildExpectedNoteTimeline([{
    ...settings.playbackSchedule[0],
    partKey: "step-1",
    sectionIndex: 2,
    notes: ["S", ";", "R"],
  }]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].note, "S");
  assert.equal(timeline[0].startTime, 0);
  assert.equal(timeline[0].endTime, 0.5);
  assert.equal(timeline[0].tableNoteIndex, 0);
  assert.equal(timeline[0].partKey, "step-1");
  assert.equal(timeline[0].sectionIndex, 2);
  assert.equal(timeline[1].note, "R");
  assert.equal(timeline[1].startTime, 0.5);
  assert.equal(timeline[1].tableNoteIndex, 1);
});

test("getNoteRange uses the selected note's start and end times", () => {
  const timeline = buildExpectedNoteTimeline(settings.playbackSchedule);

  assert.deepEqual(getNoteRange(timeline, 0, 1), {
    startTime: 0,
    endTime: 0.5,
    startNote: timeline[0],
    endNote: timeline[1],
  });
  assert.equal(getNoteRange(timeline, 1, 0), null);
  assert.equal(getNoteRange(timeline, "missing", 1), null);
});

test("choosing table notes updates the requested range boundary without inverting it", () => {
  const candidates = [{ index: 1 }, { index: 4 }, { index: 7 }];

  assert.deepEqual(chooseNoteSelectionCandidate(candidates, "from", "1", "4"), {
    startIndex: "4",
    endIndex: "4",
  });
  assert.deepEqual(chooseNoteSelectionCandidate(candidates, "from", "1", "2"), {
    startIndex: "1",
    endIndex: "2",
  });
  assert.deepEqual(chooseNoteSelectionCandidate(candidates, "to", "4", "4"), {
    startIndex: "4",
    endIndex: "4",
  });
  assert.deepEqual(chooseNoteSelectionCandidate(candidates, "to", "6", "6"), {
    startIndex: "6",
    endIndex: "7",
  });
  assert.equal(chooseNoteSelectionCandidate([], "from", "0", "0"), null);
});

test("analyzePracticeAudioBuffer recognizes expected swaras at their scheduled pitches", () => {
  const saFrequency = 261.63;
  const riFrequency = saFrequency * 2 ** (2 / 12);
  const buffer = createToneBuffer([
    { start: 0, end: 0.25, frequency: saFrequency },
    { start: 0.25, end: 0.5, frequency: riFrequency },
  ], 0.5);

  const report = analyzePracticeAudioBuffer(buffer, settings);

  assert.deepEqual(report.notes.map((note) => note.status), ["correct", "correct"]);
  assert.equal(report.summary.accuracy, 100);
});

test("analyzePracticeAudioBuffer flags a clearly wrong pitch", () => {
  const buffer = createToneBuffer([
    { start: 0, end: 0.25, frequency: 329.63 },
    { start: 0.25, end: 0.5, frequency: 293.66 },
  ], 0.5);

  const report = analyzePracticeAudioBuffer(buffer, settings);

  assert.equal(report.notes[0].status, "incorrect");
  assert.equal(report.notes[0].detectedSwara, "G3");
  assert.equal(report.notes[0].direction, "sharp");
  assert.equal(report.notes[1].status, "correct");
  assert.equal(report.summary.accuracy, 50);
});

test("wrong pitches are reported as Carnatic swaras with sharp or flat direction", () => {
  const expectedSettings = {
    shruthi: "normal-G",
    swaraIntervals: { S: 0, R: 2, G: 4, M: 5, P: 7, D: 9, N: 11 },
    playbackSchedule: [{
      ...settings.playbackSchedule[0],
      notes: ["M"],
      beats: 1,
      notesPerBeat: 1,
    }],
  };
  const bAboveG = 392 * 2 ** (4 / 12);
  const buffer = createToneBuffer([{ start: 0, end: 1, frequency: bAboveG }], 1);
  const report = analyzePracticeAudioBuffer(buffer, expectedSettings);

  assert.equal(report.notes[0].detectedSwara, "G3");
  assert.equal(report.notes[0].note, "M");
  assert.equal(report.notes[0].direction, "flat");
  assert.equal(report.notes[0].semitoneDifference, 1);
  assert.equal(report.notes[0].status, "incorrect");
});

test("analyzePracticeAudioBuffer accepts the expected pitch class in lower or higher octaves", () => {
  const expectedFrequency = 392;
  const octaveSettings = {
    shruthi: "normal-G",
    swaraIntervals: { S: 0 },
    playbackSchedule: [{
      ...settings.playbackSchedule[0],
      notes: ["S"],
      beats: 1,
      notesPerBeat: 1,
    }],
  };
  const cases = [
    { frequency: expectedFrequency / 2, detectedNote: "G3", octaveDifference: -1 },
    { frequency: expectedFrequency * 2, detectedNote: "G5", octaveDifference: 1 },
    { frequency: expectedFrequency * 4, octaveDifference: 2 },
  ];

  for (const { frequency, detectedNote, octaveDifference } of cases) {
    const buffer = createToneBuffer([{ start: 0, end: 1, frequency }], 1);
    const report = analyzePracticeAudioBuffer(buffer, octaveSettings);

    assert.equal(report.notes[0].status, "correct");
    if (detectedNote) assert.equal(report.notes[0].detectedNote, detectedNote);
    assert.equal(report.notes[0].octaveDifference, octaveDifference);
    assert.ok(Math.abs(report.notes[0].pitchClassCentsOff) <= report.summary.toleranceCents);
    assert.equal(report.summary.accuracy, 100);
  }
});

test("very short notes are reported separately instead of as pitch errors", () => {
  const shortSettings = {
    ...settings,
    playbackSchedule: [{
      ...settings.playbackSchedule[0],
      notes: ["S"],
      beats: 1,
      notesPerBeat: 1,
    }],
  };
  const buffer = createToneBuffer([{ start: 0, end: 0.05, frequency: 261.63 }], 0.05);

  const report = analyzePracticeAudioBuffer(buffer, shortSettings);

  assert.equal(report.notes[0].status, "tooShort");
  assert.equal(report.summary.tooShort, 1);
  assert.equal(report.summary.accuracy, null);
});
