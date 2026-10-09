"use strict";

const path = require("path");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x ?? value.left);
  const y = Number(value.y ?? value.top);
  const width = Number(value.width ?? (Number(value.right) - x));
  const height = Number(value.height ?? (Number(value.bottom) - y));
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function processNameFor(window) {
  return text(window?.process_name || window?.processName || window?.executableName) ||
    (text(window?.path) ? path.basename(window.path) : "");
}

function applicationFor(window, processName, fallback) {
  const explicit = text(window?.application || window?.appName);
  if (explicit) return explicit;
  const withoutExtension = processName.replace(/\.exe$/i, "");
  return withoutExtension || text(window?.title) || fallback || "";
}

function interactionMap(result) {
  const records = Array.isArray(result?.records) ? result.records : [];
  return new Map(
    records
      .map((record) => [positiveInteger(record?.nativeWindowId ?? record?.native_window_id), record])
      .filter(([id]) => id !== null)
  );
}

class WindowsWindowProbeAdapter {
  constructor({ bridge, platform = process.platform, log } = {}) {
    if (!bridge) throw new TypeError("WindowsWindowProbeAdapter requires bridge");
    this.bridge = bridge;
    this.platform = platform;
    this.log = log || bridge.log || { warn() {}, error() {} };
  }

  async listCandidates({ target } = {}) {
    if (this.platform !== "win32") {
      throw new Error("Windows window probe 仅支持 Windows");
    }
    const manager = this.bridge.windowManager;
    if (!manager || typeof manager.getWindows !== "function") {
      throw new Error("Windows window manager 不可用");
    }

    const windows = manager.getWindows();
    const interactionResult = typeof this.bridge.resolveWindowInteractions === "function"
      ? await this.bridge.resolveWindowInteractions()
      : null;
    const interactions = interactionMap(interactionResult);
    const fallbackApplication = text(target?.application);

    return (Array.isArray(windows) ? windows : [])
      .map((window) => {
        const nativeWindowId = positiveInteger(window?.id ?? window?.nativeWindowId ?? window?.native_window_id);
        const processId = positiveInteger(window?.processId ?? window?.process_id);
        if (nativeWindowId === null || processId === null) return null;
        if (window?.isVisible === false || window?.visible === false) return null;

        const processName = processNameFor(window);
        const interaction = interactions.get(nativeWindowId);
        return {
          native_window_id: nativeWindowId,
          process_id: processId,
          process_name: processName,
          application: applicationFor(window, processName, fallbackApplication),
          title: text(window?.title || window?.name),
          // The interaction probe is a safety gate. If it did not positively
          // classify a window, keep it out of pointer execution.
          disposition: interaction?.disposition || "passthrough",
          ...(interaction?.reason ? { reason: interaction.reason } : {}),
          bounds: normalizeBounds(window?.bounds),
          dpi_scale: Number.isFinite(Number(window?.dpiScale)) ? Number(window.dpiScale) : null,
          display_id: window?.displayId ?? window?.display_id ?? null
        };
      })
      .filter(Boolean);
  }
}

module.exports = {
  WindowsWindowProbeAdapter,
  normalizeBounds,
  positiveInteger
};
