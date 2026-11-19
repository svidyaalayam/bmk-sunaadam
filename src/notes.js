export const NOTE_SECONDS = 1;

const SCALE = [
  { name: "C", octave: 4, midi: 60 },
  { name: "D", octave: 4, midi: 61 },
  { name: "E", octave: 4, midi: 64 },
  { name: "F", octave: 4, midi: 65 },
  { name: "G", octave: 4, midi: 67 },
  { name: "A", octave: 4, midi: 68 },
  { name: "B", octave: 4, midi: 71 },
  { name: "C", octave: 5, midi: 72 },
];

export const NOTES = SCALE.map((note) => ({
  ...note,
  frequency: 440 * 2 ** ((note.midi - 69) / 12),
}));

export function noteLabel(note) {
  return `${note.name}${note.octave}`;
}
