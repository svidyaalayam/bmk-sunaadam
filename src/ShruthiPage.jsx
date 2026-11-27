import { useEffect, useRef, useState } from "react";
import { createShruthiBox, SHRUTHI_NOTES } from "./shruthiAudio";
import AccountMenu from "./AccountMenu";

export default function ShruthiPage() {
  const boxRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [drone, setDrone] = useState("pa");
  const [error, setError] = useState("");

  useEffect(() => {
    const box = createShruthiBox();
    boxRef.current = box;
    return () => box.close();
  }, []);

  async function chooseNote(index) {
    try {
      setError("");
      await boxRef.current.play(index, drone);
      setActiveIndex(index);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the shruthi box.");
    }
  }

  async function chooseDrone(nextDrone) {
    setDrone(nextDrone);
    if (activeIndex < 0) return;

    try {
      setError("");
      await boxRef.current.play(activeIndex, nextDrone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the drone.");
    }
  }

  function stopNote() {
    boxRef.current?.stop();
    setActiveIndex(-1);
  }

  const activeNote = activeIndex >= 0 ? SHRUTHI_NOTES[activeIndex] : null;

  return (
    <main className="page shruthi-page">
      <nav className="top-nav" aria-label="Main navigation">
        <span aria-current="page">Shruthi box</span>
        <a href="/carnatic">Carnatic notes</a>
        <AccountMenu />
      </nav>

      <header className="heading">
        <p className="eyebrow">INDIAN SHRUTHI BOX</p>
        <h1>Find your shruthi</h1>
        <p className="lede">
          Choose a tonic. Hear a warm tanpura-style pluck cycle: low companion,
          Sa, Sa, then low Sa.
        </p>
      </header>

      <section className="shruthi-card" aria-label="Shruthi note selector">
        <div className="shruthi-card-header">
          <div>
            <p className="card-label">CURRENT SHRUTHI</p>
            <p className="current-note" aria-live="polite">
              {activeNote ? activeNote.name : "—"}
            </p>
          </div>
          <button type="button" className="stop-button" onClick={stopNote} disabled={!activeNote}>
            Stop
          </button>
        </div>

        <fieldset className="drone-options">
          <legend>DRONE NOTE</legend>
          {[
            ["pa", "Pa", "7 semitones"],
            ["ma", "Ma", "5 semitones"],
            ["ni", "Ni", "11 semitones"],
            ["null", "Null", "tonic only"],
          ].map(([value, label, detail]) => (
            <label className={`drone-option ${drone === value ? "selected" : ""}`} key={value}>
              <input
                type="radio"
                name="drone"
                value={value}
                checked={drone === value}
                onChange={() => chooseDrone(value)}
              />
              <span>{label}</span>
              <small>{detail}</small>
            </label>
          ))}
        </fieldset>

        <div className="note-grid">
          {SHRUTHI_NOTES.map((note, index) => (
            <button
              type="button"
              className={`note-button ${activeIndex === index ? "selected" : ""}`}
              key={note.name}
              onClick={() => chooseNote(index)}
              aria-pressed={activeIndex === index}
            >
              <span>{note.name}</span>
              <small>{note.frequency.toFixed(2)} Hz</small>
            </button>
          ))}
        </div>

        <p className="shruthi-status" role="status">
          {error || (activeNote ? `${activeNote.name} shruthi is playing` : "Select a note to begin")}
        </p>
      </section>
    </main>
  );
}
