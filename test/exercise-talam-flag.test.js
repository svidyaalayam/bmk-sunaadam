import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXERCISES,
  buildTalamRows,
  getTableDuration,
  buildTableSchedule,
  parseCarnaticNotes,
  noteDurationUnits,
} from "../src/carnatic.js";

test("DEFAULT_EXERCISES defines repeatToCompleteTalam flag correctly", () => {
  assert.equal(DEFAULT_EXERCISES.length, 2);

  const ex1 = DEFAULT_EXERCISES.find((e) => e.title === "Exercise 1");
  const ex2 = DEFAULT_EXERCISES.find((e) => e.title === "Exercise 2");

  assert.ok(ex1, "Exercise 1 exists");
  assert.ok(ex2, "Exercise 2 exists");

  assert.equal(ex1.repeatToCompleteTalam, true);
  assert.equal(ex2.repeatToCompleteTalam, false);

  assert.equal(ex1.notes, "S R G M P D N S+ S+ N D P M G R S");
  assert.equal(
    ex2.notes,
    "S R S R S R G M S R G M P D N S+ S+ N S+ N S+ N D P S+ N D P M G R S",
  );
});

test("buildTalamRows backward compatibility: treats missing flag as true", () => {
  const notes = parseCarnaticNotes("S R G M P D N S+ S+ N D P M G R S"); // 16 notes
  const beats = 8;
  const notesPerBeat = 3; // 24 notes per row
  const cyclesPerRow = 1;

  // When omitted:
  const rowsDefault = buildTalamRows(notes, beats, notesPerBeat, cyclesPerRow);
  // When explicitly true:
  const rowsTrue = buildTalamRows(notes, beats, notesPerBeat, cyclesPerRow, true);

  assert.deepEqual(rowsDefault, rowsTrue);
  // LCM(16, 24) = 48 notes = 2 complete rows of 24 notes each
  assert.equal(rowsDefault.length, 2);
  assert.equal(rowsDefault[0].length, 8);
  assert.equal(rowsDefault[1].length, 8);
  assert.equal(rowsDefault.flat(2).length, 48);
});

test("buildTalamRows with repeatToCompleteTalam: false plays notes exactly once and allows incomplete final rows", () => {
  const notes = parseCarnaticNotes("S R G M P D N S+ S+ N D P M G R S"); // 16 notes
  const beats = 8;
  const notesPerBeat = 3;
  const cyclesPerRow = 1;

  const rows = buildTalamRows(notes, beats, notesPerBeat, cyclesPerRow, false);

  // Notes are NOT repeated: exactly 16 notes
  const renderedNotes = rows.flat(2);
  assert.equal(renderedNotes.length, 16);
  assert.deepEqual(renderedNotes, notes);

  // 16 notes at 3 notes per beat = 5 beats with 3 notes + 1 beat with 1 note = 6 beats
  // So rows has 1 row with 6 beats (an incomplete row out of 8 beats)
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 6);
  assert.equal(rows[0][0].length, 3);
  assert.equal(rows[0][4].length, 3);
  assert.equal(rows[0][5].length, 1); // final incomplete cell

  // Beats 6 and 7 do not exist in rows[0] (incomplete final row)
  assert.equal(rows[0][6], undefined);
  assert.equal(rows[0][7], undefined);
});

test("buildTalamRows with Exercise 2 (32 notes) with repeatToCompleteTalam: false", () => {
  const ex2Notes = parseCarnaticNotes(
    "S R S R S R G M S R G M P D N S+ S+ N S+ N S+ N D P S+ N D P M G R S",
  );
  assert.equal(ex2Notes.length, 32);

  const beats = 8;
  const cyclesPerRow = 1;

  // Variant 1: 1 note per beat (32 notes / 8 = 4 complete rows)
  const rows1 = buildTalamRows(ex2Notes, beats, 1, cyclesPerRow, false);
  assert.equal(rows1.length, 4);
  assert.equal(rows1.flat(2).length, 32);

  // Variant 2: 2 notes per beat (32 notes / 16 = 2 complete rows)
  const rows2 = buildTalamRows(ex2Notes, beats, 2, cyclesPerRow, false);
  assert.equal(rows2.length, 2);
  assert.equal(rows2.flat(2).length, 32);

  // Variant 3: 3 notes per beat (32 notes: row 0 has 24 notes (8 beats), row 1 has 8 notes (3 beats))
  const rows3 = buildTalamRows(ex2Notes, beats, 3, cyclesPerRow, false);
  assert.equal(rows3.length, 2);
  assert.equal(rows3[0].length, 8); // full 8 beats
  assert.equal(rows3[1].length, 3); // incomplete final row: 3 beats (3 + 3 + 2 notes)
  assert.equal(rows3.flat(2).length, 32);
  assert.deepEqual(rows3.flat(2), ex2Notes);

  // Compare with repeatToCompleteTalam: true
  const rows3Repeated = buildTalamRows(ex2Notes, beats, 3, cyclesPerRow, true);
  // LCM(32, 24) = 96 notes = 4 complete rows of 24 notes
  assert.equal(rows3Repeated.length, 4);
  assert.equal(rows3Repeated.flat(2).length, 96);

  // Variant 4: 4 notes per beat (32 notes / 32 = 1 complete row)
  const rows4 = buildTalamRows(ex2Notes, beats, 4, cyclesPerRow, false);
  assert.equal(rows4.length, 1);
  assert.equal(rows4.flat(2).length, 32);
});

test("getTableDuration calculates correct durations for true vs false", () => {
  const notes = parseCarnaticNotes("S R G M P D N S+ S+ N D P M G R S"); // 16 notes
  const beats = 8;
  const bpm = 60; // 1 second per beat
  const cyclesPerRow = 1;

  // notesPerBeat = 1: 16 notes = 2 complete rows
  const durTrue1 = getTableDuration(notes, beats, 1, bpm, cyclesPerRow, true);
  const durFalse1 = getTableDuration(notes, beats, 1, bpm, cyclesPerRow, false);
  assert.equal(durTrue1, 16); // 2 rows * 8 beats * 1s = 16s
  assert.equal(durFalse1, 16); // 16 notes * 1 note/beat = 16s

  // notesPerBeat = 3: 16 notes = 16/3 beats = 5.3333s for false, 2 complete rows (48 notes = 16 beats = 16s) for true
  const durTrue3 = getTableDuration(notes, beats, 3, bpm, cyclesPerRow, true);
  const durFalse3 = getTableDuration(notes, beats, 3, bpm, cyclesPerRow, false);
  assert.equal(durTrue3, 16); // 2 rows * 8 beats * 1s = 16s
  assert.equal(durFalse3, 16 / 3); // 16 notes / 3 notes per beat * 1s = 5.3333s
});

test("buildTableSchedule passes repeatToCompleteTalam consistently and respects exercise setting", () => {
  const sections = [
    {
      title: "Main",
      notes: parseCarnaticNotes("S R G M P D N S+ S+ N D P M G R S"),
      lyrics: [],
    },
  ];
  const beats = 8;
  const visibleTables = [true, true, true, true]; // 1, 2, 3, 4 notes per beat
  const bpm = 60;
  const cyclesPerRow = 1;

  // Exercise with repeatToCompleteTalam: true
  const scheduleTrue = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    false,
    true,
  );
  assert.equal(scheduleTrue.length, 4);
  assert.equal(scheduleTrue[2].repeatToCompleteTalam, true);
  assert.equal(scheduleTrue[2].duration, 16);

  // Exercise with repeatToCompleteTalam: false
  const scheduleFalse = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    false,
    false,
  );
  assert.equal(scheduleFalse.length, 4);
  assert.equal(scheduleFalse[2].repeatToCompleteTalam, false);
  assert.equal(scheduleFalse[2].duration, 16 / 3);

  // Total duration difference
  const totalTrue = scheduleTrue.reduce((sum, t) => sum + t.duration, 0);
  const totalFalse = scheduleFalse.reduce((sum, t) => sum + t.duration, 0);
  assert.ok(totalFalse < totalTrue);
});

test("Switching between Exercise 1 and Exercise 2 in the same session", () => {
  const sessionExercises = DEFAULT_EXERCISES.map((ex, idx) => ({
    ...ex,
    id: `ex-${idx}`,
    sessionId: "sarali",
  }));

  const beats = 8;
  const visibleTables = [false, false, true, false]; // only 3 notes per beat
  const bpm = 60;
  const cyclesPerRow = 1;

  // 1. Select Exercise 1
  let selectedExercise = sessionExercises[0];
  let repeatFlag = selectedExercise.repeatToCompleteTalam ?? true;
  assert.equal(repeatFlag, true);

  let sections = [{
    title: "Main",
    notes: parseCarnaticNotes(selectedExercise.notes),
    lyrics: [],
  }];
  let schedule = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    true,
    repeatFlag,
  );
  let rows = buildTalamRows(sections[0].notes, beats, 3, cyclesPerRow, repeatFlag);
  assert.equal(schedule[0].repeatToCompleteTalam, true);
  assert.equal(schedule[0].duration, 16); // 2 full rows
  assert.equal(rows.length, 2);
  assert.equal(rows.flat(2).length, 48); // repeated to complete talam

  // 2. Switch to Exercise 2
  selectedExercise = sessionExercises[1];
  repeatFlag = selectedExercise.repeatToCompleteTalam ?? true;
  assert.equal(repeatFlag, false);

  sections = [{
    title: "Main",
    notes: parseCarnaticNotes(selectedExercise.notes),
    lyrics: [],
  }];
  schedule = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    true,
    repeatFlag,
  );
  rows = buildTalamRows(sections[0].notes, beats, 3, cyclesPerRow, repeatFlag);
  assert.equal(schedule[0].repeatToCompleteTalam, false);
  assert.equal(schedule[0].duration, 32 / 3); // 32 notes played once
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 8); // complete row
  assert.equal(rows[1].length, 3); // incomplete final row
  assert.equal(rows.flat(2).length, 32); // exactly 32 notes

  // 3. Switch back to Exercise 1
  selectedExercise = sessionExercises[0];
  repeatFlag = selectedExercise.repeatToCompleteTalam ?? true;
  assert.equal(repeatFlag, true);

  sections = [{
    title: "Main",
    notes: parseCarnaticNotes(selectedExercise.notes),
    lyrics: [],
  }];
  schedule = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    true,
    repeatFlag,
  );
  rows = buildTalamRows(sections[0].notes, beats, 3, cyclesPerRow, repeatFlag);
  assert.equal(schedule[0].repeatToCompleteTalam, true);
  assert.equal(rows.flat(2).length, 48);
});

test("completeTalamWithEmptyNotes: true fills uncompleted Talam row with ';'", () => {
  const ex2Notes = parseCarnaticNotes(
    "S R S R S R G M S R G M P D N S+ S+ N S+ N S+ N D P S+ N D P M G R S",
  ); // 32 notes
  const beats = 8;
  const cyclesPerRow = 1;
  const bpm = 60;

  // notesPerBeat = 3: 32 notes in 8-beat Adi talam
  // Row 0 has 24 notes (8 beats of 3 notes).
  // Row 1 has 8 original notes (beats 0, 1 have 3 notes, beat 2 has 2 notes).
  // With completeTalamWithEmptyNotes: true:
  // Beat 2 gets 1 ';' to complete the beat (3 notes).
  // Beats 3, 4, 5, 6, 7 get 3 ';' each (15 notes).
  // Total in Row 1: 8 + 1 + 15 = 24 notes. Total rows = 2 complete rows!
  const rows = buildTalamRows(ex2Notes, beats, 3, cyclesPerRow, false, true);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 8); // complete row
  assert.equal(rows[1].length, 8); // also complete row!

  // Check beat 2 in row 1: original 2 notes + 1 ';'
  assert.equal(rows[1][2].length, 3);
  assert.equal(rows[1][2][2], ";");

  // Check beats 3 to 7 in row 1: all ';'
  for (let b = 3; b < 8; b++) {
    assert.deepEqual(rows[1][b], [";", ";", ";"]);
  }

  // Duration should be the full 2 rows: 2 * 8 * 1s = 16s
  const duration = getTableDuration(ex2Notes, beats, 3, bpm, cyclesPerRow, false, true);
  assert.equal(duration, 16);

  // Compare with completeTalamWithEmptyNotes: false
  const rowsIncomplete = buildTalamRows(ex2Notes, beats, 3, cyclesPerRow, false, false);
  assert.equal(rowsIncomplete.length, 2);
  assert.equal(rowsIncomplete[1].length, 3); // leaves incomplete row (3 beats)
  const durationIncomplete = getTableDuration(ex2Notes, beats, 3, bpm, cyclesPerRow, false, false);
  assert.equal(durationIncomplete, 32 / 3);
});

test("buildTableSchedule with completeTalamWithEmptyNotes", () => {
  const sections = [
    {
      title: "Main",
      notes: parseCarnaticNotes("S R G M P D N S+ S+ N D P M G R S"), // 16 notes
      lyrics: [],
    },
  ];
  const beats = 8;
  const visibleTables = [false, false, true, false]; // notesPerBeat = 3
  const bpm = 60;
  const cyclesPerRow = 1;

  // 16 notes at 3 notes per beat:
  // If completeTalamWithEmptyNotes: false -> duration = 16/3
  const schedFalse = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    false,
    false,
    false,
  );
  assert.equal(schedFalse[0].duration, 16 / 3);

  // If completeTalamWithEmptyNotes: true -> completes row to 8 beats = 8s
  const schedTrue = buildTableSchedule(
    sections,
    beats,
    visibleTables,
    bpm,
    [],
    cyclesPerRow,
    false,
    false,
    true,
  );
  assert.equal(schedTrue[0].duration, 8);
  assert.equal(schedTrue[0].completeTalamWithEmptyNotes, true);
});

test("buildTableSchedule with excludedPartKeys for EXERCISE PLAYBACK PARTS", () => {
  const sections = [
    {
      id: "sec-1",
      title: "Pallavi",
      notes: parseCarnaticNotes("S R G M P D N S+"),
      lyrics: [],
    },
    {
      id: "sec-2",
      title: "Anupallavi",
      notes: parseCarnaticNotes("S+ N D P M G R S"),
      lyrics: [],
    },
  ];
  const playbackSequence = [
    {
      id: "part-1",
      name: "Part 1 - Pallavi",
      sectionIds: ["sec-1"],
      notesPerBeat: 1,
      repeatCount: 1,
    },
    {
      id: "part-2",
      name: "Part 2 - Anupallavi",
      sectionIds: ["sec-2"],
      notesPerBeat: 2,
      repeatCount: 1,
    },
    {
      id: "part-3",
      name: "Part 3 - Pallavi + Anupallavi",
      sectionIds: ["sec-1", "sec-2"],
      notesPerBeat: 2,
      repeatCount: 1,
    },
  ];
  const beats = 8;
  const bpm = 60;
  const cyclesPerRow = 1;

  // 1. No parts excluded
  const dispAll = buildTableSchedule(
    sections,
    beats,
    [true, true, true, true],
    bpm,
    playbackSequence,
    cyclesPerRow,
    false,
    true,
    false,
    [],
  );
  assert.equal(dispAll.length, 3);
  assert.equal(dispAll[0].isExcluded, false);
  assert.equal(dispAll[1].isExcluded, false);
  assert.equal(dispAll[2].isExcluded, false);

  const playAll = buildTableSchedule(
    sections,
    beats,
    [true, true, true, true],
    bpm,
    playbackSequence,
    cyclesPerRow,
    true,
    true,
    false,
    [],
  );
  assert.equal(playAll.length, 3);
  const totalAllDuration = playAll.reduce((sum, t) => sum + t.duration, 0);

  // 2. Part 2 excluded
  const dispWithExcluded = buildTableSchedule(
    sections,
    beats,
    [true, true, true, true],
    bpm,
    playbackSequence,
    cyclesPerRow,
    false,
    true,
    false,
    ["part-2"],
  );
  assert.equal(dispWithExcluded.length, 3);
  assert.equal(dispWithExcluded[0].isExcluded, false);
  assert.equal(dispWithExcluded[1].isExcluded, true);
  assert.equal(dispWithExcluded[2].isExcluded, false);

  // Playback schedule MUST NOT contain part-2
  const playWithExcluded = buildTableSchedule(
    sections,
    beats,
    [true, true, true, true],
    bpm,
    playbackSequence,
    cyclesPerRow,
    true,
    true,
    false,
    ["part-2"],
  );
  assert.equal(playWithExcluded.length, 2);
  assert.equal(playWithExcluded[0].partKey, "part-1");
  assert.equal(playWithExcluded[1].partKey, "part-3");

  // Contiguous timing without gaps
  assert.equal(playWithExcluded[0].tableStartTime, 0);
  assert.equal(playWithExcluded[1].tableStartTime, playWithExcluded[0].duration);

  const totalExcludedDuration = playWithExcluded.reduce((sum, t) => sum + t.duration, 0);
  assert.ok(totalExcludedDuration < totalAllDuration);
  assert.equal(totalExcludedDuration, playAll[0].duration + playAll[2].duration);
});


