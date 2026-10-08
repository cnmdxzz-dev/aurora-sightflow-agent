"use strict";

const {
  RESOLUTION_STATUS,
  TARGET_ERRORS,
  isExpired,
  makeFailure,
  makeWindowFingerprint,
  normalizeBounds,
  stableTargetDigest,
  validateTargetRequest
} = require("./target-contract");
const { appendEvidence, createEvidence, freezeEvidence } = require("./target-evidence");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sameText(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase();
}

function matchesPattern(value, pattern) {
  if (pattern === undefined || pattern === null || pattern === "") return true;
  if (typeof value !== "string") return false;
  try {
    return new RegExp(String(pattern), "i").test(value);
  } catch {
    return value.toLowerCase().includes(String(pattern).toLowerCase());
  }
}

function candidateWindowId(candidate) {
  return candidate?.native_window_id ?? candidate?.nativeWindowId;
}

function candidateProcessId(candidate) {
  return candidate?.process_id ?? candidate?.processId;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const nativeWindowId = candidateWindowId(candidate);
  const processId = candidateProcessId(candidate);
  if (!Number.isSafeInteger(nativeWindowId) || nativeWindowId <= 0) return null;
  if (!Number.isSafeInteger(processId) || processId <= 0) return null;
  return {
    ...candidate,
    native_window_id: nativeWindowId,
    process_id: processId,
    process_name: candidate.process_name ?? candidate.processName ?? "",
    application: candidate.application || "",
    title: candidate.title || "",
    disposition: candidate.disposition || "accepts-pointer",
    bounds: normalizeBounds(candidate.bounds)
  };
}

function matchesSelector(candidate, target) {
  const selector = target.window_selector || {};
  if (selector.process_name && !sameText(candidate.process_name, selector.process_name)) return false;
  if (selector.application && !sameText(candidate.application, selector.application)) return false;
  if (selector.title_pattern && !matchesPattern(candidate.title, selector.title_pattern)) return false;
  if (selector.native_window_id !== undefined && Number(selector.native_window_id) !== candidate.native_window_id) return false;
  if (selector.process_id !== undefined && Number(selector.process_id) !== candidate.process_id) return false;
  if (candidate.application && target.application && !sameText(candidate.application, target.application)) return false;
  if (candidate.device_id && candidate.device_id !== target.device_id) return false;
  return true;
}

function normalizeAdapterResult(result) {
  if (!result || typeof result !== "object") return { ok: false, error_code: TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED };
  return {
    ok: result.ok === true,
    error_code: result.error_code || null,
    message: result.message || null,
    target: result.target || result.resolved_target || null,
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    verified: result.verified === true
  };
}

class TargetResolver {
  constructor({ windowProbe, uiaResolver, recipientVerifier, clock = () => Date.now(), idFactory, log } = {}) {
    if (!windowProbe || typeof windowProbe.listCandidates !== "function") {
      throw new TypeError("TargetResolver requires windowProbe.listCandidates");
    }
    if (!uiaResolver || typeof uiaResolver.resolveTarget !== "function") {
      throw new TypeError("TargetResolver requires uiaResolver.resolveTarget");
    }
    this.windowProbe = windowProbe;
    this.uiaResolver = uiaResolver;
    this.recipientVerifier = recipientVerifier || null;
    this.clock = clock;
    this.idFactory = idFactory || (() => `resolve_${this.clock()}_${Math.random().toString(16).slice(2)}`);
    this.log = log || { warn() {}, error() {} };
  }

  async resolve(request) {
    const validation = validateTargetRequest(request);
    if (!validation.valid) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.REJECTED,
        errorCode: TARGET_ERRORS.INVALID_TARGET_REQUEST,
        message: validation.errors.join("; ")
      });
    }

    const evidence = [];
    let candidates;
    try {
      candidates = await this.windowProbe.listCandidates({
        device_id: request.device_id,
        target: request.target
      });
    } catch (error) {
      this.log.warn("[TargetResolver] window probe failed", error?.message || String(error));
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.UNSUPPORTED,
        errorCode: TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED,
        message: error?.message || String(error)
      });
    }

    const matching = (Array.isArray(candidates) ? candidates : [])
      .map(normalizeCandidate)
      .filter(Boolean)
      .filter((candidate) => matchesSelector(candidate, { ...request.target, device_id: request.device_id }));

    if (matching.length === 0) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.REJECTED,
        errorCode: TARGET_ERRORS.TARGET_NOT_FOUND,
        message: "没有找到唯一匹配窗口"
      });
    }
    if (matching.length > 1) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.AMBIGUOUS,
        errorCode: TARGET_ERRORS.TARGET_AMBIGUOUS,
        message: `匹配到 ${matching.length} 个窗口`
      });
    }

    const window = matching[0];
    if (window.disposition !== "accepts-pointer") {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.REJECTED,
        errorCode: TARGET_ERRORS.TARGET_NOT_FOUND,
        message: "目标窗口不接受指针输入"
      });
    }

    evidence.push(createEvidence("device_match", "target_resolver", request.device_id, true));
    evidence.push(createEvidence("window_match", "window_probe", window.process_name || window.application, true, {
      native_window_id: window.native_window_id,
      process_id: window.process_id
    }));

    let uiResult;
    try {
      uiResult = normalizeAdapterResult(await this.uiaResolver.resolveTarget({
        device_id: request.device_id,
        window,
        target: request.target
      }));
    } catch (error) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.UNSUPPORTED,
        errorCode: TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED,
        message: error?.message || String(error),
        evidence
      });
    }
    if (!uiResult.ok || !uiResult.verified || !uiResult.target) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.REJECTED,
        errorCode: uiResult.error_code || TARGET_ERRORS.TARGET_NOT_FOUND,
        message: uiResult.message || "目标控件未通过唯一性验证",
        evidence: [...evidence, ...uiResult.evidence]
      });
    }
    const targetBounds = normalizeBounds(uiResult.target.bounds);
    if (!targetBounds) {
      return makeFailure({
        request,
        status: RESOLUTION_STATUS.REJECTED,
        errorCode: TARGET_ERRORS.TARGET_NOT_FOUND,
        message: "目标控件没有有效边界",
        evidence: [...evidence, ...uiResult.evidence]
      });
    }
    evidence.push(...uiResult.evidence);
    evidence.push(createEvidence("selector_match", "uia_resolver", request.target.input_selector, true));

    let recipientVerified = true;
    if (request.target.recipient_ref || request.recipient_ref) {
      const recipientRef = request.recipient_ref || request.target.recipient_ref;
      if (!this.recipientVerifier || typeof this.recipientVerifier.verify !== "function") {
        recipientVerified = false;
      } else {
        let recipientResult;
        try {
          recipientResult = await this.recipientVerifier.verify({ window, target: request.target, recipient_ref: recipientRef });
        } catch {
          recipientResult = { verified: false, error_code: TARGET_ERRORS.RECIPIENT_UNVERIFIED };
        }
        recipientVerified = recipientResult?.verified === true;
        if (Array.isArray(recipientResult?.evidence)) evidence.push(...recipientResult.evidence);
      }
      if (!recipientVerified) {
        return Object.freeze({
          ok: false,
          status: RESOLUTION_STATUS.NEED_HUMAN_CONFIRMATION,
          error_code: TARGET_ERRORS.RECIPIENT_UNVERIFIED,
          message: "收件人未通过验证",
          execution_id: request.execution_id,
          device_id: request.device_id,
          target_verified: true,
          recipient_verified: false,
          evidence: freezeEvidence(evidence)
        });
      }
      evidence.push(createEvidence("recipient_match", "recipient_verifier", recipientRef.external_user_id || recipientRef.conversation_id, true));
    }

    const now = this.clock();
    const fingerprint = makeWindowFingerprint(window);
    return Object.freeze({
      ok: true,
      status: RESOLUTION_STATUS.RESOLVED,
      resolution_id: this.idFactory(),
      execution_id: request.execution_id,
      device_id: request.device_id,
      plan_digest: request.plan_digest || stableTargetDigest(request),
      window: Object.freeze({
        native_window_id: window.native_window_id,
        process_id: window.process_id,
        application: window.application || request.target.application,
        fingerprint,
        bounds: window.bounds,
        dpi_scale: window.dpi_scale ?? window.dpiScale ?? null,
        display_id: window.display_id ?? window.displayId ?? null
      }),
      target: Object.freeze({
        selector: request.target.input_selector,
        bounds: targetBounds
      }),
      target_verified: true,
      recipient_verified: recipientVerified,
      evidence: freezeEvidence(evidence),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + validation.ttlMs).toISOString()
    });
  }

  verifyFresh(context, candidate, now = this.clock()) {
    if (!context || context.status !== RESOLUTION_STATUS.RESOLVED || isExpired(context, now)) {
      return { ok: false, status: RESOLUTION_STATUS.STALE, error_code: TARGET_ERRORS.TARGET_STALE };
    }
    const normalized = normalizeCandidate(candidate);
    if (!normalized || makeWindowFingerprint(normalized) !== context.window.fingerprint) {
      return { ok: false, status: RESOLUTION_STATUS.STALE, error_code: TARGET_ERRORS.TARGET_STALE };
    }
    return { ok: true, status: RESOLUTION_STATUS.RESOLVED };
  }
}

module.exports = {
  TargetResolver,
  matchesSelector,
  normalizeCandidate
};
