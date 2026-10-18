importScripts('firebase-config.js');

const activeApiRequests = new Map();
let offscreenDocumentPromise = null;
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
const FIREBASE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
let authTokenPromise = null;

async function firebaseAuthToken(forceRefresh = false) {
  if (authTokenPromise) return authTokenPromise;
  authTokenPromise = (async () => {
    const config = self.CONTEXTSTREAM_FIREBASE_CONFIG;
    if (!config?.apiKey || !config?.projectId) throw new Error('Firebase client configuration is missing.');
    const saved = await chrome.storage.local.get(['firebaseIdToken', 'firebaseRefreshToken', 'firebaseTokenExpiresAt']);
    if (!forceRefresh && saved.firebaseIdToken && Number(saved.firebaseTokenExpiresAt) > Date.now() + 60_000) return saved.firebaseIdToken;

    let result;
    if (saved.firebaseRefreshToken) {
      const response = await fetch(`${FIREBASE_TOKEN_URL}?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.firebaseRefreshToken })
      });
      result = await response.json();
      if (!response.ok) {
        await chrome.storage.local.remove(['firebaseIdToken', 'firebaseRefreshToken', 'firebaseTokenExpiresAt']);
        if (!['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED'].includes(result.error?.message)) throw new Error('Firebase sign-in refresh failed. Reopen the extension and try again.');
      } else {
        await chrome.storage.local.set({ firebaseIdToken: result.id_token, firebaseRefreshToken: result.refresh_token, firebaseTokenExpiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 });
        return result.id_token;
      }
    }

    const response = await fetch(`${FIREBASE_AUTH_URL}:signUp?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Firebase anonymous sign-in failed.');
    await chrome.storage.local.set({ firebaseIdToken: result.idToken, firebaseRefreshToken: result.refreshToken, firebaseTokenExpiresAt: Date.now() + Number(result.expiresIn || 3600) * 1000 });
    return result.idToken;
  })();
  try { return await authTokenPromise; } finally { authTokenPromise = null; }
}

function isAllowedApiTarget(target) {
  if (['http://localhost:8080', 'http://127.0.0.1:8080'].includes(target.origin)) return true;
  return target.protocol === 'https:' && (target.hostname.endsWith('.run.app') || target.hostname === 'run.app');
}
async function ensureCaptureDocument() {
  if (offscreenDocumentPromise) return offscreenDocumentPromise;
  offscreenDocumentPromise = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.some(context => context.documentUrl?.endsWith('/offscreen.html'))) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'WORKERS'],
      justification: 'Capture selected YouTube frames and run the local object detector in an extension-origin worker.'
    });
  })();
  try { await offscreenDocumentPromise; } finally { offscreenDocumentPromise = null; }
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
  if (message.type === 'LOCAL_DETECTOR_INITIALIZE' || message.type === 'LOCAL_DETECTOR_FRAME') {
    (async () => {
      try {
        if (!sender.tab?.id) throw new Error('The local detector request did not originate from a YouTube tab.');
        await ensureCaptureDocument();
        const result = await chrome.runtime.sendMessage({ target: 'offscreen', ...message, sourceTabId: sender.tab.id });
        respond(result || { ok: false, error: 'The offscreen detector did not return a response.' });
      } catch (error) { respond({ ok: false, error: error.message }); }
    })();
    return true;
  }
  if (message.type === 'API_FETCH') {
    (async () => {
      let controller;
      try {
        const target = new URL(message.url);
        if (!isAllowedApiTarget(target)) throw new Error('ContextStream is configured to use an unrecognized server address.');
        controller = new AbortController();
        activeApiRequests.set(message.requestId, controller);
        const headers = new Headers(message.options?.headers || {});
        headers.set('authorization', `Bearer ${await firebaseAuthToken()}`);
        const requestOptions = {
          method: message.options?.method || 'GET',
          headers,
          body: message.options?.body,
          cache: 'no-store',
          signal: controller.signal
        };
        let response = await fetch(target, requestOptions);
        if (response.status === 401) {
          headers.set('authorization', `Bearer ${await firebaseAuthToken(true)}`);
          response = await fetch(target, requestOptions);
        }
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
        const shareVideoDiscoveries = message.shareVideoDiscoveries === true;
        await chrome.storage.local.set({ shareVideoDiscoveries });
        await sendSessionToTab(tab.id, shareVideoDiscoveries);
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

async function sendSessionToTab(tabId, shareVideoDiscoveries = false) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_START_SESSION', shareVideoDiscoveries });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_CONTEXTSTREAM_AND_START_SESSION', shareVideoDiscoveries });
  }
}
