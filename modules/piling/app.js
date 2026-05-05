/* ============================================================
   STH Piling module
   Screens: setup → jobs → pile list → pile detail → done
   ============================================================ */

import {
  db, collection, doc, getDocs, onSnapshot, query, where, orderBy
} from '../../shared/firebase.js';
import {
  getOperator, setOperator, getPilingRig, setPilingRig
} from '../../shared/auth.js';
import {
  renderModuleNav, formatDate, toast
} from '../../shared/components.js';

const RIGS = ['Rig 01', 'Rig 02', 'Rig 03', 'Rig 04', 'Rig 05', 'Rig 06'];

const app = document.getElementById('app');

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
    const jobId = hash.split('/')[1];
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
// Job picker — reads jobs that match the existing Cartage schema
// ============================================================
async function renderJobs() {
  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="section-label">Active jobs</div>
    <div class="job-list" id="job-list">
      <div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">Loading jobs…</div>
    </div>
  `;

  try {
    // Schema matches the existing Cartage PWA:
    //   active: bool, project: str, client: str, date: str, createdAt: timestamp
    // Plus piling-specific fields we add per job:
    //   hasPiling: true, pilesTotal: number, pilesDrilled: number
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
    toast('Error loading jobs', 'error');
  }
}

// ============================================================
// Pile list — placeholder
// ============================================================
function renderPileList(jobId) {
  app.innerHTML = `
    ${renderModuleNav('Piling')}
    <div class="empty">
      <h3>Pile list — ${jobId}</h3>
      <p>Pile list, drilling, and done screens come next. Tap below to go back.</p>
      <button class="btn ghost" onclick="window.location.hash='jobs'">Back to jobs</button>
    </div>
  `;
}

// ============================================================
// Boot
// ============================================================
route();