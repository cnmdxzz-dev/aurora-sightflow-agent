"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = __dirname;
const resourcesPath = path.join(repositoryRoot, "resources");
const mainEntry = path.join(resourcesPath, "app_source", "out", "main", "index.js");

function assertLayout() {
  const requiredPaths = [
    resourcesPath,
    path.join(resourcesPath, "biz", "index.js"),
    path.join(resourcesPath, "renderer", "index.html"),
    path.join(resourcesPath, "app_source", "out", "preload", "index.js"),
    mainEntry
  ];
  const missing = requiredPaths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`[SightFlow Dev Launcher] resources 布局不完整:\n${missing.join("\n")}`);
  }
}

function mapElectronResourcesPath(targetPath) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  try {
    Object.defineProperty(process, "resourcesPath", {
      configurable: descriptor?.configurable !== false,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: targetPath
    });
  } catch (error) {
    try {
      process.resourcesPath = targetPath;
    } catch {
      // The error below contains the actionable failure and current value.
    }
    if (process.resourcesPath !== targetPath) {
      throw new Error(
        `[SightFlow Dev Launcher] 无法映射 process.resourcesPath。当前值: ${process.resourcesPath}; 目标值: ${targetPath}; ${error?.message || String(error)}`
      );
    }
  }
  if (process.resourcesPath !== targetPath) {
    throw new Error(
      `[SightFlow Dev Launcher] process.resourcesPath 映射失败。当前值: ${process.resourcesPath}; 目标值: ${targetPath}`
    );
  }
}

function start() {
  assertLayout();
  mapElectronResourcesPath(resourcesPath);
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.SHIFLOW_LOCAL_DEV = "1";
  console.log("[SightFlow Dev Launcher] resources:", resourcesPath);
  console.log("[SightFlow Dev Launcher] main:", mainEntry);
  require(mainEntry);
}

if (require.main === module) start();

module.exports = {
  assertLayout,
  mapElectronResourcesPath,
  resourcesPath,
  mainEntry,
  start
};
