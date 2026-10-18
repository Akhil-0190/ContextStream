const status = document.querySelector('#status');
const button = document.querySelector('#analyze');
const sessionButton = document.querySelector('#session');
const profile = document.querySelector('#profile');

chrome.storage.local.get(['apiBase'], value => {
  const base = value.apiBase || 'http://localhost:8080';
  try { profile.href = new URL('/#preferences', base).href; } catch {}
});

async function beginAnalysis() {
  button.disabled = true;
  status.textContent = 'Starting frame analysis on the current YouTube tab…';
  chrome.runtime.sendMessage({ type: 'POPUP_ANALYZE_ACTIVE_TAB' }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = response?.error || chrome.runtime.lastError?.message || 'Could not start frame analysis.';
      button.disabled = false;
      return;
    }
    status.textContent = 'Frame analysis started in the ContextStream panel.';
  });
}

async function beginVisualSession() {
  button.disabled = true;
  sessionButton.disabled = true;
  status.textContent = 'Starting a visual session on the current YouTube tab…';
  chrome.runtime.sendMessage({ type: 'POPUP_START_VISUAL_SESSION_ACTIVE_TAB' }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = response?.error || chrome.runtime.lastError?.message || 'Could not start the visual session.';
      button.disabled = false;
      sessionButton.disabled = false;
      return;
    }
    status.textContent = 'Visual session started. It samples up to five frames, 20 seconds apart.';
    window.setTimeout(() => window.close(), 500);
  });
}

button.addEventListener('click', beginAnalysis);
sessionButton.addEventListener('click', beginVisualSession);
