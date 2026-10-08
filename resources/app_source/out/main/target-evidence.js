"use strict";

/**
 * Runtime-only evidence collected while resolving a desktop target.
 * Evidence is deliberately kept separate from the Aurora wire envelope and
 * is never persisted as business data.
 */
function createEvidence(type, source, value, verified = true, details = {}) {
  if (typeof type !== "string" || !type.trim()) throw new TypeError("evidence.type is required");
  if (typeof source !== "string" || !source.trim()) throw new TypeError("evidence.source is required");

  return Object.freeze({
    type: type.trim(),
    source: source.trim(),
    value: value === undefined ? null : value,
    verified: verified === true,
    ...details && typeof details === "object" && !Array.isArray(details) ? details : {}
  });
}

function appendEvidence(existing, evidence) {
  const list = Array.isArray(existing) ? existing : [];
  return Object.freeze([...list, evidence]);
}

function freezeEvidence(existing) {
  return Object.freeze((Array.isArray(existing) ? existing : []).slice());
}

module.exports = {
  appendEvidence,
  createEvidence,
  freezeEvidence
};
