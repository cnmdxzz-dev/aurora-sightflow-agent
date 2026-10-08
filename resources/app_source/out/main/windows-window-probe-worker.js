"use strict";
const koffi = require("koffi");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const koffi__namespace = /* @__PURE__ */ _interopNamespaceDefault(koffi);
function createWindowsWindowProbe(koffi2) {
  const user32 = koffi2.load("user32.dll");
  const dwm = koffi2.load("dwmapi.dll");
  const kernel32 = koffi2.load("kernel32.dll");
  koffi2.proto("int __stdcall ShiflowEnumWindowsProc(uintptr_t hwnd, intptr_t data)");
  const enumerate = user32.func(
    "int __stdcall EnumWindows(ShiflowEnumWindowsProc *callback, intptr_t data)"
  );
  const visible = user32.func("int __stdcall IsWindowVisible(uintptr_t hwnd)");
  const processId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)"
  );
  const style = koffi2.sizeof("void *") === 8 ? user32.func("intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)") : user32.func("int32_t __stdcall GetWindowLongW(uintptr_t hwnd, int index)");
  const cloaked = dwm.func(
    "int32_t __stdcall DwmGetWindowAttribute(uintptr_t hwnd, uint32_t attribute, _Out_ int32_t *value, uint32_t size)"
  );
  const layered = user32.func(
    "int __stdcall GetLayeredWindowAttributes(uintptr_t hwnd, _Out_ uint32_t *key, _Out_ uint8_t *alpha, _Out_ uint32_t *flags)"
  );
  const lastError = kernel32.func("uint32_t __stdcall GetLastError()");
  const clearError = kernel32.func("void __stdcall SetLastError(uint32_t code)");
  return () => {
    const records = [];
    let callbackError;
    clearError(0);
    const success = enumerate((hwnd) => {
      try {
        if (!visible(hwnd)) return 1;
        const pid = [0];
        if (!processId(hwnd, pid) || pid[0] <= 0) return 1;
        clearError(0);
        const extendedStyle = Number(style(hwnd, -20));
        if (extendedStyle === 0 && lastError() !== 0) return 1;
        const cloak = [0];
        if (cloaked(hwnd, 14, cloak, 4) !== 0) cloak[0] = 0;
        const alpha = [255];
        const flags = [0];
        const invisible = (extendedStyle & 524288) !== 0 && layered(hwnd, [0], alpha, flags) !== 0 && (flags[0] & 2) !== 0 && alpha[0] === 0;
        const reason = cloak[0] !== 0 ? "cloaked" : invisible ? "invisible" : (extendedStyle & 32) !== 0 ? "ignores-pointer-events" : void 0;
        const nativeWindowId = Number(hwnd);
        if (Number.isSafeInteger(nativeWindowId) && nativeWindowId > 0) {
          records.push({
            nativeWindowId,
            processId: pid[0],
            disposition: reason ? "passthrough" : "accepts-pointer",
            ...reason ? { reason } : {}
          });
        }
        return 1;
      } catch (error) {
        callbackError = error;
        return 0;
      }
    }, 0);
    if (callbackError) throw callbackError;
    if (!success) throw new Error(`EnumWindows failed (win32=${lastError()})`);
    return records;
  };
}
const port = process.parentPort;
try {
  const probe = createWindowsWindowProbe(koffi__namespace);
  port.on("message", ({ data }) => {
    if (data?.type !== "query" || typeof data.id !== "number") return;
    const startedAt = performance.now();
    try {
      port.postMessage({
        type: "result",
        id: data.id,
        records: probe(),
        queryMs: performance.now() - startedAt
      });
    } catch (error) {
      port.postMessage({
        type: "result",
        id: data.id,
        error: String(error),
        queryMs: performance.now() - startedAt
      });
    }
  });
  port.postMessage({ type: "ready" });
} catch (error) {
  port.postMessage({ type: "fatal", error: String(error) });
}
