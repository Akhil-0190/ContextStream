(() => {
  if (window.__contextStreamLoaded) return;
  window.__contextStreamLoaded = true;
  let API = 'http://localhost:8080';
  let state = 'inactive';
  let discoveries = [];
  let historySessions = [];
  let keepPreviousFrames = true;
  let activeResultsView = 'current';
  let activeHistoryId = '';
  let selected = null;
  let followupMessages = [];
  let followupListings = [];
  let followupPage = 0;
  let lastAnalyzedFrame = '';
  let lastFrameAt = 0;
  let maxPrice = '';
  let location = '';
  let profileId = '';
  let historyEnabled = false;
  let analysisNotice = '';
  let visualSessionRunning = false;
  let visualSessionId = '';
  let visualSessionFrames = 0;
  let visualSessionTimer = null;
  let visualSessionError = '';
  const VISUAL_SESSION_INTERVAL_MS = 20_000;
  const VISUAL_SESSION_MAX_FRAMES = 5;
  const VISUAL_SESSION_MAX_DISCOVERIES = 20;
  const savedContextKeys = new Set();
  let analysisController = null;
  let activeAnalysisJobId = '';
  let inviteDismissed = false;
  let inviteRetryTimer = null;
  function apiRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const signal = options.signal;
      const cancel = () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_API_FETCH', requestId });
        reject(signal.reason || new DOMException('Request cancelled.', 'AbortError'));
      };
      if (signal?.aborted) return cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      const { signal: _signal, ...serializableOptions } = options;
      chrome.runtime.sendMessage({ type: 'API_FETCH', requestId, url: `${API}${path}`, options: serializableOptions }, reply => {
        signal?.removeEventListener('abort', cancel);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!reply?.transportOk) return reject(new Error(reply?.error || 'Could not reach the ContextStream server.'));
        resolve({ ok: reply.ok, status: reply.status, json: async () => JSON.parse(reply.body || '{}') });
      });
    });
  }
  function trackAction(action, details = {}) {
    const page = `${window.location.hostname}${window.location.pathname}`.slice(0, 240);
    apiRequest('/api/debug/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, details: { ...details, page } }) }).catch(() => {});
  }
  chrome.storage.local.get(['profileId','apiBase'], async value => {
    profileId=value.profileId||'';
    API=value.apiBase||API;
    if(root.querySelector('#cs-profile-id'))root.querySelector('#cs-profile-id').value=profileId;
    if(profileId)try{const r=await apiRequest(`/api/profile?id=${encodeURIComponent(profileId)}`);const p=await r.json();maxPrice=p.maxPrice||'';location=p.location||'';historyEnabled=Boolean(p.historyEnabled);}catch{}
  });
  const root = document.createElement('div'); root.id = 'contextstream-root'; document.documentElement.appendChild(root);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currencyCode = value => {const raw=String(value||'INR').trim().toUpperCase();const aliases={'₹':'INR','RS':'INR','RS.':'INR','$':'USD','US$':'USD','€':'EUR','£':'GBP','¥':'JPY','C$':'CAD','A$':'AUD'};const code=aliases[raw]||raw;return /^[A-Z]{3}$/.test(code)?code:'INR';};
  const money = p => new Intl.NumberFormat('en-IN', { style:'currency', currency:currencyCode(p.currency), maximumFractionDigits:0 }).format(p.price);
  function shell() {
    root.innerHTML = `<button class="cs-tab" id="cs-tab" aria-label="Open ContextStream">✳</button>
      <aside class="cs-panel" id="cs-panel" aria-label="ContextStream">
        <header class="cs-head"><div><div class="cs-brand">✳ ContextStream</div><div class="cs-sub">Explore what catches your eye</div></div><button class="cs-close" id="cs-close" aria-label="Close ContextStream panel" title="Close panel">✳</button></header>
        <div class="cs-body" id="cs-body"></div>
      </aside>`;
    const setPanelOpen = open => {
      const panel=root.querySelector('#cs-panel');
      panel.classList.toggle('open',open); root.classList.toggle('panel-open',open);
      if(open)document.querySelector('#contextstream-invite')?.remove();else if(state==='inactive')invite();
      trackAction(open?'panel.opened':'panel.closed');
    };
    root.querySelector('#cs-tab').onclick = () => setPanelOpen(true);
    root.querySelector('#cs-close').onclick = () => setPanelOpen(false);
    render();
  }
  function invite() {
    if (inviteDismissed || !document.querySelector('ytd-watch-flexy') || root.querySelector('.cs-panel.open') || document.querySelector('#contextstream-invite')) return;
    const el = document.createElement('div'); el.id='contextstream-invite'; el.setAttribute('role','status');
    el.style.cssText='position:fixed;z-index:2147483647;right:18px;top:92px;display:flex;align-items:center;gap:10px;width:max-content;max-width:min(320px,calc(100vw - 36px));padding:7px 9px 7px 12px;border:1px solid #456351;border-radius:12px;background:#13271d;color:#fff;box-shadow:0 5px 20px #0005;font:600 11px/1.5 Poppins,ui-sans-serif,system-ui,sans-serif;pointer-events:auto';
    el.innerHTML=`<span>To analyze a frame, click the ContextStream toolbar icon.</span><button class="cs-invite-x" aria-label="Dismiss" style="border:0;background:transparent;color:#fff;cursor:pointer;font:18px/1 Poppins,ui-sans-serif,system-ui,sans-serif;padding:0 2px">×</button>`;
    document.documentElement.appendChild(el);
    el.querySelector('.cs-invite-x').onclick=()=>{ inviteDismissed=true; trackAction('watch-page-invite.dismissed'); el.remove(); };
  }
  function scheduleInviteRetry() {
    clearTimeout(inviteRetryTimer);
    let attempts = 0;
    const retry = () => {
      invite();
      if (!document.querySelector('#contextstream-invite') && !inviteDismissed && !root.querySelector('.cs-panel.open') && attempts++ < 20) inviteRetryTimer = setTimeout(retry, 250);
    };
    retry();
  }
  function activeDiscoveries() {
    if (activeResultsView === 'history') return historySessions.find(session => session.id === activeHistoryId)?.discoveries || [];
    return discoveries;
  }
  function frameTimeLabel(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  function currentVideoId(){try{return new URL(window.location.href).searchParams.get('v')||'';}catch{return '';}}
  function discoveryCaptureContext(discovery,bbox=discovery?.bbox){
    return {...(discovery?.captureContext||{}),videoId:currentVideoId(),videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:discovery?.captureContext?.sessionId||discovery?.sessionId||`frame-${discovery?.id||'unknown'}`,sampleIndex:discovery?.captureContext?.sampleIndex||0,videoTime:Number.isFinite(discovery?.videoTime)?discovery.videoTime:null,discoveryId:discovery?.id||'',itemLabel:discovery?.label||'',bbox:Array.isArray(bbox)?bbox:null};
  }
  function render() {
    const box=root.querySelector('#cs-body'); if(!box) return;
    const previousScrollTop=box.scrollTop;
    const status=visualSessionRunning?`Visual session · ${visualSessionFrames}/${VISUAL_SESSION_MAX_FRAMES} frames`:analysisNotice||({inactive:'Ready when you are',active:'Ready · frame analysis is on demand',paused:'Paused',stopped:'Stopped'}[state]);
    const shownDiscoveries=activeDiscoveries();
    const selectedSession=historySessions.find(session=>session.id===activeHistoryId);
    box.innerHTML=`<div class="cs-status"><span class="cs-dot ${state}"></span><span>${status}</span></div>
      <div class="cs-controls">${state==='active'?'<button id="cs-pause">Pause</button>':''}${state==='paused'?'<button id="cs-resume">Resume</button>':''}${state==='stopped'?'<button id="cs-start">Start again</button>':''}<button class="quiet" id="cs-stop">Stop</button></div>
      ${visualSessionRunning?'':`<button class="cs-session-start" id="cs-session-start">${visualSessionFrames>=VISUAL_SESSION_MAX_FRAMES?'Start a new visual session':'Start visual session · up to 5 frames'}</button>`}
      <button class="cs-analyze" id="cs-analyze" ${state==='active'&&!visualSessionRunning?'':'disabled'}>✧ ${visualSessionRunning?'Visual session is sampling':state==='paused'?'Resume to analyze':state==='stopped'?'Start again to analyze':'Analyze this frame'}</button>
      <label class="cs-keep-history"><input type="checkbox" id="cs-keep-history" ${keepPreviousFrames?'checked':''}> Keep previous frame results</label>
      <p class="cs-hint">One-frame analysis stays available. A visual session samples up to five frames, 20 seconds apart, after you start it. Only selected objects are searched. If capture is blocked, start the session from the extension toolbar popup.</p>
      <div class="cs-loading" id="cs-loading" hidden>Capturing the video frame…</div>
      <div class="cs-loading" id="cs-analysis-progress" ${analysisNotice?'':'hidden'}>${esc(analysisNotice)}</div>
      <div class="cs-error" id="cs-error" hidden></div>
      ${(discoveries.length||historySessions.length)?`<nav class="cs-result-tabs" aria-label="Analysis results"><button id="cs-current-tab" class="${activeResultsView==='current'?'active':''}">${visualSessionId?'This session':'Current frame'}</button><button id="cs-history-tab" class="${activeResultsView==='history'?'active':''}" ${historySessions.length?'':'disabled'}>Previous frames${historySessions.length?` (${historySessions.length})`:''}</button></nav>`:''}
      ${activeResultsView==='history'&&historySessions.length?`<div class="cs-history-list">${historySessions.map(session=>`<button class="cs-history-item ${session.id===activeHistoryId?'active':''}" data-session-id="${esc(session.id)}"><span>${esc(session.title||'Video frame')}</span><small>${esc(session.timeLabel)} · ${session.discoveries.length} item${session.discoveries.length===1?'':'s'}</small></button>`).join('')}<button class="cs-clear-history" id="cs-clear-history">Clear previous frames</button></div>${selectedSession?`<p class="cs-session-label">${esc(selectedSession.title||'Previous frame')} · ${esc(selectedSession.timeLabel)}</p>`:''}`:''}
      ${shownDiscoveries.length?`<section><h3>${activeResultsView==='history'?'Items in previous frame':visualSessionId?'Items seen in this session':'Items in this frame'}</h3>${shownDiscoveries.map(d=>`<article class="cs-discovery"><button class="cs-object ${selected?.id===d.id?'selected':''}" data-id="${esc(d.id)}"><span>${esc(displayDiscoveryLabel(d,shownDiscoveries))}</span><small>${esc(d.confidence)} visual confidence · ${d.source==='discussed'?'Discussed':'Visual match'}${Number.isFinite(d.firstSeenVideoTime)?` · first seen ${frameTimeLabel(d.firstSeenVideoTime)}`:''}${d.observationTimes?.length>1?` · seen ${d.observationTimes.length} times`:''}</small></button>${d.brand||d.model?`<p class="cs-identity" data-cs-identity>Possible identity: ${esc([d.brand,d.model].filter(Boolean).join(' '))} · ${esc(d.identityConfidence||'low')} confidence</p>`:''}${d.visibleText?.length?`<p class="cs-evidence" data-cs-text>Text seen: ${esc(d.visibleText.join(', '))}</p>`:''}${selected?.id===d.id?`${d.evidence?`<p class="cs-evidence" data-cs-evidence>${esc(d.evidence)}</p>`:''}<div class="cs-live-results" data-live-results="${esc(d.id)}">${renderLiveResults(d)}</div>`:'<p class="cs-no-match">Select to find live listings.</p>'}</article>`).join('')}</section>`:activeResultsView==='history'?'<p class="cs-no-match">Choose a previous frame above.</p>':discoveries.length===0?'<p class="cs-no-match">Analyze a frame to see its discoveries here.</p>':''}
      <section class="cs-follow"><h3>Ask about an object</h3><p>${selected?`Selected: <b>${esc(selected.label)}</b>`:'Select a discovery to ask a follow-up.'}</p><form id="cs-chat"><input name="q" placeholder="Find a cheaper similar lamp…" ${selected?'':'disabled'}><button ${selected?'':'disabled'}>Ask</button></form><div id="cs-chat-results"></div></section>
      <details class="cs-preferences"><summary>${profileId?'Optional profile · Connected':'Connect optional preferences'}</summary><p><a href="${esc(API)}/#preferences" target="_blank" rel="noopener noreferrer">Open ContextStream profile and preferences ↗</a></p><form id="cs-profile"><input id="cs-profile-id" name="id" value="${esc(profileId)}" placeholder="Profile code"><button>Connect</button></form><small>Location and budget shape live searches. Local results do not confirm store stock; verify price and availability with the retailer.</small></details>
      <footer>Live web results · prices and availability are checked on the retailer’s page.</footer>`;
    box.querySelector('#cs-analyze').onclick=analyze;
    box.querySelector('#cs-session-start')?.addEventListener('click',startVisualSession);
    box.querySelector('#cs-keep-history').onchange=e=>{keepPreviousFrames=e.currentTarget.checked;if(!keepPreviousFrames){historySessions=[];activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.cleared',{reason:'keep-previous-disabled'});render();}else trackAction('analysis.history-preference.changed',{state:'keep'});};
    box.querySelector('#cs-current-tab')?.addEventListener('click',()=>{activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];render();});
    box.querySelector('#cs-history-tab')?.addEventListener('click',()=>{if(!historySessions.length)return;activeResultsView='history';activeHistoryId=historySessions[0].id;selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.opened');render();});
    box.querySelectorAll('.cs-history-item').forEach(button=>button.addEventListener('click',()=>{activeHistoryId=button.dataset.sessionId;selected=null;followupMessages=[];followupListings=[];render();}));
    box.querySelector('#cs-clear-history')?.addEventListener('click',()=>{historySessions=[];activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.cleared');render();});
    box.querySelector('#cs-pause')?.addEventListener('click',()=>{trackAction('analysis.paused');state='paused';visualSessionRunning=false;clearTimeout(visualSessionTimer);activeAnalysisJobId='';analysisNotice='';cancelAnalysis();render();});
    box.querySelector('#cs-resume')?.addEventListener('click',()=>{trackAction('analysis.resumed');state='active';if(visualSessionId&&visualSessionFrames<VISUAL_SESSION_MAX_FRAMES){visualSessionRunning=true;void runVisualSessionSample();}else render();});
    box.querySelector('#cs-start')?.addEventListener('click',()=>{trackAction('analysis.started');state='active';render();});
    box.querySelector('#cs-stop').onclick=()=>{trackAction('analysis.stopped');stopVisualSession('stopped');state='stopped';analysisNotice='';cancelAnalysis();render();};
    box.querySelectorAll('.cs-object').forEach(b=>b.onclick=()=>{const next=activeDiscoveries().find(d=>d.id===b.dataset.id);if(selected?.id!==next?.id){followupMessages=[];followupListings=[];followupPage=0;const chat=box.querySelector('#cs-chat-results');if(chat)chat.innerHTML='';}selected=next;if(selected){trackAction('discovery.selected',{item:selected.label});saveDiscoveryContext(selected);if(selected.searchState==='idle')searchDiscovery(selected);else render();}});
    bindPagination(box);
    box.querySelectorAll('.cs-product').forEach(b=>b.onclick=()=>{
      const d=discoveries.find(x=>x.id===b.dataset.discovery); const p=d?.products.find(x=>x.id===b.dataset.prod);
      if(p?.url) { window.open(p.url,'_blank','noopener,noreferrer'); if(d)saveDiscoveryContext(d,{openedProductUrl:p.url,products:[{...p,interactions:['opened']}]}); }
    });
    bindLiveProductLinks(box);
    box.querySelector('#cs-chat').onsubmit=async e=>{e.preventDefault(); const q=String(new FormData(e.currentTarget).get('q')||'').trim();if(!q||!selected)return; trackAction('followup.submitted',{item:selected.label,question:q}); const out=box.querySelector('#cs-chat-results'); out.textContent='Understanding your request and searching this scene…'; try { const currentListings=followupListings.length?followupListings:selected.products||[];const exactListing=currentListings.find(product=>['exact','exact_text'].includes(product.matchType));const pricedListings=currentListings.map(priceFromListing).filter(price=>price>0);const exactReferencePrice=exactListing?priceFromListing(exactListing):0;const referencePrice=exactReferencePrice||(pricedListings.length?Math.min(...pricedListings):0);const referencePriceIsExact=Boolean(exactReferencePrice&&selected.identityConfidence==='high'&&selected.brand&&selected.model);const r=await apiRequest('/api/followup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,object:selected.label,brand:selected.brand||'',model:selected.model||'',identityConfidence:selected.identityConfidence||'',evidence:selected.evidence||'',visibleText:selected.visibleText||[],details:selected.details||[],frameId:selected.frameId||'',lensFrameId:selected.lensFallbackFrameId||'',listings:currentListings,messages:followupMessages,question:q,referencePrice,referencePriceIsExact,location,videoTitle:document.title,videoUrl:window.location.href})}); let d=await r.json(); if(!r.ok)throw new Error(d.error); if(d.jobId){const jobStart=Date.now();let followupStatusVersion=0;for(;;){await new Promise(resolve=>setTimeout(resolve,800));const sr=await apiRequest(`/api/search-status?id=${encodeURIComponent(d.jobId)}`);const status=await sr.json();if(!sr.ok)throw new Error(status.error||'Follow-up search expired.');if(status.updatedAt!==followupStatusVersion){followupStatusVersion=status.updatedAt;if(status.products?.length){out.innerHTML=`<p>${esc(status.response||d.response||'Searching…')}</p><p class="cs-match-note">${esc(status.message||'Updating matching listings…')}</p>${renderPagedProducts(status.products,0,'followup')}`;followupListings=status.products;bindLiveProductLinks(out);bindPagination(out);}else out.textContent=status.message||d.message||'Searching matching listings…';}if(status.state==='error')throw new Error(status.error||status.message);if(status.state==='done'){d={...status};break;}if(Date.now()-jobStart>180000)throw new Error('Search is taking longer than expected. The results found so far remain visible.');}}followupMessages=[...followupMessages,{role:'user',content:q},{role:'assistant',content:d.response}].slice(-12);followupListings=d.products||[];followupPage=0;out.innerHTML=`<p>${esc(d.response)}</p>${d.groundedSummary?`<p class="cs-match-note">${esc(d.groundedSummary)}</p>`:''}${d.groundedCitations?.length?`<p class="cs-match-note">Sources: ${d.groundedCitations.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.url)}</a>`).join(' · ')}</p>`:''}${d.products.length?renderPagedProducts(d.products,followupPage,'followup'):'<p class="cs-no-match">No live results were returned for this search.</p>'}`; bindLiveProductLinks(out);bindPagination(out);saveDiscoveryContext(selected,{products:d.products||[],followup:{question:q,response:d.response,productUrls:(d.products||[]).map(p=>p.url).filter(Boolean)}}); } catch(err){trackAction('followup.failed',{item:selected.label,reason:err.message});out.innerHTML=`<p class="cs-no-match">${esc(err.message)}</p>${followupListings.length?renderPagedProducts(followupListings,followupPage,'followup'):''}`;bindPagination(out);bindLiveProductLinks(out);} };
    box.querySelector('#cs-profile').onsubmit=async e=>{e.preventDefault();const id=new FormData(e.currentTarget).get('id').trim();if(!id)return;try{const r=await apiRequest(`/api/profile?id=${encodeURIComponent(id)}`);const p=await r.json();if(!r.ok)throw new Error(p.error);profileId=p.id;maxPrice=p.maxPrice||'';location=p.location||'';historyEnabled=Boolean(p.historyEnabled);savedContextKeys.clear();await chrome.storage.local.set({profileId});render();}catch(err){box.querySelector('#cs-profile').insertAdjacentHTML('beforeend',`<small>${esc(err.message)}</small>`);}};
    box.scrollTop=previousScrollTop;
  }
  function stashCurrentDiscoveries(videoTime) {
    if(!keepPreviousFrames||!discoveries.length)return;
    historySessions.unshift({id:crypto.randomUUID(),title:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,100),timeLabel:frameTimeLabel(videoTime),discoveries});
    historySessions=historySessions.slice(0,8);
  }
  async function prepareSessionDiscoveries(objects,image,videoTime,captureContext={}) {
    return Promise.all((objects||[]).slice(0,VISUAL_SESSION_MAX_DISCOVERIES).map(async item=>{
      const searchCrop=isUsableObjectBox(item.bbox)?await cropObjectForSearch(image,item.bbox):null;
      return {...item,id:`session-${crypto.randomUUID()}`,sessionId:visualSessionId,frameData:image,searchFrameData:searchCrop?.image||'',searchFrameSourceData:searchCrop?.sourceImage||'',captureContext:{...captureContext,sessionId:visualSessionId,discoveryId:`session-${item.id}`,itemLabel:item.label,bbox:item.bbox,videoTime},videoTime,firstSeenVideoTime:videoTime,lastSeenVideoTime:videoTime,observationTimes:[videoTime]};
    }));
  }
  function boxesSimilar(left,right) {
    if(!Array.isArray(left)||!Array.isArray(right)||left.length!==4||right.length!==4)return true;
    const x1=Math.max(left[0],right[0]),y1=Math.max(left[1],right[1]),x2=Math.min(left[2],right[2]),y2=Math.min(left[3],right[3]);
    const intersection=Math.max(0,x2-x1)*Math.max(0,y2-y1),areaLeft=Math.max(0,left[2]-left[0])*Math.max(0,left[3]-left[1]),areaRight=Math.max(0,right[2]-right[0])*Math.max(0,right[3]-right[1]);
    const iou=intersection/Math.max(Number.EPSILON,areaLeft+areaRight-intersection);
    const leftX=(left[0]+left[2])/2,leftY=(left[1]+left[3])/2,rightX=(right[0]+right[2])/2,rightY=(right[1]+right[3])/2;
    return iou>=0.12||Math.hypot(leftX-rightX,leftY-rightY)<=0.2;
  }
  function normalizedSessionLabel(value) {
    return String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }
  function displayDiscoveryLabel(discovery, allDiscoveries) {
    const sameLabel=(allDiscoveries||[]).filter(item=>normalizedSessionLabel(item.label)===normalizedSessionLabel(discovery.label));
    if(sameLabel.length<2||!Array.isArray(discovery.bbox)||discovery.bbox.length!==4)return discovery.label;
    const centerX=(Number(discovery.bbox[0])+Number(discovery.bbox[2]))/2;
    return `${discovery.label} · ${centerX<0.5?'left':'right'}`;
  }
  function mergeSessionDiscoveries(incoming) {
    for(const item of incoming){
      const label=normalizedSessionLabel(item.label);
      const existing=label?discoveries.find(old=>normalizedSessionLabel(old.label)===label&&boxesSimilar(old.bbox,item.bbox)):null;
      if(!existing){if(discoveries.length<VISUAL_SESSION_MAX_DISCOVERIES)discoveries.push(item);continue;}
      const preserved={id:existing.id,sessionId:existing.sessionId,firstSeenVideoTime:existing.firstSeenVideoTime,observationTimes:existing.observationTimes||[],products:existing.products||[],searchState:existing.searchState||'idle',searchError:existing.searchError||'',providersUsed:existing.providersUsed||[],productPage:existing.productPage||0,searchJobId:existing.searchJobId||'',searchMessage:existing.searchMessage||'',frameId:item.frameId||existing.frameId||'',lensFallbackFrameId:existing.lensFallbackFrameId||''};
      const times=preserved.observationTimes;
      if(!times.length||Math.abs(times[times.length-1]-item.videoTime)>=3)times.push(item.videoTime);
      Object.assign(existing,item,preserved,{lastSeenVideoTime:item.videoTime,observationTimes:times.slice(-8)});
      if(selected?.id===existing.id)selected=existing;
    }
  }
  function startVisualSession() {
    if(visualSessionRunning)return;
    cancelAnalysis();activeAnalysisJobId='';lastFrameAt=0;
    if(discoveries.length)stashCurrentDiscoveries(document.querySelector('video.html5-main-video, video')?.currentTime||0);
    visualSessionId=crypto.randomUUID();visualSessionFrames=0;visualSessionError='';discoveries=[];selected=null;followupMessages=[];followupListings=[];lastAnalyzedFrame='';
    activeResultsView='current';activeHistoryId='';state='active';visualSessionRunning=true;analysisNotice='';
    trackAction('visual-session.started',{intervalMs:VISUAL_SESSION_INTERVAL_MS,maxFrames:VISUAL_SESSION_MAX_FRAMES});render();
    void runVisualSessionSample();
  }
  async function runVisualSessionSample() {
    if(!visualSessionRunning||state!=='active')return;
    if(visualSessionFrames>=VISUAL_SESSION_MAX_FRAMES){visualSessionRunning=false;state='stopped';analysisNotice='Session limit reached. Start a new session when you want to continue.';trackAction('visual-session.limit-reached',{frames:visualSessionFrames});render();return;}
    const video=selectMainVideo();
    if(!video||!document.querySelector('ytd-watch-flexy')){visualSessionRunning=false;state='stopped';analysisNotice='The YouTube video is no longer available on this page.';render();return;}
    if(document.hidden||video.paused||video.ended){analysisNotice=document.hidden?'Session waiting for this tab to be visible.':'Session waiting for video playback.';render();visualSessionTimer=setTimeout(runVisualSessionSample,VISUAL_SESSION_INTERVAL_MS);return;}
    analysisNotice='';visualSessionFrames++;render();
    const succeeded=await analyze({sessionSample:true});
    if(!visualSessionRunning||state!=='active')return;
    if(!succeeded){visualSessionRunning=false;state='paused';analysisNotice=`Session paused after an error${visualSessionError?`: ${visualSessionError}`:''}. Resume when ready.`;trackAction('visual-session.paused-after-error',{frame:visualSessionFrames,reason:visualSessionError});render();return;}
    if(visualSessionFrames>=VISUAL_SESSION_MAX_FRAMES){visualSessionRunning=false;state='stopped';analysisNotice='Session limit reached. Start a new session when you want to continue.';trackAction('visual-session.limit-reached',{frames:visualSessionFrames});render();return;}
    analysisNotice=`Next visual sample in ${Math.round(VISUAL_SESSION_INTERVAL_MS/1000)} seconds.`;render();
    visualSessionTimer=setTimeout(runVisualSessionSample,VISUAL_SESSION_INTERVAL_MS);
  }
  function stopVisualSession(reason='stopped') {
    clearTimeout(visualSessionTimer);visualSessionTimer=null;visualSessionRunning=false;
    if(analysisController)cancelAnalysis();
    activeAnalysisJobId='';
    trackAction('visual-session.stopped',{reason,frames:visualSessionFrames});
  }
  function renderLiveResults(discovery){
    if(discovery.searchState==='loading')return `<p class="cs-no-match">${esc(discovery.searchMessage||'Finding matching products…')}</p>${discovery.products?.length?`${discovery.providersUsed?.length?`<p class="cs-match-note">Sources: ${discovery.providersUsed.map(esc).join(' · ')}</p>`:''}${renderPagedProducts(discovery.products,discovery.productPage||0,'discovery')}`:''}`;
    if(discovery.searchState==='error')return `<p class="cs-no-match">${esc(discovery.searchError)}</p>${discovery.products?.length?renderPagedProducts(discovery.products,discovery.productPage||0,'discovery'):''}`;
    if(discovery.searchState==='done'&&!discovery.products.length)return '<p class="cs-no-match">No live listings were returned. Try a clearer frame or enter readable brand/model text in Ask about an object.</p>';
    if(discovery.searchState==='done'){
      const exactListings=discovery.products.filter(product=>['exact','exact_text'].includes(product.matchType));
      const supportedListings=discovery.products.filter(product=>['supported','brand_text'].includes(product.matchType));
      const exactCount=exactListings.length;
      const supportedCount=supportedListings.length;
      let summaryText='';
      if(exactCount){
        summaryText=`${exactCount} exact match${exactCount===1?'':'es'} matching detected brand and model.`;
      } else if(supportedCount){
        summaryText=`${supportedCount} supported match${supportedCount===1?'':'es'} with matching brand or visual evidence.`;
      } else if(discovery.exactIdentitySupported){
        summaryText='No listing confirmed both brand and model; showing similar alternatives.';
      } else {
        summaryText='Exact brand and model could not be confirmed from this frame; showing similar alternatives.';
      }
      const note=`<p class="cs-match-note">${esc(summaryText)}</p>`;
      const grounded=discovery.groundedSummary?`<p class="cs-match-note">${esc(discovery.groundedSummary)}</p>${discovery.groundedCitations?.length?`<p class="cs-match-note">Sources: ${discovery.groundedCitations.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.url)}</a>`).join(' · ')}</p>`:''}`:'';
      const sources=discovery.providersUsed?.length?`<p class="cs-match-note">Search sources: ${discovery.providersUsed.map(esc).join(' · ')}</p>`:'';
      return `${grounded}${note}${sources}${renderPagedProducts(discovery.products,discovery.productPage||0,'discovery')}`;
    }
    return '<p class="cs-no-match">Select this object to search live web results.</p>';
  }
  function updateDiscoveryResults(discovery){
    const target=[...root.querySelectorAll('.cs-live-results')].find(node=>node.dataset.liveResults===String(discovery?.id||''));
    if(!target)return;
    const card=target.closest('.cs-discovery');
    if(card){
      const objectButton=card.querySelector('.cs-object');
      const updateEvidence=(selector,attribute,text,className,insertAfter)=>{let node=card.querySelector(selector);if(!text){node?.remove();return;}if(!node){node=document.createElement('p');node.className=className;node.setAttribute(attribute,'');insertAfter.insertAdjacentElement('afterend',node);}node.textContent=text;};
      updateEvidence('[data-cs-identity]','data-cs-identity',discovery.brand||discovery.model?`Possible identity: ${[discovery.brand,discovery.model].filter(Boolean).join(' ')} · ${discovery.identityConfidence||'low'} confidence`:'','cs-identity',objectButton);
      const identityNode=card.querySelector('[data-cs-identity]')||objectButton;
      updateEvidence('[data-cs-text]','data-cs-text',discovery.visibleText?.length?`Text seen: ${discovery.visibleText.join(', ')}`:'','cs-evidence',identityNode);
      const textNode=card.querySelector('[data-cs-text]')||identityNode;
      updateEvidence('[data-cs-evidence]','data-cs-evidence',discovery.evidence||'','cs-evidence',textNode);
    }
    target.innerHTML=renderLiveResults(discovery);
    bindPagination(target);bindLiveProductLinks(target);
  }
  function renderPagedProducts(products,page,scope){
    const pageSize=5;const count=Math.ceil(products.length/pageSize);const current=Math.max(0,Math.min(count-1,Number(page)||0));
    const visible=products.slice(current*pageSize,(current+1)*pageSize);
    const controls=count>1?`<nav class="cs-pagination" aria-label="Product result pages"><button data-cs-page="previous" data-cs-scope="${scope}" ${current===0?'disabled':''}>Previous</button><span>${current*pageSize+1}–${Math.min((current+1)*pageSize,products.length)} of ${products.length}</span><button data-cs-page="next" data-cs-scope="${scope}" ${current===count-1?'disabled':''}>Next</button></nav>`:'';
    return `<div class="cs-paged-products" data-cs-list-scope="${scope}">${controls}${visible.map(renderLiveProduct).join('')}${count>1?controls:''}</div>`;
  }
  function bindPagination(container){container.querySelectorAll('[data-cs-page]').forEach(button=>button.onclick=()=>{const scope=button.dataset.csScope;if(scope==='discovery'){if(!selected)return;selected.productPage=Math.max(0,(Number(selected.productPage)||0)+(button.dataset.csPage==='next'?1:-1));updateDiscoveryResults(selected);return;}if(scope==='followup'){followupPage=Math.max(0,followupPage+(button.dataset.csPage==='next'?1:-1));const target=button.closest('.cs-paged-products');if(target){target.outerHTML=renderPagedProducts(followupListings,followupPage,'followup');bindPagination(container);bindLiveProductLinks(container);}}});}
  function renderLiveProduct(product){
    const shownPrice=Number(product.displayPrice??product.priceInr);const shownCurrency=currencyCode(product.displayCurrency||product.currency);const hasSnippetPrice=Number.isFinite(shownPrice)&&shownPrice>0;
    const isStructuredPrice=product.fieldVerification?.price==='source_structured'||(Array.isArray(product.sources)&&product.sources.some(source=>source.includes('Google Shopping')))||product.source==='Google Shopping';
    const formattedPrice=hasSnippetPrice?new Intl.NumberFormat(undefined,{style:'currency',currency:shownCurrency,maximumFractionDigits:shownCurrency==='INR'||shownCurrency==='JPY'?0:2}).format(shownPrice):'';
    const priceTypeLabel=isStructuredPrice?'structured price':'snippet price (unverified)';
    const priceNote=hasSnippetPrice?` · ${priceTypeLabel} ${formattedPrice}${product.displayPriceApproximate?' (approx. conversion)':''}; verify${product.priceStatus==='over_limit'?' · above budget':''}${product.priceStatus==='under_limit'?' · below min':''}`:product.priceStatus==='price_not_shown'?' · price not shown in snippet':'';
    const provenance=Array.isArray(product.sources)&&product.sources.length?` · via ${product.sources.map(source=>source.replace('SerpApi ','')).join(' + ')}`:product.source?` · via ${String(product.source).replace('SerpApi ','')}`:'';
    const offerNote=product.priceText&&!hasSnippetPrice?` · ${esc(product.priceText)}`:'';
    const isExact=['exact','exact_text'].includes(product.matchType);
    const isSupported=['supported','brand_text'].includes(product.matchType);
    const badgeClass=isExact?'cs-match-exact':(isSupported?'cs-match-supported':'cs-match-similar');
    const badgeText=isExact?'Exact Match':(isSupported?'Supported Match':'Similar Alternative');
    const badgeHtml=`<span class="cs-match-badge ${badgeClass}">${badgeText}</span>`;
    const evidenceText=product.matchReason||product.relevanceNote||'';
    const stockNote=product.fieldVerification?.stock==='in_stock'?' · in stock':(product.fieldVerification?.stock==='out_of_stock'?' · out of stock':'');
    const deliveryNote=product.fieldVerification?.delivery==='stated'&&product.delivery?` · ${esc(product.delivery)}`:'';
    let productImageUrl='';
    try{const parsedImageUrl=new URL(String(product.image||''));if(parsedImageUrl.protocol==='https:'||parsedImageUrl.protocol==='http:')productImageUrl=parsedImageUrl.href;}catch{}
    const imageMarkup=productImageUrl
      ? `<span class="cs-product-image-wrap"><img class="cs-product-image" src="${esc(productImageUrl)}" alt="${esc(product.title)}" loading="lazy"><span class="cs-product-image-fallback" hidden>Product image unavailable</span></span>`
      : '<span class="cs-product-image-wrap"><span class="cs-product-image-fallback">Product image unavailable</span></span>';
    return `<button class="cs-product" data-url="${esc(product.url)}"><span class="cs-product-title">${badgeHtml}${esc(product.title)}</span><span class="cs-product-retailer">${esc(product.retailer||'Product website')}</span><span class="cs-product-meta">${esc(priceNote)}${stockNote}${deliveryNote}${offerNote}${esc(provenance)}</span>${evidenceText?`<span class="cs-product-evidence"><strong>Matched Evidence</strong><span>${esc(evidenceText)}</span></span>`:''}${imageMarkup}${product.description?`<span class="cs-product-description">${esc(product.description)}</span>`:''}</button>`;
  }
  function bindLiveProductLinks(container){container.querySelectorAll('.cs-product-image').forEach(image=>{const showFallback=()=>{image.hidden=true;if(image.nextElementSibling)image.nextElementSibling.hidden=false;};image.addEventListener('error',showFallback,{once:true});if(image.complete&&image.naturalWidth===0)showFallback();});container.querySelectorAll('[data-url]').forEach(button=>button.onclick=()=>{const url=button.dataset.url;if(!url)return;window.open(url,'_blank','noopener,noreferrer');if(selected){const product=(followupListings.length?followupListings:selected.products||[]).find(item=>item.url===url);saveDiscoveryContext(selected,{openedProductUrl:url,products:product?[{...product,interactions:['opened']}]:[]});}});}
  function priceFromListing(product){const numeric=Number(product?.priceInr);if(Number.isFinite(numeric)&&numeric>0)return numeric;const text=`${product?.title||''} ${product?.description||''}`;const match=text.match(/(?:₹\s*|\bINR\s*|\bRs\.?\s*)([\d,]+(?:\.\d{1,2})?)/i);return match?Number(match[1].replace(/,/g,''))||0:0;}
  async function saveDiscoveryContext(discovery,updates={}){
    if(!profileId)return;
    const key=`${profileId}:${window.location.href}:${discovery.label}`;
    try{
      if(!historyEnabled){const response=await apiRequest(`/api/profile?id=${encodeURIComponent(profileId)}`);const profile=await response.json();historyEnabled=Boolean(profile.historyEnabled);}
      if(!historyEnabled)return;
      const video=document.querySelector('video.html5-main-video, video');
      const payload={profileId,videoUrl:window.location.href,videoTitle:document.title,videoTime:Number.isFinite(discovery.videoTime)?discovery.videoTime:(video?.currentTime||0),object:{label:discovery.label,brand:discovery.brand,model:discovery.model,visibleText:discovery.visibleText},products:updates.products,openedProductUrl:updates.openedProductUrl,followup:updates.followup};
      const response=await apiRequest('/api/discoveries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save discovery history.');savedContextKeys.add(key);
    }catch(error){trackAction('profile.discovery-save.failed',{item:discovery.label,reason:error.message});}
  }
  function mergeAuditedDiscoveries(audited, frameData, videoTime){
    const previous=[...discoveries];
    const used=new Set();
    const intersectionOverUnion=(a,b)=>{if(!Array.isArray(a)||!Array.isArray(b)||a.length!==4||b.length!==4)return 0;const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]);const overlap=Math.max(0,x2-x1)*Math.max(0,y2-y1);const aa=(a[2]-a[0])*(a[3]-a[1]),ab=(b[2]-b[0])*(b[3]-b[1]);return overlap/Math.max(Number.EPSILON,aa+ab-overlap);};
    discoveries=(audited||[]).map(item=>{
      const match=previous.find(old=>!used.has(old)&&old.id===item.id)||previous.filter(old=>!used.has(old)&&old.label.toLowerCase()===String(item.label||'').toLowerCase()).sort((a,b)=>intersectionOverUnion(b.bbox,item.bbox)-intersectionOverUnion(a.bbox,item.bbox))[0]||previous.map(old=>({old,overlap:intersectionOverUnion(old.bbox,item.bbox)})).filter(entry=>!used.has(entry.old)&&entry.overlap>=0.35).sort((a,b)=>b.overlap-a.overlap)[0]?.old;
      if(!match)return {...item,frameData,videoTime};
      used.add(match);
      const preserved={id:match.id,frameData:match.frameData||frameData,videoTime:Number.isFinite(match.videoTime)?match.videoTime:videoTime,lensFallbackFrameId:match.lensFallbackFrameId||'',products:match.products||[],searchState:match.searchState||'idle',searchError:match.searchError||'',providersUsed:match.providersUsed||[],productPage:match.productPage||0,searchJobId:match.searchJobId||'',searchMessage:match.searchMessage||''};
      Object.assign(match,item,preserved);return match;
    });
    if(selected){selected=discoveries.find(item=>item.id===selected.id)||discoveries.find(item=>item.label.toLowerCase()===selected.label.toLowerCase())||selected;}
  }
  async function pollAnalysisAudit(jobId, frameData, videoTime){
    let seenVersion=0;
    try{
      for(;;){
        if(activeAnalysisJobId!==jobId)return;
        await new Promise(resolve=>setTimeout(resolve,900));
        const response=await apiRequest(`/api/analysis-status?id=${encodeURIComponent(jobId)}`);const status=await response.json();
        if(!response.ok)throw new Error(status.error||'Audit status is unavailable.');
        if(status.updatedAt!==seenVersion){seenVersion=status.updatedAt;analysisNotice=status.message||'Checking the first-pass detections…';const progress=root.querySelector('#cs-analysis-progress');if(progress){progress.textContent=analysisNotice;progress.hidden=false;}}
        if(status.state==='done'){
          mergeAuditedDiscoveries(status.objects,frameData,videoTime);analysisNotice='';activeAnalysisJobId='';
          trackAction('frame.analysis.audit.completed',{summary:`${discoveries.length} refined detections`});render();return;
        }
      }
    }catch(error){
      if(activeAnalysisJobId!==jobId)return;
      analysisNotice='Audit unavailable; the first-pass results are ready to use.';activeAnalysisJobId='';
      trackAction('frame.analysis.audit.unavailable',{reason:error.message});
      const progress=root.querySelector('#cs-analysis-progress');if(progress){progress.textContent=analysisNotice;progress.hidden=false;}
      setTimeout(()=>{if(!activeAnalysisJobId&&analysisNotice.startsWith('Audit unavailable')){analysisNotice='';const node=root.querySelector('#cs-analysis-progress');if(node)node.hidden=true;}},4500);
    }
  }
  async function makeContextAwareFullFrameFallback(frameData,discovery){
    if(!frameData)return null;
    const encoded=await new Promise((resolve,reject)=>{const source=new Image();source.onload=async()=>{try{const canvas=document.createElement('canvas');canvas.width=source.naturalWidth;canvas.height=source.naturalHeight;canvas.getContext('2d').drawImage(source,0,0);resolve(await encodeSearchCrop(canvas));}catch(error){reject(error);}};source.onerror=()=>reject(new Error('Could not decode the original frame for a Lens fallback.'));source.src=frameData;});
    if(!encoded?.image)return null;
    const response=await apiRequest('/api/frame-cache',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:encoded.image,sourceImage:frameData,isFullFrameFallback:true,captureContext:discoveryCaptureContext(discovery)})});
    const result=await response.json();if(!response.ok||!result.frameId)throw new Error(result.error||`HTTP ${response.status}`);
    return result.frameId;
  }
  async function searchDiscovery(discovery){
    const startedAt=Date.now();
    discovery.searchState='loading';discovery.searchError='';discovery.productPage=0;render();
    trackAction('product.search.started',{item:discovery.label});
    let needsVisualBoxRecovery=!isUsableObjectBox(discovery.bbox);
    const params=new URLSearchParams({q:discovery.label,context:discovery.evidence||'',profileId,location,maxPrice,brand:discovery.brand||'',model:discovery.model||'',identityConfidence:discovery.identityConfidence||'',searchQuery:discovery.searchQuery||'',visibleText:(discovery.visibleText||[]).join('|'),details:(discovery.details||[]).join('|'),frameId:discovery.frameId||''});
    try{
      const frameData=discovery.searchFrameData?'':(discovery.frameData||lastAnalyzedFrame);
      const objectCrop=discovery.searchFrameData?{image:discovery.searchFrameData,sourceImage:discovery.searchFrameSourceData||discovery.searchFrameData}:await cropObjectForSearch(frameData,discovery.bbox);
      let cropCached=false;
      if(objectCrop?.image){
        try{
          const cached=await apiRequest('/api/frame-cache',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:objectCrop.image,sourceImage:objectCrop.sourceImage,isObjectCrop:true,captureContext:discoveryCaptureContext(discovery)})});
          const cachedData=await cached.json();
          if(cached.ok&&cachedData.frameId){discovery.frameId=cachedData.frameId;discovery.lensFallbackFrameId='';params.set('frameId',cachedData.frameId);cropCached=true;trackAction('visual.search.crop-cached',{item:discovery.label});}
          else{needsVisualBoxRecovery=true;trackAction('visual.search.crop-cache-failed',{item:discovery.label,reason:cachedData.error||`HTTP ${cached.status}`});}
        }catch(error){needsVisualBoxRecovery=true;trackAction('visual.search.crop-cache-failed',{item:discovery.label,reason:error.message});}
      }else{if(discovery.frameId)needsVisualBoxRecovery=true;trackAction('visual.search.crop-unavailable',{item:discovery.label,reason:needsVisualBoxRecovery?'A selected-object crop is unavailable; preparing a context-aware full-frame fallback.':'Could not prepare a crop of the selected item.'});}
      if(!cropCached&&discovery.frameId){
        try{const fallbackFrameId=await makeContextAwareFullFrameFallback(frameData||discovery.frameData||lastAnalyzedFrame,discovery);if(fallbackFrameId){discovery.lensFallbackFrameId=fallbackFrameId;params.set('lensFrameId',fallbackFrameId);trackAction('visual.search.full-frame-fallback-ready',{item:discovery.label});}}
        catch(error){trackAction('visual.search.full-frame-fallback-failed',{item:discovery.label,reason:error.message});}
      }
      const response=await apiRequest(`/api/search?${params}`);let result=await response.json();
      if(!response.ok)throw new Error(result.error||'Live product search failed.');
      if(!result.jobId){discovery.products=result.products||[];discovery.providersUsed=result.providersUsed||[];discovery.searchState='done';}
      else {
        discovery.searchJobId=result.jobId;discovery.searchMessage=result.message||'Searching…';
        const deadline=Date.now()+180_000;
        while(Date.now()<deadline){
          await new Promise(resolve=>setTimeout(resolve,800));
          const statusResponse=await apiRequest(`/api/search-status?id=${encodeURIComponent(result.jobId)}`);const status=await statusResponse.json();
          if(!statusResponse.ok)throw new Error(status.error||'Search session expired.');
          const changed=status.updatedAt!==discovery.searchStatusVersion||status.state==='done';
          discovery.products=status.products||[];discovery.providersUsed=status.providersUsed||[];discovery.searchMessage=status.message||'Finding matching products…';discovery.searchStatusVersion=status.updatedAt;
          if(status.identityUpdate){const signature=JSON.stringify(status.identityUpdate);if(discovery.focusedEvidenceSignature!==signature){discovery.focusedEvidenceSignature=signature;discovery.baseEvidence??=discovery.evidence;discovery.brand=status.identityUpdate.brand||discovery.brand;discovery.model=status.identityUpdate.model||discovery.model;discovery.visibleText=status.identityUpdate.visibleText||discovery.visibleText;discovery.details=status.identityUpdate.details||discovery.details;discovery.bbox=status.identityUpdate.bbox||discovery.bbox;discovery.identityConfidence=status.identityUpdate.identityConfidence||discovery.identityConfidence;discovery.evidence=[discovery.baseEvidence,status.identityUpdate.evidence].filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index).join(' ');}}
          if(needsVisualBoxRecovery&&Array.isArray(status.identityUpdate?.bbox)&&status.identityUpdate.bbox.length===4&&!discovery.visualRecoveryRequested)await searchRecoveredObjectVisually(discovery,status.identityUpdate.bbox,result.jobId);
          if(status.state==='error')throw new Error(status.error||'Live product search failed.');
          if(status.state==='done'&&discovery.visualRecoveryRequested&&['queued','running'].includes(status.visualRecoveryState))continue;
          if(status.state==='done'){
            discovery.products=status.products||[];discovery.providersUsed=status.providersUsed||[];discovery.exactIdentitySupported=Boolean(status.exactIdentitySupported);discovery.searchQuery=status.searchQuery||'';discovery.groundedSummary=status.groundedSummary||'';discovery.groundedCitations=status.groundedCitations||[];discovery.searchState='done';break;
          }
          if(changed&&activeDiscoveries().includes(discovery)&&selected?.id===discovery.id)updateDiscoveryResults(discovery);
        }
        if(discovery.searchState!=='done')throw new Error('Search is taking longer than expected. Results already found remain available; select the item again to continue checking.');
      }
      discovery.searchElapsedSeconds=Math.max(1,Math.round((Date.now()-startedAt)/1000));
      trackAction('product.search.completed',{item:discovery.label,products:discovery.products.length,providers:discovery.providersUsed,elapsedMs:Date.now()-startedAt});
    }catch(error){discovery.searchError=error.message;discovery.searchState='error';trackAction('product.search.failed',{item:discovery.label,elapsedMs:Date.now()-startedAt,reason:error.message});}
    if(discovery.searchState==='done')saveDiscoveryContext(discovery,{products:discovery.products||[]});
    if(activeDiscoveries().includes(discovery))updateDiscoveryResults(discovery);
  }
  async function analyze({sessionSample=false}={}) {
    if(state!=='active'){trackAction('frame.analysis.skipped',{state});return false;}
    const now=Date.now(); if(now-lastFrameAt<3000){trackAction('frame.analysis.skipped',{reason:'three-second debounce'});return false;} lastFrameAt=now;
    activeAnalysisJobId='';analysisNotice='';
    trackAction('frame.analysis.requested');
    const video=selectMainVideo();
    if(!video){trackAction('frame.analysis.failed',{reason:'No visible video frame was found.'});const error=root.querySelector('#cs-error');if(error){error.textContent='No visible video frame was found.';error.hidden=false;}return false;}
    const load=root.querySelector('#cs-loading'), err=root.querySelector('#cs-error'), button=root.querySelector('#cs-analyze');
    const frameVideoTime=video.currentTime||0;
    if(load)load.hidden=false;if(err)err.hidden=true;if(button)button.disabled=true;
    const requestController=new AbortController();analysisController=requestController;
    const timeoutId=setTimeout(()=>requestController.abort(new DOMException('Analysis timed out after 240 seconds. Check the server console and retry.','TimeoutError')),240_000);
    try{
      let captured;
      try { captured=await captureDecodedVideoFrame(video); }
      catch(error) {
        trackAction('frame.capture.decoded-video-unavailable',{reason:error.message});
        const rect=video.getBoundingClientRect();
        const player=document.querySelector('#movie_player, .html5-video-player');
        const playerRect=player?.getBoundingClientRect();
        const videoRect={left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};
        const chosen=playerRect&&playerRect.width>100&&playerRect.height>80?playerRect:rect;
        const crop={rect:{left:chosen.left,top:chosen.top,right:chosen.right,bottom:chosen.bottom},videoRect,viewport:{width:innerWidth,height:innerHeight}};
        const tabCapture=await new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:'CAPTURE_TAB',crop},response=>{if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));else if(!response?.ok)reject(new Error(response?.error||'Could not capture the tab.'));else resolve(response);}));
        captured=tabCapture.method==='tab-media-stream'?tabCapture:await cropVideoFrame(tabCapture.image,video);
      }
      if(state!=='active')return;
      const image=captured.image,sourceImage=captured.sourceImage||image;
      trackAction('frame.capture.completed',{method:captured.method||'tab-media-stream',width:captured.width||0,height:captured.height||0,format:image.slice(5,image.indexOf(';')),sourceWidth:video.videoWidth,sourceHeight:video.videoHeight,videoRect:JSON.stringify(captured.videoRect||{}),viewport:`${innerWidth}x${innerHeight}`});
      if(!sessionSample)lastAnalyzedFrame=sourceImage;
      if(load)load.textContent='Frame captured — waiting for the vision provider…';
      const captureContext={videoId:currentVideoId(),videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:visualSessionId||`frame-${crypto.randomUUID()}`,sampleIndex:sessionSample?visualSessionFrames:0,videoTime:frameVideoTime};
      const reply=await apiRequest('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image,sourceImage:sourceImage!==image?sourceImage:undefined,maxPrice,sessionSample,captureContext}),signal:requestController.signal});
      const data=await reply.json();if(!reply.ok)throw new Error(`${data.error||'Analysis failed.'}${data.traceId?` (debug ${data.traceId})`:''}`);
      if(state!=='active')return false;
      if(sessionSample){
        const prepared=await prepareSessionDiscoveries(data.objects,sourceImage,frameVideoTime,data.captureContext||captureContext);
        if(state!=='active'||!visualSessionRunning)return false;
        mergeSessionDiscoveries(prepared);
        trackAction('visual-session.sample-ready',{frame:visualSessionFrames,time:frameTimeLabel(frameVideoTime),detected:prepared.length,total:discoveries.length});
        render();
        return true;
      }
      const frameDiscoveries=data.objects.map(d=>({...d,frameData:sourceImage,captureContext:data.captureContext||captureContext,videoTime:frameVideoTime}));
      if(keepPreviousFrames&&discoveries.length){
        historySessions.unshift({id:crypto.randomUUID(),title:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,100),timeLabel:frameTimeLabel(frameVideoTime),discoveries});
        historySessions=historySessions.slice(0,8);
        trackAction('analysis.history.saved',{summary:`${discoveries.length} discoveries at ${frameTimeLabel(frameVideoTime)}`});
      } else if(!keepPreviousFrames) historySessions=[];
      discoveries=frameDiscoveries;selected=null;activeResultsView='current';activeHistoryId='';followupMessages=[];followupListings=[];
      if(data.analysisJobId){activeAnalysisJobId=data.analysisJobId;analysisNotice=data.analysisMessage||'First results are ready; checking them in the background…';}
      trackAction('frame.analysis.first_pass_ready',{summary:`${data.objects.length} detected: ${data.objects.map(item=>item.label).join(', ')||'none'}`});render();
      if(data.analysisJobId)void pollAnalysisAudit(data.analysisJobId,sourceImage,frameVideoTime);
      return true;
    }catch(error){
      if(error.name!=='AbortError')trackAction('frame.analysis.failed',{reason:error.message});
      if(sessionSample){visualSessionError=error.name==='AbortError'?'Frame analysis was cancelled.':error.message;analysisNotice=visualSessionError;}
      if(error.name!=='AbortError'&&state==='active'&&/all_urls|activeTab|permission is required|captureVisibleTab/i.test(error.message)){
        if(err){err.textContent='Brave needs a toolbar action before it allows frame capture. Open the ContextStream toolbar popup and start the visual session there to grant temporary access to this YouTube tab.';err.hidden=false;}
        if(sessionSample)visualSessionError='Open the ContextStream toolbar popup and start the visual session there to grant temporary capture access.';
      } else if(error.name!=='AbortError'&&err&&state==='active'){err.textContent=error.message;err.hidden=false;}
      return false;
    }
    finally{clearTimeout(timeoutId);if(load)load.hidden=true;if(button)button.disabled=false;if(analysisController===requestController)analysisController=null;}
  }
  function selectMainVideo(){
    const candidates=[...document.querySelectorAll('#movie_player video.html5-main-video, video.html5-main-video, #movie_player video, video')];
    return candidates.find(video=>video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0&&video.getBoundingClientRect().width>100&&video.getBoundingClientRect().height>80)||candidates[0]||null;
  }
  function blobDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not encode the captured video frame.'));reader.readAsDataURL(blob);});}
  async function captureDecodedVideoFrame(video){
    if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)throw new Error('The YouTube video has no decoded frame yet.');
    if(typeof video.requestVideoFrameCallback==='function')await new Promise(resolve=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;resolve();}},800);video.requestVideoFrameCallback(()=>{if(!done){done=true;clearTimeout(timer);resolve();}});});
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const context=canvas.getContext('2d',{alpha:false});context.drawImage(video,0,0,canvas.width,canvas.height);
    const png=await new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The decoded frame could not be encoded.')),'image/png');}catch(error){reject(error);}});
    const sourceImage=await blobDataUrl(png);let payloadBlob=png;
    if(payloadBlob.size>14*1024*1024){
      for(const quality of [0.99,0.97,0.95,0.92,0.9,0.87]){const candidate=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(candidate&&candidate.size<=14*1024*1024){payloadBlob=candidate;break;}}
    }
    if(payloadBlob.size>14*1024*1024){
      for(let scale=0.92;scale>=0.55;scale*=0.9){const reduced=document.createElement('canvas');reduced.width=Math.max(1,Math.round(canvas.width*scale));reduced.height=Math.max(1,Math.round(canvas.height*scale));reduced.getContext('2d',{alpha:false}).drawImage(canvas,0,0,reduced.width,reduced.height);const candidate=await new Promise(resolve=>reduced.toBlob(resolve,'image/webp',0.97));if(candidate&&candidate.size<=14*1024*1024){payloadBlob=candidate;break;}}
    }
    if(payloadBlob.size>14*1024*1024)throw new Error('The decoded video frame exceeds the vision provider image limit.');
    return {image:payloadBlob===png?sourceImage:await blobDataUrl(payloadBlob),sourceImage,width:canvas.width,height:canvas.height,method:'decoded-youtube-video',videoRect:(()=>{const r=video.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()};
  }
  function cropVideoFrame(dataUrl, video){
    return new Promise((resolve,reject)=>{const image=new Image();image.onload=async()=>{try{const player=document.querySelector('#movie_player, .html5-video-player');const rect=player?.getBoundingClientRect()||video.getBoundingClientRect();const left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);const sx=image.naturalWidth/innerWidth,sy=image.naturalHeight/innerHeight;const width=(right-left)*sx,height=(bottom-top)*sy;if(width<100||height<80)return reject(new Error('The video player is not visible enough to analyze.'));const canvas=document.createElement('canvas');canvas.width=Math.round(width);canvas.height=Math.round(height);canvas.getContext('2d').drawImage(image,left*sx,top*sy,width,height,0,0,canvas.width,canvas.height);const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode the cropped video frame.')),'image/png'));const sourceImage=await blobDataUrl(png);let payloadBlob=png;if(png.size>14*1024*1024){for(const quality of [0.99,0.97,0.95,0.92,0.9]){const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(webp&&webp.size<=14*1024*1024){payloadBlob=webp;break;}}}if(payloadBlob.size>14*1024*1024)return reject(new Error('The captured frame exceeds the image provider size limit.'));resolve({image:payloadBlob===png?sourceImage:await blobDataUrl(payloadBlob),sourceImage,width:canvas.width,height:canvas.height,method:'cropped-tab-capture',videoRect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}});}catch(error){reject(error);}};image.onerror=()=>reject(new Error('Could not prepare the selected frame.'));image.src=dataUrl;});
  }
  async function encodeSearchCrop(canvas){
    const read=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the search crop.'));reader.readAsDataURL(blob);});
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!png)return null;const sourceImage=await read(png);
    if(png.size<=490*1024)return {image:sourceImage,sourceImage};
    for(const quality of [0.99,0.97,0.95,0.92,0.9,0.87]){const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(webp&&webp.size<=490*1024)return {image:await read(webp),sourceImage};}
    for(let scale=0.92;scale>=0.5;scale*=0.9){const reduced=document.createElement('canvas');reduced.width=Math.max(1,Math.round(canvas.width*scale));reduced.height=Math.max(1,Math.round(canvas.height*scale));reduced.getContext('2d').drawImage(canvas,0,0,reduced.width,reduced.height);const webp=await new Promise(resolve=>reduced.toBlob(resolve,'image/webp',0.97));if(webp&&webp.size<=490*1024)return {image:await read(webp),sourceImage};}
    return null;
  }
  function isUsableObjectBox(bbox){
    if(!Array.isArray(bbox)||bbox.length!==4)return false;
    const [x1,y1,x2,y2]=bbox.map(Number);return [x1,y1,x2,y2].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&x2>x1&&y2>y1&&(x2-x1)*(y2-y1)<=0.82;
  }
  function cropObjectForSearch(dataUrl,bbox){
    if(!dataUrl||!isUsableObjectBox(bbox))return Promise.resolve(null);
    return new Promise(resolve=>{const image=new Image();image.onload=async()=>{try{const [x1,y1,x2,y2]=bbox.map(Number);const padX=(x2-x1)*0.05,padY=(y2-y1)*0.05;const left=Math.max(0,x1-padX),top=Math.max(0,y1-padY),right=Math.min(1,x2+padX),bottom=Math.min(1,y2+padY);if((right-left)*(bottom-top)>0.82)return resolve(null);const width=(right-left)*image.naturalWidth,height=(bottom-top)*image.naturalHeight;if(width<40||height<40)return resolve(null);const canvas=document.createElement('canvas');canvas.width=Math.round(width);canvas.height=Math.round(height);canvas.getContext('2d').drawImage(image,left*image.naturalWidth,top*image.naturalHeight,width,height,0,0,canvas.width,canvas.height);resolve(await encodeSearchCrop(canvas));}catch{resolve(null);}};image.onerror=()=>resolve(null);image.src=dataUrl;});
  }
  async function searchRecoveredObjectVisually(discovery,bbox,jobId){
    discovery.visualRecoveryRequested=true;
    try{
      const sourceFrame=discovery.frameData||lastAnalyzedFrame||discovery.searchFrameData;
      if(!sourceFrame)return trackAction('visual.search.recovered-crop-unavailable',{item:discovery.label,reason:'No retained frame crop is available.'});
      const crop=await cropObjectForSearch(sourceFrame,bbox);
      if(!crop?.image)return trackAction('visual.search.recovered-crop-unavailable',{item:discovery.label});
      const cached=await apiRequest('/api/frame-cache',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:crop.image,sourceImage:crop.sourceImage,isObjectCrop:true,captureContext:discoveryCaptureContext(discovery,bbox)})});
      const cachedData=await cached.json();if(!cached.ok||!cachedData.frameId)throw new Error(cachedData.error||`HTTP ${cached.status}`);
      const response=await apiRequest('/api/search-visual-recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,frameId:cachedData.frameId})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
      trackAction('visual.search.recovered-crop-submitted',{item:discovery.label});
    }catch(error){trackAction('visual.search.recovered-crop-failed',{item:discovery.label,reason:error.message});}
  }
  function cancelAnalysis(){analysisController?.abort();}
  chrome.runtime.onMessage.addListener(message=>{
    if(message.type==='OPEN_CONTEXTSTREAM_AND_ANALYZE'){
      if(!root.querySelector('#cs-panel'))shell();
      document.querySelector('#contextstream-invite')?.remove();
      root.querySelector('#cs-panel').classList.add('open');state='active';render();analyze();
    }
    if(message.type==='OPEN_CONTEXTSTREAM_AND_START_SESSION'){
      if(!root.querySelector('#cs-panel'))shell();
      document.querySelector('#contextstream-invite')?.remove();
      root.querySelector('#cs-panel').classList.add('open');root.classList.add('panel-open');startVisualSession();
    }
  });
  scheduleInviteRetry();
  const observer=new MutationObserver(()=>{ if(!document.querySelector('ytd-watch-flexy'))return; if(!document.querySelector('#contextstream-invite')&&!root.querySelector('.cs-panel.open')&&state==='inactive')invite(); });
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('yt-navigate-finish',()=>{stopVisualSession('youtube-navigation');state='inactive';discoveries=[];historySessions=[];visualSessionId='';visualSessionFrames=0;analysisNotice='';activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];inviteDismissed=false;document.querySelector('#contextstream-invite')?.remove();root.innerHTML='';requestAnimationFrame(scheduleInviteRetry);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&visualSessionRunning){visualSessionRunning=false;clearTimeout(visualSessionTimer);activeAnalysisJobId='';state='paused';analysisNotice='Session paused while this tab is hidden. Resume when you return.';cancelAnalysis();trackAction('visual-session.auto-paused',{reason:'tab-hidden'});render();}});
})();
