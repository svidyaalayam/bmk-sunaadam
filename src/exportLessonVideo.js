import {
  AudioBufferSource,
  BufferTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny";
import { RECORDING_PRESETS } from "./useScreenRecorder";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const OUTRO_DURATION = 5;
const BRAND_IMAGE_URL = "/Sunaadam%20Image.jpg";

const NUMBERED_SWARA_INTERVALS = {
  R1: 1, R2: 2, R3: 3,
  G1: 2, G2: 3, G3: 4,
  M1: 5, M2: 6,
  D1: 8, D2: 9, D3: 10,
  N1: 9, N2: 10, N3: 11,
};
const DEFAULT_SWARA_INTERVALS = { S: 0, R: 2, G: 4, M: 5, P: 7, D: 9, N: 11 };

export async function selectLessonVideoEncoder(presetKey) {
  const preset = RECORDING_PRESETS[presetKey] || RECORDING_PRESETS.compact;
  const videoQuality = new Quality({ bitrate: preset.videoBitrate });
  const audioQuality = new Quality({ bitrate: preset.audioBitrate });
  const encoderErrors = [];
  const candidates = [
    {
      format: new WebMOutputFormat(),
      extension: "webm",
      audioSampleRate: 24000,
      audioCodecs: ["opus"],
      videoCodecs: ["vp8", "vp9", "av1"],
    },
    {
      format: new Mp4OutputFormat(),
      extension: "mp4",
      audioSampleRate: 48000,
      audioCodecs: ["aac"],
      videoCodecs: ["avc", "hevc", "av1"],
    },
  ];

  for (const candidate of candidates) {
    try {
      const videoCodec = await getFirstEncodableVideoCodec(
        candidate.videoCodecs.filter((codec) =>
          candidate.format.getSupportedVideoCodecs().includes(codec),
        ),
        {
          width: preset.width || DEFAULT_WIDTH,
          height: preset.height || DEFAULT_HEIGHT,
          quality: videoQuality,
        },
      );
      if (!videoCodec) continue;

      const audioCodec = await getFirstEncodableAudioCodec(
        candidate.audioCodecs.filter((codec) =>
          candidate.format.getSupportedAudioCodecs().includes(codec),
        ),
        {
          numberOfChannels: 1,
          sampleRate: candidate.audioSampleRate,
          quality: audioQuality,
        },
      );
      if (!audioCodec) continue;

      return {
        encoder: {
          ...candidate,
          videoCodec,
          audioCodec,
          width: preset.width || DEFAULT_WIDTH,
          height: preset.height || DEFAULT_HEIGHT,
          videoQuality,
          audioQuality,
          preset,
        },
        message: "",
      };
    } catch (error) {
      encoderErrors.push(
        error instanceof Error ? error.message : "The encoder could not be configured.",
      );
    }
  }

  return {
    encoder: null,
    message: encoderErrors.length
      ? `Video export is unavailable. Neither WebM/Opus nor MP4/AAC could be configured. ${encoderErrors.join(" ")}`
      : "Video export is unavailable: this browser does not support a compatible WebM/Opus or MP4/AAC encoder.",
  };
}

export async function createLessonVideo({
  duration,
  frames,
  title,
  shruthi,
  swaraIntervals,
  instrument,
  audioEvents,
  encoder,
  renderFrame,
  renderBeatFrame,
  onProgress,
}) {
  if (!(duration > 0) || !frames.length) {
    throw new Error("This lesson has no playable notes to export.");
  }

  const brandImage = await loadBrandImage();
  const videoDuration = duration + OUTRO_DURATION;
  const offlineAudio = new OfflineAudioContext(
    1,
    Math.ceil(encoder.audioSampleRate * videoDuration),
    encoder.audioSampleRate,
  );
  const masterGain = offlineAudio.createGain();
  masterGain.connect(offlineAudio.destination);
  scheduleAudio(offlineAudio, masterGain, audioEvents, shruthi, swaraIntervals, instrument);
  const audioBuffer = await offlineAudio.startRendering();

  const output = new Output({
    format: encoder.format,
    target: new BufferTarget(),
  });
  const video = new VideoSampleSource({
    codec: encoder.videoCodec,
    quality: encoder.videoQuality,
  });
  const audio = new AudioBufferSource({
    codec: encoder.audioCodec,
    quality: encoder.audioQuality,
  });
  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  output.setMetadataTags({ title });
  await output.start();

  const canvas = document.createElement("canvas");
  canvas.width = encoder.width;
  canvas.height = encoder.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot export the video.");
  let lastKeyframeTime = -1;
  const exportFrames = [
    ...frames,
    { timestamp: duration, duration: OUTRO_DURATION, type: "outro" },
  ];

  for (let frameIndex = 0; frameIndex < exportFrames.length; frameIndex += 1) {
    const frame = exportFrames[frameIndex];
    if (frame.type === "outro") {
      drawOutroSlide(context, brandImage);
    } else {
      const frameCanvas = await renderFrame(frame.timestamp);
      const beatCanvas = await renderBeatFrame(frame.timestamp);
      context.fillStyle = "#fff8ed";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const beatPanelWidth = canvas.width * (220 / DEFAULT_WIDTH);
      const contentWidth = canvas.width - beatPanelWidth;
      const scale = Math.min(contentWidth / frameCanvas.width, canvas.height / frameCanvas.height);
      const drawWidth = frameCanvas.width * scale;
      const drawHeight = frameCanvas.height * scale;
      context.drawImage(
        frameCanvas,
        (contentWidth - drawWidth) / 2,
        (canvas.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      const beatAreaWidth = canvas.width * (190 / DEFAULT_WIDTH);
      const beatAreaHeight = canvas.height * (140 / DEFAULT_HEIGHT);
      const beatScale = Math.min(beatAreaWidth / beatCanvas.width, beatAreaHeight / beatCanvas.height);
      const beatWidth = beatCanvas.width * beatScale;
      const beatHeight = beatCanvas.height * beatScale;
      context.drawImage(
        beatCanvas,
        contentWidth + (beatPanelWidth - beatWidth) / 2,
        (canvas.height - beatHeight) / 2,
        beatWidth,
        beatHeight,
      );
    }

    const bitmap = await createImageBitmap(canvas);
    const sample = new VideoSample(bitmap, {
      timestamp: frame.timestamp,
      duration: frame.duration,
    });
    bitmap.close();
    const keyFrame =
      frame.type === "outro" ||
      lastKeyframeTime < 0 ||
      frame.timestamp - lastKeyframeTime >= 1;
    await video.add(sample, { keyFrame });
    if (keyFrame) lastKeyframeTime = frame.timestamp;
    sample.close();
    onProgress?.((frameIndex + 1) / exportFrames.length);
  }

  await audio.add(audioBuffer);
  await output.finalize();

  const encoded = output.target.buffer;
  if (!encoded) throw new Error("The video file could not be created.");
  return new Blob([encoded], {
    type: encoder.extension === "webm" ? "video/webm" : "video/mp4",
  });
}

async function loadBrandImage() {
  const image = new Image();
  image.src = BRAND_IMAGE_URL;
  try {
    await image.decode();
  } catch {
    throw new Error("The Sunaadam closing-slide image could not be loaded.");
  }
  return image;
}

function drawOutroSlide(context, image) {
  const { width, height } = context.canvas;
  context.fillStyle = "#fff8ed";
  context.fillRect(0, 0, width, height);

  const margin = width * 0.045;
  const imageAreaWidth = width * 0.66;
  const imageAreaHeight = height * 0.88;
  const imageScale = Math.min(
    imageAreaWidth / image.naturalWidth,
    imageAreaHeight / image.naturalHeight,
  );
  const imageWidth = image.naturalWidth * imageScale;
  const imageHeight = image.naturalHeight * imageScale;
  context.drawImage(
    image,
    margin + (imageAreaWidth - imageWidth) / 2,
    (height - imageHeight) / 2,
    imageWidth,
    imageHeight,
  );

  const textX = margin + imageAreaWidth + margin;
  const textWidth = width - textX - margin;
  context.fillStyle = "#1c1612";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.font = `600 ${Math.round(height * 0.052)}px Georgia, "Times New Roman", serif`;
  context.fillText("Learn and enjoy", textX, height * 0.34, textWidth);

  context.fillStyle = "#7a6a58";
  context.font = `500 ${Math.round(height * 0.032)}px Arial, sans-serif`;
  context.fillText("Register at", textX, height * 0.47, textWidth);
  context.fillStyle = "#c4552a";
  context.font = `600 ${Math.round(height * 0.033)}px Arial, sans-serif`;
  context.fillText("sunaadam.balamukundam.com", textX, height * 0.53, textWidth);

  context.fillStyle = "#7a6a58";
  context.font = `500 ${Math.round(height * 0.032)}px Arial, sans-serif`;
  context.fillText("Contact", textX, height * 0.64, textWidth);
  context.fillStyle = "#1c1612";
  context.font = `600 ${Math.round(height * 0.042)}px Arial, sans-serif`;
  context.fillText("+447930191457", textX, height * 0.70, textWidth);
}

function scheduleAudio(context, output, events, shruthi, swaraIntervals, instrument) {
  const shruthiFrequency = getShruthiFrequency(shruthi);
  for (const event of events) {
    if (event.type === "bell") {
      scheduleBell(context, output, shruthiFrequency, event.time);
      continue;
    }

    const match = event.note.match(/^([SRGMPDN])([123])?([*_]*)([+-])?([*_]*)$/);
    if (!match) continue;
    const [, swara, number, , octaveMark] = match;
    const interval = number
      ? NUMBERED_SWARA_INTERVALS[`${swara}${number}`]
      : Number((event.swaraIntervals || swaraIntervals || DEFAULT_SWARA_INTERVALS)[swara]);
    if (!Number.isFinite(interval)) continue;

    const octaveOffset = octaveMark === "+" ? 12 : octaveMark === "-" ? -12 : 0;
    const frequency = shruthiFrequency * 2 ** ((interval + octaveOffset) / 12);
    scheduleNote(context, output, frequency, event.time, event.duration, event.volume, instrument);
  }
}

function scheduleNote(context, output, frequency, start, duration, volume, instrument) {
  const isSustained = ["flute", "violin", "nadaswaram"].includes(instrument);
  const end = start + Math.max(duration, isSustained ? 0.2 : 0.12);
  const attack = isSustained ? Math.min(0.06, (end - start) * 0.25) : 0.015;
  const release = isSustained ? Math.min(0.1, (end - start) * 0.3) : 0.06;
  const releaseStart = Math.max(start + attack, end - release);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  const peakVolume = Math.max(volume, 0.0001);
  gain.gain.exponentialRampToValueAtTime(peakVolume, start + attack);
  gain.gain.setValueAtTime(peakVolume, releaseStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(output);

  const addOscillator = (type, multiplier, level = 1) => {
    const oscillator = context.createOscillator();
    const overtoneGain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency * multiplier, start);
    overtoneGain.gain.value = level;
    oscillator.connect(overtoneGain);
    overtoneGain.connect(gain);
    oscillator.start(start);
    oscillator.stop(end);
  };

  if (instrument === "flute") {
    addOscillator("sine", 1);
    addOscillator("triangle", 2, 0.12);
  } else if (instrument === "violin") {
    addOscillator("sawtooth", 1, 0.35);
    addOscillator("triangle", 1.01, 0.7);
  } else if (instrument === "nadaswaram") {
    addOscillator("sawtooth", 1, 0.55);
    addOscillator("square", 2, 0.2);
    addOscillator("sine", 3, 0.1);
  } else if (instrument === "piano") {
    addOscillator("triangle", 1);
    addOscillator("sine", 2, 0.18);
  } else {
    addOscillator("triangle", 1);
    addOscillator("sawtooth", 2, 0.14);
    addOscillator("sine", 3, 0.07);
  }
}

function scheduleBell(context, output, fundamental, start) {
  const end = start + 0.42;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.14, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(output);

  [1, 2.01, 2.99].forEach((partial, index) => {
    const oscillator = context.createOscillator();
    const partialGain = context.createGain();
    oscillator.type = index === 0 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(fundamental * partial, start);
    partialGain.gain.value = index === 0 ? 1 : index === 1 ? 0.35 : 0.16;
    oscillator.connect(partialGain);
    partialGain.connect(gain);
    oscillator.start(start);
    oscillator.stop(end);
  });
}

function getShruthiFrequency(shruthi) {
  const chromaticNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, octave, noteName] = shruthi.match(/^(lower|normal|higher)-(.+)$/) || [];
  const noteIndex = chromaticNotes.indexOf(noteName);
  if (noteIndex < 0) return 392;
  const octaveOffset = octave === "lower" ? -1 : octave === "higher" ? 1 : 0;
  return 261.63 * 2 ** ((noteIndex + octaveOffset * 12) / 12);
}
