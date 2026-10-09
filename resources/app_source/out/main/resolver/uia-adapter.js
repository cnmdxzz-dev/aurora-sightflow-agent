"use strict";

const childProcess = require("child_process");
const { TARGET_ERRORS } = require("../target-contract");

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const WINDOWS_UIA_TARGET_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Send-Response([object]$value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}

try {
  $request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  $windowId = [Int64]$request.window_id
  if ($windowId -le 0) { throw 'Invalid target window handle' }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$windowId)
  if ($null -eq $root) { throw 'UI Automation could not resolve the target window' }

  $inputSelector = [string]$request.input_selector
  $selectorProfile = [string]$request.selector_profile
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $queue.Enqueue($root)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $candidates = [System.Collections.Generic.List[object]]::new()
  $visited = 0
  $maxNodes = 1500

  while ($queue.Count -gt 0 -and $visited -lt $maxNodes) {
    $element = $queue.Dequeue()
    $visited++
    try {
      $current = $element.Current
      $name = [string]$current.Name
      $automationId = [string]$current.AutomationId
      $className = [string]$current.ClassName
      $controlType = [string]$current.ControlType.ProgrammaticName
      $rect = $current.BoundingRectangle
      $isVisible = -not [bool]$current.IsOffscreen
      $hasBounds = $rect.Width -gt 0 -and $rect.Height -gt 0
      $needle = $inputSelector.ToLowerInvariant()
      $textMatch = $name.ToLowerInvariant() -eq $needle -or
        $automationId.ToLowerInvariant() -eq $needle -or
        $className.ToLowerInvariant() -eq $needle
      $editable = $controlType -match 'Edit|Document|ComboBox'
      $genericInput = $selectorProfile -eq 'generic-desktop-v1' -and $editable
      if ($isVisible -and $hasBounds -and ($textMatch -or $genericInput)) {
        $candidates.Add([ordered]@{
          bounds = [ordered]@{
            x = [double]$rect.X
            y = [double]$rect.Y
            width = [double]$rect.Width
            height = [double]$rect.Height
          }
          selector = $inputSelector
          name = $name
          automation_id = $automationId
          class_name = $className
          control_type = $controlType
        })
      }

      $child = $walker.GetFirstChild($element)
      while ($null -ne $child -and ($queue.Count + $visited) -lt $maxNodes) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
    } catch {
      # Individual UIA nodes can disappear while the tree is being walked.
    }
  }

  Send-Response ([ordered]@{ ok = $true; candidates = [object[]]$candidates.ToArray(); visited = $visited })
} catch {
  Send-Response ([ordered]@{ ok = $false; error = $_.Exception.Message })
}
`;

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function lastJsonLine(output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === "object") return value;
    } catch {
      // PowerShell may emit non-JSON diagnostics; continue to the response line.
    }
  }
  return null;
}

function runWindowsUiAutomationQuery({ windowId, inputSelector, selectorProfile, spawnProcess = childProcess.spawn, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_UIA_TARGET_SCRIPT],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error("Windows UIA target query timeout"));
    }, timeoutMs);
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on?.("data", (chunk) => { stderr += String(chunk); });
    child.once?.("error", (error) => finish(error));
    child.once?.("close", (code) => {
      const response = lastJsonLine(stdout);
      if (response) return finish(null, response);
      finish(new Error(stderr.trim() || `Windows UIA target helper exited with code ${code ?? "unknown"}`));
    });
    try {
      child.stdin.end(JSON.stringify({
        window_id: windowId,
        input_selector: inputSelector,
        selector_profile: selectorProfile
      }));
    } catch (error) {
      finish(error);
    }
  });
}

class WindowsUiAutomationAdapter {
  constructor({ platform = process.platform, query, spawnProcess, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS, log } = {}) {
    this.platform = platform;
    this.query = query || ((request) => runWindowsUiAutomationQuery({ ...request, spawnProcess, timeoutMs }));
    this.log = log || { warn() {}, error() {} };
  }

  async resolveTarget({ window, target } = {}) {
    if (this.platform !== "win32") {
      return { ok: false, error_code: TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED, message: "UI Automation 仅支持 Windows" };
    }
    const windowId = Number(window?.native_window_id);
    if (!Number.isSafeInteger(windowId) || windowId <= 0) {
      return { ok: false, error_code: TARGET_ERRORS.TARGET_NOT_FOUND, message: "目标窗口句柄无效" };
    }
    let response;
    try {
      response = await this.query({
        windowId,
        inputSelector: target?.input_selector || "",
        selectorProfile: target?.selector_profile || ""
      });
    } catch (error) {
      this.log.warn("[WindowsUiAutomationAdapter] query failed", errorText(error));
      return { ok: false, error_code: TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED, message: errorText(error) };
    }
    if (!response || response.ok !== true) {
      return {
        ok: false,
        error_code: response?.error_code || TARGET_ERRORS.TARGET_RESOLVER_UNSUPPORTED,
        message: response?.error || "UI Automation 未返回结果"
      };
    }
    const candidates = Array.isArray(response.candidates) ? response.candidates : [];
    if (candidates.length === 0) {
      return { ok: false, error_code: TARGET_ERRORS.TARGET_NOT_FOUND, message: "没有找到唯一匹配控件" };
    }
    if (candidates.length > 1) {
      return { ok: false, error_code: TARGET_ERRORS.TARGET_AMBIGUOUS, message: `匹配到 ${candidates.length} 个控件` };
    }
    const candidate = candidates[0];
    return {
      ok: true,
      verified: true,
      target: {
        bounds: candidate.bounds,
        selector: target.input_selector,
        automation_id: candidate.automation_id || null,
        control_type: candidate.control_type || null
      },
      evidence: [{
        type: "uia_match",
        source: "windows_uia",
        value: target.input_selector,
        verified: true
      }]
    };
  }
}

module.exports = {
  DEFAULT_QUERY_TIMEOUT_MS,
  WINDOWS_UIA_TARGET_SCRIPT,
  WindowsUiAutomationAdapter,
  lastJsonLine,
  runWindowsUiAutomationQuery
};
