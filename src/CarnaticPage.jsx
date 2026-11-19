import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTableSchedule,
  buildTalamRows,
  DEFAULT_EXERCISES,
  formatCarnaticNote,
  getCarnaticNoteClasses,
  getTableDuration,
  noteDurationUnits,
  parseLyrics,
  parseCarnaticNotes,
} from "./carnatic";
import { CARNATIC_INSTRUMENTS, createCarnaticAudio } from "./carnaticAudio";
import { createShruthiBox, SHRUTHI_NOTES } from "./shruthiAudio";

const FALLBACK_SESSIONS = [
  { id: "carnatic", name: "Carnatic", parentId: null, allowRagamChange: false },
  { id: "sarali", name: "Sarali swarams", parentId: "carnatic", allowRagamChange: true },
];
const FALLBACK_TALAMS = [{
  id: "adi",
  name: "Adi Talam",
  beats: 8,
  beatNumbers: [0, 1, 2, 3, 0, 6, 0, 6],
  cyclesPerRow: 1,
  beatGroups: [1, 1, 1, 1, 1, 1, 1, 1],
}];
const FALLBACK_RAGAMS = [{
  id: "fallback-29",
  name: "Dheerasankarabharanam",
  melakartaName: "Dheerasankarabharanam",
  melakartaNumber: 29,
  isMelakarta: true,
  arohanam: "S R G M P D N S+",
  avarohanam: "S+ N D P M G R S",
  swaraIntervals: { S: 0, R: 2, G: 4, M: 5, P: 7, D: 9, N: 11 },
}];
const FALLBACK_EXERCISES = DEFAULT_EXERCISES.map((exercise, index) => ({
  ...exercise,
  id: `fallback-${index}`,
  sessionId: "sarali",
  talamId: "adi",
  talamBeats: 8,
  talamName: "Adi Talam",
  ragamId: "fallback-29",
  ragamName: "Dheerasankarabharanam",
  swaraIntervals: FALLBACK_RAGAMS[0].swaraIntervals,
  noteDurationFixed: false,
}));

const SHRUTHI_OPTIONS = [
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

export default function CarnaticPage() {
  const [sessions, setSessions] = useState(FALLBACK_SESSIONS);
  const [talams, setTalams] = useState(FALLBACK_TALAMS);
  const [ragams, setRagams] = useState(FALLBACK_RAGAMS);
  const [exercises, setExercises] = useState(FALLBACK_EXERCISES);
  const [selectedSessionId, setSelectedSessionId] = useState("sarali");
  const [selectedExerciseId, setSelectedExerciseId] = useState("fallback-0");
  const [selectedMelakartaId, setSelectedMelakartaId] = useState("fallback-29");
  const visibleTables = [true, true, true, true];
  const [excludedPartKeys, setExcludedPartKeys] = useState([]);
  const [playInLoop, setPlayInLoop] = useState(false);
  const [shruthi, setShruthi] = useState("normal-G");
  const [instrument, setInstrument] = useState("veena");
  const [noteVolume, setNoteVolume] = useState(100);
  const [gamakamAmount, setGamakamAmount] = useState(0);
  const [bpm, setBpm] = useState(60);
  const [shruthiDrone, setShruthiDrone] = useState("pa");
  const [shruthiActiveIndex, setShruthiActiveIndex] = useState(-1);
  const [shruthiError, setShruthiError] = useState("");
  const [shruthiVolume, setShruthiVolume] = useState(14);
  const shruthiBoxRef = useRef(null);
  
  // Initialize Shruthi box
  useEffect(() => {
    const box = createShruthiBox();
    shruthiBoxRef.current = box;
    box.setVolume(shruthiVolume / 100);
    return () => box.close();
  }, []);
  
  // Update volume when slider changes
  useEffect(() => {
    shruthiBoxRef.current?.setVolume(shruthiVolume / 100);
  }, [shruthiVolume]);

  // If shruthi pitch changes while playing, restart with new pitch
  useEffect(() => {
    if (shruthiActiveIndex >= 0) {
      chooseShruthiNote(shruthiNoteIndex());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shruthi]);

  async function chooseShruthiNote(index) {
    try {
      setShruthiError("");
      await shruthiBoxRef.current.play(index, shruthiDrone);
      setShruthiActiveIndex(index);
    } catch (caught) {
      setShruthiError(caught instanceof Error ? caught.message : "Could not start the shruthi box.");
    }
  }

  function stopShruthi() {
    shruthiBoxRef.current?.stop();
    setShruthiActiveIndex(-1);
  }

  function changeDrone(nextDrone) {
    setShruthiDrone(nextDrone);
    if (shruthiActiveIndex < 0) return;
    // restart playback with new drone
    chooseShruthiNote(shruthiActiveIndex);
  }

  // Derive SHRUTHI_NOTES index from the existing shruthi pitch value (e.g. "normal-G#" → 8)
  function shruthiNoteIndex() {
    const noteName = shruthi.split("-").slice(1).join("-"); // handles "normal-C#", "lower-G#" etc.
    const idx = SHRUTHI_NOTES.findIndex((n) => n.name === noteName);
    return idx >= 0 ? idx : 0;
  }

  const [playbackState, setPlaybackState] = useState("stopped");
  const [countdown, setCountdown] = useState(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const playbackTimeRef = useRef(0);
  const animationRef = useRef(null);
  const audioRef = useRef(null);
  const audioPositionRef = useRef(null);
  const bellPositionRef = useRef(null);

  useEffect(() => {
    audioRef.current = createCarnaticAudio();
    return () => audioRef.current?.close();
  }, []);

  useEffect(() => {
    fetch("/api/curriculum/")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load curriculum.");
        return response.json();
      })
      .then((data) => {
        if (!data.sessions?.length || !data.exercises?.length) throw new Error("Curriculum is empty.");
        setSessions(data.sessions);
        setTalams(data.talams);
        setRagams(data.ragams || []);
        setExercises(data.exercises);
        setSelectedSessionId(String(data.exercises[0].sessionId));
        setSelectedExerciseId(String(data.exercises[0].id));
        setSelectedMelakartaId(String(data.exercises[0].ragamId || ""));
      })
      .catch(() => {});
  }, []);

  const sessionExercises = exercises.filter(
    (exercise) => String(exercise.sessionId) === String(selectedSessionId),
  );
  const currentExercise =
    exercises.find((exercise) => String(exercise.id) === String(selectedExerciseId)) ||
    sessionExercises[0] ||
    null;
  const currentTalam = talams.find(
    (talam) => String(talam.id) === String(currentExercise?.talamId),
  );
  const selectedRagam = ragams.find(
    (ragam) => String(ragam.id) === String(selectedMelakartaId),
  );
  const melakartaRagams = useMemo(() => {
    return ragams.filter((ragam) => {
      if (typeof ragam.isMelakarta === "boolean") return ragam.isMelakarta;
      if (ragam.melakartaName && ragam.name) {
        return ragam.name.trim().toLowerCase() === ragam.melakartaName.trim().toLowerCase();
      }
      return Boolean(ragam.melakartaNumber);
    });
  }, [ragams]);
  const currentSession =
    sessions.find((session) => String(session.id) === String(selectedSessionId)) ||
    sessions.find((session) => String(session.id) === String(currentExercise?.sessionId)) ||
    null;
  const parentSession = currentSession?.parentId
    ? sessions.find((session) => String(session.id) === String(currentSession.parentId))
    : null;
  const allowRagamChange = Boolean(
    currentSession?.allowRagamChange ??
    currentSession?.allow_ragam_change ??
    parentSession?.allowRagamChange ??
    parentSession?.allow_ragam_change ??
    currentExercise?.allowRagamChange ??
    false
  );
  const displayRagamName = selectedRagam
    ? `${selectedRagam.melakartaNumber ? `${selectedRagam.melakartaNumber}. ` : ""}${selectedRagam.name}`
    : currentExercise?.ragamName
    ? `${currentExercise.melakartaNumber ? `${currentExercise.melakartaNumber}. ` : ""}${currentExercise.ragamName}`
    : "—";
  const exerciseSections = useMemo(
    () => getExerciseSections(currentExercise),
    [currentExercise],
  );
  const notes = exerciseSections.flatMap((section) => section.notes);
  const playbackSequence = currentExercise?.playbackSequence || [];
  const swaraIntervals = selectedRagam?.swaraIntervals || currentExercise?.swaraIntervals || null;

  const previousSessionIdRef = useRef(selectedSessionId);

  useEffect(() => {
    const sessionChanged = previousSessionIdRef.current !== selectedSessionId;
    previousSessionIdRef.current = selectedSessionId;

    if (sessionChanged || !allowRagamChange) {
      if (currentExercise?.ragamId) {
        setSelectedMelakartaId(String(currentExercise.ragamId));
      }
    }
  }, [selectedSessionId, currentExercise?.id, currentExercise?.ragamId, allowRagamChange]);
  const selectedBeats = currentTalam?.beats || currentExercise?.talamBeats || 0;
  const cyclesPerRow = currentTalam?.cyclesPerRow || 1;
  const beatGroups = currentTalam?.beatGroups || Array.from(
    { length: selectedBeats },
    () => 1,
  );
  const repeatToCompleteTalam = currentExercise?.repeatToCompleteTalam ?? true;
  const completeTalamWithEmptyNotes =
    currentExercise?.completeTalamWithEmptyNotes ??
    currentExercise?.Complete_Talam_withEmptyNotes ??
    currentExercise?.complete_talam_with_empty_notes ??
    false;
  const playbackSchedule = buildTableSchedule(
    exerciseSections,
    selectedBeats,
    visibleTables,
    bpm,
    playbackSequence,
    cyclesPerRow,
    true,
    repeatToCompleteTalam,
    completeTalamWithEmptyNotes,
    excludedPartKeys,
  );
  const displaySchedule = buildTableSchedule(
    exerciseSections,
    selectedBeats,
    visibleTables,
    bpm,
    playbackSequence,
    cyclesPerRow,
    false,
    repeatToCompleteTalam,
    completeTalamWithEmptyNotes,
    excludedPartKeys,
  );
  const totalDuration = playbackSchedule.reduce((total, table) => total + table.duration, 0);

  useEffect(() => {
    if (playbackState !== "counting" || countdown === null) return undefined;

    const timer = window.setTimeout(() => {
      if (countdown === "Go") {
        setCountdown(null);
        setPlaybackState("playing");
      } else {
        audioRef.current?.playBell(shruthi);
        setCountdown(countdown === 3 ? 2 : countdown === 2 ? 1 : "Go");
      }
    }, 60000 / bpm);

    return () => window.clearTimeout(timer);
  }, [playbackState, countdown, bpm, shruthi]);

  useEffect(() => {
    if (playbackState !== "playing") return undefined;

    let previous = performance.now();
    const tick = (now) => {
      const nextTime = playbackTimeRef.current + (now - previous) / 1000;
      previous = now;
      if (nextTime >= totalDuration) {
        if (playInLoop && totalDuration > 0) {
          const loopedTime = nextTime % totalDuration;
          playbackTimeRef.current = loopedTime;
          setPlaybackTime(loopedTime);
          audioPositionRef.current = null;
          bellPositionRef.current = null;
          animationRef.current = requestAnimationFrame(tick);
          return;
        }
        playbackTimeRef.current = 0;
        setPlaybackTime(0);
        setPlaybackState("stopped");
        animationRef.current = null;
        return;
      }
      playbackTimeRef.current = nextTime;
      setPlaybackTime(nextTime);
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [playbackState, totalDuration, playInLoop]);

  useEffect(() => {
    if (playbackState !== "playing" && playbackState !== "counting") {
      audioRef.current?.stop();
      audioPositionRef.current = null;
      bellPositionRef.current = null;
      return;
    }
    if (playbackState === "counting") return;

    const position = getPlaybackNotePosition(
      playbackSchedule,
      currentTalam?.beatNumbers || [],
      beatGroups,
      playbackTime,
      bpm,
    );
    if (!position || !audioRef.current) return;

    if (
      position.beatStart &&
      position.beatGroupStart &&
      bellPositionRef.current !== position.beatKey
    ) {
      bellPositionRef.current = position.beatKey;
      audioRef.current.playBell(shruthi);
    }

    if (position.isContinuation) return;

    const positionKey = `${position.tableIndex}-${position.noteIndex}-${shruthi}`;
    if (audioPositionRef.current === positionKey) return;
    audioPositionRef.current = positionKey;
    const volume = 0.18 * (noteVolume / 100);
    audioRef.current.playNote(
      position.note,
      shruthi,
      volume,
      swaraIntervals,
      instrument,
      position.duration,
      gamakamAmount,
    );
  }, [
    playbackState,
    playbackTime,
    notes,
    playbackSchedule,
    selectedBeats,
    currentTalam?.beatNumbers,
    beatGroups,
    visibleTables,
    bpm,
    shruthi,
    swaraIntervals,
    instrument,
    noteVolume,
    gamakamAmount,
  ]);

  function playPlayback() {
    if (!currentExercise || totalDuration <= 0) return;
    audioRef.current?.resume?.();
    if (playbackState === "paused") {
      setPlaybackState("playing");
      return;
    }
    audioRef.current?.playBell(shruthi);
    setCountdown(3);
    setPlaybackState("counting");
  }

  function pausePlayback() {
    setPlaybackState("paused");
  }

  function stopPlayback() {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    playbackTimeRef.current = 0;
    setPlaybackTime(0);
    setCountdown(null);
    setPlaybackState("stopped");
  }

  function chooseSession(sessionId) {
    stopPlayback();
    setExcludedPartKeys([]);
    setSelectedSessionId(sessionId);
    const firstExercise = exercises.find(
      (exercise) => String(exercise.sessionId) === String(sessionId),
    );
    setSelectedExerciseId(firstExercise ? String(firstExercise.id) : "");
  }

  function toggleExcludePart(partKey) {
    stopPlayback();
    setExcludedPartKeys((current) =>
      current.includes(partKey)
        ? current.filter((key) => key !== partKey)
        : [...current, partKey],
    );
  }

  const currentPlaybackPosition = playbackState === "playing"
    ? getPlaybackNotePosition(
      playbackSchedule,
      currentTalam?.beatNumbers || [],
      beatGroups,
      playbackTime,
      bpm,
    )
    : null;
  const currentBeatNumber =
    currentPlaybackPosition?.beatNumber !== undefined
      ? Number(currentPlaybackPosition.beatNumber)
      : null;
  const currentBeatCount =
    currentPlaybackPosition?.beatCount !== undefined
      ? Number(currentPlaybackPosition.beatCount)
      : null;
  const currentBeatProgress = playbackState === "playing"
    ? getPlaybackBeatProgress(playbackSchedule, playbackTime, bpm)
    : 0;
  const currentBeatImageNumber = Number.isFinite(currentBeatNumber) && currentBeatProgress >= 0.9
    ? 9
    : currentBeatNumber;

  return (
    <main className="page carnatic-page">
      <nav className="top-nav" aria-label="Main navigation">
        <span aria-current="page">Carnatic notes</span>
      </nav>

      <section className="carnatic-controls" aria-label="Curriculum selection">
        <div className="controls-row curriculum-row">
          <label className="curriculum-select">
            <span className="control-label">Session</span>
            <select value={selectedSessionId} onChange={(event) => chooseSession(event.target.value)}>
              {sessions.map((session) => (
                <option value={String(session.id)} key={session.id}>
                  {session.parentId ? `  └ ${session.name}` : session.name}
                </option>
              ))}
            </select>
          </label>

          <label className="curriculum-select">
            <span className="control-label">Exercise</span>
            <select
              value={currentExercise ? String(currentExercise.id) : ""}
              onChange={(event) => {
                stopPlayback();
                setExcludedPartKeys([]);
                setSelectedExerciseId(event.target.value);
              }}
            >
              {sessionExercises.map((exercise) => (
                <option value={String(exercise.id)} key={exercise.id}>{exercise.title}</option>
              ))}
            </select>
          </label>

          <label className={`curriculum-select${!allowRagamChange ? " curriculum-readonly" : ""}`}>
            <span className="control-label">Ragam</span>
            {allowRagamChange ? (
              <select
                value={selectedMelakartaId}
                onChange={(event) => {
                  stopPlayback();
                  setSelectedMelakartaId(event.target.value);
                }}
              >
                {!melakartaRagams.some((r) => String(r.id) === String(selectedMelakartaId)) && selectedRagam && (
                  <option value={String(selectedRagam.id)}>
                    {selectedRagam.melakartaNumber ? `${selectedRagam.melakartaNumber}. ` : ""}{selectedRagam.name}
                  </option>
                )}
                {melakartaRagams.map((ragam) => (
                  <option value={String(ragam.id)} key={ragam.id}>
                    {ragam.melakartaNumber ? `${ragam.melakartaNumber}. ` : ""}{ragam.name}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="curriculum-readonly-field"
                title="Ragam cannot be changed for this session"
                aria-readonly="true"
              >
                {displayRagamName}
              </span>
            )}
          </label>

          <div className="talam-badge-container">
            <span className="control-label">Talam</span>
            <div className="talam-badge" title={`${currentTalam?.name || currentExercise?.talamName || "Talam"} (${currentTalam?.beats || currentExercise?.talamBeats || 0} beats)`}>
              <span className="talam-name">{currentTalam?.name || currentExercise?.talamName || "No Talam"}</span>
              <span className="talam-beats">{currentTalam?.beats || currentExercise?.talamBeats || 0} beats</span>
            </div>
          </div>
        </div>

        <div className="controls-divider" />

        <div className="controls-row audio-row">
          <label className="curriculum-select">
            <span className="control-label">Shruthi</span>
            <select value={shruthi} onChange={(event) => setShruthi(event.target.value)}>
              {SHRUTHI_OPTIONS.map((group) => (
                <optgroup label={group.label} key={group.label}>
                  {group.notes.map((note) => (
                    <option value={note.value} key={note.value}>{note.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="curriculum-select">
            <span className="control-label">Instrument</span>
            <select
              value={instrument}
              onChange={(event) => {
                stopPlayback();
                setInstrument(event.target.value);
              }}
            >
              {CARNATIC_INSTRUMENTS.map((option) => (
                <option value={option.id} key={option.id}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="curriculum-select bpm-select">
            <span className="control-label">BPM</span>
            <input
              type="number"
              min="20"
              max="300"
              value={bpm}
              onChange={(event) => {
                stopPlayback();
                setBpm(Math.max(20, Math.min(300, Number(event.target.value) || 20)));
              }}
            />
          </label>

          <label className="curriculum-select volume-select">
            <span className="control-label">
              <span>Volume</span>
              <span className="slider-value-pill">{noteVolume}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={noteVolume}
              aria-label="Notes volume"
              onChange={(event) => setNoteVolume(Number(event.target.value))}
            />
          </label>

          <label className="curriculum-select volume-select">
            <span className="control-label">
              <span>Gamakam</span>
              <span className="slider-value-pill">{gamakamAmount}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={gamakamAmount}
              aria-label="Gamakam amount"
              onChange={(event) => setGamakamAmount(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="controls-divider" />

        {/* Shruthi Box controls */}
        <div className="controls-row shruthi-box-row">
          <div className="shruthi-box-group">
            <span className="control-label">Play Shruthi</span>
            <div className="shruthi-box-controls">
              <select
                value={shruthiDrone}
                onChange={(event) => changeDrone(event.target.value)}
                aria-label="Shruthi drone note"
              >
                <option value="pa">Pa</option>
                <option value="ma">Ma</option>
                <option value="ni">Ni</option>
                <option value="null">Null</option>
              </select>
              {shruthiActiveIndex >= 0 ? (
                <button type="button" className="shruthi-stop-btn" onClick={stopShruthi}>
                  Stop Shruthi
                </button>
              ) : (
                <button
                  type="button"
                  className="shruthi-play-btn"
                  onClick={() => chooseShruthiNote(shruthiNoteIndex())}
                >
                  Play Shruthi
                </button>
              )}
              <label className="shruthi-volume-label">
                <span className="slider-value-pill">{shruthiVolume}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={shruthiVolume}
                  aria-label="Shruthi volume"
                  onChange={(event) => setShruthiVolume(Number(event.target.value))}
                />
              </label>
              {shruthiError && <span className="shruthi-error">{shruthiError}</span>}
            </div>
          </div>
        </div>
      </section>

      <div className="transport-controls" role="group" aria-label="Exercise playback">
        <div className="transport-column">
          <button
            type="button"
            onClick={playPlayback}
            disabled={playbackState === "playing" || playbackState === "counting" || !currentExercise || totalDuration <= 0}
          >
            {playbackState === "paused" ? "Resume" : "Play"}
          </button>
          <label className="loop-checkbox-label" title="Play continuously in a loop">
            <input
              type="checkbox"
              checked={playInLoop}
              onChange={(event) => setPlayInLoop(event.target.checked)}
            />
            <span>Repeat</span>
          </label>
        </div>
        <div className="transport-column">
          <button
            type="button"
            className="secondary"
            onClick={pausePlayback}
            disabled={playbackState !== "playing"}
          >
            Pause
          </button>
          <button
            type="button"
            className="secondary"
            onClick={stopPlayback}
            disabled={playbackState === "stopped"}
          >
            Stop
          </button>
        </div>
        <div className="beat-image-placeholder" aria-live="polite">
          <span className="beat-count">
            {Number.isFinite(currentBeatCount) ? currentBeatCount : "—"}
          </span>
          {Number.isFinite(currentBeatImageNumber) && (
            <img
              key={currentBeatImageNumber}
              src={`/beat-images/beat-${currentBeatImageNumber}.jpeg`}
              alt={`Beat ${currentBeatImageNumber}`}
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
              onLoad={(event) => {
                event.currentTarget.hidden = false;
              }}
            />
          )}
        </div>
      </div>

      {countdown !== null && (
        <div className="count-in" key={countdown} role="status" aria-live="assertive">
          {countdown}
        </div>
      )}

      {currentExercise ? (
        <Exercise
          exercise={currentExercise}
          sections={exerciseSections}
          tableSchedule={displaySchedule}
          beats={selectedBeats}
          cyclesPerRow={cyclesPerRow}
          beatGroups={beatGroups}
          beatNumbers={currentTalam?.beatNumbers || []}
          playbackTime={playbackTime}
          bpm={bpm}
          onToggleExclude={toggleExcludePart}
        />
      ) : (
        <p className="status">No exercises are assigned to this session yet.</p>
      )}
    </main>
  );
}

function getExerciseSections(exercise) {
  if (!exercise) return [];
  if (exercise.sections?.length) {
    return exercise.sections.map((section) => ({
      ...section,
      notes: parseCarnaticNotes(section.notes),
      lyrics: parseLyrics(section.lyrics),
    }));
  }
  return [{
    title: "Main",
    notes: parseCarnaticNotes(exercise.notes),
    lyrics: parseLyrics(exercise.lyrics),
  }];
}

function Exercise({
  exercise,
  sections,
  tableSchedule,
  beats,
  cyclesPerRow,
  beatGroups,
  beatNumbers,
  playbackTime,
  bpm,
  onToggleExclude,
}) {
  const repeatToCompleteTalam = exercise?.repeatToCompleteTalam ?? true;
  const completeTalamWithEmptyNotes =
    exercise?.completeTalamWithEmptyNotes ??
    exercise?.Complete_Talam_withEmptyNotes ??
    exercise?.complete_talam_with_empty_notes ??
    false;
  const notes = sections.flatMap((section) => section.notes);
  let previousSectionKey = null;
  const tableElements = tableSchedule.map((table, index) => {
    const sectionHeading = table.sectionKey !== previousSectionKey
      ? <h3 className="exercise-section-title" key={`section-${table.sectionKey}`}>
        {table.section.title || `Section ${table.sectionIndex + 1}`}
      </h3>
      : null;
    previousSectionKey = table.sectionKey;
    return (
      <Fragment key={`${table.sectionIndex}-${table.notesPerBeat}-${index}`}>
        {sectionHeading}
        <NoteTable
          notes={table.notes}
          lyrics={table.lyrics}
          beats={beats}
          cyclesPerRow={cyclesPerRow}
          beatGroups={beatGroups}
          beatNumbers={beatNumbers}
          notesPerBeat={table.notesPerBeat}
          playbackTime={playbackTime}
          bpm={bpm}
          tableStartTime={table.tableStartTime}
          tableDuration={table.duration}
          repeatCount={table.repeatCount || 1}
          repeatToCompleteTalam={table.repeatToCompleteTalam ?? repeatToCompleteTalam}
          completeTalamWithEmptyNotes={table.completeTalamWithEmptyNotes ?? completeTalamWithEmptyNotes}
          isExcluded={table.isExcluded}
          partKey={table.partKey}
          onToggleExclude={onToggleExclude}
        />
      </Fragment>
    );
  });

  return (
    <section className="exercise-card">
      <div className="exercise-heading">
        <div>
          <p className="card-label">CARNATIC LESSON</p>
          <h2>{exercise.title}</h2>
          {exercise.description && (
            <p className="exercise-description">{exercise.description}</p>
          )}
        </div>
      <span className="note-count">
        {notes.length} notes · {exercise.noteDurationFixed ? "fixed duration" : "basic lesson"}
      </span>
      </div>

      <div className="table-list">{tableElements}</div>
    </section>
  );
}

function ordinal(number) {
  if (number % 100 >= 11 && number % 100 <= 13) return `${number}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
  return `${number}${suffix}`;
}

function getPlaybackNotePosition(tableSchedule, beatNumbers, beatGroups, playbackTime, defaultBpm = 60) {
  for (let tableIndex = 0; tableIndex < tableSchedule.length; tableIndex += 1) {
    const table = tableSchedule[tableIndex];
    const {
      notes,
      notesPerBeat,
      beats,
      cyclesPerRow,
      tableStartTime,
      duration: tableDuration,
      repeatToCompleteTalam = true,
      completeTalamWithEmptyNotes = false,
      bpm = defaultBpm,
    } = table;
    const rows = buildTalamRows(
      notes,
      beats,
      notesPerBeat,
      cyclesPerRow,
      repeatToCompleteTalam,
      completeTalamWithEmptyNotes,
    );
    if (playbackTime >= tableStartTime && playbackTime < tableStartTime + tableDuration) {
      const secondsPerBeat = 60 / bpm;
      const current = getTableNotePosition(
        rows,
        playbackTime - tableStartTime,
        secondsPerBeat,
        notesPerBeat,
      );
      if (!current) return null;
      const rawBeatNumber =
        Array.isArray(beatNumbers) && beatNumbers.length > 0
          ? beatNumbers[current.beatIndex % beats]
          : (current.beatIndex % beats);
      const parsedBeatNumber =
        rawBeatNumber !== undefined && rawBeatNumber !== null && rawBeatNumber !== ""
          ? Number(rawBeatNumber)
          : null;
      return {
        tableIndex,
        note: current.note,
        noteIndex: current.noteIndex,
        beatNumber: Number.isFinite(parsedBeatNumber) ? parsedBeatNumber : null,
        beatCount: (current.beatIndex % beats) + 1,
        duration: (secondsPerBeat / notesPerBeat)
          * current.durationUnits / 4,
        beatStart: current.noteIndexInCell === 0,
        beatGroupStart: isBeatGroupStart(current.beatIndex, beats, beatGroups),
        isContinuation: current.note.startsWith(";"),
        beatKey: `${tableIndex}-${current.rowIndex}-${current.beatIndex}`,
      };
    }
  }
  return null;
}

function isBeatGroupStart(beatIndex, beats, beatGroups) {
  const beatInCycle = beatIndex % beats;
  let groupStart = 0;
  for (const groupSize of beatGroups) {
    if (beatInCycle === groupStart) return true;
    groupStart += groupSize;
  }
  return false;
}

function getPlaybackBeatProgress(tableSchedule, playbackTime, bpm) {
  const table = tableSchedule.find(
    (entry) => playbackTime >= entry.tableStartTime
      && playbackTime < entry.tableStartTime + entry.duration * (entry.repeatCount || 1),
  );
  if (!table) return 0;
  const beatDuration = 60 / bpm;
  return ((playbackTime - table.tableStartTime) % beatDuration) / beatDuration;
}

function getTableNotePosition(rows, localPlaybackTime, secondsPerBeat, notesPerBeat) {
  const secondsPerUnit = secondsPerBeat / notesPerBeat / 4;
  const unitIndex = Math.min(
    Math.floor(localPlaybackTime / secondsPerUnit),
    rows.flat(2).reduce((total, note) => total + noteDurationUnits(note), 0) - 1,
  );
  let elapsedUnits = 0;
  let noteIndex = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let beatIndex = 0; beatIndex < rows[rowIndex].length; beatIndex += 1) {
      const cell = rows[rowIndex][beatIndex];
      for (let noteIndexInCell = 0; noteIndexInCell < cell.length; noteIndexInCell += 1) {
        const note = cell[noteIndexInCell];
        const units = noteDurationUnits(note);
        if (unitIndex < elapsedUnits + units) {
          let startIndex = noteIndex;
          const allNotes = rows.flat(2);
          while (startIndex > 0 && allNotes[startIndex].startsWith(";")) startIndex -= 1;
          let durationUnits = noteDurationUnits(allNotes[startIndex]);
          let continuationIndex = startIndex + 1;
          while (
            continuationIndex < allNotes.length &&
            allNotes[continuationIndex].startsWith(";")
          ) {
            durationUnits += noteDurationUnits(allNotes[continuationIndex]);
            continuationIndex += 1;
          }
          return {
            note,
            noteIndex,
            noteIndexInCell,
            rowIndex,
            beatIndex,
            durationUnits,
          };
        }
        elapsedUnits += units;
        noteIndex += 1;
      }
    }
  }
  return null;
}

function getColumnGroups(beats, cyclesPerRow, beatGroups) {
  const groups = [];
  for (let cycle = 0; cycle < cyclesPerRow; cycle += 1) {
    let offset = 0;
    beatGroups.forEach((groupSize) => {
      groups.push(
        Array.from({ length: groupSize }, (_, index) => cycle * beats + offset + index),
      );
      offset += groupSize;
    });
  }
  return groups;
}

function NoteTable({
  notes,
  lyrics,
  beats,
  cyclesPerRow,
  beatGroups,
  beatNumbers,
  notesPerBeat,
  playbackTime,
  bpm,
  tableStartTime,
  tableDuration,
  repeatCount,
  repeatToCompleteTalam = true,
  completeTalamWithEmptyNotes = false,
  isExcluded = false,
  partKey,
  onToggleExclude,
}) {
  const rows = buildTalamRows(
    notes,
    beats,
    notesPerBeat,
    cyclesPerRow,
    repeatToCompleteTalam,
    completeTalamWithEmptyNotes,
  );
  const lyricRows = lyrics.length
    ? buildTalamRows(
        lyrics,
        beats,
        notesPerBeat,
        cyclesPerRow,
        repeatToCompleteTalam,
        completeTalamWithEmptyNotes,
      )
    : [];
  const noteTotal = rows.reduce((total, row) => total + row.flat().length, 0);
  const activeCellRef = useRef(null);
  const secondsPerBeat = 60 / bpm;
  const repeatedDuration = tableDuration * repeatCount;
  const tableIsActive =
    !isExcluded &&
    playbackTime >= tableStartTime &&
    playbackTime < tableStartTime + repeatedDuration;
  const localPlaybackTime = tableIsActive
    ? (playbackTime - tableStartTime) % tableDuration
    : 0;
  const currentPosition = getTableNotePosition(
    rows,
    localPlaybackTime,
    secondsPerBeat,
    notesPerBeat,
  );
  const currentRowIndex = currentPosition?.rowIndex ?? -1;
  const currentBeatIndex = currentPosition?.beatIndex ?? -1;
  const currentNoteIndexInCell = currentPosition?.noteIndexInCell ?? -1;
  const hasPlaybackPosition = tableIsActive && playbackTime > 0;
  const currentRepeat = tableIsActive
    ? Math.min(repeatCount, Math.floor((playbackTime - tableStartTime) / tableDuration) + 1)
    : 0;
  const columnGroups = getColumnGroups(beats, cyclesPerRow, beatGroups);

  useEffect(() => {
    if (!hasPlaybackPosition || !activeCellRef.current) return;
    activeCellRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [hasPlaybackPosition, currentRowIndex, currentBeatIndex]);

  return (
    <section className={`note-table-section ${tableIsActive ? "table-playing" : ""} ${isExcluded ? "table-section-excluded" : ""} notes-per-beat-${notesPerBeat}`}>
      <div className="table-title">
        <div className="table-title-meta">
          <h3>{notesPerBeat} note{notesPerBeat > 1 ? "s" : ""} per beat</h3>
          <span>{noteTotal} notes · {rows.length} row{rows.length > 1 ? "s" : ""}</span>
          {repeatCount > 1 && (
            <span className="repeat-status">
              {currentRepeat ? `Playing ${ordinal(currentRepeat)} time` : `Repeats ${repeatCount} times`}
            </span>
          )}
        </div>
        <label className="exclude-table-toggle" title="Exclude this table from playing">
          <input
            type="checkbox"
            checked={Boolean(isExcluded)}
            onChange={() => onToggleExclude && onToggleExclude(partKey)}
          />
          <span>Exclude</span>
        </label>
      </div>
      {isExcluded ? (
        <div className="table-excluded-banner">
          <span>Table notes excluded from display and playback. Uncheck Exclude to view and play.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columnGroups.map((group, groupIndex) => (
                  <th
                    className={[
                      group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
                      hasPlaybackPosition &&
                      currentRowIndex >= 0 &&
                      currentRowIndex < rows.length &&
                      group.includes(currentBeatIndex)
                        ? "beat-active"
                        : "",
                    ].join(" ")}
                    key={groupIndex}
                    scope="col"
                  >
                    Beat {group[0] + 1}{group.length > 1 ? `–${group[group.length - 1] + 1}` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <Fragment key={rowIndex}>
                  <tr>
                  {columnGroups.map((group, groupIndex) => (
                    <td
                      className={[
                        group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
                        hasPlaybackPosition &&
                        currentRowIndex === rowIndex &&
                        group.includes(currentBeatIndex)
                          ? "beat-active"
                          : "",
                      ].join(" ")}
                      ref={
                        hasPlaybackPosition &&
                        currentRowIndex === rowIndex &&
                        group.includes(currentBeatIndex)
                          ? activeCellRef
                          : null
                      }
                      key={groupIndex}
                    >
                      {group.map((beatIndex) => (
                        <span className="beat-content" key={beatIndex}>
                          {row[beatIndex]?.map((note, noteIndex) => (
                            <span
                              className={[
                                "swar",
                                ...getCarnaticNoteClasses(note),
                                hasPlaybackPosition &&
                                currentRowIndex === rowIndex &&
                                currentBeatIndex === beatIndex &&
                                currentNoteIndexInCell === noteIndex
                                  ? "swar-active"
                                  : "",
                              ].join(" ")}
                              key={`${note}-${noteIndex}`}
                            >
                              {formatCarnaticNote(note)}
                            </span>
                          ))}
                        </span>
                      ))}
                    </td>
                  ))}
                  </tr>
                  {lyricRows.length > rowIndex && (
                    <tr className="lyrics-row">
                    {columnGroups.map((group, groupIndex) => (
                      <td
                        className={[
                          group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
                          hasPlaybackPosition &&
                          currentRowIndex === rowIndex &&
                          group.includes(currentBeatIndex)
                            ? "beat-active"
                            : "",
                        ].join(" ")}
                        key={groupIndex}
                      >
                        {group.map((beatIndex) => (
                          <span className="beat-content" key={beatIndex}>
                            {lyricRows[rowIndex]?.[beatIndex]?.map((lyric, lyricIndex) => (
                              <span
                                className={[
                                  "lyric",
                                  hasPlaybackPosition &&
                                  currentRowIndex === rowIndex &&
                                  currentBeatIndex === beatIndex &&
                                  currentNoteIndexInCell === lyricIndex
                                    ? "lyric-active"
                                    : "",
                                ].join(" ")}
                                key={`${lyric}-${lyricIndex}`}
                              >
                                {lyric}
                              </span>
                            ))}
                          </span>
                        ))}
                      </td>
                    ))}
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export { buildTableSchedule, getTableDuration };
