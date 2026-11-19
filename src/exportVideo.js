import {
  AudioBufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
} from "mediabunny";
import { scheduleNotes } from "./audio";
import { drawStage } from "./drawStage";
import { NOTES, NOTE_SECONDS } from "./notes";

const FRAMES_PER_SECOND = 10;

export async function createScaleVideo(instrument = "veena") {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("This browser cannot export the video.");
  }

  const sampleRate = 48000;
  const duration = NOTES.length * NOTE_SECONDS;
  const offline = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
  scheduleNotes(offline, 0, [offline.destination], instrument);
  const audioBuffer = await offline.startRendering();

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const video = new VideoSampleSource({
    codec: "avc",
    quality: new Quality("high"),
  });
  const audio = new AudioBufferSource({
    codec: "aac",
    quality: new Quality("high"),
  });

  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  output.setMetadataTags({ title: "C major scale" });
  await output.start();

  const frameCount = NOTES.length * NOTE_SECONDS * FRAMES_PER_SECOND;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const elapsed = frame / FRAMES_PER_SECOND;
    const activeIndex = Math.min(NOTES.length - 1, Math.floor(elapsed / NOTE_SECONDS));
    const noteProgress = (elapsed - activeIndex * NOTE_SECONDS) / NOTE_SECONDS;
    drawStage(context, {
      activeIndex,
      noteProgress,
      phase: "playing",
      recording: true,
    });
    context.getImageData(0, 0, 1, 1);

    const bitmap = await createImageBitmap(canvas);
    const sample = new VideoSample(bitmap, {
      timestamp: elapsed,
      duration: 1 / FRAMES_PER_SECOND,
    });
    bitmap.close();
    await video.add(sample, { keyFrame: frame % FRAMES_PER_SECOND === 0 });
    sample.close();
  }

  await audio.add(audioBuffer);
  await output.finalize();

  const encoded = output.target.buffer;
  if (!encoded) {
    throw new Error("The video file could not be created.");
  }

  return new Blob([encoded], { type: "video/mp4" });
}
