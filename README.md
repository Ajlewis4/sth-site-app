# STH Site App

Unified site app for STH Piling Pty Ltd. Replaces the standalone
Cartage PWA — adds a Piling module for pile log capture and schedule
tracking, with both modules sharing the same Firebase project.

## Stack

Vanilla HTML/CSS/JS PWA. No build step. Deploys to GitHub Pages.
Firebase for sync. Same pattern as the existing Cartage PWA.

## Structure

```
sth-site-app/
├── index.html              ← Launcher (entry point)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service worker (offline caching)
├── assets/
│   └── sth-logo-white.png  ← Brand logo
├── shared/
│   ├── styles.css          ← Brand tokens + base components
│   ├── firebase.js         ← Firebase init (shared by all modules)
│   ├── auth.js             ← Operator/rig session helpers
│   └── components.js       ← Shared UI helpers (nav, formatters)
└── modules/
    ├── piling/             ← Piling module (NEW)
    │   ├── index.html
    │   ├── app.js
    │   └── styles.css
    └── cartage/            ← Cartage module (PORT FROM EXISTING PWA)
        ├── index.html
        ├── app.js
        └── styles.css
```

## Setup steps to get this live

### 1. Add your Firebase config

Open `shared/firebase.js`. Replace the `firebaseConfig` object with the
real config from your existing Cartage PWA. You can find it in:

  Firebase Console → Project settings → Your apps → Web app → Config

This is the **same** Firebase project as Cartage. Sharing it means the
`jobs` collection is shared between Piling and Cartage from day one.

### 2. Create the GitHub repo

```bash
cd /path/to/where/you/want/this
# (You'll have downloaded the zip and extracted it here)
cd sth-site-app
git init
git add .
git commit -m "Initial scaffold: launcher + Piling + Cartage shell"
git branch -M main
git remote add origin git@github.com:YOUR_ORG/sth-site-app.git
git push -u origin main
```

### 3. Enable GitHub Pages

In the repo settings on GitHub:
- Settings → Pages
- Source: Deploy from a branch
- Branch: `main`, folder: `/ (root)`
- Save

After a minute, your app will be at:
`https://YOUR_ORG.github.io/sth-site-app/`

### 4. Test the launcher

Open the URL on your phone. You should see:
- Black hero with the STH logo
- "Cartage" and "Piling" tiles
- Tap Piling → operator/rig setup → job list (empty until step 5)

### 5. Set up the Firestore data model

In your existing Firebase project, add a `jobs` collection (or extend
the existing one) with documents shaped like:

```js
{
  jobCode: "1314",
  address: "35 Playne St, Frankston",
  client: "Pitard",
  status: "active",         // active | complete | on-hold
  hasPiling: true,           // show in Piling module job list
  hasCartage: true,          // show in Cartage module job list
  pilesTotal: 64,
  pilesDrilled: 18,
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

Pile schedules will be sub-collections under each job:
`jobs/{jobId}/piles/{pileId}` and pile log entries will live as
`jobs/{jobId}/pileLogs/{logId}`.

### 6. Port the Cartage code

The `modules/cartage/` folder is currently a placeholder. Copy the
relevant files from your existing Cartage PWA into this folder and:
- Update imports to use `../../shared/firebase.js` (so it shares the
  same Firebase init as Piling)
- Use the shared auth helpers from `../../shared/auth.js`
- Use `renderModuleNav('Cartage')` from `../../shared/components.js`
  for the back-to-launcher strip

## Next milestones

Roughly in order:

1. **Pile list screen** — group by To-do / In progress / Done, tap to open pile
2. **Pile detail / drilling screen** — Start hole / Finish hole buttons,
   actual depth + concrete entry
3. **Done screen** — show deltas vs design, save to Firestore
4. **Schedule upload** (office) — xlsx parser to ingest STH's existing
   pile schedule format and write piles to Firestore
5. **Schedule export** (office) — write back to xlsx in STH's format
6. **Cartage port** — bring the existing PWA's logic into this shell

## Brand tokens

Defined in `shared/styles.css`:

- `--black: #141821`     ← matches the logo background (use for launcher)
- `--charcoal: #2E3038`  ← module headers, buttons
- `--yellow: #F5C800`    ← accents, primary action
- `--cream: #F7F4EE`     ← off-white text on dark backgrounds

## Notes

- The launcher remembers the last-used module and operator name in
  localStorage, so on second open it greets the user and shows their
  most recent module first.
- Each module has its own session — same operator can be on Rig 03 in
  Piling and Truck 04 in Cartage with no clash.
- Firestore offline persistence is enabled — the app keeps working in
  basements and syncs when back online.
