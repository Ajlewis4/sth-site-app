// ============================================
// STH Cartage · v4 · Firebase-synced
// Two roles: gate (mobile) + office (desktop editor)
// ============================================

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ---------- Wait for Firebase ----------
function whenFirebaseReady() {
  return new Promise((resolve, reject) => {
    if (window.sthDB && window.sthDB.ready) return resolve(window.sthDB);
    const timeout = setTimeout(() => reject(new Error('Firebase SDK failed to load within 15 seconds')), 15000);
    window.addEventListener('firebase-ready', () => {
      clearTimeout(timeout);
      resolve(window.sthDB);
    }, { once: true });
  });
}

// ---------- State ----------
const ROLE_KEY = 'sth-cartage-role';
const ACTIVE_JOB_KEY = 'sth-cartage-active-job-id';

let role = null;           // 'gate' | 'office'
let fb = null;              // Firestore helpers
let activeJobId = null;     // Current job document id
let jobData = null;         // { date, client, project }
let trucks = [];            // [{ id, type, rego, company, completed, signature, loads: [...] }]
let unsubJobs = null;
let unsubTrucks = null;
let loadUnsubs = new Map();   // truckId → unsubscribe fn

const TRUCK_CAPACITIES = { 'Tandem': 10, 'TT': 22, 'Quad': 25 };
const TRUCK_LABELS = { 'Tandem': 'Tandem', 'TT': 'Truck & Trailer', 'Quad': 'Quad' };
const TRUCK_CHIP = { 'Tandem': 'TANDEM · 10m³', 'TT': 'T+T · 22m³', 'Quad': 'QUAD · 25m³' };
const MATERIALS = ['Clean Fill', 'Mixed Fill', 'Topsoil', 'Vegetation', 'Clay', 'Mudstone',
                   'Rock', 'Concrete', 'Bricks', 'Sand', 'Crushed Rock', 'Other'];

// ---------- Splash + Role Picker ----------
window.addEventListener('load', async () => {
  // Hide splash quickly — don't wait for Firebase
  setTimeout(() => document.getElementById('splash-screen').classList.add('hidden'), 600);

  // Show picker or saved role immediately (UI first, Firebase second)
  const savedRole = localStorage.getItem(ROLE_KEY);
  if (savedRole === 'gate' || savedRole === 'office') {
    // Show the view skeleton immediately while Firebase loads
    role = savedRole;
    if (role === 'gate') {
      document.getElementById('gate-view').classList.add('visible');
      document.getElementById('job-date').valueAsDate = new Date();
    } else {
      document.getElementById('office-view').classList.add('visible');
      document.getElementById('office-job-date').valueAsDate = new Date();
    }
    updateClock();
    setInterval(updateClock, 30000);
    setSyncStatus('offline'); // until Firebase connects
  } else {
    document.getElementById('role-picker').classList.add('visible');
  }

  // Connect to Firebase in the background
  try {
    fb = await whenFirebaseReady();
    if (role) {
      // Hook up the subscriptions now that Firebase is ready
      await subscribeToActiveJob();
    }
  } catch (e) {
    console.error('Firebase failed to initialize:', e);
    setSyncStatus('offline');
    // Silently fail — app is unusable without Firebase but picker is still visible
    toast('Offline — check your internet connection', 'error');
  }
});

window.pickRole = async function(r) {
  localStorage.setItem(ROLE_KEY, r);
  document.getElementById('role-picker').classList.remove('visible');
  role = r;

  if (r === 'gate') {
    document.getElementById('gate-view').classList.add('visible');
    document.getElementById('office-view').classList.remove('visible');
    document.getElementById('job-date').valueAsDate = new Date();
  } else {
    document.getElementById('office-view').classList.add('visible');
    document.getElementById('gate-view').classList.remove('visible');
    document.getElementById('office-job-date').valueAsDate = new Date();
  }

  updateClock();
  if (!window._clockInterval) window._clockInterval = setInterval(updateClock, 30000);

  if (fb) {
    await subscribeToActiveJob();
  } else {
    setSyncStatus('offline');
  }
};

window.switchRole = function() {
  if (!confirm('Switch role? You can switch back any time.')) return;
  localStorage.removeItem(ROLE_KEY);
  cleanup();
  document.getElementById('gate-view').classList.remove('visible');
  document.getElementById('office-view').classList.remove('visible');
  document.getElementById('role-picker').classList.add('visible');
};

function cleanup() {
  if (unsubJobs) { unsubJobs(); unsubJobs = null; }
  if (unsubTrucks) { unsubTrucks(); unsubTrucks = null; }
  loadUnsubs.forEach(fn => fn());
  loadUnsubs.clear();
  activeJobId = null;
  jobData = null;
  trucks = [];
}

async function activateRole(r) {
  // Legacy helper - not used anymore but kept for safety
  role = r;
  if (fb) await subscribeToActiveJob();
}

// ---------- Firestore subscriptions ----------
async function subscribeToActiveJob() {
  // Query jobs collection for any with active==true
  const { db, collection, query, where, onSnapshot, orderBy } = fb;
  const q = query(
    collection(db, 'jobs'),
    where('active', '==', true)
  );

  unsubJobs = onSnapshot(q, (snap) => {
    setSyncStatus('live');
    if (snap.empty) {
      activeJobId = null;
      jobData = null;
      unsubscribeTrucks();
      trucks = [];
      renderAll();
      return;
    }
    // Take the most recently created active job
    let latest = null;
    snap.forEach(d => {
      const data = d.data();
      if (!latest || (data.createdAt && data.createdAt.toMillis() > latest.data.createdAt.toMillis())) {
        latest = { id: d.id, data };
      }
    });
    if (!latest) return;

    const wasNewJob = activeJobId !== latest.id;
    activeJobId = latest.id;
    jobData = latest.data;

    if (wasNewJob) {
      // Reset local truck state and subscribe fresh
      unsubscribeTrucks();
      trucks = [];
      subscribeToTrucks();
      localStorage.setItem(ACTIVE_JOB_KEY, activeJobId);

      // If on gate, prefill the form fields
      if (role === 'gate') {
        document.getElementById('job-date').value = jobData.date || '';
        document.getElementById('client').value = jobData.client || '';
        document.getElementById('project').value = jobData.project || '';
      } else if (role === 'office') {
        document.getElementById('office-job-date').value = jobData.date || '';
        document.getElementById('office-client').value = jobData.client || '';
        document.getElementById('office-project').value = jobData.project || '';
      }
    } else {
      // Just updated metadata
      renderAll();
    }
  }, (err) => {
    console.error('Jobs subscription error:', err);
    setSyncStatus('offline');
  });
}

function unsubscribeTrucks() {
  if (unsubTrucks) { unsubTrucks(); unsubTrucks = null; }
  loadUnsubs.forEach(fn => fn());
  loadUnsubs.clear();
}

function subscribeToTrucks() {
  if (!activeJobId) return;
  const { db, collection, query, onSnapshot, orderBy } = fb;
  const trucksRef = collection(db, 'jobs', activeJobId, 'trucks');
  const q = query(trucksRef, orderBy('createdAt', 'asc'));

  unsubTrucks = onSnapshot(q, (snap) => {
    // Build new trucks array, preserving loads we already have
    const existingLoads = new Map(trucks.map(t => [t.id, t.loads || []]));
    const newTrucks = [];
    snap.forEach(d => {
      newTrucks.push({
        id: d.id,
        ...d.data(),
        loads: existingLoads.get(d.id) || []
      });
    });

    // Detect newly added trucks — for office, flash + toast
    if (role === 'office' && trucks.length > 0) {
      const existingIds = new Set(trucks.map(t => t.id));
      newTrucks.forEach(t => {
        if (!existingIds.has(t.id)) {
          toast(`New truck: ${t.rego} (${TRUCK_LABELS[t.type]})`, 'new');
        }
      });
    }

    trucks = newTrucks;

    // Subscribe to loads for each truck
    trucks.forEach(truck => {
      if (!loadUnsubs.has(truck.id)) {
        subscribeToLoads(truck.id);
      }
    });
    // Unsubscribe from trucks that no longer exist
    const currentIds = new Set(trucks.map(t => t.id));
    loadUnsubs.forEach((fn, id) => {
      if (!currentIds.has(id)) { fn(); loadUnsubs.delete(id); }
    });

    renderAll();
  }, (err) => {
    console.error('Trucks subscription error:', err);
    setSyncStatus('offline');
  });
}

function subscribeToLoads(truckId) {
  const { db, collection, query, onSnapshot, orderBy } = fb;
  const loadsRef = collection(db, 'jobs', activeJobId, 'trucks', truckId, 'loads');
  const q = query(loadsRef, orderBy('timestamp', 'asc'));

  const prevLoadIds = new Set();

  const unsub = onSnapshot(q, (snap) => {
    const truck = trucks.find(t => t.id === truckId);
    if (!truck) return;

    const newLoads = [];
    const newIds = new Set();
    snap.forEach(d => {
      newLoads.push({ id: d.id, ...d.data() });
      newIds.add(d.id);
    });

    // Toast on new loads (office only)
    if (role === 'office' && prevLoadIds.size > 0) {
      newLoads.forEach(l => {
        if (!prevLoadIds.has(l.id)) {
          toast(`${truck.rego}: load logged`, 'new');
        }
      });
    }
    prevLoadIds.clear();
    newIds.forEach(id => prevLoadIds.add(id));

    truck.loads = newLoads;
    renderAll();
  }, (err) => {
    console.error(`Loads sub for ${truckId}:`, err);
  });

  loadUnsubs.set(truckId, unsub);
}

// ---------- Helpers ----------
function generateId() {
  return Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

function fmtTime(date) {
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function minutesAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m ago`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function setSyncStatus(status) {
  const pill = role === 'gate' ? document.getElementById('sync-status') : document.getElementById('office-sync-status');
  if (!pill) return;
  pill.classList.remove('live', 'offline');
  pill.classList.add(status);
}

function updateClock() {
  const t = fmtTime(new Date());
  const gc = document.getElementById('clock');
  const oc = document.getElementById('office-clock');
  if (gc) gc.textContent = t;
  if (oc) oc.textContent = t;
}

function toast(msg, kind = '') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- GATE: Job setup (writes to Firestore) ----------
async function saveJobFromForm(form) {
  const date = document.getElementById(form === 'gate' ? 'job-date' : 'office-job-date').value;
  const client = document.getElementById(form === 'gate' ? 'client' : 'office-client').value.trim();
  const project = document.getElementById(form === 'gate' ? 'project' : 'office-project').value.trim();

  if (!date || !project) return null;

  const { db, doc, setDoc, updateDoc, writeBatch, collection, getDocs, query, where, serverTimestamp } = fb;

  if (activeJobId) {
    // Update existing
    await updateDoc(doc(db, 'jobs', activeJobId), { date, client, project });
    return activeJobId;
  }

  // Deactivate any other active jobs first
  const others = await getDocs(query(collection(db, 'jobs'), where('active', '==', true)));
  const batch = writeBatch(db);
  others.forEach(d => batch.update(d.ref, { active: false }));

  // Create new job
  const newId = generateId();
  batch.set(doc(db, 'jobs', newId), {
    date, client, project,
    active: true,
    createdAt: serverTimestamp()
  });
  await batch.commit();
  return newId;
}

window.officeSaveJob = async function() {
  const date = document.getElementById('office-job-date').value;
  const project = document.getElementById('office-project').value.trim();
  if (!date || !project) {
    alert('Please fill in Date and Project.');
    return;
  }
  try {
    await saveJobFromForm('office');
    toast('Job started — gate will see it instantly', 'new');
  } catch (e) {
    console.error(e);
    alert('Failed to save job: ' + e.message);
  }
};

// On the gate side, changes to fields auto-save (debounced)
let saveJobDebounce = null;
function debouncedSaveJobFromGate() {
  if (saveJobDebounce) clearTimeout(saveJobDebounce);
  saveJobDebounce = setTimeout(async () => {
    const date = document.getElementById('job-date').value;
    const project = document.getElementById('project').value.trim();
    if (!date || !project) return;
    try { await saveJobFromForm('gate'); }
    catch (e) { console.error('Auto-save job failed:', e); }
  }, 600);
}

// ---------- GATE: Trucks & loads ----------
window.addTruck = function() {
  const date = document.getElementById('job-date').value;
  const project = document.getElementById('project').value.trim();
  if (!date || !project) {
    alert('Enter Date and Project before adding trucks.');
    document.getElementById('project').focus();
    return;
  }
  // Ensure job exists
  if (!activeJobId) {
    debouncedSaveJobFromGate();
    // Wait briefly for job to sync
    setTimeout(() => {
      if (activeJobId) openModal('add-truck-modal');
      else alert('Setting up job… try again in a moment.');
    }, 800);
    return;
  }
  openModal('add-truck-modal');
  setTimeout(() => document.getElementById('truck-type').focus(), 120);
};

window.saveTruck = async function() {
  const type = document.getElementById('truck-type').value;
  const rego = document.getElementById('truck-rego').value.toUpperCase().trim();
  const company = document.getElementById('truck-company').value.trim();

  if (!type) return alert('Select a truck type.');
  if (!rego) return alert('Enter a registration.');
  if (!activeJobId) return alert('No active job yet.');

  const { db, doc, setDoc, serverTimestamp } = fb;
  const truckId = generateId();
  try {
    await setDoc(doc(db, 'jobs', activeJobId, 'trucks', truckId), {
      type, rego, company,
      completed: false,
      signature: null,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    return alert('Save failed: ' + e.message);
  }

  document.getElementById('truck-type').value = '';
  document.getElementById('truck-rego').value = '';
  document.getElementById('truck-company').value = '';
  closeModal('add-truck-modal');
};

window.removeTruck = async function(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck) return;
  if (!confirm(`Remove ${truck.rego} and all its loads?`)) return;
  const { db, doc, deleteDoc, collection, getDocs, writeBatch } = fb;

  try {
    // Delete loads subcollection first
    const loadsSnap = await getDocs(collection(db, 'jobs', activeJobId, 'trucks', truckId, 'loads'));
    const batch = writeBatch(db);
    loadsSnap.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'jobs', activeJobId, 'trucks', truckId));
    await batch.commit();
  } catch (e) {
    console.error(e);
    alert('Remove failed: ' + e.message);
  }
};

window.addLoad = async function(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck || truck.completed) return;

  const { db, doc, setDoc } = fb;
  const loadId = generateId();
  const now = new Date();
  try {
    await setDoc(doc(db, 'jobs', activeJobId, 'trucks', truckId, 'loads', loadId), {
      time: fmtTime(now),
      timestamp: now.getTime(),
      material: '',
      tipSite: '',
      ratePaid: null,
      docket: '',
      invoice: '',
      expImp: ''
    });
  } catch (e) {
    console.error(e);
    return alert('Save failed: ' + e.message);
  }

  // Bounce visual feedback
  const el = document.querySelector(`[data-truck-id="${truckId}"] .big-count`);
  if (el) {
    el.style.transform = 'scale(1.18)';
    setTimeout(() => { el.style.transform = 'scale(1)'; }, 180);
  }
};

window.removeLastLoad = async function(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck || truck.completed || !truck.loads.length) return;
  if (!confirm(`Undo last load for ${truck.rego}?`)) return;
  const last = truck.loads[truck.loads.length - 1];
  const { db, doc, deleteDoc } = fb;
  try {
    await deleteDoc(doc(db, 'jobs', activeJobId, 'trucks', truckId, 'loads', last.id));
  } catch (e) {
    console.error(e);
    alert('Undo failed: ' + e.message);
  }
};

window.finishTruck = function(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck) return;
  if (!truck.loads.length) return alert('Truck has no loads yet.');

  window._currentTruckId = truckId;
  const cap = TRUCK_CAPACITIES[truck.type];
  const totalM3 = truck.loads.length * cap;

  document.getElementById('driver-summary').innerHTML = `
    <div class="summary-row"><span>Truck</span><span><strong>${escapeHtml(truck.rego)}</strong></span></div>
    <div class="summary-row"><span>Type</span><span>${TRUCK_LABELS[truck.type]}</span></div>
    ${truck.company ? `<div class="summary-row"><span>Company</span><span>${escapeHtml(truck.company)}</span></div>` : ''}
    <div class="summary-row"><span>Loads</span><span><strong>${truck.loads.length}</strong></span></div>
    <div class="summary-row"><span>Total</span><span><strong>${totalM3} m³</strong></span></div>
  `;

  openModal('driver-signature-modal');
  setTimeout(initSignaturePad, 80);
};

// ---------- Signature pad ----------
let padCtx = null, padCanvas = null;

function initSignaturePad() {
  padCanvas = document.getElementById('driver-signature-pad');
  if (!padCanvas) return;
  padCtx = padCanvas.getContext('2d');

  const rect = padCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  padCanvas.width = rect.width * dpr;
  padCanvas.height = rect.height * dpr;
  padCtx.scale(dpr, dpr);
  padCtx.fillStyle = '#fff';
  padCtx.fillRect(0, 0, padCanvas.width, padCanvas.height);
  padCtx.strokeStyle = '#0B0D10';
  padCtx.lineWidth = 2.5;
  padCtx.lineCap = 'round';
  padCtx.lineJoin = 'round';

  let drawing = false, lastX = 0, lastY = 0;
  function getPos(e) {
    const rect = padCanvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : null;
    return { x: (t ? t.clientX : e.clientX) - rect.left, y: (t ? t.clientY : e.clientY) - rect.top };
  }
  function start(e) { e.preventDefault(); drawing = true; const p = getPos(e); lastX = p.x; lastY = p.y; }
  function move(e) {
    if (!drawing) return; e.preventDefault();
    const p = getPos(e);
    padCtx.beginPath(); padCtx.moveTo(lastX, lastY); padCtx.lineTo(p.x, p.y); padCtx.stroke();
    lastX = p.x; lastY = p.y;
  }
  function end() { drawing = false; }
  padCanvas.onmousedown = start;
  padCanvas.onmousemove = move;
  padCanvas.onmouseup = end;
  padCanvas.onmouseleave = end;
  padCanvas.ontouchstart = start;
  padCanvas.ontouchmove = move;
  padCanvas.ontouchend = end;
}

window.clearSignature = function() {
  if (!padCtx || !padCanvas) return;
  padCtx.fillStyle = '#fff';
  padCtx.fillRect(0, 0, padCanvas.width, padCanvas.height);
};

function isPadBlank() {
  if (!padCanvas) return true;
  const img = padCtx.getImageData(0, 0, padCanvas.width, padCanvas.height).data;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i] !== 255 || img[i+1] !== 255 || img[i+2] !== 255) return false;
  }
  return true;
}

window.saveDriverSignature = async function() {
  if (isPadBlank()) return alert('Please sign before saving.');
  const truck = trucks.find(t => t.id === window._currentTruckId);
  if (!truck) return;

  const { db, doc, updateDoc } = fb;
  try {
    await updateDoc(doc(db, 'jobs', activeJobId, 'trucks', truck.id), {
      signature: padCanvas.toDataURL(),
      completed: true
    });
  } catch (e) {
    console.error(e);
    return alert('Save failed: ' + e.message);
  }

  window._currentTruckId = null;
  closeModal('driver-signature-modal');
};

// ---------- OFFICE: Edit load fields ----------
window.updateLoad = async function(truckId, loadId, field, value) {
  if (!activeJobId) return;
  const { db, doc, updateDoc } = fb;
  const patch = {};

  // Coerce rate to number or null
  if (field === 'ratePaid') {
    const v = String(value).trim().replace(/[^0-9.-]/g, '');
    patch.ratePaid = v === '' ? null : Number(v);
    if (Number.isNaN(patch.ratePaid)) patch.ratePaid = null;
  } else {
    patch[field] = value;
  }

  try {
    await updateDoc(doc(db, 'jobs', activeJobId, 'trucks', truckId, 'loads', loadId), patch);
  } catch (e) {
    console.error(`Update ${field} failed:`, e);
    toast('Save failed: ' + e.message, 'error');
  }
};

window.officeEditTruckCompany = async function(truckId, value) {
  if (!activeJobId) return;
  const { db, doc, updateDoc } = fb;
  try { await updateDoc(doc(db, 'jobs', activeJobId, 'trucks', truckId), { company: value }); }
  catch (e) { console.error(e); toast('Save failed', 'error'); }
};

// ---------- Rendering ----------
function renderAll() {
  if (role === 'gate') renderGate();
  else if (role === 'office') renderOffice();
}

function renderGate() {
  renderJobBanner();
  renderKpis();
  renderTrucksList();
  renderBottomBar();
}

function renderJobBanner() {
  const title = document.getElementById('job-title');
  const flag = document.getElementById('job-flag');
  const sub = document.getElementById('job-sub');
  if (!title) return;

  if (jobData) {
    const dateStr = new Date(jobData.date).toLocaleDateString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short'
    }).toUpperCase();
    flag.textContent = `ACTIVE JOB · ${dateStr}`;
    title.textContent = jobData.project || 'Unnamed Project';
    title.classList.remove('placeholder');
    sub.textContent = jobData.client ? jobData.client.toUpperCase() : '—';
  } else {
    flag.textContent = 'FILL IN JOB DETAILS BELOW';
    title.textContent = 'No Job Active';
    title.classList.add('placeholder');
    sub.textContent = '—';
  }
}

function renderKpis() {
  const kpis = document.getElementById('kpis');
  if (!trucks.length) { kpis.style.display = 'none'; return; }
  kpis.style.display = 'grid';
  const loads = trucks.reduce((s, t) => s + t.loads.length, 0);
  const m3 = trucks.reduce((s, t) => s + t.loads.length * TRUCK_CAPACITIES[t.type], 0);
  document.getElementById('stat-trucks').textContent = trucks.length;
  document.getElementById('stat-loads').textContent = loads;
  document.getElementById('stat-m3').textContent = m3;
}

function renderTrucksList() {
  const container = document.getElementById('trucks-container');
  if (!trucks.length) {
    container.innerHTML = `
      <div class="empty-state"><div class="big">⊕</div>NO TRUCKS ADDED<br>TAP ADD TRUCK BELOW</div>
    `;
    return;
  }
  container.innerHTML = trucks.map(t => renderTruckCard(t)).join('');
}

function renderTruckCard(truck) {
  const cap = TRUCK_CAPACITIES[truck.type];
  const count = truck.loads.length;
  const totalM3 = count * cap;
  const last = count > 0 ? truck.loads[count - 1] : null;

  const pips = truck.loads.map((l, i) => {
    const filled = l.ratePaid && l.material;
    const cls = i === count - 1 ? 'latest' : (filled ? 'filled' : '');
    return `<span class="pip ${cls}">${l.time}</span>`;
  }).join('');

  if (truck.completed) {
    return `
      <div class="truck completed" data-truck-id="${truck.id}">
        <div class="truck-head">
          <div class="truck-head-text">
            <div class="truck-rego">${escapeHtml(truck.rego)}</div>
            <div class="truck-company">${escapeHtml(truck.company || TRUCK_LABELS[truck.type])}</div>
          </div>
          <div class="truck-type-chip done">${TRUCK_CHIP[truck.type]}</div>
        </div>
        <div class="truck-main">
          <div class="big-count">${count}</div>
          <div class="count-side">
            <div class="count-label">LOADS</div>
            <div class="count-m3">${totalM3} m³</div>
            ${last ? `<div class="count-last">LAST · <strong>${last.time}</strong></div>` : ''}
          </div>
        </div>
        ${pips ? `<div class="load-strip">${pips}</div>` : ''}
        <div class="truck-done-footer">
          ✓ SIGNED &amp; COMPLETE
          <span class="remove" onclick="removeTruck('${truck.id}')">REMOVE</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="truck" data-truck-id="${truck.id}">
      <div class="truck-head">
        <div class="truck-head-text">
          <div class="truck-rego">${escapeHtml(truck.rego)}</div>
          <div class="truck-company">${escapeHtml(truck.company || TRUCK_LABELS[truck.type])}</div>
        </div>
        <div class="truck-type-chip">${TRUCK_CHIP[truck.type]}</div>
      </div>
      <div class="truck-main">
        <div class="big-count">${count}</div>
        <div class="count-side">
          <div class="count-label">LOADS</div>
          <div class="count-m3">${totalM3} m³</div>
          ${last
            ? `<div class="count-last">LAST · <strong>${last.time}</strong> · ${minutesAgo(last.timestamp)}</div>`
            : `<div class="count-last" style="opacity:0.5;">NO LOADS YET</div>`}
        </div>
      </div>
      ${pips ? `<div class="load-strip">${pips}</div>` : ''}
      <div class="truck-actions">
        <button class="ta-btn ta-primary" onclick="addLoad('${truck.id}')">+1 LOAD</button>
        <button class="ta-btn ta-secondary" onclick="removeLastLoad('${truck.id}')" ${count === 0 ? 'disabled' : ''}>UNDO</button>
        <button class="ta-btn ta-finish" onclick="finishTruck('${truck.id}')">FINISH</button>
      </div>
    </div>
  `;
}

function renderBottomBar() {
  const bar = document.getElementById('bottom-bar');
  bar.style.display = trucks.length ? 'block' : 'none';
}

// ---------- OFFICE rendering ----------
function renderOffice() {
  const setup = document.getElementById('office-setup');
  const content = document.getElementById('office-content');

  if (!jobData) {
    setup.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  setup.style.display = 'none';
  content.style.display = 'block';

  // Job info
  const dateStr = new Date(jobData.date).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  document.getElementById('office-job-flag').textContent = `ACTIVE JOB · ${dateStr.toUpperCase()}`;
  document.getElementById('office-job-title').textContent = jobData.project || '—';
  document.getElementById('office-job-sub').textContent = jobData.client || '—';

  // KPIs
  const loads = trucks.flatMap(t => t.loads);
  const totalM3 = trucks.reduce((s, t) => s + t.loads.length * TRUCK_CAPACITIES[t.type], 0);
  const filledCount = loads.filter(l => l.ratePaid && l.material).length;
  document.getElementById('office-stat-trucks').textContent = trucks.length;
  document.getElementById('office-stat-loads').textContent = loads.length;
  document.getElementById('office-stat-m3').textContent = totalM3;
  document.getElementById('office-stat-filled').textContent = `${filledCount}/${loads.length}`;

  renderOfficeRows();
}

function renderOfficeRows() {
  const tbody = document.getElementById('office-rows');
  if (!trucks.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:40px; color:var(--muted);">Waiting for gate data…</td></tr>`;
    return;
  }

  const rows = [];
  for (const truck of trucks) {
    if (truck.loads.length === 0) {
      // Show header row for empty trucks too
      rows.push(`
        <tr class="truck-header">
          <td colspan="12">
            ${escapeHtml(truck.rego)} · ${TRUCK_CHIP[truck.type]} · ${escapeHtml(truck.company || TRUCK_LABELS[truck.type])}
            ${truck.completed ? '<span class="signed-pill">SIGNED</span>' : '<span class="unsigned-pill">IN PROGRESS</span>'}
            <span style="color: var(--muted); font-weight: 500; font-size: 12px; margin-left: 10px;">(no loads yet)</span>
          </td>
        </tr>
      `);
      continue;
    }

    // Header row
    const cap = TRUCK_CAPACITIES[truck.type];
    const truckTotal = truck.loads.length * cap;
    rows.push(`
      <tr class="truck-header">
        <td colspan="12">
          ${escapeHtml(truck.rego)} · ${TRUCK_CHIP[truck.type]} · 
          <input type="text" style="display:inline-block; width:180px; background:transparent; border:1px dashed var(--border); padding: 4px 8px; font-size:12px;"
            value="${escapeHtml(truck.company || '')}" placeholder="Cartage company…"
            onchange="officeEditTruckCompany('${truck.id}', this.value)">
          ${truck.completed ? '<span class="signed-pill">SIGNED</span>' : '<span class="unsigned-pill">IN PROGRESS</span>'}
          <span style="float:right; color: var(--muted); font-weight: 500; font-size: 12px;">${truck.loads.length} loads · ${truckTotal} m³</span>
        </td>
      </tr>
    `);

    // Load rows
    truck.loads.forEach(load => {
      const rate = load.ratePaid || 0;
      const cost = rate ? (cap * rate).toFixed(2) : '';
      rows.push(`
        <tr data-load-id="${load.id}">
          <td class="col-time mono">${load.time}</td>
          <td class="col-rego">${escapeHtml(truck.rego)}</td>
          <td class="col-type">${truck.type}</td>
          <td>${escapeHtml(truck.company || '')}</td>
          <td>
            <select onchange="updateLoad('${truck.id}', '${load.id}', 'expImp', this.value)">
              <option value=""${!load.expImp ? ' selected' : ''}>—</option>
              <option value="Exp"${load.expImp === 'Exp' ? ' selected' : ''}>Exp</option>
              <option value="Imp"${load.expImp === 'Imp' ? ' selected' : ''}>Imp</option>
            </select>
          </td>
          <td>
            <select onchange="updateLoad('${truck.id}', '${load.id}', 'material', this.value)">
              <option value=""${!load.material ? ' selected' : ''}>—</option>
              ${MATERIALS.map(m => `<option value="${m}"${load.material === m ? ' selected' : ''}>${m}</option>`).join('')}
            </select>
          </td>
          <td><input type="text" value="${escapeHtml(load.tipSite || '')}" placeholder="Tip site…"
            onchange="updateLoad('${truck.id}', '${load.id}', 'tipSite', this.value)"></td>
          <td><input type="text" value="${escapeHtml(load.docket || '')}" placeholder="Docket #"
            onchange="updateLoad('${truck.id}', '${load.id}', 'docket', this.value)"></td>
          <td><input type="number" step="0.01" value="${load.ratePaid ?? ''}" placeholder="0.00" style="text-align:right;"
            onchange="updateLoad('${truck.id}', '${load.id}', 'ratePaid', this.value)"></td>
          <td><input type="text" value="${escapeHtml(load.invoice || '')}" placeholder="Invoice #"
            onchange="updateLoad('${truck.id}', '${load.id}', 'invoice', this.value)"></td>
          <td class="num col-m3">${cap}</td>
          <td class="num mono" style="color: var(--green);">${cost ? '$' + cost : ''}</td>
        </tr>
      `);
    });
  }

  tbody.innerHTML = rows.join('');
}

// ---------- Export to register ----------
const REG_DAY_START = 17;
const REG_BLOCK = 36;
const REG_ROWS_PER_DAY = 30;

function openExportSummary() {
  if (!trucks.length) return alert('No trucks to export.');

  const loads = trucks.flatMap(t => t.loads);
  const m3 = trucks.reduce((s, t) => s + t.loads.length * TRUCK_CAPACITIES[t.type], 0);
  const unsigned = trucks.filter(t => !t.completed).length;
  const filled = loads.filter(l => l.ratePaid && l.material).length;

  document.getElementById('export-summary').innerHTML = `
    <div class="summary-row"><span>Date</span><span>${escapeHtml(jobData.date) || '—'}</span></div>
    <div class="summary-row"><span>Project</span><span>${escapeHtml(jobData.project) || '—'}</span></div>
    <div class="summary-row"><span>Client</span><span>${escapeHtml(jobData.client) || '—'}</span></div>
    <div class="summary-row"><span>Trucks</span><span><strong>${trucks.length}</strong></span></div>
    <div class="summary-row"><span>Total Loads</span><span><strong>${loads.length}</strong></span></div>
    <div class="summary-row"><span>Total Volume</span><span><strong>${m3} m³</strong></span></div>
    <div class="summary-row"><span>Loads with Material + Rate</span><span><strong>${filled}/${loads.length}</strong></span></div>
    ${unsigned > 0 ? `<div class="warn-box" style="margin-top:12px;">⚠ ${unsigned} truck(s) not signed yet.</div>` : ''}
  `;
}

window.exportRegister = async function() {
  if (!jobData) return alert('No active job.');
  if (typeof XLSX === 'undefined') return alert('Excel library not loaded yet — please try again in a moment.');

  try {
    const resp = await fetch('Cartage_Register_BLANK.xlsx');
    if (!resp.ok) throw new Error('Register template not found.');
    const buf = await resp.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellStyles: true, cellFormula: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Flatten all loads, sorted by truck order then timestamp
    const rows = [];
    const jobDate = new Date(jobData.date);
    const dateSerial = toExcelSerial(jobDate);

    for (const truck of trucks) {
      // Loads are already sorted by timestamp via the subscription query
      for (const load of truck.loads) {
        rows.push({
          date: dateSerial,
          company: truck.company || '',
          rego: truck.rego,
          type: truck.type,
          expImp: load.expImp || '',
          loads: 1,
          material: load.material || '',
          tipSite: load.tipSite || '',
          docket: load.docket || '',
          rate: load.ratePaid ?? '',
          invoice: load.invoice || ''
        });
      }
    }

    if (rows.length > REG_ROWS_PER_DAY) {
      const overflow = rows.length - REG_ROWS_PER_DAY;
      if (!confirm(`${rows.length} loads — Day 1 fits ${REG_ROWS_PER_DAY}. The extra ${overflow} will spill into Day 2. Continue?`)) return;
    }

    rows.forEach((r, idx) => {
      const dayIdx = Math.floor(idx / REG_ROWS_PER_DAY);
      const rowInDay = idx % REG_ROWS_PER_DAY;
      const blockStart = REG_DAY_START + dayIdx * REG_BLOCK;
      const rowNum = blockStart + 2 + rowInDay;

      // A=date, B=company, C=rego, D=type, E=exp/imp, F=loads,
      // J=material, K=tipSite, L=docket, M=rate, N=invoice
      setCell(ws, rowNum, 1, { t: 'n', v: r.date, z: 'd/m/yyyy' });
      if (r.company) setCell(ws, rowNum, 2, { t: 's', v: r.company });
      setCell(ws, rowNum, 3, { t: 's', v: r.rego });
      setCell(ws, rowNum, 4, { t: 's', v: r.type });
      if (r.expImp) setCell(ws, rowNum, 5, { t: 's', v: r.expImp });
      setCell(ws, rowNum, 6, { t: 'n', v: r.loads });
      if (r.material) setCell(ws, rowNum, 10, { t: 's', v: r.material });
      if (r.tipSite) setCell(ws, rowNum, 11, { t: 's', v: r.tipSite });
      if (r.docket) setCell(ws, rowNum, 12, { t: 's', v: r.docket });
      if (r.rate !== '' && r.rate !== null) setCell(ws, rowNum, 13, { t: 'n', v: Number(r.rate), z: '#,##0.00' });
      if (r.invoice) setCell(ws, rowNum, 14, { t: 's', v: r.invoice });
    });

    const outName = `Cartage_Register_${sanitize(jobData.project)}_${jobData.date}.xlsx`;
    const outBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    downloadBlob(new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), outName);

    closeModal('export-modal');
    setTimeout(() => toast(`Exported: ${outName}`, 'new'), 200);
  } catch (err) {
    console.error(err);
    alert('Export failed: ' + err.message);
  }
};

function setCell(ws, row, col, cell) {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  ws[addr] = { ...ws[addr], ...cell };
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (row - 1 > range.e.r) range.e.r = row - 1;
  if (col - 1 > range.e.c) range.e.c = col - 1;
  ws['!ref'] = XLSX.utils.encode_range(range);
}
function toExcelSerial(d) {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - epoch.getTime();
  return ms / (1000 * 60 * 60 * 24);
}
function sanitize(s) { return (s || 'Job').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Reset day ----------
window.confirmReset = async function() {
  if (!activeJobId) return;
  if (!confirm('End today\'s job? This marks it inactive but keeps it in the database for later reference. Gate and office will both reset.')) return;

  const { db, doc, updateDoc } = fb;
  try {
    await updateDoc(doc(db, 'jobs', activeJobId), { active: false });
    toast('Day ended — ready for a new job', 'new');
  } catch (e) {
    console.error(e);
    alert('Reset failed: ' + e.message);
  }
};

// ---------- Modals ----------
window.openModal = function(id) {
  if (id === 'export-modal') openExportSummary();
  document.getElementById(id).classList.add('active');
};
window.closeModal = function(id) {
  document.getElementById(id).classList.remove('active');
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  // Gate form auto-save listeners
  ['job-date', 'client', 'project'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      debouncedSaveJobFromGate();
      renderJobBanner();
    });
  });
});
