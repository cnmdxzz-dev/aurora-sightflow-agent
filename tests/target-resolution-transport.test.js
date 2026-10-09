"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AuroraTransport } = require("../resources/app_source/out/main/aurora-transport");
const { TARGET_SCHEMA_VERSION } = require("../resources/app_source/out/main/target-contract");

function makeTransport(sent, targetResolver) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-target-transport-"));
  const transport = new AuroraTransport({
    bridge: {
      paths: { userData },
      log: { info() {}, warn() {}, error() {} }
    },
    identity: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      bot_id: "bot-1",
      device_id: "device-1"
    },
    targetResolver
  });
  transport.socket = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  return { transport, userData };
}

test("task.assign target_resolution calls resolver and returns task.result", async () => {
  const sent = [];
  const calls = [];
  const { transport, userData } = makeTransport(sent, {
    async resolve(request) {
      calls.push(request);
      return {
        ok: true,
        status: "resolved",
        request_id: request.request_id,
        execution_id: request.execution_id,
        device_id: request.device_id,
        resolution_id: "resolution-1",
        target_verified: true,
        recipient_verified: true,
        window: { native_window_id: 123 },
        target: { bounds: { x: 100, y: 200, width: 300, height: 40 } }
      };
    }
  });
  await transport.handleMessage(JSON.stringify({
    protocol_version: "aurora/1.0",
    trace_id: "trace-target",
    tenant_id: "tenant-1",
    user_id: "user-1",
    bot_id: "bot-1",
    device_id: "device-1",
    task_id: "task-target",
    action_id: "",
    event_type: "task.assign",
    payload: {
      type: "target_resolution",
      target_request: {
        schema_version: TARGET_SCHEMA_VERSION,
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
      }
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const result = sent.find((item) => item.event_type === "task.result");
  assert.equal(sent.some((item) => item.event_type === "action.execute"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request_id, "request-1");
  assert.equal(result.payload.type, "target_resolution");
  assert.equal(result.payload.status, "resolved");
  assert.equal(result.payload.request_id, "request-1");
  assert.equal(result.payload.window.native_window_id, 123);
  fs.rmSync(userData, { recursive: true, force: true });
});

test("target_resolution returns unsupported when resolver is not wired", async () => {
  const sent = [];
  const { transport, userData } = makeTransport(sent);
  await transport.handleMessage(JSON.stringify({
    protocol_version: "aurora/1.0",
    trace_id: "trace-target",
    tenant_id: "tenant-1",
    user_id: "user-1",
    bot_id: "bot-1",
    device_id: "device-1",
    task_id: "task-target",
    action_id: "",
    event_type: "task.assign",
    payload: {
      type: "target_resolution",
      target_request: { request_id: "request-1" }
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const result = sent.find((item) => item.event_type === "task.result");
  assert.equal(result.payload.error_code, "TARGET_RESOLVER_UNSUPPORTED");
  fs.rmSync(userData, { recursive: true, force: true });
});
