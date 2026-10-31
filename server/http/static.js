// server/http/static.js — fichiers statiques : traversée bloquée, ETag, cache immuable pour /vendor.
// Aucune liste de fichiers en dur : le dossier public/ est la seule source.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { sendBuffer } from './respond.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
};

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function isSafePath(pathname) {
  if (!pathname || pathname.includes('\0')) return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\0') || decoded.includes('..')) return false;
  return true;
}

/** Résout un chemin sous publicDir, ou null si la cible sort du dossier. */
export function resolvePublic(publicDir, pathname) {
  if (!isSafePath(pathname)) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(publicDir, normalized);
  const root = path.resolve(publicDir);
  const resolved = path.resolve(full);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

export function cacheFor(pathname) {
  if (pathname.startsWith('/vendor/') || pathname.startsWith('/icons/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
    return 'public, max-age=300, must-revalidate';
  }
  if (pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/offline.html') {
    return 'no-cache';
  }
  return 'public, max-age=60';
}

/**
 * Sert un fichier si présent. Retourne true si la réponse a été écrite.
 * @param {{publicDir: string}} options
 */
export async function serveStatic(req, res, pathname, { publicDir, spaFallback = false }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let target = resolvePublic(publicDir, pathname);
  if (!target) return false;

  let stat = null;
  try {
    stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fsp.stat(target);
    }
  } catch {
    stat = null;
  }
  if (!stat) {
    if (!spaFallback) return false;
    target = path.join(publicDir, 'index.html');
  }

  if (!/\.(?:html|css|js|mjs|json|webmanifest|svg|png|jpg|jpeg|webp|ico|woff2?|txt|xml|map|m3u)$/i.test(target)) {
    return false;
  }

  let buffer;
  try {
    buffer = await fsp.readFile(target);
  } catch {
    return false;
  }

  const etag = etagFor(stat);
  const inm = String(req.headers['if-none-match'] || '');
  if (inm && inm.split(',').map((tag) => tag.trim()).includes(etag)) {
    res.statusCode = 304;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheFor(pathname));
    res.end();
    return true;
  }

  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', new Date(stat.mtimeMs).toUTCString());
  const type = contentTypeFor(target);
  sendBuffer(req, res, 200, buffer, {
    type,
    cache: cacheFor(pathname.startsWith('/vendor/') ? target.replace(publicDir, '') : pathname),
  });

  // Précompression à la volée déjà assurée par sendBuffer (brotli/gzip ≥ 1 Ko).
  return true;
}
