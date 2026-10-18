const status = document.querySelector('#status');
const button = document.querySelector('#analyze');
const sessionButton = document.querySelector('#session');
const profile = document.querySelector('#profile');
const serverForm = document.querySelector('#server-form');
const serverInput = document.querySelector('#server-url');
const shareCache = document.querySelector('#share-cache');
const cacheStatus = document.querySelector('#cache-status');
let apiBase = 'http://localhost:8080';
sessionButton.disabled = true;

async function checkSharedCache() {
  cacheStatus.textContent = 'Checking availability…';
  shareCache.disabled = true;
  try {
    const health = await fetch(new URL('/api/health', apiBase), { signal: AbortSignal.timeout(5000) });
    const details = await health.json();
    const connected = details.sharedVideoCacheConnected === true;
    shareCache.disabled = !connected;
    cacheStatus.textContent = connected ? 'Shared discoveries are available.' : 'Shared discoveries are unavailable right now.';
  } catch {
    cacheStatus.textContent = 'Shared discoveries are unavailable right now.';
  } finally { sessionButton.disabled = false; }
}

chrome.storage.local.get(['apiBase', 'shareVideoDiscoveries'], value => {
  apiBase = value.apiBase || apiBase;
  serverInput.value = apiBase;
  shareCache.checked = value.shareVideoDiscoveries === true;
  try { profile.href = new URL('/#preferences', apiBase).href; } catch {}
  void checkSharedCache();
});

shareCache.addEventListener('change', () => {
  chrome.storage.local.set({ shareVideoDiscoveries: shareCache.checked });
});

serverForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const parsed = new URL(serverInput.value.trim());
    const local = ['http://localhost:8080', 'http://127.0.0.1:8080'].includes(parsed.origin);
    const cloudRun = parsed.protocol === 'https:' && (parsed.hostname.endsWith('.run.app') || parsed.hostname === 'run.app');
    if (!local && !cloudRun) throw new Error('Use localhost:8080 or your HTTPS Cloud Run .run.app address.');
    apiBase = parsed.origin;
    await chrome.storage.local.set({ apiBase });
    profile.href = new URL('/#preferences', apiBase).href;
    status.textContent = 'Service address saved.';
    void checkSharedCache();
  } catch (error) { status.textContent = error.message || 'Enter a valid server address.'; }
});

async function beginAnalysis() {
  button.disabled = true;
  status.textContent = 'Opening your discoveries…';
  chrome.runtime.sendMessage({ type: 'POPUP_ANALYZE_ACTIVE_TAB' }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = response?.error || chrome.runtime.lastError?.message || 'Could not start frame analysis.';
      button.disabled = false;
      return;
    }
    status.textContent = 'Your discoveries are ready in the ContextStream panel.';
  });
}

async function beginVisualSession() {
  button.disabled = true;
  sessionButton.disabled = true;
  status.textContent = 'Starting to watch for new finds…';
  const shareVideoDiscoveries = shareCache.checked && !shareCache.disabled;
  chrome.storage.local.set({ shareVideoDiscoveries }, () => chrome.runtime.sendMessage({ type: 'POPUP_START_VISUAL_SESSION_ACTIVE_TAB', shareVideoDiscoveries }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = response?.error || chrome.runtime.lastError?.message || 'Could not start the visual session.';
      button.disabled = false;
      sessionButton.disabled = false;
      return;
    }
    status.textContent = 'ContextStream is watching for new finds.';
    window.setTimeout(() => window.close(), 500);
  }));
}

button.addEventListener('click', beginAnalysis);
sessionButton.addEventListener('click', beginVisualSession);
