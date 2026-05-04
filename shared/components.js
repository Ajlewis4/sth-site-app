/* STH Site App — shared UI helpers
   Module nav strip, common formatters, etc. */

/** Render the back-to-launcher nav strip at the top of a module. */
export function renderModuleNav(currentModule) {
  return `
    <div class="module-nav">
      <a href="../../" class="back-link">
        <span class="back-arrow">‹</span>
        <span>Launcher</span>
      </a>
      <span class="module-current">${currentModule}</span>
    </div>
  `;
}

/** Format a timestamp as e.g. "9:21 am" */
export function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

/** Format a date as e.g. "Mon 5 May" */
export function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Format minutes as a hh:mm cycle e.g. "1:24" */
export function formatCycleMinutes(mins) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Show a brief toast at the top of the screen. */
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  el.style.cssText = `
    position:fixed;top:16px;left:50%;transform:translateX(-50%);
    background:var(--charcoal);color:#fff;padding:10px 18px;
    font-size:13px;font-weight:600;letter-spacing:.04em;
    z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
