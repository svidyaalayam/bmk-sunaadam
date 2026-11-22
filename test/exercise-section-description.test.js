import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTableSchedule,
  parseCarnaticNotes,
} from "../src/carnatic.js";

test("buildTableSchedule preserves section descriptions without playback sequence", () => {
  const sections = [
    {
      id: "sec-1",
      title: "Pallavi",
      description: "First speed pallavi section.",
      notes: parseCarnaticNotes("S R G M P D N S+"),
      lyrics: [],
    },
    {
      id: "sec-2",
      title: "Charanam",
      description: "Charanam section instructions.",
      notes: parseCarnaticNotes("S+ N D P M G R S"),
      lyrics: [],
    },
  ];

  const schedule = buildTableSchedule(sections, 8, [true, false, false, false], 60);
  assert.equal(schedule.length, 2);
  assert.equal(schedule[0].section.title, "Pallavi");
  assert.equal(schedule[0].section.description, "First speed pallavi section.");
  assert.equal(schedule[1].section.title, "Charanam");
  assert.equal(schedule[1].section.description, "Charanam section instructions.");
});

test("buildTableSchedule preserves section descriptions with playback sequence", () => {
  const sections = [
    {
      id: "sec-1",
      title: "Charanam-1",
      description: "Charanam 1 explanation.",
      notes: parseCarnaticNotes("S R G M P D N S+"),
      lyrics: [],
    },
    {
      id: "sec-2",
      title: "Charanam-2",
      description: "Charanam 2 explanation.",
      notes: parseCarnaticNotes("S+ N D P M G R S"),
      lyrics: [],
    },
  ];

  const playbackSequence = [
    {
      id: "part-1",
      name: "Charanam-1 (1st Speed)",
      sectionIds: ["sec-1"],
      notesPerBeat: 1,
      repeatCount: 1,
    },
    {
      id: "part-2",
      name: "Charanam-2 (1st Speed)",
      sectionIds: ["sec-2"],
      notesPerBeat: 1,
      repeatCount: 1,
    },
  ];

  const schedule = buildTableSchedule(
    sections,
    8,
    [true, true, true, true],
    60,
    playbackSequence,
  );

  assert.equal(schedule.length, 2);
  assert.equal(schedule[0].section.title, "Charanam-1 (1st Speed)");
  assert.equal(schedule[0].section.description, "Charanam 1 explanation.");
  assert.equal(schedule[1].section.title, "Charanam-2 (1st Speed)");
  assert.equal(schedule[1].section.description, "Charanam 2 explanation.");
});

test("sections with and without description are properly distinguishable", () => {
  const sections = [
    { id: "1", title: "Pallavi", description: "Learn carefully", notes: [] },
    { id: "2", title: "Anupallavi", description: "", notes: [] },
    { id: "3", title: "Charanam", description: "   ", notes: [] },
  ];

  const withDesc = sections.filter((s) => Boolean(s.description?.trim()));
  assert.equal(withDesc.length, 1);
  assert.equal(withDesc[0].title, "Pallavi");
  assert.equal(withDesc[0].description, "Learn carefully");
});
