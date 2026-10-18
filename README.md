# ContextStream

ContextStream is a consent-first YouTube discovery companion. It supports user-triggered analysis of one visible frame and a bounded visual session that samples up to five frames, at least 20 seconds apart. Gemini identifies visible objects and returns tight object boxes. Selecting an object searches its crop through available Lens and Shopping providers alongside one general-web search provider. If a box needs recovery, the original user-captured frame is retained for up to 10 minutes so the extension can crop the focused item; Lens still accepts only an object crop. The general-web providers are shuffled and tried sequentially until one returns acceptable results; they are not all merged together. Results are deduplicated, ranked, and shown with their retrieval sources. They are not a retailer-authorized catalog: retailer pages remain the source of truth for exact item identity, price, stock, and availability.

The visual session is finite, user-started, and visual-only. It stops after five samples, pauses on capture/analysis failure, and can be paused or stopped by the viewer. Repeated detections are coalesced within the session; up to 20 discoveries are shown with their first-seen video timestamp. Session samples skip the separate background audit; the original frame is kept in server memory for up to 10 minutes only to recover a selected-object crop. Object crops remain in extension memory so a selected discovery can still be searched. The extension does not analyze continuously without a session, and no transcript or audio is ingested. Profiles can save location, budget, interests, discovery intent, and open-ended context. Follow-up turns retain recent conversation and the latest results for the selected object until another object is selected or the page is unloaded. With discovery history explicitly enabled, selecting an object saves its name and source YouTube link so it can be revisited on the website. Transcript-based active discovery, speech-to-object alignment, durable deployment, and the controlled product catalog are not implemented yet.

## Requirements

- Node.js 20+
- Brave or Chrome
- Gemini API key from Google AI Studio
- Brave Search API key for broad web results
- Optional SerpApi key for visual Google Lens matching and structured Google Shopping offers

## Run locally

Start the local server, then use the Provider key pool on the profile website to add credentials without putting them in source files or environment variables:

```powershell
npm start
```

Open `http://localhost:8080`, scroll to **Provider key pool**, and add Gemini, Brave Search, and SerpApi keys as needed. There is no configured-key count limit. Use the same **Quota group** for keys that share a project/account limit; use a different group for a separate authorized quota pool. Credentials are encrypted into ignored files under `data/`, shown only as masked suffixes, and never sent to YouTube. Cloud Run does not expose this local manager; configure deployed credentials with Secret Manager. Existing `GEMINI_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `SERPAPI_API_KEY` environment variables remain supported.

Then:

1. Visit `http://localhost:8080`, save optional preferences, and copy the profile code shown after saving.
2. Open `brave://extensions` (or `chrome://extensions`), enable Developer mode, select **Load unpacked**, and choose this project's `extension` directory.
3. Open a YouTube watch page, click the ContextStream toolbar icon, and choose **Analyze this frame** for a one-off scan or **Start visual session** for the bounded multi-frame session. The toolbar action grants temporary access to the current tab. The page panel also provides session start, pause, and stop controls.
4. In the page panel, open **Connect optional preferences** and enter the profile code. Select an identified object to fetch live web results. Asking about cheaper, similar, color, or local options keeps the selected object in context. Local search results do not verify store stock; check the retailer page or contact the seller.

Gemini provides visual analysis, intent planning, evidence reranking, and optional Google Search grounding. `GEMINI_MODEL_PROFILE=compromise` is active by default and starts with Gemini 3.5 Flash-Lite, the model that responded quickly in the latest captured run; `GEMINI_MODEL_PROFILE=recommended` selects the quality/speed-first order. The selected profile is used by vision, text, reranking, and grounded-search fallback chains. Grounding can be disabled with `GEMINI_GROUNDED_SEARCH=false`. The local grounding-call cap is recorded in `data/grounded-search-usage.json`; it does not measure account-wide quotas or guarantee free use. The model chain is attempted across eligible Gemini quota groups before moving to the next model. Brave and SerpApi similarly rotate through configured groups after errors or cooldowns. This does not bypass provider quotas: keys sharing one project/account must share one quota group. Local monthly safety caps are per quota group; adjust `BRAVE_LOCAL_MONTHLY_CALL_LIMIT` and `SERPAPI_LOCAL_MONTHLY_CALL_LIMIT` only after checking the real provider account limits. SerpApi's image upload limit remains 500 KB; the crop encoder keeps the original dimensions when possible and only compresses or resizes enough to meet that provider ceiling. Google Lens prefers a validated selected-object crop. Only when crop preparation or caching fails, the extension sends a compressed full-frame fallback with a focused query naming the selected item and instructing Lens to ignore other scene content. This fallback is explicitly tagged and archived separately. Frame capture now first draws the decoded YouTube video at its available native resolution; if the browser blocks that canvas read, it falls back to a tab stream cropped to the YouTube player. Original PNG captures and any compressed/resized payloads are archived alongside every image sent to Gemini and Lens. For debugging, these images are archived locally in `data/image-captures/<videoId>/<sessionId>/`, with a JSON sidecar and per-session `manifest.jsonl` identifying the provider, model, purpose, video, frame time, and item when known. This archive is persistent and is not automatically pruned; delete `data/image-captures/` when you want to remove the captured images and metadata. The directory is excluded from Git and is not served by the web app. Temporary working frames remain in memory for up to 10 minutes. [SerpApi pricing](https://serpapi.com/pricing) · [Image upload limits and retention](https://serpapi.com/image-api) · [Google Lens API](https://serpapi.com/google-lens-api) · [Google Shopping API](https://serpapi.com/google-shopping-api).

The optional maximum price is added as a search constraint. A "cheaper" follow-up uses a visible reference price when a listing provides one; otherwise it searches price-oriented alternatives without claiming a proven price comparison. Search snippets may be incomplete or stale; check current price, stock, and delivery details on the retailer page.

## API

- `GET /api/health`
- `GET /api/search?q=backpack&profileId=...&brand=...&visibleText=...`
- `GET|POST /api/profile`
- `GET|POST|DELETE /api/discoveries` (history is opt-in per profile)
- `POST /api/analyze` with `{image: dataUrl, maxPrice?: number, sessionSample?: boolean, captureContext?: object}`. Session samples skip the background audit. Images sent to Gemini and Lens are archived locally by video/session ID for debugging.
- `POST /api/followup` with `{profileId, object, question, messages?, listings?, referencePrice?}`; a general intent planner uses the selected item, recent conversation, current listings, and saved profile. A profile's current location and budget are loaded server-side for every search.
- `GET|POST /api/provider-keys` and `DELETE /api/provider-keys/:id` for local, encrypted provider key management (disabled on Cloud Run).

## Current limits

### Developer activity log

The backend appends structured JSON Lines events to `data/activity.jsonl`, including HTTP requests and outcomes, model/provider calls, search queries and ranked listings, workflow decisions, UI actions, and errors. API keys, bearer tokens, and captured frame image data are redacted or excluded. While the server is running, inspect the latest 300 events at `http://localhost:8080/api/debug/logs`; use `?limit=1000` for more. For a live PowerShell tail, run `Get-Content .\data\activity.jsonl -Wait`. This is a local development log and grows until you clear or archive the file.


- Results are live general web-search matches, not a retailer-authorized structured commerce feed. No product facts are fabricated, but a search result can still be an imperfect match.
- Only visual scene discovery is active. ContextStream does not yet ingest YouTube transcripts or claim that the creator discussed a detected object.
- The extension analyzes individual frames only after the viewer starts a one-off scan or a bounded visual session. It does not monitor playback continuously; the session is capped at five samples and does not use transcripts or audio.
- Profiles and opt-in selected-object history are saved in local JSON files. They persist across local server restarts but are not suitable for multi-instance deployment or durable Cloud Run storage.
- Cloud Run deployment remains pending. The local search-usage counter must move to shared persistent storage before deploying multiple instances.
- Brave Search currently provides $5 in monthly credits at $5 per 1,000 Search requests. The app's 900-request monthly cap is a local guardrail; it does not apply across other apps using the same Brave account.
