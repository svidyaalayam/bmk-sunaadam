export const SHRUTHI_OPTIONS = [
  {
    label: "Lower octave",
    notes: ["G#", "A", "A#", "B"].map((note) => ({ label: note, value: `lower-${note}` })),
  },
  {
    label: "Normal",
    notes: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].map(
      (note) => ({ label: note, value: `normal-${note}` }),
    ),
  },
  {
    label: "Higher octave",
    notes: ["C", "C#", "D", "D#"].map((note) => ({ label: note, value: `higher-${note}` })),
  },
];
