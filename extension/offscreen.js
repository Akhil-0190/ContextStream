const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
let objectDetectorWorker = null;
let objectDetectorReadyPromise = null;
const detectorRequests = new Map();

function ensureObjectDetector() {
  if (objectDetectorReadyPromise) return objectDetectorReadyPromise;
  objectDetectorReadyPromise = new Promise((resolve, reject) => {
    try {
      objectDetectorWorker = new Worker(chrome.runtime.getURL('object-detector-worker.js'));
      const timeout = setTimeout(() => reject(new Error('Local object detector initialization timed out.')), 20_000);
      objectDetectorWorker.onmessage = event => {
        const message = event.data || {};
        if (message.type === 'ready') { clearTimeout(timeout); resolve(); return; }
        if (message.type === 'error' && message.requestId == null) { clearTimeout(timeout); objectDetectorWorker?.terminate(); objectDetectorWorker = null; objectDetectorReadyPromise = null; reject(new Error(message.error || 'Local object detector initialization failed.')); return; }
        const pending = detectorRequests.get(message.requestId);
        if (!pending) return;
        detectorRequests.delete(message.requestId);
        pending(message.type === 'detections' ? { ok: true, detections: message.detections || [], videoTimeSeconds: message.videoTimeSeconds } : { ok: false, error: message.error || 'Local detection failed.' });
      };
      objectDetectorWorker.onerror = event => {
        clearTimeout(timeout);
        const reason = event.message || 'Local detector worker failed to load.';
        for (const pending of detectorRequests.values()) pending({ ok: false, error: reason });
        detectorRequests.clear();
        objectDetectorWorker = null;
        objectDetectorReadyPromise = null;
        reject(new Error(reason));
      };
      objectDetectorWorker.postMessage({ type: 'initialize', extensionBaseUrl: chrome.runtime.getURL('') });
    } catch (error) { reject(error); }
  }).catch(error => { objectDetectorWorker?.terminate(); objectDetectorWorker = null; objectDetectorReadyPromise = null; throw error; });
  return objectDetectorReadyPromise;
}

async function runLocalObjectDetection(message, respond) {
  try {
    await ensureObjectDetector();
    if (message.type === 'LOCAL_DETECTOR_INITIALIZE') { respond({ ok: true }); return; }
    const response = await fetch(message.frameData);
    if (!response.ok) throw new Error('Could not decode the local detector frame.');
    const bitmap = await createImageBitmap(await response.blob());
    detectorRequests.set(message.requestId, respond);
    objectDetectorWorker.postMessage({ type: 'detect', bitmap, videoTimeSeconds: message.videoTimeSeconds, requestId: message.requestId }, [bitmap]);
  } catch (error) { detectorRequests.delete(message.requestId); respond({ ok: false, error: error.message || 'Local detection failed.' }); }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas encoding failed.')), type, quality));
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the captured frame.'));
    reader.readAsDataURL(blob);
  });
}

async function encodeCanvas(canvas) {
  const png = await canvasBlob(canvas, 'image/png');
  const sourceImage = await blobDataUrl(png);
  if (png.size <= MAX_IMAGE_BYTES) return { image: sourceImage, sourceImage, mimeType: 'image/png' };
  for (const quality of [0.99, 0.97, 0.95, 0.92, 0.9, 0.87]) {
    const webp = await canvasBlob(canvas, 'image/webp', quality);
    if (webp.size <= MAX_IMAGE_BYTES) return { image: await blobDataUrl(webp), sourceImage, mimeType: 'image/webp' };
  }
  for (let scale = 0.92; scale >= 0.6; scale *= 0.9) {
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.round(canvas.width * scale));
    reduced.height = Math.max(1, Math.round(canvas.height * scale));
    reduced.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, reduced.width, reduced.height);
    const webp = await canvasBlob(reduced, 'image/webp', 0.97);
    if (webp.size <= MAX_IMAGE_BYTES) return { image: await blobDataUrl(webp), sourceImage, mimeType: 'image/webp' };
  }
  throw new Error('The frame exceeds Gemini’s maximum practical inline image size.');
}

async function capturePlayerFrame(streamId, crop) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the captured tab frame.')), 8000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('The captured tab frame could not be decoded.')); };
    });
    await video.play();
    if (!video.videoWidth || !video.videoHeight) throw new Error('The captured tab did not provide a usable video frame.');
    const sx = video.videoWidth / crop.viewport.width;
    const sy = video.videoHeight / crop.viewport.height;
    const left = Math.max(0, Math.min(crop.viewport.width, crop.rect.left));
    const top = Math.max(0, Math.min(crop.viewport.height, crop.rect.top));
    const right = Math.max(left, Math.min(crop.viewport.width, crop.rect.right));
    const bottom = Math.max(top, Math.min(crop.viewport.height, crop.rect.bottom));
    const sourceX = Math.round(left * sx), sourceY = Math.round(top * sy);
    const width = Math.round((right - left) * sx), height = Math.round((bottom - top) * sy);
    if (width < 80 || height < 60) throw new Error('The video player is not visible enough to capture.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: false }).drawImage(video, sourceX, sourceY, width, height, 0, 0, width, height);
    const encoded = await encodeCanvas(canvas);
    return { ...encoded, width, height };
  } finally {
    video.pause();
    video.srcObject = null;
    stream.getTracks().forEach(track => track.stop());
  }
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.target === 'offscreen' && message.type === 'LOCAL_DETECTOR_INITIALIZE') {
    runLocalObjectDetection(message, respond);
    return true;
  }
  if (message.target === 'offscreen' && message.type === 'LOCAL_DETECTOR_FRAME') {
    runLocalObjectDetection(message, respond);
    return true;
  }
  if (message.target !== 'offscreen' || message.type !== 'CAPTURE_PLAYER_FRAME') return;
  capturePlayerFrame(message.streamId, message.crop)
    .then(result => respond({ ok: true, ...result }))
    .catch(error => respond({ ok: false, error: error.message }));
  return true;
});
