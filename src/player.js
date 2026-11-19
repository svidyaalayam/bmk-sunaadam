import { scheduleNotes } from "./audio";
import { NOTES, NOTE_SECONDS } from "./notes";

const LEAD_SECONDS = 0.2;

export function createScalePlayer({ onFrame }) {
  let audioContext = null;
  let playing = false;
  let raf = 0;

  function ensureContext() {
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContext();
    }
    return audioContext;
  }

  async function play({ recording = false, instrument = "veena" } = {}) {
    if (playing) return;
    playing = true;
    const ctx = ensureContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    try {
      const startAt = ctx.currentTime + LEAD_SECONDS;
      scheduleNotes(ctx, startAt, [ctx.destination], instrument);
      await followPlayback(ctx, startAt, recording, onFrame, (id) => {
        raf = id;
      });
    } finally {
      cancelAnimationFrame(raf);
      playing = false;
    }
  }

  function close() {
    cancelAnimationFrame(raf);
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
    }
    audioContext = null;
  }

  return { play, close };
}

function followPlayback(ctx, startAt, recording, onFrame, rememberFrame) {
  const total = NOTES.length * NOTE_SECONDS;

  return new Promise((resolve) => {
    const tick = () => {
      const elapsed = ctx.currentTime - startAt;

      if (elapsed < 0) {
        onFrame({ activeIndex: -1, noteProgress: 0, phase: "lead", recording });
        rememberFrame(requestAnimationFrame(tick));
        return;
      }

      if (elapsed >= total) {
        onFrame({
          activeIndex: NOTES.length - 1,
          noteProgress: 1,
          phase: "done",
          recording,
        });
        resolve();
        return;
      }

      const activeIndex = Math.min(NOTES.length - 1, Math.floor(elapsed / NOTE_SECONDS));
      const noteProgress = (elapsed - activeIndex * NOTE_SECONDS) / NOTE_SECONDS;
      onFrame({ activeIndex, noteProgress, phase: "playing", recording });
      rememberFrame(requestAnimationFrame(tick));
    };

    rememberFrame(requestAnimationFrame(tick));
  });
}
