"use strict";
(() => {
  // build/bridge/content-bridge.js
  var PAGE_SOURCE = "web-state-inspector-page";
  var FRAME_ID_ATTR = "webStateInspectorFrameId";
  function getOrCreateFrameId() {
    let id = document.documentElement.dataset[FRAME_ID_ATTR];
    if (!id) {
      id = crypto.randomUUID();
      document.documentElement.dataset[FRAME_ID_ATTR] = id;
    }
    return id;
  }
  function computeIsMainFrame() {
    try {
      return window === window.top;
    } catch {
      return false;
    }
  }
  function computeIsCrossOrigin() {
    try {
      void window.top?.location.href;
      return false;
    } catch {
      return true;
    }
  }
  getOrCreateFrameId();
  function isRequest(value) {
    const request = value;
    return Boolean(request && request.source === PAGE_SOURCE && request.type === "request" && typeof request.requestId === "string" && typeof request.method === "string");
  }
  function injectPageApi() {
    if (document.documentElement.dataset.webStateInspectorBridge === "1")
      return;
    document.documentElement.dataset.webStateInspectorBridge = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("bridge/page-bridge.js");
    script.async = false;
    script.addEventListener("load", () => script.remove(), { once: true });
    script.addEventListener("error", () => {
      delete document.documentElement.dataset.webStateInspectorBridge;
      script.remove();
    }, { once: true });
    (document.head || document.documentElement).append(script);
  }
  if (computeIsMainFrame()) {
    injectPageApi();
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || !isRequest(event.data))
      return;
    chrome.runtime.sendMessage({ type: "WEB_STATE_INSPECTOR_BRIDGE_REQUEST", request: event.data }).then((response) => {
      if (response)
        window.postMessage(response, location.origin);
    }).catch(() => void 0);
  });
  void chrome.runtime.sendMessage({
    type: "FRAME_REGISTERED",
    frameId: getOrCreateFrameId(),
    isMainFrame: computeIsMainFrame(),
    isCrossOrigin: computeIsCrossOrigin(),
    url: location.href,
    origin: location.origin
  }).catch(() => void 0);
})();
