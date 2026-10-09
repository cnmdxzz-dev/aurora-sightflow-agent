"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const child_process = require("child_process");
const semver = require("semver");
const electronUpdater = require("electron-updater");
const log = require("electron-log");
const events = require("events");
const os = require("os");
const { AuroraTransport } = require("./aurora-transport");
const { createProductionTargetResolver } = require("./resolver");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const icon = path.join(__dirname, "../../resources/icon.png");
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
function resolveCompileTimeAppId(target, buildChannel, oemAppId) {
  const normalizedOemAppId = oemAppId.trim();
  if (normalizedOemAppId) return normalizedOemAppId;
  return buildChannel === "whatsapp" || target === "whatsapp" ? WHATSAPP_APP_ID : DEFAULT_APP_ID;
}
function getCompileTimeBuildEnv() {
  const target = "wechat";
  const buildChannel = "default";
  const oemSource = "";
  const isOem = Boolean(oemSource);
  return {
    TARGET: target,
    APP_ID: resolveCompileTimeAppId(target, buildChannel, ""),
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
const LOCAL_VERSIONS_FILE = "hot-versions.json";
function getLocalVersionsPath() {
  return path.join(electron.app.getPath("userData"), LOCAL_VERSIONS_FILE);
}
function readLocalVersions() {
  try {
    const filePath = getLocalVersionsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
  }
  return { displayVersion: void 0 };
}
function writeLocalVersions(versions) {
  fs.writeFileSync(getLocalVersionsPath(), JSON.stringify(versions, null, 2));
}
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP error: ${res.statusCode} ${res.statusMessage}`));
      }
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP error: ${res.statusCode} ${res.statusMessage}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}
async function checkForHotUpdates(mainWindow, manual) {
  try {
    if (getRuntimeBuildEnv().TARGET === "whatsapp") {
      console.log("[HotUpdater] WhatsApp build currently does not support hot updates, skipping.");
      if (!manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
      }
      return { status: "not-available", message: "WhatsApp channel skips hot updates." };
    }
    const serverUrl = true ? "https://shiflowagent-auto-update.oss-cn-beijing.aliyuncs.com/update-server" : "";
    if (!serverUrl) ;
    const manifestUrl = `${serverUrl}/latest.json`;
    console.log(`[HotUpdater] Checking for updates at ${manifestUrl}`);
    let manifestJson;
    try {
      manifestJson = await httpGet(manifestUrl);
    } catch (err) {
      console.log("[HotUpdater] Cannot reach update server, skipping.", err);
      if (!manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
      }
      return { status: "error", message: "Cannot reach update server" };
    }
    const manifest = JSON.parse(manifestJson);
    if (!manifest.assets) {
      console.log("[HotUpdater] Invalid manifest, skipping.");
      return { status: "error", message: "Invalid manifest" };
    }
    const shellVersion = electron.app.getVersion();
    if (manifest.minShellVersion && semver.valid(manifest.minShellVersion) && semver.valid(shellVersion) && semver.lt(shellVersion, manifest.minShellVersion)) {
      console.log(
        `[HotUpdater] Shell version ${shellVersion} < minShellVersion ${manifest.minShellVersion}, skipping hot update. Shell update required first.`
      );
      if (!manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
      }
      return {
        status: "not-available",
        message: `Shell version too old (${shellVersion} < ${manifest.minShellVersion}). Please update the application first.`
      };
    }
    const localVersions = readLocalVersions();
    const remoteVersion = manifest.displayVersion;
    const localVersion = localVersions.displayVersion;
    if (localVersion && remoteVersion && !semver.gt(remoteVersion, localVersion)) {
      console.log(
        `[HotUpdater] Already up to date or remote is older (local: ${localVersion}, remote: ${remoteVersion}).`
      );
      if (!manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
      }
      return { status: "not-available" };
    }
    console.log(`[HotUpdater] Update available: ${localVersion || "none"} → ${remoteVersion}`);
    const assetsToUpdate = Object.entries(
      manifest.assets
    ).map(([name, info]) => ({ name, info }));
    const downloadResults = [];
    const failedAssets = [];
    await Promise.all(
      assetsToUpdate.map(async ({ name, info }) => {
        const downloadUrl = `${serverUrl}/${info.file}`;
        console.log(`[HotUpdater] Downloading ${name} to memory from ${downloadUrl}`);
        try {
          const buffer = await downloadToBuffer(downloadUrl);
          const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
          if (actualHash !== info.sha256) {
            console.error(
              `[HotUpdater] SHA256 mismatch for ${name}: expected ${info.sha256}, got ${actualHash}`
            );
            failedAssets.push(name);
            return;
          }
          console.log(`[HotUpdater] ${name} downloaded and verified (${buffer.length} bytes)`);
          downloadResults.push({ name, buffer, fileName: path.basename(info.file) });
        } catch (err) {
          console.error(`[HotUpdater] Download failed for ${name}:`, err);
          failedAssets.push(name);
        }
      })
    );
    if (failedAssets.length > 0) {
      console.error(
        `[HotUpdater] ${failedAssets.length}/${assetsToUpdate.length} assets failed. Failed: [${failedAssets.join(", ")}]. Aborting update, nothing written to disk.`
      );
      if (!manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
      }
      return {
        status: "error",
        message: `Download/validation failed: ${failedAssets.join(", ")}. No changes applied.`
      };
    }
    console.log(`[HotUpdater] All ${assetsToUpdate.length} assets verified, writing to disk...`);
    const updatedAssets = {};
    for (const { name, buffer, fileName } of downloadResults) {
      const assetDir = path.join(electron.app.getPath("userData"), name);
      fs.mkdirSync(assetDir, { recursive: true });
      const tarPath = path.join(assetDir, fileName);
      fs.writeFileSync(tarPath, buffer);
      child_process.execSync(`tar -xzf "${tarPath}" -C "${assetDir}"`);
      try {
        fs.unlinkSync(tarPath);
      } catch {
      }
      console.log(`[HotUpdater] ${name} installed successfully`);
      updatedAssets[name] = remoteVersion;
    }
    writeLocalVersions({ displayVersion: remoteVersion });
    console.log(
      `[HotUpdater] All ${assetsToUpdate.length} assets updated successfully, version: ${remoteVersion}`
    );
    const isForceUpdate = !!manifest.forceUpdate;
    const forceUpdateMessage = manifest.forceUpdateMessage || "";
    console.log(
      `[HotUpdater] Update ready: ${JSON.stringify(updatedAssets)}, forceUpdate=${isForceUpdate}`
    );
    if (!manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("HOT_UPDATE_READY", {
        assets: updatedAssets,
        forceUpdate: isForceUpdate,
        forceUpdateMessage,
        newVersion: remoteVersion
      });
    }
    return {
      status: "ready",
      assets: updatedAssets,
      forceUpdate: isForceUpdate,
      newVersion: remoteVersion
    };
  } catch (err) {
    console.error("[HotUpdater] Update check failed:", err);
    if (!manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("HOT_UPDATE_NOT_AVAILABLE");
    }
    return { status: "error", message: String(err) };
  }
}
function initHotUpdater(mainWindow) {
  electron.ipcMain.removeHandler("CHECK_HOT_UPDATE");
  electron.ipcMain.removeHandler("RESTART_FOR_HOT_UPDATE");
  electron.ipcMain.removeHandler("CLEAR_HOT_CACHE");
  electron.ipcMain.handle("CHECK_HOT_UPDATE", async () => {
    return await checkForHotUpdates(mainWindow, true);
  });
  electron.ipcMain.handle("RESTART_FOR_HOT_UPDATE", () => {
    electron.app.relaunch();
    electron.app.quit();
  });
  electron.ipcMain.handle("CLEAR_HOT_CACHE", () => {
    const userDataPath = electron.app.getPath("userData");
    const targets = [
      path.join(userDataPath, "logs"),
      path.join(userDataPath, "click-debug"),
      path.join(userDataPath, "screenshot-diffs")
    ];
    const safeClearTarget = (targetPath) => {
      if (!fs.existsSync(targetPath)) return;
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(targetPath);
        for (const file of files) {
          const curPath = path.join(targetPath, file);
          safeClearTarget(curPath);
        }
        try {
          fs.rmdirSync(targetPath);
        } catch {
        }
      } else {
        try {
          fs.unlinkSync(targetPath);
          console.log(`[HotUpdater] Deleted file: ${targetPath}`);
        } catch (err) {
          try {
            fs.writeFileSync(targetPath, "", "utf8");
            console.log(`[HotUpdater] Truncated busy file: ${targetPath}`);
          } catch (writeErr) {
            console.error(`[HotUpdater] Failed to truncate file ${targetPath}:`, writeErr);
          }
        }
      }
    };
    for (const target of targets) {
      try {
        safeClearTarget(target);
        console.log(`[HotUpdater] Finished clearing target: ${target}`);
      } catch (err) {
        console.error(`[HotUpdater] Exception during clearing ${target}:`, err);
      }
    }
    return { success: true };
  });
  if (electron.app.isPackaged) {
    checkForHotUpdates(mainWindow, false);
  } else {
    console.log("[HotUpdater] Dev mode, skipping automatic update check.");
  }
}
let forceQuit = false;
function shouldForceQuit() {
  return forceQuit;
}
function markForceQuit() {
  forceQuit = true;
}
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1e3;
const TAG = "[AutoUpdater]";
let initialized$1 = false;
let mainWindowRef$1 = null;
function sendToRenderer(channel, ...args) {
  try {
    if (mainWindowRef$1 && !mainWindowRef$1.isDestroyed()) {
      mainWindowRef$1.webContents.send(channel, ...args);
    }
  } catch (error) {
    log.warn(`${TAG} Failed to send ${channel} to renderer:`, error);
  }
}
function initAutoUpdater(mainWindow) {
  if (initialized$1) {
    log.warn(`${TAG} Already initialized, skipping.`);
    return;
  }
  initialized$1 = true;
  mainWindowRef$1 = mainWindow;
  if (!electron.app.isPackaged) {
    electron.ipcMain.handle("CHECK_FOR_UPDATES", async () => null);
    electron.ipcMain.handle("DOWNLOAD_UPDATE", async () => null);
    electron.ipcMain.handle("QUIT_AND_INSTALL", () => void 0);
    return;
  }
  electronUpdater.autoUpdater.logger = log;
  electronUpdater.autoUpdater.autoDownload = true;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  electronUpdater.autoUpdater.autoRunAppAfterInstall = true;
  const customUrlArg = process.argv.find((arg) => arg.startsWith("--auto-update-url="));
  const customUrl = customUrlArg?.split("=")[1];
  if (customUrl) {
    log.info(`${TAG} Overriding feed URL with: ${customUrl}`);
    electronUpdater.autoUpdater.setFeedURL({ provider: "generic", url: customUrl });
  }
  log.info(`${TAG} Initialized. Current version: ${electron.app.getVersion()}`);
  electron.ipcMain.handle("CHECK_FOR_UPDATES", async () => {
    log.info(`${TAG} Manual check triggered via IPC.`);
    try {
      const result = await electronUpdater.autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    } catch (error) {
      log.error(`${TAG} CHECK_FOR_UPDATES error:`, error);
      return null;
    }
  });
  electron.ipcMain.handle("DOWNLOAD_UPDATE", async () => {
    log.info(`${TAG} Manual download triggered via IPC.`);
    try {
      await electronUpdater.autoUpdater.downloadUpdate();
    } catch (error) {
      log.error(`${TAG} DOWNLOAD_UPDATE error:`, error);
      throw error;
    }
  });
  electron.ipcMain.handle("QUIT_AND_INSTALL", () => {
    log.info(`${TAG} Quit and install triggered via IPC.`);
    markForceQuit();
    electronUpdater.autoUpdater.quitAndInstall();
  });
  electronUpdater.autoUpdater.on("checking-for-update", () => {
    log.info(`${TAG} Checking for update...`);
    sendToRenderer("CHECKING_FOR_UPDATE");
  });
  electronUpdater.autoUpdater.on("update-available", (info) => {
    log.info(`${TAG} Update available: v${info.version}`);
    sendToRenderer("UPDATE_AVAILABLE", {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate
    });
  });
  electronUpdater.autoUpdater.on("update-not-available", (info) => {
    log.info(`${TAG} No update available. Latest: v${info.version}`);
    sendToRenderer("UPDATE_NOT_AVAILABLE", {
      version: info.version
    });
  });
  electronUpdater.autoUpdater.on("download-progress", (progress) => {
    log.info(
      `${TAG} Download progress: ${progress.percent.toFixed(1)}% (${progress.bytesPerSecond} B/s)`
    );
    sendToRenderer("DOWNLOAD_PROGRESS", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });
  electronUpdater.autoUpdater.on("update-downloaded", (info) => {
    log.info(`${TAG} Update downloaded: v${info.version}. Ready to install.`);
    sendToRenderer("UPDATE_DOWNLOADED", {
      version: info.version
    });
  });
  electronUpdater.autoUpdater.on("error", (error) => {
    log.error(`${TAG} Error:`, error);
    sendToRenderer("UPDATE_ERROR", {
      message: error.message || "Unknown update error",
      stack: error.stack,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  setInterval(() => {
    log.info(`${TAG} Periodic update check...`);
    electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
      log.error(`${TAG} Periodic check failed:`, err);
    });
  }, CHECK_INTERVAL_MS);
}
const WINDOW_OCCLUSION_IPC_CHANNELS = {
  start: "WINDOW_OCCLUSION_START",
  stop: "WINDOW_OCCLUSION_STOP",
  check: "WINDOW_OCCLUSION_CHECK",
  focus: "WINDOW_OCCLUSION_FOCUS",
  helperIdentity: "WINDOW_OCCLUSION_HELPER_IDENTITY",
  restartHelperIdentity: "WINDOW_OCCLUSION_RESTART_HELPER_IDENTITY",
  terminateHelper: "WINDOW_OCCLUSION_TERMINATE_HELPER",
  changed: "WINDOW_OCCLUSION_CHANGED",
  failed: "WINDOW_OCCLUSION_FAILED"
};
const createRandomizedWindowHelperRuntimeIdentity = (runId) => ({
  tempDirectoryPrefix: "runtime-worker-",
  bundleName: `RuntimeWorker-${runId}`,
  executableName: `rw_${runId}`,
  bundleIdentifier: `local.runtime.worker.r${runId}`
});
const COMMAND_TIMEOUT_MS = 5e3;
function errorMessage$2(error) {
  return error instanceof Error ? error.message : String(error);
}
function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
function parseCodesignField(output, name) {
  const match = output.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match?.[1]?.trim() || "";
}
function readCodeSignature(executablePath) {
  const result = child_process.spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", executablePath], {
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}
${result.stderr || ""}`;
  return {
    signatureKind: parseCodesignField(output, "Signature") || "unknown",
    signatureIdentifier: parseCodesignField(output, "Identifier"),
    teamIdentifier: parseCodesignField(output, "TeamIdentifier"),
    cdHash: parseCodesignField(output, "CDHash")
  };
}
function runCodesign(args) {
  const result = child_process.spawnSync("/usr/bin/codesign", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "codesign 执行失败").trim());
  }
}
class WindowOcclusionHelper extends events.EventEmitter {
  child = null;
  starting = null;
  stdoutBuffer = "";
  nextCommandId = 1;
  pendingCommands = /* @__PURE__ */ new Map();
  identityTestTempDirs = /* @__PURE__ */ new Set();
  identity = null;
  disposed = false;
  resolveExecutablePath() {
    if (electron.app.isPackaged) {
      return path.join(process.resourcesPath, "helper-mac", "window-occlusion-helper");
    }
    return path.join(__dirname, "..", "helper-mac", "window-occlusion-helper");
  }
  prepareFixedIdentity(sourceExecutablePath) {
    const sourceSha256 = sha256File(sourceExecutablePath);
    return {
      mode: "fixed",
      runId: `fixed-${crypto.randomBytes(4).toString("hex")}`,
      sourceExecutablePath,
      executablePath: sourceExecutablePath,
      executableName: path.basename(sourceExecutablePath),
      sourceSha256,
      unsignedCopySha256: sourceSha256,
      runtimeSha256: sourceSha256,
      ...readCodeSignature(sourceExecutablePath)
    };
  }
  resolveRandomizedIdentityMode() {
    const environmentOverride = process.env.SHIFLOW_WINDOW_HELPER_IDENTITY_TEST;
    if (environmentOverride === "0") return null;
    if (!electron.app.isPackaged) return "randomized-dev-test";
    if (environmentOverride === "1") return "randomized-packaged-test";
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(electron.app.getAppPath(), "package.json"), "utf8")
      );
      return metadata.windowHelperIdentityTest === true ? "randomized-packaged-test" : null;
    } catch (error) {
      console.warn("[WindowOcclusion] 读取打包 Helper 身份模式失败:", errorMessage$2(error));
      return null;
    }
  }
  prepareRandomizedIdentity(sourceExecutablePath, mode) {
    const runId = crypto.randomBytes(6).toString("hex");
    const runtimeIdentity = createRandomizedWindowHelperRuntimeIdentity(runId);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), runtimeIdentity.tempDirectoryPrefix));
    const bundlePath = path.join(tempRoot, `${runtimeIdentity.bundleName}.app`);
    const macOSDir = path.join(bundlePath, "Contents", "MacOS");
    const executableName = runtimeIdentity.executableName;
    const executablePath = path.join(macOSDir, executableName);
    const manifestPath = path.join(tempRoot, "identity-ground-truth.json");
    fs.mkdirSync(macOSDir, { recursive: true });
    fs.copyFileSync(sourceExecutablePath, executablePath);
    fs.chmodSync(executablePath, 493);
    const sourceSha256 = sha256File(sourceExecutablePath);
    const unsignedCopySha256 = sha256File(executablePath);
    fs.writeFileSync(
      path.join(bundlePath, "Contents", "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        "<key>CFBundlePackageType</key><string>APPL</string>",
        "<key>LSUIElement</key><true/>",
        `<key>CFBundleIdentifier</key><string>${runtimeIdentity.bundleIdentifier}</string>`,
        `<key>CFBundleName</key><string>${runtimeIdentity.bundleName}</string>`,
        `<key>CFBundleExecutable</key><string>${executableName}</string>`,
        "</dict></plist>"
      ].join("\n"),
      "utf8"
    );
    runCodesign(["--sign", "-", "--force", "--deep", bundlePath]);
    runCodesign(["--verify", "--strict", "--deep", bundlePath]);
    this.identityTestTempDirs.add(tempRoot);
    return {
      mode,
      runId,
      sourceExecutablePath,
      executablePath,
      executableName,
      bundlePath,
      manifestPath,
      sourceSha256,
      unsignedCopySha256,
      runtimeSha256: sha256File(executablePath),
      ...readCodeSignature(executablePath)
    };
  }
  prepareIdentity(sourceExecutablePath) {
    const randomizedMode = this.resolveRandomizedIdentityMode();
    return randomizedMode ? this.prepareRandomizedIdentity(sourceExecutablePath, randomizedMode) : this.prepareFixedIdentity(sourceExecutablePath);
  }
  writeIdentityManifest(identity) {
    if (!identity.manifestPath) return;
    fs.writeFileSync(identity.manifestPath, `${JSON.stringify(identity, null, 2)}
`, "utf8");
  }
  startProcess() {
    const sourceExecutablePath = this.resolveExecutablePath();
    if (!fs.existsSync(sourceExecutablePath)) {
      return Promise.reject(
        new Error(
          `未找到窗口遮挡 Helper：${sourceExecutablePath}。请先运行 npm run build:helper:mac`
        )
      );
    }
    try {
      fs.accessSync(sourceExecutablePath, fs.constants.X_OK);
    } catch {
      return Promise.reject(new Error(`窗口遮挡 Helper 不可执行：${sourceExecutablePath}`));
    }
    let preparedIdentity;
    try {
      preparedIdentity = this.prepareIdentity(sourceExecutablePath);
    } catch (error) {
      return Promise.reject(new Error(`准备窗口遮挡 Helper 随机身份失败：${errorMessage$2(error)}`));
    }
    return new Promise((resolve, reject) => {
      const child = child_process.spawn(preparedIdentity.executablePath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      this.child = child;
      this.stdoutBuffer = "";
      const onSpawnError = (error) => {
        if (this.child === child) this.child = null;
        reject(new Error(`启动窗口遮挡 Helper 失败：${error.message}`));
      };
      child.once("error", onSpawnError);
      child.once("spawn", () => {
        child.removeListener("error", onSpawnError);
        child.on("error", (error) => {
          console.error("[WindowOcclusion] Helper process error:", error);
        });
        if (typeof child.pid !== "number") {
          child.kill("SIGTERM");
          reject(new Error("窗口遮挡 Helper 启动后未返回 PID"));
          return;
        }
        this.identity = {
          ...preparedIdentity,
          pid: child.pid,
          parentPid: process.pid,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.writeIdentityManifest(this.identity);
        console.log(
          `[WindowOcclusion] Helper ready mode=${this.identity.mode} pid=${this.identity.pid} signature=${this.identity.signatureKind}`
        );
        resolve();
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.handleStdout(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const message = chunk.trim();
        if (message) console.warn("[WindowOcclusion][helper]", message);
      });
      child.once("exit", (code, signal) => this.handleExit(child, code, signal));
    });
  }
  async ensureProcess() {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    if (this.starting) return this.starting;
    if (this.disposed) throw new Error("窗口遮挡 Helper 已关闭");
    if (process.platform !== "darwin") throw new Error("窗口遮挡检测仅支持 macOS");
    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }
  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("[WindowOcclusion] Helper returned invalid JSON:", line.slice(0, 500));
      return;
    }
    if (message.type === "visibility") {
      this.emit("visibility", message.payload);
      return;
    }
    if (message.type === "workspace") {
      this.emit("workspace", message.payload);
      return;
    }
    if (message.type !== "response" || typeof message.id !== "string") return;
    const pending = this.pendingCommands.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingCommands.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "窗口遮挡 Helper 命令失败"));
    }
  }
  handleExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    this.stdoutBuffer = "";
    const error = new Error(
      `窗口遮挡 Helper 已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`
    );
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingCommands.clear();
    if (!this.disposed) {
      console.warn("[WindowOcclusion]", error.message);
      this.emit("helper-exit", error);
    }
  }
  async sendCommand(command, payload = {}) {
    await this.ensureProcess();
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) {
      throw new Error("窗口遮挡 Helper 未运行");
    }
    const id = String(this.nextCommandId++);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`窗口遮挡 Helper 命令超时：${command}`));
      }, COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(id, {
        resolve: (value) => resolve(value),
        reject,
        timeout
      });
      const body = `${JSON.stringify({ id, command, ...payload })}
`;
      child.stdin.write(body, "utf8", (error) => {
        if (!error) return;
        const pending = this.pendingCommands.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(id);
        pending.reject(new Error(`发送窗口遮挡 Helper 命令失败：${errorMessage$2(error)}`));
      });
    });
  }
  async watch(request) {
    const result = await this.sendCommand("watch", request);
    if (!result) throw new Error("窗口遮挡 Helper 未返回初始状态");
    return result;
  }
  async check(request) {
    const result = await this.sendCommand("check", request);
    if (!result) throw new Error("窗口遮挡 Helper 未返回检查结果");
    return result;
  }
  async focus(request) {
    const result = await this.sendCommand("focus", request);
    if (!result) throw new Error("窗口遮挡 Helper 未返回置前结果");
    return result;
  }
  async resolveBrowserContentBounds(request) {
    const result = await this.sendCommand("browser-content", {
      windowId: request.nativeWindowId,
      processId: request.processId
    });
    if (!result) throw new Error("窗口遮挡 Helper 未返回网页内容区域");
    return result;
  }
  async resolveWindowInteractions() {
    const result = await this.sendCommand("window-interactions");
    if (!result) throw new Error("窗口遮挡 Helper 未返回窗口输入属性");
    return result;
  }
  async getIdentity() {
    await this.ensureProcess();
    if (!this.identity) throw new Error("窗口遮挡 Helper 未返回运行身份");
    return this.identity;
  }
  async terminateProcess(reason) {
    if (this.starting) await this.starting;
    const child = this.child;
    this.child = null;
    this.identity = null;
    this.stdoutBuffer = "";
    const terminationError = new Error(reason);
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(terminationError);
    }
    this.pendingCommands.clear();
    if (child && child.exitCode === null && !child.killed) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1e3);
        timeout.unref();
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
  }
  async terminate() {
    await this.terminateProcess("窗口遮挡 Helper 已随截图任务停止");
  }
  async restartIdentityTest() {
    if (!this.resolveRandomizedIdentityMode()) {
      throw new Error("当前应用未启用随机 Helper 身份验证模式");
    }
    await this.terminateProcess("窗口遮挡 Helper 正在切换测试身份");
    await this.ensureProcess();
    if (!this.identity) throw new Error("窗口遮挡 Helper 重启后未返回运行身份");
    return this.identity;
  }
  async stopWatch() {
    if (!this.child || this.child.exitCode !== null || this.child.killed) return;
    await this.sendCommand("stop");
  }
  async watchWorkspaces() {
    await this.sendCommand("watch-workspaces");
  }
  async stopWorkspaceWatch() {
    if (!this.child || this.child.exitCode !== null || this.child.killed) return;
    await this.sendCommand("stop-workspaces");
  }
  dispose() {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("应用正在退出"));
    }
    this.pendingCommands.clear();
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
    for (const tempDir of this.identityTestTempDirs) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("[WindowOcclusion] 清理 Helper 身份测试目录失败:", errorMessage$2(error));
      }
    }
    this.identityTestTempDirs.clear();
    this.removeAllListeners();
  }
}
const helper$2 = new WindowOcclusionHelper();
const subscribers = /* @__PURE__ */ new Map();
const visibilitySubscribers = /* @__PURE__ */ new Set();
const activeSpaceSubscribers = /* @__PURE__ */ new Set();
let initialized = false;
let activeSpaceWatchStarted = false;
let activeSpaceWatchStarting = null;
function errorMessage$1(error) {
  return error instanceof Error ? error.message : String(error);
}
function isValidRequest(request) {
  if (!request || typeof request !== "object") return false;
  const candidate = request;
  return typeof candidate.keyword === "string" && candidate.keyword.trim().length > 0 || Array.isArray(candidate.bundleIdentifiers) && candidate.bundleIdentifiers.some(
    (bundleIdentifier) => typeof bundleIdentifier === "string" && bundleIdentifier.trim().length > 0
  ) || typeof candidate.windowId === "number" && Number.isInteger(candidate.windowId) && candidate.windowId > 0;
}
function subscribe(sender) {
  if (subscribers.has(sender.id)) return;
  subscribers.set(sender.id, sender);
  sender.once("destroyed", () => {
    subscribers.delete(sender.id);
    if (subscribers.size === 0 && visibilitySubscribers.size === 0) {
      void helper$2.stopWatch().catch((error) => {
        console.warn("[WindowOcclusion] 停止无人订阅的监听失败:", errorMessage$1(error));
      });
    }
  });
}
function broadcast(result) {
  for (const [id, subscriber] of subscribers) {
    if (subscriber.isDestroyed()) {
      subscribers.delete(id);
      continue;
    }
    subscriber.send(WINDOW_OCCLUSION_IPC_CHANNELS.changed, result);
  }
  for (const listener of visibilitySubscribers) {
    try {
      listener(result);
    } catch (error) {
      console.warn("[WindowOcclusion] 可见性监听回调失败:", errorMessage$1(error));
    }
  }
}
function broadcastFailure(error) {
  for (const subscriber of subscribers.values()) {
    if (!subscriber.isDestroyed()) {
      subscriber.send(WINDOW_OCCLUSION_IPC_CHANNELS.failed, { error: error.message });
    }
  }
}
function broadcastActiveSpaceChange(event) {
  for (const subscriber of activeSpaceSubscribers) subscriber(event);
}
async function ensureActiveSpaceWatch() {
  if (process.platform !== "darwin" || activeSpaceWatchStarted) return;
  if (activeSpaceWatchStarting) return activeSpaceWatchStarting;
  activeSpaceWatchStarting = (async () => {
    await helper$2.watchWorkspaces();
    activeSpaceWatchStarted = true;
    if (activeSpaceSubscribers.size === 0) {
      activeSpaceWatchStarted = false;
      await helper$2.stopWorkspaceWatch();
    }
  })();
  try {
    await activeSpaceWatchStarting;
  } finally {
    activeSpaceWatchStarting = null;
  }
}
async function stopUnusedActiveSpaceWatch() {
  if (activeSpaceWatchStarting) {
    try {
      await activeSpaceWatchStarting;
    } catch {
      return;
    }
  }
  if (activeSpaceSubscribers.size > 0 || !activeSpaceWatchStarted) return;
  activeSpaceWatchStarted = false;
  await helper$2.stopWorkspaceWatch();
  if (activeSpaceSubscribers.size > 0) await ensureActiveSpaceWatch();
}
function subscribeActiveSpaceChanges(listener) {
  if (process.platform !== "darwin") return () => void 0;
  activeSpaceSubscribers.add(listener);
  void ensureActiveSpaceWatch().catch((error) => {
    console.warn("[WindowOcclusion] 启动 Space 变化监听失败:", errorMessage$1(error));
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    activeSpaceSubscribers.delete(listener);
    void stopUnusedActiveSpaceWatch().catch((error) => {
      console.warn("[WindowOcclusion] 停止 Space 变化监听失败:", errorMessage$1(error));
    });
  };
}
async function resolveMacBrowserContentBounds(request) {
  if (process.platform !== "darwin") {
    return { success: false, error: "macOS 网页内容区域识别仅支持 macOS" };
  }
  try {
    return await helper$2.resolveBrowserContentBounds(request);
  } catch (error) {
    return { success: false, error: errorMessage$1(error) };
  }
}
async function resolveMacWindowInteractions() {
  if (process.platform !== "darwin") {
    return {
      success: false,
      source: "mac-window-tags",
      records: [],
      error: "macOS 窗口输入属性识别仅支持 macOS"
    };
  }
  try {
    return await helper$2.resolveWindowInteractions();
  } catch (error) {
    return {
      success: false,
      source: "mac-window-tags",
      records: [],
      error: errorMessage$1(error)
    };
  }
}
async function focusMacTargetWindow(request) {
  if (process.platform !== "darwin") {
    return { success: false, error: "窗口置前仅支持 macOS" };
  }
  if (!isValidRequest(request)) {
    return { success: false, error: "请输入目标应用名或窗口标题关键词" };
  }
  try {
    const result = await helper$2.focus({
      ...request,
      keyword: request.keyword?.trim(),
      bundleIdentifiers: request.bundleIdentifiers?.map((value) => value.trim()).filter(Boolean)
    });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: errorMessage$1(error) };
  }
}
async function checkMacTargetWindow(request) {
  if (process.platform !== "darwin") {
    return { success: false, error: "窗口遮挡检测仅支持 macOS" };
  }
  if (!isValidRequest(request)) {
    return { success: false, error: "请输入目标应用名或窗口标题关键词" };
  }
  try {
    const result = await helper$2.check({
      ...request,
      keyword: request.keyword?.trim(),
      bundleIdentifiers: request.bundleIdentifiers?.map((value) => value.trim()).filter(Boolean)
    });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: errorMessage$1(error) };
  }
}
async function startMacTargetWindowWatch(request) {
  if (process.platform !== "darwin") {
    return { success: false, error: "窗口遮挡检测仅支持 macOS" };
  }
  if (!isValidRequest(request)) {
    return { success: false, error: "请输入目标应用名或窗口标题关键词" };
  }
  try {
    const result = await helper$2.watch({
      ...request,
      keyword: request.keyword?.trim(),
      bundleIdentifiers: request.bundleIdentifiers?.map((value) => value.trim()).filter(Boolean),
      watchdogMs: request.watchdogMs ?? 2e3
    });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: errorMessage$1(error) };
  }
}
function subscribeMacTargetWindowVisibility(listener) {
  if (process.platform !== "darwin") return () => void 0;
  visibilitySubscribers.add(listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    visibilitySubscribers.delete(listener);
    if (subscribers.size > 0 || visibilitySubscribers.size > 0) return;
    void helper$2.stopWatch().catch((error) => {
      console.warn("[WindowOcclusion] 停止无人订阅的监听失败:", errorMessage$1(error));
    });
  };
}
function initializeWindowOcclusionIpc() {
  if (initialized) return;
  initialized = true;
  helper$2.on("visibility", broadcast);
  helper$2.on("workspace", broadcastActiveSpaceChange);
  helper$2.on("helper-exit", (error) => {
    activeSpaceWatchStarted = false;
    console.warn("[WindowOcclusion] Helper 异常退出:", error.message);
    broadcastFailure(error);
    if (activeSpaceSubscribers.size > 0) {
      setTimeout(() => {
        void ensureActiveSpaceWatch().catch((restartError) => {
          console.warn("[WindowOcclusion] 恢复 Space 变化监听失败:", errorMessage$1(restartError));
        });
      }, 250);
    }
  });
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.start,
    async (event, request) => {
      if (process.platform !== "darwin") {
        return { success: false, error: "窗口遮挡检测仅支持 macOS" };
      }
      if (!isValidRequest(request)) {
        return { success: false, error: "请输入目标应用名或窗口标题关键词" };
      }
      subscribe(event.sender);
      const response = await startMacTargetWindowWatch(request);
      if (!response.success) {
        subscribers.delete(event.sender.id);
      }
      return response;
    }
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.check,
    async (_event, request) => checkMacTargetWindow(request)
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.focus,
    async (_event, request) => focusMacTargetWindow(request)
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.helperIdentity,
    async () => {
      if (process.platform !== "darwin") {
        return { success: false, error: "Helper 身份测试仅支持 macOS" };
      }
      try {
        return { success: true, identity: await helper$2.getIdentity() };
      } catch (error) {
        return { success: false, error: errorMessage$1(error) };
      }
    }
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.restartHelperIdentity,
    async () => {
      if (process.platform !== "darwin") {
        return { success: false, error: "Helper 身份测试仅支持 macOS" };
      }
      subscribers.clear();
      try {
        return { success: true, identity: await helper$2.restartIdentityTest() };
      } catch (error) {
        return { success: false, error: errorMessage$1(error) };
      }
    }
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.terminateHelper,
    async () => {
      subscribers.clear();
      try {
        await helper$2.terminate();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage$1(error) };
      }
    }
  );
  electron.ipcMain.handle(
    WINDOW_OCCLUSION_IPC_CHANNELS.stop,
    async (event) => {
      subscribers.delete(event.sender.id);
      if (subscribers.size > 0 || visibilitySubscribers.size > 0) return { success: true };
      try {
        await helper$2.stopWatch();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage$1(error) };
      }
    }
  );
}
function disposeWindowOcclusionIpc() {
  if (!initialized) return;
  initialized = false;
  subscribers.clear();
  visibilitySubscribers.clear();
  activeSpaceSubscribers.clear();
  activeSpaceWatchStarted = false;
  activeSpaceWatchStarting = null;
  helper$2.dispose();
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.start);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.check);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.focus);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.helperIdentity);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.restartHelperIdentity);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.terminateHelper);
  electron.ipcMain.removeHandler(WINDOW_OCCLUSION_IPC_CHANNELS.stop);
}
const MIN_VIEWPORT_WIDTH_RATIO = 0.9;
const MIN_VIEWPORT_HEIGHT_RATIO = 0.5;
const MAX_SIDE_INSET = 24;
const MAX_BOTTOM_INSET = 24;
const MIN_TOP_INSET = -8;
const MAX_TOP_INSET = 280;
const finiteRect$1 = (value) => {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.width) || !Number.isFinite(value.height) || Number(value.width) < 100 || Number(value.height) < 100) {
    return null;
  }
  return {
    x: Math.round(Number(value.x)),
    y: Math.round(Number(value.y)),
    width: Math.round(Number(value.width)),
    height: Math.round(Number(value.height))
  };
};
const intersectRect = (content, window) => {
  const left = Math.max(content.x, window.x);
  const top = Math.max(content.y, window.y);
  const right = Math.min(content.x + content.width, window.x + window.width);
  const bottom = Math.min(content.y + content.height, window.y + window.height);
  return finiteRect$1({ x: left, y: top, width: right - left, height: bottom - top });
};
function assessBrowserContentBounds(contentValue, windowValue) {
  const content = finiteRect$1(contentValue);
  const window = finiteRect$1(windowValue);
  if (!content || !window) return { valid: false, reason: "invalid_rect" };
  const contained = intersectRect(content, window);
  if (!contained) return { valid: false, reason: "outside_window" };
  const leftInset = contained.x - window.x;
  const rightInset = window.x + window.width - (contained.x + contained.width);
  const topInset = contained.y - window.y;
  const bottomInset = window.y + window.height - (contained.y + contained.height);
  const widthRatio = contained.width / window.width;
  const heightRatio = contained.height / window.height;
  const maxTopInset = Math.min(MAX_TOP_INSET, Math.max(80, window.height * 0.35));
  if (widthRatio < MIN_VIEWPORT_WIDTH_RATIO) {
    return { valid: false, reason: "viewport_too_narrow" };
  }
  if (heightRatio < MIN_VIEWPORT_HEIGHT_RATIO) {
    return { valid: false, reason: "viewport_too_short" };
  }
  if (leftInset > MAX_SIDE_INSET || rightInset > MAX_SIDE_INSET) {
    return { valid: false, reason: "viewport_side_misaligned" };
  }
  if (bottomInset > MAX_BOTTOM_INSET) {
    return { valid: false, reason: "viewport_bottom_misaligned" };
  }
  if (topInset < MIN_TOP_INSET || topInset > maxTopInset) {
    return { valid: false, reason: "viewport_top_inset_invalid" };
  }
  return {
    valid: true,
    bounds: contained,
    score: Math.abs(leftInset) + Math.abs(rightInset) + Math.abs(bottomInset) + Math.max(0, topInset) / 100
  };
}
function selectBrowserContentBounds(candidates, window) {
  let best = null;
  for (const candidate of candidates) {
    const assessment = assessBrowserContentBounds(candidate, window);
    if (!assessment.valid) continue;
    const depth = Number.isFinite(candidate?.depth) ? Math.max(0, Number(candidate?.depth)) : 0;
    const rankedAssessment = {
      ...assessment,
      score: depth * 1e4 + Number(assessment.score)
    };
    if (!best || Number(rankedAssessment.score) < Number(best.score)) best = rankedAssessment;
  }
  return best || { valid: false, reason: "no_plausible_viewport" };
}
function approximatelySameBrowserRect(a, b, tolerance = 2) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}
const HELPER_START_TIMEOUT_MS = 1e4;
const QUERY_TIMEOUT_MS = 3e3;
const MAX_UIA_NODES = 1500;
const WINDOWS_UIA_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Send-ShiflowResponse {
  param([object]$Value)
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 6))
  [Console]::Out.Flush()
}

# Initialize the UIA client during prewarm; viewport geometry is read per query.
[void][System.Windows.Automation.AutomationElement]::RootElement
Send-ShiflowResponse ([ordered]@{ type = 'ready' })

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $requestId = ''
  try {
    $request = ConvertFrom-Json -InputObject $line
    $requestId = [string]$request.id
    $windowId = [Int64]$request.windowId
    if ($windowId -le 0) { throw 'Invalid browser window handle' }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$windowId)
    if ($null -eq $root) { throw 'UI Automation could not resolve the selected browser window' }

    $queue = [System.Collections.Generic.Queue[object]]::new()
    $queue.Enqueue([pscustomobject]@{ element = $root; depth = 0 })
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $candidates = [System.Collections.Generic.List[object]]::new()
    $visited = 0

    while ($queue.Count -gt 0 -and $visited -lt ${MAX_UIA_NODES}) {
      $item = $queue.Dequeue()
      $element = $item.element
      $depth = [int]$item.depth
      $visited++

      $isBrowserSurface = $false
      $className = ''
      $controlType = ''
      try {
        $className = [string]$element.Current.ClassName
        $controlType = [string]$element.Current.ControlType.ProgrammaticName
        $isBrowserSurface =
          $className -eq 'Chrome_RenderWidgetHostHWND' -or
          $controlType -eq 'ControlType.Document'
      } catch {
        continue
      }

      if ($isBrowserSurface) {
        try {
          if (-not $element.Current.IsOffscreen) {
            $rect = $element.Current.BoundingRectangle
            if ($rect.Width -gt 100 -and $rect.Height -gt 100) {
              $candidates.Add([ordered]@{
                x = [double]$rect.X
                y = [double]$rect.Y
                width = [double]$rect.Width
                height = [double]$rect.Height
                depth = $depth
                className = $className
                controlType = $controlType
              })
            }
          }
        } catch {
        }
        # Browser documents may contain thousands of page and iframe nodes.
        # The first browser surface on a branch is the top-level viewport candidate.
        continue
      }

      try {
        $child = $walker.GetFirstChild($element)
        while ($null -ne $child -and ($queue.Count + $visited) -lt ${MAX_UIA_NODES}) {
          $queue.Enqueue([pscustomobject]@{ element = $child; depth = $depth + 1 })
          $child = $walker.GetNextSibling($child)
        }
      } catch {
      }
    }

    $watch.Stop()
    Send-ShiflowResponse ([ordered]@{
      type = 'response'
      id = $requestId
      ok = $true
      result = [ordered]@{
        candidates = [object[]]$candidates.ToArray()
        visitedCount = $visited
        matchCount = $candidates.Count
        durationMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
      }
    })
  } catch {
    $watch.Stop()
    Send-ShiflowResponse ([ordered]@{
      type = 'response'
      id = $requestId
      ok = $false
      error = $_.Exception.Message
      durationMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
    })
  }
}
`;
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function parseMessage(line) {
  try {
    const value = JSON.parse(line);
    if (value.type === "ready") return { type: "ready" };
    if (value.type === "response" && typeof value.id === "string" && typeof value.ok === "boolean") {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}
class WindowsBrowserContentHelper {
  constructor(options = {}) {
    this.options = options;
    process.once("exit", this.onProcessExit);
  }
  child = null;
  starting = null;
  stdoutBuffer = "";
  nextRequestId = 1;
  pending = /* @__PURE__ */ new Map();
  cancelStartup = null;
  disposed = false;
  onProcessExit = () => this.dispose();
  async prewarm() {
    await this.ensureProcess();
  }
  dispose() {
    this.disposed = true;
    process.removeListener("exit", this.onProcessExit);
    this.stop();
  }
  start() {
    const startedAt = Date.now();
    const encodedScript = Buffer.from(WINDOWS_UIA_HELPER_SCRIPT, "utf16le").toString("base64");
    return new Promise((resolve, reject) => {
      const child = (this.options.spawnProcess ?? child_process.spawn)(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
      );
      this.child = child;
      this.stdoutBuffer = "";
      let settled = false;
      const startTimeout = setTimeout(() => {
        if (settled) return;
        this.stop(new Error(`Windows UIA Helper 启动超时（elapsedMs=${Date.now() - startedAt}）`));
      }, this.options.startupTimeoutMs ?? HELPER_START_TIMEOUT_MS);
      const failStart = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimeout);
        this.cancelStartup = null;
        reject(error);
      };
      this.cancelStartup = failStart;
      child.once("error", (error) => {
        if (this.child === child)
          this.stop(new Error(`Windows UIA Helper 进程失败：${error.message}`));
      });
      child.stdin.on("error", (error) => {
        if (this.child === child)
          this.stop(new Error(`Windows UIA Helper 输入流失败：${error.message}`));
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (this.child !== child) return;
        this.stdoutBuffer += chunk;
        let newlineIndex = this.stdoutBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
          const message = line ? parseMessage(line) : null;
          if (!message) {
            if (line) console.warn("[BrowserContent][WindowsUIA] Helper returned invalid JSON");
          } else if (message.type === "ready") {
            if (!settled) {
              settled = true;
              clearTimeout(startTimeout);
              this.cancelStartup = null;
              console.log("[BrowserContent][WindowsUIA] ready", {
                startupMs: Date.now() - startedAt
              });
              resolve(Date.now() - startedAt);
            }
          } else {
            this.handleResponse(message);
          }
          newlineIndex = this.stdoutBuffer.indexOf("\n");
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const message = chunk.trim();
        if (message) console.warn("[BrowserContent][WindowsUIA][helper]", message.slice(0, 1e3));
      });
      child.once("exit", (code, signal) => {
        if (this.child !== child) return;
        const error = new Error(
          `Windows UIA Helper 已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`
        );
        failStart(error);
        this.handleExit(child, error);
      });
    });
  }
  async ensureProcess() {
    if (this.disposed) throw new Error("Windows UIA Helper 已释放");
    if (this.starting) return await this.starting;
    if (this.child && this.child.exitCode === null && !this.child.killed) return null;
    if ((this.options.platform ?? process.platform) !== "win32")
      throw new Error("Windows UIA Helper 仅支持 Windows");
    this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
  handleResponse(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.ok && message.result) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "Windows UIA Helper 查询失败"));
    }
  }
  handleExit(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.stdoutBuffer = "";
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
  stop(error = new Error("Windows UIA Helper 已停止")) {
    this.cancelStartup?.(error);
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = "";
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    if (child && child.exitCode === null && !child.killed) child.kill();
  }
  async query(windowId) {
    const totalStartedAt = Date.now();
    const coldStartMs = await this.ensureProcess();
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) {
      throw new Error("Windows UIA Helper 未运行");
    }
    const id = String(this.nextRequestId++);
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error("Windows UIA Helper 查询超时");
        this.stop(error);
        reject(error);
      }, this.options.queryTimeoutMs ?? QUERY_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify({ id, windowId })}
`, "utf8", (error) => {
        if (!error) return;
        if (this.child === child)
          this.stop(new Error(`发送 Windows UIA 查询失败：${errorMessage(error)}`));
      });
    });
    return { ...result, coldStartMs, totalMs: Date.now() - totalStartedAt };
  }
}
let helper$1 = null;
async function queryWindowsBrowserContent(windowId) {
  helper$1 ||= new WindowsBrowserContentHelper();
  return await helper$1.query(windowId);
}
function prewarmWindowsBrowserContentHelper() {
  if (process.platform !== "win32") return;
  helper$1 ||= new WindowsBrowserContentHelper();
  void helper$1.prewarm().catch((error) => console.warn("[BrowserContent][WindowsUIA] 预热失败:", errorMessage(error)));
}
function disposeWindowsBrowserContentHelper() {
  helper$1?.dispose();
}
const VERIFIED_BOUNDS_CACHE_MS = 5 * 60 * 1e3;
const FRESH_BOUNDS_CACHE_MS = 1e4;
const verifiedBoundsByWindow = /* @__PURE__ */ new Map();
const finiteRect = (value) => {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.width) || !Number.isFinite(value.height) || Number(value.width) < 100 || Number(value.height) < 100) {
    return null;
  }
  return {
    x: Math.round(Number(value.x)),
    y: Math.round(Number(value.y)),
    width: Math.round(Number(value.width)),
    height: Math.round(Number(value.height))
  };
};
async function resolveWindowsBrowserContentBounds(request) {
  try {
    const query = await queryWindowsBrowserContent(request.nativeWindowId);
    const dipCandidates = query.candidates.map((candidate) => {
      const physicalBounds = finiteRect(candidate);
      const dipBounds = physicalBounds ? finiteRect(electron.screen.screenToDipRect(null, physicalBounds)) : null;
      return dipBounds ? { ...dipBounds, depth: candidate.depth } : null;
    }).filter((candidate) => Boolean(candidate));
    const selected = selectBrowserContentBounds(dipCandidates, request.windowBounds);
    console.log("[BrowserContent][WindowsUIA] viewport query:", {
      nativeWindowId: request.nativeWindowId,
      coldStartMs: query.coldStartMs,
      queryMs: query.durationMs,
      totalMs: query.totalMs,
      visitedCount: query.visitedCount,
      matchCount: query.matchCount,
      selectedBounds: selected.bounds || null,
      selectionError: selected.valid ? null : selected.reason
    });
    if (!selected.valid || !selected.bounds) {
      throw new Error("当前 Chrome/Edge 未暴露可信的顶层网页内容区域");
    }
    return {
      success: true,
      bounds: selected.bounds,
      source: "windows-render-widget"
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
function contentBoundsCacheKey(request) {
  return `${request.processId}:${request.nativeWindowId}`;
}
function rememberVerifiedBounds(request, contentBounds) {
  const key = contentBoundsCacheKey(request);
  verifiedBoundsByWindow.set(key, {
    windowBounds: { ...request.windowBounds },
    contentBounds: { ...contentBounds },
    timestamp: Date.now()
  });
  if (verifiedBoundsByWindow.size > 64) {
    const oldestKey = verifiedBoundsByWindow.keys().next().value;
    if (oldestKey) verifiedBoundsByWindow.delete(oldestKey);
  }
}
function readVerifiedBounds(request, maxAgeMs = VERIFIED_BOUNDS_CACHE_MS) {
  const cached = verifiedBoundsByWindow.get(contentBoundsCacheKey(request));
  if (!cached) return null;
  if (Date.now() - cached.timestamp > maxAgeMs || !approximatelySameBrowserRect(cached.windowBounds, request.windowBounds)) {
    verifiedBoundsByWindow.delete(contentBoundsCacheKey(request));
    return null;
  }
  const assessment = assessBrowserContentBounds(cached.contentBounds, request.windowBounds);
  return assessment.valid && assessment.bounds ? assessment.bounds : null;
}
async function resolveBrowserContentBounds(request) {
  if (process.platform === "win32") {
    const freshCachedBounds = readVerifiedBounds(request, FRESH_BOUNDS_CACHE_MS);
    if (freshCachedBounds) {
      return { success: true, bounds: freshCachedBounds, source: "verified-cache" };
    }
  }
  let result;
  if (process.platform === "darwin") {
    result = await resolveMacBrowserContentBounds(request);
    if (result.success) result.source = "mac-ax-web-area";
  } else if (process.platform === "win32") {
    result = await resolveWindowsBrowserContentBounds(request);
  } else {
    return { success: false, error: "网页内容区域识别仅支持 Windows 与 macOS" };
  }
  if (result.success && result.bounds) {
    const assessment = assessBrowserContentBounds(result.bounds, request.windowBounds);
    if (assessment.valid && assessment.bounds) {
      rememberVerifiedBounds(request, assessment.bounds);
      return { ...result, bounds: assessment.bounds };
    }
    result = {
      success: false,
      error: `浏览器返回的内容区域未通过顶层 viewport 校验：${assessment.reason || "unknown"}`
    };
  }
  const cachedBounds = readVerifiedBounds(request);
  if (cachedBounds) {
    return { success: true, bounds: cachedBounds, source: "verified-cache" };
  }
  return result;
}
class WindowsWindowProbeClient {
  constructor(spawn, startupMs = 1e4, queryMs = 2500) {
    this.spawn = spawn;
    this.startupMs = startupMs;
    this.queryMs = queryMs;
  }
  session = null;
  inFlight = null;
  pending = null;
  nextId = 1;
  disposed = false;
  ensureSession() {
    if (this.disposed) throw new Error("Windows window probe disposed");
    if (this.session) return this.session;
    const child = this.spawn();
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const session = { child, ready, resolveReady, rejectReady, stderr: "" };
    this.session = session;
    const startedAt = performance.now();
    session.readyTimer = setTimeout(
      () => this.fail(
        session,
        new Error(
          `Windows window probe startup timeout (elapsedMs=${Math.round(performance.now() - startedAt)}, timeoutMs=${this.startupMs})`
        )
      ),
      this.startupMs
    );
    child.stderr?.on("data", (chunk) => {
      session.stderr = (session.stderr + String(chunk)).slice(-2e3);
    });
    child.on(
      "exit",
      (code) => this.fail(session, new Error(`Windows window probe exited (code=${code})`))
    );
    child.on(
      "error",
      (error) => this.fail(session, new Error(`Windows window probe process error: ${String(error)}`))
    );
    child.on("message", (message) => {
      if (this.session !== session) return;
      if (message?.type === "ready") {
        clearTimeout(session.readyTimer);
        session.resolveReady();
        console.log("[WindowProbe][Windows] ready", {
          startupMs: Math.round(performance.now() - startedAt)
        });
      } else if (message?.type === "fatal") {
        this.fail(
          session,
          new Error(`Windows window probe initialization failed: ${String(message.error)}`)
        );
      } else if (message?.type === "result" && this.pending && message.id === this.pending.id) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(new Error(`Windows window probe query failed: ${String(message.error)}`));
        else if (Array.isArray(message.records) && Number.isFinite(message.queryMs))
          pending.resolve(message);
        else pending.reject(new Error("Windows window probe returned invalid result"));
      }
    });
    return session;
  }
  fail(session, error) {
    if (this.session !== session) return;
    this.session = null;
    clearTimeout(session.readyTimer);
    const detail = session.stderr ? new Error(`${error.message}; stderr=${session.stderr}`) : error;
    session.rejectReady(detail);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(detail);
      this.pending = null;
    }
    session.child.kill();
  }
  async prewarm() {
    await this.ensureSession().ready;
  }
  query() {
    if (this.inFlight) return this.inFlight;
    const promise = this.performQuery();
    this.inFlight = promise;
    const clear = () => {
      if (this.inFlight === promise) this.inFlight = null;
    };
    void promise.then(clear, clear);
    return promise;
  }
  async performQuery() {
    const session = this.ensureSession();
    await session.ready;
    if (this.session !== session) throw new Error("Windows window probe stopped before query");
    const id = this.nextId++;
    const startedAt = performance.now();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(
          session,
          new Error(
            `Windows window probe query timeout (elapsedMs=${Math.round(performance.now() - startedAt)}, timeoutMs=${this.queryMs})`
          )
        ),
        this.queryMs
      );
      this.pending = { id, resolve, reject, timer };
      try {
        session.child.postMessage({ type: "query", id });
      } catch (error) {
        this.fail(session, new Error(`Windows window probe send failed: ${String(error)}`));
      }
    });
  }
  dispose() {
    this.disposed = true;
    if (this.session) this.fail(this.session, new Error("Windows window probe disposed"));
  }
}
let helper = null;
function getHelper() {
  helper ||= new WindowsWindowProbeClient(() => {
    return electron.utilityProcess.fork(path.join(__dirname, "windows-window-probe-worker.js"), [], {
      serviceName: "Windows window probe",
      stdio: "pipe"
    });
  });
  return helper;
}
function prewarmWindowsWindowInteractions() {
  if (process.platform !== "win32") return;
  void getHelper().prewarm().catch((error) => console.warn("[WindowProbe][Windows]", String(error)));
}
function disposeWindowsWindowInteractions() {
  helper?.dispose();
}
function parseWindowsWindowInteractionOutput(output) {
  const parsed = JSON.parse(output.trim() || "[]");
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const records = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const candidate = value;
    if (!Number.isSafeInteger(candidate.nativeWindowId) || Number(candidate.nativeWindowId) <= 0 || !Number.isInteger(candidate.processId) || Number(candidate.processId) <= 0 || candidate.disposition !== "accepts-pointer" && candidate.disposition !== "passthrough") {
      continue;
    }
    const reason = candidate.reason === "ignores-pointer-events" || candidate.reason === "invisible" || candidate.reason === "cloaked" ? candidate.reason : void 0;
    records.push({
      nativeWindowId: Number(candidate.nativeWindowId),
      processId: Number(candidate.processId),
      disposition: candidate.disposition,
      ...reason ? { reason } : {}
    });
  }
  return records;
}
async function resolveWindowsWindowInteractions() {
  const source = "windows-window-styles";
  if (process.platform !== "win32") {
    return { success: false, source, records: [], error: "Windows 窗口输入属性识别仅支持 Windows" };
  }
  const startedAt = performance.now();
  try {
    const result = await getHelper().query();
    const records = parseWindowsWindowInteractionOutput(JSON.stringify(result.records));
    console.log("[WindowProbe][Windows] snapshot", {
      queryMs: Math.round(result.queryMs),
      totalMs: Math.round(performance.now() - startedAt),
      count: records.length
    });
    return { success: true, source, records };
  } catch (error) {
    return { success: false, source, records: [], error: String(error) };
  }
}
const BIZ_FILENAME = "index.js";
const HOT_VERSIONS_FILE = "hot-versions.json";
let useHotCache = false;
function initHotVersions() {
  const shellVersion = electron.app.getVersion();
  const userData = electron.app.getPath("userData");
  const hotVersionsPath = path__namespace.join(userData, HOT_VERSIONS_FILE);
  const bizFile = path__namespace.join(userData, "biz", BIZ_FILENAME);
  const rendererFile = path__namespace.join(userData, "renderer", "index.html");
  try {
    const raw = fs__namespace.readFileSync(hotVersionsPath, "utf-8");
    const versions = JSON.parse(raw);
    const displayVersion = versions.displayVersion;
    if (displayVersion && semver.valid(displayVersion) && semver.valid(shellVersion) && semver.gt(displayVersion, shellVersion) && fs__namespace.existsSync(bizFile) && fs__namespace.existsSync(rendererFile)) {
      useHotCache = true;
      console.log(
        `[BizLoader] Hot cache valid: displayVersion(${displayVersion}) > shell(${shellVersion}), useHotCache=true`
      );
      return;
    }
  } catch {
  }
  useHotCache = false;
  let oldDisplayVersion;
  try {
    const raw = fs__namespace.readFileSync(hotVersionsPath, "utf-8");
    oldDisplayVersion = JSON.parse(raw).displayVersion;
  } catch {
  }
  const bizDir = path__namespace.join(userData, "biz");
  const rendererDir = path__namespace.join(userData, "renderer");
  try {
    if (fs__namespace.existsSync(bizDir)) fs__namespace.rmSync(bizDir, { recursive: true, force: true });
  } catch {
  }
  try {
    if (fs__namespace.existsSync(rendererDir)) fs__namespace.rmSync(rendererDir, { recursive: true, force: true });
  } catch {
  }
  if (oldDisplayVersion !== shellVersion) {
    const cacheDirs = ["Code Cache", "Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache"];
    for (const dir of cacheDirs) {
      try {
        const p = path__namespace.join(userData, dir);
        if (fs__namespace.existsSync(p)) {
          fs__namespace.rmSync(p, { recursive: true, force: true });
          console.log(`[BizLoader] Cleared cache: ${dir}`);
        }
      } catch {
      }
    }
    console.log(
      `[BizLoader] Version changed (${oldDisplayVersion} → ${shellVersion}), caches cleared`
    );
  }
  fs__namespace.writeFileSync(hotVersionsPath, JSON.stringify({ displayVersion: shellVersion }, null, 2));
  console.log(`[BizLoader] Reset to shell version: ${shellVersion}, useHotCache=false`);
}
function getMainRendererPath() {
  if (useHotCache) {
    return path__namespace.join(electron.app.getPath("userData"), "renderer", "index.html");
  }
  return path__namespace.join(process.resourcesPath, "renderer", "index.html");
}
let mainWindowRef = null;
function setMainWindow(win) {
  mainWindowRef = win;
}
function resolveBizPath() {
  if (useHotCache) {
    return {
      filePath: path__namespace.join(electron.app.getPath("userData"), "biz", BIZ_FILENAME),
      source: "hotUpdate"
    };
  }
  const resourcesPath = process.resourcesPath || "";
  const prodPath = path__namespace.join(resourcesPath, "biz", BIZ_FILENAME);
  if (fs__namespace.existsSync(prodPath)) {
    return { filePath: prodPath, source: "builtin" };
  }
  const devPath = path__namespace.join(__dirname, "../biz", BIZ_FILENAME);
  if (fs__namespace.existsSync(devPath)) {
    return { filePath: devPath, source: "dev" };
  }
  return null;
}
function createShellBridge() {
  const rawRobot = process.platform === "win32" ? null : require("@hurdlegroup/robotjs");
  const activeWin = require("active-win");
  const { windowManager } = require("node-window-manager");
  const cvReady = require("@techstark/opencv-js");
  let thiflowRobot = null;
  try {
    thiflowRobot = require("@thiflow/robot");
    const capabilities = [
      typeof thiflowRobot?.listDevices === "function" && "list",
      typeof thiflowRobot?.autoDetectInputDevice === "function" && "auto-detect",
      typeof thiflowRobot?.probeInputDevice === "function" && "probe",
      typeof thiflowRobot?.createInputFromDetectedDevice === "function" && "create"
    ].filter(Boolean);
    console.log(`[BizLoader] @thiflow/robot ready capabilities=${capabilities.join(",") || "none"}`);
  } catch (err) {
    console.error("[BizLoader] ❌ @thiflow/robot require failed:", err?.message || String(err));
    console.error("[BizLoader]   stack:", err?.stack);
    try {
      const resolvedPath = require.resolve("@thiflow/robot");
      console.error("[BizLoader]   resolved path:", resolvedPath);
    } catch {
      console.error("[BizLoader]   require.resolve also failed");
    }
    thiflowRobot = {};
  }
  return {
    // ─── IPC ──────────────────────────────────────────────
    ipc: {
      handle: (channel, handler) => electron.ipcMain.handle(channel, (event, ...args) => handler(event, ...args)),
      on: (channel, handler) => electron.ipcMain.on(channel, (event, ...args) => handler(event, ...args)),
      removeHandler: (channel) => electron.ipcMain.removeHandler(channel)
    },
    // ─── 常用路径 ─────────────────────────────────────────
    paths: {
      userData: electron.app.getPath("userData"),
      app: electron.app.getAppPath(),
      temp: electron.app.getPath("temp")
    },
    // ─── 日志 ─────────────────────────────────────────────
    log: {
      info: (...args) => console.log("[Biz]", ...args),
      warn: (...args) => console.warn("[Biz]", ...args),
      error: (...args) => console.error("[Biz]", ...args)
    },
    // ─── Path B: 原生模块透传 ─────────────────────────────
    rawRobot,
    robot: rawRobot,
    activeWin,
    windowManager,
    cvReady,
    thiflowRobot,
    // ─── Electron API 透传 ────────────────────────────────
    screen: electron.screen,
    desktopCapturer: electron.desktopCapturer,
    systemPreferences: electron.systemPreferences,
    shell: electron.shell,
    clipboard: electron.clipboard,
    dialog: electron.dialog,
    nativeImage: electron.nativeImage,
    globalShortcut: electron.globalShortcut,
    net: electron.net,
    app: {
      getName: () => electron.app.getName(),
      getPath: (name) => electron.app.getPath(name),
      getVersion: () => electron.app.getVersion(),
      getAppPath: () => electron.app.getAppPath(),
      getFileIcon: (filePath, options) => electron.app.getFileIcon(filePath, options),
      isPackaged: electron.app.isPackaged,
      shouldForceQuit: () => shouldForceQuit()
    },
    // ─── 构建环境变量 ─────────────────────────────────────
    env: getRuntimeBuildEnv(),
    // ─── Shell 能力 ───────────────────────────────────────
    sendToRenderer: (channel, ...args) => {
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        if (channel === "REDIRECT_TO_LOGIN") {
          if (mainWindowRef.isMinimized()) {
            mainWindowRef.restore();
          }
          mainWindowRef.show();
          mainWindowRef.focus();
        }
        mainWindowRef.webContents.send(channel, ...args);
      }
    },
    getMainWindow: () => mainWindowRef,
    BrowserWindow: electron.BrowserWindow,
    subscribeActiveSpaceChanges: (listener) => subscribeActiveSpaceChanges(() => listener()),
    resolveBrowserContentBounds,
    resolveWindowInteractions: process.platform === "darwin" ? resolveMacWindowInteractions : process.platform === "win32" ? resolveWindowsWindowInteractions : void 0,
    focusMacTargetWindow,
    checkMacTargetWindow,
    startMacTargetWindowWatch,
    subscribeMacTargetWindowVisibility,
    getPreloadPath: () => {
      return path__namespace.join(__dirname, "../preload/index.js");
    },
    getRendererUrl: (htmlFileName) => {
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        return `${process.env["ELECTRON_RENDERER_URL"]}/${htmlFileName}`;
      }
      if (useHotCache) {
        return `file://${path__namespace.join(electron.app.getPath("userData"), "renderer", htmlFileName)}`;
      }
      return `file://${path__namespace.join(process.resourcesPath, "renderer", htmlFileName)}`;
    }
  };
}
let loadedBiz = null;
let loadedBridge = null;
let auroraTransport = null;
async function loadBiz() {
  const resolved = resolveBizPath();
  if (!resolved) {
    console.warn("[BizLoader] No biz bundle found, skipping.");
    return;
  }
  console.log(`[BizLoader] Loading biz from: ${resolved.filePath} (${resolved.source})`);
  const resolvedPath = require.resolve(resolved.filePath);
  if (require.cache[resolvedPath]) {
    delete require.cache[resolvedPath];
  }
  const biz = require(resolved.filePath);
  const bridge = createShellBridge();
  await biz.initBridge(bridge);
  loadedBridge = bridge;
  loadedBiz = biz;
  console.log(`[BizLoader] Biz loaded successfully, version: ${biz.version}`);
  try {
    const targetResolver = createProductionTargetResolver({ bridge });
    auroraTransport = new AuroraTransport({ bridge, targetResolver });
    auroraTransport.start();
    console.log("[Aurora] Transport initialized", auroraTransport.getStatus());
  } catch (error) {
    console.error("[Aurora] Transport initialization failed", {
      error: error?.message || String(error)
    });
  }
}
function getLoadedBiz() {
  return loadedBiz;
}
const inspectMenuWindows = /* @__PURE__ */ new WeakSet();
function attachDevelopmentInspectMenu(window) {
  if (inspectMenuWindows.has(window) || process.env.NODE_ENV !== "development" && process.env.DEBUG_PROD !== "true") {
    return;
  }
  inspectMenuWindows.add(window);
  window.webContents.on("context-menu", (_, props) => {
    const { x, y } = props;
    electron.Menu.buildFromTemplate([
      {
        label: "Inspect element",
        click: () => {
          if (!window.isDestroyed()) {
            window.webContents.inspectElement(x, y);
          }
        }
      }
    ]).popup({ window });
  });
}
class MenuBuilder {
  mainWindow;
  // OEM 产品名已在启动时通过运行时配置写入 app name。
  productName = electron.app.getName();
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
  }
  buildMenu() {
    if (process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true") {
      this.setupDevelopmentEnvironment();
    }
    const template = process.platform === "darwin" ? this.buildDarwinTemplate() : this.buildDefaultTemplate();
    const menu = electron.Menu.buildFromTemplate(template);
    electron.Menu.setApplicationMenu(menu);
    return menu;
  }
  setupDevelopmentEnvironment() {
    attachDevelopmentInspectMenu(this.mainWindow);
  }
  buildDarwinTemplate() {
    const subMenuAbout = {
      label: this.productName,
      submenu: [
        {
          label: `关于${this.productName}`,
          selector: "orderFrontStandardAboutPanel:"
        },
        { type: "separator" },
        {
          label: "隐藏应用",
          accelerator: "Command+H",
          selector: "hide:"
        },
        {
          label: "隐藏其他",
          accelerator: "Command+Shift+H",
          selector: "hideOtherApplications:"
        },
        { label: "显示全部", selector: "unhideAllApplications:" },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "Command+Q",
          click: () => {
            electron.app.quit();
          }
        }
      ]
    };
    const subMenuEdit = {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "Command+Z", selector: "undo:" },
        { label: "重做", accelerator: "Shift+Command+Z", selector: "redo:" },
        { type: "separator" },
        { label: "剪切", accelerator: "Command+X", selector: "cut:" },
        { label: "复制", accelerator: "Command+C", selector: "copy:" },
        { label: "粘贴", accelerator: "Command+V", selector: "paste:" },
        {
          label: "全选",
          accelerator: "Command+A",
          selector: "selectAll:"
        }
      ]
    };
    const subMenuViewDev = {
      label: "视图",
      submenu: [
        {
          label: "重新加载",
          accelerator: "Command+R",
          click: () => {
            this.mainWindow.webContents.reload();
          }
        },
        {
          label: "切换全屏",
          accelerator: "Ctrl+Command+F",
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          }
        },
        {
          label: "切换开发者工具",
          accelerator: "Alt+Command+I",
          click: () => {
            const win = electron.BrowserWindow.getFocusedWindow();
            if (win) win.webContents.toggleDevTools();
          }
        }
      ]
    };
    const subMenuViewProd = {
      label: "视图",
      submenu: [
        {
          label: "切换全屏",
          accelerator: "Ctrl+Command+F",
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          }
        }
      ]
    };
    const subMenuWindow = {
      label: "窗口",
      submenu: [
        {
          label: "最小化",
          accelerator: "Command+M",
          selector: "performMiniaturize:"
        },
        { label: "关闭", accelerator: "Command+W", selector: "performClose:" }
      ]
    };
    const subMenuView = process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true" ? subMenuViewDev : subMenuViewProd;
    return [subMenuAbout, subMenuEdit, subMenuView, subMenuWindow];
  }
  buildDefaultTemplate() {
    const subMenuFile = {
      label: "文件",
      submenu: [
        {
          label: "退出",
          accelerator: process.platform === "win32" ? "Alt+F4" : "Ctrl+Q",
          click: () => {
            this.mainWindow.close();
          }
        }
      ]
    };
    const subMenuView = {
      label: "视图",
      submenu: process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true" ? [
        {
          label: "重新加载",
          accelerator: "Ctrl+R",
          click: () => {
            this.mainWindow.webContents.reload();
          }
        },
        {
          label: "切换全屏",
          accelerator: "F11",
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          }
        },
        {
          label: "切换开发者工具",
          accelerator: "Alt+Ctrl+I",
          click: () => {
            const win = electron.BrowserWindow.getFocusedWindow();
            if (win) win.webContents.toggleDevTools();
          }
        }
      ] : [
        {
          label: "切换全屏",
          accelerator: "F11",
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          }
        }
      ]
    };
    const subMenuEdit = {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "Ctrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+Ctrl+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "Ctrl+X", role: "cut" },
        { label: "复制", accelerator: "Ctrl+C", role: "copy" },
        { label: "粘贴", accelerator: "Ctrl+V", role: "paste" },
        { label: "全选", accelerator: "Ctrl+A", role: "selectAll" }
      ]
    };
    return [subMenuFile, subMenuEdit, subMenuView];
  }
}
let tray = null;
function createTray(mainWindow) {
  const iconPath = getTrayIconPath();
  const trayIcon = electron.nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") {
    trayIcon.setTemplateImage(true);
  }
  tray = new electron.Tray(trayIcon);
  const trayTooltip = electron.app.getName();
  tray.setToolTip(trayTooltip);
  const contextMenu = createContextMenu(mainWindow);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  console.log("[Tray] 托盘图标已创建");
  return tray;
}
function getTrayIconPath() {
  const RESOURCES_PATH = electron.app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(__dirname, "../../build");
  if (process.platform === "win32") {
    const ico = path.join(RESOURCES_PATH, "icon.ico");
    if (fs.existsSync(ico)) return ico;
  } else if (process.platform === "darwin") {
    const icns = path.join(RESOURCES_PATH, "icon.icns");
    if (fs.existsSync(icns)) return icns;
  }
  return path.join(RESOURCES_PATH, "icon.png");
}
function createContextMenu(mainWindow) {
  return electron.Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        electron.app.quit();
      }
    }
  ]);
}
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
    console.log("[Tray] 托盘图标已销毁");
  }
}
function applyWindowsAppUserModelId(electronApplication, runtimeBuildEnv2, platform = process.platform) {
  if (platform !== "win32") return null;
  const appId = runtimeBuildEnv2.APP_ID.trim();
  if (!appId) {
    throw new Error("Windows AppUserModelID 不能为空");
  }
  electronApplication.setAppUserModelId(appId);
  return appId;
}
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const runtimeBuildEnv = getRuntimeBuildEnv();
let quitCleanupPromise = null;
let quitCleanupComplete = false;
let quitAfterCleanupRequested = false;
process.env.SHIFLOW_LOCAL_DEV = electron.app.isPackaged ? "0" : "1";
if (IS_WINDOWS) {
  electron.app.commandLine.appendSwitch("high-dpi-support", "1");
  electron.app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");
}
if (runtimeBuildEnv.OEM_PRODUCT_NAME) {
  electron.app.setName(runtimeBuildEnv.OEM_PRODUCT_NAME);
}
function runQuitCleanup() {
  if (!quitCleanupPromise) {
    quitCleanupPromise = (async () => {
      console.log("[Shell] 应用即将退出，开始清理资源");
      disposeWindowsWindowInteractions();
      disposeWindowsBrowserContentHelper();
      try {
        destroyTray();
      } catch (error) {
        console.error("[Shell] destroyTray() 失败:", error);
      }
      try {
        disposeWindowOcclusionIpc();
      } catch (error) {
        console.error("[Shell] disposeWindowOcclusionIpc() 失败:", error);
      }
      try {
        await auroraTransport?.stop?.();
      } catch (error) {
        console.error("[Aurora] Transport stop failed", {
          trace_id: auroraTransport?.lastTraceId || null,
          device_id: auroraTransport?.deviceId || null,
          error: error?.message || String(error)
        });
      } finally {
        auroraTransport = null;
        loadedBridge = null;
      }
      try {
        await getLoadedBiz()?.dispose?.();
      } catch (error) {
        console.error("[Shell] biz.dispose() 失败:", error);
      }
    })().finally(() => {
      quitCleanupComplete = true;
      console.log("[Shell] 退出资源清理完成");
    });
  }
  return quitCleanupPromise;
}
function continueQuitAfterCleanup() {
  if (quitAfterCleanupRequested) return;
  quitAfterCleanupRequested = true;
  void runQuitCleanup().finally(() => {
    electron.app.quit();
  });
}
function createWindow() {
  const primaryDisplay = electron.screen.getPrimaryDisplay();
  const { scaleFactor } = primaryDisplay;
  const baseWidth = 390;
  const baseHeight = 720;
  const adjustedWidth = Math.round(baseWidth * Math.max(1, scaleFactor / 2));
  const adjustedHeight = Math.round(baseHeight * Math.max(1, scaleFactor / 2));
  const maxHeight = Math.round(874 * Math.max(1, scaleFactor / 2));
  const mainWindow = new electron.BrowserWindow({
    show: false,
    width: adjustedWidth,
    height: adjustedHeight,
    minWidth: adjustedWidth,
    maxWidth: adjustedWidth,
    minHeight: 600,
    maxHeight,
    frame: false,
    // Windows 使用不透明宿主，由系统决定外轮廓，避免透明分层绘制兼容问题。
    // 其他平台保留 renderer 自绘圆角；各平台继续使用自定义窗口按钮。
    transparent: !IS_WINDOWS,
    backgroundColor: IS_WINDOWS ? "#f2f7fb" : "#00000000",
    resizable: false,
    hasShadow: true,
    title: runtimeBuildEnv.OEM_PRODUCT_NAME || electron.app.getName(),
    // Windows 运行窗口直接复用 EXE/安装器同源的 ICO，避免 PNG 资源不一致时
    // 任务栏显示出与安装包不同的图标；其他平台继续使用 PNG。
    icon: electron.app.isPackaged ? path.join(process.resourcesPath, "assets", IS_WINDOWS ? "icon.ico" : "icon.png") : icon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 1
    },
    // Windows DPI 兼容属性
    ...IS_WINDOWS && {
      enableLargerThanScreen: true,
      useContentSize: false,
      autoHideMenuBar: true,
      // 请求系统圆角；系统不支持时接受直角，不再用透明区域模拟大圆角。
      roundedCorners: true
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    prewarmWindowsBrowserContentHelper();
    initHotUpdater(mainWindow);
    initAutoUpdater(mainWindow);
  });
  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("fullscreen-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("fullscreen-changed", false);
  });
  if (IS_MAC) {
    mainWindow.on("close", (e) => {
      if (!shouldForceQuit()) {
        e.preventDefault();
        getLoadedBiz()?.resetTargetWindowForAppReopen?.();
        mainWindow.hide();
      }
    });
  }
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
  if (IS_WINDOWS) {
    createTray(mainWindow);
  }
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(getMainRendererPath());
  }
  return mainWindow;
}
electron.app.whenReady().then(async () => {
  prewarmWindowsWindowInteractions();
  const windowsAppUserModelId = applyWindowsAppUserModelId(electron.app, runtimeBuildEnv);
  if (windowsAppUserModelId) {
    console.log(`[Shell] Windows AppUserModelID: ${windowsAppUserModelId}`);
  }
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
    attachDevelopmentInspectMenu(window);
  });
  initHotVersions();
  initializeWindowOcclusionIpc();
  await loadBiz();
  const mainWindow = createWindow();
  setMainWindow(mainWindow);
  electron.app.on("activate", function() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", (event) => {
  markForceQuit();
  if (quitCleanupComplete) return;
  event.preventDefault();
  continueQuitAfterCleanup();
});
electron.app.on("will-quit", (event) => {
  if (quitCleanupComplete) return;
  event.preventDefault();
  markForceQuit();
  continueQuitAfterCleanup();
});
