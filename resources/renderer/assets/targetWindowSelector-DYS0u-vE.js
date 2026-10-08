import { u as useTranslation, r as reactExports, g as getTargetWindowOverlayContext, o as onTargetWindowSelectionStateChanged, a as onTargetWindowSelectionContextChanged, m as markTargetWindowOverlayReady, f as findTopmostCandidateAtPoint, h as hoverTargetWindowCandidate, l as lockTargetWindowCandidate, c as cancelTargetWindowSelection, b as confirmTargetWindowSelection, d as getPreviewCandidateId, j as jsxRuntimeExports, e as getRectWithinDisplay, i as getTargetWindowCaptureMaskRects, k as resolveTargetWindowToolbarPosition, s as setTargetWindowCaptureDraft, n as resizeTargetWindowCaptureBounds, p as clientExports, T as TranslationProvider } from "./target-window-selection-ipc-BNoPqbgj.js";
const TOOLBAR_HEIGHT = 44;
const TOOLBAR_PADDING = 5;
const TOOLBAR_GAP = 8;
const TOOLBAR_CANCEL_WIDTH = 70;
const TOOLBAR_RESET_WIDTH = 96;
const TOOLBAR_CONFIRM_PADDING = 28;
const estimateLabelWidth = (label) => {
  let width = 0;
  for (const char of label) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 13 : 7;
  }
  return Math.ceil(width);
};
const CAPTURE_HANDLES = [
  { handle: "top", labelKey: "windowSelector.resizeTop" },
  { handle: "right", labelKey: "windowSelector.resizeRight" },
  { handle: "bottom", labelKey: "windowSelector.resizeBottom" },
  { handle: "left", labelKey: "windowSelector.resizeLeft" },
  { handle: "top-left", labelKey: "windowSelector.resizeTopLeft" },
  { handle: "top-right", labelKey: "windowSelector.resizeTopRight" },
  { handle: "bottom-right", labelKey: "windowSelector.resizeBottomRight" },
  { handle: "bottom-left", labelKey: "windowSelector.resizeBottomLeft" }
];
function isCaptureHandleOnDisplay(handle, bounds, displayBounds) {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  const leftVisible = bounds.x >= displayBounds.x && bounds.x < displayRight;
  const right = bounds.x + bounds.width;
  const rightVisible = right > displayBounds.x && right <= displayRight;
  const topVisible = bounds.y >= displayBounds.y && bounds.y < displayBottom;
  const bottom = bounds.y + bounds.height;
  const bottomVisible = bottom > displayBounds.y && bottom <= displayBottom;
  if (handle.includes("left") && !leftVisible) return false;
  if (handle.includes("right") && !rightVisible) return false;
  if (handle.includes("top") && !topVisible) return false;
  if (handle.includes("bottom") && !bottomVisible) return false;
  return true;
}
function getSelectorParameters() {
  const query = window.location.search.slice(1) || window.location.hash.split("?")[1] || "";
  const parameters = new URLSearchParams(query);
  return {
    sessionId: parameters.get("sessionId") || "",
    displayId: parameters.get("displayId") || ""
  };
}
function TargetWindowSelectorApp() {
  const { t } = useTranslation();
  const { sessionId, displayId } = reactExports.useMemo(() => getSelectorParameters(), []);
  const [context, setContext] = reactExports.useState(null);
  const [selectionState, setSelectionState] = reactExports.useState(null);
  const [manualCapture, setManualCapture] = reactExports.useState(null);
  const lastHoveredIdRef = reactExports.useRef(null);
  const readyOverlayRef = reactExports.useRef(false);
  const captureDragRef = reactExports.useRef(null);
  const pendingCaptureDraftRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    const previousMargin = document.body.style.margin;
    const previousOverflow = document.body.style.overflow;
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.margin = previousMargin;
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  reactExports.useEffect(() => {
    let disposed = false;
    void getTargetWindowOverlayContext(sessionId, displayId).then((nextContext) => {
      if (disposed || !nextContext) return;
      setContext(nextContext);
      setSelectionState(nextContext.state);
      setManualCapture(
        nextContext.captureDraft ? {
          candidateId: nextContext.captureDraft.candidateId,
          bounds: { ...nextContext.captureDraft.bounds }
        } : null
      );
      lastHoveredIdRef.current = nextContext.state.hoveredCandidateId;
    });
    const cleanupState = onTargetWindowSelectionStateChanged((nextState) => {
      if (nextState.sessionId !== sessionId) return;
      lastHoveredIdRef.current = nextState.hoveredCandidateId;
      setSelectionState(nextState);
    });
    const cleanupContext = onTargetWindowSelectionContextChanged((nextContext) => {
      if (nextContext.sessionId !== sessionId) return;
      lastHoveredIdRef.current = nextContext.state.hoveredCandidateId;
      setSelectionState(nextContext.state);
      if (!captureDragRef.current) {
        const pendingDraft = pendingCaptureDraftRef.current;
        if (pendingDraft?.candidateId === nextContext.state.lockedCandidateId) {
          setManualCapture(
            pendingDraft.bounds ? { candidateId: pendingDraft.candidateId, bounds: { ...pendingDraft.bounds } } : null
          );
        } else {
          setManualCapture(
            nextContext.captureDraft ? {
              candidateId: nextContext.captureDraft.candidateId,
              bounds: { ...nextContext.captureDraft.bounds }
            } : null
          );
        }
      }
      setContext(
        (current) => current ? {
          ...current,
          candidates: nextContext.candidates,
          blockedRects: nextContext.blockedRects,
          state: nextContext.state,
          contentPreview: nextContext.contentPreview,
          captureDraft: nextContext.captureDraft
        } : current
      );
    });
    return () => {
      disposed = true;
      cleanupState();
      cleanupContext();
    };
  }, [displayId, sessionId]);
  const hasRenderableContext = Boolean(context && selectionState);
  reactExports.useEffect(() => {
    if (!hasRenderableContext || readyOverlayRef.current) return;
    let disposed = false;
    let paintedFrame = 0;
    const committedFrame = window.requestAnimationFrame(() => {
      paintedFrame = window.requestAnimationFrame(() => {
        if (disposed || readyOverlayRef.current) return;
        readyOverlayRef.current = true;
        void markTargetWindowOverlayReady(sessionId, displayId);
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(committedFrame);
      if (paintedFrame) window.cancelAnimationFrame(paintedFrame);
    };
  }, [displayId, hasRenderableContext, sessionId]);
  const candidateAtEvent = reactExports.useCallback(
    (event) => {
      if (!context) return null;
      return findTopmostCandidateAtPoint(
        {
          x: context.display.bounds.x + event.clientX,
          y: context.display.bounds.y + event.clientY
        },
        context.candidates,
        context.blockedRects
      );
    },
    [context]
  );
  const handlePointerMove = reactExports.useCallback(
    (event) => {
      if (!context || selectionState?.lockedCandidateId || selectionState?.isRefreshing) return;
      const candidateId = candidateAtEvent(event)?.id || null;
      if (lastHoveredIdRef.current === candidateId) return;
      lastHoveredIdRef.current = candidateId;
      setSelectionState(
        (current) => current ? { ...current, hoveredCandidateId: candidateId } : current
      );
      void hoverTargetWindowCandidate(sessionId, candidateId);
    },
    [
      candidateAtEvent,
      context,
      selectionState?.isRefreshing,
      selectionState?.lockedCandidateId,
      sessionId
    ]
  );
  const handleCanvasClick = reactExports.useCallback(
    (event) => {
      if (selectionState?.isRefreshing) return;
      const candidate = candidateAtEvent(event);
      if (!candidate) return;
      if (selectionState?.lockedCandidateId && selectionState.lockedCandidateId !== candidate.id) {
        captureDragRef.current = null;
        pendingCaptureDraftRef.current = null;
        setManualCapture(null);
      }
      void lockTargetWindowCandidate(sessionId, candidate.id, displayId);
    },
    [
      candidateAtEvent,
      displayId,
      selectionState?.isRefreshing,
      selectionState?.lockedCandidateId,
      sessionId
    ]
  );
  const cancel = reactExports.useCallback(() => {
    void cancelTargetWindowSelection(sessionId);
  }, [sessionId]);
  const getConfirmationOptions = reactExports.useCallback(
    (candidateId) => {
      const captureBounds = manualCapture?.candidateId === candidateId ? manualCapture.bounds : context?.contentPreview?.candidateId === candidateId && context.contentPreview.status === "ready" ? context.contentPreview.bounds : void 0;
      return captureBounds ? { captureBounds } : {};
    },
    [context?.contentPreview, manualCapture]
  );
  const confirmLockedCandidate = reactExports.useCallback(() => {
    const candidateId = selectionState?.lockedCandidateId;
    if (!candidateId || selectionState.isRefreshing) return;
    void confirmTargetWindowSelection(sessionId, getConfirmationOptions(candidateId));
  }, [getConfirmationOptions, selectionState, sessionId]);
  const handleCanvasDoubleClick = reactExports.useCallback(
    (event) => {
      if (selectionState?.isRefreshing) return;
      const candidate = candidateAtEvent(event);
      if (!candidate) return;
      event.preventDefault();
      void (async () => {
        const locked = await lockTargetWindowCandidate(sessionId, candidate.id, displayId);
        if (!locked) return;
        await confirmTargetWindowSelection(sessionId, getConfirmationOptions(candidate.id));
      })();
    },
    [candidateAtEvent, displayId, getConfirmationOptions, selectionState?.isRefreshing, sessionId]
  );
  const previewCandidateId = selectionState ? getPreviewCandidateId(selectionState) : null;
  reactExports.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Enter" || event.repeat || !selectionState?.lockedCandidateId) return;
      const eventTarget = event.target;
      if (eventTarget instanceof Element && eventTarget.closest('button, input, textarea, select, a[href], [contenteditable="true"]')) {
        return;
      }
      event.preventDefault();
      confirmLockedCandidate();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancel, confirmLockedCandidate, selectionState?.lockedCandidateId]);
  if (!context || !selectionState) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "target-window-selector target-window-selector--loading" });
  }
  const previewCandidate = context.candidates.find((candidate) => candidate.id === previewCandidateId) || null;
  const previewRect = previewCandidate ? getRectWithinDisplay(previewCandidate.bounds, context.display.bounds) : null;
  const isLocked = Boolean(selectionState.lockedCandidateId);
  const contentPreview = context.contentPreview?.candidateId === previewCandidate?.id ? context.contentPreview : null;
  const activeManualCapture = manualCapture?.candidateId === previewCandidate?.id ? manualCapture : null;
  const automaticCaptureBounds = contentPreview?.status === "ready" && contentPreview.bounds ? contentPreview.bounds : isLocked && contentPreview ? previewCandidate?.bounds || null : null;
  const effectiveCaptureBounds = activeManualCapture?.bounds || automaticCaptureBounds;
  const contentPreviewRect = effectiveCaptureBounds ? getRectWithinDisplay(effectiveCaptureBounds, context.display.bounds) : null;
  const innerMaskRects = previewCandidate && effectiveCaptureBounds ? getTargetWindowCaptureMaskRects(previewCandidate.bounds, effectiveCaptureBounds).map((rect) => getRectWithinDisplay(rect, context.display.bounds)).filter((rect) => Boolean(rect)).map((rect) => ({
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  })) : [];
  const showToolbar = isLocked && previewCandidate && selectionState.actionDisplayId === context.display.id;
  const confirmLabel = context.intent === "start-agent" ? t("windowSelector.confirmAndStart") : t("windowSelector.confirmUse");
  const toolbarBaselineWidth = activeManualCapture ? context.intent === "start-agent" ? 344 : 314 : context.intent === "start-agent" ? 236 : 206;
  const toolbarSize = {
    width: Math.max(
      toolbarBaselineWidth,
      TOOLBAR_PADDING * 2 + TOOLBAR_CANCEL_WIDTH + TOOLBAR_GAP + (activeManualCapture ? TOOLBAR_RESET_WIDTH + TOOLBAR_GAP : 0) + estimateLabelWidth(confirmLabel) + TOOLBAR_CONFIRM_PADDING
    ),
    height: TOOLBAR_HEIGHT
  };
  const toolbarPosition = showToolbar && previewCandidate ? resolveTargetWindowToolbarPosition({
    targetBounds: previewCandidate.bounds,
    displayBounds: context.display.bounds,
    toolbarSize
  }) : null;
  const maskRects = previewRect ? [
    { left: 0, top: 0, width: context.display.bounds.width, height: previewRect.y },
    { left: 0, top: previewRect.y, width: previewRect.x, height: previewRect.height },
    {
      left: previewRect.x + previewRect.width,
      top: previewRect.y,
      width: Math.max(0, context.display.bounds.width - previewRect.x - previewRect.width),
      height: previewRect.height
    },
    {
      left: 0,
      top: previewRect.y + previewRect.height,
      width: context.display.bounds.width,
      height: Math.max(0, context.display.bounds.height - previewRect.y - previewRect.height)
    }
  ] : [
    {
      left: 0,
      top: 0,
      width: context.display.bounds.width,
      height: context.display.bounds.height
    }
  ];
  const baseHint = context.intent === "start-agent" ? t("windowSelector.hintStartAgent") : t("windowSelector.hintPickChat");
  const hint = selectionState.isRefreshing ? selectionState.notice === "workspace_changed" ? t("windowSelector.switchingWorkspace") : t("windowSelector.detectingWindows") : selectionState.notice === "workspace_changed" ? t("windowSelector.workspaceChanged") : selectionState.notice === "target_unavailable" ? t("windowSelector.targetUnavailable") : contentPreview?.status === "resolving" ? t("windowSelector.resolvingWebArea") : contentPreview?.status === "ready" ? t("windowSelector.webAreaReady") : contentPreview?.status === "unavailable" ? t("windowSelector.webAreaUnavailable") : baseHint;
  const contentPreviewStatus = activeManualCapture ? t("windowSelector.manualCaptureStatus") : contentPreview?.status === "resolving" ? t("windowSelector.captureResolving") : contentPreview?.status === "ready" ? t("windowSelector.captureReady") : contentPreview?.status === "unavailable" ? t("windowSelector.captureUnavailable") : null;
  const beginCaptureResize = (event, handle) => {
    if (!previewCandidate || !effectiveCaptureBounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    captureDragRef.current = {
      pointerId: event.pointerId,
      candidateId: previewCandidate.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds: { ...effectiveCaptureBounds },
      currentBounds: { ...effectiveCaptureBounds },
      moved: false
    };
  };
  const continueCaptureResize = (event) => {
    const drag = captureDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !previewCandidate) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = resizeTargetWindowCaptureBounds({
      startBounds: drag.startBounds,
      windowBounds: previewCandidate.bounds,
      handle: drag.handle,
      deltaX: event.clientX - drag.startClientX,
      deltaY: event.clientY - drag.startClientY
    });
    drag.currentBounds = bounds;
    drag.moved = drag.moved || event.clientX !== drag.startClientX || event.clientY !== drag.startClientY;
    if (!drag.moved) return;
    setManualCapture({
      candidateId: drag.candidateId,
      bounds
    });
  };
  const endCaptureResize = (event) => {
    const drag = captureDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    captureDragRef.current = null;
    if (drag.moved) {
      const pendingDraft = {
        candidateId: drag.candidateId,
        bounds: { ...drag.currentBounds }
      };
      pendingCaptureDraftRef.current = pendingDraft;
      void setTargetWindowCaptureDraft(sessionId, drag.candidateId, drag.currentBounds).then(
        (saved) => {
          if (pendingCaptureDraftRef.current !== pendingDraft) return;
          pendingCaptureDraftRef.current = null;
          if (!saved) setManualCapture(null);
        },
        () => {
          if (pendingCaptureDraftRef.current !== pendingDraft) return;
          pendingCaptureDraftRef.current = null;
          setManualCapture(null);
        }
      );
    }
  };
  const resetCapture = () => {
    if (!previewCandidate) return;
    const pendingReset = { candidateId: previewCandidate.id, bounds: null };
    pendingCaptureDraftRef.current = pendingReset;
    setManualCapture(null);
    void setTargetWindowCaptureDraft(sessionId, previewCandidate.id, null).then(
      (reset) => {
        if (pendingCaptureDraftRef.current !== pendingReset) return;
        pendingCaptureDraftRef.current = null;
        if (!reset && context.captureDraft?.candidateId === previewCandidate.id) {
          setManualCapture({
            candidateId: context.captureDraft.candidateId,
            bounds: { ...context.captureDraft.bounds }
          });
        }
      },
      () => {
        if (pendingCaptureDraftRef.current !== pendingReset) return;
        pendingCaptureDraftRef.current = null;
        if (context.captureDraft?.candidateId === previewCandidate.id) {
          setManualCapture({
            candidateId: context.captureDraft.candidateId,
            bounds: { ...context.captureDraft.bounds }
          });
        }
      }
    );
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: `target-window-selector ${selectionState.isRefreshing ? "target-window-selector--refreshing" : ""}`,
      onPointerMove: handlePointerMove,
      onPointerDown: handleCanvasClick,
      onDoubleClick: handleCanvasDoubleClick,
      children: [
        maskRects.map((rect, index) => /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: "target-window-selector__mask",
            style: rect
          },
          index
        )),
        innerMaskRects.map((rect, index) => /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: "target-window-selector__capture-mask",
            style: rect
          },
          `capture-mask-${index}`
        )),
        previewRect && previewCandidate && /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: `target-window-selector__candidate ${isLocked ? "target-window-selector__candidate--locked" : ""}`,
            style: {
              left: previewRect.x,
              top: previewRect.y,
              width: previewRect.width,
              height: previewRect.height
            },
            "aria-label": `${previewCandidate.appName} ${previewCandidate.title}`,
            children: /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "target-window-selector__candidate-label", children: [
              previewCandidate.appName,
              previewCandidate.title && previewCandidate.title !== previewCandidate.appName ? ` · ${previewCandidate.title}` : ""
            ] })
          }
        ),
        contentPreviewRect && /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            className: "target-window-selector__content-preview",
            style: {
              left: contentPreviewRect.x,
              top: contentPreviewRect.y,
              width: contentPreviewRect.width,
              height: contentPreviewRect.height
            },
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "target-window-selector__content-preview-label", children: activeManualCapture ? t("windowSelector.customCaptureLabel") : contentPreview?.status === "ready" ? t("windowSelector.webCaptureLabel") : t("windowSelector.dragCaptureLabel") }),
              isLocked && contentPreview && CAPTURE_HANDLES.filter(
                ({ handle }) => isCaptureHandleOnDisplay(handle, effectiveCaptureBounds, context.display.bounds)
              ).map(({ handle, labelKey }) => /* @__PURE__ */ jsxRuntimeExports.jsx(
                "button",
                {
                  type: "button",
                  "aria-label": t(labelKey),
                  className: `target-window-selector__capture-handle target-window-selector__capture-handle--${handle}`,
                  onPointerDown: (event) => beginCaptureResize(event, handle),
                  onPointerMove: continueCaptureResize,
                  onPointerUp: endCaptureResize,
                  onPointerCancel: endCaptureResize
                },
                handle
              ))
            ]
          }
        ),
        isLocked && previewRect && contentPreviewStatus && /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: `target-window-selector__content-status target-window-selector__content-status--${activeManualCapture ? "manual" : contentPreview?.status}`,
            style: {
              left: previewRect.x + previewRect.width - 8,
              top: previewRect.y + 8
            },
            children: contentPreviewStatus
          }
        ),
        !isLocked && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "target-window-selector__hint", children: hint }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "target-window-selector__standalone-cancel",
              onPointerDown: (event) => event.stopPropagation(),
              onDoubleClick: (event) => event.stopPropagation(),
              onClick: cancel,
              children: t("windowSelector.cancelSelection")
            }
          )
        ] }),
        toolbarPosition && previewCandidate && /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            className: "target-window-selector__toolbar",
            style: {
              left: toolbarPosition.x,
              top: toolbarPosition.y,
              minWidth: toolbarSize.width
            },
            onPointerMove: (event) => event.stopPropagation(),
            onPointerDown: (event) => event.stopPropagation(),
            onDoubleClick: (event) => event.stopPropagation(),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "target-window-selector__cancel", onClick: cancel, children: t("windowSelector.cancel") }),
              activeManualCapture && /* @__PURE__ */ jsxRuntimeExports.jsx(
                "button",
                {
                  type: "button",
                  className: "target-window-selector__reset-capture",
                  onClick: resetCapture,
                  children: t("windowSelector.resetCapture")
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "button",
                {
                  type: "button",
                  className: "target-window-selector__confirm",
                  "aria-keyshortcuts": "Enter",
                  onClick: confirmLockedCandidate,
                  children: confirmLabel
                }
              )
            ]
          }
        )
      ]
    }
  );
}
const container = document.getElementById("root");
clientExports.createRoot(container).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(TranslationProvider, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(TargetWindowSelectorApp, {}) })
);
