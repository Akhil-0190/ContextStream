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
  let followupAnswerHtml = '';
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
  let visualSessionFrameCallbackId = null;
  let visualSessionMonitorVideo = null;
  let visualSessionError = '';
  const VISUAL_SESSION_POLL_MS = 250;
  const VISUAL_SESSION_ANALYSIS_COOLDOWN_MS = 8_000; // Event-driven broad-sweep anti-repeat guard; local detection remains continuous.
  const VISUAL_SESSION_MAX_RECHECK_MS = 60_000;
  const VISUAL_SESSION_PAGE_SIZE = 5;
  const savedContextKeys = new Set();
  let analysisController = null;
  let activeAnalysisJobId = '';
  let inviteDismissed = false;
  let inviteRetryTimer = null;
  let shareVideoDiscoveries = false;
  let sharedVideoCacheAvailable = false;
  let sharedVideoCacheStatus = 'checking';
  let videoCacheCoverageTimes = [];
  let visualSessionLastSignature = '';
  let visualSessionLastAnalysisAt = 0;
  let lastCacheSegmentRequested = -1;
  let visualSessionPersonalizedIds = new Set();
  let visualSessionAnalysisInFlight = false;
  let visualSessionLastSignatureAt = 0;
  let visualSessionCacheReady = false;
  let visualSessionStartupSignature = '';
  let visualSessionWarmupNovelty = false;
  let visualSessionCachePromise = null;
  let objectDetectorWorker = null;
  let objectDetectorReady = false;
  let objectDetectorRequestId = 0;
  let objectDetectorInFlight = false;
  let objectDetectorLastSampleAt = 0;
  let objectDetectorLastDiagnosticsAt = 0;
  let objectDetectorError = '';
  let objectDetectorFrameFailureCount = 0;
  let objectDetectorFallbackInvoked = false;
  let objectTrackSequence = 0;
  let objectTracks = new Map();
  let recentEmptyFocusedAnalyses = [];
  let visualSessionFinalSnapshotLogged = false;
  let objectAnalysisQueue = [];
  let objectAnalysisInFlight = 0;
  let objectAnalysisControllers = new Set();
  let lastObjectDiscoveryRenderAt = 0;
  const OBJECT_ANALYSIS_MAX_IN_FLIGHT = 2;
  const OBJECT_TRACK_TTL_MS = 1800;
  const OBJECT_DETECTOR_MIN_SCORE = 0.42;
  const OBJECT_TRACK_CONFIRMATION_HITS = 3;
  const EMPTY_FOCUSED_RECHECK_VIDEO_SECONDS = 30;
  const OBJECT_ANALYSIS_QUEUE_LIMIT = 12;
  const TRACKABLE_DETECTOR_LABELS = new Set(['backpack','handbag','suitcase','bottle','wine glass','cup','fork','knife','spoon','bowl','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bicycle','motorcycle','car','truck','boat','umbrella','tie','shoe','sports jersey']);
  let discoveryPage = 0;
  let pinnedDiscoveryOrder = [];
  let sessionFrameImages = new Map();
  const SESSION_FRAME_IMAGE_LIMIT = 20;
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
    const video = document.querySelector('video.html5-main-video, video');
    const errorTraceId = String(details.reason || '').match(/\(debug ([A-Za-z0-9_-]+)\)/)?.[1] || '';
    apiRequest('/api/debug/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, sessionId: visualSessionId || '', videoId: currentVideoId(), videoTime: Number.isFinite(video?.currentTime) ? video.currentTime : null, sampleIndex: visualSessionFrames, details: { ...details, traceId: details.traceId || errorTraceId, page } }) }).catch(() => {});
  }
  chrome.storage.local.get(['profileId','apiBase','shareVideoDiscoveries'], async value => {
    profileId=value.profileId||'';
    API=value.apiBase||API;
    shareVideoDiscoveries=value.shareVideoDiscoveries===true;
    if(root.querySelector('#cs-profile-id'))root.querySelector('#cs-profile-id').value=profileId;
    try { const health=await apiRequest('/api/health'); const details=await health.json(); sharedVideoCacheAvailable=details.sharedVideoCacheConnected===true; sharedVideoCacheStatus=details.sharedVideoCacheStatus||'unavailable'; render(); } catch {sharedVideoCacheStatus='unreachable';}
    if(profileId)try{const r=await apiRequest(`/api/profile?id=${encodeURIComponent(profileId)}`);const p=await r.json();maxPrice=p.maxPrice||'';location=p.location||'';historyEnabled=Boolean(p.historyEnabled);}catch{}
  });
  const root = document.createElement('div'); root.id = 'contextstream-root'; document.documentElement.appendChild(root);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cleanIdentityPart=value=>{const text=String(value||'').trim();return /^(?:unknown|unavailable|not available|not specified|not identified|unidentified|none|null|n\/?a|na|unclear|not sure|unspecified)$/i.test(text)?'':text;};
  const identityLabel=discovery=>[cleanIdentityPart(discovery?.brand),cleanIdentityPart(discovery?.model)].filter(Boolean).join(' ');
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
    el.style.cssText='position:fixed;z-index:2147483647;right:18px;top:92px;display:flex;align-items:center;gap:10px;width:max-content;max-width:min(320px,calc(100vw - 36px));padding:7px 9px 7px 12px;border:1px solid #456351;border-radius:12px;background:#13271d;color:#fff;box-shadow:0 5px 20px #0005;font:600 11px/1.4 system-ui,sans-serif;pointer-events:auto';
    el.innerHTML=`<span>To analyze a frame, click the ContextStream toolbar icon.</span><button class="cs-invite-x" aria-label="Dismiss" style="border:0;background:transparent;color:#fff;cursor:pointer;font:18px/1 system-ui,sans-serif;padding:0 2px">×</button>`;
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
  function deviceCacheKey(videoId,durationSeconds){return `contextstream.video-cache.v1:${videoId}:${Math.round(Number(durationSeconds)||0)}`;}
  function storageLocalGet(keys){return new Promise(resolve=>chrome.storage.local.get(keys,result=>resolve(result||{})));}
  function storageLocalSet(values){return new Promise((resolve,reject)=>chrome.storage.local.set(values,()=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));}
  function storageLocalRemove(keys){return new Promise(resolve=>chrome.storage.local.remove(keys,()=>resolve()));}
  async function readDeviceVideoCache(videoId,durationSeconds,fromSeconds,toSeconds){
    const key=deviceCacheKey(videoId,durationSeconds),stored=(await storageLocalGet([key]))[key];
    if(!stored||stored.schemaVersion!==1)return {observations:[],coverage:[]};
    return {observations:(stored.observations||[]).filter(item=>Number(item.videoTime)>=fromSeconds-30&&Number(item.videoTime)<=toSeconds+30),coverage:(stored.coverage||[]).filter(item=>Number(item.videoTime)>=fromSeconds-30&&Number(item.videoTime)<=toSeconds+30)};
  }
  async function persistDeviceVideoSample(objects,context){
    const videoId=String(context?.videoId||''),durationSeconds=Number(context?.durationSeconds),videoTime=Number(context?.videoTime);
    if(!/^[A-Za-z0-9_-]{11}$/.test(videoId)||!Number.isFinite(durationSeconds)||durationSeconds<1||!Number.isFinite(videoTime)||videoTime<0)return;
    const key=deviceCacheKey(videoId,durationSeconds),indexKey='contextstream.video-cache.v1:index';
    try{
      const storedValues=await storageLocalGet([key,indexKey]),stored=storedValues[key]||{schemaVersion:1,videoId,durationSeconds:Math.round(durationSeconds),observations:[],coverage:[],updatedAt:''};
      const observations=Array.isArray(stored.observations)?stored.observations:[];
      for(const [index,item] of (objects||[]).entries()){
        if(!item?.label||!isUsableObjectBox(item.bbox))continue;
        const record={id:Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join(''),label:String(item.label).slice(0,120),brand:String(item.brand||'').slice(0,100),model:String(item.model||'').slice(0,100),identityConfidence:item.identityConfidence||'low',confidence:item.confidence||'low',foreground:item.foreground===true,visibleText:(item.visibleText||[]).slice(0,8),details:(item.details||[]).slice(0,8),evidence:String(item.evidence||'').slice(0,500),bbox:Array.isArray(item.bbox)?item.bbox:null,searchQuery:String(item.searchQuery||'').slice(0,200),videoTime,firstSeenVideoTime:videoTime,lastSeenVideoTime:videoTime,sampleIndex:Number(context.sampleIndex)||0,cacheBackend:'device'};
        const duplicate=observations.find(existing=>normalizedSessionLabel(existing.label)===normalizedSessionLabel(item.label)&&Math.abs(Number(existing.videoTime)-videoTime)<8&&boxesSimilar(existing.bbox,item.bbox));
        if(duplicate){duplicate.lastSeenVideoTime=videoTime;duplicate.confidence=item.confidence||duplicate.confidence;duplicate.details=item.details||duplicate.details;duplicate.evidence=item.evidence||duplicate.evidence;}
        else observations.push(record);
      }
      const inputObservationCount=Math.max(Array.isArray(objects)?objects.length:0,Number(context.inputObservationCount)||0);
      const usableObservationCount=(objects||[]).filter(item=>isUsableObjectBox(item?.bbox)).length;
      const discardedObservationCount=inputObservationCount-usableObservationCount;
      const coverage=[...(stored.coverage||[]),{videoTime,sampleIndex:Number(context.sampleIndex)||0,objectCount:usableObservationCount,inputObservationCount,discardedObservationCount,complete:discardedObservationCount===0,reviewState:'candidate'}].slice(-600);
      const now=new Date().toISOString();
      await storageLocalSet({[key]:{schemaVersion:1,videoId,durationSeconds:Math.round(durationSeconds),observations:observations.slice(-250),coverage,updatedAt:now},[indexKey]:{videos:{...(storedValues[indexKey]?.videos||{}),[key]:now}}});
      trackAction('video-cache.device-write.completed',{observationCount:usableObservationCount,inputObservationCount,discardedObservationCount,coverageCount:1,videoTime,sampleIndex:context.sampleIndex||0});
      const index=(await storageLocalGet([indexKey]))[indexKey]?.videos||{};
      const stale=Object.entries(index).sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).slice(0,Math.max(0,Object.keys(index).length-10)).map(([staleKey])=>staleKey);
      if(stale.length){await storageLocalRemove(stale);for(const staleKey of stale)delete index[staleKey];await storageLocalSet({[indexKey]:{videos:index}});}
    }catch(error){trackAction('video-cache.device-write-failed',{reason:error.message});}
  }
  function discoveryCaptureContext(discovery,bbox=discovery?.bbox){
    const inherited=discovery?.captureContext||{},video=selectMainVideo();
    return {...inherited,videoId:currentVideoId(),videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:inherited.sessionId||visualSessionId||discovery?.sessionId||`frame-${discovery?.id||'unknown'}`,frameId:discovery?.frameId||inherited.frameId||'',sampleIndex:Number.isFinite(Number(inherited.sampleIndex))?Number(inherited.sampleIndex):visualSessionFrames,videoTime:Number.isFinite(discovery?.videoTime)?discovery.videoTime:(Number.isFinite(Number(inherited.videoTime))?Number(inherited.videoTime):null),durationSeconds:Number.isFinite(Number(inherited.durationSeconds))?Number(inherited.durationSeconds):(Number.isFinite(video?.duration)?video.duration:null),discoveryId:discovery?.id||'',itemLabel:discovery?.label||'',bbox:Array.isArray(bbox)?bbox:null};
  }
  async function hydrateVideoCache(videoTime) {
    const video=selectMainVideo(); const videoId=currentVideoId();
    if(!videoId||!video||!Number.isFinite(video.duration)||video.duration<1)return;
    const cacheSegment=Math.floor(Math.max(0,videoTime)/30);
    if(cacheSegment===lastCacheSegmentRequested)return;
    lastCacheSegmentRequested=cacheSegment;
    const sessionId=visualSessionId;
    const fromSeconds=Math.max(0,videoTime-30),toSeconds=Math.min(video.duration,videoTime+30);
    try {
      const deviceCache=await readDeviceVideoCache(videoId,video.duration,fromSeconds,toSeconds);
      let cached={observations:[],localObservations:[],sharedObservations:[],coverage:[],sharedCacheAvailable:false};
      const cacheController=new AbortController(),cacheTimeout=setTimeout(()=>cacheController.abort(new DOMException('Cache lookup timed out.','TimeoutError')),8_000);
      try{const response=await apiRequest(`/api/video-cache?videoId=${encodeURIComponent(videoId)}&durationSeconds=${encodeURIComponent(video.duration)}&fromSeconds=${fromSeconds}&toSeconds=${toSeconds}`,{signal:cacheController.signal});const remote=await response.json();if(!response.ok)throw new Error(remote.error||'Cache lookup failed.');cached={...cached,...remote};}
      catch(error){trackAction('video-cache.remote-lookup.failed',{reason:error.message});}
      finally{clearTimeout(cacheTimeout);}
      if(!visualSessionRunning||visualSessionId!==sessionId||currentVideoId()!==videoId||Math.abs((selectMainVideo()?.currentTime||0)-videoTime)>45)return;
      const allCoverage=[...(videoCacheCoverageTimes||[]),...(deviceCache.coverage||[]),...(cached.coverage||[])];
      const usableCoverage=allCoverage.filter(sample=>typeof sample!=='object'||sample===null||sample.complete===true||(sample.complete===undefined&&Number(sample.objectCount)>0));
      const coverage=usableCoverage.map(sample=>Number(typeof sample==='object'?sample.videoTime:sample)).filter(Number.isFinite);
      videoCacheCoverageTimes=[...new Set(coverage)].slice(-600);
      const serverLocal=(cached.localObservations||[]).map(item=>({...item,cacheBackend:'server-local'}));
      const global=(cached.sharedObservations||((cached.sharedCacheAvailable?cached.observations:[])||[])).map(item=>({...item,cacheBackend:'firestore'}));
      const fallbackRemote=serverLocal.length||global.length?[]:(cached.observations||[]).map(item=>({...item,cacheBackend:cached.sharedCacheAvailable?'firestore':'server-local'}));
      const allCached=[...(deviceCache.observations||[]).map(item=>({...item,cacheBackend:'device'})),...serverLocal,...global,...fallbackRemote];
      const invalidCachedObservationCount=allCached.filter(item=>!isUsableObjectBox(item.bbox)).length;
      const items=allCached.filter(item=>item.reviewState!=='disputed'&&item.confidence!=='low'&&isUsableObjectBox(item.bbox)&&Number(item.videoTime)<=videoTime+1).map(item=>({...item,id:`cached-${item.id}`,source:'cached',cachedObservationId:item.id,cachedSegmentIndex:item.segmentIndex,sessionId:visualSessionId,videoTime:Number(item.videoTime),firstSeenVideoTime:Number(item.firstSeenVideoTime??item.videoTime),lastSeenVideoTime:Number(item.lastSeenVideoTime??item.videoTime),observationTimes:[Number(item.videoTime)],searchState:'idle',products:[],captureContext:{videoId,videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:visualSessionId,sampleIndex:item.sampleIndex,videoTime:item.videoTime,durationSeconds:video.duration}}));
      trackAction('video-cache.lookup.completed',{deviceObservations:deviceCache.observations?.length||0,serverLocalObservations:serverLocal.length,sharedObservations:global.length,deviceCoverage:deviceCache.coverage?.length||0,sharedCoverage:(cached.coverage||[]).length,incompleteCoverageSamples:allCoverage.length-usableCoverage.length,unlocalizedCacheObservations:invalidCachedObservationCount,cacheHit:items.length>0,fromSeconds,toSeconds,sharedCacheAvailable:cached.sharedCacheAvailable===true});
      if(visualSessionRunning&&items.length){mergeSessionDiscoveries(items);analysisNotice=`Loaded ${items.length} cached candidate${items.length===1?'':'s'} near this point; monitoring for new visual information.`;render();trackAction('video-cache.hydrated',{count:items.length,fromSeconds,toSeconds});void personalizeCachedDiscoveries(items);}
      if(deviceCache.coverage?.length)trackAction('video-cache.device-hydrated',{coverageSamples:deviceCache.coverage.length,observations:deviceCache.observations.length});
    } catch(error) { lastCacheSegmentRequested=-1;trackAction('video-cache.lookup.failed',{reason:error.message}); }
  }
  async function personalizeCachedDiscoveries(items) {
    const fresh=(items||[]).filter(item=>item.cachedObservationId&&!visualSessionPersonalizedIds.has(item.cachedObservationId)).sort((a,b)=>(Number(b.lastSeenVideoTime??b.videoTime)||0)-(Number(a.lastSeenVideoTime??a.videoTime)||0)).slice(0,20);
    if(!profileId||!fresh.length)return;
    try {
      const response=await apiRequest('/api/video-cache/personalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,observations:fresh.map(item=>({id:item.cachedObservationId,label:item.label,brand:item.brand,model:item.model,details:item.details}))})});
      const result=await response.json();if(!response.ok||!result.personalized)return;
      const scores=new Map((result.rankings||[]).map(item=>[item.id,Number.isFinite(Number(item.score))?Number(item.score):0.5]));
      for(const item of fresh)if(scores.has(item.cachedObservationId)){visualSessionPersonalizedIds.add(item.cachedObservationId);const existing=discoveries.find(candidate=>candidate.cachedObservationId===item.cachedObservationId);if(existing)existing.personalizationScore=scores.get(item.cachedObservationId);}
      trackAction('video-cache.personalized',{count:scores.size});render();
    } catch(error) { trackAction('video-cache.personalization.failed',{reason:error.message}); }
  }
  function quickFrameSignature(video) {
    try {
      // Compare nine independent tiles instead of one whole-frame hash. A small
      // object entering one region can then trigger a focused model pass even
      // when most of the video image is unchanged.
      const canvas=document.createElement('canvas');canvas.width=27;canvas.height=24;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(video,0,0,27,24);
      const pixels=context.getImageData(0,0,27,24).data;const gray=new Float32Array(27*24);
      for(let i=0,p=0;i<pixels.length;i+=4,p++)gray[p]=0.299*pixels[i]+0.587*pixels[i+1]+0.114*pixels[i+2];
      const tiles=[];
      for(let tileY=0;tileY<3;tileY++)for(let tileX=0;tileX<3;tileX++){
        let bits=0n;
        for(let y=0;y<8;y++)for(let x=0;x<8;x++){
          const left=gray[(tileY*8+y)*27+tileX*9+x],right=gray[(tileY*8+y)*27+tileX*9+x+1];
          bits=(bits<<1n)|(left>right?1n:0n);
        }
        tiles.push(bits.toString(16).padStart(16,'0'));
      }
      return tiles.join(':');
    } catch { return ''; }
  }
  function signatureDistance(first,second) {
    if(!first||!second)return 64;
    const left=String(first).split(':'),right=String(second).split(':');
    const distances=left.map((tile,index)=>{
      if(!right[index])return 64;
      let value=BigInt(`0x${tile}`)^BigInt(`0x${right[index]}`),count=0;
      while(value){count++;value&=value-1n;}
      return count;
    });
    return Math.max(0,...distances);
  }
  function signatureChangedRegions(first,second,threshold=14){
    if(!first||!second)return [];
    const left=String(first).split(':'),right=String(second).split(':');
    return left.map((tile,index)=>{
      if(!right[index])return null;
      let value=BigInt(`0x${tile}`)^BigInt(`0x${right[index]}`),count=0;
      while(value){count++;value&=value-1n;}
      if(count<threshold)return null;
      const x=index%3,y=Math.floor(index/3);
      return {left:Math.round(x/3*1000)/1000,top:Math.round(y/3*1000)/1000,right:Math.round((x+1)/3*1000)/1000,bottom:Math.round((y+1)/3*1000)/1000,changeBits:count};
    }).filter(Boolean);
  }
  async function reportCachedObservation(discovery) {
    trackAction('cache.feedback.submitted',{item:discovery.label,cacheBackend:discovery.cacheBackend||'device',observationId:discovery.cachedObservationId||''});
    try {
      if(discovery.cacheBackend==='device'){
        await removeDeviceCacheMatch(discovery);
        discoveries=discoveries.filter(item=>item.id!==discovery.id);if(selected?.id===discovery.id)selected=null;
        trackAction('video-cache.device-candidate.removed',{item:discovery.label});trackAction('cache.feedback.completed',{item:discovery.label,status:'removed-local'});analysisNotice='Removed this incorrect candidate from this browser’s local video cache.';render();return;
      }
      const response=await apiRequest('/api/video-cache/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:currentVideoId(),durationSeconds:selectMainVideo()?.duration,observationId:discovery.cachedObservationId,segmentIndex:discovery.cachedSegmentIndex,reason:'Viewer reported this cached visual match as incorrect.'})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'The cached item could not be reported.');
      await removeDeviceCacheMatch(discovery);
      discoveries=discoveries.filter(item=>item.id!==discovery.id); if(selected?.id===discovery.id)selected=null;
      trackAction('video-cache.observation.disputed',{item:discovery.label,cacheBackend:discovery.cacheBackend||'shared'});trackAction('cache.feedback.completed',{item:discovery.label,status:'reported'}); analysisNotice='Reported as a possible cache mistake; live sampling can rediscover it if supported.'; render();
    } catch(error) {trackAction('cache.feedback.failed',{item:discovery.label,cacheBackend:discovery.cacheBackend||'shared',reason:error.message});analysisNotice=`Could not report this cached match: ${error.message}`; render(); }
  }
  async function removeDeviceCacheMatch(discovery){
    const video=selectMainVideo(),key=deviceCacheKey(currentVideoId(),video?.duration||0),stored=(await storageLocalGet([key]))[key];
    if(!stored)return;
    stored.observations=(stored.observations||[]).filter(item=>item.id!==discovery.cachedObservationId&&!(normalizedSessionLabel(item.label)===normalizedSessionLabel(discovery.label)&&boxesSimilar(item.bbox,discovery.bbox)&&Math.abs(Number(item.videoTime)-Number(discovery.videoTime))<=8));
    await storageLocalSet({[key]:stored});
  }
  function render() {
    const box=root.querySelector('#cs-body'); if(!box) return;
    box.dataset.visualSessionRunning=String(visualSessionRunning);
    const previousScrollTop=box.scrollTop;
    const priorFollowup=box.querySelector('.cs-follow');
    const preserveFollowup=Boolean(priorFollowup&&priorFollowup.dataset.discoveryId===(selected?.id||''));
    const priorQuestion=preserveFollowup?priorFollowup.querySelector('input[name="q"]'):null;
    const priorAnswer=preserveFollowup?priorFollowup.querySelector('#cs-chat-results'):null;
    const followupDraft=priorQuestion?.value||'';
    const followupAnswer=preserveFollowup?(followupAnswerHtml||priorAnswer?.innerHTML||''):'';
    const followupHadFocus=Boolean(priorQuestion&&document.activeElement===priorQuestion);
    const followupCaret=priorQuestion?.selectionStart??followupDraft.length;
    const followupSelectionEnd=priorQuestion?.selectionEnd??followupCaret;
    const disclosureState=new Map([...box.querySelectorAll('details')].map((details,index)=>[
      details.classList.contains('cs-options')?'options':details.classList.contains('cs-diagnostics')?'diagnostics':details.classList.contains('cs-preferences')?'preferences':`other-${index}`,
      details.open
    ]));
    const priorProfileInput=box.querySelector('#cs-profile-id');
    const profileDraft=priorProfileInput?.value??profileId;
    const focusedControlId=box.contains(document.activeElement)?document.activeElement?.id:'';
    const focusedControl=focusedControlId?document.activeElement:null;
    const focusedSelectionStart=focusedControl?.selectionStart;
    const focusedSelectionEnd=focusedControl?.selectionEnd;
    const status=visualSessionRunning?(document.hidden?'Paused while you’re away':selectMainVideo()?.paused?'Waiting for playback':'Watching for new finds'):({inactive:'Ready when you are',active:'Ready to explore',paused:'Paused',stopped:'Session ended'}[state]);
    const allShownDiscoveries=activeDiscoveries();
    const orderedDiscoveries=activeResultsView==='current'&&visualSessionId
      ?allShownDiscoveries.slice().sort((a,b)=>{const ai=pinnedDiscoveryOrder.indexOf(a.id),bi=pinnedDiscoveryOrder.indexOf(b.id);if(ai!==-1||bi!==-1){if(ai===-1)return 1;if(bi===-1)return -1;return ai-bi;}return (Number(b.lastSeenVideoTime??b.videoTime)||0)-(Number(a.lastSeenVideoTime??a.videoTime)||0)||(Number(b.personalizationScore??0.5)-Number(a.personalizationScore??0.5));})
      :allShownDiscoveries;
    const discoveryPageCount=Math.max(1,Math.ceil(orderedDiscoveries.length/VISUAL_SESSION_PAGE_SIZE));
    discoveryPage=Math.min(discoveryPage,discoveryPageCount-1);
    const shownDiscoveries=activeResultsView==='current'&&visualSessionId
      ?orderedDiscoveries.slice(discoveryPage*VISUAL_SESSION_PAGE_SIZE,(discoveryPage+1)*VISUAL_SESSION_PAGE_SIZE)
      :orderedDiscoveries;
    const selectedSession=historySessions.find(session=>session.id===activeHistoryId);
    box.innerHTML=`<div class="cs-status"><span class="cs-dot ${state}"></span><span>${status}</span></div>
      ${visualSessionRunning?`<div class="cs-controls"><button id="cs-pause">Pause</button><button class="quiet" id="cs-stop">End session</button></div>`:state==='paused'?`<div class="cs-controls"><button id="cs-resume">Resume</button><button class="quiet" id="cs-stop">End session</button></div>`:`<button class="cs-session-start" id="cs-session-start">${visualSessionId&&state!=='stopped'?'Resume watching':visualSessionId?'Start a new session':'Watch with ContextStream'}</button><button class="cs-analyze" id="cs-analyze">✧ Explore this frame</button>`}
      <details class="cs-options"><summary>Options</summary><label class="cs-keep-history"><input type="checkbox" id="cs-keep-history" ${keepPreviousFrames?'checked':''}> Keep previous finds</label>
      ${sharedVideoCacheAvailable?`<label class="cs-keep-history"><input type="checkbox" id="cs-share-video-cache" ${shareVideoDiscoveries?'checked':''}> Help improve discoveries for this video</label><small>Item details and approximate positions may be shared. Video frames and profile details stay private.</small>`:`<small class="cs-hint">Shared discoveries unavailable right now. Your finds stay on this device.</small>`}</details>
      ${visualSessionId?`<details class="cs-diagnostics"><summary>Session details</summary><a href="${esc(API)}/api/debug/session-log?sessionId=${encodeURIComponent(visualSessionId)}" target="_blank" rel="noopener noreferrer">View session details</a></details>`:''}
      <div class="cs-loading cs-frame-progress" id="cs-loading" hidden>Capturing the video frame…</div>
      <div class="cs-loading cs-session-progress" id="cs-analysis-progress" aria-live="polite" title="${esc(analysisNotice||'Looking for new finds…')}">${esc(visualSessionRunning?(analysisNotice||'Looking for new finds…'):analysisNotice||'')}</div>
      <div class="cs-error" id="cs-error" hidden></div>
      ${(discoveries.length||historySessions.length)?`<nav class="cs-result-tabs" aria-label="Analysis results"><button id="cs-current-tab" class="${activeResultsView==='current'?'active':''}">${visualSessionId?'This session':'Current frame'}</button><button id="cs-history-tab" class="${activeResultsView==='history'?'active':''}" ${historySessions.length?'':'disabled'}>Previous frames${historySessions.length?` (${historySessions.length})`:''}</button></nav>`:''}
      ${activeResultsView==='history'&&historySessions.length?`<div class="cs-history-list">${historySessions.map(session=>`<button class="cs-history-item ${session.id===activeHistoryId?'active':''}" data-session-id="${esc(session.id)}"><span>${esc(session.title||'Video frame')}</span><small>${esc(session.timeLabel)} · ${session.discoveries.length} item${session.discoveries.length===1?'':'s'}</small></button>`).join('')}<button class="cs-clear-history" id="cs-clear-history">Clear previous frames</button></div>${selectedSession?`<p class="cs-session-label">${esc(selectedSession.title||'Previous frame')} · ${esc(selectedSession.timeLabel)}</p>`:''}`:''}
      ${shownDiscoveries.length?`<section><h3>${activeResultsView==='history'?'Previous frame':visualSessionId?'What caught your eye':'In this frame'}</h3>${activeResultsView==='current'&&visualSessionId?renderDiscoveryPagination(discoveryPage,discoveryPageCount,orderedDiscoveries.length):''}${shownDiscoveries.map(d=>`<article class="cs-discovery ${pinnedDiscoveryOrder.includes(d.id)?'pinned':''}"><div class="cs-discovery-head"><button class="cs-object ${selected?.id===d.id?'selected':''}" data-id="${esc(d.id)}"><span>${esc(displayDiscoveryLabel(d,shownDiscoveries))}${pinnedDiscoveryOrder.includes(d.id)?` <small class="cs-pinned-label" data-cs-pin-status>${d.searchState==='done'?'Explored':d.searchState==='error'?'Selected':'Exploring'}</small>`:''}</span><small>${Number.isFinite(d.lastSeenVideoTime??d.videoTime)?`Seen ${frameTimeLabel(Number(d.lastSeenVideoTime??d.videoTime))}`:'Seen in this video'}${d.observationTimes?.length>1?' · seen again':''}</small></button>${d.source==='cached'?'<button class="cs-cache-report" data-report-cache="'+esc(d.id)+'" aria-label="Report this find" title="Report this cached find">Report</button>':''}</div>${identityLabel(d)?`<p class="cs-identity" data-cs-identity>${esc(identityLabel(d))}</p>`:''}${d.visibleText?.length?`<p class="cs-evidence" data-cs-text>${esc(d.visibleText.join(', '))}</p>`:''}${selected?.id===d.id?`${d.evidence?`<p class="cs-evidence" data-cs-evidence>${esc(d.evidence)}</p>`:''}<div class="cs-live-results" data-live-results="${esc(d.id)}">${renderLiveResults(d)}</div>`:renderDiscoverySummary(d)}</article>`).join('')}${activeResultsView==='current'&&visualSessionId?renderDiscoveryPagination(discoveryPage,discoveryPageCount,orderedDiscoveries.length):''}</section>`:activeResultsView==='history'?'<p class="cs-no-match">Choose a previous frame above.</p>':discoveries.length===0?'<p class="cs-no-match">Explore a frame to see what catches your eye.</p>':''}
      <section class="cs-follow" data-discovery-id="${esc(selected?.id||'')}"><h3>Ask about an object</h3><p>${selected?`Selected: <b>${esc(selected.label)}</b>`:'Select a discovery to ask a follow-up.'}</p><form id="cs-chat"><input name="q" placeholder="Ask about this item…" ${selected?'':'disabled'}><button ${selected?'':'disabled'}>Ask</button></form><div id="cs-chat-results"></div></section>
      <details class="cs-preferences"><summary>Your preferences</summary><p><a href="${esc(API)}/#preferences" target="_blank" rel="noopener noreferrer">Manage preferences ↗</a></p><form id="cs-profile"><input id="cs-profile-id" name="id" value="${esc(profileId)}" placeholder="Preference code"><button>Connect</button></form><small>Use your preferences to tailor discoveries and searches.</small></details>
      <footer>Check the retailer for current price and availability.</footer>`;
    for(const [key,selector] of [['options','.cs-options'],['diagnostics','.cs-diagnostics'],['preferences','.cs-preferences']]){
      const details=box.querySelector(selector);
      if(details&&disclosureState.has(key))details.open=disclosureState.get(key);
    }
    const currentProfileInput=box.querySelector('#cs-profile-id');
    if(currentProfileInput)currentProfileInput.value=profileDraft;
    const currentFollowup=box.querySelector('#cs-chat input[name="q"]');
    const currentAnswer=box.querySelector('#cs-chat-results');
    if(preserveFollowup&&currentFollowup&&currentAnswer){currentFollowup.value=followupDraft;currentAnswer.innerHTML=followupAnswer;followupAnswerHtml=followupAnswer;if(followupHadFocus){currentFollowup.focus({preventScroll:true});currentFollowup.setSelectionRange(followupCaret,followupSelectionEnd);}}
    if(focusedControlId&&focusedControlId!=='cs-chat'&&focusedControlId!=='cs-profile-id')box.querySelector(`#${CSS.escape(focusedControlId)}`)?.focus({preventScroll:true});
    if(focusedControlId==='cs-profile-id'&&currentProfileInput){currentProfileInput.focus({preventScroll:true});if(Number.isInteger(focusedSelectionStart))currentProfileInput.setSelectionRange(focusedSelectionStart,focusedSelectionEnd??focusedSelectionStart);}
    box.querySelector('#cs-analyze')?.addEventListener('click',()=>{if(state!=='active')state='active';void analyze();});
    box.querySelector('#cs-session-start')?.addEventListener('click',startVisualSession);
    box.querySelectorAll('[data-cs-discovery-page]').forEach(button=>button.addEventListener('click',()=>{discoveryPage=Math.max(0,Math.min(discoveryPageCount-1,discoveryPage+(button.dataset.csDiscoveryPage==='next'?1:-1)));const pageItems=orderedDiscoveries.slice(discoveryPage*VISUAL_SESSION_PAGE_SIZE,(discoveryPage+1)*VISUAL_SESSION_PAGE_SIZE);void personalizeCachedDiscoveries(pageItems.filter(item=>item.source==='cached'));render();}));
    box.querySelector('#cs-keep-history').onchange=e=>{keepPreviousFrames=e.currentTarget.checked;if(!keepPreviousFrames){historySessions=[];activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.cleared',{reason:'keep-previous-disabled'});render();}else trackAction('analysis.history-preference.changed',{state:'keep'});};
    box.querySelector('#cs-share-video-cache')?.addEventListener('change',async e=>{shareVideoDiscoveries=e.currentTarget.checked;await chrome.storage.local.set({shareVideoDiscoveries});trackAction('video-cache.contribution-preference.changed',{state:shareVideoDiscoveries?'enabled':'disabled'});});
    box.querySelector('#cs-current-tab')?.addEventListener('click',()=>{activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];render();});
    box.querySelector('#cs-history-tab')?.addEventListener('click',()=>{if(!historySessions.length)return;activeResultsView='history';activeHistoryId=historySessions[0].id;selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.opened');render();});
    box.querySelectorAll('.cs-history-item').forEach(button=>button.addEventListener('click',()=>{activeHistoryId=button.dataset.sessionId;selected=null;followupMessages=[];followupListings=[];render();}));
    box.querySelector('#cs-clear-history')?.addEventListener('click',()=>{historySessions=[];activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];trackAction('analysis.history.cleared');render();});
    box.querySelector('#cs-pause')?.addEventListener('click',()=>{trackAction('analysis.paused');state='paused';visualSessionRunning=false;analysisNotice='';try{stopVisualFrameMonitor();activeAnalysisJobId='';cancelAnalysis();}catch(error){console.error('[ContextStream] Could not fully pause the visual session:',error);}finally{render();}});
    box.querySelector('#cs-resume')?.addEventListener('click',resumeVisualSession);
    box.querySelector('#cs-start')?.addEventListener('click',()=>{trackAction('analysis.started');state='active';render();});
    box.querySelector('#cs-stop')?.addEventListener('click',()=>{trackAction('analysis.stopped');state='stopped';analysisNotice='';try{stopVisualSession('stopped');cancelAnalysis();}catch(error){console.error('[ContextStream] Could not fully stop the visual session:',error);}finally{render();}});
    const selectDiscovery=id=>{const next=activeDiscoveries().find(d=>d.id===id);if(selected?.id!==next?.id){followupMessages=[];followupListings=[];followupPage=0;followupAnswerHtml='';const chat=box.querySelector('#cs-chat-results');if(chat)chat.innerHTML='';}selected=next;if(selected){if(activeResultsView==='current'&&visualSessionId){if(!pinnedDiscoveryOrder.includes(selected.id))pinnedDiscoveryOrder.push(selected.id);const currentOrder=activeDiscoveries().slice().sort((a,b)=>{const ai=pinnedDiscoveryOrder.indexOf(a.id),bi=pinnedDiscoveryOrder.indexOf(b.id);if(ai!==-1||bi!==-1){if(ai===-1)return 1;if(bi===-1)return -1;return ai-bi;}return (Number(b.lastSeenVideoTime??b.videoTime)||0)-(Number(a.lastSeenVideoTime??a.videoTime)||0)||(Number(b.personalizationScore??0.5)-Number(a.personalizationScore??0.5));});const index=currentOrder.findIndex(item=>item.id===selected.id);if(index>=0)discoveryPage=Math.floor(index/VISUAL_SESSION_PAGE_SIZE);}trackAction('discovery.selected',{item:selected.label});saveDiscoveryContext(selected);if(selected.searchState==='idle'||selected.searchState==='error'||(selected.searchState==='done'&&!(selected.products||[]).length))searchDiscovery(selected);else render();}};
    box.querySelectorAll('.cs-object').forEach(b=>b.onclick=()=>selectDiscovery(b.dataset.id));
    box.querySelectorAll('[data-cs-explore-discovery]').forEach(b=>b.onclick=()=>selectDiscovery(b.dataset.csExploreDiscovery));
    box.querySelectorAll('.cs-discovery').forEach(card=>card.addEventListener('click',event=>{if(event.target.closest('button,a,input,form'))return;const item=card.querySelector('.cs-object');if(item)selectDiscovery(item.dataset.id);}));
    box.querySelectorAll('[data-report-cache]').forEach(button=>button.addEventListener('click',()=>{const item=discoveries.find(entry=>entry.id===button.dataset.reportCache);if(item)void reportCachedObservation(item);}));
    bindPagination(box);
    box.querySelectorAll('.cs-product').forEach(b=>b.onclick=()=>{
      const d=discoveries.find(x=>x.id===b.dataset.discovery); const p=d?.products.find(x=>x.id===b.dataset.prod);
      if(p?.url) { window.open(p.url,'_blank','noopener,noreferrer'); if(d)saveDiscoveryContext(d,{openedProductUrl:p.url,products:[{...p,interactions:['opened']}]}); }
    });
    bindLiveProductLinks(box);
    box.querySelector('#cs-chat').onsubmit=async e=>{e.preventDefault(); const q=String(new FormData(e.currentTarget).get('q')||'').trim();if(!q||!selected)return; trackAction('followup.submitted',{item:selected.label,question:q}); const out=new Proxy({}, {get(_target,key){const node=root.querySelector('#cs-chat-results');const value=node?.[key];return typeof value==='function'?value.bind(node):value;},set(_target,key,value){const node=root.querySelector('#cs-chat-results');if(key==='innerHTML')followupAnswerHtml=String(value);else if(key==='textContent')followupAnswerHtml=esc(value);if(node)node[key]=value;return true;}}); out.textContent='Understanding your request and searching this scene…'; try { const currentListings=followupListings.length?followupListings:selected.products||[];const exactListing=currentListings.find(product=>product.matchType==='exact_text');const pricedListings=currentListings.map(priceFromListing).filter(price=>price>0);const exactReferencePrice=exactListing?priceFromListing(exactListing):0;const referencePrice=exactReferencePrice||(pricedListings.length?Math.min(...pricedListings):0);const referencePriceIsExact=Boolean(exactReferencePrice&&selected.identityConfidence==='high'&&selected.brand&&selected.model);const r=await apiRequest('/api/followup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId,object:selected.label,brand:selected.brand||'',model:selected.model||'',identityConfidence:selected.identityConfidence||'',evidence:selected.evidence||'',visibleText:selected.visibleText||[],details:selected.details||[],frameId:selected.frameId||'',lensFrameId:selected.lensFallbackFrameId||'',listings:currentListings,messages:followupMessages,question:q,referencePrice,referencePriceIsExact,location,videoTitle:document.title,videoUrl:window.location.href})}); let d=await r.json(); if(!r.ok)throw new Error(d.error); if(d.jobId){const jobStart=Date.now();let followupStatusVersion=0;for(;;){await new Promise(resolve=>setTimeout(resolve,800));const sr=await apiRequest(`/api/search-status?id=${encodeURIComponent(d.jobId)}`);const status=await sr.json();if(!sr.ok)throw new Error(status.error||'Follow-up search expired.');if(status.updatedAt!==followupStatusVersion){followupStatusVersion=status.updatedAt;if(status.products?.length){out.innerHTML=`<p>${esc(status.response||d.response||'Searching…')}</p><p class="cs-match-note">${esc(status.message||'Updating matching listings…')}</p>${renderPagedProducts(status.products,0,'followup')}`;followupListings=status.products;bindLiveProductLinks(out);bindPagination(out);}else out.textContent=status.message||d.message||'Searching matching listings…';}if(status.state==='error')throw new Error(status.error||status.message);if(status.state==='done'){d={...status};break;}if(Date.now()-jobStart>180000)throw new Error('Search is taking longer than expected. The results found so far remain visible.');}}followupMessages=[...followupMessages,{role:'user',content:q},{role:'assistant',content:d.response}].slice(-12);followupListings=d.products||[];followupPage=0;out.innerHTML=`<p>${esc(d.response)}</p>${d.groundedSummary?`<p class="cs-match-note">${esc(d.groundedSummary)}</p>`:''}${d.groundedCitations?.length?`<p class="cs-match-note">Sources: ${d.groundedCitations.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.url)}</a>`).join(' · ')}</p>`:''}${d.products.length?renderPagedProducts(d.products,followupPage,'followup'):'<p class="cs-no-match">No live results were returned for this search.</p>'}`; bindLiveProductLinks(out);bindPagination(out);saveDiscoveryContext(selected,{products:d.products||[],followup:{question:q,response:d.response,productUrls:(d.products||[]).map(p=>p.url).filter(Boolean)}}); } catch(err){trackAction('followup.failed',{item:selected.label,reason:err.message});out.innerHTML=`<p class="cs-no-match">${esc(err.message)}</p>${followupListings.length?renderPagedProducts(followupListings,followupPage,'followup'):''}`;bindPagination(out);bindLiveProductLinks(out);} };
    box.querySelector('#cs-profile').onsubmit=async e=>{e.preventDefault();const id=new FormData(e.currentTarget).get('id').trim();if(!id)return;try{const r=await apiRequest(`/api/profile?id=${encodeURIComponent(id)}`);const p=await r.json();if(!r.ok)throw new Error(p.error);profileId=p.id;maxPrice=p.maxPrice||'';location=p.location||'';historyEnabled=Boolean(p.historyEnabled);savedContextKeys.clear();await chrome.storage.local.set({profileId});void personalizeCachedDiscoveries(discoveries.filter(item=>item.source==='cached'));render();}catch(err){box.querySelector('#cs-profile').insertAdjacentHTML('beforeend',`<small>${esc(err.message)}</small>`);}};
    box.scrollTop=previousScrollTop;
  }
  function stashCurrentDiscoveries(videoTime) {
    if(!keepPreviousFrames||!discoveries.length)return;
    historySessions.unshift({id:crypto.randomUUID(),title:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,100),timeLabel:frameTimeLabel(videoTime),discoveries});
    historySessions=historySessions.slice(0,8);
  }
  async function prepareSessionDiscoveries(objects,image,videoTime,captureContext={}) {
    const frameRefId=`${visualSessionId}:${captureContext.sampleIndex??visualSessionFrames}`;
    if(image){sessionFrameImages.set(frameRefId,image);while(sessionFrameImages.size>SESSION_FRAME_IMAGE_LIMIT)sessionFrameImages.delete(sessionFrameImages.keys().next().value);}
    return (objects||[]).map(item=>({
      ...item,id:`session-${crypto.randomUUID()}`,source:'live',sessionId:visualSessionId,frameRefId,
      captureContext:{...captureContext,sessionId:visualSessionId,discoveryId:`session-${item.id}`,itemLabel:item.label,bbox:item.bbox,videoTime},
      videoTime,firstSeenVideoTime:videoTime,lastSeenVideoTime:videoTime,observationTimes:[videoTime]
    }));
  }
  function boxesSimilar(left,right) {
    if(!isUsableObjectBox(left)||!isUsableObjectBox(right))return false;
    const x1=Math.max(left[0],right[0]),y1=Math.max(left[1],right[1]),x2=Math.min(left[2],right[2]),y2=Math.min(left[3],right[3]);
    const intersection=Math.max(0,x2-x1)*Math.max(0,y2-y1),areaLeft=Math.max(0,left[2]-left[0])*Math.max(0,left[3]-left[1]),areaRight=Math.max(0,right[2]-right[0])*Math.max(0,right[3]-right[1]);
    const iou=intersection/Math.max(Number.EPSILON,areaLeft+areaRight-intersection);
    const leftX=(left[0]+left[2])/2,leftY=(left[1]+left[3])/2,rightX=(right[0]+right[2])/2,rightY=(right[1]+right[3])/2;
    const maxDiagonal=Math.max(Math.hypot(left[2]-left[0],left[3]-left[1]),Math.hypot(right[2]-right[0],right[3]-right[1]));
    return iou>=0.18||Math.hypot(leftX-rightX,leftY-rightY)<=Math.max(0.07,Math.min(0.14,maxDiagonal*0.25));
  }
  function normalizedSessionLabel(value) {
    const key=String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
    const aliases={eyeglass:'eyeglasses','eyeglass frame':'eyeglasses','eyeglass frames':'eyeglasses',glasses:'eyeglasses',spectacles:'eyeglasses',earring:'earrings','stuffed toy':'plush toy','stuffed animal':'plush toy','tee shirt':'t shirt','tee shirts':'t shirt','t shirts':'t shirt','sports jersey':'jersey','athletic jersey':'jersey','laptop computer':'laptop','notebook computer':'laptop','water bottle':'bottle','office chair':'chair','dining chair':'chair','cell phone':'smartphone','mobile phone':'smartphone'};
    return aliases[key]||key;
  }
  function displayDiscoveryLabel(discovery, allDiscoveries) {
    const sameLabel=(allDiscoveries||[]).filter(item=>normalizedSessionLabel(item.label)===normalizedSessionLabel(discovery.label));
    if(sameLabel.length<2||!Array.isArray(discovery.bbox)||discovery.bbox.length!==4)return discovery.label;
    const centerX=(Number(discovery.bbox[0])+Number(discovery.bbox[2]))/2;
    return `${discovery.label} · ${centerX<0.5?'left':'right'}`;
  }
  function mergeSessionDiscoveries(incoming) {
    const stats={added:0,updated:0,ignored:0};
    for(const item of incoming){
      const label=normalizedSessionLabel(item.label);
      const existing=label?discoveries.find(old=>normalizedSessionLabel(old.label)===label&&boxesSimilar(old.bbox,item.bbox)):null;
      if(!existing){discoveries.push(item);stats.added++;continue;}
      if(item.source==='cached'&&existing.source==='live'){stats.ignored++;continue;}
      const preserved={id:existing.id,sessionId:existing.sessionId,firstSeenVideoTime:existing.firstSeenVideoTime,observationTimes:existing.observationTimes||[],products:existing.products||[],searchState:existing.searchState||'idle',searchError:existing.searchError||'',providersUsed:existing.providersUsed||[],productPage:existing.productPage||0,searchJobId:existing.searchJobId||'',searchMessage:existing.searchMessage||'',frameId:item.frameId||existing.frameId||'',frameRefId:item.frameRefId||existing.frameRefId||'',searchFrameData:existing.searchFrameData||'',searchFrameSourceData:existing.searchFrameSourceData||'',lensFallbackFrameId:existing.lensFallbackFrameId||''};
      const times=preserved.observationTimes;
      if(!times.length||Math.abs(times[times.length-1]-item.videoTime)>=3)times.push(item.videoTime);
      Object.assign(existing,item,preserved,{lastSeenVideoTime:item.videoTime,observationTimes:times.slice(-8)});
      stats.updated++;
      if(selected?.id===existing.id)selected=existing;
    }
    return stats;
  }
  function sessionInventorySnapshot(reason){
    if(!visualSessionId||visualSessionFinalSnapshotLogged)return;
    visualSessionFinalSnapshotLogged=true;
    const inventory=discoveries.map(item=>({id:item.id,label:item.label,canonicalLabel:normalizedSessionLabel(item.label),bbox:Array.isArray(item.bbox)&&item.bbox.length===4?item.bbox:null,bboxSource:item.bboxSource||'',confidence:item.confidence||'low',identityConfidence:item.identityConfidence||'low',source:item.source||'live',cacheBackend:item.cacheBackend||'',firstSeenVideoTime:Number(item.firstSeenVideoTime??item.videoTime)||0,lastSeenVideoTime:Number(item.lastSeenVideoTime??item.videoTime)||0,observationTimes:(item.observationTimes||[]).slice(-8),details:(item.details||[]).slice(0,4),evidence:String(item.evidence||'').slice(0,240),searchQuery:String(item.searchQuery||'').slice(0,180),productCount:(item.products||[]).length}));
    const chunkSize=8,chunkCount=Math.max(1,Math.ceil(inventory.length/chunkSize));
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex++)trackAction('visual-session.inventory-finalized',{reason,frames:visualSessionFrames,inventoryCount:inventory.length,chunkIndex,chunkCount,inventory:inventory.slice(chunkIndex*chunkSize,(chunkIndex+1)*chunkSize)});
  }
  function reconcileCachedCandidates(liveItems, videoTime) {
    for(const cached of discoveries){
      if(cached.source!=='cached'||Math.abs(Number(cached.videoTime)-videoTime)>15)continue;
      const reobserved=(liveItems||[]).some(item=>normalizedSessionLabel(item.label)===normalizedSessionLabel(cached.label)&&boxesSimilar(item.bbox,cached.bbox));
      cached.cacheCheckState=reobserved?'seen-again':'not-seen';
    }
  }
  function startVisualSession() {
    if(visualSessionRunning)return;
    if(visualSessionId&&state==='paused'){resumeVisualSession();return;}
    cancelAnalysis();activeAnalysisJobId='';lastFrameAt=0;
    if(discoveries.length)stashCurrentDiscoveries(document.querySelector('video.html5-main-video, video')?.currentTime||0);
    visualSessionId=crypto.randomUUID();visualSessionFrames=0;visualSessionError='';videoCacheCoverageTimes=[];visualSessionLastSignature='';visualSessionStartupSignature='';visualSessionWarmupNovelty=false;visualSessionCacheReady=false;visualSessionLastAnalysisAt=0;visualSessionLastSignatureAt=0;lastCacheSegmentRequested=-1;visualSessionPersonalizedIds=new Set();visualSessionAnalysisInFlight=false;discoveryPage=0;pinnedDiscoveryOrder=[];sessionFrameImages=new Map();discoveries=[];selected=null;followupMessages=[];followupListings=[];lastAnalyzedFrame='';
    objectTracks=new Map();recentEmptyFocusedAnalyses=[];visualSessionFinalSnapshotLogged=false;objectAnalysisQueue=[];objectDetectorError='';objectDetectorFrameFailureCount=0;startObjectDetectorWorker();
    objectDetectorFallbackInvoked=false;
    activeResultsView='current';activeHistoryId='';state='active';visualSessionRunning=true;analysisNotice='';
    trackAction('visual-session.started',{monitorIntervalMs:VISUAL_SESSION_POLL_MS,analysisMode:'continuous-local-object-detection-and-focused-analysis',shareVideoDiscoveries});render();
    const video=selectMainVideo();
    if(!video){void runVisualSessionSample();return;}
    visualSessionMonitorVideo=video;
    visualSessionStartupSignature=quickFrameSignature(video);visualSessionLastSignature=visualSessionStartupSignature;
    const sessionId=visualSessionId;
    visualSessionCachePromise=hydrateVideoCache(video.currentTime||0);
    void visualSessionCachePromise.finally(()=>completeVisualSessionWarmup(sessionId));
    scheduleVisualFrameMonitor(video);
  }
  function resumeVisualSession(){
    trackAction('visual-session.resumed');state='active';visualSessionRunning=true;analysisNotice='Resuming continuous frame monitoring…';
    startObjectDetectorWorker();
    const video=selectMainVideo();scheduleVisualFrameMonitor(video);
    const sessionId=visualSessionId;
    if(!visualSessionCacheReady&&visualSessionCachePromise)void visualSessionCachePromise.finally(()=>completeVisualSessionWarmup(sessionId));
    else if(!visualSessionCacheReady){visualSessionCacheReady=true;void analyzeSessionSample();}
    render();
  }
  function completeVisualSessionWarmup(sessionId){
    if(!visualSessionRunning||visualSessionId!==sessionId||visualSessionCacheReady)return;
    visualSessionCacheReady=true;
    const currentVideo=selectMainVideo();
    const covered=videoCacheCoverageTimes.some(time=>Math.abs(time-(currentVideo?.currentTime||0))<=5);
    const currentSignature=quickFrameSignature(currentVideo);
    const changedWhileLoading=visualSessionWarmupNovelty||signatureDistance(visualSessionStartupSignature,currentSignature)>=14;
    visualSessionLastSignature=currentSignature;
    if(covered&&!changedWhileLoading&&discoveries.length){visualSessionLastAnalysisAt=Date.now();trackAction('visual-session.initial-analysis-skipped',{reason:'cache-coverage-and-usable-cached-discoveries',cachedDiscoveryCount:discoveries.length});analysisNotice='Showing cached discoveries and monitoring for new objects…';render();}
    else {if(covered&&changedWhileLoading)trackAction('visual-session.cached-view-changed',{reason:'visual-content-changed-after-cached-sample'});void analyzeSessionSample();}
  }
  async function runVisualSessionSample() {
    if(!visualSessionRunning||state!=='active')return;
    const video=selectMainVideo();
    if(!video||!document.querySelector('ytd-watch-flexy')){visualSessionRunning=false;state='stopped';analysisNotice='The YouTube video is no longer available on this page.';render();return;}
    if(video.ended){sessionInventorySnapshot('video-ended');visualSessionRunning=false;state='stopped';analysisNotice='Video ended. Start a new session if you replay it.';trackAction('visual-session.ended',{samples:visualSessionFrames});render();return;}
    if(document.hidden||video.paused){analysisNotice=document.hidden?'Session waiting for this tab to be visible.':'Session waiting for video playback.';render();scheduleVisualFrameMonitor(video);return;}
    void hydrateVideoCache(video.currentTime);
    if(objectDetectorError){if(!objectDetectorFallbackInvoked){objectDetectorFallbackInvoked=true;trackAction('visual-session.legacy-visual-monitor-fallback',{reason:objectDetectorError});}processVisualFrameSignature(video,quickFrameSignature(video));}
    else void detectObjectsInVideoFrame(video);
    if(typeof video.requestVideoFrameCallback!=='function')visualSessionTimer=setTimeout(runVisualSessionSample,VISUAL_SESSION_POLL_MS);
  }
  function scheduleVisualFrameMonitor(video){
    if(!visualSessionRunning||!video)return;
    visualSessionMonitorVideo=video;
    if(document.hidden||video.paused){
      analysisNotice=document.hidden?'Session waiting for this tab to be visible.':'Session waiting for video playback.';
      render();
      if(!visualSessionTimer)visualSessionTimer=setTimeout(()=>{visualSessionTimer=null;if(!visualSessionRunning)return;if(document.hidden||video.paused)scheduleVisualFrameMonitor(video);else{analysisNotice='Playback resumed — monitoring for new objects…';render();scheduleVisualFrameMonitor(video);}},VISUAL_SESSION_POLL_MS);
      return;
    }
    if(visualSessionTimer){clearTimeout(visualSessionTimer);visualSessionTimer=null;}
    if(typeof video.requestVideoFrameCallback==='function'){
      visualSessionFrameCallbackId=video.requestVideoFrameCallback(()=>{
        visualSessionFrameCallbackId=null;
        if(!visualSessionRunning)return;
        if(document.hidden||video.paused){analysisNotice=document.hidden?'Session waiting for this tab to be visible.':'Session waiting for video playback.';render();scheduleVisualFrameMonitor(video);return;}
        if(objectDetectorError){if(!objectDetectorFallbackInvoked){objectDetectorFallbackInvoked=true;trackAction('visual-session.legacy-visual-monitor-fallback',{reason:objectDetectorError});}if(Date.now()-visualSessionLastSignatureAt>=VISUAL_SESSION_POLL_MS)processVisualFrameSignature(video,quickFrameSignature(video));}
        else {
          if(Date.now()-objectDetectorLastSampleAt>=500)void detectObjectsInVideoFrame(video);
          // Keep the inexpensive visual-change monitor active alongside local
          // object detection. It triggers a broad vision sweep only when a
          // meaningful region changes and no focused-object analysis is in
          // flight, catching wearable/small/novel objects outside COCO labels.
          if(Date.now()-visualSessionLastSignatureAt>=VISUAL_SESSION_POLL_MS)processVisualFrameSignature(video,quickFrameSignature(video));
        }
        scheduleVisualFrameMonitor(video);
      });
    }else void runVisualSessionSample();
  }
  function startObjectDetectorWorker(){
    if(objectDetectorWorker)return;
    objectDetectorWorker={offscreen:true};
    chrome.runtime.sendMessage({type:'LOCAL_DETECTOR_INITIALIZE'},response=>{
      if(chrome.runtime.lastError||!response?.ok){objectDetectorWorker=null;objectDetectorError=chrome.runtime.lastError?.message||response?.error||'Local object detector could not initialize.';trackAction('visual-session.local-detector-unavailable',{reason:objectDetectorError});return;}
      objectDetectorReady=true;objectDetectorError='';trackAction('visual-session.local-detector-ready',{executionContext:'extension-offscreen-worker'});
    });
  }
  async function detectObjectsInVideoFrame(video){
    if(!visualSessionRunning||!objectDetectorWorker||!objectDetectorReady||objectDetectorInFlight||video.readyState<2||!video.videoWidth)return;
    const now=Date.now();if(now-objectDetectorLastSampleAt<450)return;objectDetectorLastSampleAt=now;objectDetectorInFlight=true;
    try{
      const scale=Math.min(1,320/video.videoWidth),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);
      const frameData=canvas.toDataURL('image/jpeg',0.68),requestId=++objectDetectorRequestId;
      chrome.runtime.sendMessage({type:'LOCAL_DETECTOR_FRAME',frameData,videoTimeSeconds:video.currentTime,requestId},response=>{
        objectDetectorInFlight=false;
        if(chrome.runtime.lastError||!response?.ok){const reason=chrome.runtime.lastError?.message||response?.error||'Local object detector frame processing failed.';objectDetectorFrameFailureCount++;trackAction('visual-session.local-detector-frame-failed',{reason,consecutiveFailures:objectDetectorFrameFailureCount});if(objectDetectorFrameFailureCount>=3)objectDetectorError=reason;return;}
        objectDetectorFrameFailureCount=0;objectDetectorError='';
        if(!visualSessionRunning)return;
        if(Date.now()-objectDetectorLastDiagnosticsAt>=5000){objectDetectorLastDiagnosticsAt=Date.now();const detections=response.detections||[],rejectedByRule={unsupportedLabel:0,belowScoreThreshold:0,invalidBox:0};for(const item of detections){const label=String(item.label||'').toLowerCase();if(!TRACKABLE_DETECTOR_LABELS.has(label))rejectedByRule.unsupportedLabel++;else if(Number(item.score)<OBJECT_DETECTOR_MIN_SCORE)rejectedByRule.belowScoreThreshold++;else if(!isUsableObjectBox(item.bbox))rejectedByRule.invalidBox++;}trackAction('visual-session.detector-sample-summary',{detectionCount:detections.length,eligibleCandidateCount:detections.filter(item=>TRACKABLE_DETECTOR_LABELS.has(String(item.label||'').toLowerCase())&&Number(item.score)>=OBJECT_DETECTOR_MIN_SCORE&&isUsableObjectBox(item.bbox)).length,rejectedByRule,minScore:OBJECT_DETECTOR_MIN_SCORE,requiredTrackHits:OBJECT_TRACK_CONFIRMATION_HITS,candidates:detections.map(item=>({label:item.label,score:item.score,bbox:item.bbox}))});}
        processObjectDetections(video,response.detections||[],Number(response.videoTimeSeconds)||video.currentTime);
      });
    }catch(error){objectDetectorInFlight=false;objectDetectorError=error.message;trackAction('visual-session.local-detector-frame-failed',{reason:error.message});}
  }
  function processObjectDetections(video,detections,videoTime){
    const now=Date.now(),seen=new Set();let cacheChanged=false;
    for(const detection of detections){
      const label=String(detection.label||'').toLowerCase();const bbox=detection.bbox;
      if(!TRACKABLE_DETECTOR_LABELS.has(label)||Number(detection.score)<OBJECT_DETECTOR_MIN_SCORE||!isUsableObjectBox(bbox))continue;
      let best=null,bestDistance=Infinity;
      for(const track of objectTracks.values())if(track.detectorLabel===label){const distance=boxDistance(track.bbox,bbox);if(distance<bestDistance){best=track;bestDistance=distance;}}
      const key=best&&bestDistance<0.16?best.id:`track-${++objectTrackSequence}`;let track=objectTracks.get(key);
      if(!track){track={id:key,detectorLabel:label,bbox,score:detection.score,detectionHits:0,createdAt:now,lastSeenAt:now,lastAnalysisAt:0,lastVideoTime:videoTime,appearanceCount:0,cached:false};objectTracks.set(key,track);}
      track.detectionHits++;
      track.bbox=bbox;track.lastSeenAt=now;track.lastVideoTime=videoTime;track.score=Math.max(track.score,Number(detection.score)||0);seen.add(key);
      const logDecision=(decision,extra={})=>{track.loggedDecisionReasons ||= new Set();if(track.loggedDecisionReasons.has(decision))return;track.loggedDecisionReasons.add(decision);trackAction('visual-session.candidate-decision',{decision,detectorLabel:label,bbox,detectorScore:track.score,detectionHits:track.detectionHits,videoTime,...extra});};
      const matching=discoveries.find(item=>{const saved=normalizedSessionLabel(item.detectorLabel||item.label),detected=normalizedSessionLabel(label);return (saved===detected||saved.includes(detected)||detected.includes(saved))&&boxesSimilar(item.bbox,bbox);});
      if(matching){matching.lastSeenVideoTime=videoTime;matching.bbox=bbox;matching.observationTimes=[...(matching.observationTimes||[]).filter(t=>Math.abs(t-videoTime)>3),videoTime].slice(-8);if(!track.cached)trackAction('visual-session.candidate-reused-live',{detectorLabel:label,bbox,videoTime});track.cached=true;cacheChanged=true;continue;}
      const cached=discoveries.find(item=>item.source==='cached'&&item.cacheCheckState!=='disputed'&&Math.abs(Number(item.videoTime)-videoTime)<=35&&boxesSimilar(item.bbox,bbox)&&(normalizedSessionLabel(item.label).includes(label)||label.includes(normalizedSessionLabel(item.label))));
      if(cached){cached.cacheCheckState='seen-again';cached.lastSeenVideoTime=videoTime;if(!track.cached)trackAction('visual-session.candidate-reused-cache',{detectorLabel:label,bbox,videoTime,cacheBackend:cached.cacheBackend||'unknown'});track.cached=true;cacheChanged=true;continue;}
      recentEmptyFocusedAnalyses=recentEmptyFocusedAnalyses.filter(miss=>Math.abs(videoTime-miss.videoTime)<=EMPTY_FOCUSED_RECHECK_VIDEO_SECONDS);
      const recentMiss=recentEmptyFocusedAnalyses.find(miss=>miss.detectorLabel===label&&boxesSimilar(miss.bbox,bbox));
      if(recentMiss){track.analysisComplete=true;logDecision('suppressed-after-empty-focused-analysis',{previousMissVideoTime:recentMiss.videoTime});continue;}
      if(!visualSessionCacheReady){logDecision('waiting-for-cache-hydration');continue;}
      if(visualSessionAnalysisInFlight){logDecision('waiting-for-initial-analysis');continue;}
      if(track.cached){logDecision('already-matched-to-visible-candidate');continue;}
      if(track.detectionHits<OBJECT_TRACK_CONFIRMATION_HITS){logDecision('confirming-track-before-analysis',{requiredHits:OBJECT_TRACK_CONFIRMATION_HITS});continue;}
      if(track.analysisComplete){logDecision('focused-analysis-already-completed');continue;}
      if(track.retryAfter&&now<track.retryAfter){logDecision('retry-cooldown-active',{retryAfterMs:track.retryAfter-now});continue;}
      if(!track.queued&&objectAnalysisQueue.length<OBJECT_ANALYSIS_QUEUE_LIMIT){track.queued=true;objectAnalysisQueue.push({track,videoTime,video});track.appearanceCount++;trackAction('visual-session.object-candidate-queued',{detectorLabel:label,bbox,detectorScore:track.score,detectionHits:track.detectionHits,queueDepth:objectAnalysisQueue.length,videoTime});}
      else if(!track.queued)logDecision('analysis-queue-full',{queueDepth:objectAnalysisQueue.length});
    }
    for(const [id,track] of objectTracks)if(now-track.lastSeenAt>OBJECT_TRACK_TTL_MS*4)objectTracks.delete(id);
    if(cacheChanged&&now-lastObjectDiscoveryRenderAt>1800){lastObjectDiscoveryRenderAt=now;render();}
    pumpObjectAnalysisQueue();
  }
  function collectRecentDetectorCandidates(videoTime){
    const now=Date.now();
    return [...objectTracks.values()].filter(track=>{
      const area=(track.bbox[2]-track.bbox[0])*(track.bbox[3]-track.bbox[1]);
      return now-track.lastSeenAt<=1800&&Math.abs(Number(track.lastVideoTime)-videoTime)<=4&&track.detectionHits>=2&&track.score>=OBJECT_DETECTOR_MIN_SCORE&&area>=0.002&&area<=0.72&&isUsableObjectBox(track.bbox);
    }).sort((a,b)=>b.score-a.score).slice(0,20).map(track=>({label:track.detectorLabel,score:track.score,bbox:track.bbox,videoTime:track.lastVideoTime,detectionHits:track.detectionHits}));
  }
  function boxDistance(a,b){if(!a||!b)return 1;const ax=(a[0]+a[2])/2,ay=(a[1]+a[3])/2,bx=(b[0]+b[2])/2,by=(b[1]+b[3])/2;return Math.hypot(ax-bx,ay-by);}
  function pumpObjectAnalysisQueue(){while(visualSessionRunning&&objectAnalysisInFlight<OBJECT_ANALYSIS_MAX_IN_FLIGHT&&objectAnalysisQueue.length){const job=objectAnalysisQueue.shift();objectAnalysisInFlight++;void analyzeFocusedObjectTrack(job).finally(()=>{objectAnalysisInFlight=Math.max(0,objectAnalysisInFlight-1);job.track.queued=false;pumpObjectAnalysisQueue();});}}
  async function analyzeFocusedObjectTrack({track,videoTime,video}){
    if(!visualSessionRunning||!video||!isUsableObjectBox(track.bbox))return;
    if(Date.now()-track.lastSeenAt>OBJECT_TRACK_TTL_MS*2)return;
    const focusVideoTime=Number.isFinite(video.currentTime)?video.currentTime:videoTime;
    const controller=new AbortController();objectAnalysisControllers.add(controller);
    track.lastAnalysisAt=Date.now();const captureContext={videoId:currentVideoId(),videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:visualSessionId,sampleIndex:++visualSessionFrames,videoTime:focusVideoTime,durationSeconds:Number.isFinite(video.duration)?video.duration:null,detectorLabel:track.detectorLabel,itemLabel:track.detectorLabel,bbox:track.bbox};
    try{
      const captured=await captureDecodedVideoFrame(video);const cropped=await cropObjectForVision(captured.sourceImage,track.bbox);
      const payload={image:cropped?.image||captured.image,sourceImage:cropped?.sourceImage||captured.sourceImage,sourceFrame:captured.sourceImage,isObjectCrop:Boolean(cropped),focusItem:track.detectorLabel,shareToGlobalCache:shareVideoDiscoveries,captureContext:{...captureContext,cropFallback:!cropped}};
      const response=await apiRequest('/api/analyze-object',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(`${data.error||`HTTP ${response.status}`}${data.traceId?` (debug ${data.traceId})`:''}`);
      if(!visualSessionRunning)return;
      const objects=(data.objects||[]).map(item=>({...item,detectorLabel:track.detectorLabel,bbox:track.bbox,frameId:data.frameId,searchFrameData:cropped?.image||'',searchFrameSourceData:cropped?.sourceImage||'',frameData:captured.sourceImage,source:'live'}));
      if(objects.length){recentEmptyFocusedAnalyses=recentEmptyFocusedAnalyses.filter(miss=>miss.detectorLabel!==track.detectorLabel||!boxesSimilar(miss.bbox,track.bbox));const prepared=await prepareSessionDiscoveries(objects,captured.sourceImage,focusVideoTime,data.captureContext||captureContext);const mergeStats=mergeSessionDiscoveries(prepared);void persistDeviceVideoSample(objects,captureContext);trackAction('visual-session.focused-object-analysis-merged',{detectorLabel:track.detectorLabel,resultCount:objects.length,...mergeStats});render();}
      else{recentEmptyFocusedAnalyses.push({detectorLabel:track.detectorLabel,bbox:track.bbox,videoTime:focusVideoTime});recentEmptyFocusedAnalyses=recentEmptyFocusedAnalyses.slice(-32);}
      track.analysisComplete=true;track.retryAfter=0;if(shareVideoDiscoveries&&data.sharedCacheWrite==='failed'){analysisNotice='Shared cache write failed; this discovery remains available in this browser.';render();}trackAction('visual-session.focused-object-analysis-ready',{detectorLabel:track.detectorLabel,resultCount:objects.length,cropUsed:Boolean(cropped),videoTime:focusVideoTime,sharedCacheWrite:data.sharedCacheWrite||'not-requested',sharedCacheWriteDetails:data.sharedCacheWriteDetails||null,provider:data.analyzedBy||'',model:data.model||'',traceId:data.traceId||''});
    }catch(error){if(!controller.signal.aborted){track.retryAfter=Date.now()+10_000;trackAction('visual-session.focused-object-analysis-failed',{detectorLabel:track.detectorLabel,reason:error.message,retryAfterMs:10_000});}}
    finally{objectAnalysisControllers.delete(controller);}
  }
  function cropObjectForVision(dataUrl,bbox){
    if(!dataUrl||!isUsableObjectBox(bbox))return Promise.resolve(null);
    return new Promise(resolve=>{const image=new Image();image.onload=async()=>{try{const [x1,y1,x2,y2]=bbox;const px=(x2-x1)*0.12,py=(y2-y1)*0.12,left=Math.max(0,x1-px),top=Math.max(0,y1-py),right=Math.min(1,x2+px),bottom=Math.min(1,y2+py),width=Math.round((right-left)*image.naturalWidth),height=Math.round((bottom-top)*image.naturalHeight);if(width<96||height<72||(right-left)*(bottom-top)>0.75)return resolve(null);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,left*image.naturalWidth,top*image.naturalHeight,width,height,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob||blob.size>14*1024*1024)return resolve(null);resolve({image:await blobDataUrl(blob),sourceImage:await blobDataUrl(blob)});}catch{resolve(null);}};image.onerror=()=>resolve(null);image.src=dataUrl;});
  }
  function processVisualFrameSignature(video,signature){
    if(!visualSessionRunning||state!=='active'||!signature)return;
    if(video.ended){sessionInventorySnapshot('video-ended');visualSessionRunning=false;state='stopped';stopVisualFrameMonitor();analysisNotice='Video ended. Start a new session if you replay it.';trackAction('visual-session.ended',{samples:visualSessionFrames});render();return;}
    const now=Date.now();if(now-visualSessionLastSignatureAt<VISUAL_SESSION_POLL_MS)return;
    visualSessionLastSignatureAt=now;
    if(!visualSessionCacheReady){if(signatureChangedRegions(visualSessionStartupSignature,signature).length)visualSessionWarmupNovelty=true;return;}
    const cacheSegment=Math.floor(Math.max(0,video.currentTime)/30);
    if(cacheSegment!==lastCacheSegmentRequested)void hydrateVideoCache(video.currentTime);
    if(!visualSessionLastSignature){visualSessionLastSignature=signature;return;}
    const previous=visualSessionLastSignature;
    const changedRegions=signatureChangedRegions(previous,signature);
    const signatureBits=signatureDistance(previous,signature);
    const cacheCoversCurrentPoint=videoCacheCoverageTimes.some(time=>Math.abs(time-video.currentTime)<=5);
    const elapsed=now-visualSessionLastAnalysisAt;
    const meaningfulChange=changedRegions.length>0;
    const periodicCoverageCheck=elapsed>=VISUAL_SESSION_MAX_RECHECK_MS&&!cacheCoversCurrentPoint;
    const focusedObjectWorkPending=objectAnalysisInFlight>0||objectAnalysisQueue.length>0;
    if((meaningfulChange||periodicCoverageCheck)&&!visualSessionAnalysisInFlight&&!focusedObjectWorkPending&&elapsed>=VISUAL_SESSION_ANALYSIS_COOLDOWN_MS){
      visualSessionLastAnalysisAt=now;visualSessionLastSignature=signature;
      analysisNotice=meaningfulChange?'A new visual change appeared — checking for discoveries…':'Checking this uncovered time range for missed discoveries…';render();
      trackAction('visual-session.novelty-detected',{time:frameTimeLabel(video.currentTime),similarityBits:signatureBits,cacheCovered:cacheCoversCurrentPoint,reason:meaningfulChange?'localized-frame-change':'uncovered-range-recheck'});
      void analyzeSessionSample(meaningfulChange?changedRegions:[]);
    }
  }
  async function analyzeSessionSample(noveltyRegions=[]){
    if(!visualSessionRunning||visualSessionAnalysisInFlight)return;
    visualSessionAnalysisInFlight=true;visualSessionFrames++;visualSessionLastAnalysisAt=Date.now();
    const succeeded=await analyze({sessionSample:true,noveltyRegions});
    visualSessionAnalysisInFlight=false;
    if(!visualSessionRunning||state!=='active')return;
    if(!succeeded){analysisNotice=`This analysis request failed${visualSessionError?`: ${visualSessionError}`:''}. Monitoring remains active and will retry after a later meaningful change.`;trackAction('visual-session.analysis-failed',{reason:visualSessionError});render();return;}
    const currentTime=selectMainVideo()?.currentTime;
    if(Number.isFinite(currentTime))videoCacheCoverageTimes=[...new Set([...videoCacheCoverageTimes,currentTime])].slice(-600);
    analysisNotice='Monitoring continuously for new objects; no model request until a meaningful change or uncovered range appears.';render();
  }
  function stopVisualFrameMonitor(){
    clearTimeout(visualSessionTimer);visualSessionTimer=null;
    if(visualSessionMonitorVideo&&visualSessionFrameCallbackId!=null&&typeof visualSessionMonitorVideo.cancelVideoFrameCallback==='function')visualSessionMonitorVideo.cancelVideoFrameCallback(visualSessionFrameCallbackId);
    visualSessionFrameCallbackId=null;visualSessionMonitorVideo=null;visualSessionAnalysisInFlight=false;
    // objectDetectorWorker is only a content-script sentinel: the actual
    // Worker lives in the offscreen extension document. Calling terminate()
    // here threw and prevented pause/stop from rendering. Leave the loaded
    // detector warm for a quick resume; its frame callback ignores stopped runs.
    objectAnalysisQueue=[];
    for(const controller of objectAnalysisControllers)controller.abort(new DOMException('The visual session stopped.','AbortError'));objectAnalysisControllers.clear();
  }
  function stopVisualSession(reason='stopped') {
    visualSessionRunning=false;stopVisualFrameMonitor();
    if(analysisController)cancelAnalysis();
    activeAnalysisJobId='';
    sessionInventorySnapshot(reason);
    trackAction('visual-session.stopped',{reason,frames:visualSessionFrames});
  }
  function renderLiveResults(discovery){
    if(discovery.searchState==='loading')return `<p class="cs-no-match">${esc(discovery.searchMessage||'Finding similar items…')}</p>${discovery.products?.length?renderPagedProducts(discovery.products,discovery.productPage||0,'discovery'):''}`;
    if(discovery.searchState==='error')return `<p class="cs-no-match">Couldn’t find similar items right now.</p><button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">Try again</button>${discovery.products?.length?renderPagedProducts(discovery.products,discovery.productPage||0,'discovery'):''}`;
    if(discovery.searchState==='done'&&!discovery.products.length)return `<p class="cs-no-match">${esc(discovery.searchMessage||'No similar listings found this time.')}</p><button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">Search again</button>`;
    if(discovery.searchState==='done'){
      const exactCount=discovery.products.filter(product=>product.matchType==='exact_text').length;
      const note=exactCount?`<p class="cs-match-note">${exactCount} find${exactCount===1?'':'s'} mention the brand and model seen.</p>`:'<p class="cs-match-note">Similar finds for this item.</p>';
      const grounded=discovery.groundedSummary?`<p class="cs-match-note">${esc(discovery.groundedSummary)}</p>${discovery.groundedCitations?.length?`<p class="cs-match-note">Sources: ${discovery.groundedCitations.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.url)}</a>`).join(' · ')}</p>`:''}`:'';
      return `${grounded}${note}${renderPagedProducts(discovery.products,discovery.productPage||0,'discovery')}`;
    }
    return '<p class="cs-no-match">Select this object to search live web results.</p>';
  }
  function renderDiscoverySummary(discovery){
    if(discovery.searchState==='loading')return '<p class="cs-no-match">Finding similar items…</p>';
    if(discovery.searchState==='error')return `<button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">Couldn’t finish · Try again</button>`;
    if(discovery.searchState==='done'&&discovery.products?.length)return `<button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">${discovery.products.length} similar find${discovery.products.length===1?'':'s'} ready · View</button>`;
    if(discovery.searchState==='done')return `<button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">No listings yet · Try again</button>`;
    return `<button class="cs-explore-similar" data-cs-explore-discovery="${esc(discovery.id)}">Explore similar finds</button>`;
  }
  function updateDiscoveryResults(discovery){
    const target=[...root.querySelectorAll('.cs-live-results')].find(node=>node.dataset.liveResults===String(discovery?.id||''));
    if(!target)return;
    const card=target.closest('.cs-discovery');
    if(card){
      const objectButton=card.querySelector('.cs-object');
      const updateEvidence=(selector,attribute,text,className,insertAfter)=>{let node=card.querySelector(selector);if(!text){node?.remove();return;}if(!node){node=document.createElement('p');node.className=className;node.setAttribute(attribute,'');insertAfter.insertAdjacentElement('afterend',node);}node.textContent=text;};
      updateEvidence('[data-cs-identity]','data-cs-identity',identityLabel(discovery)?`Possible identity: ${identityLabel(discovery)} · ${discovery.identityConfidence||'low'} confidence`:'','cs-identity',objectButton);
      const identityNode=card.querySelector('[data-cs-identity]')||objectButton;
      updateEvidence('[data-cs-text]','data-cs-text',discovery.visibleText?.length?`Text seen: ${discovery.visibleText.join(', ')}`:'','cs-evidence',identityNode);
      const textNode=card.querySelector('[data-cs-text]')||identityNode;
      updateEvidence('[data-cs-evidence]','data-cs-evidence',discovery.evidence||'','cs-evidence',textNode);
      const pinStatus=card.querySelector('[data-cs-pin-status]');
      if(pinStatus)pinStatus.textContent=discovery.searchState==='done'?'Explored':discovery.searchState==='error'?'Selected':'Exploring';
    }
    target.innerHTML=renderLiveResults(discovery);
    target.querySelectorAll('[data-cs-explore-discovery]').forEach(button=>button.onclick=()=>{if(discovery.searchState!=='loading')searchDiscovery(discovery);});
    bindPagination(target);bindLiveProductLinks(target);
  }
  function renderPagedProducts(products,page,scope){
    const pageSize=5;const count=Math.ceil(products.length/pageSize);const current=Math.max(0,Math.min(count-1,Number(page)||0));
    const visible=products.slice(current*pageSize,(current+1)*pageSize);
    const controls=count>1?`<nav class="cs-pagination" aria-label="Product result pages"><button data-cs-page="previous" data-cs-scope="${scope}" ${current===0?'disabled':''}>Previous</button><span>${current*pageSize+1}–${Math.min((current+1)*pageSize,products.length)} of ${products.length}</span><button data-cs-page="next" data-cs-scope="${scope}" ${current===count-1?'disabled':''}>Next</button></nav>`:'';
    return `<div class="cs-paged-products" data-cs-list-scope="${scope}">${controls}${visible.map(renderLiveProduct).join('')}${count>1?controls:''}</div>`;
  }
  function renderDiscoveryPagination(page,count,total){
    if(count<=1)return '';
    const start=page*VISUAL_SESSION_PAGE_SIZE+1,end=Math.min((page+1)*VISUAL_SESSION_PAGE_SIZE,total);
    return `<nav class="cs-pagination" aria-label="Discovery pages"><button data-cs-discovery-page="previous" ${page===0?'disabled':''}>Previous</button><span>${start}–${end} of ${total}</span><button data-cs-discovery-page="next" ${page===count-1?'disabled':''}>Next</button></nav>`;
  }
  function bindPagination(container){container.querySelectorAll('[data-cs-page]').forEach(button=>button.onclick=()=>{const scope=button.dataset.csScope;if(scope==='discovery'){if(!selected)return;selected.productPage=Math.max(0,(Number(selected.productPage)||0)+(button.dataset.csPage==='next'?1:-1));updateDiscoveryResults(selected);return;}if(scope==='followup'){followupPage=Math.max(0,followupPage+(button.dataset.csPage==='next'?1:-1));const target=button.closest('.cs-paged-products');if(target){target.outerHTML=renderPagedProducts(followupListings,followupPage,'followup');bindPagination(container);bindLiveProductLinks(container);}}});}
  function renderLiveProduct(product){
    const shownPrice=Number(product.displayPrice??product.priceInr);const shownCurrency=currencyCode(product.displayCurrency||product.currency);const hasSnippetPrice=Number.isFinite(shownPrice)&&shownPrice>0;
    const formattedPrice=hasSnippetPrice?new Intl.NumberFormat(undefined,{style:'currency',currency:shownCurrency,maximumFractionDigits:shownCurrency==='INR'||shownCurrency==='JPY'?0:2}).format(shownPrice):'';
    const priceNote=hasSnippetPrice?` · ${formattedPrice}${product.displayPriceApproximate?' approx.':''}${product.priceStatus==='over_limit'?' · above your budget':''}`:product.priceStatus==='price_not_shown'?' · see retailer for price':'';
    const offerNote=product.priceText&&!hasSnippetPrice?` · ${esc(product.priceText)}`:'';
    return `<button class="cs-product" data-url="${esc(product.url)}"><span>${esc(product.title)}</span><small>${esc(product.retailer)}${esc(priceNote)}${offerNote}</small>${product.description?`<em>${esc(String(product.description).slice(0,150))}</em>`:''}</button>`;
  }
  function bindLiveProductLinks(container){container.querySelectorAll('[data-url]').forEach(button=>button.onclick=()=>{const url=button.dataset.url;if(!url)return;window.open(url,'_blank','noopener,noreferrer');if(selected){const product=(followupListings.length?followupListings:selected.products||[]).find(item=>item.url===url);saveDiscoveryContext(selected,{openedProductUrl:url,products:product?[{...product,interactions:['opened']}]:[]});}});}
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
  async function makeContextAwareFullFrameFallback(frameData,discovery,captureContext=discoveryCaptureContext(discovery)){
    if(!frameData)return null;
    const encoded=await new Promise((resolve,reject)=>{const source=new Image();source.onload=async()=>{try{const canvas=document.createElement('canvas');canvas.width=source.naturalWidth;canvas.height=source.naturalHeight;canvas.getContext('2d').drawImage(source,0,0);resolve(await encodeSearchCrop(canvas));}catch(error){reject(error);}};source.onerror=()=>reject(new Error('Could not decode the original frame for a Lens fallback.'));source.src=frameData;});
    if(!encoded?.image)return null;
    const response=await apiRequest('/api/frame-cache',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:encoded.image,sourceImage:frameData,isFullFrameFallback:true,captureContext})});
    const result=await response.json();if(!response.ok||!result.frameId)throw new Error(result.error||`HTTP ${response.status}`);
    return result.frameId;
  }
  async function searchDiscovery(discovery){
    const startedAt=Date.now();
    discovery.searchState='loading';discovery.searchError='';discovery.productPage=0;render();
    trackAction('product.search.started',{item:discovery.label});
    let needsVisualBoxRecovery=!isUsableObjectBox(discovery.bbox);
    let searchContext=discoveryCaptureContext(discovery);
    const params=new URLSearchParams({q:discovery.label,context:discovery.evidence||'',profileId,location,maxPrice,brand:cleanIdentityPart(discovery.brand),model:cleanIdentityPart(discovery.model),identityConfidence:discovery.identityConfidence||'',searchQuery:discovery.searchQuery||'',visibleText:(discovery.visibleText||[]).join('|'),details:(discovery.details||[]).join('|'),frameId:discovery.frameId||'',captureContext:JSON.stringify(searchContext)});
    try{
      const retainedFrameData=discovery.searchFrameData?'':(discovery.frameData||sessionFrameImages.get(discovery.frameRefId)||'');
      let frameData=retainedFrameData||(discovery.source==='cached'?'':lastAnalyzedFrame);
      let cropBBox=discovery.bbox;
      let capturedVideoTime=null;
      if(!frameData&&!discovery.frameId){
        const liveVideo=selectMainVideo();
        if(liveVideo?.readyState>=2&&liveVideo.videoWidth>0&&liveVideo.videoHeight>0){
          try{
            const captured=await captureDecodedVideoFrame(liveVideo);
            frameData=captured.sourceImage;
            capturedVideoTime=Number.isFinite(liveVideo.currentTime)?liveVideo.currentTime:null;
            const recentTracks=[...objectTracks.values()].filter(track=>Date.now()-track.lastSeenAt<=1800&&normalizedSessionLabel(track.detectorLabel)===normalizedSessionLabel(discovery.label)&&isUsableObjectBox(track.bbox)).sort((a,b)=>b.score-a.score);
            if(recentTracks.length)cropBBox=recentTracks[0].bbox;
            else if(!Number.isFinite(capturedVideoTime)||!Number.isFinite(Number(discovery.lastSeenVideoTime??discovery.videoTime))||Math.abs(capturedVideoTime-Number(discovery.lastSeenVideoTime??discovery.videoTime))>5)cropBBox=null;
            needsVisualBoxRecovery=!isUsableObjectBox(cropBBox);
            searchContext={...discoveryCaptureContext(discovery,cropBBox),videoTime:capturedVideoTime,sampleIndex:visualSessionFrames};
            params.set('captureContext',JSON.stringify(searchContext));
            trackAction('visual.search.live-frame-captured',{item:discovery.label,videoTime:capturedVideoTime,cropBoxSource:recentTracks.length?'live-object-track':isUsableObjectBox(cropBBox)?'recent-cached-box':'context-aware-full-frame'});
          }catch(error){trackAction('visual.search.live-frame-capture-failed',{item:discovery.label,reason:error.message});}
        }
      }
      const objectCrop=discovery.searchFrameData?{image:discovery.searchFrameData,sourceImage:discovery.searchFrameSourceData||discovery.searchFrameData}:await cropObjectForSearch(frameData,cropBBox);
      let cropCached=false;
      if(objectCrop?.image){
        try{
          const cached=await apiRequest('/api/frame-cache',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:objectCrop.image,sourceImage:objectCrop.sourceImage,isObjectCrop:true,captureContext:searchContext})});
          const cachedData=await cached.json();
          if(cached.ok&&cachedData.frameId){discovery.frameId=cachedData.frameId;discovery.lensFallbackFrameId='';params.set('frameId',cachedData.frameId);cropCached=true;trackAction('visual.search.crop-cached',{item:discovery.label});}
          else{needsVisualBoxRecovery=true;trackAction('visual.search.crop-cache-failed',{item:discovery.label,reason:cachedData.error||`HTTP ${cached.status}`});}
        }catch(error){needsVisualBoxRecovery=true;trackAction('visual.search.crop-cache-failed',{item:discovery.label,reason:error.message});}
      }else{if(discovery.frameId)needsVisualBoxRecovery=true;trackAction('visual.search.crop-unavailable',{item:discovery.label,reason:needsVisualBoxRecovery?'A selected-object crop is unavailable; preparing a context-aware full-frame fallback.':'Could not prepare a crop of the selected item.'});}
      if(!cropCached&&frameData){
        try{const fallbackFrameId=await makeContextAwareFullFrameFallback(frameData,discovery,searchContext);if(fallbackFrameId){discovery.lensFallbackFrameId=fallbackFrameId;params.set('lensFrameId',fallbackFrameId);trackAction('visual.search.full-frame-fallback-ready',{item:discovery.label,videoTime:capturedVideoTime,cropFallback:needsVisualBoxRecovery});}}
        catch(error){trackAction('visual.search.full-frame-fallback-failed',{item:discovery.label,reason:error.message});}
      }
      if(!cropCached&&!discovery.lensFallbackFrameId&&!discovery.frameId)trackAction('visual.search.lens-image-unavailable',{item:discovery.label,reason:'No retained or live video frame could be prepared for Lens.'});
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
            discovery.products=status.products||[];discovery.providersUsed=status.providersUsed||[];discovery.exactIdentitySupported=Boolean(status.exactIdentitySupported);discovery.searchQuery=status.searchQuery||'';discovery.groundedSummary=status.groundedSummary||'';discovery.groundedCitations=status.groundedCitations||[];discovery.searchMessage=status.message||'';discovery.searchState='done';break;
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
  async function analyze({sessionSample=false,noveltyRegions=[]}={}) {
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
      const captureContext={videoId:currentVideoId(),videoUrl:window.location.href,videoTitle:document.title.replace(/\s*-\s*YouTube\s*$/i,'').slice(0,240),sessionId:visualSessionId||`frame-${crypto.randomUUID()}`,sampleIndex:sessionSample?visualSessionFrames:0,videoTime:frameVideoTime,durationSeconds:Number.isFinite(video.duration)?video.duration:null,...(sessionSample&&noveltyRegions.length?{noveltyRegions:noveltyRegions.map(region=>({left:region.left,top:region.top,right:region.right,bottom:region.bottom,changeBits:region.changeBits}))}:{})};
      const detectorCandidates=sessionSample?collectRecentDetectorCandidates(frameVideoTime):[];
      const reply=await apiRequest('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image,sourceImage:sourceImage!==image?sourceImage:undefined,maxPrice,sessionSample,shareToGlobalCache:sessionSample&&shareVideoDiscoveries,detectorCandidates,captureContext}),signal:requestController.signal});
      const data=await reply.json();if(!reply.ok)throw new Error(`${data.error||'Analysis failed.'}${data.traceId?` (debug ${data.traceId})`:''}`);
      if(state!=='active')return false;
      if(sessionSample){
        void persistDeviceVideoSample(data.objects,{...captureContext,inputObservationCount:data.rawDetectionCount||data.objects.length});
        if(shareVideoDiscoveries&&data.sharedCacheWrite==='failed'){analysisNotice='Shared cache write failed; discoveries remain available in this browser.';trackAction('video-cache.shared-write-failed',{stage:'frame-inventory'});}
        const prepared=await prepareSessionDiscoveries(data.objects,sourceImage,frameVideoTime,data.captureContext||captureContext);
        if(state!=='active'||!visualSessionRunning)return false;
        reconcileCachedCandidates(prepared,frameVideoTime);
        const mergeStats=mergeSessionDiscoveries(prepared);
        const unlocalizedRejectedCount=Number(data.unlocalizedRejectedCount)||0,lowConfidenceRejectedCount=Number(data.lowConfidenceRejectedCount)||0,insufficientEvidenceRejectedCount=Number(data.insufficientEvidenceRejectedCount)||0,withheldCandidateCount=Number(data.withheldCandidateCount)||unlocalizedRejectedCount+lowConfidenceRejectedCount+insufficientEvidenceRejectedCount;
        if(withheldCandidateCount)analysisNotice=`Held ${unlocalizedRejectedCount} unlocalized, ${lowConfidenceRejectedCount} low-confidence, and ${insufficientEvidenceRejectedCount} low-evidence candidate${withheldCandidateCount===1?'':'s'} from this sample.`;
        trackAction('visual-session.sample-ready',{frame:visualSessionFrames,time:frameTimeLabel(frameVideoTime),rawDetectionCount:Number(data.rawDetectionCount)||prepared.length,unlocalizedRejectedCount,lowConfidenceRejectedCount,insufficientEvidenceRejectedCount,withheldCandidateCount,detected:prepared.length,total:discoveries.length,...mergeStats,items:prepared.map(item=>({id:item.id,label:item.label,canonicalLabel:normalizedSessionLabel(item.label),bbox:item.bbox,bboxSource:item.bboxSource||'model',confidence:item.confidence,identityConfidence:item.identityConfidence,visibleText:item.visibleText,details:item.details,evidence:item.evidence,searchQuery:item.searchQuery})),provider:data.analyzedBy||'',model:data.model||'',traceId:data.traceId||'',sharedCacheWrite:data.sharedCacheWrite||'not-requested',sharedCacheWriteDetails:data.sharedCacheWriteDetails||null});
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
      const sourceFrame=discovery.frameData||sessionFrameImages.get(discovery.frameRefId)||lastAnalyzedFrame||discovery.searchFrameData;
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
      shareVideoDiscoveries=message.shareVideoDiscoveries===true;
      void chrome.storage.local.set({shareVideoDiscoveries});
      if(!root.querySelector('#cs-panel'))shell();
      document.querySelector('#contextstream-invite')?.remove();
      root.querySelector('#cs-panel').classList.add('open');root.classList.add('panel-open');startVisualSession();
    }
  });
  scheduleInviteRetry();
  const observer=new MutationObserver(()=>{ if(!document.querySelector('ytd-watch-flexy'))return; if(!document.querySelector('#contextstream-invite')&&!root.querySelector('.cs-panel.open')&&state==='inactive')invite(); });
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('yt-navigate-finish',()=>{stopVisualSession('youtube-navigation');state='inactive';discoveries=[];historySessions=[];visualSessionId='';visualSessionFrames=0;pinnedDiscoveryOrder=[];analysisNotice='';activeResultsView='current';activeHistoryId='';selected=null;followupMessages=[];followupListings=[];followupAnswerHtml='';inviteDismissed=false;document.querySelector('#contextstream-invite')?.remove();root.innerHTML='';requestAnimationFrame(scheduleInviteRetry);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&visualSessionRunning){visualSessionRunning=false;stopVisualFrameMonitor();activeAnalysisJobId='';state='paused';analysisNotice='Session paused while this tab is hidden. Resume when you return.';cancelAnalysis();trackAction('visual-session.auto-paused',{reason:'tab-hidden'});render();}});
})();
