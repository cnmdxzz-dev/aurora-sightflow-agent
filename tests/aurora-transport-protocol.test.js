"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AuroraTransport } = require("../resources/app_source/out/main/aurora-transport");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-transport-test-"));
const transport = new AuroraTransport({
  bridge: {
    paths: { userData },
    log: { info() {}, warn() {}, error() {} }
  },
  identity: {
    tenant_id: "tenant-1",
    user_id: "user-1",
    bot_id: "bot-1"
  }
});

const envelope = transport.makeEnvelope(
  "action.result",
  { success: true },
  "trace-1",
  { taskId: "task-1", actionId: "action-1", configVersion: 3 }
);

assert.deepStrictEqual(Object.keys(envelope).sort(), [
  "action_id",
  "bot_id",
  "device_id",
  "event_type",
  "payload",
  "protocol_version",
  "task_id",
  "tenant_id",
  "trace_id",
  "user_id"
]);
assert.strictEqual(envelope.protocol_version, "aurora/1.0");
assert.strictEqual(envelope.payload.config_version, 3);
assert.ok(envelope.payload.timestamp);
assert.ok(!Object.prototype.hasOwnProperty.call(envelope, "timestamp"));
assert.ok(!Object.prototype.hasOwnProperty.call(envelope, "config_version"));

console.log("Aurora Transport v1.0 wire envelope: OK");
