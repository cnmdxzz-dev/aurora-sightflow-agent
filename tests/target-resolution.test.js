"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RESOLUTION_STATUS,
  TARGET_ERRORS
} = require("../resources/app_source/out/main/target-contract");
const { TargetResolver } = require("../resources/app_source/out/main/target-resolver");

function request(overrides = {}) {
  return {
    execution_id: "exec-1",
    device_id: "device-1",
    plan_digest: "sha256:plan-1",
    ttl_ms: 30_000,
    target: {
      application: "wechat",
      selector_profile: "wechat-chat-v1",
      input_selector: "message_input",
      window_selector: { process_name: "WeChat.exe" },
      ...overrides.target
    },
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    nativeWindowId: 100,
    processId: 200,
    processName: "WeChat.exe",
    application: "wechat",
    title: "Chat",
    disposition: "accepts-pointer",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    dpiScale: 1,
    displayId: "display-1",
    ...overrides
  };
}

function makeResolver({ candidates = [candidate()], uiResult, recipientResult } = {}) {
  const calls = { robot: 0, helper: 0 };
  const resolver = new TargetResolver({
    windowProbe: { async listCandidates() { return candidates; } },
    uiaResolver: {
      async resolveTarget() {
        return uiResult || {
          ok: true,
          verified: true,
          target: { bounds: { x: 400, y: 700, width: 300, height: 40 } },
          evidence: [{ type: "uia_match", source: "mock_uia", value: "message_input", verified: true }]
        };
      }
    },
    recipientVerifier: recipientResult === undefined ? undefined : {
      async verify() { return recipientResult; }
    },
    clock: () => 1_700_000_000_000,
    idFactory: () => "resolve-1"
  });
  return { resolver, calls };
}

test("unique window and target resolve with evidence and plan digest", async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve(request());
  assert.equal(result.ok, true);
  assert.equal(result.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(result.target_verified, true);
  assert.equal(result.plan_digest, "sha256:plan-1");
  assert.equal(result.window.native_window_id, 100);
  assert.equal(result.target.bounds.width, 300);
  assert.ok(result.evidence.some((item) => item.type === "window_match"));
  assert.ok(result.expires_at);
});

test("no window returns TARGET_NOT_FOUND", async () => {
  const { resolver } = makeResolver({ candidates: [] });
  const result = await resolver.resolve(request());
  assert.equal(result.ok, false);
  assert.equal(result.error_code, TARGET_ERRORS.TARGET_NOT_FOUND);
});

test("multiple windows return TARGET_AMBIGUOUS", async () => {
  const { resolver } = makeResolver({ candidates: [candidate(), candidate({ nativeWindowId: 101 })] });
  const result = await resolver.resolve(request());
  assert.equal(result.status, RESOLUTION_STATUS.AMBIGUOUS);
  assert.equal(result.error_code, TARGET_ERRORS.TARGET_AMBIGUOUS);
});

test("non-interactive window is rejected", async () => {
  const { resolver } = makeResolver({ candidates: [candidate({ disposition: "passthrough" })] });
  const result = await resolver.resolve(request());
  assert.equal(result.ok, false);
  assert.equal(result.error_code, TARGET_ERRORS.TARGET_NOT_FOUND);
});

test("recipient verification is required when recipient_ref is present", async () => {
  const { resolver } = makeResolver({ recipientResult: { verified: false } });
  const result = await resolver.resolve(request({ recipient_ref: { external_user_id: "wx-1" } }));
  assert.equal(result.ok, false);
  assert.equal(result.status, RESOLUTION_STATUS.NEED_HUMAN_CONFIRMATION);
  assert.equal(result.error_code, TARGET_ERRORS.RECIPIENT_UNVERIFIED);
});

test("verified recipient produces a verified context", async () => {
  const { resolver } = makeResolver({
    recipientResult: {
      verified: true,
      evidence: [{ type: "recipient_match", source: "mock_recipient", value: "wx-1", verified: true }]
    }
  });
  const result = await resolver.resolve(request({ recipient_ref: { external_user_id: "wx-1" } }));
  assert.equal(result.ok, true);
  assert.equal(result.recipient_verified, true);
  assert.ok(result.evidence.some((item) => item.type === "recipient_match"));
});

test("freshness rejects a changed window fingerprint", async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve(request());
  const changed = candidate({ bounds: { x: 10, y: 10, width: 1200, height: 800 } });
  const fresh = resolver.verifyFresh(result, changed);
  assert.equal(fresh.ok, false);
  assert.equal(fresh.error_code, TARGET_ERRORS.TARGET_STALE);
});

test("resolver does not expose execution capabilities", async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve(request());
  assert.equal(Object.hasOwn(result, "action_execute"), false);
  assert.equal(Object.hasOwn(result, "success"), false);
});

test("invalid request is rejected before adapters are called", async () => {
  let probeCalled = false;
  const resolver = new TargetResolver({
    windowProbe: { async listCandidates() { probeCalled = true; return []; } },
    uiaResolver: { async resolveTarget() { throw new Error("must not be called"); } }
  });
  const result = await resolver.resolve({ device_id: "device-1" });
  assert.equal(result.error_code, TARGET_ERRORS.INVALID_TARGET_REQUEST);
  assert.equal(probeCalled, false);
});
