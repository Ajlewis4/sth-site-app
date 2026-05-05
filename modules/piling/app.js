/* ============================================================
   STH Piling module
   Screens: setup → jobs → pile list → drilling → done
   ============================================================ */

import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp
} from '../../shared/firebase.js';
import {
  getOperator, setOperator, getPilingRig, setPilingRig
} from '../../shared/auth.js';
import {
  renderModuleNav, formatDate, formatTime, toast
} from '../../shared/components.js';

const RIGS = ['Rig 01', 'Rig 02', 'Rig 03', 'Rig 04', 'Rig 05', 'Rig 06'];

const app = document.getElementById('app');
let activeTab = 'todo';

// ============================================================
// Router
// ============================================================
function route() {
  const hash = window.location.hash.slice(1);

  if (!getOperator() || !getPilingRig()) {
    renderSetup();
    return;
  }

  if (!hash || hash === 'jobs') {
    renderJobs();
    return;
  }

  if (hash.startsWith('job/')) {
    const parts = hash.split('/');
    const jobId = parts[1];

    if (parts[2] === 'pile' && parts[3]) {
      renderDrilling(jobId, parts[3]);
      return;
    }

    renderPileList(jobId);
    return;
  }

  renderJobs();
}

window.addEventListener('hashchange', route);

// ============================================================
// Setup screen
// ============================================================
function renderSetup() {
  const lastOp = getOperator();
  const lastRig = getPilingRig();

  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="setup-hero">
      <h2>Piling</h2>
      <p>Confirm operator and rig before starting</p>
    </div>
    <div class="setup-content">
      <div class="form-row">
        <label class="form-label" for="op-name">Operator name</label>
        <input class="form-input" id="op-name" type="text" placeholder="Enter your name" value="${lastOp}" autocomplete="name" />
        ${lastOp ? `<div class="recall">Last used: <b>${lastOp}</b></div>` : ''}
      </div>
      <div class="form-row">
        <label class="form-label">Rig</label>
        <div class="rig-grid">
          ${RIGS.map(r => `
            <button class="rig-btn ${r === lastRig ? 'selected' : ''}" data-rig="${r}">${r}</button>
          `).join('')}
        </div>
      </div>
      <button class="btn full" id="continue-btn" disabled>Continue</button>
    </div>
  `;

  let selectedRig = lastRig;
  const nameInput = document.getElementById('op-name');
  const continueBtn = document.getElementById('continue-btn');

  function updateContinue() {
    const ok = nameInput.value.trim().length > 1 && selectedRig;
    continueBtn.disabled = !ok;
    continueBtn.style.opacity = ok ? '1' : '.5';
  }

  nameInput.addEventListener('input', updateContinue);

  document.querySelectorAll('.rig-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rig-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedRig = btn.dataset.rig;
      updateContinue();
    });
  });

  continueBtn.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    setOperator(nameInput.value.trim());
    setPilingRig(selectedRig);
    window.location.hash = 'jobs';
    route();
  });

  updateContinue();
}

// ============================================================
// Job picker
// ============================================================
async function renderJobs() {
  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="op-strip">
      <div class="op-block">
        <span class="op-label">Operator</span>
        <span class="op-value">${getOperator()}</span>
      </div>
      <div class="op-block">
        <span class="op-label">Rig</span>
        <span class="op-value">${getPilingRig()}</span>
      </div>
      <button class="op-switch" id="op-switch">Switch</button>
    </div>
    <div class="section-label">Active jobs</div>
    <div class="job-list" id="job-list">
      <div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">Loading jobs…</div>
    </div>
    <div class="office-link-row">
      <a href="office.html" class="office-link">Office tools →</a>
    </div>
  `;

  document.getElementById('op-switch').addEventListener('click', () => {
    if (confirm('Switch operator/rig? Your current session will be cleared.')) {
      localStorage.removeItem('sth_operator_name');
      localStorage.removeItem('sth_piling_rig');
      route();
    }
  });

  try {
    const jobsRef = collection(db, 'jobs');
    const q = query(
      jobsRef,
      where('active', '==', true),
      where('hasPiling', '==', true)
    );

    onSnapshot(q, snap => {
      const listEl = document.getElementById('job-list');
      if (!listEl) return;

      if (snap.empty) {
        listEl.innerHTML = `
          <div class="empty">
            <h3>No active piling jobs</h3>
            <p>Office hasn't set up any piling jobs yet. Contact Brent or Lucy to get a job created.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = snap.docs.map(d => {
        const j = d.data();
        const drilled = j.pilesDrilled || 0;
        const total = j.pilesTotal || 0;
        const progress = total > 0 ? `${drilled}/${total} piles` : 'Schedule pending';
        return `
          <button class="job-card" data-job-id="${d.id}">
            <div class="job-code">${j.jobCode || j.date || ''}</div>
            <div class="job-name">${j.project || 'Unnamed job'}</div>
            <div class="job-meta">
              <span>${j.client || ''}</span>
              <span class="progress">${progress}</span>
            </div>
          </button>
        `;
      }).join('');

      document.querySelectorAll('.job-card').forEach(card => {
        card.addEventListener('click', () => {
          window.location.hash = `job/${card.dataset.jobId}`;
        });
      });
    }, err => {
      console.error('Failed to load jobs:', err);
      const listEl = document.getElementById('job-list');
      if (listEl) {
        listEl.innerHTML = `
          <div class="empty">
            <h3>Couldn't load jobs</h3>
            <p>Check your connection and try again.</p>
            <button class="btn ghost" onclick="window.location.reload()">Retry</button>
          </div>
        `;
      }
    });
  } catch (err) {
    console.error(err);
    toast('Error loading jobs');
  }
}

// ============================================================
// Pile list — to do / live / done tabs
// ============================================================
async function renderPileList(jobId) {
  const jobSnap = await getDoc(doc(db, 'jobs', jobId));
  if (!jobSnap.exists()) {
    app.innerHTML = `
      ${renderModuleNav('Piling')}
      <div class="empty">
        <h3>Job not found</h3>
        <button class="btn ghost" onclick="window.location.hash='jobs'">Back to jobs</button>
      </div>
    `;
    return;
  }

  const job = jobSnap.data();

  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="job-header">
      <a href="#jobs" class="job-back">‹ All jobs</a>
      <div class="job-title">${job.project || 'Unnamed job'}</div>
      <div class="job-sub">${job.client || ''} · ${job.jobCode || job.date || ''}</div>
    </div>
    <div class="pile-tabs">
      <button class="pile-tab ${activeTab === 'todo' ? 'active' : ''}" data-tab="todo">To do <span class="tab-count" id="count-todo">0</span></button>
      <button class="pile-tab ${activeTab === 'live' ? 'active' : ''}" data-tab="live">Live <span class="tab-count" id="count-live">0</span></button>
      <button class="pile-tab ${activeTab === 'done' ? 'active' : ''}" data-tab="done">Done <span class="tab-count" id="count-done">0</span></button>
    </div>
    <div class="pile-list" id="pile-list">
      <div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">Loading piles…</div>
    </div>
  `;

  document.querySelectorAll('.pile-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.pile-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshPileListByTab(jobId);
    });
  });

  const pilesRef = collection(db, 'jobs', jobId, 'piles');
  onSnapshot(pilesRef, snap => {
    const listEl = document.getElementById('pile-list');
    if (!listEl) return;

    if (snap.empty) {
      listEl.innerHTML = `
        <div class="empty">
          <h3>No piles in schedule yet</h3>
          <p>Office hasn't uploaded the pile schedule. Use Office tools to upload an xlsx schedule.</p>
          <a href="office.html" class="btn ghost">Office tools →</a>
        </div>
      `;
      return;
    }

    window._currentPiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Update tab counts
    const counts = { todo: 0, live: 0, done: 0 };
    window._currentPiles.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
    if (document.getElementById('count-todo')) document.getElementById('count-todo').textContent = counts.todo;
    if (document.getElementById('count-live')) document.getElementById('count-live').textContent = counts.live;
    if (document.getElementById('count-done')) document.getElementById('count-done').textContent = counts.done;

    refreshPileListByTab(jobId);
  });
}

function refreshPileListByTab(jobId) {
  const listEl = document.getElementById('pile-list');
  if (!listEl) return;
  const piles = window._currentPiles || [];

  const filtered = piles
    .filter(p => p.status === activeTab)
    .sort((a, b) => (a.pileId || '').localeCompare(b.pileId || ''));

  if (filtered.length === 0) {
    const labels = {
      todo: 'No piles to do — start one from the schedule',
      live: 'No piles in progress',
      done: 'No piles completed yet'
    };
    listEl.innerHTML = `<div class="empty"><p style="margin-top:30px;color:var(--muted)">${labels[activeTab]}</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const meta = `${p.type || '?'} · Ø${p.diameter || '?'}mm · ${p.designDepth || '?'}m`;
    let status = '';
    if (p.status === 'live') {
      status = `<span class="pill live">Drilling — ${formatTime(p.startedAt)}</span>`;
    } else if (p.status === 'done') {
      const dDepth = (p.actualDepth || 0) - (p.designDepth || 0);
      const depthDelta = dDepth ? `${dDepth >= 0 ? '+' : ''}${dDepth.toFixed(1)}m` : '';
      status = `<span class="pill done">Done ${depthDelta}</span>`;
    } else {
      status = `<span class="pill todo">To do</span>`;
    }

    return `
      <button class="pile-row" data-pile-id="${p.id}">
        <div class="pile-id">${p.pileId}</div>
        <div class="pile-meta">${meta}</div>
        <div class="pile-status">${status}</div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.pile-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.hash = `job/${jobId}/pile/${row.dataset.pileId}`;
    });
  });
}

// ============================================================
// Drilling screen
// ============================================================
async function renderDrilling(jobId, pileId) {
  const pileRef = doc(db, 'jobs', jobId, 'piles', pileId);
  const pileSnap = await getDoc(pileRef);

  if (!pileSnap.exists()) {
    app.innerHTML = `
      ${renderModuleNav('Piling')}
      <div class="empty">
        <h3>Pile not found</h3>
        <button class="btn ghost" onclick="window.location.hash='job/${jobId}'">Back to pile list</button>
      </div>
    `;
    return;
  }

  const pile = pileSnap.data();
  const isLive = pile.status === 'live';
  const isDone = pile.status === 'done';

  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="drill-header">
      <a href="#job/${jobId}" class="job-back">‹ Pile list</a>
      <div class="drill-pile-id">${pile.pileId}</div>
      <div class="drill-pile-meta">${pile.type || ''} · Ø${pile.diameter || ''}mm · ${pile.designDepth || ''}m design</div>
    </div>

    ${isLive ? `<div class="started-line">Started ${formatTime(pile.startedAt)} — ${pile.drilledBy} on ${pile.drilledOnRig}</div>` : ''}

    <div class="drill-design">
      <div class="design-row"><span>Reo cage</span><b>${pile.reoCage || '—'}</b></div>
      <div class="design-row"><span>Reo length</span><b>${pile.reoLength || '—'}m</b></div>
      <div class="design-row"><span>Projection</span><b>${pile.projection || '—'}mm</b></div>
      <div class="design-row"><span>Design concrete</span><b>${pile.designConcrete || '—'} m³</b></div>
    </div>

    <div class="drill-body">
      ${pile.status === 'todo' ? `
        <button class="btn full big-btn" id="start-btn">Start hole</button>
      ` : ''}

      ${isLive || isDone ? `
        <div class="input-grid">
          <div class="input-tile">
            <div class="input-label">Actual depth</div>
            <div class="input-value">
              <input type="number" id="actual-depth" step="0.1" inputmode="decimal" value="${pile.actualDepth ?? ''}" placeholder="${pile.designDepth || ''}" ${isDone ? 'disabled' : ''} />
              <span class="input-unit">m</span>
            </div>
            ${!isDone ? `<button class="use-design" data-target="actual-depth" data-value="${pile.designDepth}">Use design (${pile.designDepth}m)</button>` : ''}
          </div>
          <div class="input-tile">
            <div class="input-label">Actual concrete</div>
            <div class="input-value">
              <input type="number" id="actual-concrete" step="0.1" inputmode="decimal" value="${pile.actualConcrete ?? ''}" placeholder="${pile.designConcrete || ''}" ${isDone ? 'disabled' : ''} />
              <span class="input-unit">m³</span>
            </div>
            ${!isDone ? `<button class="use-design" data-target="actual-concrete" data-value="${pile.designConcrete}">Use design (${pile.designConcrete} m³)</button>` : ''}
          </div>
        </div>

        <div class="form-row" style="margin-top:18px">
          <label class="form-label" for="notes">Notes</label>
          <textarea class="form-input" id="notes" rows="3" ${isDone ? 'disabled' : ''} placeholder="Anything to flag (refusal, water, obstructions, etc.)">${pile.notes || ''}</textarea>
        </div>
      ` : ''}

      ${isLive ? `<button class="btn full big-btn" id="finish-btn">Finish hole</button>` : ''}

      ${isDone ? `
        <div class="done-deltas">
          <h3>Drilled</h3>
          ${renderDelta('Depth', pile.actualDepth, pile.designDepth, 'm')}
          ${renderDelta('Concrete', pile.actualConcrete, pile.designConcrete, 'm³')}
          <div class="done-meta">
            By ${pile.drilledBy || '—'} on ${pile.drilledOnRig || '—'}<br>
            Started ${formatTime(pile.startedAt)} · Finished ${formatTime(pile.finishedAt)}
          </div>
          <button class="btn ghost full" style="margin-top:18px" onclick="window.location.hash='job/${jobId}'">Back to pile list</button>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('start-btn')?.addEventListener('click', () => startPile(jobId, pileId));
  document.getElementById('finish-btn')?.addEventListener('click', () => finishPile(jobId, pileId));

  document.querySelectorAll('.use-design').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = document.getElementById(btn.dataset.target);
      if (t) t.value = btn.dataset.value;
    });
  });
}

function renderDelta(label, actual, design, unit) {
  if (actual == null || design == null) return '';
  const delta = actual - design;
  const deltaStr = delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}${unit}`;
  const deltaClass = delta === 0 ? 'neutral' : (Math.abs(delta) > Math.abs(design) * 0.1 ? 'warn' : 'ok');
  return `
    <div class="delta-row">
      <span class="delta-label">${label}</span>
      <span class="delta-actual">${actual}${unit}</span>
      <span class="delta-vs">vs ${design}${unit}</span>
      <span class="delta-value ${deltaClass}">${deltaStr}</span>
    </div>
  `;
}

async function startPile(jobId, pileId) {
  try {
    await updateDoc(doc(db, 'jobs', jobId, 'piles', pileId), {
      status: 'live',
      startedAt: serverTimestamp(),
      drilledBy: getOperator(),
      drilledOnRig: getPilingRig()
    });
    toast('Pile started');
    renderDrilling(jobId, pileId);
  } catch (err) {
    console.error(err);
    toast('Failed to start pile');
  }
}

async function finishPile(jobId, pileId) {
  const actualDepth = parseFloat(document.getElementById('actual-depth')?.value);
  const actualConcrete = parseFloat(document.getElementById('actual-concrete')?.value);
  const notes = document.getElementById('notes')?.value || '';

  if (isNaN(actualDepth)) {
    toast('Enter actual depth before finishing');
    return;
  }
  if (isNaN(actualConcrete)) {
    toast('Enter actual concrete before finishing');
    return;
  }

  try {
    await updateDoc(doc(db, 'jobs', jobId, 'piles', pileId), {
      status: 'done',
      finishedAt: serverTimestamp(),
      actualDepth,
      actualConcrete,
      notes
    });

    const jobRef = doc(db, 'jobs', jobId);
    const jobSnap = await getDoc(jobRef);
    if (jobSnap.exists()) {
      const drilled = (jobSnap.data().pilesDrilled || 0) + 1;
      await updateDoc(jobRef, { pilesDrilled: drilled });
    }

    toast('Pile finished');
    renderDrilling(jobId, pileId);
  } catch (err) {
    console.error(err);
    toast('Failed to finish pile');
  }
}

// ============================================================
// Seed test piles (dev helper — replace with xlsx upload later)
// ============================================================
async function seedTestPiles(jobId) {
  const seed = [
    { pileId: 'P01', type: 'CFA',   diameter: 600, designDepth: 12.4, reoCage: '12-N16', reoLength: 11.5, projection: 250, designConcrete: 3.5 },
    { pileId: 'P02', type: 'CFA',   diameter: 600, designDepth: 12.4, reoCage: '12-N16', reoLength: 11.5, projection: 250, designConcrete: 3.5 },
    { pileId: 'P03', type: 'CFA',   diameter: 600, designDepth: 14.2, reoCage: '12-N20', reoLength: 13.5, projection: 250, designConcrete: 4.0 },
    { pileId: 'P04', type: 'CFA',   diameter: 600, designDepth: 14.2, reoCage: '12-N20', reoLength: 13.5, projection: 250, designConcrete: 4.0 },
    { pileId: 'P05', type: 'Bored', diameter: 750, designDepth: 11.8, reoCage: '14-N20', reoLength: 11.0, projection: 300, designConcrete: 5.2 },
    { pileId: 'P06', type: 'Bored', diameter: 750, designDepth: 11.8, reoCage: '14-N20', reoLength: 11.0, projection: 300, designConcrete: 5.2 },
    { pileId: 'P07', type: 'CFA',   diameter: 450, designDepth: 9.5,  reoCage: '8-N16',  reoLength: 8.8,  projection: 200, designConcrete: 1.5 },
    { pileId: 'P08', type: 'CFA',   diameter: 450, designDepth: 9.5,  reoCage: '8-N16',  reoLength: 8.8,  projection: 200, designConcrete: 1.5 },
    { pileId: 'P09', type: 'Bored', diameter: 900, designDepth: 13.0, reoCage: '16-N24', reoLength: 12.5, projection: 350, designConcrete: 8.3 },
    { pileId: 'P10', type: 'Bored', diameter: 900, designDepth: 13.0, reoCage: '16-N24', reoLength: 12.5, projection: 350, designConcrete: 8.3 }
  ];

  toast('Seeding 10 test piles…');

  try {
    for (const p of seed) {
      await setDoc(doc(db, 'jobs', jobId, 'piles', p.pileId), {
        ...p,
        status: 'todo',
        createdAt: serverTimestamp()
      });
    }
    await updateDoc(doc(db, 'jobs', jobId), { pilesTotal: seed.length, pilesDrilled: 0 });
    toast('Seeded 10 piles');
  } catch (err) {
    console.error(err);
    toast('Seed failed — check console');
  }
}

// ============================================================
// Boot
// ============================================================
route();
