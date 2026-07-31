# Adobe I/O Setup Guide (First-Time Walkthrough)

**For:** Max — standing up the Adobe I/O App Builder project that the GMC Feed Sync service (`GMC-Feed-Sync-Handoff.md`) deploys to.
**Assumes:** You have Developer or System Administrator role in your Adobe org (you said you do), a terminal, and internet access.

This is the infrastructure setup. The application code lives in the handoff doc; this guide gets you a working, deployable Adobe I/O project to drop that code into.

---

## 0. The mental model (read this first)

Four things, four roles. They are easy to conflate:

| Thing | What it is | Where it lives |
|---|---|---|
| **Adobe Developer Console** | The **web UI** where you create a *project*, pick *workspaces*, and add *services* (like Runtime). It's where credentials and namespaces are provisioned. | Browser: `console.adobe.io` (redirects to `developer.adobe.com/console`) |
| **App Builder** | Adobe's **framework** for building apps that run on I/O Runtime — the project template, SDK, and conventions. | A project *type* in the Console |
| **Adobe I/O Runtime** | The **serverless compute** where your Node.js actions actually execute. Part of App Builder. | Adobe's cloud |
| **`aio` CLI** | The **command-line tool** that scaffolds the project locally, deploys your code to Runtime, and shows logs. | Your terminal |

Flow: you create a **project + workspace** in the **Console** (web) → you scaffold and deploy code to that workspace's **Runtime namespace** using the **`aio` CLI** (terminal). The Console is the control plane; the CLI is how you ship code to it.

(Reminder from the main answer: this is all separate from Google/GCP. Your Google credential just gets stored here as an encrypted variable so your Adobe-hosted code can call Google.)

---

## 1. Prerequisites

- **Node.js** — install a current LTS (Node 20 or 22). Check: `node -v`. (Node 18 is end-of-life; use 20+.)
- **npm** — comes with Node. Check: `npm -v`.
- **Adobe org access with the right role** — namespace/Runtime management requires **Developer** or **System Administrator** in the Adobe Admin Console for your org. (You have this.)

---

## 2. Install the `aio` CLI and log in

```bash
# Install globally
npm install -g @adobe/aio-cli

# Verify
aio --version

# Log in (opens a browser for Adobe IMS sign-in)
aio login
# If it logs you into the wrong org, force a fresh prompt:
aio login -f

# Confirm which org you're in
aio where
```

`aio where` should show the org you intend to build in. If it's wrong, `aio login -f` and pick the right one.

---

## 3. Create the project in the Developer Console (web UI)

1. Go to **`https://console.adobe.io`** (redirects to `developer.adobe.com/console`) and sign in.
2. **Top-right dropdown → select the correct Organization.** (Everything you create lands in the selected org.)
3. Click **Create new project → Project from template**.
4. Choose the **App Builder** template.
5. Set a descriptive **Project title** (e.g. `GMC Feed Sync`) and **App name** (e.g. `gmc-feed-sync`). Leave **"Include Runtime with each workspace"** checked.
6. Click **Save**.

You now have a project with (by default) **two workspaces: `Stage` and `Production`**, each with its own Runtime namespace. (You can add more workspaces later, e.g. a personal `dev` one, with **Add workspace**.)

7. Open a workspace (start with **Stage**). If Runtime isn't already attached, click **Add service → Runtime** in that workspace.

That's the whole Console setup. You do **not** need to add any Adobe product APIs for this project — your actions mainly call Google, so the Runtime namespace is all you need. (If a later feature pulls the export from Adobe storage/DA and needs Adobe API access, you'd add an **OAuth Server-to-Server** credential then — note: JWT credentials are deprecated, use OAuth Server-to-Server.)

---

## 4. Scaffold the app locally

```bash
# Make a folder and enter it (this becomes your repo)
mkdir gmc-feed-sync && cd gmc-feed-sync

# Initialize — the CLI reads your Console project
aio app init
```

You'll be prompted:

1. **Select Org** → your org.
2. **Select Project** → `GMC Feed Sync`.
3. **Select Workspace** → `Stage` (start here). The CLI downloads a `console.json` with this workspace's credentials.
4. **Which extension point(s)?** → For a headless backend service, you do **not** need an Experience Cloud SPA or Asset Compute worker. If offered a **standalone app / "no extension"** option, choose it. (If the CLI forces an extension choice, pick the generic/standalone one — you can delete unused UI later.)
5. **Which Adobe I/O App features do you want to enable?** → select **Actions** (this is the one you need). You can also enable **CI/CD** (adds GitHub Actions workflows — handy for deploying with secrets later). You can skip **Web Assets** and **Events** for a pure backend, though a minimal web UI is harmless if it's added.

The CLI installs npm deps and generates the project. Expect files like:

```
gmc-feed-sync/
  app.config.yaml     # the manifest (you'll replace this with the handoff §8 version)
  package.json
  .env                # auto-filled with AIO_runtime_namespace, AIO_runtime_auth — gitignored
  .aio                # workspace/CLI state — gitignored
  console.json        # workspace credentials — gitignored
  README.md
  src/ (or actions/)  # sample action(s) — you'll replace with the real actions
  test/  e2e/
```

Open it in VS Code (`code .`). Note that `.env`, `.aio`, and `console.json` are already in `.gitignore` — **keep it that way**; they contain credentials.

---

## 5. Wire up your secrets (the important part)

Adobe's pattern: real secret **values** go in `.env` (gitignored); the manifest references them as `$VAR`; the action reads them from its `params` at runtime (**not** `process.env` — see handoff §7).

1. Add your GMC placeholders to `.env` (alongside the auto-added `AIO_runtime_*` lines):

```
GMC_SERVICE_ACCOUNT_JSON=__COMPLETE_ONE_LINE_JSON_KEY__
GMC_SERVICE_ACCOUNT_EMAIL=express-tools-gcp-account@adbe-gcp1060.iam.gserviceaccount.com
GMC_GCP_PROJECT_ID=adbe-gcp1060
GMC_MERCHANT_ACCOUNT_ID_TEST=__PLACEHOLDER__
GMC_MERCHANT_ACCOUNT_ID_PROD=__PLACEHOLDER__
GMC_DATASOURCE_ID_TEST=
GMC_DATASOURCE_ID_PROD=
SLACK_WEBHOOK_URL=__PLACEHOLDER__
LOG_LEVEL=info
```

2. In `app.config.yaml`, each action declares these under `inputs:` as `$VAR` (the handoff doc §8 has the full manifest). Example shape:

```yaml
actions:
  sync-products:
    function: actions/sync-products/index.js
    web: 'yes'
    runtime: nodejs:22
    inputs:
      GMC_SERVICE_ACCOUNT_JSON: $GMC_SERVICE_ACCOUNT_JSON
      GMC_SERVICE_ACCOUNT_EMAIL: $GMC_SERVICE_ACCOUNT_EMAIL
      GMC_GCP_PROJECT_ID: $GMC_GCP_PROJECT_ID
      # ...rest per handoff §8
    annotations:
      require-adobe-auth: true
      final: true
```

At deploy, `aio` substitutes the `.env` values into the encrypted default parameters. `final: true` locks them so a caller can't override your secrets; `require-adobe-auth: true` means callers must present a valid IMS token.

3. Commit a **`.env.example`** with the keys but **no values** so teammates know what to fill.

---

## 6. Deploy and verify

Before wiring the real actions, confirm the pipeline works end to end.

```bash
# Run locally (gives a https://localhost:9080-style URL; Ctrl+C to stop)
aio app run

# Or stream logs live during dev
aio app dev

# Deploy to the selected workspace's Runtime namespace
aio app deploy
```

`aio app deploy` prints the deployed **web action URL(s)** — something like:
```
https://<namespace>.adobeioruntime.net/api/v1/web/gmc-feed-sync/sync-products
```
That URL is what the DA Document Generator browser tool will call (passing the IMS `Authorization` header + `x-gw-ims-org-id`). Save it.

Invoke an action directly from the CLI to sanity-check:
```bash
aio runtime action invoke gmc-feed-sync/sync-products \
  --param env test --param-file ./sample-chunk.json --result
```

---

## 7. Stage vs Production workspaces (map to test vs prod GMC)

Each workspace has its **own namespace and its own `.env`-driven secrets**. Recommended: **Stage workspace → GMC test account**, **Production workspace → GMC production account**.

Switch which workspace the CLI targets:
```bash
aio app use          # interactive: pick org/project/workspace (re-downloads console.json)
```
When you `aio app use` the Production workspace, populate that machine/CI with the **production** `.env` values (prod GMC account + data source IDs). Deploy again with `aio app deploy`.

**For CI/CD (recommended for prod):** don't keep prod secrets on a laptop. Store them as **GitHub Actions secrets** and let the generated CI workflow inject them at deploy time. The App Builder CI option (step 4) scaffolds this; map each `GMC_*` secret in the workflow.

---

## 8. Logs & debugging

```bash
aio app logs --limit 20                 # recent activation logs
aio runtime activation list             # list recent runs
aio runtime activation get <activation-id>   # full detail for one run
```
- `aio app dev` streams logs straight to your terminal (nothing stored) — best while iterating.
- Deployed runs are captured as activations; use `aio app logs` to read them.
- In action code, use the scaffold's `Core.Logger` and only log at `debug` for verbose output. **Never log secrets** — use the `redact` helper from handoff §15.

---

## 9. Optional: scheduling (only if you later want unattended runs)

The v1 design is on-demand (browser-triggered), so you can skip this. If you later want a nightly sync, use the OpenWhisk **Alarms** feed via a trigger + rule in `app.config.yaml`:

- `/whisk.system/alarms/interval` — every N minutes
- `/whisk.system/alarms/alarm` — cron string + timezone
- `/whisk.system/alarms/once` — one-time

(Known caveats: changing an alarm's cron sometimes needs deleting/recreating the trigger; test the schedule after deploy.)

---

## 10. Ops & security checklist

- [ ] `.env`, `.aio`, `console.json`, and any `*service-account*.json` are gitignored (they are by default — verify).
- [ ] `.env.example` committed with keys only, no values.
- [ ] Actions use `require-adobe-auth: true` and `final: true`.
- [ ] Consider `disable-download: true` on production actions once stable (**irreversible**).
- [ ] Stage and Production workspaces use different secrets (test vs prod GMC).
- [ ] Production secrets live in CI (GitHub Actions secrets), not on a laptop.
- [ ] Action code reads secrets from `params`, never `process.env`.
- [ ] Run Adobe's security audit on the repo before go-live.

---

## 11. Quick command reference

```bash
npm install -g @adobe/aio-cli     # install CLI
aio login  /  aio login -f        # sign in / force re-auth
aio where                         # show current org
aio console project list          # list your projects
aio app init                      # scaffold app from a Console project
aio app run                       # run locally
aio app dev                       # run locally, stream logs
aio app deploy                    # deploy to the workspace namespace
aio app use                       # switch org/project/workspace
aio app logs --limit N            # recent logs
aio runtime action invoke <pkg>/<action> --param k v --result
aio runtime activation list
aio runtime activation get <id>
```

---

## 12. Where to get help

- App Builder getting started: `developer.adobe.com/app-builder/docs/get_started/`
- Runtime setup: `developer.adobe.com/app-builder/docs/get_started/runtime_getting_started/setup`
- Configuration (`app.config.yaml`) reference: `developer.adobe.com/app-builder/docs/guides/app_builder_guides/configuration/configuration`
- Adobe's App Builder AI skills (for Claude Code / Cursor): `github.com/adobe/skills` — reference these in your prompt so the coding agent uses correct App Builder patterns (e.g. "Using the App Builder skills at github.com/adobe/skills, ...").

---

### Note for your Claude Code agent
Point it at the App Builder skills above and at the handoff doc. Tell it explicitly: "Adobe I/O Runtime action" (not "serverless function" — that makes agents emit AWS Lambda patterns), read secrets from `params` not `process.env`, and use `@adobe/aio-sdk` logging.
