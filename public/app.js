const API = '';
const storageKey = 'contextstream-profile-id';
const form = document.querySelector('#profile-form');
const profileCode = document.querySelector('#profile-code');
const historyList = document.querySelector('#history-list');
const clearHistory = document.querySelector('#clear-history');
let profileId = localStorage.getItem(storageKey) || '';

const currencySelect = form.elements.currency;
if (currencySelect && typeof Intl.supportedValuesOf === 'function') {
  const known = new Set([...currencySelect.options].map(option => option.value));
  for (const code of Intl.supportedValuesOf('currency')) if (!known.has(code)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    currencySelect.append(option);
  }
}

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function showProfileCode(id) {
  profileCode.replaceChildren();
  if (!id) return;
  const label = document.createElement('span');
  label.textContent = 'Extension profile code: ';
  const code = document.createElement('code');
  code.textContent = id;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(id); copy.textContent = 'Copied'; }
    catch { copy.textContent = 'Select and copy the code'; }
  });
  profileCode.append(label, code, copy);
}

async function refreshProfile() {
  if (!profileId) {
    historyList.textContent = 'Save a profile and connect its code in the extension to keep selected video context here.';
    return;
  }
  try {
    const profile = await request(`/api/profile?id=${encodeURIComponent(profileId)}`);
    form.elements.location.value = profile.location || '';
    form.elements.maxPrice.value = profile.maxPrice || '';
    form.elements.currency.value = profile.currency || 'auto';
    form.elements.interests.value = (profile.interests || []).join(', ');
    form.elements.discoveryIntent.value = profile.discoveryIntent || '';
    form.elements.contextNotes.value = profile.contextNotes || '';
    form.elements.historyEnabled.checked = Boolean(profile.historyEnabled);
    showProfileCode(profileId);
    await refreshHistory();
  } catch (error) {
    historyList.textContent = `Could not load this profile: ${error.message}`;
  }
}

async function refreshHistory() {
  if (!profileId) return;
  try {
    const data = await request(`/api/discoveries?profileId=${encodeURIComponent(profileId)}`);
    clearHistory.hidden = !data.discoveries.length;
    historyList.replaceChildren();
    if (!data.enabled && !data.discoveries.length) {
      historyList.innerHTML = '<div class="history-empty">Discovery history is off. Turn it on in Preferences to save selected items, search results, and links you explored.</div>';
      return;
    }
    if (!data.enabled) {
      const paused = document.createElement('div');
      paused.className = 'history-empty';
      paused.textContent = 'Saving is off. Existing history remains until you clear it below.';
      historyList.append(paused);
    }
    if (!data.discoveries.length) {
      historyList.innerHTML = '<div class="history-empty">No saved discoveries yet. Connect this profile in the extension and select an item in a frame.</div>';
      return;
    }
    const groups = new Map();
    for (const item of data.discoveries) {
      const key = `${item.videoUrl}|${item.videoTitle}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const items of groups.values()) {
      const first = items[0];
      const card = document.createElement('details');
      card.className = 'history-card history-group';
      const summary = document.createElement('summary');
      const heading = document.createElement('span');
      heading.className = 'history-heading';
      heading.textContent = first.videoTitle || 'YouTube video';
      const minute = Math.floor((first.videoTime || 0) / 60);
      const second = Math.floor((first.videoTime || 0) % 60).toString().padStart(2, '0');
      const meta = document.createElement('small');
      const productCount = items.reduce((count, item) => count + (item.products || []).length, 0);
      meta.textContent = `${minute}:${second} · ${items.length} item${items.length === 1 ? '' : 's'} · ${productCount} result${productCount === 1 ? '' : 's'}`;
      summary.append(heading, meta);
      const removeAll = document.createElement('button');
      removeAll.type = 'button';
      removeAll.className = 'history-remove';
      removeAll.textContent = 'Remove';
      removeAll.setAttribute('aria-label', `Remove saved discoveries from ${first.videoTitle || 'this video'} at ${minute}:${second}`);
      removeAll.addEventListener('click', async () => {
        try {
          for (const item of items) await request(`/api/discoveries?profileId=${encodeURIComponent(profileId)}&id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await refreshHistory();
        } catch (error) { removeAll.textContent = error.message; }
      });
      const content = document.createElement('div');
      content.className = 'history-content';
      const videoLink = document.createElement('a');
      videoLink.href = first.videoUrl; videoLink.target = '_blank'; videoLink.rel = 'noopener noreferrer';
      videoLink.className = 'history-video-link'; videoLink.textContent = `Reopen video at ${minute}:${second} ↗`;
      content.append(videoLink);
      for (const item of items) {
        const section = document.createElement('section'); section.className = 'history-object';
        const title = document.createElement('strong');
        title.textContent = [item.label, item.brand, item.model].filter(Boolean).join(' · ');
        section.append(title);
        const products = Array.isArray(item.products) ? item.products : [];
        if (!products.length) {
          const note = document.createElement('small'); note.textContent = 'No product listings saved for this item.'; section.append(note);
        }
        for (const product of products) {
          const row = document.createElement('div'); row.className = 'history-product';
          const link = document.createElement('a'); link.href = product.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = product.title || product.retailer || product.url;
          const detail = document.createElement('small');
          const tags = [];
          if ((product.interactions || []).includes('opened')) tags.push('Opened');
          if ((product.interactions || []).includes('followup')) tags.push('Asked about');
          if (product.priceText) tags.push(product.priceText);
          else if (Number(product.priceInr) > 0) tags.push(`₹${new Intl.NumberFormat('en-IN').format(Number(product.priceInr))}`);
          if (product.retailer) tags.push(product.retailer);
          detail.textContent = tags.join(' · ');
          row.append(link); if (detail.textContent) row.append(detail); section.append(row);
        }
        for (const followup of item.followups || []) {
          const question = document.createElement('small'); question.className = 'history-followup';
          question.textContent = `You asked: ${followup.question}`; section.append(question);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'history-remove history-remove-item'; remove.textContent = `Remove ${item.label}`;
        remove.addEventListener('click', async () => { try { await request(`/api/discoveries?profileId=${encodeURIComponent(profileId)}&id=${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await refreshHistory(); } catch (error) { remove.textContent = error.message; } });
        section.append(remove); content.append(section);
      }
      card.append(summary, removeAll, content); historyList.append(card);
    }
  } catch (error) {
    historyList.textContent = `Could not load saved discoveries: ${error.message}`;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const saved = document.querySelector('#saved');
  saved.textContent = 'Saving…';
  const values = new FormData(form);
  const interests = String(values.get('interests') || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 12);
  try {
    const profile = await request('/api/profile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: profileId || undefined,
        location: values.get('location'),
        maxPrice: values.get('maxPrice'),
        currency: values.get('currency'),
        interests,
        discoveryIntent: values.get('discoveryIntent'),
        contextNotes: values.get('contextNotes'),
        historyEnabled: form.elements.historyEnabled.checked
      })
    });
    profileId = profile.id;
    localStorage.setItem(storageKey, profileId);
    showProfileCode(profileId);
    saved.textContent = 'Preferences saved. The extension will use this profile on its next search.';
    await refreshHistory();
  } catch (error) {
    saved.textContent = `Could not save: ${error.message}`;
  }
});

clearHistory.addEventListener('click', async () => {
  clearHistory.disabled = true;
  try {
    await request(`/api/discoveries?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    await refreshHistory();
  } catch (error) {
    historyList.textContent = `Could not clear history: ${error.message}`;
  } finally { clearHistory.disabled = false; }
});

request('/api/health').then(health => {
  document.querySelector('#health').textContent = `Gemini ${health.aiConfigured ? 'ready' : 'needs a key'} · Live search ${health.liveProductSearchConfigured ? 'ready' : 'needs a key'}`;
}).catch(() => {
  document.querySelector('#health').textContent = 'Service unavailable. Start it with npm start.';
});
refreshProfile();

const providerKeyForm = document.querySelector('#provider-key-form');
const providerKeyList = document.querySelector('#provider-key-list');
const providerKeyStatus = document.querySelector('#key-status');

async function refreshProviderKeys() {
  if (!providerKeyList) return;
  try {
    const data = await request('/api/provider-keys');
    providerKeyList.replaceChildren();
    if (!data.keys.length) {
      providerKeyList.textContent = 'No provider keys configured yet.';
      return;
    }
    for (const item of data.keys) {
      const row = document.createElement('div');
      row.className = 'provider-key-row';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${item.provider} · ${item.label}`;
      const meta = document.createElement('small');
      meta.textContent = `${item.source === 'environment' ? 'Environment' : 'Saved locally'} · group ${item.quotaGroup} · •••• ${item.lastFour} · ${item.status}`;
      info.append(title, meta);
      row.append(info);
      if (item.source !== 'environment') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try { await request(`/api/provider-keys/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await refreshProviderKeys(); }
          catch (error) { providerKeyStatus.textContent = error.message; remove.disabled = false; }
        });
        row.append(remove);
      }
      providerKeyList.append(row);
    }
  } catch (error) {
    providerKeyList.textContent = `Key manager unavailable: ${error.message}`;
  }
}

providerKeyForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(providerKeyForm);
  providerKeyStatus.textContent = 'Encrypting and saving…';
  try {
    await request('/api/provider-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: values.get('provider'), label: values.get('label'), quotaGroup: values.get('quotaGroup'), secret: values.get('secret') }) });
    providerKeyForm.reset();
    providerKeyStatus.textContent = 'Key saved. The secret will not be shown again.';
    await refreshProviderKeys();
  } catch (error) {
    providerKeyStatus.textContent = `Could not save key: ${error.message}`;
  }
});

refreshProviderKeys();
