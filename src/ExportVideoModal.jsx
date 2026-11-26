import React, { useEffect } from "react";
import { RECORDING_PRESETS } from "./useScreenRecorder";

export function ExportVideoModal({
  isOpen,
  selectedPresetKey,
  onSelectPreset,
  onProcess,
  onCancel,
  isProcessing,
  progress,
  error,
  video,
}) {
  useEffect(() => {
    if (!isOpen || isProcessing) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, onCancel]);

  if (!isOpen) return null;

  const presetList = Object.values(RECORDING_PRESETS);
  const handleCancel = () => {
    if (!isProcessing) onCancel?.();
  };

  return (
    <div
      className="modal-backdrop"
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-video-modal-title"
    >
      <div
        className="modal-card export-video-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 id="export-video-modal-title" className="modal-title">
              {video ? "Lesson Video Ready" : "Export Lesson Video"}
            </h3>
            <p className="modal-subtitle">
              {video
                ? "Preview your video, then download it."
                : "Choose the recording quality, then process the lesson video."}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleCancel}
            disabled={isProcessing}
            aria-label="Close export dialog"
          >
            ✕
          </button>
        </div>

        <div className="quality-options-list" role="radiogroup" aria-label="Export quality">
          {presetList.map((preset) => {
            const isSelected = selectedPresetKey === preset.id;
            return (
              <label
                key={preset.id}
                className={`quality-option-card${isSelected ? " quality-option-card--selected" : ""}`}
              >
                <div className="quality-option-radio-col">
                  <input
                    type="radio"
                    name="export-quality-preset"
                    value={preset.id}
                    checked={isSelected}
                    disabled={isProcessing}
                    onChange={() => onSelectPreset(preset.id)}
                  />
                </div>
                <div className="quality-option-info">
                  <div className="quality-option-title-row">
                    <span className="quality-option-label">{preset.label}</span>
                    <span className="modal-badge quality-badge">{preset.badge}</span>
                  </div>
                  <p className="quality-option-accuracy">{preset.accuracy}</p>
                  <p className="quality-option-description">{preset.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        {isProcessing && (
          <div className="export-video-progress" role="status" aria-live="polite">
            <span>
              {progress.format ? `Processing ${progress.format} video` : "Preparing video export"}…
              {" "}{Math.round(progress.value * 100)}%
            </span>
            <progress value={progress.value} max="1" />
          </div>
        )}

        {error && <p className="export-video-error" role="alert">{error}</p>}

        {video && (
          <>
            <div className="modal-preview-container">
              <video
                src={video.url}
                controls
                playsInline
                className="modal-preview-video"
              />
            </div>
            <div className="modal-meta-row">
              <div className="modal-meta-item">
                <span className="modal-meta-label">Quality:</span>
                <span className="modal-badge">{video.preset.label}</span>
              </div>
              <div className="modal-meta-item">
                <span className="modal-meta-label">Format:</span>
                <span className="modal-badge">{video.format.toUpperCase()}</span>
              </div>
            </div>
          </>
        )}

        <div className="modal-actions">
          {!isProcessing && (
            <button type="button" className="modal-btn-cancel" onClick={handleCancel}>
              {video ? "Close" : "Cancel"}
            </button>
          )}
          {video && (
            <a
              className="modal-btn-save export-video-download"
              href={video.url}
              download={video.filename}
            >
              Download Video
            </a>
          )}
          <button
            type="button"
            className="modal-btn-save"
            onClick={() => onProcess(selectedPresetKey)}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing…" : video ? "Process Again" : "Process Video"}
          </button>
        </div>
      </div>
    </div>
  );
}
