'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_CACHE_FILE = path.join(ROOT, 'data', 'video-discovery-cache.json');
const CACHE_SCHEMA_VERSION = 1;
const CACHE_SEGMENT_SECONDS = 30;
const MAX_CACHE_QUERY_SECONDS = 180;
const MAX_OBSERVATIONS_PER_SAMPLE = 30;
const MAX_OBSERVATIONS_PER_SEGMENT = 160;
const MAX_SAMPLE_RECORDS_PER_SEGMENT = 120;
const MAX_LOCAL_VIDEO_RECORDS = 50;
const MAX_LOCAL_CACHE_BYTES = 15 * 1024 * 1024;
const CACHE_COLLECTION = 'videoDiscoveryCache';

let firestoreClient;
let firestoreLoadError;
let firestoreHealthCache = { checkedAt: 0, status: null };

function cleanText(value, maxLength = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeVideoIdentity(videoId, durationSeconds) {
  const id = String(videoId || '').trim();
  const duration = Number(durationSeconds);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('A valid YouTube video ID is required for shared discovery caching.');
  if (!Number.isFinite(duration) || duration < 1 || duration > 24 * 60 * 60) throw new Error('A finite YouTube video duration is required for shared discovery caching.');
  const durationSecondsRounded = Math.round(duration);
  const videoKey = crypto.createHash('sha256').update(`youtube:${id}:${durationSecondsRounded}`).digest('hex');
  return { videoId: id, durationSeconds: durationSecondsRounded, videoKey };
}

function normalizeConfidence(value) {
  const confidence = String(value || '').toLowerCase();
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low';
}

function normalizeBBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map(Number);
  if (!bbox.every(Number.isFinite) || bbox.some(part => part < 0 || part > 1) || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return null;
  return bbox.map(part => Math.round(part * 10000) / 10000);
}

function normalizeObservation(item, metadata) {
  const label = cleanText(item?.label, 120);
  const bbox = normalizeBBox(item?.bbox);
  if (!label || !bbox) return null;
  const brand = cleanText(item.brand, 100);
  const model = cleanText(item.model, 100);
  const visibleText = (Array.isArray(item.visibleText) ? item.visibleText : []).map(value => cleanText(value, 80)).filter(Boolean).slice(0, 8);
  const details = (Array.isArray(item.details) ? item.details : []).map(value => cleanText(value, 180)).filter(Boolean).slice(0, 8);
  const evidence = cleanText(item.evidence, 500);
  const searchQuery = cleanText(item.searchQuery, 200);
  const videoTime = Math.round(Number(metadata.videoTime) * 10) / 10;
  if (!Number.isFinite(videoTime) || videoTime < 0) return null;

  const visualSignature = [label.toLocaleLowerCase(), brand.toLocaleLowerCase(), model.toLocaleLowerCase(), ...visibleText.map(value => value.toLocaleLowerCase())].join('|');
  const boxSignature = bbox.map(value => Math.round(value * 25)).join(',');
  // Stable across users and sampling passes within the same 30-second video segment.
  const sampleSignature = `${segmentIndexFor(videoTime)}:${Math.floor(videoTime/5)}:${visualSignature}:${boxSignature}`;
  const observationId = crypto.createHash('sha256').update(`${metadata.videoKey}:${sampleSignature}`).digest('hex');

  return {
    id: observationId,
    // Firestore stores observations independently of their parent video
    // document, so every observation must carry its own identity as well.
    videoId: metadata.videoId,
    durationSeconds: metadata.durationSeconds,
    label,
    brand,
    model,
    identityConfidence: normalizeConfidence(item.identityConfidence),
    confidence: normalizeConfidence(item.confidence),
    foreground: item.foreground === true,
    visibleText,
    details,
    evidence,
    bbox,
    searchQuery,
    videoTime,
    segmentIndex: segmentIndexFor(videoTime),
    sampleIndex: Math.max(0, Math.floor(Number(metadata.sampleIndex) || 0)),
    sourceModel: cleanText(metadata.sourceModel, 100),
    promptVersion: cleanText(metadata.promptVersion, 40) || 'passive-v1',
    reviewState: 'candidate',
    observedAt: new Date().toISOString()
  };
}

function normalizeSample(input) {
  const identity = normalizeVideoIdentity(input?.videoId, input?.durationSeconds);
  const videoTime = Number(input.videoTime);
  if (!Number.isFinite(videoTime) || videoTime < 0 || videoTime > identity.durationSeconds + 5) throw new Error('The sample timestamp is outside the video duration.');
  const metadata = {
    ...identity,
    videoTime,
    sampleIndex: Math.max(0, Math.floor(Number(input.sampleIndex) || 0)),
    sourceModel: cleanText(input.sourceModel, 100),
    promptVersion: cleanText(input.promptVersion, 40) || 'passive-v1',
    sessionId: cleanText(input.sessionId, 80)
  };
  const allInputObservations = Array.isArray(input.objects) ? input.objects : [];
  const inputObservationCount = Math.max(allInputObservations.length, Number(input.inputObservationCount) || 0);
  const inputObservations = allInputObservations.slice(0, MAX_OBSERVATIONS_PER_SAMPLE);
  const observations = inputObservations
    .map(item => normalizeObservation(item, metadata))
    .filter(Boolean);
  return { ...identity, metadata, observations, inputObservationCount, discardedObservationCount: inputObservationCount - observations.length };
}

function segmentIndexFor(videoTime) {
  return Math.floor(Math.max(0, Number(videoTime) || 0) / CACHE_SEGMENT_SECONDS);
}

function mergeSegment(previous, sample, segmentIndex) {
  const segment = previous && typeof previous === 'object' ? previous : {
    segmentIndex,
    startSeconds: segmentIndex * CACHE_SEGMENT_SECONDS,
    observations: [],
    samples: []
  };
  const observations = new Map((Array.isArray(segment.observations) ? segment.observations : []).map(item => [item.id, item]));
  for (const observation of sample.observations) {
    const existing = observations.get(observation.id);
    if (existing) {
      // This is repeated sampling, not independent-user verification.
      observations.set(observation.id, { ...existing, repeatCount: Math.min(100, (Number(existing.repeatCount) || 1) + 1), lastObservedAt: new Date().toISOString() });
    } else if (observations.size < MAX_OBSERVATIONS_PER_SEGMENT) {
      observations.set(observation.id, { ...observation, repeatCount: 1 });
    }
  }
  const sampleId = crypto.createHash('sha256').update(`${sample.videoKey}:${sample.metadata.sessionId}:${sample.metadata.sampleIndex}:${Math.round(sample.metadata.videoTime * 10)}`).digest('hex');
  const samples = new Map((Array.isArray(segment.samples) ? segment.samples : []).map(item => [item.id, item]));
  if (!samples.has(sampleId) && samples.size < MAX_SAMPLE_RECORDS_PER_SEGMENT) {
    samples.set(sampleId, {
      id: sampleId,
      videoTime: Math.round(sample.metadata.videoTime * 10) / 10,
      sampleIndex: sample.metadata.sampleIndex,
      sourceModel: sample.metadata.sourceModel,
      promptVersion: sample.metadata.promptVersion,
      capturedAt: new Date().toISOString(),
      objectCount: sample.observations.length,
      inputObservationCount: sample.inputObservationCount,
      discardedObservationCount: sample.discardedObservationCount,
      complete: sample.discardedObservationCount === 0,
      reviewState: 'candidate'
    });
  }
  return {
    segmentIndex,
    startSeconds: segmentIndex * CACHE_SEGMENT_SECONDS,
    observations: [...observations.values()],
    samples: [...samples.values()],
    updatedAt: new Date().toISOString()
  };
}

function localReadAll() {
  try {
    const value = JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, 'utf8'));
    return value && typeof value === 'object' && value.schemaVersion === CACHE_SCHEMA_VERSION ? value.videos || {} : {};
  } catch { return {}; }
}

function localWriteAll(videos) {
  fs.mkdirSync(path.dirname(LOCAL_CACHE_FILE), { recursive: true });
  const retained = Object.entries(videos).sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || ''))).slice(0, MAX_LOCAL_VIDEO_RECORDS);
  const boundedVideos = Object.fromEntries(retained);
  const envelope = { schemaVersion: CACHE_SCHEMA_VERSION, updatedAt: new Date().toISOString(), videos: boundedVideos };
  let serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized) > MAX_LOCAL_CACHE_BYTES) {
    const segments = Object.entries(boundedVideos).flatMap(([videoKey, video]) => Object.entries(video.segments || {}).map(([segmentKey, segment]) => ({ videoKey, segmentKey, segment, updatedAt: String(segment.updatedAt || '') }))).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    let estimatedBytes = Buffer.byteLength(serialized);
    for (const entry of segments) {
      if (estimatedBytes <= MAX_LOCAL_CACHE_BYTES) break;
      delete boundedVideos[entry.videoKey].segments[entry.segmentKey];
      estimatedBytes -= Buffer.byteLength(JSON.stringify(entry.segment)) + 2;
      if (!Object.keys(boundedVideos[entry.videoKey].segments).length) delete boundedVideos[entry.videoKey];
    }
    serialized = JSON.stringify(envelope);
  }
  const temp = `${LOCAL_CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, serialized);
  fs.renameSync(temp, LOCAL_CACHE_FILE);
}

function getFirestore() {
  if (firestoreClient) return firestoreClient;
  if (firestoreLoadError) throw firestoreLoadError;
  try {
    const { Firestore } = require('@google-cloud/firestore');
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || undefined;
    const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '(default)').trim();
    firestoreClient = new Firestore({ ...(projectId ? { projectId } : {}), databaseId });
    return firestoreClient;
  } catch (error) {
    firestoreLoadError = error;
    throw error;
  }
}

async function checkFirestoreConnection() {
  if (String(process.env.VIDEO_CACHE_BACKEND || '').trim().toLowerCase() !== 'firestore') {
    return { configured: false, connected: false, status: 'not-configured' };
  }
  if (firestoreHealthCache.status && Date.now() - firestoreHealthCache.checkedAt < 30_000) return firestoreHealthCache.status;
  try {
    const db = getFirestore();
    await db.collection(CACHE_COLLECTION).limit(1).get();
    firestoreHealthCache = { checkedAt: Date.now(), status: { configured: true, connected: true, status: 'connected' } };
  } catch (error) {
    firestoreHealthCache = { checkedAt: Date.now(), status: { configured: true, connected: false, status: 'error', error: cleanText(error?.message || error, 240) } };
  }
  return firestoreHealthCache.status;
}

function configuredBackend() {
  const requested = String(process.env.VIDEO_CACHE_BACKEND || '').trim().toLowerCase();
  if (requested === 'firestore') return 'firestore';
  if (requested === 'file') return 'file';
  return process.env.K_SERVICE ? 'firestore' : 'file';
}

async function appendVideoSample(input, { backend: backendOverride } = {}) {
  const sample = normalizeSample(input);
  const segmentIndex = segmentIndexFor(sample.metadata.videoTime);
  const segment = mergeSegment(null, sample, segmentIndex);
  const backend = backendOverride || configuredBackend();

  if (backend === 'firestore') {
    const db = getFirestore();
    const root = db.collection(CACHE_COLLECTION).doc(sample.videoKey);
    await root.set({schemaVersion:CACHE_SCHEMA_VERSION,videoId:sample.videoId,durationSeconds:sample.durationSeconds,updatedAt:new Date().toISOString()},{merge:true});
    const sampleId=crypto.createHash('sha256').update(`${sample.videoKey}:${sample.metadata.sessionId}:${sample.metadata.sampleIndex}:${Math.round(sample.metadata.videoTime*10)}`).digest('hex');
    const coverageRef=root.collection('coverage').doc(sampleId);
    const writes=[coverageRef.set({id:sampleId,videoTime:Math.round(sample.metadata.videoTime*10)/10,segmentIndex,sampleIndex:sample.metadata.sampleIndex,sourceModel:sample.metadata.sourceModel,promptVersion:sample.metadata.promptVersion,capturedAt:new Date().toISOString(),objectCount:sample.observations.length,inputObservationCount:sample.inputObservationCount,discardedObservationCount:sample.discardedObservationCount,complete:sample.discardedObservationCount===0,reviewState:'candidate'},{merge:true})];
    // Each candidate has its own transaction document; unrelated objects never contend on one segment document.
    for(const observation of sample.observations){
      const ref=root.collection('observations').doc(observation.id);
      writes.push(db.runTransaction(async transaction=>{
        const snapshot=await transaction.get(ref);const current=snapshot.exists?snapshot.data():null;
        const variant={evidence:observation.evidence,searchQuery:observation.searchQuery,details:observation.details,sourceModel:observation.sourceModel,promptVersion:observation.promptVersion};
        const variants=Array.isArray(current?.evidenceVariants)?current.evidenceVariants:[];
        const duplicate=variants.some(item=>item.evidence===variant.evidence&&item.searchQuery===variant.searchQuery);
        const evidenceVariants=(duplicate?variants:[...variants,variant]).slice(-8);
        transaction.set(ref,{...(current||observation),id:observation.id,videoId:observation.videoId,videoTime:current?.videoTime??observation.videoTime,segmentIndex:observation.segmentIndex,firstSeenVideoTime:current?.firstSeenVideoTime??observation.videoTime,lastSeenVideoTime:Math.max(Number(current?.lastSeenVideoTime)||0,observation.videoTime),contributionCount:Math.min(1000,Math.max(Number(current?.contributionCount)||0,evidenceVariants.length)),evidenceVariants,reviewState:current?.reviewState==='disputed'?'disputed':'candidate',...(current?.reportCount?{reportCount:current.reportCount,latestReportReason:current.latestReportReason,lastReportedAt:current.lastReportedAt}:{})},{merge:true});
      }));
    }
    await Promise.all(writes);
  } else {
    const videos = localReadAll();
    const record = videos[sample.videoKey] || { videoId: sample.videoId, durationSeconds: sample.durationSeconds, segments: {} };
    record.segments[String(segmentIndex)] = mergeSegment(record.segments[String(segmentIndex)], sample, segmentIndex);
    record.updatedAt = new Date().toISOString();
    videos[sample.videoKey] = record;
    localWriteAll(videos);
  }
  return { stored: true, videoKey: sample.videoKey, segmentIndex, observationCount: sample.observations.length, inputObservationCount: sample.inputObservationCount, discardedObservationCount: sample.discardedObservationCount, backend };
}

async function readVideoRange({ videoId, durationSeconds, fromSeconds = 0, toSeconds = 120 }, { backend: backendOverride } = {}) {
  const identity = normalizeVideoIdentity(videoId, durationSeconds);
  const from = Math.max(0, Number(fromSeconds) || 0);
  const to = Math.max(from, Number(toSeconds) || from);
  if (to - from > MAX_CACHE_QUERY_SECONDS) throw new Error(`Cache reads are limited to ${MAX_CACHE_QUERY_SECONDS} seconds per request.`);
  const firstSegment = segmentIndexFor(from);
  const lastSegment = segmentIndexFor(to);
  let segments = [];

  if ((backendOverride || configuredBackend()) === 'firestore') {
    const db = getFirestore();
    const root = db.collection(CACHE_COLLECTION).doc(identity.videoKey);
    const [rootSnapshot, segmentSnapshot, observationSnapshot, coverageSnapshot] = await Promise.all([
      root.get(),
      root.collection('segments').where('segmentIndex', '>=', firstSegment).where('segmentIndex', '<=', lastSegment).orderBy('segmentIndex').get(),
      root.collection('observations').where('videoTime','>=',Math.max(0,from-CACHE_SEGMENT_SECONDS)).where('videoTime','<=',to+CACHE_SEGMENT_SECONDS).get(),
      root.collection('coverage').where('videoTime','>=',Math.max(0,from-CACHE_SEGMENT_SECONDS)).where('videoTime','<=',to+CACHE_SEGMENT_SECONDS).get()
    ]);
    segments = segmentSnapshot.docs.map(doc => doc.data());
    if(observationSnapshot.size||coverageSnapshot.size)segments.push({observations:observationSnapshot.docs.map(doc=>doc.data()),samples:coverageSnapshot.docs.map(doc=>doc.data())});
    return normalizeRangeResponse(identity, rootSnapshot.exists ? rootSnapshot.data() : null, segments, from, to);
  }

  const record = localReadAll()[identity.videoKey] || null;
  if (record) segments = Object.values(record.segments || {}).filter(segment => segment.segmentIndex >= firstSegment && segment.segmentIndex <= lastSegment);
  return normalizeRangeResponse(identity, record, segments, from, to);
}

async function reportObservation({ videoId, durationSeconds, observationId, segmentIndex, reason = '' }, { backend: backendOverride } = {}) {
  const identity = normalizeVideoIdentity(videoId, durationSeconds);
  const id = String(observationId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('A valid cached observation ID is required.');
  const safeReason = cleanText(reason, 240);
  const backend = backendOverride || configuredBackend();
  const update = segment => {
    if (!segment) return null;
    const observations = Array.isArray(segment.observations) ? segment.observations : [];
    const index = observations.findIndex(item => item.id === id);
    if (index < 0) return null;
    const current = observations[index];
    const reports = Math.min(100, (Number(current.reportCount) || 0) + 1);
    observations[index] = {
      ...current,
      reviewState: 'disputed',
      reportCount: reports,
      ...(safeReason ? { latestReportReason: safeReason } : {}),
      lastReportedAt: new Date().toISOString()
    };
    segment.observations = observations;
    segment.updatedAt = new Date().toISOString();
    return segment;
  };

  if (backend === 'firestore') {
    const db = getFirestore();
    const root = db.collection(CACHE_COLLECTION).doc(identity.videoKey);
    const observationRef=root.collection('observations').doc(id);
    const direct=await db.runTransaction(async transaction=>{const snapshot=await transaction.get(observationRef);if(!snapshot.exists)return false;const current=snapshot.data();transaction.set(observationRef,{...current,reviewState:'disputed',reportCount:Math.min(100,(Number(current.reportCount)||0)+1),...(safeReason?{latestReportReason:safeReason}:{}),lastReportedAt:new Date().toISOString()},{merge:true});return true;});
    if(direct)return {reported:true,reviewState:'disputed',backend};
    const segmentRef = root.collection('segments').doc(String(Math.max(0, Math.floor(Number(segmentIndex) || 0))).padStart(8, '0'));
    const result = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(segmentRef);
        if (!snapshot.exists) return false;
        const segment = update(snapshot.data());
        if (!segment) return false;
        transaction.set(segmentRef, segment);
        return true;
      });
    if (result) return { reported: true, reviewState: 'disputed', backend };
  } else {
    const videos = localReadAll();
    const record = videos[identity.videoKey];
    if (record) {
      for (const [key, value] of Object.entries(record.segments || {})) {
        const segment = update(value);
        if (segment) {
          record.segments[key] = segment;
          record.updatedAt = new Date().toISOString();
          localWriteAll(videos);
          return { reported: true, reviewState: 'disputed', backend };
        }
      }
    }
  }
  return { reported: false, reason: 'Cached observation was not found.', backend };
}

function normalizeRangeResponse(identity, root, segments, fromSeconds, toSeconds) {
  const unique = new Map();
  for (const segment of segments) {
    for (const observation of Array.isArray(segment.observations) ? segment.observations : []) {
      if (observation.videoTime < fromSeconds - CACHE_SEGMENT_SECONDS || observation.videoTime > toSeconds + CACHE_SEGMENT_SECONDS) continue;
      if (!unique.has(observation.id)) unique.set(observation.id, observation);
    }
  }
  const observations = [...unique.values()].sort((a, b) => a.videoTime - b.videoTime);
  const coverage = segments.flatMap(segment => (segment.samples || []).map(sample => ({
    videoTime: sample.videoTime,
    objectCount: sample.objectCount,
    inputObservationCount: sample.inputObservationCount,
    discardedObservationCount: sample.discardedObservationCount,
    complete: typeof sample.complete === 'boolean' ? sample.complete : undefined,
    reviewState: sample.reviewState,
    capturedAt: sample.capturedAt,
    sourceModel: sample.sourceModel
  }))).sort((a, b) => a.videoTime - b.videoTime);
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    videoId: identity.videoId,
    durationSeconds: identity.durationSeconds,
    fromSeconds,
    toSeconds,
    cacheHit: Boolean(root && segments.length),
    updatedAt: root?.updatedAt || null,
    coverage,
    observations
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  CACHE_SEGMENT_SECONDS,
  MAX_CACHE_QUERY_SECONDS,
  normalizeVideoIdentity,
  checkFirestoreConnection,
  normalizeSample,
  appendVideoSample,
  readVideoRange,
  reportObservation
};
