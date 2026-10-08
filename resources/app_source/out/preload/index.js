"use strict";
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const whatsapp = "org.erb.thiflowagent";
const appIdentityConfig = {
  "default": "org.erb.shiflowagent",
  whatsapp
};
const OEM_RUNTIME_CONFIG_FILE = "oem-config.json";
const DEFAULT_APP_ID = appIdentityConfig.default;
const WHATSAPP_APP_ID = appIdentityConfig.whatsapp;
function resolveOemEdition(value, isOem) {
  if (value === "enterprise" || value === "enterprise_premium") return value;
  return isOem ? "enterprise_premium" : "";
}
function usesCustomOemBranding(env) {
  return env.IS_OEM && env.OEM_EDITION === "enterprise_premium";
}
function resolveCompileTimeAppId(target, buildChannel, oemAppId) {
  const normalizedOemAppId = oemAppId.trim();
  if (normalizedOemAppId) return normalizedOemAppId;
  return buildChannel === "whatsapp" || target === "whatsapp" ? WHATSAPP_APP_ID : DEFAULT_APP_ID;
}
function getCompileTimeBuildEnv() {
  const target = "wechat";
  const buildChannel = process.env.BUILD_CHANNEL || "default";
  const oemSource = "";
  const isOem = Boolean(oemSource);
  return {
    TARGET: target,
    APP_ID: resolveCompileTimeAppId(target, buildChannel, process.env.OEM_APP_ID || ""),
    OEM_SOURCE: oemSource,
    OEM_PRODUCT_NAME: "",
    OEM_EDITION: resolveOemEdition(process.env.OEM_EDITION, isOem),
    IS_OEM: isOem,
    BUILD_CHANNEL: buildChannel
  };
}
function resolveRuntimeBuildEnv(fallback, packagedConfig) {
  if (!packagedConfig) return fallback;
  const oemSource = packagedConfig.OEM_SOURCE ?? fallback.OEM_SOURCE;
  const isOem = packagedConfig.IS_OEM ?? Boolean(oemSource);
  return {
    TARGET: packagedConfig.TARGET ?? fallback.TARGET,
    APP_ID: packagedConfig.APP_ID ?? fallback.APP_ID,
    OEM_SOURCE: oemSource,
    OEM_PRODUCT_NAME: packagedConfig.OEM_PRODUCT_NAME ?? fallback.OEM_PRODUCT_NAME,
    OEM_EDITION: resolveOemEdition(packagedConfig.OEM_EDITION, isOem),
    IS_OEM: isOem,
    BUILD_CHANNEL: packagedConfig.BUILD_CHANNEL ?? fallback.BUILD_CHANNEL
  };
}
function readPackagedBuildEnv() {
  const resourcesPath = process.resourcesPath;
  if (!resourcesPath) return null;
  const configPath = path.join(resourcesPath, OEM_RUNTIME_CONFIG_FILE);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.warn(`[BuildEnv] 无法读取运行时 OEM 配置 ${configPath}:`, error);
    return null;
  }
}
let cachedBuildEnv = null;
function getRuntimeBuildEnv() {
  if (!cachedBuildEnv) {
    cachedBuildEnv = resolveRuntimeBuildEnv(getCompileTimeBuildEnv(), readPackagedBuildEnv());
  }
  return cachedBuildEnv;
}
const electronHandler = {
  invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const handler = (_, ...args) => callback(...args);
    electron.ipcRenderer.on(channel, handler);
    return () => {
      electron.ipcRenderer.removeListener(channel, handler);
    };
  },
  send: (channel, ...args) => electron.ipcRenderer.send(channel, ...args),
  getPathForFile: (file) => {
    const filePath = electron.webUtils.getPathForFile(file);
    console.log("[AgenticSettings][attachment-debug] preload getPathForFile", {
      name: file.name,
      type: file.type,
      size: file.size,
      hasPath: Boolean(filePath),
      filePath: filePath || null
    });
    return filePath;
  }
};
function getOemLogoDataUrl() {
  const candidates = [
    path.join(process.resourcesPath || "", "oem-logo.png"),
    path.join(__dirname, "../../resources/oem-logo.png")
  ];
  for (const logoPath of candidates) {
    try {
      if (fs.existsSync(logoPath)) {
        const data = fs.readFileSync(logoPath);
        return `data:image/png;base64,${data.toString("base64")}`;
      }
    } catch {
    }
  }
  return "";
}
const runtimeBuildEnv = getRuntimeBuildEnv();
electron.contextBridge.exposeInMainWorld("electron", electronHandler);
electron.contextBridge.exposeInMainWorld("osInfo", { platform: process.platform });
electron.contextBridge.exposeInMainWorld("buildEnv", {
  TARGET: runtimeBuildEnv.TARGET,
  IS_LOCAL_DEV: String(process.env.SHIFLOW_LOCAL_DEV === "1"),
  OEM_SOURCE: runtimeBuildEnv.OEM_SOURCE,
  OEM_PRODUCT_NAME: runtimeBuildEnv.OEM_PRODUCT_NAME,
  OEM_EDITION: runtimeBuildEnv.OEM_EDITION,
  IS_OEM: String(runtimeBuildEnv.IS_OEM),
  IS_BEIJING_SUBWAY_TARGET: String(runtimeBuildEnv.TARGET === "beijing_subway"),
  OEM_LOGO_URL: usesCustomOemBranding(runtimeBuildEnv) ? getOemLogoDataUrl() : ""
});
