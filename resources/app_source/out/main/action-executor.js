"use strict";

const SUPPORTED_ACTION_TYPES = new Set(["click", "type", "scroll", "hotkey"]);
const BUTTONS = new Set(["left", "right", "middle"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function executionTimeMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function failure(errorCode, message, startedAt) {
  return {
    success: false,
    error_code: errorCode,
    message,
    execution_time: executionTimeMs(startedAt)
  };
}

class ActionExecutor {
  constructor({ bridge, log } = {}) {
    if (!bridge) throw new TypeError("ActionExecutor requires the official Shell Bridge");
    this.bridge = bridge;
    this.log = log || bridge.log || {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args)
    };
  }

  getRobot() {
    const robot = this.bridge.robot;
    if (!robot || typeof robot !== "object") return null;
    return robot;
  }

  async execute(actionType, parameters = {}) {
    const startedAt = process.hrtime.bigint();
    if (!SUPPORTED_ACTION_TYPES.has(actionType)) {
      return failure("UNSUPPORTED_ACTION_TYPE", `不支持的动作类型: ${actionType || "unknown"}`, startedAt);
    }
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
      return failure("INVALID_PARAMETERS", "动作参数必须是对象", startedAt);
    }

    const robot = this.getRobot();
    if (!robot) return failure("BRIDGE_ROBOT_UNAVAILABLE", "官方 Bridge Robot 能力不可用", startedAt);

    try {
      switch (actionType) {
        case "click":
          await this.executeClick(robot, parameters);
          break;
        case "type":
          await this.executeType(robot, parameters);
          break;
        case "scroll":
          await this.executeScroll(robot, parameters);
          break;
        case "hotkey":
          await this.executeHotkey(robot, parameters);
          break;
        default:
          return failure("UNSUPPORTED_ACTION_TYPE", `不支持的动作类型: ${actionType}`, startedAt);
      }
      return {
        success: true,
        error_code: null,
        execution_time: executionTimeMs(startedAt)
      };
    } catch (error) {
      this.log.error("[Aurora] official Bridge action failed", {
        action_type: actionType,
        error: error?.message || String(error)
      });
      return {
        success: false,
        error_code: "ACTION_EXECUTION_FAILED",
        message: error?.message || String(error),
        execution_time: executionTimeMs(startedAt)
      };
    }
  }

  async executeClick(robot, parameters) {
    const button = normalizeString(parameters.button || "left").toLowerCase();
    if (!BUTTONS.has(button)) throw new Error(`不支持的鼠标按键: ${button}`);

    const hasX = parameters.x !== undefined;
    const hasY = parameters.y !== undefined;
    if (hasX !== hasY) throw new Error("click 必须同时提供 x 和 y");
    if (hasX && hasY) {
      if (!isFiniteNumber(parameters.x) || !isFiniteNumber(parameters.y)) {
        throw new Error("click 的 x、y 必须是数字");
      }
      if (typeof robot.moveMouse !== "function") throw new Error("官方 Bridge 不支持 moveMouse");
      await robot.moveMouse(parameters.x, parameters.y);
    } else if (parameters.current_cursor !== true) {
      throw new Error("click 必须提供 x、y，或明确设置 current_cursor=true");
    }
    if (typeof robot.mouseClick !== "function") throw new Error("官方 Bridge 不支持 mouseClick");
    await robot.mouseClick(button);
  }

  async executeType(robot, parameters) {
    const text = typeof parameters.text === "string" ? parameters.text : parameters.value;
    if (typeof text !== "string") throw new Error("type 必须提供 text");
    if (typeof robot.typeString !== "function") throw new Error("官方 Bridge 不支持 typeString");
    await robot.typeString(text);
  }

  async executeScroll(robot, parameters) {
    const amount = parameters.amount ?? parameters.delta ?? parameters.y;
    if (!isFiniteNumber(amount) || amount === 0) throw new Error("scroll 必须提供非零 amount");
    if (typeof robot.scrollMouse !== "function") throw new Error("官方 Bridge 不支持 scrollMouse");
    await robot.scrollMouse(0, amount);
  }

  async executeHotkey(robot, parameters) {
    const key = normalizeString(parameters.key);
    const modifiers = parameters.modifiers === undefined ? [] : parameters.modifiers;
    if (!key) throw new Error("hotkey 必须提供 key");
    if (!Array.isArray(modifiers) || modifiers.some((modifier) => !normalizeString(modifier))) {
      throw new Error("hotkey 的 modifiers 必须是字符串数组");
    }
    if (typeof robot.keyTap !== "function") throw new Error("官方 Bridge 不支持 keyTap");
    await robot.keyTap(key, modifiers.map((modifier) => normalizeString(modifier)));
  }
}

module.exports = { ActionExecutor };
