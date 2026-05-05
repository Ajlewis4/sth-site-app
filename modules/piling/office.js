/* ============================================================
   STH Piling — Office page
   Workflow: pick job → drop xlsx → pick sheet → preview → upload
   ============================================================ */

import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, serverTimestamp
} from '../../shared/firebase.js';

const app = document.getElementById('app');

// State
let state = {
  step: 'jobs',           // jobs | upload | preview | done
  selectedJob: null,      // { id, project, client, ... }
  workbook: null,         // SheetJS workbook object
  selectedSheet: null,    // sheet name
  parsedPiles: [],        // array of pile objects
  warnings: []            // parser warnings
};

// ============================================================
// Boot
// ============================================================
renderJobsStep();

// ============================================================
// Step 1 — Pick a job
// ============================================================
async function renderJobsStep() {
  state.step = 'jobs';

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader('Schedule upload')}
      <div class="office-body">
        <div class="office-card">
          <h2>1 — Pick a job</h2>
          <div id="job-grid" class="office-job-list">
            <div style="padding:30px;color:var(--muted);font-size:13px">Loading jobs…</div>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const jobsRef = collection(db, 'jobs');
    const q = query(jobsRef, where('active', '==', true), where('hasPiling', '==', true));
    const snap = await getDocs(q);

    const grid = document.getElementById('job-grid');
    if (snap.empty) {
      grid.innerHTML = `
        <div style="padding:30px;color:var(--muted);font-size:13px;grid-column:1/-1">
          No active piling jobs found. Mark a job's <code>active: true</code> and <code>hasPiling: true</code> in Firestore first.
        </div>
      `;
      return;
    }

    grid.innerHTML = snap.docs.map(d => {
      const j = d.data();
      const drilled = j.pilesDrilled || 0;
      const total = j.pilesTotal || 0;
      const status = total > 0 ? `${drilled}/${total} piles · ${total > 0 ? 'Schedule loaded' : ''}` : 'No schedule yet';
      return `
        <button class="office-job-tile" data-job-id="${d.id}">
          <div class="job-code">${j.jobCode || j.date || ''}</div>
          <div class="job-name">${j.project || 'Unnamed job'}</div>
          <div class="job-status">${status}</div>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.office-job-tile').forEach(btn => {
      btn.addEventListener('click', async () => {
        const jobId = btn.dataset.jobId;
        const jobSnap = await getDoc(doc(db, 'jobs', jobId));
        state.selectedJob = { id: jobId, ...jobSnap.data() };
        renderUploadStep();
      });
    });
  } catch (err) {
    console.error(err);
    document.getElementById('job-grid').innerHTML = `<div style="color:var(--red)">Error loading jobs. Check console.</div>`;
  }
}

// ============================================================
// Step 2 — Upload xlsx
// ============================================================
function renderUploadStep() {
  state.step = 'upload';

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader('Schedule upload')}
      <div class="office-body">
        <div class="office-card">
          <h2>${state.selectedJob.project} — ${state.selectedJob.client || ''}</h2>
          <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
            Drop a pile schedule xlsx file below. The parser will read it and show a preview before saving anything.
          </p>
          <div class="upload-zone" id="upload-zone">
            <div class="upload-icon">↑</div>
            <div class="upload-prompt">Drop xlsx here or click to browse</div>
            <div class="upload-sub">Standard STH pile schedule format</div>
            <input type="file" id="file-input" accept=".xlsx,.xlsm,.xls" class="hidden-file-input" />
          </div>
          <div class="action-row" style="margin-top:18px">
            <button class="btn ghost" id="back-btn">‹ Back to jobs</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  document.getElementById('back-btn').addEventListener('click', renderJobsStep);
}

// Read xlsx file and move to preview step
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      state.workbook = XLSX.read(data, { type: 'array' });
      state.selectedSheet = state.workbook.SheetNames[0]; // default to first sheet
      renderPreviewStep();
    } catch (err) {
      console.error(err);
      alert('Could not read this file. Make sure it\'s a valid xlsx.');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// Step 3 — Preview parsed piles
// ============================================================
function renderPreviewStep() {
  state.step = 'preview';

  parseSheet();

  const sheets = state.workbook.SheetNames;

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader('Schedule upload')}
      <div class="office-body">
        <div class="office-card">
          <h2>Preview — ${state.selectedJob.project}</h2>
          ${sheets.length > 1 ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">Pick sheet</div>
            <div class="sheet-picker">
              ${sheets.map(name => `
                <button class="sheet-btn ${name === state.selectedSheet ? 'selected' : ''}" data-sheet="${name}">${name}</button>
              `).join('')}
            </div>
          ` : ''}

          <div class="preview-summary">
            <div class="summary-tile">
              <div class="summary-label">Piles found</div>
              <div class="summary-value">${state.parsedPiles.length}</div>
            </div>
            <div class="summary-tile">
              <div class="summary-label">Pile types</div>
              <div class="summary-value" style="font-size:13px">${[...new Set(state.parsedPiles.map(p => p.pileType))].filter(Boolean).join(', ') || '—'}</div>
            </div>
            <div class="summary-tile">
              <div class="summary-label">Total linear m</div>
              <div class="summary-value">${state.parsedPiles.reduce((s, p) => s + (p.designDepth || 0), 0).toFixed(1)}</div>
            </div>
            <div class="summary-tile">
              <div class="summary-label">Total concrete</div>
              <div class="summary-value">${state.parsedPiles.reduce((s, p) => s + (p.designConcrete || 0), 0).toFixed(1)} m³</div>
            </div>
          </div>

          ${state.warnings.length ? `
            <div class="warning-banner">
              ⚠ ${state.warnings.length} warning${state.warnings.length > 1 ? 's' : ''}: ${state.warnings.slice(0, 3).join('; ')}${state.warnings.length > 3 ? '…' : ''}
            </div>
          ` : ''}

          ${state.parsedPiles.length ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">First 8 piles (preview)</div>
            <table class="preview-table">
              <thead>
                <tr>
                  <th>Pile</th>
                  <th>Type</th>
                  <th>Dia (mm)</th>
                  <th>Depth (m)</th>
                  <th>Concrete (m³)</th>
                  <th>Reo</th>
                  <th>Cage L</th>
                  <th>Projection</th>
                </tr>
              </thead>
              <tbody>
                ${state.parsedPiles.slice(0, 8).map(p => `
                  <tr>
                    <td><b>${p.pileId}</b></td>
                    <td>${p.pileType || ''}</td>
                    <td>${p.diameter || ''}</td>
                    <td>${p.designDepth || ''}</td>
                    <td>${(p.designConcrete || 0).toFixed(2)}</td>
                    <td>${p.reoCage || ''}</td>
                    <td>${p.reoLength || ''}m</td>
                    <td>${p.projection || ''}mm</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `<div style="padding:30px;text-align:center;color:var(--muted)">No pile rows found in this sheet.</div>`}

          <div class="action-row">
            <button class="btn ghost" id="back-btn">‹ Back</button>
            <div class="spacer"></div>
            ${state.parsedPiles.length ? `
              <button class="btn" id="upload-btn">Save ${state.parsedPiles.length} piles to job →</button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.sheet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedSheet = btn.dataset.sheet;
      renderPreviewStep();
    });
  });

  document.getElementById('back-btn').addEventListener('click', renderUploadStep);
  document.getElementById('upload-btn')?.addEventListener('click', uploadPiles);
}

// ============================================================
// Parser — read STH pile schedule format
// ============================================================
function parseSheet() {
  state.parsedPiles = [];
  state.warnings = [];

  const sheet = state.workbook.Sheets[state.selectedSheet];
  // Use sheet_to_json with header: 1 to get raw 2D array, indexed from 0
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // STH schedule format (validated against actual file 7-9 Bald Hill Rd):
  //   Row 0 = title row (project name, revision, dates)
  //   Row 1 = blank
  //   Row 2 = column headers
  //   Row 3 = units sub-header
  //   Row 4+ = pile data
  //
  // Column indices (0-based):
  //   A=0  Pile Type        (BP-1, BP-2, etc — skip if it equals "Pile Type")
  //   B=1  Pile No          (1, 2, 3, ...)
  //   D=3  Pile Dia         (metres, e.g. 0.6 → 600mm)
  //   F=5  Grade            (40 Mpa)
  //   G=6  Reo count        (e.g. 7)
  //   H=7  Reo bar type     (N)
  //   I=8  Reo bar size     (16 → "N16")
  //   J=9  Lig bar type     (N)
  //   K=10 Lig bar size     (10)
  //   L=11 Lig spacing      (250 c/c)
  //   T=19 Cage projection  (0.4m → 400mm)
  //   X=23 Embedment        (14.5)
  //   AF=31 Total Cage L incl projection (7m)
  //   AG=32 Pile Depth below Footing (PG) (14.5m — full depth)
  //   AH=33 Pile Depth      (13.5m — depth from CB, the "design depth" we want)
  //   AO=40 Net Concrete Volume (m³)
  //
  // The schedule repeats its header rows every ~52 rows (rows 53, 106, 159 in this file)
  // so we have to skip any row where col A is "Pile Type" or contains the project name.

  if (rows.length < 5) {
    state.warnings.push('Sheet has fewer than 5 rows — expected at least header + units + data');
    return;
  }

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const pileType = row[0];
    const pileNo = row[1];

    // Skip header repeats
    if (typeof pileType === 'string') {
      const lower = pileType.toLowerCase().trim();
      if (lower === 'pile type' || lower === '' || lower.includes('road') || lower.includes('street')) continue;
    }

    // Need at least pile type + pile number to be a valid row
    if (!pileType || pileNo == null || pileNo === '') continue;

    const pileNoNum = typeof pileNo === 'number' ? pileNo : parseInt(pileNo, 10);
    if (isNaN(pileNoNum)) continue;

    // Diameter — schedule has it in metres (0.6, 0.75) — convert to mm
    const diaM = parseFloat(row[3]);
    const diameter = !isNaN(diaM) ? Math.round(diaM * 1000) : null;

    // Reo: combine count + type + size → "7-N16"
    const reoCount = row[6];
    const reoType = row[7];
    const reoSize = row[8];
    const reoCage = (reoCount && reoType && reoSize) ? `${reoCount}-${reoType}${reoSize}` : null;

    // Ligatures: N10 @ 250
    const ligType = row[9];
    const ligSize = row[10];
    const ligSpacing = row[11];
    const ligs = (ligType && ligSize && ligSpacing) ? `${ligType}${ligSize} @ ${ligSpacing}` : null;

    // Projection (metres → mm)
    const projM = parseFloat(row[19]);
    const projection = !isNaN(projM) ? Math.round(projM * 1000) : null;

    // Cage length (col Y = 24)
    const reoLength = parseFloat(row[24]);

    // Design depth — Pile Depth (col AH = 33) = depth below CB
    const designDepth = parseFloat(row[33]);

    // Net concrete volume (col AO = 40)
    const designConcrete = parseFloat(row[40]);

    // Determine type — if pileType starts with "BP" or schedule uses CFA/Bored, default
    // We'll store the raw pileType from schedule and infer category
    let category = 'Bored';  // default
    if (typeof pileType === 'string' && pileType.toUpperCase().includes('CFA')) category = 'CFA';
    // Note: real CFA detection probably needs a column we haven't found yet — flag for checking

    if (isNaN(designDepth)) {
      state.warnings.push(`Pile ${pileNoNum}: missing depth`);
      continue;
    }

    state.parsedPiles.push({
      pileId: String(pileNoNum),
      pileType: pileType,
      type: category,
      diameter,
      grade: row[5] || null,
      reoCage,
      reoLength: !isNaN(reoLength) ? reoLength : null,
      ligatures: ligs,
      projection,
      designDepth,
      designConcrete: !isNaN(designConcrete) ? designConcrete : null,
      footingType: row[13] || null,
      topOfFooting: parseFloat(row[14]) || null,
      bottomOfFooting: parseFloat(row[18]) || null,
      topOfPileConcrete: parseFloat(row[20]) || null,
      toeOfPile: parseFloat(row[38]) || null
    });
  }

  // Sort by pile number
  state.parsedPiles.sort((a, b) => parseInt(a.pileId) - parseInt(b.pileId));

  // Check for duplicates
  const seen = new Set();
  state.parsedPiles.forEach(p => {
    if (seen.has(p.pileId)) state.warnings.push(`Duplicate pile #${p.pileId}`);
    seen.add(p.pileId);
  });
}

// ============================================================
// Step 4 — Upload to Firestore
// ============================================================
async function uploadPiles() {
  const btn = document.getElementById('upload-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const jobId = state.selectedJob.id;
    const total = state.parsedPiles.length;
    let done = 0;

    for (const pile of state.parsedPiles) {
      await setDoc(doc(db, 'jobs', jobId, 'piles', pile.pileId), {
        ...pile,
        status: 'todo',
        createdAt: serverTimestamp()
      });
      done++;
      btn.textContent = `Uploading ${done}/${total}…`;
    }

    // Update job-level totals
    await updateDoc(doc(db, 'jobs', jobId), {
      pilesTotal: total,
      pilesDrilled: 0,
      scheduleUploadedAt: serverTimestamp()
    });

    renderDoneStep(total);
  } catch (err) {
    console.error(err);
    alert('Upload failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = `Save ${state.parsedPiles.length} piles to job →`;
  }
}

function renderDoneStep(count) {
  state.step = 'done';
  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader('Schedule upload')}
      <div class="office-body">
        <div class="office-card">
          <div class="success-banner">
            ✓ Saved ${count} piles to <b>${state.selectedJob.project}</b>. Operators will see them immediately.
          </div>
          <div class="action-row">
            <button class="btn" onclick="window.location.reload()">Upload another</button>
            <button class="btn ghost" onclick="window.location.href='./'">Back to operator app</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Header
// ============================================================
function renderHeader(title) {
  return `
    <div class="office-header">
      <div>
        <div class="crumb"><a href="../../" style="color:#bdbfc6">← Launcher</a></div>
        <h1>STH Piling — ${title}</h1>
      </div>
      <span class="badge">Office</span>
    </div>
  `;
}
