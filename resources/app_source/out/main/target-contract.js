"use strict";

const crypto = require("crypto");

const RESOLUTION_STATUS = Object.freeze({
  UNRESOLVED: "unresolved",
  RESOLVING: "resolving",
  RESOLVED: "resolved",
  AMBIGUOUS: "ambiguous",
  UNSUPPORTED: "unsupported",
  STALE: "stale",
  REJECTED: "rejected",
  NEED_HUMAN_CONFIRMATION: "need_human_confirmation"
});

// Internal target-resolution contract. This is separate from the aurora/1.0
// transport envelope and is used only when Backend and the local resolver
// exchange target metadata.
const TARGET_SCHEMA_VERSION = "aurora.target/1.0";

const TARGET_ERRORS = Object.freeze({
  INVALID_TARGET_REQUEST: "INVALID_TARGET_REQUEST",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  TARGET_AMBIGUOUS: "TARGET_AMBIGUOUS",
  TARGET_RESOLVER_UNSUPPORTED: "TARGET_RESOLVER_UNSUPPORTED",
  TARGET_STALE: "TARGET_STALE",
  DEVICE_BINDING_MISMATCH: "DEVICE_BINDING_MISMATCH",
  RECIPIENT_NOT_FOUND: "RECIPIENT_NOT_FOUND",
  RECIPIENT_AMBIGUOUS: "RECIPIENT_AMBIGUOUS",
  RECIPIENT_UNVERIFIED: "RECIPIENT_UNVERIFIED"
});

const DEFAULT_TTL_MS = 30_000;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 120_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTtl(value) {
  const ttl = value === undefined ? DEFAULT_TTL_MS : Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) return null;
  return ttl;
}

function validateTargetRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ["request must be an object"] };

  if (request.schema_version !== undefined && request.schema_version !== TARGET_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${TARGET_SCHEMA_VERSION}`);
  }
  if (request.request_id !== undefined && !asNonEmptyString(request.request_id)) {
    errors.push("request_id must be a non-empty string when provided");
  }

  for (const field of ["execution_id", "device_id"]) {
    if (!asNonEmptyString(request[field])) errors.push(`${field} is required`);
  }

  if (!isPlainObject(request.target)) {
    errors.push("target is required");
  } else {
    for (const field of ["application", "selector_profile", "input_selector"]) {
      if (!asNonEmptyString(request.target[field])) errors.push(`target.${field} is required`);
    }
    if (!isPlainObject(request.target.window_selector)) {
      errors.push("target.window_selector is required");
    }
  }

  const ttlMs = normalizeTtl(request.ttl_ms);
  if (ttlMs === null) errors.push(`ttl_ms must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`);
  if (request.plan_digest !== undefined && !asNonEmptyString(request.plan_digest)) {
    errors.push("plan_digest must be a non-empty string when provided");
  }

  return { valid: errors.length === 0, errors, ttlMs };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBounds(bounds) {
  if (!isPlainObject(bounds)) return null;
  const keys = ["x", "y", "width", "height"];
  if (!keys.every((key) => finiteNumber(bounds[key]))) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
}

function makeWindowFingerprint(candidate) {
  const source = {
    native_window_id: candidate?.native_window_id ?? candidate?.nativeWindowId ?? null,
    process_id: candidate?.process_id ?? candidate?.processId ?? null,
    title_hash: candidate?.title_hash ?? candidate?.titleHash ?? null,
    bounds: normalizeBounds(candidate?.bounds),
    dpi_scale: candidate?.dpi_scale ?? candidate?.dpiScale ?? null,
    display_id: candidate?.display_id ?? candidate?.displayId ?? null
  };
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function stableTargetDigest(request) {
  const value = {
    execution_id: request.execution_id,
    device_id: request.device_id,
    plan_digest: request.plan_digest || null,
    target: request.target
  };
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isExpired(context, now = Date.now()) {
  const expiresAt = Date.parse(context?.expires_at || "");
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function makeFailure({ request, status, errorCode, message, evidence = [] }) {
  return Object.freeze({
    ok: false,
    status,
    error_code: errorCode,
    message,
    request_id: request?.request_id || null,
    execution_id: request?.execution_id || null,
    device_id: request?.device_id || null,
    evidence: Object.freeze(Array.isArray(evidence) ? evidence.slice() : [])
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MIN_TTL_MS,
  RESOLUTION_STATUS,
  TARGET_SCHEMA_VERSION,
  TARGET_ERRORS,
  isExpired,
  makeFailure,
  makeWindowFingerprint,
  normalizeBounds,
  stableTargetDigest,
  validateTargetRequest
};
