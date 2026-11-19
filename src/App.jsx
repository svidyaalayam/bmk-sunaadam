import { useEffect, useRef, useState } from "react";
import { INSTRUMENTS } from "./audio";
import { drawStage } from "./drawStage";
import { createScaleVideo } from "./exportVideo";
import { noteLabel, NOTES } from "./notes";
import { createScalePlayer } from "./player";
import "./App.css";

const IDLE_FRAME = {
  activeIndex: -1,
  noteProgress: 0,
  phase: "idle",
  recording: false,
};

export default function App() {
  const canvasRef = useRef(null);
  const frameRef = useRef(IDLE_FRAME);
  const noteRef = useRef(-1);
  const playerRef = useRef(null);
  const lockRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [instrument, setInstrument] = useState("veena");
  const [message, setMessage] = useState("Press Play to hear the scale.");
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frameId = 0;

    const loop = () => {
      drawStage(context, frameRef.current);
      frameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const player = createScalePlayer({
      onFrame(frame) {
        frameRef.current = frame;
        if (noteRef.current !== frame.activeIndex) {
          noteRef.current = frame.activeIndex;
          setActiveIndex(frame.activeIndex);
        }
      },
    });
    playerRef.current = player;
    return () => player.close();
  }, []);

  async function run(record) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError("");
    setMessage(record ? "Playing the scale. The video downloads when it finishes." : "Playing the scale.");

    try {
      await playerRef.current.play({ recording: record, instrument });
      if (record) {
        setMessage("Creating the video…");
        downloadBlob(await createScaleVideo(instrument));
        setMessage("Video downloaded.");
      } else {
        setMessage("Scale finished.");
      }
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "Something went wrong.";
      setError(text);
    } finally {
      frameRef.current = IDLE_FRAME;
      noteRef.current = -1;
      setActiveIndex(-1);
      setBusy(false);
      lockRef.current = false;
    }
  }

  const current = activeIndex >= 0 ? NOTES[activeIndex] : null;
  const label = current ? noteLabel(current) : "";

  return (
    <main className="page">
      <nav className="top-nav" aria-label="Main navigation">
        <a href="/shruthi">Shruthi box</a>
        <a href="/carnatic">Carnatic notes</a>
      </nav>
      <header className="heading">
        <p className="eyebrow">MIDI</p>
        <h1>Play the scale</h1>
        <p className="lede">C, D, E, F, G, A, B, then high C. Each note sounds for one second.</p>
      </header>

      <fieldset className="instrument-options" disabled={busy}>
        <legend>INSTRUMENT</legend>
        {INSTRUMENTS.map((item) => (
          <label className={`instrument-option ${instrument === item.id ? "selected" : ""}`} key={item.id}>
            <input
              type="radio"
              name="instrument"
              value={item.id}
              checked={instrument === item.id}
              onChange={() => setInstrument(item.id)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>

      <canvas ref={canvasRef} className="stage" width={1280} height={720} aria-hidden="true" />

      <p className="now" aria-live="polite" data-note={label}>
        {label ? `Now playing ${label}` : "No note playing"}
      </p>

      <div className="actions">
        <button type="button" onClick={() => run(false)} disabled={busy}>
          Play
        </button>
        <button type="button" className="secondary" onClick={() => run(true)} disabled={busy}>
          Export video
        </button>
      </div>

      <p className="status" role="status">
        {error || message}
      </p>
    </main>
  );
}

function downloadBlob(blob) {
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `c-major-scale.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
