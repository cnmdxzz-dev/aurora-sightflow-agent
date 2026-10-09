"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { TargetResolver } = require("../resources/app_source/out/main/target-resolver");
const { createProductionTargetResolver } = require("../resources/app_source/out/main/resolver");
const { WindowsUiAutomationAdapter } = require("../resources/app_source/out/main/resolver/uia-adapter");
const { WindowsWindowProbeAdapter } = require("../resources/app_source/out/main/resolver/window-probe-adapter");

const request = {
  schema_version: "aurora.target/1.0",
  request_id: "request-1",
  execution_id: "execution-1",
  device_id: "device-1",
  target: {
    application: "Notepad",
    selector_profile: "generic-desktop-v1",
    input_selector: "editor",
    window_selector: { title_pattern: "Notepad" }
  },
  ttl_ms: 30_000
};

test("window probe adapter combines native windows with interaction evidence", async () => {
  const adapter = new WindowsWindowProbeAdapter({
    platform: "win32",
    bridge: {
      windowManager: {
        getWindows() {
          return [{
            id: 123,
            processId: 456,
            path: "C:\\Windows\\System32\\notepad.exe",
            title: "Notepad",
            bounds: { x: 10, y: 20, width: 800, height: 600 },
            isVisible: true
          }];
        }
      },
      async resolveWindowInteractions() {
        return { success: true, records: [{ nativeWindowId: 123, processId: 456, disposition: "accepts-pointer" }] };
      }
    }
  });
  const candidates = await adapter.listCandidates({ target: request.target });
  assert.deepEqual(candidates[0], {
    native_window_id: 123,
    process_id: 456,
    process_name: "notepad.exe",
    application: "notepad",
    title: "Notepad",
    disposition: "accepts-pointer",
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    dpi_scale: null,
    display_id: null
  });
});

test("UIA adapter returns a verified target from one candidate", async () => {
  const adapter = new WindowsUiAutomationAdapter({
    platform: "win32",
    query: async () => ({
      ok: true,
      candidates: [{
        bounds: { x: 100, y: 200, width: 300, height: 40 },
        automation_id: "editor",
        control_type: "ControlType.Edit"
      }]
    })
  });
  const result = await adapter.resolveTarget({ window: { native_window_id: 123 }, target: request.target });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.deepEqual(result.target.bounds, { x: 100, y: 200, width: 300, height: 40 });
});

test("production resolver factory wires window probe and UIA adapters", async () => {
  const resolver = createProductionTargetResolver({
    platform: "win32",
    bridge: {
      windowManager: {
        getWindows() {
          return [{ id: 123, processId: 456, path: "notepad.exe", title: "Notepad", bounds: { x: 0, y: 0, width: 800, height: 600 } }];
        }
      },
      async resolveWindowInteractions() { return { records: [] }; }
    }
  });
  assert.equal(resolver instanceof TargetResolver, true);
  assert.equal(typeof resolver.windowProbe.listCandidates, "function");
  assert.equal(typeof resolver.uiaResolver.resolveTarget, "function");
});
