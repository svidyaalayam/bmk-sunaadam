import React, { useEffect, useState } from "react";

/**
 * SaveVideoModal
 *
 * Displays a preview and confirmation dialog after a screen recording finishes.
 * Allows the user to watch the recorded video with direct sound, check the file size,
 * edit the filename, and click "Save Video" to download or "Cancel" to discard.
 */
export function SaveVideoModal({ recording, onSave, onCancel }) {
  if (!recording) return null;

  const [filename, setFilename] = useState(recording.filename || "sunaadam-recording.webm");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSave = () => {
    onSave?.(filename);
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-video-modal-title"
    >
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 id="save-video-modal-title" className="modal-title">
              Recording Complete
            </h3>
            <p className="modal-subtitle">
              Review your recorded lesson video before saving or downloading.
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Close dialog without saving"
          >
            ✕
          </button>
        </div>

        <div className="modal-preview-container">
          <video
            src={recording.url}
            controls
            playsInline
            className="modal-preview-video"
          />
        </div>

        <div className="modal-meta-row">
          <div className="modal-meta-item">
            <span className="modal-meta-label">File size:</span>
            <span className="modal-badge">{recording.formattedSize}</span>
          </div>
          <div className="modal-meta-item">
            <span className="modal-meta-label">Accuracy:</span>
            <span className="modal-badge">
              {recording.preset?.label || "16:9 HD"}
            </span>
          </div>
        </div>

        <div className="modal-filename-group">
          <label htmlFor="save-video-filename" className="modal-meta-label">
            File name:
          </label>
          <input
            id="save-video-filename"
            type="text"
            className="modal-filename-input"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn-save"
            onClick={handleSave}
          >
            Save Video
          </button>
        </div>
      </div>
    </div>
  );
}
