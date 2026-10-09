"use strict";

const { TargetResolver } = require("../target-resolver");
const { WindowsWindowProbeAdapter } = require("./window-probe-adapter");
const { WindowsUiAutomationAdapter } = require("./uia-adapter");

function createProductionTargetResolver({ bridge, platform = process.platform, log } = {}) {
  if (!bridge) throw new TypeError("createProductionTargetResolver requires bridge");
  const windowProbe = new WindowsWindowProbeAdapter({ bridge, platform, log });
  const uiaResolver = new WindowsUiAutomationAdapter({ platform, log });
  return new TargetResolver({ windowProbe, uiaResolver, log });
}

module.exports = { createProductionTargetResolver };
