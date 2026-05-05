/* ============================================================
   STH Piling — Office page
   Two workflows:
     1. Upload: schedule xlsx → Firestore piles
     2. Export: drilled piles → write into existing schedule xlsx
   ============================================================ */

import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, serverTimestamp
} from '../../shared/firebase.js';

const app = document.getElementById('app');

// State
let state = {
  mode: 'upload',           // upload | export
  step: 'jobs',
  selectedJob: null,

  // Upload-specific
  workbook: null,
  selectedSheet: null,
  parsedPiles: [],
  warnings: [],

  // Export-specific
  drilledPiles: [],
  exportWorkbook: null,
  exportSheetName: null,
  columnMap: null,          // { pileNoCol, actualDepthCol, drillDateCol, headerRow }
  exportPreview: null
};

// ============================================================
// Boot
// ============================================================
renderJobsStep();

// ============================================================
// Header + tabs
// ============================================================
function renderHeader() {
  return `
    <div class="office-header">
      <div>
        <div class="crumb"><a href="../../" style="color:#bdbfc6">← Launcher</a></div>
        <h1>STH Piling — Office</h1>
      </div>
      <button id="switch-to-operator" class="badge-switch" title="Switch to operator role">Switch to Operator</button>
      <span class="badge">Office</span>
    </div>
    <div class="office-tabs">
      <button class="office-tab ${state.mode === 'upload' ? 'active' : ''}" data-mode="upload">Upload schedule</button>
      <button class="office-tab ${state.mode === 'export' ? 'active' : ''}" data-mode="export">Export drilled piles</button>
      <button class="office-tab ${state.mode === 'builder-log' ? 'active' : ''}" data-mode="builder-log">Builder log</button>
    </div>
  `;
}

function wireSwitchToOperator() {
  const btn = document.getElementById('switch-to-operator');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (confirm('Switch to Operator role?')) {
      localStorage.setItem('sth-piling-role', 'operator');
      window.location.href = './';
    }
  });
}

function wireTabs() {
  document.querySelectorAll('.office-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      // Reset workflow state
      state.selectedJob = null;
      state.workbook = null;
      state.exportWorkbook = null;
      state.parsedPiles = [];
      state.drilledPiles = [];
      state.columnMap = null;
      renderJobsStep();
    });
  });
  wireSwitchToOperator();
}

// ============================================================
// Step 1 — Pick a job (shared)
// ============================================================
async function renderJobsStep() {
  state.step = 'jobs';

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
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

  wireTabs();

  try {
    const jobsRef = collection(db, 'jobs');
    const q = query(jobsRef, where('active', '==', true), where('hasPiling', '==', true));
    const snap = await getDocs(q);

    const grid = document.getElementById('job-grid');
    if (snap.empty) {
      grid.innerHTML = `<div style="padding:30px;color:var(--muted);font-size:13px;grid-column:1/-1">No active piling jobs found.</div>`;
      return;
    }

    grid.innerHTML = snap.docs.map(d => {
      const j = d.data();
      const drilled = j.pilesDrilled || 0;
      const total = j.pilesTotal || 0;
      const status = total > 0 ? `${drilled}/${total} piles` : 'No schedule yet';
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
        const jobSnap = await getDoc(doc(db, 'jobs', btn.dataset.jobId));
        state.selectedJob = { id: btn.dataset.jobId, ...jobSnap.data() };
        if (state.mode === 'upload') renderUploadStep();
        else if (state.mode === 'export') renderExportPickStep();
        else if (state.mode === 'builder-log') renderBuilderLogStep();
      });
    });
  } catch (err) {
    console.error(err);
    document.getElementById('job-grid').innerHTML = `<div style="color:var(--red)">Error loading jobs.</div>`;
  }
}

// ============================================================
// File drop helper
// ============================================================
function wireFileDrop(inputId, zoneId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) handler(e.target.files[0]);
  });
}

// ============================================================
// UPLOAD WORKFLOW
// ============================================================
function renderUploadStep() {
  state.step = 'upload';

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <h2>${state.selectedJob.project} — ${state.selectedJob.client || ''}</h2>
          <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
            Drop a pile schedule xlsx file below. The parser will read it and show a preview before saving.
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

  wireTabs();
  wireFileDrop('file-input', 'upload-zone', handleUploadFile);
  document.getElementById('back-btn').addEventListener('click', renderJobsStep);
}

function handleUploadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      state.workbook = XLSX.read(data, { type: 'array' });
      state.selectedSheet = state.workbook.SheetNames[0];
      renderPreviewStep();
    } catch (err) {
      console.error(err);
      alert('Could not read this file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderPreviewStep() {
  state.step = 'preview';
  parseSheet();
  const sheets = state.workbook.SheetNames;

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <h2>Preview — ${state.selectedJob.project}</h2>
          ${sheets.length > 1 ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">Pick sheet</div>
            <div class="sheet-picker">
              ${sheets.map(name => `<button class="sheet-btn ${name === state.selectedSheet ? 'selected' : ''}" data-sheet="${name}">${name}</button>`).join('')}
            </div>
          ` : ''}

          <div class="preview-summary">
            <div class="summary-tile"><div class="summary-label">Piles found</div><div class="summary-value">${state.parsedPiles.length}</div></div>
            <div class="summary-tile"><div class="summary-label">Pile types</div><div class="summary-value" style="font-size:13px">${[...new Set(state.parsedPiles.map(p => p.pileType))].filter(Boolean).join(', ') || '—'}</div></div>
            <div class="summary-tile"><div class="summary-label">Total linear m</div><div class="summary-value">${state.parsedPiles.reduce((s, p) => s + (p.designDepth || 0), 0).toFixed(1)}</div></div>
            <div class="summary-tile"><div class="summary-label">Total concrete</div><div class="summary-value">${state.parsedPiles.reduce((s, p) => s + (p.designConcrete || 0), 0).toFixed(1)} m³</div></div>
          </div>

          ${state.warnings.length ? `
            <div class="warning-banner">⚠ ${state.warnings.length} warning${state.warnings.length > 1 ? 's' : ''}: ${state.warnings.slice(0, 3).join('; ')}${state.warnings.length > 3 ? '…' : ''}</div>
          ` : ''}

          ${state.parsedPiles.length ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">First 8 piles</div>
            <table class="preview-table">
              <thead><tr><th>Pile</th><th>Type</th><th>Dia (mm)</th><th>Depth (m)</th><th>Concrete (m³)</th><th>Reo</th><th>Cage L</th><th>Projection</th></tr></thead>
              <tbody>
                ${state.parsedPiles.slice(0, 8).map(p => `
                  <tr><td><b>${p.pileId}</b></td><td>${p.pileType || ''}</td><td>${p.diameter || ''}</td><td>${p.designDepth || ''}</td><td>${(p.designConcrete || 0).toFixed(2)}</td><td>${p.reoCage || ''}</td><td>${p.reoLength || ''}m</td><td>${p.projection || ''}mm</td></tr>
                `).join('')}
              </tbody>
            </table>
          ` : `<div style="padding:30px;text-align:center;color:var(--muted)">No pile rows found.</div>`}

          <div class="action-row">
            <button class="btn ghost" id="back-btn">‹ Back</button>
            <div class="spacer"></div>
            ${state.parsedPiles.length ? `<button class="btn" id="upload-btn">Save ${state.parsedPiles.length} piles to job →</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  wireTabs();
  document.querySelectorAll('.sheet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedSheet = btn.dataset.sheet;
      renderPreviewStep();
    });
  });
  document.getElementById('back-btn').addEventListener('click', renderUploadStep);
  document.getElementById('upload-btn')?.addEventListener('click', uploadPiles);
}

function parseSheet() {
  state.parsedPiles = [];
  state.warnings = [];
  const sheet = state.workbook.Sheets[state.selectedSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (rows.length < 5) {
    state.warnings.push('Sheet has fewer than 5 rows');
    return;
  }

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const pileType = row[0];
    const pileNo = row[1];

    if (typeof pileType === 'string') {
      const lower = pileType.toLowerCase().trim();
      if (lower === 'pile type' || lower === '' || lower.includes('road') || lower.includes('street')) continue;
    }
    if (!pileType || pileNo == null || pileNo === '') continue;

    const pileNoNum = typeof pileNo === 'number' ? pileNo : parseInt(pileNo, 10);
    if (isNaN(pileNoNum)) continue;

    const diaM = parseFloat(row[3]);
    const diameter = !isNaN(diaM) ? Math.round(diaM * 1000) : null;
    const reoCount = row[6], reoType = row[7], reoSize = row[8];
    const reoCage = (reoCount && reoType && reoSize) ? `${reoCount}-${reoType}${reoSize}` : null;
    const ligType = row[9], ligSize = row[10], ligSpacing = row[11];
    const ligs = (ligType && ligSize && ligSpacing) ? `${ligType}${ligSize} @ ${ligSpacing}` : null;
    const projM = parseFloat(row[19]);
    const projection = !isNaN(projM) ? Math.round(projM * 1000) : null;
    const reoLength = parseFloat(row[24]);
    const designDepth = parseFloat(row[33]);
    const designConcrete = parseFloat(row[40]);

    let category = 'Bored';
    if (typeof pileType === 'string' && pileType.toUpperCase().includes('CFA')) category = 'CFA';

    if (isNaN(designDepth)) {
      state.warnings.push(`Pile ${pileNoNum}: missing depth`);
      continue;
    }

    state.parsedPiles.push({
      pileId: String(pileNoNum),
      pileType,
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

  state.parsedPiles.sort((a, b) => parseInt(a.pileId) - parseInt(b.pileId));
  const seen = new Set();
  state.parsedPiles.forEach(p => {
    if (seen.has(p.pileId)) state.warnings.push(`Duplicate pile #${p.pileId}`);
    seen.add(p.pileId);
  });
}

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
      await setDoc(doc(db, 'jobs', jobId, 'piles', pile.pileId), { ...pile, status: 'todo', createdAt: serverTimestamp() });
      done++;
      btn.textContent = `Uploading ${done}/${total}…`;
    }
    await updateDoc(doc(db, 'jobs', jobId), { pilesTotal: total, pilesDrilled: 0, scheduleUploadedAt: serverTimestamp() });
    renderUploadDoneStep(total);
  } catch (err) {
    console.error(err);
    alert('Upload failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = `Save ${state.parsedPiles.length} piles to job →`;
  }
}

function renderUploadDoneStep(count) {
  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <div class="success-banner">✓ Saved ${count} piles to <b>${state.selectedJob.project}</b>. Operators will see them immediately.</div>
          <div class="action-row">
            <button class="btn" onclick="window.location.reload()">Upload another</button>
            <button class="btn ghost" onclick="window.location.href='./'">Back to operator app</button>
          </div>
        </div>
      </div>
    </div>
  `;
  wireTabs();
}

// ============================================================
// EXPORT WORKFLOW
// ============================================================
async function renderExportPickStep() {
  state.step = 'export-pick';

  // Load drilled piles for this job
  const pilesSnap = await getDocs(collection(db, 'jobs', state.selectedJob.id, 'piles'));
  state.drilledPiles = pilesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.status === 'done');

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <h2>${state.selectedJob.project} — ${state.selectedJob.client || ''}</h2>

          <div class="preview-summary">
            <div class="summary-tile"><div class="summary-label">Drilled piles</div><div class="summary-value">${state.drilledPiles.length}</div></div>
            <div class="summary-tile"><div class="summary-label">Total piles</div><div class="summary-value">${state.selectedJob.pilesTotal || '—'}</div></div>
            <div class="summary-tile"><div class="summary-label">Progress</div><div class="summary-value" style="font-size:14px">${state.selectedJob.pilesTotal ? Math.round(state.drilledPiles.length / state.selectedJob.pilesTotal * 100) + '%' : '—'}</div></div>
          </div>

          ${state.drilledPiles.length === 0 ? `
            <div class="warning-banner">No piles drilled yet for this job. Nothing to export.</div>
            <button class="btn ghost" id="back-btn">‹ Back to jobs</button>
          ` : `
            <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
              Drop the engineer's pile schedule xlsx below. We'll fill in actual depths and drill dates for the ${state.drilledPiles.length} drilled piles, then download a copy with the actuals merged in.
            </p>
            <div class="upload-zone" id="upload-zone">
              <div class="upload-icon">↑</div>
              <div class="upload-prompt">Drop pile schedule xlsx here</div>
              <div class="upload-sub">We'll merge in actuals — your original file isn't changed</div>
              <input type="file" id="file-input" accept=".xlsx,.xlsm,.xls" class="hidden-file-input" />
            </div>
            <div class="action-row" style="margin-top:18px">
              <button class="btn ghost" id="back-btn">‹ Back to jobs</button>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  wireTabs();
  document.getElementById('back-btn').addEventListener('click', renderJobsStep);
  if (state.drilledPiles.length > 0) {
    wireFileDrop('file-input', 'upload-zone', handleExportFile);
  }
}

function handleExportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      state.exportWorkbook = XLSX.read(data, { type: 'array', cellStyles: true });
      state.exportSheetName = state.exportWorkbook.SheetNames[0];
      autoDetectColumns();
      renderExportPreviewStep();
    } catch (err) {
      console.error(err);
      alert('Could not read this file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function autoDetectColumns() {
  const sheet = state.exportWorkbook.Sheets[state.exportSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Find the header row — try rows 0-5, looking for a row containing "Pile" in column A or B
  let headerRow = -1;
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const row = rows[r] || [];
    const containsPile = row.some(cell => typeof cell === 'string' && /pile\s*(no|type|number)/i.test(cell));
    if (containsPile) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) {
    state.columnMap = null;
    return;
  }

  const headers = rows[headerRow] || [];

  // Find columns by keyword matching
  let pileNoCol = -1;
  let actualDepthCol = -1;
  let drillDateCol = -1;

  headers.forEach((h, idx) => {
    if (typeof h !== 'string') return;
    const norm = h.toLowerCase().trim();

    if (pileNoCol === -1 && (norm === 'pile no' || norm === 'pile no.' || norm === 'pile number')) {
      pileNoCol = idx;
    }
    if (actualDepthCol === -1 && /actual.*(drill\s*depth|depth)/i.test(norm)) {
      actualDepthCol = idx;
    }
    if (drillDateCol === -1 && /(drill.*pour\s*date|drill\s*date|pour\s*date|date\s*drilled)/i.test(norm)) {
      drillDateCol = idx;
    }
  });

  state.columnMap = {
    headerRow,
    dataStartRow: headerRow + 2, // skip the units row
    pileNoCol,
    actualDepthCol,
    drillDateCol,
    headers
  };
}

function renderExportPreviewStep() {
  state.step = 'export-file';

  const cm = state.columnMap;
  const sheets = state.exportWorkbook.SheetNames;

  if (!cm) {
    app.innerHTML = `
      <div class="office-shell">
        ${renderHeader()}
        <div class="office-body">
          <div class="office-card">
            <h2>Couldn't read schedule</h2>
            <div class="warning-banner">We couldn't find a header row with "Pile No" in this file. Make sure you've selected the right sheet and that it's a standard pile schedule.</div>
            <button class="btn ghost" id="back-btn">‹ Try another file</button>
          </div>
        </div>
      </div>
    `;
    wireTabs();
    document.getElementById('back-btn').addEventListener('click', renderExportPickStep);
    return;
  }

  // Build a column letter helper
  const colLetter = (n) => XLSX.utils.encode_col(n);

  // Build the merge preview — match drilled piles to schedule rows
  const sheet = state.exportWorkbook.Sheets[state.exportSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const matched = [];
  const unmatched = [];

  state.drilledPiles.forEach(pile => {
    const pileNoStr = String(pile.pileId);
    let foundRow = -1;
    for (let r = cm.dataStartRow; r < rows.length; r++) {
      const cellVal = rows[r] && rows[r][cm.pileNoCol];
      if (cellVal == null) continue;
      if (String(cellVal) === pileNoStr) {
        foundRow = r;
        break;
      }
    }
    if (foundRow >= 0) {
      matched.push({ pile, row: foundRow });
    } else {
      unmatched.push(pile.pileId);
    }
  });

  state.exportPreview = { matched, unmatched };

  const ok = cm.pileNoCol >= 0 && cm.actualDepthCol >= 0 && cm.drillDateCol >= 0;

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <h2>Export preview — ${state.selectedJob.project}</h2>

          ${sheets.length > 1 ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">Sheet</div>
            <div class="sheet-picker">
              ${sheets.map(name => `<button class="sheet-btn ${name === state.exportSheetName ? 'selected' : ''}" data-sheet="${name}">${name}</button>`).join('')}
            </div>
          ` : ''}

          <div style="font-size:11px;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">Detected columns</div>
          <table class="column-map-table">
            <tr>
              <td>Pile No</td>
              <td>${cm.pileNoCol >= 0 ? `<b>${colLetter(cm.pileNoCol)}</b> · "${cm.headers[cm.pileNoCol] || ''}"` : `<span style="color:var(--red)">Not found</span>`}</td>
              <td>${renderColumnPicker('pileNoCol', cm.pileNoCol, cm.headers)}</td>
            </tr>
            <tr>
              <td>Actual depth</td>
              <td>${cm.actualDepthCol >= 0 ? `<b>${colLetter(cm.actualDepthCol)}</b> · "${cm.headers[cm.actualDepthCol] || ''}"` : `<span style="color:var(--red)">Not found</span>`}</td>
              <td>${renderColumnPicker('actualDepthCol', cm.actualDepthCol, cm.headers)}</td>
            </tr>
            <tr>
              <td>Drill date</td>
              <td>${cm.drillDateCol >= 0 ? `<b>${colLetter(cm.drillDateCol)}</b> · "${cm.headers[cm.drillDateCol] || ''}"` : `<span style="color:var(--red)">Not found</span>`}</td>
              <td>${renderColumnPicker('drillDateCol', cm.drillDateCol, cm.headers)}</td>
            </tr>
          </table>

          <div class="preview-summary" style="margin-top:18px">
            <div class="summary-tile"><div class="summary-label">Drilled piles</div><div class="summary-value">${state.drilledPiles.length}</div></div>
            <div class="summary-tile"><div class="summary-label">Matched in schedule</div><div class="summary-value" style="color:${matched.length === state.drilledPiles.length ? 'var(--green)' : 'var(--amber)'}">${matched.length}</div></div>
            <div class="summary-tile"><div class="summary-label">Unmatched</div><div class="summary-value" style="color:${unmatched.length === 0 ? 'var(--green)' : 'var(--red)'}">${unmatched.length}</div></div>
          </div>

          ${unmatched.length ? `
            <div class="warning-banner">⚠ ${unmatched.length} drilled piles weren't found in the schedule: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '…' : ''}. They won't be written.</div>
          ` : ''}

          ${matched.length ? `
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">Preview (first 8)</div>
            <table class="preview-table">
              <thead><tr><th>Pile</th><th>Row</th><th>Actual depth</th><th>Drill date</th><th>Operator/Rig</th></tr></thead>
              <tbody>
                ${matched.slice(0, 8).map(m => `
                  <tr>
                    <td><b>${m.pile.pileId}</b></td>
                    <td>${m.row + 1}</td>
                    <td>${(m.pile.actualDepth || 0).toFixed(2)}m</td>
                    <td>${formatExportDate(m.pile.finishedAt)}</td>
                    <td style="color:var(--muted);font-size:11px">${m.pile.drilledBy || ''} / ${m.pile.drilledOnRig || ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''}

          <div class="action-row">
            <button class="btn ghost" id="back-btn">‹ Back</button>
            <div class="spacer"></div>
            ${ok && matched.length ? `<button class="btn" id="download-btn">Download merged xlsx →</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  wireTabs();
  document.getElementById('back-btn').addEventListener('click', renderExportPickStep);
  document.getElementById('download-btn')?.addEventListener('click', performExport);

  document.querySelectorAll('.sheet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.exportSheetName = btn.dataset.sheet;
      autoDetectColumns();
      renderExportPreviewStep();
    });
  });

  // Wire column override pickers
  document.querySelectorAll('.col-picker').forEach(sel => {
    sel.addEventListener('change', () => {
      const which = sel.dataset.field;
      const newCol = parseInt(sel.value, 10);
      state.columnMap[which] = isNaN(newCol) ? -1 : newCol;
      renderExportPreviewStep();
    });
  });
}

function renderColumnPicker(field, currentCol, headers) {
  const colLetter = (n) => XLSX.utils.encode_col(n);
  return `
    <select class="col-picker" data-field="${field}">
      <option value="-1">— Override —</option>
      ${headers.map((h, idx) => `
        <option value="${idx}" ${idx === currentCol ? 'selected' : ''}>${colLetter(idx)} · ${h ? String(h).substring(0, 30) : '(blank)'}</option>
      `).join('')}
    </select>
  `;
}

function formatExportDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function performExport() {
  const cm = state.columnMap;
  const sheet = state.exportWorkbook.Sheets[state.exportSheetName];

  // Write actuals into matched cells
  state.exportPreview.matched.forEach(({ pile, row }) => {
    // Actual depth (number)
    if (cm.actualDepthCol >= 0 && pile.actualDepth != null) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: cm.actualDepthCol });
      sheet[cellRef] = { t: 'n', v: pile.actualDepth };
    }
    // Drill date (string in dd/mm/yyyy — most STH schedules show it that way)
    if (cm.drillDateCol >= 0 && pile.finishedAt) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: cm.drillDateCol });
      sheet[cellRef] = { t: 's', v: formatExportDate(pile.finishedAt) };
    }
  });

  // Update sheet's range to make sure new cells are included
  // (not strictly necessary if we're writing into existing cells, but safe)

  // Generate filename
  const today = new Date().toISOString().slice(0, 10);
  const safeName = (state.selectedJob.project || 'Schedule').replace(/[^a-z0-9 -]/gi, '').trim();
  const filename = `${safeName} - Pile Log ${today}.xlsx`;

  // Write workbook to file
  XLSX.writeFile(state.exportWorkbook, filename);

  renderExportDoneStep(filename);
}

function renderExportDoneStep(filename) {
  state.step = 'export-done';
  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <div class="success-banner">
            ✓ Downloaded <b>${filename}</b><br>
            Filled in ${state.exportPreview.matched.length} drilled piles. Original schedule unchanged.
          </div>
          <div class="action-row">
            <button class="btn" onclick="window.location.reload()">Export another</button>
            <button class="btn ghost" onclick="window.location.href='./'">Back to operator app</button>
          </div>
        </div>
      </div>
    </div>
  `;
  wireTabs();
}

// ============================================================
// BUILDER LOG WORKFLOW
// Downloads a JSON file with all done-pile data, ready for the
// Cowork sth-piling-builder-log skill to turn into a branded PDF.
// ============================================================
async function renderBuilderLogStep() {
  state.step = 'builder-log';

  // Load drilled piles for this job
  const pilesSnap = await getDocs(collection(db, 'jobs', state.selectedJob.id, 'piles'));
  state.drilledPiles = pilesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.status === 'done');

  const total = state.drilledPiles.length;
  const totalLm = state.drilledPiles.reduce((s, p) => s + (p.actualDepth || 0), 0);
  const totalConcrete = state.drilledPiles.reduce((s, p) => s + (p.actualConcrete || 0), 0);

  let earliestDate = null, latestDate = null;
  state.drilledPiles.forEach(p => {
    if (p.finishedAt) {
      const d = p.finishedAt.toDate ? p.finishedAt.toDate() : new Date(p.finishedAt);
      if (!earliestDate || d < earliestDate) earliestDate = d;
      if (!latestDate || d > latestDate) latestDate = d;
    }
  });

  const dateRange = (earliestDate && latestDate) ?
    `${earliestDate.toLocaleDateString('en-AU')} — ${latestDate.toLocaleDateString('en-AU')}` :
    'No drilled piles';

  app.innerHTML = `
    <div class="office-shell">
      ${renderHeader()}
      <div class="office-body">
        <div class="office-card">
          <h2>${state.selectedJob.project} — ${state.selectedJob.client || ''}</h2>
          <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
            Download a JSON file with all drilled pile data. Drop it into the job folder in Cowork,
            then ask Claude: <i>"Generate the builder pile log for ${state.selectedJob.project}"</i>.
          </p>

          <div class="preview-summary">
            <div class="summary-tile"><div class="summary-label">Drilled piles</div><div class="summary-value">${total}</div></div>
            <div class="summary-tile"><div class="summary-label">Total LM</div><div class="summary-value">${totalLm.toFixed(1)}</div></div>
            <div class="summary-tile"><div class="summary-label">Total concrete</div><div class="summary-value">${totalConcrete.toFixed(1)} m³</div></div>
            <div class="summary-tile"><div class="summary-label">Date range</div><div class="summary-value" style="font-size:11px">${dateRange}</div></div>
          </div>

          ${total === 0 ? `
            <div class="warning-banner">No drilled piles for this job yet. Nothing to export.</div>
            <button class="btn ghost" id="back-btn">‹ Back to jobs</button>
          ` : `
            <div class="action-row">
              <button class="btn ghost" id="back-btn">‹ Back to jobs</button>
              <div class="spacer"></div>
              <button class="btn" id="download-json-btn">Download builder log JSON →</button>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  wireTabs();
  document.getElementById('back-btn').addEventListener('click', renderJobsStep);
  document.getElementById('download-json-btn')?.addEventListener('click', downloadBuilderLogJson);
}

function downloadBuilderLogJson() {
  const job = state.selectedJob;
  const piles = state.drilledPiles
    .map(p => {
      // Convert Firestore timestamps to ISO strings so they survive JSON
      const out = { ...p };
      ['startedAt', 'finishedAt', 'createdAt'].forEach(k => {
        if (out[k] && out[k].toDate) {
          out[k] = out[k].toDate().toISOString();
        }
      });
      return out;
    })
    .sort((a, b) => parseInt(a.pileId) - parseInt(b.pileId));

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      project: job.project,
      client: job.client,
      jobCode: job.jobCode || null,
      address: job.address || job.project,
      pilesTotal: job.pilesTotal || piles.length
    },
    summary: {
      totalDrilled: piles.length,
      totalLinearMetres: piles.reduce((s, p) => s + (p.actualDepth || 0), 0),
      totalConcrete: piles.reduce((s, p) => s + (p.actualConcrete || 0), 0)
    },
    piles
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  const safeName = (job.project || 'pile-log').replace(/[^a-z0-9 -]/gi, '').trim();
  a.href = url;
  a.download = `${safeName} - Builder Log Data ${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
