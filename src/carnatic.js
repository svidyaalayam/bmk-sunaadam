export const DEFAULT_EXERCISES = [
  {
    title: "Exercise 1",
    notes: "S R G M P D N S+ S+ N D P M G R S",
    repeatToCompleteTalam: true,
    completeTalamWithEmptyNotes: false,
  },
  {
    title: "Exercise 2",
    notes: "S R S R S R G M S R G M P D N S+ S+ N S+ N S+ N D P S+ N D P M G R S",
    repeatToCompleteTalam: false,
    completeTalamWithEmptyNotes: false,
  },
];

export const TABLE_VARIANTS = [1, 2, 3, 4];

export function parseCarnaticNotes(noteString) {
  return noteString
    .trim()
    .split(/\s+/)
    .filter((note) => note === ";" || isValidCarnaticNote(note));
}

function isValidCarnaticNote(note) {
  if (/^;[*_]{0,2}$/.test(note)) return true;
  const match = note.match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
  if (!match) return false;
  const [, swara, number, leadingMarkers, , trailingMarkers] = match;
  const markers = `${leadingMarkers}${trailingMarkers}`;
  if (markers.length > 2 || new Set(markers).size !== markers.length) return false;
  if (!number) return true;
  return {
    R: ["1", "2", "3"],
    G: ["1", "2", "3"],
    M: ["1", "2"],
    D: ["1", "2", "3"],
    N: ["1", "2", "3"],
  }[swara]?.includes(number) || false;
}

export function parseLyrics(lyricsString = "") {
  return lyricsString.trim().split(/\s+/).filter(Boolean);
}

export function buildSectionRows(notes) {
  return notes.length ? [notes.map((note) => [note])] : [];
}

export function formatCarnaticNote(note) {
  if (note === ";*") return ",";
  const match = note.match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
  if (!match) return note;
  const [, swara, number, leadingMarkers, octave, trailingMarkers] = match;
  const markers = `${leadingMarkers}${trailingMarkers}`;
  const halfNote = markers.includes("*");
  const noteText = `${halfNote ? swara.toLowerCase() : swara}${number || ""}`;
  if (!octave) return noteText;
  return `${noteText}${octave === "+" ? "\u0307" : "\u0323"}`;
}

export function getCarnaticNoteClasses(note) {
  if (note.startsWith(";")) return note.includes("_") ? ["swar-underlined"] : [];
  const match = note.match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
  if (!match) return [];
  const markers = `${match[3]}${match[5]}`;
  return markers.includes("_") ? ["swar-underlined"] : [];
}

export function noteDurationUnits(note) {
  const markerCount = (note.match(/[*_]/g) || []).length;
  return markerCount === 2 ? 1 : markerCount === 1 ? 2 : 4;
}


function emptyNotesForUnits(units) {
  const result = [];
  let remaining = units;
  while (remaining >= 4) {
    result.push(";");
    remaining -= 4;
  }
  if (remaining === 3) {
    result.push(";*");
    result.push(";**");
    remaining = 0;
  } else if (remaining === 2) {
    result.push(";*");
    remaining = 0;
  } else if (remaining === 1) {
    result.push(";**");
    remaining = 0;
  }
  return result;
}

export function buildTalamRows(
  notes,
  beats,
  notesPerBeat,
  cyclesPerRow = 1,
  repeatToCompleteTalam = true,
  completeTalamWithEmptyNotes = false,
) {
  if (!notes.length || beats < 1) return [];

  const rowUnits = beats * cyclesPerRow * notesPerBeat * 4;
  const noteUnits = notes.reduce(
    (total, note) => total + noteDurationUnits(note),
    0,
  );

  const repeatedNotes = repeatToCompleteTalam
    ? Array.from(
        { length: leastCommonMultiple(noteUnits, rowUnits) / noteUnits },
        () => notes,
      ).flat()
    : notes;

  const rows = [];
  let row = [];
  let cell = [];
  let cellUnits = 0;
  let rowUnitsUsed = 0;

  repeatedNotes.forEach((note) => {
    const units = noteDurationUnits(note);

    if (cellUnits && cellUnits + units > notesPerBeat * 4) {
      row.push(cell);
      rowUnitsUsed += notesPerBeat * 4 - cellUnits;
      cell = [];
      cellUnits = 0;

      if (rowUnitsUsed === rowUnits) {
        rows.push(row);
        row = [];
        rowUnitsUsed = 0;
      }
    }

    cell.push(note);
    cellUnits += units;
    rowUnitsUsed += units;

    if (cellUnits === notesPerBeat * 4) {
      row.push(cell);
      cell = [];
      cellUnits = 0;
    }

    if (rowUnitsUsed === rowUnits) {
      if (cell.length) row.push(cell);
      rows.push(row);
      row = [];
      cell = [];
      cellUnits = 0;
      rowUnitsUsed = 0;
    }
  });

  if (!repeatToCompleteTalam) {
    if (completeTalamWithEmptyNotes) {
      if (cell.length) {
        const remainingInCell = notesPerBeat * 4 - cellUnits;
        if (remainingInCell > 0) {
          cell.push(...emptyNotesForUnits(remainingInCell));
        }
        row.push(cell);
        cell = [];
        cellUnits = 0;
      }
      const totalBeats = beats * cyclesPerRow;
      if (row.length > 0 && row.length < totalBeats) {
        while (row.length < totalBeats) {
          row.push(emptyNotesForUnits(notesPerBeat * 4));
        }
      }
      if (row.length) {
        rows.push(row);
        row = [];
      }
    } else {
      if (cell.length) row.push(cell);
      if (row.length) rows.push(row);
    }
  }

  return rows;
}

export function getTableDuration(
  notes,
  beats,
  notesPerBeat,
  bpm,
  cyclesPerRow = 1,
  repeatToCompleteTalam = true,
  completeTalamWithEmptyNotes = false,
) {
  const noteList = Array.isArray(notes) ? notes : parseCarnaticNotes(notes || "");
  if (!noteList.length || beats < 1 || bpm <= 0) return 0;
  const rows = buildTalamRows(
    noteList,
    beats,
    notesPerBeat,
    cyclesPerRow,
    repeatToCompleteTalam,
    completeTalamWithEmptyNotes,
  );
  if (repeatToCompleteTalam || completeTalamWithEmptyNotes) {
    return rows.length * cyclesPerRow * beats * (60 / bpm);
  }
  const totalUnits = noteList.reduce(
    (total, note) => total + noteDurationUnits(note),
    0,
  );
  return (totalUnits / (notesPerBeat * 4)) * (60 / bpm);
}

export function buildTableSchedule(
  sections,
  beats,
  visibleTables,
  bpm,
  playbackSequence = [],
  cyclesPerRow = 1,
  expandRepeats = false,
  repeatToCompleteTalam = true,
  completeTalamWithEmptyNotes = false,
  excludedPartKeys = [],
) {
  let tableStartTime = 0;
  const entries = playbackSequence?.length
    ? playbackSequence.flatMap((step, stepIndex) => {
      const sectionIds = step.sectionIds?.length
        ? step.sectionIds
        : (step.sectionId ? [step.sectionId] : []);
      const selectedSections = sectionIds
        .map((sectionId) => (sections || []).find((section) => String(section.id) === String(sectionId)))
        .filter(Boolean);
      const hasLyrics = selectedSections.some((section) => section.lyrics?.length);
      const noTalam = selectedSections.length > 0
        && selectedSections.every((section) => section.noTalam);
      const repeatCount = Math.max(1, step.repeatCount || 1);
      const partKey = String(step.id ?? `step-${stepIndex}`);
      return Array.from({ length: expandRepeats ? repeatCount : 1 }, (_, repeatIndex) => ({
        sectionIndex: selectedSections.length
          ? sections.indexOf(selectedSections[0])
          : -1,
        section: {
          title: step.name?.trim() || selectedSections.map((section) => section.title).join(" + "),
          description: selectedSections
            .map((section) => section.description?.trim())
            .filter(Boolean)
            .join("\n\n"),
          swaraIntervals: selectedSections.length === 1
            ? selectedSections[0].swaraIntervals
            : null,
          noTalam,
        },
        notes: selectedSections.flatMap((section) => section.notes),
        noteSwaraIntervals: selectedSections.flatMap((section) =>
          section.notes.map(() => section.swaraIntervals || null),
        ),
        lyrics: hasLyrics
          ? selectedSections.flatMap((section) =>
            section.lyrics?.length
              ? section.lyrics
              : Array.from({ length: section.notes.length }, () => ""),
          )
          : [],
        sectionKey: `sequence-${step.id || stepIndex}-${expandRepeats ? repeatIndex : "display"}`,
        partKey,
        notesPerBeat: noTalam ? 1 : step.notesPerBeat,
        repeatCount: expandRepeats ? 1 : repeatCount,
        noTalam,
      }));
    }).flat().filter((entry) => entry.sectionIndex >= 0 && entry.notes.length)
    : (sections || []).flatMap((section, sectionIndex) =>
      section.noTalam
        ? [{
          sectionIndex,
          section,
          notes: section.notes,
          lyrics: section.lyrics,
          notesPerBeat: 1,
          partKey: `section-${section.id ?? sectionIndex}-no-talam`,
          noTalam: true,
        }]
        : TABLE_VARIANTS
          .map((notesPerBeat, tableIndex) => ({
            sectionIndex,
            notesPerBeat,
            tableIndex,
            partKey: `table-${tableIndex}`,
          }))
          .filter(({ tableIndex }) => visibleTables?.[tableIndex] ?? true),
    );

  return entries.flatMap((entry) => {
    const isExcluded = excludedPartKeys.includes(entry.partKey);
    if (expandRepeats && isExcluded) {
      return [];
    }

    const section = entry.section || sections[entry.sectionIndex];
    const notes = entry.notes || section?.notes || [];
    const lyrics = entry.lyrics || section?.lyrics || [];
    const noTalam = Boolean(entry.noTalam ?? section?.noTalam);
    if (!section || !notes.length) return [];
    const duration = getTableDuration(
      notes,
      noTalam ? 1 : beats,
      entry.notesPerBeat,
      bpm,
      noTalam ? 1 : cyclesPerRow,
      noTalam ? false : repeatToCompleteTalam,
      noTalam ? false : completeTalamWithEmptyNotes,
    );
    const table = {
      sectionIndex: entry.sectionIndex,
      sectionKey: entry.sectionKey || entry.sectionIndex,
      partKey: entry.partKey,
      isExcluded,
      section,
      notes,
      noteSwaraIntervals: entry.noteSwaraIntervals,
      lyrics,
      beats,
      cyclesPerRow,
      notesPerBeat: entry.notesPerBeat,
      noTalam,
      repeatCount: entry.repeatCount || 1,
      tableStartTime: isExcluded ? 0 : tableStartTime,
      duration,
      bpm,
      repeatToCompleteTalam: noTalam ? false : repeatToCompleteTalam,
      completeTalamWithEmptyNotes: noTalam ? false : completeTalamWithEmptyNotes,
    };
    if (!isExcluded) {
      tableStartTime += duration * (entry.repeatCount || 1);
    }
    return [table];
  });
}


function leastCommonMultiple(first, second) {
  return (first * second) / greatestCommonDivisor(first, second);
}

function greatestCommonDivisor(first, second) {
  let a = first;
  let b = second;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}
