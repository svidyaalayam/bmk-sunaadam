import React, { useEffect, useState } from "react";
import { RECORDING_PRESETS } from "./useScreenRecorder";

const STORAGE_KEY = "carnatic_record_preset";

/**
 * RecordQualityModal
 *
 * Prompts the user before recording starts to choose their desired level
 * of accuracy, resolution, and file size (compact or balanced).
 */
export function RecordQualityModal({ isOpen, onConfirm, onCancel }) {
  const [selectedKey, setSelectedKey] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && RECORDING_PRESETS[saved]) return saved;
    } catch {
      // ignore
    }
    return "compact";
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleSelect = (key) => {
    setSelectedKey(key);
  };

  const handleStart = () => {
    try {
      localStorage.setItem(STORAGE_KEY, selectedKey);
    } catch {
      // ignore
    }
    onConfirm?.(selectedKey);
  };

  const presetList = Object.values(RECORDING_PRESETS);

  return (
    <div
      className="modal-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-quality-modal-title"
    >
      <div className="modal-card quality-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 id="record-quality-modal-title" className="modal-title">
              Recording Accuracy & Quality
            </h3>
            <p className="modal-subtitle">
              Select the accuracy level and file size before recording starts.
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Close dialog without starting"
          >
            ✕
          </button>
        </div>

        <div className="quality-options-list" role="radiogroup" aria-label="Recording accuracy levels">
          {presetList.map((preset) => {
            const isSelected = selectedKey === preset.id;
            return (
              <label
                key={preset.id}
                className={`quality-option-card${isSelected ? " quality-option-card--selected" : ""}`}
                onClick={() => handleSelect(preset.id)}
              >
                <div className="quality-option-radio-col">
                  <input
                    type="radio"
                    name="record-quality-preset"
                    value={preset.id}
                    checked={isSelected}
                    onChange={() => handleSelect(preset.id)}
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
            onClick={handleStart}
          >
            Start Recording
          </button>
        </div>
      </div>
    </div>
  );
}
