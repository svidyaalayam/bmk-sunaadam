import test from "node:test";
import assert from "node:assert/strict";
import { formatFileSize } from "../src/useScreenRecorder.js";

test("formatFileSize formats bytes correctly", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(1024), "1.0 KB");
  assert.equal(formatFileSize(1024 * 500), "500.0 KB");
  assert.equal(formatFileSize(1024 * 1024), "1.00 MB");
  assert.equal(formatFileSize(1024 * 1024 * 1.05), "1.05 MB");
});
