/* Local, on-device video object detection. Frames stay inside this worker. */
let detector = null;
let lastTimestampMs = 0;
let extensionBaseUrl = '';

function extensionUrl(path) {
  return new URL(path, extensionBaseUrl).href;
}

async function initialize() {
  if (detector) return;
  importScripts(extensionUrl('vendor/mediapipe/vision_bundle.js'));
  const vision = self.Vision;
  if (!vision?.FilesetResolver || !vision?.ObjectDetector) throw new Error('The local object detector runtime did not load.');
  const simd = await vision.FilesetResolver.isSimdSupported();
  const wasmBase = extensionUrl('vendor/mediapipe/wasm/');
  const suffix = simd ? '' : '_nosimd';
  const fileset = {
    wasmLoaderPath: `${wasmBase}vision_wasm${suffix}_internal.js`,
    wasmBinaryPath: `${wasmBase}vision_wasm${suffix}_internal.wasm`
  };
  detector = await vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: extensionUrl('models/efficientdet_lite0.tflite') },
    runningMode: 'VIDEO',
    scoreThreshold: 0.28,
    maxResults: 30
  });
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'initialize') {
    extensionBaseUrl = String(message.extensionBaseUrl || '');
    if (!extensionBaseUrl.startsWith('chrome-extension://')) { self.postMessage({ type: 'error', error: 'The extension worker did not receive its own resource base URL.' }); return; }
    try { await initialize(); self.postMessage({ type: 'ready' }); }
    catch (error) { self.postMessage({ type: 'error', error: String(error?.message || error) }); }
    return;
  }
  if (message.type === 'close') {
    detector?.close();
    detector = null;
    self.close();
    return;
  }
  if (message.type !== 'detect') return;
  const bitmap = message.bitmap;
  try {
    await initialize();
    const requestedTimestamp = Number(message.videoTimeSeconds) * 1000;
    lastTimestampMs = Math.max(lastTimestampMs + 1, Number.isFinite(requestedTimestamp) ? requestedTimestamp : 0);
    const result = detector.detectForVideo(bitmap, lastTimestampMs);
    const width = bitmap.width;
    const height = bitmap.height;
    const detections = (result.detections || []).map(detection => {
      const box = detection.boundingBox;
      const category = detection.categories?.[0];
      if (!box || !category) return null;
      const left = Math.max(0, Math.min(1, box.originX / width));
      const top = Math.max(0, Math.min(1, box.originY / height));
      const right = Math.max(left, Math.min(1, (box.originX + box.width) / width));
      const bottom = Math.max(top, Math.min(1, (box.originY + box.height) / height));
      return { label: String(category.categoryName || category.displayName || 'object'), score: Number(category.score) || 0, bbox: [left, top, right, bottom] };
    }).filter(Boolean);
    self.postMessage({ type: 'detections', requestId: message.requestId, videoTimeSeconds: message.videoTimeSeconds, detections });
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, error: String(error?.message || error) });
  } finally {
    bitmap?.close?.();
  }
};
