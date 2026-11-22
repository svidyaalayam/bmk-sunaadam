/**
 * useScreenRecorder
 *
 * Records specifically the exercise area (with lesson details,
 * beat hand gesture photo/counter, and live animated note highlights)
 * in standard 16:9 YouTube aspect ratio,
 * alongside direct digital audio (notes, bell, and shruthi drone).
 *
 * Supports multiple accuracy / quality levels (from ~1 MB per minute up to High / Ultra),
 * and provides a Save / Cancel dialog workflow instead of auto-downloading.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const ASPECT_16_9 = 16 / 9;

export const RECORDING_PRESETS = {
  compact: {
    id: "compact",
    label: "Compact (~1 MB / min)",
    accuracy: "Low accuracy / Smallest file size",
    description: "Target ~1 MB for 1-minute video · 720p HD · 110 kbps video · 40 kbps audio",
    badge: "~1 MB/min",
    width: 1280,
    height: 720,
    fps: 25,
    videoBitrate: 110000,
    audioBitrate: 40000,
  },
  medium: {
    id: "medium",
    label: "Medium (~3.5 MB / min)",
    accuracy: "Medium accuracy / Balanced quality",
    description: "Target ~3.5 MB for 1-minute video · 720p HD · 450 kbps video · 64 kbps audio",
    badge: "Balanced",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 450000,
    audioBitrate: 64000,
  },
  high: {
    id: "high",
    label: "High (~8 MB / min)",
    accuracy: "High accuracy / Full HD 1080p",
    description: "Target ~8 MB for 1-minute video · 1080p Full HD · 1.0 Mbps video · 128 kbps audio",
    badge: "High Accuracy",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 1000000,
    audioBitrate: 128000,
  },
  ultra: {
    id: "ultra",
    label: "Ultra (~22 MB / min)",
    accuracy: "Maximum accuracy / Studio fidelity",
    description: "Target ~22 MB for 1-minute video · 1080p Full HD · 3.0 Mbps video · 192 kbps audio",
    badge: "Maximum",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 3000000,
    audioBitrate: 192000,
  },
};

export function resolvePreset(presetOrKey) {
  if (typeof presetOrKey === "string" && RECORDING_PRESETS[presetOrKey]) {
    return RECORDING_PRESETS[presetOrKey];
  }
  if (presetOrKey && typeof presetOrKey === "object" && presetOrKey.width && presetOrKey.height) {
    return presetOrKey;
  }
  return RECORDING_PRESETS.compact;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function useScreenRecorder({ targetRef, audioRef, shruthiBoxRef }) {
  const [state, setState] = useState("idle"); // idle | requesting | recording | processing | ready
  const [error, setError] = useState(null);
  const [recordingResult, setRecordingResult] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const displayStreamRef = useRef(null);
  const audioTapRef = useRef(null);
  const cropRafRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const recordingResultRef = useRef(null);
  const activePresetRef = useRef(RECORDING_PRESETS.compact);

  const cleanupStream = useCallback(() => {
    if (cropRafRef.current !== null) {
      cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }

    if (hiddenVideoRef.current) {
      try {
        hiddenVideoRef.current.pause();
        hiddenVideoRef.current.srcObject = null;
        if (hiddenVideoRef.current.parentNode) {
          hiddenVideoRef.current.parentNode.removeChild(hiddenVideoRef.current);
        }
      } catch {
        // ignore
      }
      hiddenVideoRef.current = null;
    }
    canvasRef.current = null;

    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      displayStreamRef.current = null;
    }

    if (audioTapRef.current) {
      try {
        audioTapRef.current.disconnect();
      } catch {
        // ignore
      }
      audioTapRef.current = null;
    }

    mediaRecorderRef.current = null;
  }, []);

  // Revoke object URL on unmount or when discarded
  useEffect(() => {
    return () => {
      cleanupStream();
      if (recordingResultRef.current?.url) {
        try {
          URL.revokeObjectURL(recordingResultRef.current.url);
        } catch {
          // ignore
        }
      }
    };
  }, [cleanupStream]);

  const saveRecording = useCallback((customFilename) => {
    const current = recordingResultRef.current;
    if (!current?.url) return;

    try {
      let filename = (customFilename || current.filename || "sunaadam-recording").trim();
      const ext = current.mimeType?.includes("mp4") ? ".mp4" : ".webm";
      if (!filename.toLowerCase().endsWith(ext)) {
        filename = `${filename.replace(/\.[^/.]+$/, "")}${ext}`;
      }

      const anchor = document.createElement("a");
      anchor.href = current.url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      const urlToRevoke = current.url;
      setTimeout(() => {
        try {
          URL.revokeObjectURL(urlToRevoke);
        } catch {
          // ignore
        }
      }, 10000);
    } catch (err) {
      setError(`Failed to save recording: ${err.message}`);
    } finally {
      recordingResultRef.current = null;
      setRecordingResult(null);
      setState("idle");
    }
  }, []);

  const discardRecording = useCallback(() => {
    if (recordingResultRef.current?.url) {
      try {
        URL.revokeObjectURL(recordingResultRef.current.url);
      } catch {
        // ignore
      }
    }
    recordingResultRef.current = null;
    setRecordingResult(null);
    setState("idle");
  }, []);

  const stop = useCallback(
    (exerciseName = "sunaadam-recording") => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") {
        cleanupStream();
        setState("idle");
        return;
      }

      setState("processing");

      mr.addEventListener(
        "stop",
        () => {
          try {
            const mimeType = mr.mimeType || "video/webm";
            const blob = new Blob(chunksRef.current, { type: mimeType });
            chunksRef.current = [];

            const ext = mimeType.includes("mp4") ? "mp4" : "webm";
            const safeFilename = `${exerciseName.replace(/[^a-z0-9_-]/gi, "_")}.${ext}`;

            const url = URL.createObjectURL(blob);
            const size = blob.size;
            const formattedSize = formatFileSize(size);

            const result = {
              url,
              blob,
              filename: safeFilename,
              size,
              formattedSize,
              mimeType,
              preset: activePresetRef.current,
            };

            recordingResultRef.current = result;
            setRecordingResult(result);
            setState("ready");
          } catch (saveErr) {
            setError(`Could not prepare recording: ${saveErr.message}`);
            setState("idle");
          } finally {
            cleanupStream();
          }
        },
        { once: true },
      );

      try {
        mr.stop();
      } catch {
        cleanupStream();
        setState("idle");
      }
    },
    [cleanupStream],
  );

  const start = useCallback(
    async (exerciseName = "sunaadam-recording", presetOrKey = "compact", onStarted) => {
      // Support (exerciseName, onStarted) signature if 2nd param is function
      let callback = onStarted;
      let chosenPreset = presetOrKey;
      if (typeof presetOrKey === "function") {
        callback = presetOrKey;
        chosenPreset = "compact";
      }

      const preset = resolvePreset(chosenPreset);
      activePresetRef.current = preset;

      const target = targetRef?.current;
      if (!target) {
        setError("Exercise area element not found.");
        return;
      }

      // Clear any previous un-saved recording
      if (recordingResultRef.current?.url) {
        try {
          URL.revokeObjectURL(recordingResultRef.current.url);
        } catch {
          // ignore
        }
        recordingResultRef.current = null;
        setRecordingResult(null);
      }

      setError(null);
      setState("requesting");
      chunksRef.current = [];

      try {
        // 1. Ensure audio contexts are active from user gesture
        await audioRef?.current?.resume?.();
        await shruthiBoxRef?.current?.resume?.();

        // 2. Request tab capture (focused on this tab)
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "browser",
            frameRate: { ideal: preset.fps, max: 60 },
          },
          audio: false, // direct digital audio is piped from Web Audio
          preferCurrentTab: true,
          selfBrowserSurface: "include",
          surfaceSwitching: "exclude",
          systemAudio: "exclude",
        });

        displayStreamRef.current = displayStream;
        const [rawVideoTrack] = displayStream.getVideoTracks();

        if (!rawVideoTrack) {
          throw new Error("No video track received.");
        }

        // 3. Set up DOM-attached video to decode stream frames via GPU
        const hiddenVideo = document.createElement("video");
        hiddenVideo.autoplay = true;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.srcObject = displayStream;

        hiddenVideo.style.position = "fixed";
        hiddenVideo.style.top = "0";
        hiddenVideo.style.left = "0";
        hiddenVideo.style.width = "1px";
        hiddenVideo.style.height = "1px";
        hiddenVideo.style.opacity = "0.001";
        hiddenVideo.style.pointerEvents = "none";
        hiddenVideo.style.zIndex = "-99999";
        document.body.appendChild(hiddenVideo);
        hiddenVideoRef.current = hiddenVideo;

        await hiddenVideo.play().catch(() => {});

        // 4. Set up 16:9 Compositor Canvas matching the chosen preset resolution
        const canvasW = preset.width;
        const canvasH = preset.height;
        const canvas = document.createElement("canvas");
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx2d = canvas.getContext("2d", { alpha: false });
        ctx2d.imageSmoothingEnabled = true;
        ctx2d.imageSmoothingQuality = "high";
        canvasRef.current = canvas;

        // Initialize with warm parchment background
        ctx2d.fillStyle = "#fff8ed";
        ctx2d.fillRect(0, 0, canvasW, canvasH);

        const drawFrame = () => {
          if (!hiddenVideoRef.current || !canvasRef.current) return;
          const vid = hiddenVideoRef.current;

          if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.videoHeight > 0) {
            const availW = document.documentElement.clientWidth || window.innerWidth || 1;
            const availH = document.documentElement.clientHeight || window.innerHeight || 1;
            const cardEl = target.querySelector(".exercise-card") || target;
            const cardRect = cardEl.getBoundingClientRect();
            const transportEl = target.querySelector(".transport-controls");
            const transportRect = transportEl ? transportEl.getBoundingClientRect() : cardRect;

            // Equal, balanced padding on both left and right:
            // Find the exact horizontal center of the exercise card
            const cardCenterX = cardRect.left + cardRect.width / 2;

            // Frame the card with balanced horizontal margins
            let boxW = Math.min(availW, cardRect.width + 72);
            let boxH = boxW / ASPECT_16_9;

            // If box height exceeds viewport height, constrain box to viewport height
            if (boxH > availH) {
              boxH = availH;
              boxW = boxH * ASPECT_16_9;
            }

            // Center the 16:9 box EXACTLY on the card center:
            let boxX = cardCenterX - boxW / 2;
            if (boxX < 0) {
              boxX = 0;
            } else if (boxX + boxW > availW) {
              boxX = availW - boxW;
            }

            // Dynamic Vertical Tracking:
            const topAnchorY = Math.max(0, transportRect.top - 6);
            let boxY = topAnchorY;

            // Track active playing note so notes at the bottom of the screen are ALWAYS in view
            const activeNoteEl = target.querySelector(".swar-active") || target.querySelector(".beat-active");
            if (activeNoteEl) {
              const activeRect = activeNoteEl.getBoundingClientRect();
              const activeCenterY = activeRect.top + activeRect.height / 2;

              if (activeCenterY < topAnchorY + boxH - 50) {
                boxY = topAnchorY;
              } else {
                boxY = activeCenterY - boxH / 2;
              }
            }

            // Clamp boxY within viewport bounds [0, availH - boxH]
            boxY = Math.max(0, Math.min(boxY, availH - boxH));

            const scaleX = vid.videoWidth / availW;
            const scaleY = vid.videoHeight / availH;

            const sx = Math.max(0, boxX * scaleX);
            const sy = Math.max(0, boxY * scaleY);
            const sw = Math.min(vid.videoWidth - sx, boxW * scaleX);
            const sh = Math.min(vid.videoHeight - sy, boxH * scaleY);

            if (sw > 0 && sh > 0) {
              ctx2d.fillStyle = "#fff8ed";
              ctx2d.fillRect(0, 0, canvasW, canvasH);
              ctx2d.drawImage(vid, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
            }
          }

          cropRafRef.current = requestAnimationFrame(drawFrame);
        };

        drawFrame();

        const canvasStream = canvas.captureStream(preset.fps);
        const recordedVideoTrack = canvasStream.getVideoTracks()[0];

        // 5. Connect direct digital Web Audio for pristine sound
        const extraGainNodes = [];
        const shruthiGain = shruthiBoxRef?.current?.getMasterGain?.();
        if (shruthiGain) {
          extraGainNodes.push(shruthiGain);
        }

        const audioTap = audioRef?.current?.createAudioRecordingStream?.(extraGainNodes);
        audioTapRef.current = audioTap;

        const combinedTracks = [recordedVideoTrack];
        if (audioTap?.stream) {
          const audioTracks = audioTap.stream.getAudioTracks();
          if (audioTracks.length > 0) {
            combinedTracks.push(audioTracks[0]);
          }
        }

        const combinedStream = new MediaStream(combinedTracks);

        // 6. Optimal YouTube MIME Type & Bitrate
        const mimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4;codecs=avc1,mp4a.40.2",
          "video/mp4",
          "",
        ];
        const mimeType = mimeTypes.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? "";

        const mr = new MediaRecorder(combinedStream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: preset.videoBitrate,
          audioBitsPerSecond: preset.audioBitrate,
        });
        mediaRecorderRef.current = mr;

        mr.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        rawVideoTrack.addEventListener("ended", () => {
          stop(exerciseName);
        });

        mr.start(250);
        setState("recording");

        callback?.();
      } catch (err) {
        cleanupStream();
        setState("idle");
        if (err.name === "NotAllowedError") {
          setError("Screen sharing was cancelled or denied.");
        } else {
          setError(`Recording could not start: ${err.message}`);
        }
      }
    },
    [targetRef, audioRef, shruthiBoxRef, stop, cleanupStream],
  );

  return {
    start,
    stop,
    state,
    error,
    recordingResult,
    saveRecording,
    discardRecording,
  };
}
