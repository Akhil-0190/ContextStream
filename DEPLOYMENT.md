# Cloud Run deployment

This guide deploys the backend and profile website from the merged `main` branch to a **single-instance preview**. It does not make the current data model production-durable: profiles, opt-in discovery history, usage counters, image archives, and diagnostic logs are stored under `data/`, which is ephemeral on Cloud Run. Firestore is used for the shared video discovery cache only. Do not present this preview as durable multi-user production service.

The Cloud Run service must be publicly invokable because the browser extension cannot attach Google Cloud IAM credentials. The app itself verifies Firebase ID tokens on every `/api/*` route except `/api/health`; `/api/health` is intentionally public. Keep anonymous Firebase sign-in enabled and do not remove the app-level token check.

## Already prepared

- Google Cloud project: `ai-builder-cup-2026-512009` (Mumbai region: `asia-south1`).
- Firestore Standard, Native mode, `(default)` database in `asia-south1`, restrictive client rules.
- Firebase web app and Anonymous Authentication.
- Runtime service account: `contextstream-run@ai-builder-cup-2026-512009.iam.gserviceaccount.com`, intended to have `roles/datastore.user` and secret-level `roles/secretmanager.secretAccessor` on the five provider secrets.
- Secret Manager secrets: `GEMINI_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPAPI_API_KEY`, `SEARCHAPI_API_KEY`, and `SERPER_API_KEY`.
- Dockerfile and Cloud Run-aware server configuration.

Verify these in Cloud Console before deploying. No Cloud Run service/revision has been deployed by this preparation. The secret values must remain in Secret Manager; do not paste them in a command, source file, or chat.

## 1. Merge and get the source

After reviewing and merging the pull request into `main`, update your local checkout:

```powershell
git switch main
git pull origin main
```

Confirm `Dockerfile`, `package-lock.json`, and `DEPLOYMENT.md` are present. Do not deploy from the feature branch if you want the deployed revision to match the merged PR.

## 2. Authenticate and select the project

Install/update the Google Cloud CLI if needed, then run:

```powershell
gcloud auth login
gcloud config set project ai-builder-cup-2026-512009
gcloud config get-value project
gcloud auth list
```

The active project must be `ai-builder-cup-2026-512009` and the selected account must have Cloud Run deployment, Cloud Build, Artifact Registry, and `iam.serviceAccounts.actAs` permissions for the runtime service account.

Enable or verify the APIs (the command is safe to re-run):

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com --project=ai-builder-cup-2026-512009
```

If API enablement or deploy reports missing IAM permissions, grant only the required roles to the deploying account; do not grant Owner as a workaround.

## 3. Verify runtime access

In IAM, confirm the runtime identity is exactly:

```text
contextstream-run@ai-builder-cup-2026-512009.iam.gserviceaccount.com
```

It needs `roles/datastore.user` on the project and `roles/secretmanager.secretAccessor` on each of the five secrets. Do not create or download a service-account key. Cloud Run uses its attached service identity through Application Default Credentials.

Confirm every secret has an enabled version `1`. The deploy command pins version `1`, which gives a stable revision configuration. When rotating a provider key, add a new secret version and deploy a new revision referencing that version.

## 4. Deploy the one-instance preview

Run from the repository root after the PR is merged. This uses the checked-in Dockerfile and binds secret values into the container only at runtime:

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

`--allow-unauthenticated` allows the browser to reach the app; it does **not** disable application authentication. All application API routes other than health require a valid Firebase ID token. Do not remove that middleware or make the Cloud Run API private to IAM unless the browser client is redesigned to acquire Google IAM tokens.

The service starts with max 1 to limit the impact of process-local rate limits and local JSON state. This is a guardrail only: Cloud Run may briefly exceed configured maximums during scaling events, and a restart can lose ephemeral files. The service is not protected by a hard spending cap.

## 5. Verify the deployed service

Copy the HTTPS service URL printed by `gcloud run deploy`, then check health:

```powershell
$serviceUrl = "PASTE_HTTPS_CLOUD_RUN_URL_HERE"
Invoke-RestMethod "$serviceUrl/api/health"
```

Confirm `ok`, `geminiConfigured`, expected search-provider flags, `sharedVideoCacheConfigured`, `sharedVideoCacheConnected`, and `firebaseAuthConfigured` are true. Do not paste provider values into health checks; the endpoint reports booleans only.

Then:

1. Open the HTTPS service URL in a browser and confirm the profile page loads.
2. In Firebase Authentication settings, confirm Anonymous is enabled.
3. Open the extension popup, set **Service address** to the Cloud Run HTTPS URL, and save it. The extension already permits `*.run.app` hosts. Open a YouTube watch page and sign in anonymously through the extension.
4. Run one single-frame analysis, then a short visual session with shared-cache contribution opted in. Confirm results, follow-up search, pause/stop, and the global cache connection.
5. In Firestore Studio, inspect `(default)` → `videoDiscoveryCache` for a video document and its observation/coverage subcollections. Writes occur only for explicit opt-in samples.
6. Check Cloud Run logs and Billing/Monitoring after the smoke check. Set a billing budget alert before inviting other users; budgets alert but do not cap spending.

Use `/api/health` as a configuration check, not as proof the full user journey works. A real authenticated request and the Firestore smoke check are still required.

## Rollback

To switch traffic to a prior revision, list revisions and update traffic in the Cloud Run console, or use:

```powershell
gcloud run revisions list --service contextstream --region asia-south1 --project ai-builder-cup-2026-512009
```

Then choose the known-good revision in Cloud Run → Services → `contextstream` → Revisions → Manage traffic. Do not delete Firestore documents as part of an application rollback.

## Before calling it production-ready

- Move profiles and opt-in history to user-scoped durable storage with verified ownership; migrate away from profile codes as authorization.
- Move usage/cost limits to a shared durable limiter, and define abuse prevention and retention.
- Decide whether captured-frame archives and diagnostics should be disabled in production or moved to controlled, expiring object storage. They are local-only today and will not persist on Cloud Run.
- Validate Firebase API-key restrictions and authorized domains for the deployed web app and extension.
- Add billing alerts and monitor actual Firestore, model, and search-provider charges.
- Revisit the unused named Firestore database `contextstream`; do not delete it until confirming it contains no needed records.
- Run a complete authenticated smoke session after every deployment and review logs for provider errors, failed searches, and cache behavior.

## References

- [Deploy from source to Cloud Run](https://cloud.google.com/run/docs/deploying-source-code)
- [Configure Secret Manager secrets for Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Set Cloud Run maximum instances](https://cloud.google.com/run/docs/configuring/max-instances)
