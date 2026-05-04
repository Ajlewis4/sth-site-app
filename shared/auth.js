/* STH Site App — shared operator/rig session helpers
   Stores who the current operator is and which rig/truck they're on,
   per-module (so the same person can be on Rig 03 in Piling and
   Truck 04 in Cartage, no clash). */

const KEYS = {
  operator: 'sth_operator_name',
  pilingRig: 'sth_piling_rig',
  cartageTruck: 'sth_cartage_truck'
};

export function getOperator() {
  return localStorage.getItem(KEYS.operator) || '';
}

export function setOperator(name) {
  localStorage.setItem(KEYS.operator, name.trim());
  // Also persist as last-used for the launcher greeting
  localStorage.setItem('sth_last_user', name.trim().split(' ')[0]);
}

export function getPilingRig() {
  return localStorage.getItem(KEYS.pilingRig) || '';
}

export function setPilingRig(rigCode) {
  localStorage.setItem(KEYS.pilingRig, rigCode);
}

export function getCartageTruck() {
  return localStorage.getItem(KEYS.cartageTruck) || '';
}

export function setCartageTruck(truckCode) {
  localStorage.setItem(KEYS.cartageTruck, truckCode);
}

export function clearSession() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

/** Returns true if the operator + rig/truck for this module is set */
export function hasSession(module) {
  if (!getOperator()) return false;
  if (module === 'piling') return !!getPilingRig();
  if (module === 'cartage') return !!getCartageTruck();
  return true;
}
