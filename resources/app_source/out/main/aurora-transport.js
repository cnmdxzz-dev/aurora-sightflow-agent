"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { ActionExecutor } = require("./action-executor");

let WebSocket = null;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEVICE_STATE_FILE = "aurora-device.json";
const TASK_STATE_FILE = "aurora-tasks.json";
const ACTION_STATE_FILE = "aurora-actions.json";
const MAX_STORED_TASKS = 1_000;
const MAX_STORED_ACTIONS = 1_000;
const MAX_AUDIT_ENTRIES = 2_000;
// C1 deliberately exposes only the three primitives needed for the first
// controlled desktop round-trip.  The official ActionExecutor still knows
// about scroll for compatibility, but the Aurora receiver does not accept it
// until a later phase explicitly verifies its semantics.
const SUPPORTED_ACTION_TYPES = new Set(["click", "type", "hotkey"]);

function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function hashDeviceSeed(seed) {
  return crypto.createHash("sha256").update(`shiflow-device-v1\0${seed}`).digest("hex");
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch (error) {
    console.warn(`[Aurora] 无法读取设备状态文件: ${filePath}`, error?.message || String(error));
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function resolveMachineId() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const machineId = machineIdSync(true);
    if (machineId) return String(machineId);
  } catch (error) {
    console.warn("[Aurora] node-machine-id 不可用，将使用本机回退标识:", error?.message || String(error));
  }
  return `${os.hostname()}|${process.platform}|${process.arch}`;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadWebSocket() {
  if (WebSocket) return WebSocket;
  WebSocket = require("ws");
  return WebSocket;
}

class AuroraTransport {
  constructor({ bridge, gatewayUrl, identity = {}, heartbeatIntervalMs, reconnectBaseDelayMs, reconnectMaxDelayMs, actionExecutor } = {}) {
    if (!bridge) throw new TypeError("AuroraTransport requires the official Shell Bridge");

    this.bridge = bridge;
    this.actionExecutor = actionExecutor || new ActionExecutor({ bridge });
    this.log = bridge.log || {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args)
    };
    this.gatewayUrl = normalizeString(gatewayUrl || process.env.AURORA_GATEWAY_URL);
    this.heartbeatIntervalMs = parsePositiveInteger(
      heartbeatIntervalMs || process.env.AURORA_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS
    );
    this.reconnectBaseDelayMs = parsePositiveInteger(
      reconnectBaseDelayMs || process.env.AURORA_RECONNECT_BASE_DELAY_MS,
      DEFAULT_RECONNECT_BASE_DELAY_MS
    );
    this.reconnectMaxDelayMs = parsePositiveInteger(
      reconnectMaxDelayMs || process.env.AURORA_RECONNECT_MAX_DELAY_MS,
      DEFAULT_RECONNECT_MAX_DELAY_MS
    );
    this.userDataPath = bridge.paths?.userData || os.tmpdir();
    this.storagePath = path.join(this.userDataPath, DEVICE_STATE_FILE);
    this.taskStoragePath = path.join(this.userDataPath, TASK_STATE_FILE);
    this.actionStoragePath = path.join(this.userDataPath, ACTION_STATE_FILE);

    const stored = readJson(this.storagePath) || {};
    this.deviceId = normalizeString(identity.device_id || identity.deviceId || stored.device_id) || this.createDeviceId();
    this.deviceToken = normalizeString(identity.device_token || identity.deviceToken || stored.device_token);
    this.tenantId = normalizeString(identity.tenant_id || identity.tenantId || process.env.AURORA_TENANT_ID);
    this.userId = normalizeString(identity.user_id || identity.userId || process.env.AURORA_USER_ID);
    this.botId = normalizeString(identity.bot_id || identity.botId || process.env.AURORA_BOT_ID);

    this.socket = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.started = false;
    this.stopping = false;
    this.registered = false;
    this.connectionState = "idle";
    this.lastTraceId = null;

    this.persistState();
  }

  createDeviceId() {
    return hashDeviceSeed(resolveMachineId());
  }

  persistState() {
    try {
      const current = readJson(this.storagePath) || {};
      writeJsonAtomic(this.storagePath, {
        ...current,
        device_id: this.deviceId,
        ...(this.deviceToken ? { device_token: this.deviceToken } : {}),
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      this.log.error("[Aurora] 设备状态保存失败", {
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
    }
  }

  logState(state, traceId = this.lastTraceId) {
    this.connectionState = state;
    this.lastTraceId = traceId || this.lastTraceId || createId();
    this.log.info("[Aurora] connection state", {
      state,
      trace_id: this.lastTraceId,
      device_id: this.deviceId
    });
  }

  makeEnvelope(eventType, payload = {}, traceId = createId(), { taskId = null, actionId = null, configVersion = null } = {}) {
    this.lastTraceId = traceId;
    const wirePayload = {
      ...payload,
      timestamp: new Date().toISOString()
    };
    if (configVersion !== null && configVersion !== undefined) {
      wirePayload.config_version = configVersion;
    }
    return {
      protocol_version: "aurora/1.0",
      trace_id: traceId,
      tenant_id: this.tenantId,
      user_id: this.userId,
      bot_id: this.botId,
      device_id: this.deviceId,
      task_id: taskId || "",
      action_id: actionId || "",
      event_type: eventType,
      payload: wirePayload
    };
  }

  getDeviceInfo() {
    let appVersion = "unknown";
    try {
      appVersion = this.bridge.app?.getVersion?.() || appVersion;
    } catch {
      // The official Bridge is still usable when app metadata is unavailable.
    }
    return {
      app_version: appVersion,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname()
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;

    if (!this.gatewayUrl) {
      this.logState("disabled");
      this.log.warn("[Aurora] 未配置 AURORA_GATEWAY_URL，设备上线链路保持禁用");
      return;
    }

    if (!this.isValidGatewayUrl()) {
      this.logState("invalid-url");
      this.log.error("[Aurora] AURORA_GATEWAY_URL 必须使用 ws:// 或 wss://", {
        device_id: this.deviceId
      });
      return;
    }

    try {
      loadWebSocket();
    } catch (error) {
      this.logState("dependency-error");
      this.log.error("[Aurora] ws 依赖不可用，设备上线链路未启动", {
        trace_id: this.lastTraceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      return;
    }

    this.connect();
  }

  isValidGatewayUrl() {
    try {
      const parsed = new URL(this.gatewayUrl);
      return parsed.protocol === "ws:" || parsed.protocol === "wss:";
    } catch {
      return false;
    }
  }

  connect() {
    if (!this.started || this.stopping || this.socket) return;

    const traceId = createId();
    this.logState("connecting", traceId);
    const headers = {};
    if (this.deviceToken) headers.Authorization = `Bearer ${this.deviceToken}`;

    let socket;
    try {
      socket = new (loadWebSocket())(this.gatewayUrl, { headers });
    } catch (error) {
      this.logState("error", traceId);
      this.log.error("[Aurora] WebSocket 创建失败", {
        trace_id: traceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.on("open", () => this.handleOpen(traceId));
    socket.on("message", (data) => this.handleMessage(data));
    socket.on("error", (error) => {
      this.log.error("[Aurora] WebSocket 错误", {
        trace_id: this.lastTraceId || traceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
    });
    socket.on("close", (code, reason) => this.handleClose(code, reason, traceId));
  }

  handleOpen(traceId) {
    this.reconnectAttempt = 0;
    this.registered = false;
    this.logState("connected", traceId);
    this.sendRegister(traceId);
  }

  sendRegister(traceId = createId()) {
    const payload = {
      device_info: this.getDeviceInfo()
    };
    if (this.deviceToken) payload.device_token = this.deviceToken;
    this.send(this.makeEnvelope("device.register", payload, traceId));
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.registered) return;
      this.send(this.makeEnvelope("device.heartbeat", {
        device_status: "online",
        app_version: this.getDeviceInfo().app_version,
        platform: process.platform
      }));
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== 1) {
      this.log.warn("[Aurora] 消息发送跳过，WebSocket 未连接", {
        event_type: message?.event_type,
        trace_id: message?.trace_id,
        device_id: this.deviceId
      });
      return false;
    }
    try {
      this.socket.send(JSON.stringify(message));
      this.log.info("[Aurora] message sent", {
        event_type: message.event_type,
        trace_id: message.trace_id,
        device_id: this.deviceId
      });
      return true;
    } catch (error) {
      this.log.error("[Aurora] 消息发送失败", {
        event_type: message?.event_type,
        trace_id: message?.trace_id,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      return false;
    }
  }

  validateTaskAssign(message) {
    const traceId = normalizeString(message?.trace_id) || createId();
    const taskId = normalizeString(message?.task_id);
    const checks = [
      ["tenant_id", this.tenantId, normalizeString(message?.tenant_id), "TENANT_MISMATCH"],
      ["device_id", this.deviceId, normalizeString(message?.device_id), "DEVICE_MISMATCH"],
      ["bot_id", this.botId, normalizeString(message?.bot_id), "BOT_MISMATCH"]
    ];
    for (const [field, expected, actual, errorCode] of checks) {
      if (!expected || expected !== actual) {
        return {
          ok: false,
          traceId,
          taskId,
          errorCode,
          message: `${field} 校验失败`
        };
      }
    }
    if (!normalizeString(message?.trace_id)) {
      return { ok: false, traceId, taskId, errorCode: "INVALID_TASK", message: "缺少 trace_id" };
    }
    if (!taskId) {
      return { ok: false, traceId, taskId, errorCode: "INVALID_TASK", message: "缺少 task_id" };
    }
    if (!message?.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) {
      return { ok: false, traceId, taskId, errorCode: "INVALID_TASK", message: "payload 必须是对象" };
    }
    return { ok: true, traceId, taskId };
  }

  persistTask(message, validation) {
    const existing = readJson(this.taskStoragePath) || {};
    const tasks = Array.isArray(existing.tasks) ? existing.tasks : [];
    const receivedAt = new Date().toISOString();
    const record = {
      trace_id: validation.traceId,
      tenant_id: message.tenant_id,
      user_id: normalizeString(message.user_id) || this.userId,
      bot_id: message.bot_id,
      device_id: message.device_id,
      task_id: validation.taskId,
      status: "received",
      received_at: receivedAt,
      payload: message.payload
    };
    const existingIndex = tasks.findIndex((task) => task && task.task_id === validation.taskId);
    const duplicate = existingIndex >= 0;
    if (duplicate) tasks.splice(existingIndex, 1);
    tasks.unshift(record);
    tasks.length = Math.min(tasks.length, MAX_STORED_TASKS);
    writeJsonAtomic(this.taskStoragePath, {
      version: 1,
      updated_at: receivedAt,
      tasks
    });
    return { duplicate, record };
  }

  sendTaskRejected(validation) {
    this.log.warn("[Aurora] task rejected", {
      task_id: validation.taskId || null,
      trace_id: validation.traceId,
      device_id: this.deviceId,
      error_code: validation.errorCode
    });
    this.send(this.makeEnvelope("task.rejected", {
      accepted: false,
      error_code: validation.errorCode,
      message: validation.message
    }, validation.traceId, { taskId: validation.taskId || null }));
  }

  handleTaskAssign(message) {
    const validation = this.validateTaskAssign(message);
    if (!validation.ok) {
      this.sendTaskRejected(validation);
      return;
    }

    try {
      const persisted = this.persistTask(message, validation);
      this.log.info("[Aurora] task received", {
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId,
        duplicate: persisted.duplicate
      });
      this.send(this.makeEnvelope("task.received", {
        accepted: true,
        task_id: validation.taskId,
        status: "received",
        duplicate: persisted.duplicate,
        received_at: persisted.record.received_at
      }, validation.traceId, { taskId: validation.taskId }));
    } catch (error) {
      const failure = {
        ...validation,
        errorCode: "TASK_PERSIST_FAILED",
        message: "任务状态保存失败"
      };
      this.log.error("[Aurora] task persistence failed", {
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      this.sendTaskRejected(failure);
    }
  }

  validateActionExecute(message) {
    const traceId = normalizeString(message?.trace_id) || createId();
    const taskId = normalizeString(message?.task_id);
    const actionId = normalizeString(message?.action_id);
    const payload = message?.payload;
    const actionType = normalizeString(message?.action_type || payload?.action_type);
    const protocolVersion = normalizeString(message?.protocol_version);
    const checks = [
      ["tenant_id", this.tenantId, normalizeString(message?.tenant_id), "TENANT_MISMATCH"],
      ["device_id", this.deviceId, normalizeString(message?.device_id), "DEVICE_MISMATCH"],
      ["bot_id", this.botId, normalizeString(message?.bot_id), "BOT_MISMATCH"]
    ];
    for (const [field, expected, actual, errorCode] of checks) {
      if (!expected || expected !== actual) {
        return {
          ok: false,
          traceId,
          taskId,
          actionId,
          actionType,
          errorCode,
          message: `${field} 校验失败`
        };
      }
    }
    if (!normalizeString(message?.trace_id)) {
      return { ok: false, traceId, taskId, actionId, actionType, errorCode: "INVALID_ACTION", message: "缺少 trace_id" };
    }
    if (protocolVersion && protocolVersion !== "aurora/1.0") {
      return {
        ok: false,
        traceId,
        taskId,
        actionId,
        actionType,
        errorCode: "INVALID_PROTOCOL_VERSION",
        message: "只接受 aurora/1.0"
      };
    }
    if (this.userId && normalizeString(message?.user_id) && this.userId !== normalizeString(message.user_id)) {
      return {
        ok: false,
        traceId,
        taskId,
        actionId,
        actionType,
        errorCode: "USER_MISMATCH",
        message: "user_id 校验失败"
      };
    }
    if (!taskId) {
      return { ok: false, traceId, taskId, actionId, actionType, errorCode: "INVALID_ACTION", message: "缺少 task_id" };
    }
    if (!actionId) {
      return { ok: false, traceId, taskId, actionId, actionType, errorCode: "INVALID_ACTION", message: "缺少 action_id" };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, traceId, taskId, actionId, actionType, errorCode: "INVALID_ACTION", message: "payload 必须是对象" };
    }
    if (!SUPPORTED_ACTION_TYPES.has(actionType)) {
      return {
        ok: false,
        traceId,
        taskId,
        actionId,
        actionType,
        errorCode: "UNSUPPORTED_ACTION_TYPE",
        message: `不支持的动作类型: ${actionType || "unknown"}`
      };
    }
    const executionId = normalizeString(payload.execution_id);
    const stepId = normalizeString(payload.step_id);
    const sourceActionId = normalizeString(payload.source_action_id) || actionId;
    const expectedStepIds = Array.isArray(payload.expected_step_ids)
      ? payload.expected_step_ids.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
      : [];
    if (executionId && !stepId) {
      return {
        ok: false,
        traceId,
        taskId,
        actionId,
        actionType,
        errorCode: "INVALID_ACTION",
        message: "C1 action.execute 包含 execution_id 时必须包含 step_id"
      };
    }
    return {
      ok: true,
      traceId,
      taskId,
      actionId,
      actionType,
      executionId,
      stepId,
      sourceActionId,
      sequence: Number.isSafeInteger(payload.sequence) ? payload.sequence : null,
      expectedStepIds
    };
  }

  persistActionAudit(entry) {
    try {
      const existing = readJson(this.actionStoragePath) || {};
      const actions = Array.isArray(existing.actions) ? existing.actions : [];
      const auditLog = Array.isArray(existing.audit_log) ? existing.audit_log : [];
      auditLog.unshift({
        ...entry,
        audited_at: entry.audited_at || new Date().toISOString()
      });
      auditLog.length = Math.min(auditLog.length, MAX_AUDIT_ENTRIES);
      writeJsonAtomic(this.actionStoragePath, {
        version: 1,
        updated_at: new Date().toISOString(),
        actions,
        audit_log: auditLog
      });
    } catch (error) {
      this.log.error("[Aurora] action audit persistence failed", {
        action_id: entry.action_id || null,
        task_id: entry.task_id || null,
        trace_id: entry.trace_id || null,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
    }
  }

  persistAction(message, validation) {
    const existing = readJson(this.actionStoragePath) || {};
    const actions = Array.isArray(existing.actions) ? existing.actions : [];
    const auditLog = Array.isArray(existing.audit_log) ? existing.audit_log : [];
    const receivedAt = new Date().toISOString();
    const record = {
      trace_id: validation.traceId,
      tenant_id: message.tenant_id,
      user_id: normalizeString(message.user_id) || this.userId,
      bot_id: message.bot_id,
      device_id: message.device_id,
      task_id: validation.taskId,
      action_id: validation.actionId,
      action_type: validation.actionType,
      ...(validation.executionId ? { execution_id: validation.executionId } : {}),
      ...(validation.stepId ? { step_id: validation.stepId } : {}),
      source_action_id: validation.sourceActionId || validation.actionId,
      ...(validation.sequence !== null ? { sequence: validation.sequence } : {}),
      status: "received",
      received_at: receivedAt,
      payload: message.payload
    };
    const existingIndex = actions.findIndex((action) => action && action.action_id === validation.actionId);
    const duplicate = existingIndex >= 0;
    const existingAction = duplicate ? actions[existingIndex] : null;
    if (existingAction && (existingAction.status === "executed" || existingAction.status === "failed")) {
      return { duplicate: true, terminal: true, record: existingAction };
    }
    if (duplicate) actions.splice(existingIndex, 1);
    actions.unshift(record);
    actions.length = Math.min(actions.length, MAX_STORED_ACTIONS);
    auditLog.unshift({
      event: "action.received",
      trace_id: validation.traceId,
      tenant_id: message.tenant_id,
      user_id: normalizeString(message.user_id) || this.userId,
      bot_id: message.bot_id,
      device_id: message.device_id,
      task_id: validation.taskId,
      action_id: validation.actionId,
      action_type: validation.actionType,
      status: "received",
      duplicate,
      audited_at: receivedAt
    });
    auditLog.length = Math.min(auditLog.length, MAX_AUDIT_ENTRIES);
    writeJsonAtomic(this.actionStoragePath, {
      version: 1,
      updated_at: receivedAt,
      actions,
      audit_log: auditLog
    });
    return { duplicate, record };
  }

  persistActionResult(validation, result) {
    try {
      const existing = readJson(this.actionStoragePath) || {};
      const actions = Array.isArray(existing.actions) ? existing.actions : [];
      const auditLog = Array.isArray(existing.audit_log) ? existing.audit_log : [];
      const completedAt = new Date().toISOString();
      const action = actions.find((item) => item && item.action_id === validation.actionId);
      if (action) {
        action.status = result.success ? "executed" : "failed";
        action.success = result.success;
        action.error_code = result.error_code || null;
        action.execution_time = result.execution_time;
        action.completed_at = completedAt;
        if (validation.executionId) action.execution_id = validation.executionId;
        if (validation.stepId) action.step_id = validation.stepId;
        action.source_action_id = validation.sourceActionId || validation.actionId;
      }
      auditLog.unshift({
        event: "action.result",
        trace_id: validation.traceId,
        tenant_id: this.tenantId,
        user_id: this.userId,
        bot_id: this.botId,
        device_id: this.deviceId,
        task_id: validation.taskId,
        action_id: validation.actionId,
        action_type: validation.actionType,
        status: result.success ? "executed" : "failed",
        success: result.success,
        error_code: result.error_code || null,
        execution_time: result.execution_time,
        audited_at: completedAt
      });
      auditLog.length = Math.min(auditLog.length, MAX_AUDIT_ENTRIES);
      writeJsonAtomic(this.actionStoragePath, {
        version: 1,
        updated_at: completedAt,
        actions,
        audit_log: auditLog
      });
    } catch (error) {
      this.log.error("[Aurora] action result audit persistence failed", {
        action_id: validation.actionId,
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
    }
  }

  sendActionRejected(validation) {
    this.log.warn("[Aurora] action rejected", {
      action_id: validation.actionId || null,
      action_type: validation.actionType || null,
      task_id: validation.taskId || null,
      trace_id: validation.traceId,
      device_id: this.deviceId,
      error_code: validation.errorCode
    });
    this.persistActionAudit({
      event: "action.rejected",
      trace_id: validation.traceId,
      tenant_id: this.tenantId,
      user_id: this.userId,
      bot_id: this.botId,
      device_id: this.deviceId,
      task_id: validation.taskId || null,
      action_id: validation.actionId || null,
      action_type: validation.actionType || null,
      status: "rejected",
      error_code: validation.errorCode,
      message: validation.message
    });
    this.send(this.makeEnvelope("action.rejected", {
      accepted: false,
      error_code: validation.errorCode,
      message: validation.message,
      action_type: validation.actionType || null
    }, validation.traceId, {
      taskId: validation.taskId || null,
      actionId: validation.actionId || null
    }));
  }

  sendActionResult(validation, result, { duplicate = false } = {}) {
    const payload = {
      success: result.success,
      error_code: result.error_code || null,
      execution_time: result.execution_time,
      action_id: validation.actionId,
      task_id: validation.taskId,
      action_type: validation.actionType,
      duplicate,
      ...(validation.executionId ? { execution_id: validation.executionId } : {}),
      ...(validation.stepId ? { step_id: validation.stepId } : {}),
      source_action_id: validation.sourceActionId || validation.actionId,
      ...(validation.sequence !== null ? { sequence: validation.sequence } : {}),
      ...(validation.expectedStepIds.length > 0 ? { expected_step_ids: validation.expectedStepIds } : {}),
      ...(result.message ? { message: result.message } : {})
    };
    const envelope = this.makeEnvelope("action.result", payload, validation.traceId, {
      taskId: validation.taskId,
      actionId: validation.actionId
    });
    this.send(envelope);
  }

  async handleActionExecute(message) {
    const validation = this.validateActionExecute(message);
    if (!validation.ok) {
      this.sendActionRejected(validation);
      return;
    }

    let persisted;
    try {
      persisted = this.persistAction(message, validation);
    } catch (error) {
      const failure = {
        ...validation,
        errorCode: "ACTION_PERSIST_FAILED",
        message: "动作状态保存失败"
      };
      this.log.error("[Aurora] action persistence failed", {
        action_id: validation.actionId,
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      this.sendActionRejected(failure);
      return;
    }

    if (persisted.terminal) {
      const replayedResult = {
        success: persisted.record.success === true,
        error_code: persisted.record.error_code || null,
        execution_time: persisted.record.execution_time || 0,
        ...(persisted.record.message ? { message: persisted.record.message } : {})
      };
      this.log.info("[Aurora] duplicate terminal action, execution skipped", {
        action_id: validation.actionId,
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId
      });
      this.sendActionResult(validation, replayedResult, { duplicate: true });
      return;
    }

    const parameters = message.payload?.parameters && typeof message.payload.parameters === "object"
      ? message.payload.parameters
      : message.payload;
    let result;
    try {
      this.log.info("[Aurora] action execution started", {
        action_id: validation.actionId,
        action_type: validation.actionType,
        task_id: validation.taskId,
        trace_id: validation.traceId,
        device_id: this.deviceId
      });
      result = await this.actionExecutor.execute(validation.actionType, parameters);
    } catch (error) {
      result = {
        success: false,
        error_code: "ACTION_EXECUTION_FAILED",
        message: error?.message || String(error),
        execution_time: 0
      };
    }
    this.persistActionResult(validation, result);
    this.log.info("[Aurora] action execution finished", {
      action_id: validation.actionId,
      action_type: validation.actionType,
      task_id: validation.taskId,
      trace_id: validation.traceId,
      device_id: this.deviceId,
      success: result.success,
      error_code: result.error_code || null,
      execution_time: result.execution_time
    });
    this.sendActionResult(validation, result);
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch (error) {
      this.log.warn("[Aurora] 收到无法解析的消息", {
        device_id: this.deviceId,
        error: error?.message || String(error)
      });
      return;
    }

    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.log.warn("[Aurora] 收到格式非法的消息", {
        device_id: this.deviceId,
        trace_id: this.lastTraceId
      });
      return;
    }

    const eventType = message.event_type || message.type || message.event;
    const payload = message.payload && typeof message.payload === "object" ? message.payload : message;
    const traceId = message.trace_id || payload.trace_id || this.lastTraceId;
    this.log.info("[Aurora] message received", {
      event_type: eventType,
      trace_id: traceId,
      device_id: this.deviceId
    });

    if (eventType === "task.assign") {
      this.handleTaskAssign(message);
      return;
    }

    if (eventType === "action.execute") {
      void this.handleActionExecute(message);
      return;
    }

    const registrationData = payload.data && typeof payload.data === "object" ? payload.data : {};
    if (["device.registered", "device.register.ack", "device.register.success"].includes(eventType) || payload.device_token || registrationData.device_token) {
      const token = normalizeString(
        payload.device_token || payload.token || registrationData.device_token || registrationData.token || message.device_token
      );
      if (token) {
        this.deviceToken = token;
        this.persistState();
      }
      this.registered = true;
      this.logState("online", traceId);
      this.startHeartbeat();
    }
  }

  handleClose(code, reason, traceId) {
    const reasonText = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
    this.socket = null;
    this.registered = false;
    this.stopHeartbeat();
    this.logState(this.stopping ? "disconnected" : "closed", traceId);
    this.log.info("[Aurora] WebSocket closed", {
      code,
      reason: reasonText,
      trace_id: this.lastTraceId || traceId,
      device_id: this.deviceId
    });
    if (!this.stopping) this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.started || this.stopping || this.reconnectTimer || !this.gatewayUrl) return;
    const exponent = Math.min(this.reconnectAttempt, 6);
    const baseDelay = Math.min(this.reconnectMaxDelayMs, this.reconnectBaseDelayMs * 2 ** exponent);
    const jitter = Math.floor(Math.random() * Math.max(250, Math.floor(baseDelay * 0.2)));
    const delay = Math.min(this.reconnectMaxDelayMs, baseDelay + jitter);
    this.reconnectAttempt += 1;
    this.log.info("[Aurora] scheduling reconnect", {
      delay_ms: delay,
      attempt: this.reconnectAttempt,
      device_id: this.deviceId,
      trace_id: this.lastTraceId
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async stop() {
    this.started = false;
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();

    const socket = this.socket;
    if (!socket) {
      this.logState("disconnected");
      return;
    }

    if (socket.readyState === 1) {
      this.send(this.makeEnvelope("device.disconnect", {
        reason: "application_shutdown"
      }));
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      socket.once("close", finish);
      setTimeout(finish, 1_000).unref?.();
      try {
        socket.close(1000, "application_shutdown");
      } catch {
        finish();
      }
    });
    this.socket = null;
    this.logState("disconnected");
  }

  getStatus() {
    return {
      state: this.connectionState,
      device_id: this.deviceId,
      registered: this.registered,
      gateway_url: this.gatewayUrl || null
    };
  }
}

module.exports = { AuroraTransport };
