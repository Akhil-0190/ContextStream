# ContextStream · 3-minute presentation script

**Target pace:** about 125–135 words per minute. Time cues are approximate; pause briefly between sections.

**Narration premise:** This script describes the deployed state after completing `DEPLOYMENT.md`.

### 0:00–0:25 · The idea

Think about noticing something in a video and wondering what it is, where to find it, or whether there are similar options. Usually, answering that means pausing, taking a screenshot, then searching manually.

ContextStream makes that moment easier. It helps viewers explore what catches their eye, while keeping the choice to analyze in their hands.

### 0:25–0:55 · The viewer stays in control

ContextStream is a browser extension for YouTube. A viewer can analyze one frame or start a visual session, then pause, resume, or stop whenever they want. Opening YouTube does not start analysis.

During a session, a compact object detector runs locally in the browser. It tracks objects and checks whether a candidate is new or has already been seen nearby. That helps avoid repeating analysis when the existing information is enough.

### 0:55–1:35 · Focused analysis

When a useful new candidate appears, the extension crops that object and sends the focused image to the ContextStream backend for visual identification. If a clean crop cannot be made, a fallback sends the frame with the target area identified, so the analysis can stay focused.

Results are candidates, supported by visual evidence and an approximate location in the frame. Detection is not perfect: the local detector has a fixed class list, so small, hidden, or uncommon objects can be missed. Broader frame analysis and a visual-change fallback improve coverage.

### 1:35–2:10 · From discovery to exploration

Select an object and ContextStream can search for visual matches, shopping listings, and general web results. Results appear in a paged view. Viewers can open a listing or ask a follow-up, such as finding a cheaper option or another style.

These are third-party listings, not guaranteed matches or verified inventory. Retailer pages remain the place to confirm current price, stock, and delivery.

### 2:10–2:40 · Cache and privacy

ContextStream keeps a device-local cache to reuse discoveries for that browser profile. Sharing is separate: viewers can opt in to contribute general candidate metadata to a shared Firestore cache. Frames and personal preferences are not written there. Suspect cached matches can be reported and excluded from future results.

Personal preferences are applied for each viewer when results are displayed, rather than stored in shared records.

### 2:40–3:00 · Close

The deployed service runs as a single-instance Cloud Run API in Mumbai. Firebase verifies API requests, Secret Manager supplies provider keys, and Firestore holds opt-in shared-cache metadata. Profiles and diagnostics remain instance-local.

ContextStream: curiosity, on your terms.
