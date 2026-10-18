# ContextStream

**Stay in the video. Follow your curiosity.** ContextStream is a YouTube companion that helps you identify and explore visible objects while you watch. Start a one-frame scan or a visual session when you choose; playback is not analyzed by default.

| | |
|---|---|
| **Live prototype** | [contextstream-fwci3cdaba-el.a.run.app](https://contextstream-fwci3cdaba-el.a.run.app/) |
| **Get the browser extension** | [Download ContextStream for Chrome or Brave](https://contextstream-fwci3cdaba-el.a.run.app/downloads/contextstream-extension.zip) |

The prototype is hosted on Google Cloud Run. The extension is currently installed manually; it is not listed in the Chrome Web Store.

## Try ContextStream

1. Open the [prototype site](https://contextstream-fwci3cdaba-el.a.run.app/) and download the extension ZIP.
2. Unzip it. In Chrome, open `chrome://extensions`; in Brave, open `brave://extensions`.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open the extension’s settings and set its service address to `https://contextstream-fwci3cdaba-el.a.run.app`.
5. Open a YouTube video. Use **Analyze this frame** for a single scan, or start a visual session and pause or stop whenever you like.

The extension requests access to YouTube for capture and to the ContextStream service for analysis. Keep the extracted extension folder in place while using it; the browser loads the extension from that folder.

## How it works

- **You choose when it runs.** A one-frame scan is user-triggered. A visual session must be started by the viewer and can be paused or stopped at any time.
- **Local visual tracking helps focus analysis.** During a session, a bundled MediaPipe EfficientDet Lite0 detector checks decoded video frames locally. New candidate objects are cropped and sent for focused analysis. A broader scene pass and visual-change fallback help cover objects outside the detector’s fixed class list.
- **Explore a find.** Gemini analyzes visible objects and their context. Selecting an object can retrieve live web listings through the configured search providers, including visual matching and shopping search when available. Results are suggestions; retailer pages are the source of truth for identity, price, stock, and delivery.
- **Reuse useful discoveries.** Device-local and optional shared video-cache metadata can help avoid repeating analysis. Shared contributions are opt-in. Cached candidates are provisional and can be reported as incorrect.
- **Personalize if you want.** Optional preferences can tailor relevance and follow-up answers. You can use the extension without saving preferences.

## Privacy at a glance

- ContextStream does not ingest YouTube audio or transcripts.
- Video frames are processed for the scan or session you start. Frames and focused crops may be sent to the configured analysis provider and are archived on the backend for diagnostics; the Cloud Run filesystem is temporary, so these archives are not durable. Do not use the prototype with sensitive video content.
- The optional shared Firestore cache stores generic discovery metadata such as candidate labels, approximate times, and boxes. It does not store frames, profile IDs, or personalization preferences.
- Saving discovery history is optional. Preferences and history are handled by the application backend; this prototype does not provide durable multi-user account storage.

## Built with

- **Firebase Authentication** verifies requests from the browser extension.
- **Cloud Run** hosts the web experience and API.
- **Firestore** provides the opt-in shared video-discovery cache.
- **Gemini** analyzes selected frames and objects, supports follow-up questions, and can help rank findings.
- **MediaPipe** runs the bundled object detector locally in the browser.

Search and visual-shopping providers are configurable on the backend. Their availability depends on the deployed provider credentials and provider limits.

## Run locally

Requirements: Node.js 20 or newer, a supported Chromium browser, and provider credentials for the features you want to use.

```powershell
npm ci
npm start
```

Open `http://localhost:8080`. In the extension settings, set the service address to `http://localhost:8080`. Configure provider credentials on the local profile page under **Developer tools and provider keys**. To use the shared Firestore cache locally, copy `.env.local.example` to `.env.local`, configure the project, and authenticate with Google Application Default Credentials. Keep credentials in local configuration or Secret Manager; do not commit them.

## Project layout

- `server.js`, `lib/` — web server, API, analysis, search, and shared-cache integration
- `public/` — prototype site and profile page
- `extension/` — browser extension, local detector, model, and MediaPipe runtime

## Known limits

- The local detector has a fixed set of object categories. Small, occluded, or unsupported objects can be missed; results are not guaranteed to be exhaustive.
- Search results can be imperfect or outdated. Check the retailer’s page before relying on a listing.
- The deployed prototype uses temporary Cloud Run storage for diagnostic files and some local application data. It is a working prototype, not a durable production service.
- The extension is distributed as a ZIP for manual installation and has not yet been published in the Chrome Web Store.
