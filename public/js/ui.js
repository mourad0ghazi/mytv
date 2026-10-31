// public/js/ui.js · construction DOM sûre, icônes, toasts, modales, états.
// Aucune donnée utilisateur n'est injectée en HTML : tout passe par textContent.

import { withBase } from './base.js?v=3.20.0';

const SVG = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path>',
  star: '<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8z"></path>',
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"></path>',
  pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"></path>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor" stroke="none"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"></path>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor" stroke="none"></path><path d="m16 9 5 6M21 9l-5 6"></path>',
  next: '<path d="M6 5.5 15 12l-9 6.5z" fill="currentColor" stroke="none"></path><path d="M18 5v14"></path>',
  prev: '<path d="M18 5.5 9 12l9 6.5z" fill="currentColor" stroke="none"></path><path d="M6 5v14"></path>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><rect x="12" y="11" width="7" height="6" rx="1"></rect>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  retry: '<path d="M20 12a8 8 0 1 1-2.4-5.7"></path><path d="M20 4v5h-5"></path>',
  alert: '<path d="M12 4 2.8 20h18.4z"></path><path d="M12 10v4M12 17h.01"></path>',
  tv: '<rect x="2.5" y="7" width="19" height="13" rx="3"></rect><path d="m8 3 4 4 4-4"></path>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"></rect><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"></rect><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"></rect>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"></path>',
  dots: '<circle cx="12" cy="5.5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="18.5" r="1.6"></circle>',
  check: '<path d="m4 12.5 5 5L20 6.5"></path>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"></path>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"></path><path d="m14 6 4 4"></path>',
  settings: '<circle cx="12" cy="12" r="3.2"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 4.6a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"></ellipse><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 3.2C19.5 15.4 12 20 12 20z"></path>',
  upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"></path><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>',
  download: '<path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"></path><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.6 7 9.5 4-1.9 7-5.2 7-9.5V6z"></path><path d="m9 12 2 2 4-4"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>',
  globe: '<circle cx="12" cy="12" r="8.5"></circle><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18.1 12 20.5C9.5 18.1 8.2 15.1 8.2 12S9.5 5.9 12 3.5z"></path>',
  wifiOff: '<path d="m3 3 18 18"></path><path d="M8.5 15.5a5 5 0 0 1 7 0"></path><path d="M5 12a11 11 0 0 1 3.2-2.1M19 12a11 11 0 0 0-6.5-2.9"></path><path d="M12 19h.01"></path>',
  chevron: '<path d="m9 6 6 6-6 6"></path>',
  chevronDown: '<path d="m6 9 6 6 6-6"></path>',
  external: '<path d="M14 4h6v6"></path><path d="M20 4 11 13"></path><path d="M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11"></path>',
  news: '<path d="M4 5h13v14H4z"></path><path d="M17 9h3v8.5A1.5 1.5 0 0 1 18.5 19"></path><path d="M7 9h7M7 13h7M7 16h4"></path>',
  music: '<circle cx="7" cy="17" r="2.5"></circle><circle cx="18" cy="15" r="2.5"></circle><path d="M9.5 17V7l11-2v10"></path>',
  kids: '<circle cx="12" cy="12" r="8.5"></circle><path d="M8.5 10h.01M15.5 10h.01M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"></path>',
  sport: '<circle cx="12" cy="12" r="8.5"></circle><path d="m12 7 3.5 2.5-1.3 4.2h-4.4L8.5 9.5zM12 3.5v3M4 9l4.5.5M20 9l-4.5.5M7 20l3.2-6.3M17 20l-3.2-6.3"></path>',
  cinema: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4"></path>',
  doc: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4M9 12h6M9 16h6"></path>',
  food: '<path d="M6 3v8a3 3 0 0 0 6 0V3M9 11v10"></path><path d="M17 3c-1.5 2-2 4-2 6s.5 3 2 3v9"></path>',
  travel: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"></path><circle cx="12" cy="10" r="2.6"></circle>',
  health: '<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 3.2C19.5 15.4 12 20 12 20z"></path><path d="M7 12h3l1.5-2 2 4L15 12h2"></path>',
  science: '<path d="M9 3h6M10 3v6.5L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9.5V3"></path><path d="M7.5 15h9"></path>',
  pray: '<path d="M12 3v18"></path><path d="M6 8h12"></path><path d="M6 21V8M18 21V8"></path>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect><path d="M11 18.5h2"></path>',
  pin: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"></path><circle cx="12" cy="10" r="2.6"></circle>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"></rect><path d="m3.6 7 8.4 6 8.4-6"></path>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"></rect><path d="M8 10V7.5a4 4 0 0 1 8 0V10"></path>',
  shop: '<path d="M5 8h14l-1.2 12H6.2z"></path><path d="M9 8V6.5a3 3 0 0 1 6 0V8"></path>',
  series: '<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="m8 3 4 3 4-3"></path>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 3.2C19.5 15.4 12 20 12 20z"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 6.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1.5"></path>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.4 1.4"></path><path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.4-1.4"></path>',
  filter: '<path d="M3.5 6h17M6.5 12h11M10 18h4"></path>',
  flag: '<path d="M6 3v18"></path><path d="M6 4h11l-2 4 2 4H6z"></path>',
  doc: '<path d="M6 3.5h8l4 4v13H6z"></path><path d="M14 3.5v4h4"></path><path d="M9 12h6M9 15.5h6"></path>',
};

export function icon(name, size = 18, extra = '') {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" ${extra}>${SVG[name] || SVG.tv}</svg>`;
  return span;
}

/** Créateur d'éléments : attributs sûrs, enfants texte/Node. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function fmtNumber(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('fr-FR');
}

export function fmtDate(iso) {
  if (!iso) return 'Non renseigné';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Non renseigné';
  return date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtRelative(iso) {
  if (!iso) return 'jamais';
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return 'jamais';
  const diff = Date.now() - date;
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)} h`;
  return `il y a ${Math.round(diff / 86_400_000)} j`;
}

export function healthLabel(status) {
  return { up: 'Disponible', flaky: 'Instable', down: 'Indisponible', unknown: 'Non testé' }[status] || 'Non testé';
}

export function healthBadge(status) {
  return h('span', { class: 'badge', dataset: { tone: status === 'up' ? 'ok' : status === 'flaky' ? 'warn' : status === 'down' ? 'danger' : '' } },
    h('span', { class: 'health-dot', dataset: { state: status || 'unknown' }, 'aria-hidden': 'true' }),
    healthLabel(status));
}

export function spinner(label = 'Chargement…') {
  return h('div', { class: 'view-loading', 'aria-busy': 'true' }, h('div', { class: 'boot-mark', 'aria-hidden': 'true' }), h('p', { class: 'muted' }, label));
}

export function skeletonGrid(count = 12) {
  return h('div', { class: 'grid', 'aria-hidden': 'true', 'aria-busy': 'true' },
    Array.from({ length: count }, () => h('div', { class: 'skeleton' },
      h('div', { class: 'sk-media' }),
      h('div', { class: 'sk-line' }),
      h('div', { class: 'sk-line short' }))));
}

export function emptyState({ title, message, actionLabel, onAction, iconName = 'tv' }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, 24)),
    h('h3', { text: title }),
    message ? h('p', { text: message }) : null,
    actionLabel ? h('button', { class: 'btn btn-primary', type: 'button', onClick: onAction }, actionLabel) : null);
}

export function toastStack() {
  return $('#toast-stack');
}

let toastCounter = 0;
export function toast(message, { tone = 'info', actionLabel = '', onAction = null, duration = 6000 } = {}) {
  const stack = toastStack();
  if (!stack) return () => {};
  const id = `toast-${++toastCounter}`;
  let timer;
  const el = h('div', { class: 'toast', dataset: { tone }, id, role: 'status' },
    icon(tone === 'success' ? 'check' : tone === 'error' ? 'alert' : 'news', 16),
    h('p', { text: message }),
    actionLabel ? h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      onClick: () => { close(); onAction?.(); },
    }, actionLabel) : null,
    h('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Fermer la notification', onClick: () => close() }, icon('close', 14)));
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  stack.append(el);
  if (duration > 0) timer = setTimeout(close, duration);
  return close;
}

/** Modale accessible : piège de focus, Échap, restauration du focus (AC-073/074). */
export function modal({ title, body, actions = [], onClose = null, wide = false }) {
  const root = $('#modal-root');
  const previouslyFocused = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const titleId = `modal-title-${Date.now()}`;
  const closeBtn = h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onClick: () => close(),
  }, icon('close', 16));
  const dialog = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    style: wide ? { width: 'min(980px,100%)' } : {},
  },
  h('div', { class: 'modal-head' },
    h('div', {}, h('h2', { id: titleId, text: title })),
    closeBtn),
  h('div', { class: 'modal-body' }, body),
  actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  const onKey = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    document.body.style.overflow = previousOverflow; // remise à l'état initial garantie (BUG-02b)
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    onClose?.();
  }

  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.style.overflow = 'hidden';
  root.append(backdrop);
  const focusTarget = dialog.querySelector('input, select, textarea, button');
  setTimeout(() => focusTarget?.focus(), 30);
  return { close, dialog };
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('clipboard-unavailable');
  } catch {
    const area = h('textarea', { style: { position: 'fixed', top: '-1000px' } });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function debounce(fn, delay = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function logoNode(channel, size = 18) {
  if (channel.logo) {
    // Un logo de source est une adresse absolue ; un logo livré avec le site suit sa racine.
    const img = h('img', { src: withBase(channel.logo), alt: channel.name, loading: 'lazy', decoding: 'async', width: '96', height: '60' });
    img.addEventListener('error', () => { img.replaceWith(initialNode(channel)); }, { once: true });
    return img;
  }
  return initialNode(channel, size);
}

export function initialNode(channel) {
  const name = String(channel.name || '?').trim();
  return h('span', { class: 'card-initial', 'aria-hidden': 'true', text: name.slice(0, 2).toUpperCase() });
}

export function flagFor(code) {
  if (!code || code.length !== 2) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

export function countryName(code) {
  if (!code) return 'Pays non détecté';
  try {
    const dn = new Intl.DisplayNames(['fr'], { type: 'region' });
    return `${flagFor(code)} ${dn.of(code) || code}`;
  } catch {
    return code;
  }
}

export function languageName(code) {
  if (!code) return 'Langue non détectée';
  try {
    const dn = new Intl.DisplayNames(['fr'], { type: 'language' });
    return dn.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
