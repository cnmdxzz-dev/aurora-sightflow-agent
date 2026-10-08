"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { AuroraTransport } = require("../resources/app_source/out/main/aurora-transport");
const { ActionExecutor } = require("../resources/app_source/out/main/action-executor");

function makeTransport() {
  return new AuroraTransport({
    bridge: {
      paths: { userData: require("node:os").tmpdir() },
      log: { info() {}, warn() {}, error() {} }
    },
    identity: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      bot_id: "bot-1",
      device_id: "device-1"
    }
  });
}

test("C1 accepts only click/type/hotkey and captures step correlation", () => {
  const transport = makeTransport();
  for (const actionType of ["click", "type", "hotkey"]) {
    const validation = transport.validateActionExecute({
      protocol_version: "aurora/1.0",
      trace_id: "trace-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      bot_id: "bot-1",
      device_id: "device-1",
      task_id: "task-1",
      action_id: `business-action:step:${actionType}`,
      event_type: "action.execute",
      payload: {
        execution_id: "execution-1",
        step_id: `business-action:step:${actionType}`,
        source_action_id: "business-action",
        expected_step_ids: ["business-action:step:click"],
        action_type: actionType,
        parameters: {}
      }
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.executionId, "execution-1");
    assert.equal(validation.sourceActionId, "business-action");
  }
});

test("C1 rejects scroll at the transport boundary", () => {
  const transport = makeTransport();
  const validation = transport.validateActionExecute({
    protocol_version: "aurora/1.0",
    trace_id: "trace-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    bot_id: "bot-1",
    device_id: "device-1",
    task_id: "task-1",
    action_id: "action-1",
    event_type: "action.execute",
    payload: { action_type: "scroll", parameters: { amount: 1 } }
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.errorCode, "UNSUPPORTED_ACTION_TYPE");
});

test("action.result keeps success and execution fields inside payload", () => {
  const transport = makeTransport();
  const sent = [];
  transport.send = (value) => sent.push(value);
  transport.sendActionResult(
    {
      traceId: "trace-1",
      taskId: "task-1",
      actionId: "action:step:0",
      actionType: "type",
      executionId: "execution-1",
      stepId: "action:step:0",
      sourceActionId: "action",
      sequence: 0,
      expectedStepIds: ["action:step:0"]
    },
    { success: true, error_code: null, execution_time: 2.5 }
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), [
    "action_id", "bot_id", "device_id", "event_type", "payload",
    "protocol_version", "task_id", "tenant_id", "trace_id", "user_id"
  ]);
  assert.equal(sent[0].payload.success, true);
  assert.equal(sent[0].payload.execution_id, "execution-1");
  assert.equal(Object.hasOwn(sent[0], "success"), false);
  assert.equal(Object.hasOwn(sent[0], "execution_time"), false);
});

test("official ActionExecutor uses the supplied Bridge Robot for C1 primitives", async () => {
  const calls = [];
  const executor = new ActionExecutor({
    bridge: {
      robot: {
        async moveMouse(x, y) { calls.push(["moveMouse", x, y]); },
        async mouseClick(button) { calls.push(["mouseClick", button]); },
        async typeString(value) { calls.push(["typeString", value]); },
        async keyTap(key, modifiers) { calls.push(["keyTap", key, modifiers]); }
      },
      log: { info() {}, warn() {}, error() {} }
    }
  });
  assert.equal((await executor.execute("click", { x: 10, y: 20 })).success, true);
  assert.equal((await executor.execute("type", { text: "hello" })).success, true);
  assert.equal((await executor.execute("hotkey", { key: "ENTER", modifiers: [] })).success, true);
  assert.deepEqual(calls, [
    ["moveMouse", 10, 20],
    ["mouseClick", "left"],
    ["typeString", "hello"],
    ["keyTap", "ENTER", []]
  ]);
});
