# ContextStream: complete Cloud Run deployment

Follow this once, in order, to deploy the current ContextStream backend and profile site, connect the browser extension, and verify the complete user journey. The Cloud Run revision is created in Section 4; the complete browser deployment is ready after Section 6 passes. The code, Firebase project, Firestore cache, runtime identity, provider secrets, and Docker setup are already prepared.

This deployment uses one Cloud Run service in Mumbai (`asia-south1`), the existing Firestore `(default)` database, the `contextstream-run` service identity, Firebase Anonymous Authentication, and provider credentials from Secret Manager. Cloud Run must accept unauthenticated *platform-level* requests so a browser extension can reach it; the application verifies Firebase ID tokens on every `/api/*` route except `/api/health`. Keep that application check enabled.

## What this deployment delivers

- A public HTTPS URL serving the ContextStream profile site and backend API.
- One-frame analysis and user-started continuous visual monitoring from the browser extension.
- On-device object tracking, novelty checks, per-browser cache use, focused-object analysis and its crop-failure fallback.
- Gemini visual identification, available Lens/Shopping/web search, listing exploration, and contextual follow-up.
- Firebase-authenticated API calls and opt-in shared video candidate metadata in Firestore.
- Provider keys bound from Secret Manager, never copied into the extension or source.

This is a complete deployment of the current implemented product. It is deliberately configured as a single-instance service. Profiles, opt-in discovery history, some usage counters, diagnostic files, and captured-image archives still use local files/process memory; Cloud Run may discard them when an instance stops. Firestore holds the shared video cache, not those other records. Treat local profiles/history and local diagnostics as best-effort on the deployed service. Retail listings are third-party candidates, and detection is limited by the bundled detector's vocabulary.

## 1. Merge and update the deployment source

Review and manually merge [PR #2](https://github.com/Akhil-0190/ContextStream/pull/2) into `main`. Then open PowerShell in the repository and run:

```powershell
git switch main
git pull origin main
```

Confirm `DEPLOYMENT.md`, `Dockerfile`, `package-lock.json`, `extension/`, `public/`, and `lib/` exist. The source deployment uses the checked-in Dockerfile and builds from this merged source.

## 2. Sign in, choose the project, and enable APIs

Install or update Google Cloud CLI if needed. Sign into the Google account that owns or deploys the project:

```powershell
gcloud auth login
gcloud config set project ai-builder-cup-2026-512009
gcloud config get-value project
gcloud auth list
```

Confirm the active project is `ai-builder-cup-2026-512009` and the intended account is active. Enable the services used by the source build, runtime, secrets, database, and Firebase Auth (safe to run again):

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com --project=ai-builder-cup-2026-512009
```

If Google Cloud reports that the deploying account lacks permission, grant it the narrow deployment/build permissions required by the error and `roles/iam.serviceAccountUser` on the runtime identity. Do not create a service-account key or work around a permission error by sharing credentials.

## 3. Verify the prepared Firebase, Firestore, and secrets

In Cloud Console, confirm:

1. Firestore has the Standard Native `(default)` database in `asia-south1`, with restrictive client rules. The app uses `(default)`, not the separate named `contextstream` database.
2. Firebase Authentication → Sign-in method has **Anonymous** enabled.
3. Secret Manager contains enabled version `1` for each exact secret name below. Each contains its provider's actual key. Never paste a secret value into this guide, terminal command, source file, screenshot, or chat.

```text
GEMINI_API_KEY
BRAVE_SEARCH_API_KEY
SERPAPI_API_KEY
SEARCHAPI_API_KEY
SERPER_API_KEY
```

4. IAM contains the runtime service account `contextstream-run@ai-builder-cup-2026-512009.iam.gserviceaccount.com`. It needs `roles/datastore.user` on the project and `roles/secretmanager.secretAccessor` on each of the five secrets. These grants were set up during cloud preparation; verify them if the deployment or health check reports a permission error. No downloaded service-account key is used.
5. Billing is active. For a controlled first run, create a small Cloud Billing budget alert. A budget sends alerts; it is not a hard spend limit.

## 4. Deploy the service

From the repository root, run this PowerShell command. It builds the Dockerfile through Cloud Build, deploys the `contextstream` service, sets the runtime identity, references provider secrets at version `1`, and routes traffic to the new revision:

```powershell
gcloud run deploy contextstream `
  --source . `
  --project ai-builder-cup-2026-512009 `
  --region asia-south1 `
  --service-account contextstream-run@ai-builder-cup-2026-512009.iam.gserviceaccount.com `
  --allow-unauthenticated `
  --max 1 `
  --min 0 `
  --concurrency 10 `
  --memory 1Gi `
  --cpu 1 `
  --timeout 300 `
  --set-env-vars "FIREBASE_PROJECT_ID=ai-builder-cup-2026-512009,GOOGLE_CLOUD_PROJECT=ai-builder-cup-2026-512009,FIRESTORE_DATABASE_ID=(default),VIDEO_CACHE_BACKEND=firestore,GEMINI_MODEL_PROFILE=compromise" `
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:1,BRAVE_SEARCH_API_KEY=BRAVE_SEARCH_API_KEY:1,SERPAPI_API_KEY=SERPAPI_API_KEY:1,SEARCHAPI_API_KEY=SEARCHAPI_API_KEY:1,SERPER_API_KEY=SERPER_API_KEY:1"
```

Wait for the command to finish successfully and copy the HTTPS URL it prints, for example `https://contextstream-….asia-south1.run.app`. Do not continue with an error or failed revision; use Cloud Run → `contextstream` → Logs to inspect the startup or build failure.

The `--allow-unauthenticated` flag is required for browsers to reach the site and API. It does not grant application access: the server still requires a verified Firebase bearer token for API calls other than `/api/health`. Keep the one-instance cap because rate windows and non-cache state are not shared between instances. This cap reduces scale; it does not make local files durable or enforce a hard budget.

## 5. Connect Firebase Auth and the extension

1. In Firebase Console → Authentication → Settings → Authorized domains, add the exact Cloud Run hostname, without `https://` or a path; for example, `contextstream-abc123-uc.a.run.app`. Keep the existing Firebase domains.
2. Open the Cloud Run URL in a browser. Confirm the ContextStream profile site loads over HTTPS.
3. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave), enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` folder. If it was already installed, press the extension's reload button.
4. Open the extension popup and set **Service address** to the full Cloud Run URL (`https://…run.app`), then save it. The extension manifest already permits Cloud Run HTTPS hosts. Do not enter provider keys in the extension.
5. Open YouTube and the ContextStream panel. Confirm the app signs in anonymously. Optional profile preferences can be entered on the served profile page and connected in the panel.

## 6. Verify the complete deployed flow

In PowerShell, set the URL from the deploy output and inspect health:

```powershell
$serviceUrl = "PASTE_THE_CLOUD_RUN_HTTPS_URL_HERE"
$health = Invoke-RestMethod "$serviceUrl/api/health"
$health | Format-List
```

Confirm `ok`, `geminiConfigured`, `liveProductSearchConfigured`, `sharedVideoCacheConfigured`, `sharedVideoCacheConnected`, and `firebaseAuthConfigured` are `True`. The health endpoint reports configuration and connectivity only; it does not prove user authentication or the whole workflow.

Then use the extension on a YouTube video and verify each item:

1. **Single frame:** choose **Analyze this frame** and confirm detected objects appear.
2. **Continuous session:** start **Watch with ContextStream**, wait for new findings, then pause, resume, and stop. Confirm the UI remains interactive while the detector and analysis run.
3. **Explore:** select an item; confirm listings appear. Ask a follow-up question and confirm results remain associated with the selected object.
4. **Cache read:** replay a short portion or view a video with existing observations; confirm matching cached candidates can appear without forcing redundant provider analysis.
5. **Opt-in cache write:** turn on contribution before or during the session and allow a new object to be analyzed. In Firestore Studio choose `(default)` → `videoDiscoveryCache`; confirm a video entry and observation/coverage subcollections appear. No write is expected if sharing is off or no usable new candidate is found.
6. **Shared cache safeguards:** confirm the shared record contains candidate metadata only, and use the report action on a suspect cached observation to mark it disputed.
7. **Provider and runtime logs:** in Google Cloud Console open Cloud Run → `contextstream` → Logs. Confirm authenticated API requests and provider activity complete without secret values in logs. Use Billing and Monitoring to review actual charges.

Once those checks pass, the Cloud Run backend and website are deployed and the extension is connected. The local server is not needed for the deployed extension URL. Save the service URL and active revision name somewhere private for future operation. This installs the extension manually for your browser; Chrome Web Store publication is a separate distribution process.

## Updating or rolling back later

For a later release, merge the next PR into `main`, pull `main`, and rerun Section 4. Cloud Run keeps revisions. To roll back, open Cloud Run → Services → `contextstream` → Revisions → Manage traffic and route traffic to the previous known-good revision. Do not delete Firestore data to roll back application code.

To rotate a provider key, add a new Secret Manager version, grant the runtime service account access if needed, and deploy a revision with the new numeric secret version in `--set-secrets`. Avoid using `latest` for environment-variable secrets so a revision has a predictable configuration.

## Current operational boundaries

- Firestore is durable for shared video-cache observations. The server's profile/history JSON, some local usage/cooldown state, image archives, and file-based session diagnostics are not durable Cloud Run storage. They may disappear on restart. Cloud Logging receives console output, not the private files under `data/`.
- Per-account request limits are held in process memory. The one-instance setting limits the initial service footprint; it is not a distributed abuse/cost-control system.
- Captured source frames and crops are currently archived under local `data/` for debugging. On Cloud Run those files are ephemeral but can remain for the life of an instance. Do not describe them as never sent to or held by the backend: frames selected for analysis are sent to the backend/providers, and the current server writes diagnostic copies locally.
- Creator audio/transcripts are not processed. The local detector has a fixed class vocabulary; no system can guarantee every small, occluded, or uncommon object will be found.
- Product results come from third-party search sources and do not guarantee exact identity, current price, inventory, or delivery. Verify those details at the retailer.
- A Cloud Billing budget alert is not a hard spending cap. Check the free-trial balance, quotas, and provider billing before sustained use.

## Google Cloud references

- [Deploy source to Cloud Run](https://cloud.google.com/run/docs/deploying-source-code)
- [Configure Secret Manager secrets for Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Set maximum Cloud Run instances](https://cloud.google.com/run/docs/configuring/max-instances)
