/* ============================================================
   STH Cartage module — placeholder
   INTEGRATION NOTES:
   - Port the cartage register schema and gate/office sync logic
     from your existing Cartage PWA into this file.
   - Use the same shared Firebase instance from ../../shared/firebase.js
     so cartage data lands in the same project as Piling.
   - Use the shared auth helpers (getOperator, getCartageTruck) from
     ../../shared/auth.js — note Cartage uses a TRUCK code, not RIG.
   - Use renderModuleNav('Cartage') for the back-to-launcher strip.
   ============================================================ */

import { renderModuleNav } from '../../shared/components.js';

const app = document.getElementById('app');

app.innerHTML = `
  ${renderModuleNav('Cartage')}
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 30px;text-align:center">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:10px">Cartage module</h2>
    <p style="font-size:13px;color:var(--muted);max-width:300px;line-height:1.55;margin-bottom:24px">
      This is the cartage module shell. Port your existing Cartage PWA code into this folder when ready —
      <code>app.js</code>, <code>styles.css</code>, and any helpers go here.
    </p>
    <a href="../../" class="btn ghost">Back to launcher</a>
  </div>
`;
