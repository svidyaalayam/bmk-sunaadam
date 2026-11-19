import { NOTES } from "./notes";

const INK = "#1c1612";
const PAPER = "#f3ecdf";
const RULE = "#d9cbb6";
const AMBER = "#c4552a";
const MUTED = "#7a6a58";

export function drawStage(ctx, frame) {
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, 96);

  ctx.fillStyle = PAPER;
  ctx.font = "22px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("C MAJOR SCALE", 48, 48);

  ctx.textAlign = "right";
  if (frame.recording) {
    ctx.fillStyle = "#e23d3d";
    ctx.beginPath();
    ctx.arc(width - 118, 48, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.textAlign = "left";
    ctx.font = "600 18px Georgia, 'Times New Roman', serif";
    ctx.fillText("REC", width - 102, 49);
  } else {
    ctx.fillStyle = "#e7d7c3";
    ctx.font = "20px Georgia, 'Times New Roman', serif";
    ctx.fillText("each note lasts 1 second", width - 48, 48);
  }

  const note = frame.activeIndex >= 0 ? NOTES[frame.activeIndex] : null;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (note) {
    ctx.fillStyle = INK;
    ctx.font = "700 300px Georgia, 'Times New Roman', serif";
    ctx.fillText(note.name, width / 2, 360);
    ctx.font = "28px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = MUTED;
    ctx.fillText(
      `${note.name}${note.octave}    ·    MIDI ${note.midi}    ·    ${note.frequency.toFixed(1)} Hz`,
      width / 2,
      530,
    );
  } else if (frame.phase === "lead") {
    ctx.fillStyle = INK;
    ctx.font = "italic 72px Georgia, 'Times New Roman', serif";
    ctx.fillText("Ready", width / 2, 360);
  } else {
    ctx.fillStyle = INK;
    ctx.font = "italic 64px Georgia, 'Times New Roman', serif";
    ctx.fillText("C   D   E   F   G   A   B   C", width / 2, 350);
    ctx.font = "24px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = MUTED;
    ctx.fillText("Press Play to hear each note for one second", width / 2, 440);
  }

  const margin = 48;
  const gap = 14;
  const trackY = 610;
  const trackH = 12;
  const segmentWidth = (width - margin * 2 - gap * (NOTES.length - 1)) / NOTES.length;

  NOTES.forEach((item, index) => {
    const x = margin + index * (segmentWidth + gap);
    roundRect(ctx, x, trackY, segmentWidth, trackH, 6);
    ctx.fillStyle = RULE;
    ctx.fill();

    const full = index < frame.activeIndex;
    const current = index === frame.activeIndex;
    const filled = full ? segmentWidth : current ? segmentWidth * frame.noteProgress : 0;
    if (filled > 1) {
      roundRect(ctx, x, trackY, filled, trackH, 6);
      ctx.fillStyle = current ? AMBER : INK;
      ctx.fill();
    }

    ctx.fillStyle = current ? AMBER : MUTED;
    ctx.font = current ? "700 22px Georgia, 'Times New Roman', serif" : "20px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${item.name}${item.octave}`, x + segmentWidth / 2, trackY + 22);
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
