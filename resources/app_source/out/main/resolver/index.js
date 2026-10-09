"use strict";

const { createProductionTargetResolver } = require("./resolver-factory");
const { WindowsUiAutomationAdapter } = require("./uia-adapter");
const { WindowsWindowProbeAdapter } = require("./window-probe-adapter");

module.exports = {
  createProductionTargetResolver,
  WindowsUiAutomationAdapter,
  WindowsWindowProbeAdapter
};
