import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { flushSync } from "react-dom";
import {
  buildTableSchedule,
  buildSectionRows,
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
import { RECORDING_PRESETS } from "./useScreenRecorder";
import {
  createLessonVideo,
  selectLessonVideoEncoder,
} from "./exportLessonVideo";
import { ExportVideoModal } from "./ExportVideoModal";
import {
  analyzePracticeRecording,
  chooseNoteSelectionCandidate,
  getNoteRange,
} from "./frequencyAnalysis";
import { resolveSessionRagamId } from "./sessionRagam";
import AccountMenu from "./AccountMenu";
import { apiFetch, useAuth } from "./auth";
import { SHRUTHI_OPTIONS } from "./shruthiOptions";

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
const COMMENT_MARKER = "💬";

async function getMicrophoneDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Microphone selection is not supported in this browser.");
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}

function getRecordingOwnerKey() {
  const storageKey = "carnatic_practice_recording_owner";
  const existingKey = localStorage.getItem(storageKey);
  if (existingKey && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existingKey)) {
    return existingKey;
  }
  if (existingKey) localStorage.removeItem(storageKey);

  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure browser storage is required to save recordings.");
  }
  const ownerKey = globalThis.crypto.randomUUID();
  localStorage.setItem(storageKey, ownerKey);
  return ownerKey;
}

async function getApiError(response) {
  const body = await response.text();
  try {
    const data = JSON.parse(body);
    if (typeof data.error === "string") return data.error;
  } catch {
    // Include a short response excerpt when the server does not return JSON.
  }
  return body.trim().slice(0, 240) || `HTTP ${response.status}`;
}

function getShruthiLabel(value) {
  for (const group of SHRUTHI_OPTIONS) {
    const note = group.notes.find((option) => option.value === value);
    if (note) return `${group.label} ${note.label}`;
  }
  return value;
}

function formatPlaybackTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default function CarnaticPage() {
  const { user } = useAuth();
  const dashboardMode = window.location.pathname === "/dash-board";
  const [sessions, setSessions] = useState(FALLBACK_SESSIONS);
  const [talams, setTalams] = useState(FALLBACK_TALAMS);
  const [ragams, setRagams] = useState(FALLBACK_RAGAMS);
  const [exercises, setExercises] = useState(FALLBACK_EXERCISES);
  const [curriculumError, setCurriculumError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("sarali");
  const [selectedExerciseId, setSelectedExerciseId] = useState("fallback-0");
  const [selectedMelakartaId, setSelectedMelakartaId] = useState("fallback-29");
  const [sessionRagamSelections, setSessionRagamSelections] = useState({});
  const visibleTables = [true, true, true, true];
  const [excludedPartKeys, setExcludedPartKeys] = useState([]);
  const [playInLoop, setPlayInLoop] = useState(false);
  const [shruthi, setShruthi] = useState("normal-G");
  const [instrument, setInstrument] = useState("veena");
  const [noteVolume, setNoteVolume] = useState(100);
  const [bpm, setBpm] = useState(60);
  const [shruthiDrone, setShruthiDrone] = useState("pa");
  const [shruthiActiveIndex, setShruthiActiveIndex] = useState(-1);
  const [shruthiError, setShruthiError] = useState("");
  const [shruthiVolume, setShruthiVolume] = useState(14);
  const shruthiBoxRef = useRef(null);

  useEffect(() => {
    if (user?.defaultShruthi) setShruthi(user.defaultShruthi);
  }, [user?.id, user?.defaultShruthi]);

  const [playbackState, setPlaybackState] = useState("stopped");
  const [playbackSource, setPlaybackSource] = useState("instrument");
  const [countdown, setCountdown] = useState(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const playbackTimeRef = useRef(0);
  const playbackRangeEndRef = useRef(null);
  const animationRef = useRef(null);
  const audioRef = useRef(null);
  const audioPositionRef = useRef(null);
  const bellPositionRef = useRef(null);
  const [microphoneStarting, setMicrophoneStarting] = useState(false);
  const [microphoneRecording, setMicrophoneRecording] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [microphoneSignalDetected, setMicrophoneSignalDetected] = useState(false);
  const [microphoneWaveform, setMicrophoneWaveform] = useState(() => Array(32).fill(0));
  const [microphoneDevices, setMicrophoneDevices] = useState([]);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState("default");
  const [microphoneDeviceError, setMicrophoneDeviceError] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingExerciseId, setRecordingExerciseId] = useState("");
  const [recordingSettings, setRecordingSettings] = useState(null);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingId, setRecordingId] = useState(null);
  const [recordingComments, setRecordingComments] = useState([]);
  const [recordingCommentsError, setRecordingCommentsError] = useState("");
  const [selectedRecordingCommentId, setSelectedRecordingCommentId] = useState(null);
  const [teacherRatingDraft, setTeacherRatingDraft] = useState("");
  const [teacherRatingBusy, setTeacherRatingBusy] = useState(false);
  const [editingRecordingCommentId, setEditingRecordingCommentId] = useState(null);
  const [editingRecordingCommentText, setEditingRecordingCommentText] = useState("");
  const [recordingCommentScope, setRecordingCommentScope] = useState("table");
  const [recordingCommentTableIndex, setRecordingCommentTableIndex] = useState("0");
  const [recordingCommentRowIndex, setRecordingCommentRowIndex] = useState("0");
  const [recordingCommentNoteIndex, setRecordingCommentNoteIndex] = useState("0");
  const [recordingCommentDraft, setRecordingCommentDraft] = useState("");
  const [recordingCommentBusy, setRecordingCommentBusy] = useState(false);
  const [commentNavigationRequest, setCommentNavigationRequest] = useState(0);
  const [performanceReport, setPerformanceReport] = useState(null);
  const [performanceAnalysisBusy, setPerformanceAnalysisBusy] = useState(false);
  const [performanceAnalysisError, setPerformanceAnalysisError] = useState("");
  const [rangeStartNoteIndex, setRangeStartNoteIndex] = useState("");
  const [rangeEndNoteIndex, setRangeEndNoteIndex] = useState("");
  const [noteSelectionTarget, setNoteSelectionTarget] = useState("");
  const [recordingOwnerKey, setRecordingOwnerKey] = useState("");
  const [recordingOwnerError, setRecordingOwnerError] = useState("");
  const [savedRecordings, setSavedRecordings] = useState([]);
  const [musicClassData, setMusicClassData] = useState({
    classes: [],
    teachers: [],
    students: [],
  });
  const [selectedTeachingClassId, setSelectedTeachingClassId] = useState("");
  const [teacherClassRecordings, setTeacherClassRecordings] = useState([]);
  const [classHomeworks, setClassHomeworks] = useState([]);
  const [classWorkspaceError, setClassWorkspaceError] = useState("");
  const [classActionMessage, setClassActionMessage] = useState("");
  const [classActionBusy, setClassActionBusy] = useState(false);
  const [classForm, setClassForm] = useState({ name: "", teacherId: "", studentIds: [] });
  const [homeworkForm, setHomeworkForm] = useState({
    title: "",
    description: "",
    dueDate: "",
  });
  const [recordingSaveBusy, setRecordingSaveBusy] = useState(false);
  const [loadingRecordingId, setLoadingRecordingId] = useState(null);
  const [deletingRecordingId, setDeletingRecordingId] = useState(null);
  const [recordingArchiveError, setRecordingArchiveError] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const microphoneStreamRef = useRef(null);
  const microphoneRecorderRef = useRef(null);
  const microphoneChunksRef = useRef([]);
  const microphoneAudioContextRef = useRef(null);
  const microphoneAnalyserRef = useRef(null);
  const microphoneSourceRef = useRef(null);
  const microphoneSilentOutputRef = useRef(null);
  const microphoneMeterFrameRef = useRef(null);
  const recordingUrlRef = useRef("");
  const recordedAudioRef = useRef(null);
  const recordingUserIdRef = useRef(user?.id ?? null);
  const startMicrophoneAfterCountdownRef = useRef(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportPresetKey, setExportPresetKey] = useState(() => {
    try {
      const saved = localStorage.getItem("carnatic_record_preset");
      if (saved && RECORDING_PRESETS[saved]) return saved;
    } catch {
      // Use the compact preset when browser storage is unavailable.
    }
    return "compact";
  });
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState("");
  const [exportFormat, setExportFormat] = useState("");
  const [readyLessonVideo, setReadyLessonVideo] = useState(null);
  const lessonVideoUrlRef = useRef(null);

  // Auto-hide transport controls during playback; reveal on mouse movement for 2.5s
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimeoutRef = useRef(null);

  const isPlaying = playbackState === "playing" || playbackState === "counting";

  useEffect(() => () => {
    if (lessonVideoUrlRef.current) {
      URL.revokeObjectURL(lessonVideoUrlRef.current);
    }
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    const recorder = microphoneRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    stopMicrophoneMeter();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    let active = true;
    const updateMicrophoneDevices = async () => {
      try {
        const audioInputs = await getMicrophoneDevices();
        if (!active) return;
        setMicrophoneDevices(audioInputs);
        setMicrophoneDeviceError(
          audioInputs.length ? "" : "No microphone devices were found. Check browser/device permissions.",
        );
        if (
          microphoneDeviceId !== "default" &&
          !audioInputs.some((device) => device.deviceId === microphoneDeviceId)
        ) {
          setMicrophoneDeviceId("default");
        }
      } catch (error) {
        if (!active) return;
        setMicrophoneDeviceError(
          error instanceof Error
            ? `Could not list microphone sources: ${error.message}`
            : "Could not list microphone sources.",
        );
      }
    };

    updateMicrophoneDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", updateMicrophoneDevices);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", updateMicrophoneDevices);
    };
  }, [microphoneDeviceId]);

  useEffect(() => {
    try {
      setRecordingOwnerKey(getRecordingOwnerKey());
      setRecordingOwnerError("");
    } catch (error) {
      setRecordingOwnerError(
        error instanceof Error ? error.message : "Could not initialize recording storage.",
      );
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
        hideControlsTimeoutRef.current = null;
      }
      return undefined;
    }

    // When play/record is clicked, hide controls after 2.5 seconds
    setControlsVisible(true);
    hideControlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 2500);

    const handleMouseMove = () => {
      setControlsVisible(true);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
      hideControlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
        hideControlsTimeoutRef.current = null;
      }
    };
  }, [isPlaying]);

  // Ref to the exercise-card DOM element for cropped recording
  const exerciseCardRef = useRef(null);
  // Initialize Carnatic audio and Shruthi box sharing the same AudioContext
  useEffect(() => {
    const audio = createCarnaticAudio();
    audioRef.current = audio;
    const box = createShruthiBox({ getContext: () => audio.getAudioContext() });
    shruthiBoxRef.current = box;
    box.setVolume(shruthiVolume / 100);
    return () => {
      audio.close();
      box.close();
    };
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

  useEffect(() => {
    const controller = new AbortController();
    const loadCurriculum = async () => {
      try {
        const response = await fetch("/api/curriculum/", { signal: controller.signal });
        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error(
            `GET /api/curriculum/ returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : "."}`,
          );
        }

        const data = await response.json();
        if (
          !Array.isArray(data.sessions) ||
          !Array.isArray(data.talams) ||
          !Array.isArray(data.ragams) ||
          !Array.isArray(data.exercises)
        ) {
          throw new Error("The curriculum API response is missing expected list fields.");
        }
        if (!data.sessions.length || !data.exercises.length) {
          throw new Error(
            "The backend returned an empty curriculum. Check that the database is populated and seed_lessons completed.",
          );
        }

        setSessions(data.sessions);
        setTalams(data.talams);
        setRagams(data.ragams);
        setExercises(data.exercises);
        setSelectedSessionId(String(data.exercises[0].sessionId));
        setSelectedExerciseId(String(data.exercises[0].id));
        setSelectedMelakartaId(String(data.exercises[0].ragamId || ""));
        setCurriculumError("");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setCurriculumError(
          error instanceof Error ? error.message : "Could not load curriculum from the backend API.",
        );
      }
    };

    loadCurriculum();
    return () => controller.abort();
  }, []);

  const sessionExercises = exercises.filter(
    (exercise) => String(exercise.sessionId) === String(selectedSessionId),
  );
  const currentExercise =
    exercises.find((exercise) => String(exercise.id) === String(selectedExerciseId)) ||
    sessionExercises[0] ||
    null;

  async function refreshClassWorkspace(signal) {
    const requests = [apiFetch("/api/music-classes/", { signal })];
    if (user?.role === "teacher" || user?.role === "student") {
      requests.push(apiFetch("/api/homeworks/", { signal }));
    }
    const [classResult, homeworkResult] = await Promise.all(requests);
    if (!Array.isArray(classResult.classes)) {
      throw new Error("The music classes API returned an invalid response.");
    }
    setMusicClassData({
      classes: classResult.classes,
      teachers: classResult.teachers || [],
      students: classResult.students || [],
    });
    setClassHomeworks(homeworkResult?.homeworks || []);
    setSelectedTeachingClassId((current) => (
      classResult.classes.some((item) => String(item.id) === String(current))
        ? current
        : String(classResult.classes[0]?.id || "")
    ));
    setClassWorkspaceError("");
  }

  useEffect(() => {
    if (!dashboardMode || !user) {
      setMusicClassData({ classes: [], teachers: [], students: [] });
      setClassHomeworks([]);
      return undefined;
    }
    const controller = new AbortController();
    refreshClassWorkspace(controller.signal).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setClassWorkspaceError(
        error instanceof Error ? error.message : "Could not load music classes and homework.",
      );
    });
    return () => controller.abort();
  }, [dashboardMode, user?.id, user?.role]);

  useEffect(() => {
    if (selectedRecordingCommentId === null || !commentNavigationRequest) return;
    const target = document.getElementById(
      `recording-comment-${selectedRecordingCommentId}`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    target.focus({ preventScroll: true });
  }, [commentNavigationRequest, selectedRecordingCommentId, recordingComments]);

  useEffect(() => {
    if (
      !dashboardMode ||
      user?.role !== "teacher" ||
      !selectedTeachingClassId
    ) {
      setTeacherClassRecordings([]);
      return undefined;
    }
    const controller = new AbortController();
    apiFetch(`/api/recordings/?class_id=${encodeURIComponent(selectedTeachingClassId)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!Array.isArray(data.recordings)) {
          throw new Error("The class recordings API returned an invalid response.");
        }
        setTeacherClassRecordings(data.recordings);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setClassWorkspaceError(
          error instanceof Error ? error.message : "Could not load student recordings.",
        );
      });
    return () => controller.abort();
  }, [dashboardMode, selectedTeachingClassId, user?.id, user?.role]);
  useEffect(() => {
    const exerciseId = String(currentExercise?.id || "");
    if (dashboardMode || !user || !recordingOwnerKey || !/^\d+$/.test(exerciseId)) {
      setSavedRecordings([]);
      setRecordingArchiveError("");
      return undefined;
    }

    const controller = new AbortController();
    const loadSavedRecordings = async () => {
      try {
        await apiFetch("/api/recordings/claim/", {
          method: "POST",
          headers: { "X-Recording-Owner": recordingOwnerKey },
          body: "{}",
          signal: controller.signal,
        });
        const data = await apiFetch(
          `/api/recordings/?exercise_id=${encodeURIComponent(exerciseId)}`,
          {
            headers: { "X-Recording-Owner": recordingOwnerKey },
            signal: controller.signal,
          },
        );
        if (!Array.isArray(data.recordings)) {
          throw new Error("The recordings API returned an invalid response.");
        }
        setSavedRecordings(data.recordings);
        setRecordingArchiveError("");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setRecordingArchiveError(
          error instanceof Error ? error.message : "Could not load saved recordings.",
        );
      }
    };

    loadSavedRecordings();
    return () => controller.abort();
  }, [currentExercise?.id, dashboardMode, recordingOwnerKey, user?.id]);

  useEffect(() => {
    if (!dashboardMode || !user || !recordingOwnerKey) {
      if (dashboardMode) setSavedRecordings([]);
      return undefined;
    }

    const controller = new AbortController();
    const loadDashboardRecordings = async () => {
      try {
        await apiFetch("/api/recordings/claim/", {
          method: "POST",
          headers: { "X-Recording-Owner": recordingOwnerKey },
          body: "{}",
          signal: controller.signal,
        });
        const data = await apiFetch("/api/recordings/", { signal: controller.signal });
        if (!Array.isArray(data.recordings)) {
          throw new Error("The recordings API returned an invalid response.");
        }
        setSavedRecordings(data.recordings);
        setRecordingArchiveError("");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setRecordingArchiveError(
          error instanceof Error ? error.message : "Could not load your practice dashboard.",
        );
      }
    };

    loadDashboardRecordings();
    return () => controller.abort();
  }, [dashboardMode, recordingOwnerKey, user?.id]);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (recordingUserIdRef.current === nextUserId) return;
    recordingUserIdRef.current = nextUserId;
    if (recordingId === null) return;

    stopPlayback();
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = "";
    setRecordingUrl("");
    setRecordingBlob(null);
    setRecordingId(null);
    setRecordingComments([]);
    setRecordingExerciseId("");
    setRecordingSettings(null);
  }, [user?.id]);
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
  const selectableRagams = currentExercise?.ragamId ? melakartaRagams : ragams;
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
  const exerciseSections = useMemo(
    () => getExerciseSections(currentExercise, selectedRagam),
    [currentExercise, selectedRagam],
  );
  const hasSectionRagams = exerciseSections.some((section) => section.ragamId);
  const canChooseRagam = !hasSectionRagams && (allowRagamChange || !currentExercise?.ragamId);
  const displayRagamName = hasSectionRagams
    ? "Section-specific"
    : selectedRagam
      ? `${selectedRagam.melakartaNumber ? `${selectedRagam.melakartaNumber}. ` : ""}${selectedRagam.name}`
    : currentExercise?.ragamName
    ? `${currentExercise.melakartaNumber ? `${currentExercise.melakartaNumber}. ` : ""}${currentExercise.ragamName}`
    : "—";
  const notes = exerciseSections.flatMap((section) => section.notes);
  const playbackSequence = currentExercise?.playbackSequence || [];
  const swaraIntervals = selectedRagam?.swaraIntervals || currentExercise?.swaraIntervals || null;

  const previousSessionIdRef = useRef(selectedSessionId);

  useEffect(() => {
    const sessionChanged = previousSessionIdRef.current !== selectedSessionId;
    previousSessionIdRef.current = selectedSessionId;

    if (sessionChanged || !allowRagamChange || !currentExercise?.ragamId) {
      setSelectedMelakartaId(resolveSessionRagamId(
        currentExercise,
        selectedSessionId,
        sessionRagamSelections,
      ));
    }
  }, [
    selectedSessionId,
    currentExercise?.id,
    currentExercise?.ragamId,
    allowRagamChange,
    sessionRagamSelections,
  ]);
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
  const isRecordingReplay = playbackSource === "recording" && recordingSettings;
  const activePlaybackBpm =
    isRecordingReplay ? recordingSettings.bpm : bpm;
  const activePlaybackShruthi =
    isRecordingReplay ? recordingSettings.shruthi : shruthi;
  const activePlaybackInstrument =
    isRecordingReplay ? recordingSettings.instrument : instrument;
  const activeNoteVolume =
    isRecordingReplay ? recordingSettings.noteVolume : noteVolume;
  const activePlaybackBeats =
    isRecordingReplay ? recordingSettings.beats : selectedBeats;
  const activeTalamName =
    isRecordingReplay ? recordingSettings.exerciseSnapshot.talamName : currentTalam?.name;
  const activeCyclesPerRow =
    isRecordingReplay ? recordingSettings.cyclesPerRow : cyclesPerRow;
  const activeBeatGroups =
    isRecordingReplay ? recordingSettings.beatGroups : beatGroups;
  const activeBeatNumbers =
    isRecordingReplay ? recordingSettings.beatNumbers : currentTalam?.beatNumbers || [];
  const activeSwaraIntervals =
    isRecordingReplay ? recordingSettings.swaraIntervals : swaraIntervals;
  const activeExercise =
    isRecordingReplay && recordingSettings.exerciseSnapshot
      ? recordingSettings.exerciseSnapshot
      : currentExercise;
  const activeExerciseSections =
    isRecordingReplay && recordingSettings.exerciseSections
      ? recordingSettings.exerciseSections
      : exerciseSections;
  const playbackSchedule = isRecordingReplay
    ? recordingSettings.playbackSchedule
    : buildTableSchedule(
      exerciseSections,
      selectedBeats,
      visibleTables,
      activePlaybackBpm,
      playbackSequence,
      cyclesPerRow,
      true,
      repeatToCompleteTalam,
      completeTalamWithEmptyNotes,
      excludedPartKeys,
    );
  const displaySchedule = isRecordingReplay
    ? recordingSettings.displaySchedule
    : buildTableSchedule(
      exerciseSections,
      selectedBeats,
      visibleTables,
      activePlaybackBpm,
      playbackSequence,
      cyclesPerRow,
      false,
      repeatToCompleteTalam,
      completeTalamWithEmptyNotes,
      excludedPartKeys,
    );
  const totalDuration = isRecordingReplay
    ? recordingSettings.totalDuration
    : playbackSchedule.reduce((total, table) => total + table.duration, 0);

  useEffect(() => {
    if (playbackState !== "counting" || countdown === null) return undefined;

    const timer = window.setTimeout(() => {
      if (countdown === 1) {
        if (startMicrophoneAfterCountdownRef.current) {
          startMicrophoneAfterCountdownRef.current = false;
          beginMicrophoneCapture();
        } else {
          setCountdown(null);
          setPlaybackState("playing");
        }
      } else {
        audioRef.current?.playBell(activePlaybackShruthi);
        setCountdown(countdown === 3 ? 2 : 1);
      }
    }, 60000 / activePlaybackBpm);

    return () => window.clearTimeout(timer);
  }, [playbackState, countdown, activePlaybackBpm, activePlaybackShruthi]);

  useEffect(() => {
    if (playbackState !== "playing") return undefined;

    let previous = performance.now();
    const tick = (now) => {
      const recordedAudio = playbackSource === "recording" ? recordedAudioRef.current : null;
      const nextTime = recordedAudio
        ? recordedAudio.currentTime
        : playbackTimeRef.current + (now - previous) / 1000;
      const recordingEnded = Boolean(recordedAudio?.ended);
      const rangeEnded = recordedAudio
        && playbackRangeEndRef.current !== null
        && nextTime >= playbackRangeEndRef.current;
      previous = now;
      if ((!recordedAudio && nextTime >= totalDuration) || recordingEnded || rangeEnded) {
        if (!rangeEnded && playInLoop && totalDuration > 0) {
          if (recordedAudio) {
            recordedAudio.currentTime = 0;
            recordedAudio.play().catch(() => {
              setRecordingError("The recording could not be restarted for repeat playback.");
              setPlaybackState("stopped");
            });
          }
          const loopedTime = recordingEnded ? 0 : nextTime % totalDuration;
          playbackTimeRef.current = loopedTime;
          setPlaybackTime(loopedTime);
          audioPositionRef.current = null;
          bellPositionRef.current = null;
          animationRef.current = requestAnimationFrame(tick);
          return;
        }
        playbackRangeEndRef.current = null;
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
  }, [playbackState, totalDuration, playInLoop, playbackSource]);

  useEffect(() => {
    const recorder = microphoneRecorderRef.current;
    if (recorder?.state === "recording" && playbackState === "paused") {
      recorder.pause();
    } else if (recorder?.state === "paused" && playbackState === "playing") {
      recorder.resume();
    } else if (recorder && recorder.state !== "inactive" && playbackState === "stopped") {
      recorder.stop();
    }
  }, [playbackState]);

  useEffect(() => {
    const audio = recordedAudioRef.current;
    if (!audio || playbackSource !== "recording") return;
    if (playbackState === "playing") {
      audio.play().catch((error) => {
        setRecordingError(
          error instanceof Error ? `Could not play the recording: ${error.message}` : "Could not play the recording.",
        );
        playbackTimeRef.current = 0;
        setPlaybackTime(0);
        setPlaybackState("stopped");
        setPlaybackSource("instrument");
      });
    } else {
      audio.pause();
    }
  }, [playbackState, playbackSource, recordingUrl]);

  useEffect(() => {
    if (dashboardMode || !recordingExerciseId || recordingExerciseId === String(currentExercise?.id || "")) return;
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = "";
    setRecordingUrl("");
    setRecordingBlob(null);
    setRecordingId(null);
    setRecordingComments([]);
    setRecordingExerciseId("");
    setRecordingSettings(null);
    setRecordingError("");
  }, [currentExercise?.id, dashboardMode, recordingExerciseId]);

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
      activeBeatNumbers,
      activeBeatGroups,
      playbackTime,
      activePlaybackBpm,
    );
    if (!position || !audioRef.current) return;

    if (
      position.beatStart &&
      position.beatGroupStart &&
      !position.noTalam &&
      bellPositionRef.current !== position.beatKey
    ) {
      bellPositionRef.current = position.beatKey;
      audioRef.current.playBell(activePlaybackShruthi);
    }

    if (position.isContinuation) return;

    const positionKey = `${position.tableIndex}-${position.noteIndex}-${activePlaybackShruthi}`;
    if (audioPositionRef.current === positionKey) return;
    audioPositionRef.current = positionKey;
    const volume = 0.18 * (activeNoteVolume / 100);
    const table = playbackSchedule[position.tableIndex];
    const noteSwaraIntervals = table?.noteSwaraIntervals;
    const sourceNoteIndex = table?.repeatToCompleteTalam && noteSwaraIntervals?.length
      ? position.noteIndex % noteSwaraIntervals.length
      : position.noteIndex;
    audioRef.current.playNote(
      position.note,
      activePlaybackShruthi,
      volume,
      noteSwaraIntervals?.[sourceNoteIndex]
        || table?.section?.swaraIntervals
        || activeSwaraIntervals,
      activePlaybackInstrument,
      position.duration,
      0,
    );
  }, [
    playbackState,
    playbackSource,
    playbackTime,
    notes,
    playbackSchedule,
    selectedBeats,
    activeBeatNumbers,
    activeBeatGroups,
    visibleTables,
    activePlaybackBpm,
    activePlaybackShruthi,
    activeSwaraIntervals,
    activePlaybackInstrument,
    activeNoteVolume,
  ]);

  async function playPlayback() {
    if (!currentExercise || totalDuration <= 0) return;
    audioRef.current?.resume?.();
    if (playbackState === "paused") {
      setPlaybackState("playing");
      return;
    }
    setPlaybackSource("instrument");

    startAudioAndCountdown();
  }

  function startAudioAndCountdown(settings = { bpm, shruthi }) {
    startMicrophoneAfterCountdownRef.current = false;
    audioRef.current?.playBell(settings.shruthi);
    setCountdown(3);
    setPlaybackState("counting");
  }

  async function startMicrophoneRecording() {
    if (!currentExercise || playbackState !== "stopped") return;
    const exerciseId = String(currentExercise.id);
    const capturePlaybackSchedule = buildTableSchedule(
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
    const captureDisplaySchedule = buildTableSchedule(
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
    const captureSettings = {
      bpm,
      shruthi,
      shruthiDrone,
      shruthiVolume,
      instrument,
      noteVolume,
      excludedPartKeys: [...excludedPartKeys],
      playbackSchedule: capturePlaybackSchedule,
      displaySchedule: captureDisplaySchedule,
      totalDuration: capturePlaybackSchedule.reduce((total, table) => total + table.duration, 0),
      exerciseTitle: currentExercise.title,
      ragamName: selectedRagam?.name || currentExercise.ragamName,
      beats: selectedBeats,
      cyclesPerRow,
      beatGroups: [...beatGroups],
      beatNumbers: [...(currentTalam?.beatNumbers || [])],
      swaraIntervals,
      exerciseSnapshot: {
        title: currentExercise.title,
        notes: currentExercise.notes,
        lyrics: currentExercise.lyrics,
        talamName: currentTalam?.name || currentExercise.talamName,
        ragamName: selectedRagam?.name || currentExercise.ragamName,
        repeatToCompleteTalam,
        completeTalamWithEmptyNotes,
      },
      exerciseSections: exerciseSections.map((section) => ({
        ...section,
        notes: [...section.notes],
        lyrics: [...section.lyrics],
      })),
    };
    if (captureSettings.totalDuration <= 0) return;
    setMicrophoneStarting(true);
    setRecordingError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(microphoneDeviceId !== "default" && {
            deviceId: { exact: microphoneDeviceId },
          }),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      microphoneStreamRef.current = stream;
      const microphoneTracks = stream.getAudioTracks();
      if (!microphoneTracks.some((track) => track.enabled && track.readyState === "live")) {
        throw new Error("No active microphone audio track was provided by the browser.");
      }
      try {
        setMicrophoneDevices(await getMicrophoneDevices());
        setMicrophoneDeviceError("");
      } catch (error) {
        setMicrophoneDeviceError(
          error instanceof Error ? error.message : "Could not refresh microphone sources.",
        );
      }
      setMicrophoneLevel(0);
      setMicrophoneSignalDetected(false);
      setMicrophoneWaveform(Array(32).fill(0));
      setRecordingError("");
      setPerformanceReport(null);
      setPerformanceAnalysisError("");
      try {
        startMicrophoneMeter(stream);
      } catch (error) {
        stopMicrophoneMeter();
        setRecordingError(
          error instanceof Error
            ? `Microphone recording can continue, but the live signal meter is unavailable: ${error.message}`
            : "Microphone recording can continue, but the live signal meter is unavailable.",
        );
      }
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) microphoneChunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        setRecordingError(
          event.error instanceof Error
            ? `Microphone recording failed: ${event.error.message}`
            : "Microphone recording failed.",
        );
        stopPlayback();
      };
      recorder.onstop = () => {
        const blob = new Blob(microphoneChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        microphoneRecorderRef.current = null;
        stopMicrophoneMeter();
        setMicrophoneRecording(false);
        setMicrophoneLevel(0);
        setMicrophoneSignalDetected(false);
        setMicrophoneWaveform(Array(32).fill(0));
        if (blob.size > 0) {
          if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
          const url = URL.createObjectURL(blob);
          recordingUrlRef.current = url;
          setRecordingBlob(blob);
          setRecordingId(null);
          setPerformanceReport(null);
          setRecordingExerciseId(exerciseId);
          setRecordingSettings(captureSettings);
          setRecordingUrl(url);
        } else {
          setRecordingBlob(null);
          setRecordingId(null);
          setRecordingSettings(null);
          setRecordingError("No microphone audio was captured. Check microphone access and try again.");
        }
      };
      microphoneRecorderRef.current = recorder;
      microphoneChunksRef.current = [];
      setMicrophoneRecording(false);
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = "";
      }
      setRecordingUrl("");
      setRecordingBlob(null);
      setRecordingId(null);
      setRecordingExerciseId(exerciseId);
      setRecordingSettings(captureSettings);
      setPlaybackTime(0);
      playbackTimeRef.current = 0;
      audioRef.current?.resume?.();
      setPlaybackSource("instrument");
      startMicrophoneAfterCountdownRef.current = true;
      setCountdown(3);
      setPlaybackState("counting");
    } catch (error) {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      microphoneRecorderRef.current = null;
      setMicrophoneStarting(false);
      setMicrophoneRecording(false);
      startMicrophoneAfterCountdownRef.current = false;
      stopMicrophoneMeter();
      setRecordingError(
        error instanceof Error ? error.message : "Could not access the microphone.",
      );
    }
  }

  function beginMicrophoneCapture() {
    startMicrophoneAfterCountdownRef.current = false;
    const recorder = microphoneRecorderRef.current;
    if (!recorder) {
      setMicrophoneStarting(false);
      setCountdown(null);
      setRecordingError("The microphone recorder is not ready. Please try again.");
      setPlaybackState("stopped");
      return;
    }

    try {
      microphoneChunksRef.current = [];
      recorder.start(250);
      setMicrophoneRecording(true);
      setMicrophoneStarting(false);
      setCountdown(null);
      setPlaybackState("playing");
    } catch (error) {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      microphoneRecorderRef.current = null;
      stopMicrophoneMeter();
      setMicrophoneRecording(false);
      setMicrophoneStarting(false);
      setMicrophoneLevel(0);
      setMicrophoneSignalDetected(false);
      setCountdown(null);
      setRecordingError(
        error instanceof Error
          ? `Microphone recording failed to start: ${error.message}`
          : "Microphone recording failed to start.",
      );
      setPlaybackState("stopped");
    }
  }

  function startMicrophoneMeter(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported.");
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    microphoneAudioContextRef.current = context;
    microphoneAnalyserRef.current = analyser;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    microphoneSourceRef.current = source;
    microphoneSilentOutputRef.current = silentOutput;

    const samples = new Uint8Array(analyser.fftSize);
    let lastUpdate = 0;
    const measure = (now) => {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        sumSquares += amplitude * amplitude;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      if (now - lastUpdate >= 50) {
        setMicrophoneLevel(Math.min(1, rms * 3));
        setMicrophoneSignalDetected(rms >= 0.008);
        const waveform = [];
        const samplesPerPoint = Math.floor(samples.length / 32);
        for (let point = 0; point < 32; point += 1) {
          const sampleIndex = Math.min(point * samplesPerPoint, samples.length - 1);
          waveform.push((samples[sampleIndex] - 128) / 128);
        }
        setMicrophoneWaveform(waveform);
        lastUpdate = now;
      }
      microphoneMeterFrameRef.current = requestAnimationFrame(measure);
    };

    context.resume().then(() => {
      if (microphoneAudioContextRef.current !== context) return;
      microphoneMeterFrameRef.current = requestAnimationFrame(measure);
    }).catch((error) => {
      if (microphoneAudioContextRef.current !== context) return;
      stopMicrophoneMeter();
      setRecordingError(
        error instanceof Error
          ? `Microphone recording can continue, but the live signal meter could not start: ${error.message}`
          : "Microphone recording can continue, but the live signal meter could not start.",
      );
    });
  }

  function stopMicrophoneMeter() {
    if (microphoneMeterFrameRef.current !== null) {
      cancelAnimationFrame(microphoneMeterFrameRef.current);
      microphoneMeterFrameRef.current = null;
    }
    microphoneSourceRef.current?.disconnect();
    microphoneAnalyserRef.current?.disconnect();
    microphoneSilentOutputRef.current?.disconnect();
    microphoneAnalyserRef.current = null;
    microphoneSourceRef.current = null;
    microphoneSilentOutputRef.current = null;
    const context = microphoneAudioContextRef.current;
    microphoneAudioContextRef.current = null;
    if (context && context.state !== "closed") {
      context.close().catch((error) => {
        console.error("Could not close the microphone signal meter.", error);
      });
    }
  }

  function playRecordingWithNotes() {
    const audio = recordedAudioRef.current;
    if (
      !audio ||
      !recordingUrl ||
      !recordingSettings ||
      (!dashboardMode && recordingExerciseId !== String(currentExercise?.id || "")) ||
      recordingSettings.totalDuration <= 0
    ) return;
    if (playbackState === "paused" && playbackSource === "recording") {
      setPlaybackState("playing");
      return;
    }
    if (playbackState !== "stopped") return;
    setRecordingError("");
    playbackRangeEndRef.current = null;
    setPlaybackSource("recording");
    setPlaybackTime(0);
    playbackTimeRef.current = 0;
    audio.currentTime = 0;
    startAudioAndCountdown(recordingSettings);
  }

  function playSelectedNoteRange() {
    const audio = recordedAudioRef.current;
    const reportNotes = performanceReport?.notes || [];
    const selectedRange = getNoteRange(reportNotes, rangeStartNoteIndex, rangeEndNoteIndex);
    if (
      !audio ||
      !recordingUrl ||
      !recordingSettings ||
      !selectedRange ||
      playbackState !== "stopped"
    ) return;

    setRecordingError("");
    setNoteSelectionTarget("");
    playbackRangeEndRef.current = selectedRange.endTime;
    setPlaybackSource("recording");
    playbackTimeRef.current = selectedRange.startTime;
    setPlaybackTime(selectedRange.startTime);
    audio.currentTime = selectedRange.startTime;
    setPlaybackState("playing");
  }

  function selectPerformanceNote(noteResults) {
    const selection = chooseNoteSelectionCandidate(
      noteResults,
      noteSelectionTarget,
      rangeStartNoteIndex,
      rangeEndNoteIndex,
    );
    if (!selection) return;
    setRangeStartNoteIndex(selection.startIndex);
    setRangeEndNoteIndex(selection.endIndex);
    setNoteSelectionTarget("");
  }

  async function trackCompletedListen() {
    if (!user || user.role === "teacher" || !recordingId || playbackSource !== "recording") return;
    try {
      const result = await apiFetch(`/api/recordings/${recordingId}/listen/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setSavedRecordings((current) => current.map((recording) => (
        String(recording.exerciseId) === String(result.exerciseId)
          ? {
            ...recording,
            listenCount: String(recording.id) === String(result.recordingId)
              ? Math.max(recording.listenCount || 0, result.listenCount)
              : recording.listenCount,
            exerciseListenCount: Math.max(
              recording.exerciseListenCount || 0,
              result.exerciseListenCount,
            ),
          }
          : recording
      )));
    } catch (error) {
      setRecordingArchiveError(
        error instanceof Error ? error.message : "Could not update your listening progress.",
      );
    }
  }

  async function savePracticeRecording() {
    if (
      !recordingBlob ||
      !recordingSettings ||
      recordingId ||
      !user ||
      !recordingOwnerKey ||
      !/^\d+$/.test(recordingExerciseId)
    ) return;

    setRecordingSaveBusy(true);
    setRecordingArchiveError("");
    try {
      const formData = new FormData();
      formData.append("exercise_id", recordingExerciseId);
      formData.append("settings", JSON.stringify(recordingSettings));
      formData.append("audio", recordingBlob, "practice-recording");

      const data = await apiFetch("/api/recordings/", {
        method: "POST",
        headers: { "X-Recording-Owner": recordingOwnerKey },
        body: formData,
      });
      if (!data.recording?.id) {
        throw new Error("The server saved the recording but returned an invalid response.");
      }

      setRecordingId(data.recording.id);
      setSavedRecordings((current) => [
        data.recording,
        ...current.filter((recording) => recording.id !== data.recording.id),
      ]);
    } catch (error) {
      setRecordingArchiveError(
        error instanceof Error ? error.message : "Could not save this practice recording.",
      );
    } finally {
      setRecordingSaveBusy(false);
    }
  }

  async function loadSavedRecording(recording) {
    if (!user || playbackState !== "stopped") return;
    setLoadingRecordingId(recording.id);
    setRecordingArchiveError("");
    setRecordingCommentsError("");
    try {
      const response = await fetch(recording.audioUrl, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const blob = await response.blob();
      if (!blob.size) throw new Error("The saved recording contains no audio data.");
      let comments = [];
      try {
        const data = await apiFetch(`/api/recordings/${recording.id}/comments/`);
        if (!Array.isArray(data.comments)) {
          throw new Error("The recording comments API returned an invalid response.");
        }
        comments = data.comments;
      } catch (error) {
        setRecordingCommentsError(
          error instanceof Error ? error.message : "Could not load teacher comments.",
        );
      }

      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      const url = URL.createObjectURL(blob);
      recordingUrlRef.current = url;
      setRecordingBlob(blob);
      setRecordingId(recording.id);
      setRecordingComments(comments);
      setSelectedRecordingCommentId(null);
      setTeacherRatingDraft(
        recording.teacherRating === null || recording.teacherRating === undefined
          ? ""
          : String(recording.teacherRating),
      );
      setEditingRecordingCommentId(null);
      setRecordingCommentScope("table");
      setRecordingCommentTableIndex("0");
      setRecordingCommentRowIndex("0");
      setRecordingCommentNoteIndex("0");
      setRecordingCommentDraft("");
      setRecordingExerciseId(String(recording.exerciseId));
      setRecordingSettings(recording.settings);
      setPerformanceReport(null);
      setPerformanceAnalysisError("");
      setRangeStartNoteIndex("");
      setRangeEndNoteIndex("");
      setPlaybackSource("recording");
      setRecordingUrl(url);
    } catch (error) {
      setRecordingArchiveError(
        error instanceof Error ? error.message : "Could not load this saved recording.",
      );
    } finally {
      setLoadingRecordingId(null);
    }
  }

  async function addRecordingComment(event) {
    event.preventDefault();
    if (
      user?.role !== "teacher" ||
      recordingId === null ||
      recordingCommentBusy ||
      !recordingCommentDraft.trim()
    ) return;
    setRecordingCommentBusy(true);
    setRecordingCommentsError("");
    try {
      const payload = {
        scope: recordingCommentScope,
        tableIndex: Number(recordingCommentTableIndex),
        comment: recordingCommentDraft.trim(),
      };
      if (recordingCommentScope !== "table") {
        payload.rowIndex = Number(recordingCommentRowIndex);
      }
      if (recordingCommentScope === "note") {
        payload.noteIndex = Number(recordingCommentNoteIndex);
      }
      const result = await apiFetch(`/api/recordings/${recordingId}/comments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setRecordingComments((current) => [...current, result.comment]);
      updateRecordingCommentCount(recordingId, 1);
      setRecordingCommentDraft("");
    } catch (error) {
      setRecordingCommentsError(
        error instanceof Error ? error.message : "Could not save this comment.",
      );
    } finally {
      setRecordingCommentBusy(false);
    }
  }

  async function saveRecordingCommentEdit(event, commentId) {
    event.preventDefault();
    if (recordingCommentBusy || !editingRecordingCommentText.trim()) return;
    setRecordingCommentBusy(true);
    setRecordingCommentsError("");
    try {
      const result = await apiFetch(
        `/api/recordings/${recordingId}/comments/${commentId}/`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: editingRecordingCommentText.trim() }),
        },
      );
      setRecordingComments((current) => current.map((item) => (
        item.id === commentId ? result.comment : item
      )));
      setEditingRecordingCommentId(null);
      setEditingRecordingCommentText("");
    } catch (error) {
      setRecordingCommentsError(
        error instanceof Error ? error.message : "Could not update this comment.",
      );
    } finally {
      setRecordingCommentBusy(false);
    }
  }

  async function deleteRecordingComment(commentId) {
    if (recordingCommentBusy) return;
    if (!window.confirm("Delete this teacher comment? This cannot be undone.")) return;
    setRecordingCommentBusy(true);
    setRecordingCommentsError("");
    try {
      await apiFetch(`/api/recordings/${recordingId}/comments/${commentId}/`, {
        method: "DELETE",
      });
      setRecordingComments((current) => current.filter((item) => item.id !== commentId));
      updateRecordingCommentCount(recordingId, -1);
      setSelectedRecordingCommentId((current) => (
        current === commentId ? null : current
      ));
      if (editingRecordingCommentId === commentId) {
        setEditingRecordingCommentId(null);
        setEditingRecordingCommentText("");
      }
    } catch (error) {
      setRecordingCommentsError(
        error instanceof Error ? error.message : "Could not delete this comment.",
      );
    } finally {
      setRecordingCommentBusy(false);
    }
  }

  function navigateToRecordingComment(commentId) {
    setSelectedRecordingCommentId(commentId);
    setCommentNavigationRequest((current) => current + 1);
  }

  function updateRecordingCommentCount(targetRecordingId, change) {
    const updateCount = (recordings) => recordings.map((recording) => (
      String(recording.id) === String(targetRecordingId)
        ? {
          ...recording,
          teacherCommentCount: Math.max(0, (recording.teacherCommentCount || 0) + change),
        }
        : recording
    ));
    setSavedRecordings(updateCount);
    setTeacherClassRecordings(updateCount);
  }

  async function saveTeacherRating(event) {
    event.preventDefault();
    if (user?.role !== "teacher" || recordingId === null || teacherRatingBusy) return;
    const rating = teacherRatingDraft === "" ? null : Number(teacherRatingDraft);
    if (
      rating !== null &&
      (!Number.isInteger(rating) || rating < 0 || rating > 100)
    ) {
      setRecordingCommentsError("Rating must be a whole-number percentage from 0 to 100.");
      return;
    }

    setTeacherRatingBusy(true);
    setRecordingCommentsError("");
    try {
      const result = await apiFetch(`/api/recordings/${recordingId}/rating/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      setTeacherRatingDraft(
        result.teacherRating === null ? "" : String(result.teacherRating),
      );
      const updateRating = (recordings) => recordings.map((recording) => (
        String(recording.id) === String(recordingId)
          ? { ...recording, teacherRating: result.teacherRating }
          : recording
      ));
      setSavedRecordings(updateRating);
      setTeacherClassRecordings(updateRating);
    } catch (error) {
      setRecordingCommentsError(
        error instanceof Error ? error.message : "Could not save this teacher rating.",
      );
    } finally {
      setTeacherRatingBusy(false);
    }
  }

  async function createMusicClass(event) {
    event.preventDefault();
    if (classActionBusy) return;
    setClassActionBusy(true);
    setClassWorkspaceError("");
    setClassActionMessage("");
    try {
      const result = await apiFetch("/api/music-classes/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(classForm),
      });
      await refreshClassWorkspace();
      setSelectedTeachingClassId(String(result.class.id));
      setClassForm({ name: "", teacherId: "", studentIds: [] });
      setClassActionMessage(`Created ${result.class.name}.`);
    } catch (error) {
      setClassWorkspaceError(
        error instanceof Error ? error.message : "Could not create the music class.",
      );
    } finally {
      setClassActionBusy(false);
    }
  }

  async function createClassHomework(event) {
    event.preventDefault();
    if (classActionBusy || !selectedTeachingClassId) return;
    setClassActionBusy(true);
    setClassWorkspaceError("");
    setClassActionMessage("");
    try {
      await apiFetch("/api/homeworks/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...homeworkForm,
          classId: selectedTeachingClassId,
        }),
      });
      await refreshClassWorkspace();
      setHomeworkForm({ title: "", description: "", dueDate: "" });
      setClassActionMessage("Homework assigned to the class.");
    } catch (error) {
      setClassWorkspaceError(
        error instanceof Error ? error.message : "Could not assign homework.",
      );
    } finally {
      setClassActionBusy(false);
    }
  }

  async function deleteSavedRecording(recording) {
    const confirmed = window.confirm(
      `Delete the recording for "${recording.exerciseTitle}"? Its audio file will also be deleted. This cannot be undone.`,
    );
    if (!confirmed || deletingRecordingId !== null) return;

    setDeletingRecordingId(recording.id);
    setRecordingArchiveError("");
    try {
      await apiFetch(`/api/recordings/${recording.id}/`, { method: "DELETE" });
      setSavedRecordings((current) => current
        .filter((item) => String(item.id) !== String(recording.id))
        .map((item) => (
          String(item.exerciseId) === String(recording.exerciseId)
            ? {
              ...item,
              exerciseListenCount: Math.max(
                0,
                (item.exerciseListenCount || 0) - (recording.listenCount || 0),
              ),
            }
            : item
        )));
      if (String(recordingId) === String(recording.id)) {
        stopPlayback();
        if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = "";
        setRecordingUrl("");
        setRecordingBlob(null);
        setRecordingId(null);
        setRecordingComments([]);
        setRecordingCommentsError("");
        setRecordingExerciseId("");
        setRecordingSettings(null);
        setPerformanceReport(null);
        setPerformanceAnalysisError("");
      }
    } catch (error) {
      setRecordingArchiveError(
        error instanceof Error ? error.message : "Could not delete the saved recording.",
      );
    } finally {
      setDeletingRecordingId(null);
    }
  }

  async function analyzeSelectedRecording() {
    if (!recordingBlob || !recordingSettings || performanceAnalysisBusy) return;
    setPerformanceAnalysisBusy(true);
    setPerformanceAnalysisError("");
    setPerformanceReport(null);
    try {
      const report = await analyzePracticeRecording(recordingBlob, recordingSettings);
      if (!report.notes.length) {
        throw new Error("No expected notes could be read from this recording's exercise snapshot.");
      }
      setPerformanceReport(report);
      const firstIncorrectNote = report.notes.find((note) => note.status === "incorrect");
      const initialRangeStart = firstIncorrectNote?.index ?? report.notes[0].index;
      setRangeStartNoteIndex(String(initialRangeStart));
      setRangeEndNoteIndex(String(initialRangeStart));
    } catch (error) {
      setPerformanceAnalysisError(
        error instanceof Error ? error.message : "Could not analyze the recording.",
      );
    } finally {
      setPerformanceAnalysisBusy(false);
    }
  }

  async function exportLessonVideo(presetKey = exportPresetKey) {
    if (user?.role !== "admin" || exportingVideo || !currentExercise || totalDuration <= 0) return;
    setExportError("");
    setExportProgress(0);
    setExportingVideo(true);
    if (lessonVideoUrlRef.current) {
      URL.revokeObjectURL(lessonVideoUrlRef.current);
      lessonVideoUrlRef.current = null;
    }
    setReadyLessonVideo(null);
    try {
      const encoderSelection = await selectLessonVideoEncoder(presetKey);
      if (!encoderSelection.encoder) {
        setExportError(encoderSelection.message);
        return;
      }
      setExportFormat(encoderSelection.encoder.extension.toUpperCase());

      const target = exerciseCardRef.current?.querySelector(".exercise-card");
      if (!target) {
        setExportError("The lesson display could not be found.");
        return;
      }

      const frames = [];
      const audioEvents = [];
      const volume = 0.18 * (noteVolume / 100);
      for (const table of playbackSchedule) {
        if (table.isExcluded || table.duration <= 0) continue;
        const scheduledNotes = [];
        const rows = table.noTalam
          ? buildSectionRows(table.notes)
          : buildTalamRows(
            table.notes,
            table.beats,
            table.notesPerBeat,
            table.cyclesPerRow,
            table.repeatToCompleteTalam,
            table.completeTalamWithEmptyNotes,
          );
        const secondsPerUnit = 60 / table.bpm / table.notesPerBeat / 4;
        let elapsedUnits = 0;
        let sourceNoteIndex = 0;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          for (let beatIndex = 0; beatIndex < rows[rowIndex].length; beatIndex += 1) {
            const cell = rows[rowIndex][beatIndex];
            for (let noteIndex = 0; noteIndex < cell.length; noteIndex += 1) {
              const note = cell[noteIndex];
              const timestamp = table.tableStartTime + elapsedUnits * secondsPerUnit;
              frames.push({ timestamp, duration: 0 });
              if (noteIndex === 0) {
                const animationTimestamp = timestamp + (60 / table.bpm) * 0.9;
                if (animationTimestamp < table.tableStartTime + table.duration) {
                  frames.push({ timestamp: animationTimestamp, duration: 0 });
                }
                if (!table.noTalam && isBeatGroupStart(beatIndex, table.beats, beatGroups)) {
                  audioEvents.push({ type: "bell", time: timestamp });
                }
              }
              scheduledNotes.push({
                note,
                timestamp,
                secondsPerUnit,
                swaraIntervals: table.noteSwaraIntervals?.[
                  table.repeatToCompleteTalam && table.noteSwaraIntervals.length
                    ? sourceNoteIndex % table.noteSwaraIntervals.length
                    : sourceNoteIndex
                ] || table.section?.swaraIntervals || activeSwaraIntervals,
              });
              sourceNoteIndex += 1;
              elapsedUnits += noteDurationUnits(note);
            }
          }
        }

        for (let index = 0; index < scheduledNotes.length; index += 1) {
          const current = scheduledNotes[index];
          if (current.note.startsWith(";")) continue;
          let duration = noteDurationUnits(current.note) * current.secondsPerUnit;
          for (let nextIndex = index + 1; nextIndex < scheduledNotes.length; nextIndex += 1) {
            const next = scheduledNotes[nextIndex];
            if (!next.note.startsWith(";")) break;
            duration += noteDurationUnits(next.note) * next.secondsPerUnit;
          }
          audioEvents.push({
            type: "note",
            note: current.note,
            time: current.timestamp,
            duration,
            volume,
            swaraIntervals: current.swaraIntervals,
          });
        }
      }

      audioEvents.sort((first, second) => first.time - second.time);
      frames.sort((first, second) => first.timestamp - second.timestamp);
      const uniqueFrames = frames.filter(
        (frame, index) => index === 0 || frame.timestamp > frames[index - 1].timestamp,
      );
      uniqueFrames.forEach((frame, index) => {
        const nextFrame = uniqueFrames[index + 1];
        frame.duration = nextFrame
          ? nextFrame.timestamp - frame.timestamp
          : totalDuration - frame.timestamp;
      });
      if (!uniqueFrames.length || !audioEvents.some((event) => event.type === "note")) {
        setExportError("This lesson has no playable notes to export.");
        return;
      }

      setExportError("");
      const blob = await createLessonVideo({
        duration: totalDuration,
        encoder: encoderSelection.encoder,
        frames: uniqueFrames,
        title: currentExercise.title,
        shruthi,
        swaraIntervals,
        instrument,
        audioEvents,
        renderFrame: async (timestamp) => {
          playbackTimeRef.current = timestamp;
          flushSync(() => setPlaybackTime(timestamp));
          return html2canvas(target, {
            backgroundColor: "#fff8ed",
            logging: false,
            useCORS: true,
            onclone: (clonedDocument) => {
              const activeTable = clonedDocument.querySelector(
                ".exercise-card .note-table-section.table-playing",
              );
              clonedDocument.querySelectorAll(".note-table-section").forEach((table) => {
                if (table !== activeTable) table.remove();
              });
              clonedDocument.querySelectorAll(".exercise-section-title").forEach((heading) => {
                heading.remove();
              });
              clonedDocument.querySelector(".exercise-sections-description")?.remove();
            },
          });
        },
        renderBeatFrame: async () => {
          const beatPanel = exerciseCardRef.current?.querySelector(".beat-image-placeholder");
          if (!beatPanel) throw new Error("The beat animation image could not be found.");
          return html2canvas(beatPanel, {
            backgroundColor: "#fff8ed",
            logging: false,
            useCORS: true,
          });
        },
        onProgress: (progress) => setExportProgress(progress),
      });
      const file = createLessonVideoDownload(
        blob,
        currentExercise.title,
        encoderSelection.encoder.preset,
        encoderSelection.encoder.extension,
      );
      lessonVideoUrlRef.current = file.url;
      setReadyLessonVideo(file);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "The lesson video could not be created.",
      );
    } finally {
      playbackTimeRef.current = 0;
      setPlaybackTime(0);
      setExportingVideo(false);
    }
  }

  function selectExportPreset(presetKey) {
    setExportPresetKey(presetKey);
    if (lessonVideoUrlRef.current) {
      URL.revokeObjectURL(lessonVideoUrlRef.current);
      lessonVideoUrlRef.current = null;
    }
    setReadyLessonVideo(null);
    setExportError("");
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
    playbackRangeEndRef.current = null;
    setMicrophoneStarting(false);
    startMicrophoneAfterCountdownRef.current = false;
    const recorder = microphoneRecorderRef.current;
    if (recorder?.state === "inactive") {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      microphoneRecorderRef.current = null;
      stopMicrophoneMeter();
      setMicrophoneLevel(0);
      setMicrophoneSignalDetected(false);
      setMicrophoneWaveform([]);
    } else if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (playbackSource === "recording" && recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      recordedAudioRef.current.currentTime = 0;
    }
    if (!dashboardMode) setPlaybackSource("instrument");
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

  function excludeAllTables() {
    const partKeys = [...new Set(displaySchedule.map((table) => table.partKey).filter(Boolean))];
    if (!partKeys.length) return;
    stopPlayback();
    setExcludedPartKeys(partKeys);
  }

  function excludeNoTables() {
    stopPlayback();
    setExcludedPartKeys([]);
  }

  const isPlaybackAnimating = playbackState === "playing" || exportingVideo;
  const currentPlaybackPosition = isPlaybackAnimating
    ? getPlaybackNotePosition(
      playbackSchedule,
      activeBeatNumbers,
      activeBeatGroups,
      playbackTime,
      activePlaybackBpm,
    )
    : null;
  const displayedTalamName = currentPlaybackPosition?.noTalam
    ? "No Talam"
    : activeTalamName || currentExercise?.talamName || "No Talam";
  const displayedTalamBeats = currentPlaybackPosition?.noTalam ? 0 : activePlaybackBeats;
  const currentBeatNumber =
    currentPlaybackPosition?.beatNumber !== undefined
      ? Number(currentPlaybackPosition.beatNumber)
      : null;
  const currentBeatCount =
    currentPlaybackPosition?.beatCount !== undefined
      ? Number(currentPlaybackPosition.beatCount)
      : null;
  const currentBeatProgress = isPlaybackAnimating
    ? getPlaybackBeatProgress(playbackSchedule, playbackTime, activePlaybackBpm)
    : 0;
  const currentBeatImageNumber = Number.isFinite(currentBeatNumber) && currentBeatProgress >= 0.9
    ? 9
    : currentBeatNumber;
  const selectedTeachingClass = musicClassData.classes.find(
    (item) => String(item.id) === String(selectedTeachingClassId),
  ) || null;
  const selectedClassHomeworks = classHomeworks.filter(
    (item) => String(item.classId) === String(selectedTeachingClassId),
  );
  const recordingCommentTables = recordingSettings?.displaySchedule || [];
  const recordingCommentRows = getRecordingCommentRows(
    recordingSettings,
    Number(recordingCommentTableIndex),
  );
  const selectedRecordingCommentNotes = (recordingCommentRows[
    Number(recordingCommentRowIndex)
  ] || [])
    .flat()
    .filter((note) => !note.startsWith(";"));

  if (dashboardMode) {
    return (
      <main className="page carnatic-page">
        <nav className="top-nav" aria-label="Main navigation">
          <a href="/">Carnatic notes</a>
          <span aria-current="page">Dashboard</span>
          <AccountMenu />
        </nav>

        <section className="dashboard-header">
          <p className="card-label">YOUR PRACTICE</p>
          <h1>Practice dashboard</h1>
          <p>Review your saved recordings and listening progress.</p>
        </section>

        {recordingArchiveError && (
          <p className="practice-recording-error" role="alert">{recordingArchiveError}</p>
        )}
        {classWorkspaceError && (
          <p className="practice-recording-error" role="alert">{classWorkspaceError}</p>
        )}
        {classActionMessage && (
          <p className="class-action-message" role="status">{classActionMessage}</p>
        )}
        {!user ? (
          <section className="saved-recordings-panel">
            <h2>Sign in to view your dashboard</h2>
            <p className="saved-recordings-empty">
              Your saved recordings and practice progress are available after you sign in.
            </p>
          </section>
        ) : (
          <section className="dashboard-recordings">
            <h2>Saved recordings</h2>
            {savedRecordings.length ? (
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th scope="col">Exercise</th>
                      <th scope="col">Recorded</th>
                      <th scope="col">Settings</th>
                      <th scope="col">Exercise listens</th>
                      <th scope="col">Teacher rating</th>
                      <th scope="col">Teacher comments</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedRecordings.map((recording) => (
                      <tr key={recording.id}>
                        <td>{recording.sessionName} - {recording.exerciseTitle}</td>
                        <td>{new Date(recording.createdAt).toLocaleString()}</td>
                        <td>
                          {recording.settings.bpm} BPM · {getShruthiLabel(recording.settings.shruthi)}
                        </td>
                        <td>{recording.exerciseListenCount ?? 0}</td>
                        <td>
                          {recording.teacherRating === null || recording.teacherRating === undefined
                            ? "Not rated"
                            : `${recording.teacherRating}%`}
                        </td>
                        <td>{recording.teacherCommentCount ?? 0}</td>
                        <td className="dashboard-recording-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => loadSavedRecording(recording)}
                            disabled={
                              playbackState !== "stopped" ||
                              microphoneStarting ||
                              microphoneRecording ||
                              loadingRecordingId !== null ||
                              deletingRecordingId !== null
                            }
                          >
                            {loadingRecordingId === recording.id
                              ? "Loading..."
                              : recordingId === recording.id && recordingUrl
                                ? "Selected"
                                : "Open with notes"}
                          </button>
                          <button
                            type="button"
                            className="secondary dashboard-delete-button"
                            onClick={() => deleteSavedRecording(recording)}
                            disabled={
                              deletingRecordingId !== null ||
                              loadingRecordingId === recording.id ||
                              (performanceAnalysisBusy &&
                                String(recordingId) === String(recording.id)) ||
                              (String(recordingId) === String(recording.id) &&
                                playbackState !== "stopped")
                            }
                          >
                            {deletingRecordingId === recording.id ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !recordingArchiveError && (
                <p className="saved-recordings-empty">You have no saved practice recordings yet.</p>
              )
            )}
          </section>
        )}

        {user?.role === "admin" && (
          <section className="class-workspace">
            <h2>Create a music class</h2>
            <p>Assign one teacher and one or more students. The teacher can then review their class recordings and assign homework.</p>
            {musicClassData.classes.length > 0 && (
              <ul className="music-class-list">
                {musicClassData.classes.map((musicClass) => (
                  <li key={musicClass.id}>
                    <strong>{musicClass.name}</strong>
                    {" · "}{musicClass.teacher.name}
                    {" · "}{musicClass.students.length} student{musicClass.students.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
            <form className="class-workspace-form" onSubmit={createMusicClass}>
              <label>
                Class name
                <input
                  value={classForm.name}
                  onChange={(event) => setClassForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Teacher
                <select
                  value={classForm.teacherId}
                  onChange={(event) => setClassForm((current) => ({
                    ...current,
                    teacherId: event.target.value,
                  }))}
                  required
                >
                  <option value="">Choose a teacher</option>
                  {musicClassData.teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name} ({teacher.email})
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="class-student-picker">
                <legend>Students</legend>
                {musicClassData.students.length ? musicClassData.students.map((student) => (
                  <label key={student.id}>
                    <input
                      type="checkbox"
                      checked={classForm.studentIds.includes(String(student.id))}
                      onChange={(event) => setClassForm((current) => ({
                        ...current,
                        studentIds: event.target.checked
                          ? [...current.studentIds, String(student.id)]
                          : current.studentIds.filter((id) => id !== String(student.id)),
                      }))}
                    />
                    {student.name} ({student.email})
                  </label>
                )) : <p>No student accounts are available.</p>}
              </fieldset>
              <button
                type="submit"
                disabled={
                  classActionBusy ||
                  !musicClassData.teachers.length ||
                  !musicClassData.students.length ||
                  !classForm.studentIds.length
                }
              >
                {classActionBusy ? "Creating…" : "Create class"}
              </button>
            </form>
          </section>
        )}

        {user?.role === "teacher" && (
          <section className="class-workspace">
            <h2>Class workspace</h2>
            {musicClassData.classes.length ? (
              <>
                <label className="class-picker-label">
                  Music class
                  <select
                    value={selectedTeachingClassId}
                    onChange={(event) => setSelectedTeachingClassId(event.target.value)}
                  >
                    {musicClassData.classes.map((musicClass) => (
                      <option key={musicClass.id} value={musicClass.id}>{musicClass.name}</option>
                    ))}
                  </select>
                </label>
                {selectedTeachingClass && (
                  <>
                    <h3>Student recordings · {selectedTeachingClass.name}</h3>
                    {teacherClassRecordings.length ? (
                      <div className="dashboard-table-wrap">
                        <table className="dashboard-table">
                          <thead>
                            <tr>
                              <th scope="col">Student</th>
                              <th scope="col">Exercise</th>
                              <th scope="col">Recorded</th>
                              <th scope="col">Settings</th>
                              <th scope="col">Teacher rating</th>
                              <th scope="col">Comments</th>
                              <th scope="col">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teacherClassRecordings.map((recording) => (
                              <tr key={recording.id}>
                                <td>{recording.studentName}</td>
                                <td>{recording.sessionName} - {recording.exerciseTitle}</td>
                                <td>{new Date(recording.createdAt).toLocaleString()}</td>
                                <td>
                                  {recording.settings.bpm} BPM · {getShruthiLabel(recording.settings.shruthi)}
                                </td>
                                <td>
                                  {recording.teacherRating === null || recording.teacherRating === undefined
                                    ? "Not rated"
                                    : `${recording.teacherRating}%`}
                                </td>
                                <td>{recording.teacherCommentCount ?? 0}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => loadSavedRecording(recording)}
                                    disabled={playbackState !== "stopped" || loadingRecordingId !== null}
                                  >
                                    {loadingRecordingId === recording.id
                                      ? "Loading…"
                                      : String(recordingId) === String(recording.id) && recordingUrl
                                        ? "Opened"
                                        : "Open recording"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="saved-recordings-empty">No student recordings in this class yet.</p>
                    )}
                    <h3>Assign homework</h3>
                    <form className="class-workspace-form" onSubmit={createClassHomework}>
                      <label>
                        Homework title
                        <input
                          value={homeworkForm.title}
                          onChange={(event) => setHomeworkForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))}
                          maxLength={120}
                          required
                        />
                      </label>
                      <label>
                        Instructions or target
                        <textarea
                          value={homeworkForm.description}
                          onChange={(event) => setHomeworkForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))}
                          maxLength={5000}
                          rows={3}
                        />
                      </label>
                      <label>
                        Due date
                        <input
                          type="date"
                          value={homeworkForm.dueDate}
                          onChange={(event) => setHomeworkForm((current) => ({
                            ...current,
                            dueDate: event.target.value,
                          }))}
                        />
                      </label>
                      <button type="submit" disabled={classActionBusy}>
                        {classActionBusy ? "Saving…" : "Assign to class"}
                      </button>
                    </form>
                    <h3>Homework progress</h3>
                    {selectedClassHomeworks.length ? (
                      <div className="class-homework-list">
                        {selectedClassHomeworks.map((homework) => {
                          const completionByStudent = new Map(
                            homework.completions.map((completion) => [
                              String(completion.student.id),
                              completion,
                            ]),
                          );
                          return (
                            <article className="class-homework-card" key={homework.id}>
                              <h4>{homework.title}</h4>
                              {homework.dueDate && <p>Due {homework.dueDate}</p>}
                              {homework.description && <p>{homework.description}</p>}
                              <ul>
                                {selectedTeachingClass.students.map((student) => {
                                  const completion = completionByStudent.get(String(student.id));
                                  return (
                                    <li key={student.id}>
                                      <strong>{student.name}</strong>
                                      {" · "}{completion?.completed ? "Completed" : "Not completed"}
                                      {completion?.note && <span> — {completion.note}</span>}
                                    </li>
                                  );
                                })}
                              </ul>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="saved-recordings-empty">No homework has been assigned to this class.</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="saved-recordings-empty">You have not been assigned to a music class yet.</p>
            )}
          </section>
        )}

        {user?.role === "student" && (
          <section className="class-workspace">
            <h2>Class homework</h2>
            {classHomeworks.length ? (
              <div className="class-homework-list">
                {classHomeworks.map((homework) => (
                  <HomeworkCompletionCard
                    key={homework.id}
                    homework={homework}
                    onSaved={refreshClassWorkspace}
                  />
                ))}
              </div>
            ) : (
              <p className="saved-recordings-empty">
                {musicClassData.classes.length
                  ? "Your teacher has not assigned homework yet."
                  : "You have not been assigned to a music class yet."}
              </p>
            )}
          </section>
        )}

        {recordingUrl && recordingSettings && (
          <section className="dashboard-player" aria-label="Recording playback">
            <div className="practice-recording-heading">
              <div>
                <h2>{recordingSettings.exerciseTitle || "Selected practice recording"}</h2>
                <p className="practice-recording-settings">
                  {recordingSettings.bpm} BPM · Shruthi {getShruthiLabel(recordingSettings.shruthi)}
                  {" · Excluded: "}
                  {recordingSettings.displaySchedule
                    .filter((table) => table.isExcluded)
                    .map((table) => table.section.title || table.partKey)
                    .join(", ") || "none"}
                </p>
              </div>
              <div className="practice-recording-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={analyzeSelectedRecording}
                  disabled={!recordingBlob || performanceAnalysisBusy}
                >
                  {performanceAnalysisBusy ? "Analyzing..." : "Analyze performance"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (playbackState === "playing") pausePlayback();
                    else if (playbackState === "paused" && playbackSource === "recording") {
                      setPlaybackState("playing");
                    } else playRecordingWithNotes();
                  }}
                  disabled={microphoneRecording || (
                    playbackState !== "stopped" &&
                    !(playbackState === "paused" && playbackSource === "recording") &&
                    playbackState !== "playing"
                  )}
                >
                  {playbackState === "playing"
                    ? "Pause"
                    : playbackState === "paused" && playbackSource === "recording"
                      ? "Resume with notes"
                      : "Play with notes"}
                </button>
                {playbackState !== "stopped" && (
                  <button type="button" className="secondary" onClick={stopPlayback}>Stop</button>
                )}
              </div>
            </div>
            <audio
              ref={recordedAudioRef}
              className="practice-recording-audio"
              src={recordingUrl}
              controls
              preload="metadata"
              aria-label="Listen to your practice recording"
              onEnded={trackCompletedListen}
            />
            <section className="recording-comments" aria-label="Teacher comments">
              <div>
                <h3>Teacher comments</h3>
                <p>Comments saved for this recording stay with their table, row, or note.</p>
              </div>
              {user?.role === "teacher" ? (
                <form className="recording-rating-form" onSubmit={saveTeacherRating}>
                  <label>
                    Recording quality (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={teacherRatingDraft}
                      onChange={(event) => setTeacherRatingDraft(event.target.value)}
                      aria-label="Recording quality percentage"
                    />
                  </label>
                  <button type="submit" className="secondary" disabled={teacherRatingBusy}>
                    {teacherRatingBusy ? "Saving…" : "Save rating"}
                  </button>
                  <span>Leave blank and save to remove the rating.</span>
                </form>
              ) : (
                <p className="recording-rating-display">
                  Teacher rating: {teacherRatingDraft === "" ? "Not rated" : `${teacherRatingDraft}%`}
                </p>
              )}
              {recordingCommentsError && (
                <p className="practice-recording-error" role="alert">{recordingCommentsError}</p>
              )}
              {recordingComments.length ? (
                <ol className="recording-comment-list">
                  {recordingComments.map((comment) => (
                    <li
                      id={`recording-comment-${comment.id}`}
                      className={selectedRecordingCommentId === comment.id
                        ? "recording-comment--selected"
                        : ""}
                      key={comment.id}
                      tabIndex={0}
                      aria-current={selectedRecordingCommentId === comment.id ? "true" : undefined}
                      onClick={(event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest("button, input, textarea, select, form, a")
                        ) return;
                        setSelectedRecordingCommentId(comment.id);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.target !== event.currentTarget ||
                          (event.key !== "Enter" && event.key !== " ")
                        ) return;
                        event.preventDefault();
                        setSelectedRecordingCommentId(comment.id);
                      }}
                    >
                      <div className="recording-comment-meta">
                        <strong>{getRecordingCommentLocation(comment, recordingSettings)}</strong>
                        <span>
                          {comment.teacherName} · {new Date(comment.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {editingRecordingCommentId === comment.id ? (
                        <form
                          className="recording-comment-edit-form"
                          onSubmit={(event) => saveRecordingCommentEdit(event, comment.id)}
                        >
                          <label>
                            Edit comment
                            <textarea
                              value={editingRecordingCommentText}
                              onChange={(event) => setEditingRecordingCommentText(event.target.value)}
                              maxLength={2000}
                              rows={3}
                              required
                            />
                          </label>
                          <div>
                            <button type="submit" disabled={recordingCommentBusy}>
                              {recordingCommentBusy ? "Saving…" : "Save comment"}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                setEditingRecordingCommentId(null);
                                setEditingRecordingCommentText("");
                              }}
                              disabled={recordingCommentBusy}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p>{comment.comment}</p>
                      )}
                      {comment.canEdit && editingRecordingCommentId !== comment.id && (
                        <div className="recording-comment-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEditingRecordingCommentId(comment.id);
                              setEditingRecordingCommentText(comment.comment);
                            }}
                            disabled={recordingCommentBusy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary recording-comment-delete"
                            onClick={() => deleteRecordingComment(comment.id)}
                            disabled={recordingCommentBusy}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="saved-recordings-empty">There are no teacher comments on this recording yet.</p>
              )}
              {user?.role === "teacher" && (
                <form className="recording-comment-form" onSubmit={addRecordingComment}>
                  <label>
                    Comment applies to
                    <select
                      value={recordingCommentScope}
                      onChange={(event) => setRecordingCommentScope(event.target.value)}
                    >
                      <option value="table">A whole table</option>
                      <option value="row">A row</option>
                      <option value="note">A note</option>
                    </select>
                  </label>
                  <label>
                    Table
                    <select
                      value={recordingCommentTableIndex}
                      onChange={(event) => {
                        setRecordingCommentTableIndex(event.target.value);
                        setRecordingCommentRowIndex("0");
                        setRecordingCommentNoteIndex("0");
                      }}
                    >
                      {recordingCommentTables.map((table, index) => (
                        <option key={`${table.partKey}-${index}`} value={String(index)}>
                          {getRecordingCommentTableLabel(table, index)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {recordingCommentScope !== "table" && (
                    <label>
                      Row
                      <select
                        value={recordingCommentRowIndex}
                        onChange={(event) => {
                          setRecordingCommentRowIndex(event.target.value);
                          setRecordingCommentNoteIndex("0");
                        }}
                      >
                        {recordingCommentRows.map((_, index) => (
                          <option key={index} value={String(index)}>
                            Row {index + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {recordingCommentScope === "note" && (
                    <label>
                      Note
                      <select
                        value={recordingCommentNoteIndex}
                        onChange={(event) => setRecordingCommentNoteIndex(event.target.value)}
                      >
                        {selectedRecordingCommentNotes.map((note, index) => (
                          <option key={`${note}-${index}`} value={String(index)}>
                            {formatCarnaticNote(note)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="recording-comment-text">
                    Comment for the student
                    <textarea
                      value={recordingCommentDraft}
                      onChange={(event) => setRecordingCommentDraft(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={
                      recordingCommentBusy ||
                      !recordingCommentDraft.trim() ||
                      !recordingCommentTables.length ||
                      (recordingCommentScope !== "table" && !recordingCommentRows.length) ||
                      (recordingCommentScope === "note" && !selectedRecordingCommentNotes.length)
                    }
                  >
                    {recordingCommentBusy ? "Saving…" : "Add comment"}
                  </button>
                </form>
              )}
            </section>
            {performanceAnalysisError && (
              <p className="practice-recording-error" role="alert">{performanceAnalysisError}</p>
            )}
            {performanceReport && (
              <section className="performance-report" aria-label="Performance analysis report">
                <h3>Performance report</h3>
                <p className="performance-report-summary">
                  {performanceReport.summary.accuracy === null
                    ? "No notes could be scored."
                    : `${performanceReport.summary.accuracy}% of analyzed notes were in tune.`}
                  {" "}{performanceReport.summary.correct} correct · {performanceReport.summary.incorrect} need attention
                  {performanceReport.summary.notRecognized > 0
                    ? ` · ${performanceReport.summary.notRecognized} not recognized`
                    : ""}
                  {performanceReport.summary.tooShort > 0
                    ? ` · ${performanceReport.summary.tooShort} too short to analyze`
                    : ""}
                </p>
                <p className="performance-report-note">
                  Notes are compared at the saved exercise timing and shruthi, with a
                  {" "}{performanceReport.summary.toleranceCents}-cent tuning allowance.
                  Matching pitch classes count as correct across octaves.
                  Short notes, accompaniment, room noise, and gamaka can affect pitch detection.
                  {" "}Review the animated notes below: green ticks are in tune; hover over a
                  red cross for the detected pitch and tuning difference. Select a note range to
                  replay that part with the moving notes.
                </p>
                <div className="performance-range-controls">
                  <div className="performance-range-field">
                    <button
                      type="button"
                      className={`secondary performance-table-select ${
                        noteSelectionTarget === "from" ? "performance-table-select--active" : ""
                      }`}
                      aria-pressed={noteSelectionTarget === "from"}
                      onClick={() => setNoteSelectionTarget(
                        noteSelectionTarget === "from" ? "" : "from",
                      )}
                      disabled={playbackState !== "stopped"}
                    >
                      Select From
                    </button>
                    <label htmlFor="performance-range-from">From note</label>
                    <select
                      id="performance-range-from"
                      value={rangeStartNoteIndex}
                      onChange={(event) => {
                        const nextStart = event.target.value;
                        setRangeStartNoteIndex(nextStart);
                        if (Number(rangeEndNoteIndex) < Number(nextStart)) {
                          setRangeEndNoteIndex(nextStart);
                        }
                      }}
                      disabled={playbackState !== "stopped"}
                    >
                      {performanceReport.notes.map((note) => (
                        <option value={String(note.index)} key={`from-${note.index}`}>
                          {note.index + 1}. {note.note} ({formatPlaybackTimestamp(note.startTime)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="performance-range-field">
                    <button
                      type="button"
                      className={`secondary performance-table-select ${
                        noteSelectionTarget === "to" ? "performance-table-select--active" : ""
                      }`}
                      aria-pressed={noteSelectionTarget === "to"}
                      onClick={() => setNoteSelectionTarget(
                        noteSelectionTarget === "to" ? "" : "to",
                      )}
                      disabled={playbackState !== "stopped"}
                    >
                      Select To
                    </button>
                    <label htmlFor="performance-range-to">To note</label>
                    <select
                      id="performance-range-to"
                      value={rangeEndNoteIndex}
                      onChange={(event) => setRangeEndNoteIndex(event.target.value)}
                      disabled={playbackState !== "stopped"}
                    >
                      {performanceReport.notes
                        .filter((note) => note.index >= Number(rangeStartNoteIndex))
                        .map((note) => (
                          <option value={String(note.index)} key={`to-${note.index}`}>
                            {note.index + 1}. {note.note} ({formatPlaybackTimestamp(note.endTime)})
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={playSelectedNoteRange}
                    disabled={playbackState !== "stopped" || !rangeStartNoteIndex || !rangeEndNoteIndex}
                  >
                    Play selected notes
                  </button>
                </div>
                {noteSelectionTarget && (
                  <p className="performance-range-prompt" role="status">
                    Select a note in the animated table to set the {noteSelectionTarget === "from" ? "start" : "end"} of the range.
                  </p>
                )}
              </section>
            )}
            {recordingError && (
              <p className="practice-recording-error" role="alert">{recordingError}</p>
            )}
            {countdown !== null && (
              <div className="count-in" key={countdown} role="status" aria-live="assertive">
                {countdown}
              </div>
            )}
            {recordingSettings.exerciseSnapshot && (
              <Exercise
                exercise={activeExercise}
                sections={activeExerciseSections}
                tableSchedule={displaySchedule}
                beats={activePlaybackBeats}
                cyclesPerRow={activeCyclesPerRow}
                beatGroups={activeBeatGroups}
                beatNumbers={activeBeatNumbers}
                playbackTime={playbackTime}
                bpm={activePlaybackBpm}
                controlsDisabled
                onToggleExclude={toggleExcludePart}
                onExcludeAll={excludeAllTables}
                onExcludeNone={excludeNoTables}
                performanceReport={performanceReport}
                noteSelectionTarget={noteSelectionTarget}
                onSelectPerformanceNote={selectPerformanceNote}
                rangeStartNoteIndex={rangeStartNoteIndex}
                rangeEndNoteIndex={rangeEndNoteIndex}
                recordingComments={recordingComments}
                selectedRecordingCommentId={selectedRecordingCommentId}
                onSelectRecordingComment={navigateToRecordingComment}
              />
            )}
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="page carnatic-page">
      <nav className="top-nav" aria-label="Main navigation">
        <span aria-current="page">Carnatic notes</span>
        <AccountMenu />
      </nav>

      {curriculumError && (
        <p className="curriculum-api-error" role="alert">
          Could not load backend curriculum. Showing built-in sample data instead. {curriculumError}
        </p>
      )}

      <section className="carnatic-controls" aria-label="Curriculum selection">
        <div className="controls-row curriculum-row">
          <label className="curriculum-select">
            <span className="control-label">Session</span>
            <select
              value={selectedSessionId}
              disabled={microphoneStarting || microphoneRecording}
              onChange={(event) => chooseSession(event.target.value)}
            >
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
              disabled={microphoneStarting || microphoneRecording}
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

          <label className={`curriculum-select${!canChooseRagam ? " curriculum-readonly" : ""}`}>
            <span className="control-label">Ragam</span>
            {canChooseRagam ? (
              <select
                value={selectedMelakartaId}
                disabled={microphoneStarting || microphoneRecording}
                onChange={(event) => {
                  stopPlayback();
                  setSelectedMelakartaId(event.target.value);
                  setSessionRagamSelections((current) => ({
                    ...current,
                    [String(selectedSessionId)]: event.target.value,
                  }));
                }}
              >
                <option value="">Select a Ragam</option>
                {!selectableRagams.some((r) => String(r.id) === String(selectedMelakartaId)) && selectedRagam && (
                  <option value={String(selectedRagam.id)}>
                    {selectedRagam.melakartaNumber ? `${selectedRagam.melakartaNumber}. ` : ""}{selectedRagam.name}
                  </option>
                )}
                {selectableRagams.map((ragam) => (
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
            <div className="talam-badge" title={`${displayedTalamName} (${displayedTalamBeats || 0} beats)`}>
              <span className="talam-name">{displayedTalamName}</span>
              <span className="talam-beats">{displayedTalamBeats || 0} beats</span>
            </div>
          </div>

          <label className="curriculum-select bpm-select">
            <span className="control-label">BPM</span>
            <input
              type="number"
              min="20"
              max="300"
              value={bpm}
              disabled={
                microphoneStarting ||
                microphoneRecording ||
                (playbackState === "counting" && startMicrophoneAfterCountdownRef.current)
              }
              onChange={(event) => {
                stopPlayback();
                setBpm(Math.max(20, Math.min(300, Number(event.target.value) || 20)));
              }}
            />
          </label>
        </div>

        <div className="controls-divider" />

        <div className="controls-row audio-row">
          <label className="curriculum-select shruthi-pitch-select">
            <span className="control-label">Shruthi</span>
            <select
              value={shruthi}
              disabled={
                microphoneStarting ||
                microphoneRecording ||
                (playbackState === "counting" && startMicrophoneAfterCountdownRef.current)
              }
              onChange={(event) => setShruthi(event.target.value)}
            >
              {SHRUTHI_OPTIONS.map((group) => (
                <optgroup label={group.label} key={group.label}>
                  {group.notes.map((note) => (
                    <option value={note.value} key={note.value}>{note.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="curriculum-select shruthi-drone-select">
            <span className="control-label">Drone</span>
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
          </label>

          <div className="shruthi-action-group">
            <span className="control-label">Play Shruthi</span>
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
          </div>

          <label className="curriculum-select volume-select shruthi-volume-select">
            <span className="control-label">
              <span>Shruthi Vol</span>
              <span className="slider-value-pill">{shruthiVolume}%</span>
            </span>
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

          <label className="curriculum-select instrument-select">
            <span className="control-label">Instrument</span>
            <select
              value={instrument}
              disabled={microphoneStarting || microphoneRecording}
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

          <label className="curriculum-select volume-select notes-volume-select">
            <span className="control-label">
              <span>Notes Vol</span>
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

          {shruthiError && <span className="shruthi-error">{shruthiError}</span>}
        </div>

        <div className="export-controls-row">
          <div className="recording-source-controls">
            <label className="microphone-source-select">
              <span>Recording source</span>
              <select
                value={microphoneDeviceId}
                onChange={(event) => setMicrophoneDeviceId(event.target.value)}
                disabled={microphoneRecording || playbackState !== "stopped"}
                aria-describedby={microphoneDeviceError ? "microphone-source-status" : undefined}
              >
                <option value="default">Default microphone</option>
                {microphoneDevices
                  .filter((device) => device.deviceId && device.deviceId !== "default")
                  .map((device, index) => (
                    <option value={device.deviceId} key={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
              </select>
              {microphoneDeviceError && (
                <span id="microphone-source-status" className="microphone-source-error" role="status">
                  {microphoneDeviceError}
                </span>
              )}
            </label>
            <button
              type="button"
              className={`record-practice-button${microphoneRecording ? " record-practice-button--recording" : ""}`}
              onClick={microphoneRecording ? stopPlayback : startMicrophoneRecording}
              disabled={
                microphoneStarting ||
                exportingVideo ||
                !currentExercise ||
                totalDuration <= 0 ||
                (!microphoneRecording && playbackState !== "stopped")
              }
              aria-pressed={microphoneRecording}
            >
              <span className="record-practice-indicator" aria-hidden="true" />
              {microphoneStarting
                ? "Starting..."
                : microphoneRecording
                  ? "Stop recording"
                  : "Record"}
            </button>
          </div>
          {user?.role === "admin" && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setExportError("");
                setExportModalOpen(true);
              }}
              disabled={
                exportingVideo ||
                playbackState !== "stopped" ||
                !currentExercise ||
                totalDuration <= 0
              }
            >
              Export Video
            </button>
          )}
        </div>
      </section>

      <div ref={exerciseCardRef} className="exercise-record-area">
        <div
          className={`transport-controls${isPlaying && !controlsVisible ? " transport-controls--auto-hidden" : ""}`}
          role="group"
          aria-label="Exercise playback"
          onMouseEnter={() => {
            setControlsVisible(true);
            if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
          }}
          onMouseLeave={() => {
            if (isPlaying) {
              hideControlsTimeoutRef.current = setTimeout(() => setControlsVisible(false), 2500);
            }
          }}
        >
          <div className="transport-column">
            <button
              type="button"
              onClick={playPlayback}
              disabled={
                playbackState === "playing" ||
                playbackState === "counting" ||
                !currentExercise ||
                totalDuration <= 0 ||
                exportingVideo
              }
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
          <div className="talam-recording-group">
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
            {microphoneRecording && (
              <div
                className={`recording-signal-indicator recording-signal-indicator--recording${microphoneSignalDetected ? " recording-signal-indicator--active" : ""}`}
                role="meter"
                title={`Microphone input ${Math.round(microphoneLevel * 100)}%`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(microphoneLevel * 100)}
                aria-label={
                  microphoneSignalDetected
                    ? "Microphone signal detected"
                    : "No microphone signal detected"
                }
              >
                <span className="recording-signal-r">R</span>
                <svg
                  className="recording-waveform"
                  viewBox="0 0 128 40"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline
                    points={microphoneWaveform
                      .map((level, index) => `${index * 4},${20 - level * 17}`)
                      .join(" ")}
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        {(microphoneRecording ||
          (recordingUrl && recordingExerciseId === String(currentExercise?.id || "")) ||
          recordingError) && (
          <section
            className="practice-recording-panel"
            aria-label="Practice recording"
            aria-live="polite"
          >
            <div className="practice-recording-heading">
              <div>
                <h3>{microphoneRecording ? "Recording your practice" : "Practice recording"}</h3>
                <p>
                  {microphoneRecording
                    ? "The microphone is recording while the exercise plays. Press Stop to finish early."
                    : recordingUrl
                      ? "Listen to your recording or replay it alongside the moving notes."
                      : "Check microphone access, then try recording again."}
                </p>
                {(microphoneRecording || recordingUrl) && recordingSettings && (
                  <p className="practice-recording-settings">
                    {microphoneRecording ? "Recording at" : "Recorded at"} {recordingSettings.bpm} BPM · Shruthi {getShruthiLabel(recordingSettings.shruthi)} · {CARNATIC_INSTRUMENTS.find((option) => option.id === recordingSettings.instrument)?.label || recordingSettings.instrument}
                  </p>
                )}
              </div>
              {recordingUrl && recordingExerciseId === String(currentExercise?.id || "") && (
                <div className="practice-recording-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={playRecordingWithNotes}
                    disabled={
                      microphoneRecording ||
                      (playbackState !== "stopped" &&
                        !(playbackState === "paused" && playbackSource === "recording"))
                    }
                  >
                    {playbackState === "paused" && playbackSource === "recording"
                      ? "Resume with notes"
                      : "Play recording with notes"}
                  </button>
                  {recordingBlob && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={savePracticeRecording}
                      disabled={
                        recordingId !== null ||
                        recordingSaveBusy ||
                        !user ||
                        !recordingOwnerKey ||
                        !/^\d+$/.test(recordingExerciseId) ||
                        recordingExerciseId !== String(currentExercise?.id || "")
                      }
                    >
                      {recordingId !== null
                        ? "Saved on Docker"
                        : recordingSaveBusy
                          ? "Saving..."
                          : "Save recording"}
                    </button>
                  )}
                </div>
              )}
            </div>
            {recordingUrl && recordingExerciseId === String(currentExercise?.id || "") && (
              <audio
                ref={recordedAudioRef}
                className="practice-recording-audio"
                src={recordingUrl}
                controls
                preload="metadata"
                aria-label="Listen to your practice recording"
                onEnded={trackCompletedListen}
              />
            )}
            {recordingError && (
              <p className="practice-recording-error" role="alert">{recordingError}</p>
            )}
          </section>
        )}

        {countdown !== null && (
          <div className="count-in" key={countdown} role="status" aria-live="assertive">
            {countdown}
          </div>
        )}

        {currentExercise ? (
          <Exercise
            exercise={activeExercise}
            sections={activeExerciseSections}
            tableSchedule={displaySchedule}
            beats={activePlaybackBeats}
            cyclesPerRow={activeCyclesPerRow}
            beatGroups={activeBeatGroups}
            beatNumbers={activeBeatNumbers}
            playbackTime={playbackTime}
            bpm={activePlaybackBpm}
            controlsDisabled={microphoneStarting || microphoneRecording}
            onToggleExclude={toggleExcludePart}
            onExcludeAll={excludeAllTables}
            onExcludeNone={excludeNoTables}
          />
        ) : (
          <p className="status">No exercises are assigned to this session yet.</p>
        )}
      </div>

      <footer className="site-contact">
        <div>
          <p className="card-label">SUNAADAM</p>
          <h2>Continue your musical journey</h2>
        </div>
        <div className="site-contact-links">
          <a href="https://sunaadam.balamukundam.com" target="_blank" rel="noreferrer">
            Register at sunaadam.balamukundam.com
          </a>
          <a href="tel:+447930191457">Contact: +447930191457</a>
        </div>
      </footer>

      {user?.role === "admin" && (
        <ExportVideoModal
          isOpen={exportModalOpen}
          selectedPresetKey={exportPresetKey}
          onSelectPreset={selectExportPreset}
          onProcess={exportLessonVideo}
          onCancel={() => {
            if (!exportingVideo) setExportModalOpen(false);
          }}
          isProcessing={exportingVideo}
          progress={{ value: exportProgress, format: exportFormat }}
          error={exportError}
          video={readyLessonVideo}
        />
      )}
    </main>
  );
}

function HomeworkCompletionCard({ homework, onSaved }) {
  const [completed, setCompleted] = useState(homework.completed);
  const [note, setNote] = useState(homework.completionNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCompleted(homework.completed);
    setNote(homework.completionNote || "");
  }, [homework.id, homework.completed, homework.completionNote]);

  async function saveCompletion(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/homeworks/${homework.id}/completion/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed, note }),
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your homework update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="class-homework-card">
      <p className="class-homework-class">{homework.className}</p>
      <h3>{homework.title}</h3>
      {homework.dueDate && <p className="class-homework-due">Due {homework.dueDate}</p>}
      {homework.description && <p>{homework.description}</p>}
      <form className="homework-completion-form" onSubmit={saveCompletion}>
        <label className="homework-completed-toggle">
          <input
            type="checkbox"
            checked={completed}
            onChange={(event) => setCompleted(event.target.checked)}
          />
          I completed this homework
        </label>
        <label>
          Note to your teacher
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
            required={completed}
          />
        </label>
        {error && <p className="practice-recording-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save update"}
        </button>
      </form>
    </article>
  );
}

function getRecordingCommentRows(recordingSettings, tableIndex) {
  const table = recordingSettings?.displaySchedule?.[tableIndex];
  if (!table || table.isExcluded || !Array.isArray(table.notes)) return [];
  if (table.noTalam) return buildSectionRows(table.notes);
  return buildTalamRows(
    table.notes,
    table.beats || recordingSettings.beats,
    table.notesPerBeat || 1,
    table.cyclesPerRow || recordingSettings.cyclesPerRow || 1,
    table.repeatToCompleteTalam ?? recordingSettings.repeatToCompleteTalam ?? true,
    table.completeTalamWithEmptyNotes
      ?? recordingSettings.completeTalamWithEmptyNotes
      ?? false,
  );
}

function getRecordingCommentTableLabel(table, index) {
  const title = table.section?.title || table.partKey || `Table ${index + 1}`;
  return table.noTalam
    ? `${index + 1}. ${title} · No Talam`
    : `${index + 1}. ${title} · ${table.notesPerBeat} note${table.notesPerBeat === 1 ? "" : "s"}/beat`;
}

function getRecordingCommentLocation(comment, recordingSettings) {
  const table = recordingSettings?.displaySchedule?.[comment.tableIndex];
  const tableName = table
    ? getRecordingCommentTableLabel(table, comment.tableIndex)
    : `Table ${comment.tableIndex + 1}`;
  if (comment.scope === "table") return tableName;

  const row = getRecordingCommentRows(recordingSettings, comment.tableIndex)[comment.rowIndex];
  const location = `${tableName} · Row ${comment.rowIndex + 1}`;
  if (comment.scope !== "note" || !row) return location;
  const note = row.flat().filter((item) => !item.startsWith(";"))[comment.noteIndex];
  return note ? `${location} · Note ${formatCarnaticNote(note)}` : location;
}

function getExerciseSections(exercise, selectedRagam = null) {
  if (!exercise) return [];
  if (exercise.sections?.length) {
    const hasSectionRagams = exercise.sections.some((section) => section.ragamId);
    return exercise.sections.map((section) => ({
      ...section,
      description: section.description || "",
      noTalam: Boolean(section.noTalam),
      swaraIntervals: exercise.ragamId
        ? selectedRagam?.swaraIntervals || exercise.swaraIntervals
        : section.ragamId
          ? section.swaraIntervals
          : hasSectionRagams
            ? exercise.swaraIntervals
            : selectedRagam?.swaraIntervals || exercise.swaraIntervals,
      notes: parseCarnaticNotes(section.notes),
      lyrics: parseLyrics(section.lyrics),
    }));
  }
  return [{
    title: "Main",
    description: "",
    noTalam: false,
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
  controlsDisabled,
  onToggleExclude,
  onExcludeAll,
  onExcludeNone,
  performanceReport,
  noteSelectionTarget,
  onSelectPerformanceNote,
  rangeStartNoteIndex,
  rangeEndNoteIndex,
  recordingComments = [],
  selectedRecordingCommentId,
  onSelectRecordingComment,
}) {
  const repeatToCompleteTalam = exercise?.repeatToCompleteTalam ?? true;
  const completeTalamWithEmptyNotes =
    exercise?.completeTalamWithEmptyNotes ??
    exercise?.Complete_Talam_withEmptyNotes ??
    exercise?.complete_talam_with_empty_notes ??
    false;
  const notes = sections.flatMap((section) => section.notes);
  const sectionsWithDescription = sections.filter((section) => Boolean(section.description?.trim()));
  let previousSectionKey = null;
  const tableElements = tableSchedule.map((table, index) => {
    const sectionHeading = table.sectionKey !== previousSectionKey
      ? <h3 className="exercise-section-title" key={`section-${table.sectionKey}`}>
        {table.section.title || `Section ${table.sectionIndex + 1}`}
      </h3>
      : null;
    previousSectionKey = table.sectionKey;
    const noteFeedback = new Map();
    for (const result of performanceReport?.notes || []) {
      if (
        String(result.partKey) !== String(table.partKey) ||
        String(result.sectionIndex) !== String(table.sectionIndex)
      ) continue;
      const results = noteFeedback.get(result.tableNoteIndex) || [];
      results.push(result);
      noteFeedback.set(result.tableNoteIndex, results);
    }
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
          controlsDisabled={controlsDisabled}
          tableStartTime={table.tableStartTime}
          tableDuration={table.duration}
          repeatCount={table.repeatCount || 1}
          repeatToCompleteTalam={table.repeatToCompleteTalam ?? repeatToCompleteTalam}
          completeTalamWithEmptyNotes={table.completeTalamWithEmptyNotes ?? completeTalamWithEmptyNotes}
          noTalam={table.noTalam}
          isExcluded={table.isExcluded}
          partKey={table.partKey}
          onToggleExclude={onToggleExclude}
          noteFeedback={noteFeedback}
          noteSelectionTarget={noteSelectionTarget}
          onSelectPerformanceNote={onSelectPerformanceNote}
          rangeStartNoteIndex={rangeStartNoteIndex}
          rangeEndNoteIndex={rangeEndNoteIndex}
          tableIndex={index}
          recordingComments={recordingComments}
          selectedRecordingCommentId={selectedRecordingCommentId}
          onSelectRecordingComment={onSelectRecordingComment}
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

      {sectionsWithDescription.length > 0 && (
        <div className="exercise-sections-description">
          {sectionsWithDescription.map((sec, index) => (
            <div className="section-description-item" key={sec.id || `sec-desc-${index}`}>
              {(sections.length > 1 || (sec.title && sec.title !== "Main" && sec.title.trim().toLowerCase() !== exercise.title?.trim().toLowerCase())) && (
                <h4 className="section-description-title">{sec.title}</h4>
              )}
              <p className="section-description-text">{sec.description}</p>
            </div>
          ))}
        </div>
      )}

      {tableSchedule.length > 0 && (
        <div className="exclude-bulk-controls" role="group" aria-label="Bulk table exclusion">
          <button
            type="button"
            className="secondary"
            onClick={onExcludeAll}
            disabled={controlsDisabled}
          >
            Exclude all
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onExcludeNone}
            disabled={controlsDisabled}
          >
            Exclude none
          </button>
        </div>
      )}
      <div className="table-list">{tableElements}</div>
    </section>
  );
}

function createLessonVideoDownload(blob, title, preset, format) {
  const safeTitle = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "carnatic-lesson";
  const extension = blob.type === "video/webm" ? "webm" : "mp4";
  return {
    url: URL.createObjectURL(blob),
    filename: `${safeTitle}.${extension}`,
    preset,
    format,
  };
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
      noTalam = false,
      bpm = defaultBpm,
    } = table;
    const rows = noTalam
      ? buildSectionRows(notes)
      : buildTalamRows(
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
      const rawBeatNumber = noTalam ? null :
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
        beatCount: noTalam ? null : (current.beatIndex % beats) + 1,
        duration: (secondsPerBeat / notesPerBeat)
          * current.durationUnits / 4,
        beatStart: !noTalam && current.noteIndexInCell === 0,
        beatGroupStart: !noTalam && isBeatGroupStart(current.beatIndex, beats, beatGroups),
        noTalam,
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
  if (table.noTalam) return 0;
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
  controlsDisabled,
  tableStartTime,
  tableDuration,
  repeatCount,
  repeatToCompleteTalam = true,
  completeTalamWithEmptyNotes = false,
  noTalam = false,
  isExcluded = false,
  partKey,
  onToggleExclude,
  noteFeedback,
  noteSelectionTarget,
  onSelectPerformanceNote,
  rangeStartNoteIndex,
  rangeEndNoteIndex,
  tableIndex,
  recordingComments = [],
  selectedRecordingCommentId,
  onSelectRecordingComment,
}) {
  const rows = noTalam
    ? buildSectionRows(notes)
    : buildTalamRows(
      notes,
      beats,
      notesPerBeat,
      cyclesPerRow,
      repeatToCompleteTalam,
      completeTalamWithEmptyNotes,
    );
  let soundingNoteIndex = 0;
  const noteFeedbackByPosition = rows.map((row) => row.map((cell) => cell.map((note) => {
    if (note.startsWith(";")) return null;
    const feedback = noteFeedback?.get(soundingNoteIndex) || null;
    soundingNoteIndex += 1;
    return feedback;
  })));
  const noteCommentIndexByPosition = rows.map((row) => {
    let commentNoteIndex = 0;
    return row.map((cell) => cell.map((note) => {
      if (note.startsWith(";")) return null;
      const currentIndex = commentNoteIndex;
      commentNoteIndex += 1;
      return currentIndex;
    }));
  });
  const tableComments = recordingComments.filter(
    (comment) => comment.tableIndex === tableIndex,
  );
  const tableLevelComments = tableComments.filter((comment) => comment.scope === "table");
  const rowComments = tableComments.filter((comment) => comment.scope === "row");
  const lyricRows = lyrics.length
    ? noTalam
      ? buildSectionRows(lyrics)
      : buildTalamRows(
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
  const columnGroups = noTalam
    ? Array.from({ length: rows[0]?.length || 0 }, (_, index) => [index])
    : getColumnGroups(beats, cyclesPerRow, beatGroups);
  const columnCount = columnGroups.length;
  const isWideTalam = columnCount >= 12 || beats >= 12;
  const isVeryWideTalam = columnCount >= 15 || beats >= 15;

  useEffect(() => {
    if (!hasPlaybackPosition || !activeCellRef.current) return;
    activeCellRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [hasPlaybackPosition, currentRowIndex, currentBeatIndex]);

  return (
    <section className={`note-table-section ${noTalam ? "no-talam-table" : ""} ${tableIsActive ? "table-playing" : ""} ${isExcluded ? "table-section-excluded" : ""} notes-per-beat-${notesPerBeat} talam-beats-${beats} ${isWideTalam ? "wide-talam" : ""} ${isVeryWideTalam ? "very-wide-talam" : ""}`}>
      <div className="table-title">
        <div className="table-title-meta">
          <h3>{noTalam ? "Notes without Talam" : `${notesPerBeat} note${notesPerBeat > 1 ? "s" : ""} per beat`}</h3>
          <span>{noteTotal} notes · {rows.length} row{rows.length > 1 ? "s" : ""}</span>
          {repeatCount > 1 && (
            <span className="repeat-status">
              {currentRepeat ? `Playing ${ordinal(currentRepeat)} time` : `Repeats ${repeatCount} times`}
            </span>
          )}
        </div>
        {tableLevelComments.length > 0 && (
          <div className="recording-comment-markers">
            {tableLevelComments.map((comment) => (
              <button
                type="button"
                className={`recording-comment-marker ${
                  selectedRecordingCommentId === comment.id ? "recording-comment-marker--active" : ""
                }`}
                key={comment.id}
                aria-pressed={selectedRecordingCommentId === comment.id}
                aria-label={`Show table comment from ${comment.teacherName}`}
                title="Show teacher comment for this table"
                onClick={() => onSelectRecordingComment(comment.id)}
              >
                {COMMENT_MARKER}
              </button>
            ))}
          </div>
        )}
        <label className="exclude-table-toggle" title="Exclude this table from playing">
          <input
            type="checkbox"
            checked={Boolean(isExcluded)}
            disabled={controlsDisabled}
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
        <div className={`table-scroll ${isWideTalam ? "wide-talam-scroll" : ""}`}>
          <table>
            <thead>
              <tr>
                {columnGroups.map((group, groupIndex) => (
                  <th
                    className={[
                      !noTalam && group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
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
                    {noTalam
                      ? `Note ${group[0] + 1}`
                      : <><span className="beat-prefix">Beat </span>{group[0] + 1}{group.length > 1 ? `–${group[group.length - 1] + 1}` : ""}</>}
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
                        !noTalam && group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
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
                            (() => {
                              const commentNoteIndex = noteCommentIndexByPosition[rowIndex]?.[beatIndex]?.[noteIndex];
                              const noteComments = tableComments.filter(
                                (comment) => comment.scope === "note"
                                  && comment.rowIndex === rowIndex
                                  && comment.noteIndex === commentNoteIndex,
                              );
                              const feedback = noteFeedbackByPosition[rowIndex]?.[beatIndex]?.[noteIndex];
                              const canSelectFromTable = Boolean(noteSelectionTarget && feedback?.length);
                              const isSelectedRangeBoundary = feedback?.some((result) => (
                                String(result.index) === String(rangeStartNoteIndex) ||
                                String(result.index) === String(rangeEndNoteIndex)
                              ));
                              const incorrect = feedback?.filter((result) => result.status === "incorrect") || [];
                              const unverifiable = feedback?.filter(
                                (result) => result.status === "notRecognized" || result.status === "tooShort",
                              ) || [];
                              const allCorrect = feedback?.length > 0
                                && feedback.every((result) => result.status === "correct");
                              const indicatorTitle = incorrect.length
                                ? incorrect.map((result) => (
                                  `${result.detectedSwara || "Unmapped swara"}${
                                    result.detectedRegister > 0
                                      ? `, higher octave +${result.detectedRegister}`
                                      : result.detectedRegister < 0
                                        ? `, lower octave ${result.detectedRegister}`
                                        : ""
                                  } played; ${result.semitoneDifference} semitone${
                                    result.semitoneDifference === 1 ? "" : "s"
                                  } ${result.direction} compared with expected ${result.note}.`
                                )).join("\n")
                                : unverifiable.length
                                  ? unverifiable.map((result) => (
                                    result.status === "tooShort"
                                      ? `Could not verify ${result.note}: the note was too short to measure reliably.`
                                      : `Could not verify ${result.note}: no stable pitch was detected.`
                                  )).join("\n")
                                : allCorrect
                                  ? `Correct pitch class. ${feedback
                                    .map((result) => `${result.detectedSwara || note}${
                                      result.detectedRegister > 0
                                        ? `, higher octave +${result.detectedRegister}`
                                        : result.detectedRegister < 0
                                          ? `, lower octave ${result.detectedRegister}`
                                          : ""
                                    } played`)
                                    .join("; ")}.`
                                  : "";
                              return (
                                <span className="swar-comment-group" key={`${note}-${noteIndex}`}>
                                  <span
                                    className={[
                                      "swar",
                                      ...getCarnaticNoteClasses(note),
                                      canSelectFromTable ? "swar-range-selectable" : "",
                                      isSelectedRangeBoundary ? "swar-range-boundary" : "",
                                      hasPlaybackPosition &&
                                      currentRowIndex === rowIndex &&
                                      currentBeatIndex === beatIndex &&
                                      currentNoteIndexInCell === noteIndex
                                        ? "swar-active"
                                        : "",
                                    ].join(" ")}
                                    role={canSelectFromTable ? "button" : undefined}
                                    tabIndex={canSelectFromTable ? 0 : undefined}
                                    aria-label={canSelectFromTable
                                      ? `Select ${note} as the ${noteSelectionTarget === "from" ? "start" : "end"} note`
                                      : undefined}
                                    onClick={canSelectFromTable
                                      ? () => onSelectPerformanceNote(feedback)
                                      : undefined}
                                    onKeyDown={canSelectFromTable
                                      ? (event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          onSelectPerformanceNote(feedback);
                                        }
                                      }
                                      : undefined}
                                  >
                                    {formatCarnaticNote(note)}
                                    {(incorrect.length > 0 || unverifiable.length > 0 || allCorrect) && (
                                      <span
                                        className={`performance-note-indicator ${
                                          incorrect.length
                                            ? "performance-note-indicator--incorrect"
                                            : allCorrect
                                              ? "performance-note-indicator--correct"
                                              : "performance-note-indicator--unverified"
                                        }`}
                                        title={indicatorTitle}
                                        aria-label={indicatorTitle}
                                        tabIndex={0}
                                      >
                                        {incorrect.length || unverifiable.length ? "✕" : "✓"}
                                      </span>
                                    )}
                                  </span>
                                  {noteComments.map((comment) => (
                                    <button
                                      type="button"
                                      className={`recording-comment-marker ${
                                        selectedRecordingCommentId === comment.id
                                          ? "recording-comment-marker--active"
                                          : ""
                                      }`}
                                      key={comment.id}
                                      aria-pressed={selectedRecordingCommentId === comment.id}
                                      aria-label={`Show comment for note ${formatCarnaticNote(note)}`}
                                      title="Show teacher comment for this note"
                                      onClick={() => onSelectRecordingComment(comment.id)}
                                    >
                                      {COMMENT_MARKER}
                                    </button>
                                  ))}
                                </span>
                              );
                            })()
                          ))}
                          {groupIndex === 0 && beatIndex === 0 && rowComments
                            .filter((comment) => comment.rowIndex === rowIndex)
                            .map((comment) => (
                              <span className="recording-row-comment" key={comment.id}>
                                <button
                                  type="button"
                                  className={`recording-comment-marker ${
                                    selectedRecordingCommentId === comment.id
                                      ? "recording-comment-marker--active"
                                      : ""
                                  }`}
                                  aria-pressed={selectedRecordingCommentId === comment.id}
                                  aria-label={`Show comment for row ${rowIndex + 1}`}
                                  title={`Show teacher comment for row ${rowIndex + 1}`}
                                  onClick={() => onSelectRecordingComment(comment.id)}
                                >
                                  {COMMENT_MARKER}
                                </button>
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
                          !noTalam && group.some((index) => beatNumbers[index % beats] === 0) ? "beat-zero" : "",
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
