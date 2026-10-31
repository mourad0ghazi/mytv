// server/core/devices.js · appareils autorisés à ouvrir la console.
// Une adresse secrète cache ; un appareil enregistré protège. Le verrou est optionnel :
// tant qu'il est éteint, le mot de passe suffit, comme avant.

import { createHash, randomBytes } from 'node:crypto';

const ID_PATTERN = /^[a-f0-9]{16,64}$/;

/** Identifiant d'appareil : 32 caractères hexadécimaux, produit par le navigateur. */
export function normalizeDeviceId(value) {
  const id = String(value || '').trim().toLowerCase();
  return ID_PATTERN.test(id) ? id : '';
}

/** Étiquette lisible : « Téléphone », « Ordinateur de la maison »… jamais une adresse IP. */
export function cleanLabel(value, fallback = 'Appareil') {
  const label = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
  return label || fallback;
}

/** Empreinte courte : le registre ne conserve jamais l'identifiant en clair. */
export function deviceDigest(deviceId) {
  return createHash('sha256').update(`streamtv-device:${deviceId}`).digest('hex').slice(0, 32);
}

export function newDeviceId() {
  return randomBytes(16).toString('hex');
}

/** L'appareil est-il autorisé ? Un registre vide n'autorise personne (verrou fermé). */
export function isDeviceAllowed(devices, deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return false;
  const digest = deviceDigest(id);
  return Array.isArray(devices) && devices.some((device) => device.digest === digest);
}

/** Vue publique d'un appareil : jamais l'empreinte, seulement de quoi le reconnaître. */
export function publicDevice(device) {
  return {
    id: device.id,
    label: device.label,
    addedAt: device.addedAt,
    lastSeenAt: device.lastSeenAt || '',
    current: false,
  };
}
