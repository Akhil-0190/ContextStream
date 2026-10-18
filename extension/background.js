const activeApiRequests = new Map();
async function ensureCaptureDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.some(context => context.documentUrl?.endsWith('/offscreen.html'))) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Extract the user-selected current YouTube video frame at the tab capture resolution.'
  });
}
async function capturePlayerFrame(tabId, crop) {
  try {
    await ensureCaptureDocument();
    // Create the consumer first so the short-lived stream ID cannot expire
    // while the offscreen document is being initialized.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CAPTURE_PLAYER_FRAME', streamId, crop });
    if (!result?.ok) throw new Error(result?.error || 'The tab media stream could not be decoded.');
    return { image: result.image, method: 'tab-media-stream', width: result.width, height: result.height };
  } catch (error) {
    console.warn(`[Capture] Tab media-stream capture unavailable; using full-resolution screenshot crop (${error.message}).`);
    const tab = await chrome.tabs.get(tabId);
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 100 });
    return { image: screenshot, method: 'screenshot-fallback' };
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'API_FETCH') {
    (async () => {
      let controller;
      try {
        const target = new URL(message.url);
        if (!['http://localhost:8080', 'http://127.0.0.1:8080'].includes(target.origin)) throw new Error('ContextStream is configured to use an unrecognized local server address.');
        controller = new AbortController();
        activeApiRequests.set(message.requestId, controller);
        const response = await fetch(target, {
          method: message.options?.method || 'GET',
          headers: message.options?.headers || {},
          body: message.options?.body,
          cache: 'no-store',
          signal: controller.signal
        });
        respond({ transportOk: true, ok: response.ok, status: response.status, body: await response.text() });
      } catch (error) {
        respond({ transportOk: false, error: error.name === 'AbortError' ? 'Request cancelled.' : error.message });
      } finally {
        if (activeApiRequests.get(message.requestId) === controller) activeApiRequests.delete(message.requestId);
      }
    })();
    return true;
  }
  if (message.type === 'CANCEL_API_FETCH') {
    activeApiRequests.get(message.requestId)?.abort();
    return;
  }
  if (message.type === 'POPUP_ANALYZE_ACTIVE_TAB') {
    (async () => {
      try {
        const tab = await getActiveYoutubeTab();
        if (!/^https:\/\/(www\.)?youtube\.com\/watch/.test(tab?.url || '')) throw new Error('Open a YouTube watch page before analyzing a frame.');
        if (!tab?.id) throw new Error('Open a YouTube watch page before analyzing a frame.');
        await sendAnalyzeToTab(tab.id);
        respond({ ok: true });
      } catch (error) {
        respond({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (message.type === 'POPUP_START_VISUAL_SESSION_ACTIVE_TAB') {
    (async () => {
      try {
        const tab = await getActiveYoutubeTab();
        if (!/^https:\/\/(www\.)?youtube\.com\/watch/.test(tab?.url || '') || !tab?.id) throw new Error('Open a YouTube watch page before starting a visual session.');
        await sendSessionToTab(tab.id);
        respond({ ok: true });
      } catch (error) {
        respond({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (message.type !== 'CAPTURE_TAB') return;
  (async () => {
    try {
      if (!sender.tab?.id) throw new Error('Could not identify the current YouTube tab.');
      const capture = await capturePlayerFrame(sender.tab.id, message.crop);
      respond({ ok: true, ...capture });
    } catch (error) { respond({ ok: false, error: error.message }); }
  })();
  return true;
});

async function getActiveYoutubeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !/^https:\/\/(www\.)?youtube\.com\/watch/.test(tab.url || '')) return null;
  return tab;
}

async function sendAnalyzeToTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_ANALYZE' });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_ANALYZE' });
  }
}

async function sendSessionToTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_START_SESSION' });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_START_SESSION' });
  }
}
