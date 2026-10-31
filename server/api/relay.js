// server/api/relay.js — relais HLS public, limité à la liste blanche licenciée (3.21.0).
// Deux routes : la playlist d'une chaîne et ses fragments. Rien d'autre n'est joignable.

import { AppError } from '../core/errors.js';
import { isPublic } from '../core/channels.js';
import {
  RELAY_LIMITS,
  createGate,
  fetchRelay,
  looksLikePlaylist,
  relayAllowlist,
  relayPath,
  relayTarget,
  rewritePlaylist,
} from '../core/relay.js';
import { queryString } from '../http/router.js';

// Types servis au navigateur. Tout le reste sort en octet-stream : un diffuseur ne dicte pas
// le type affiché par notre domaine.
const MEDIA_TYPES = [
  'video/mp2t', 'video/mp4', 'video/x-flv', 'video/iso.segment',
  'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/ogg',
  'image/jpeg', 'image/png', 'image/webp', 'text/vtt', 'application/octet-stream',
];

function mediaType(contentType, buffer) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (MEDIA_TYPES.includes(type)) return type;
  if (buffer[0] === 0x47 && buffer.length > 188) return 'video/mp2t';
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  return 'application/octet-stream';
}

function findChannel(app, id) {
  const channel = app.store.channels.find((item) => item.id === id);
  if (!channel || channel.deleted || !isPublic(channel, app.store.settings)) throw new AppError('ERR-10');
  return channel;
}

/** Écrit la réponse binaire : le routeur s'arrête dès que la réponse est terminée. */
function send(ctx, { type, buffer, cache }) {
  const { req, res } = ctx;
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('X-Relais-StreamTV', 'liste-blanche');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
}

async function serve(app, ctx, { channel, rawUrl }) {
  const allowlist = relayAllowlist(app.store);
  const target = relayTarget(rawUrl, allowlist, { insecure: Boolean(app.relayInsecure) });
  const result = await app.relayGate.run(() => fetchRelay(target, {
    maxBytes: Math.max(RELAY_LIMITS.playlistBytes, RELAY_LIMITS.segmentBytes),
    timeoutMs: RELAY_LIMITS.timeoutSeconds * 1000,
    fetchImpl: app.relayFetch || fetch,
  }));
  if (looksLikePlaylist(result.contentType, result.buffer)) {
    if (result.buffer.length > RELAY_LIMITS.playlistBytes) throw new AppError('ERR-15', { params: { max: '512 Ko' } });
    const text = rewritePlaylist(result.buffer.toString('utf8'), {
      baseUrl: target.toString(),
      allowlist,
      makeUrl: (absoluteUrl) => relayPath(channel.id, absoluteUrl),
    });
    return send(ctx, { type: 'application/vnd.apple.mpegurl; charset=utf-8', buffer: Buffer.from(text), cache: 'no-store' });
  }
  return send(ctx, {
    type: mediaType(result.contentType, result.buffer),
    buffer: result.buffer,
    cache: 'private, max-age=4',
  });
}

export function registerRelayRoutes(router, app) {
  app.relayGate = createGate();

  // `preflight` : hls.js d'un site tiers autorisé doit obtenir l'accord avant de lire.
  router.get('/api/relais/:id/flux.m3u8', async (ctx) => {
    const channel = findChannel(app, ctx.params.id);
    await serve(app, ctx, { channel, rawUrl: channel.url });
    return null;
  }, { preflight: true });

  router.get('/api/relais/:id/s', async (ctx) => {
    const channel = findChannel(app, ctx.params.id);
    const rawUrl = queryString(ctx.query, 'u', { max: 2048 });
    if (!rawUrl) throw new AppError('ERR-02', { field: 'u', params: { champ: 'adresse du flux' } });
    await serve(app, ctx, { channel, rawUrl });
    return null;
  }, { preflight: true });
}
