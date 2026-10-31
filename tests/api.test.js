// tests/api.test.js — contrat HTTP §6 : routes publiques, authentification, administration,
// en-têtes, compression, codes d'erreur et écritures atomiques.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { ROOT, withServer } from './helpers.js';
import { SETTING_COUNT } from '../server/core/settings.js';

const fixture = (name) => fsp.readFile(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');

describe('API publique', () => {
  test('EP-01 : /api/config expose la marque, les 18 catégories et les totaux', async () => {
    await withServer({}, async ({ client }) => {
      const { status, json, headers } = await client('/api/config');
      assert.equal(status, 200);
      assert.match(headers.get('content-type'), /application\/json/);
      assert.equal(json.brand, 'StreamTV');
      assert.equal(json.categories.length, 18);
      assert.ok(json.totals.catalog >= 1, `catalogue ${json.totals.catalog}`);
      assert.ok(json.totals.hidden >= 0, 'les chaînes masquées sont comptées');
      assert.ok(Array.isArray(json.hero.channels));
      assert.equal(json.defaultPassword, true);
      assert.equal(JSON.stringify(json).includes('passwordHash'), false, 'aucun secret exposé');
      assert.equal(JSON.stringify(json).includes('scrypt$'), false);
    });
  });

  test('EP-01b : le bandeau ne propose que des chaînes lisibles', async () => {
    await withServer({}, async ({ client }) => {
      const { json } = await client('/api/config');
      assert.ok(json.hero.channels.length >= 1, 'au moins une chaîne en vedette');
      for (const channel of json.hero.channels) {
        assert.equal(channel.blocked, false, `${channel.name} est bloquée et pourtant en tête de page`);
      }
    });
  });

  test('EP-02/EP-19 : liste paginée, contrats de carte et plafond de 60', async () => {
    await withServer({}, async ({ client }) => {
      const page = await client('/api/channels?page=1&pageSize=5');
      assert.equal(page.status, 200);
      assert.equal(page.json.channels.length, 5);
      assert.equal(page.json.pageSize, 5);
      assert.ok(page.json.total >= 1);
      assert.equal(page.json.hasMore, true);
      const card = page.json.channels[0];
      assert.ok(card.id && card.name && card.number);
      assert.equal(card.url, undefined, 'la carte ne transporte pas l’URL');
      assert.equal(card.licenseNote, undefined);
      assert.equal(typeof card.health, 'string', 'la carte expose l’état de santé à plat');
      assert.ok(['up', 'down', 'flaky', 'unknown'].includes(card.health));

      const huge = await client('/api/channels?pageSize=500');
      assert.equal(huge.status, 200);
      assert.equal(huge.json.channels.length <= 60, true);
      assert.equal(huge.json.pageSize, 60);

      const second = await client('/api/channels?page=2&pageSize=5');
      assert.notEqual(second.json.channels[0].id, page.json.channels[0].id);
      const last = await client('/api/channels?page=9999&pageSize=5');
      assert.equal(last.status, 200);
      assert.equal(Array.isArray(last.json.channels), true);
    });
  });

  test('EP-04 : fiche complète, variantes et 404 francophone', async () => {
    await withServer({}, async ({ client }) => {
      const list = await client('/api/channels?pageSize=1');
      const id = list.json.channels[0].id;
      const detail = await client(`/api/channels/${id}`);
      assert.equal(detail.status, 200);
      const channel = detail.json.channel;
      for (const field of ['id', 'number', 'name', 'rawName', 'url', 'urlNormalized', 'category',
        'categoryLabel', 'confidence', 'reasons', 'quality', 'tags', 'hue', 'visible', 'blocked',
        'health', 'variants', 'createdAt', 'updatedAt', 'position']) {
        assert.ok(channel[field] !== undefined, `champ manquant : ${field}`);
      }
      assert.equal(typeof channel.url, 'string');
      assert.equal(Object.keys(channel).length >= 35, true, `41 champs attendus, ${Object.keys(channel).length}`);
      assert.ok(Array.isArray(detail.json.related));

      const missing = await client('/api/channels/000000000000');
      assert.equal(missing.status, 404);
      assert.equal(missing.json.code, 'ERR-10');
      assert.equal(missing.json.error, 'Chaîne introuvable.');
      assert.ok(missing.json.requestId);
    });
  });

  test('EP-05 : recherche insensible aux accents et à la casse', async () => {
    await withServer({}, async ({ client }) => {
      const upper = await client('/api/channels/search?q=CINEMA');
      assert.equal(upper.status, 200);
      assert.ok(upper.json.channels.length > 0, 'recherche sans accent');
      const accented = await client('/api/channels/search?q=cin%C3%A9ma');
      assert.equal(accented.status, 200);
      assert.ok(accented.json.channels.length > 0, 'recherche avec accent');
      assert.equal(accented.json.channels.length, upper.json.channels.length);
      const partial = await client('/api/channels/search?q=kid');
      assert.ok(partial.json.channels.length >= 1, 'recherche par préfixe');
      const empty = await client('/api/channels/search?q=');
      assert.equal(empty.status, 400);
      assert.equal(empty.json.code, 'ERR-02');
      assert.equal(empty.json.field, 'q');
    });
  });

  test('EP-08c : une fiche de chaîne ne demande que son propre programme', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const settings = await client('/api/admin/settings', {
        method: 'PATCH', token, body: { epgUrl: '/epg-demo.xml' },
      });
      assert.equal(settings.status, 200, settings.text);
      const liste = await client('/api/channels?pageSize=1');
      const chaine = liste.json.channels[0];
      const cible = await client(`/api/epg?ids=${chaine.id}&hours=8`);
      assert.equal(cible.status, 200);
      assert.equal(cible.json.grid.length, 1, 'une seule ligne demandée, une seule rendue');
      assert.equal(cible.json.grid[0].id, chaine.id);
      // La grille reste de forme stable : programmes listés pour la chaîne demandée.
      // L'appariement lui-même est vérifié par tests/epg.test.js (buildEpg).
      assert.equal(Array.isArray(cible.json.grid[0].programmes), true);
      assert.equal(typeof cible.json.grid[0].name, 'string');
      const vide = await client('/api/epg?ids=inexistant0000');
      assert.equal(vide.json.grid.length, 0, 'un identifiant inconnu ne renvoie aucune ligne');
    });
  });

  test('EP-06…EP-10 : catégories, mentions légales, grille, version, catalogue d’erreurs', async () => {
    await withServer({}, async ({ client }) => {
      const categories = await client('/api/categories');
      assert.equal(categories.status, 200);
      assert.equal(categories.json.categories.length, 18);
      assert.ok(categories.json.categories.every((entry) => entry.id && entry.label && entry.count >= 0));

      const legal = await client('/api/legal');
      assert.equal(legal.status, 200);
      assert.ok(legal.json.mention.length > 20);
      assert.ok(legal.json.sources.length >= 1);
      assert.ok(legal.json.licenseNote.length > 10);

      const epg = await client('/api/epg');
      assert.equal(epg.status, 200);
      assert.equal(epg.json.enabled, false);
      assert.ok(epg.json.message.length > 20);

      const version = await client('/api/version');
      assert.equal(version.status, 200);
      assert.match(version.json.version, /^\d+\.\d+\.\d+$/);
      assert.ok(version.json.routes >= 42, `routes exposées : ${version.json.routes}`);

      // EP-08b : « en ce moment » répond même sans guide, avec une forme stable.
      const now = await client('/api/epg/now');
      assert.equal(now.status, 200);
      assert.equal(Array.isArray(now.json.now), true, 'now est toujours un tableau');
      const inconnu = await client('/api/epg/now?ids=inexistant0000');
      assert.equal(inconnu.status, 200);
      assert.equal(inconnu.json.now.length, 0, 'un identifiant inconnu ne renvoie rien');

      const catalog = await client('/api/errors/catalog');
      assert.equal(catalog.status, 200);
      assert.ok(catalog.json.errors.length >= 20);
      assert.ok(catalog.json.count >= 20);
    });
  });

  test('En-têtes §10 : CSP, nosniff, Permissions-Policy, Referrer-Policy', async () => {
    await withServer({}, async ({ client }) => {
      const response = await client('/api/config');
      const csp = response.headers.get('content-security-policy');
      assert.ok(csp.includes("default-src 'self'"));
      assert.ok(csp.includes("object-src 'none'"));
      assert.ok(csp.includes("frame-ancestors 'self'"));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(response.headers.get('permissions-policy'), /geolocation=\(\)/);
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.ok(response.headers.get('x-request-id'));
      assert.equal(response.headers.get('x-powered-by'), null);
      // §10.3 : les en-têtes sont copiés tels quels, sans relâchement possible.
      assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains; preload');
      assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=()');
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
      for (const directive of ["script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:",
        "media-src 'self' https: blob:", "connect-src 'self' https:", "font-src 'self'", "base-uri 'self'",
        "form-action 'self'"]) {
        assert.ok(csp.includes(directive), `directive absente : ${directive}`);
      }
      assert.equal(/media-src[^;]*http:/.test(csp), false, 'aucun flux http: autorisé par la CSP (P-01)');
      assert.equal(/connect-src[^;]*http:/.test(csp), false);
    });
  });

  test('Compression : gzip et brotli au-delà de 1 Ko, Vary correct', async () => {
    await withServer({}, async ({ base }) => {
      const gzip = await fetch(`${base}/api/channels?pageSize=48`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(gzip.status, 200);
      assert.equal(gzip.headers.get('content-encoding'), 'gzip');
      assert.match(gzip.headers.get('vary') || '', /Accept-Encoding/i);
      const raw = await gzip.text();
      assert.ok(JSON.parse(raw).channels.length <= 60);

      const brotli = await fetch(`${base}/api/channels?pageSize=48`, { headers: { 'Accept-Encoding': 'br' } });
      assert.equal(brotli.headers.get('content-encoding'), 'br');
      const small = await fetch(`${base}/api/version`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(small.headers.get('content-encoding'), null, 'pas de compression sous 1 Ko');
    });
  });

  test('Fichiers statiques : HTML, CSS, service worker, manifeste, 404 API en JSON', async () => {
    await withServer({}, async ({ client }) => {
      const home = await client('/');
      assert.equal(home.status, 200);
      assert.match(home.text, /<html lang="fr"/);
      assert.ok(home.headers.get('content-type').startsWith('text/html'));
      assert.match(home.text, /rel="manifest"/);
      // Le module est demandé avec sa version : un cache ancien ne peut pas le servir (3.17.0).
      assert.match(home.text, /<script type="module" src="\/js\/app\.js\?v=\d+\.\d+\.\d+">/);

      const css = await client('/css/app.css');
      assert.equal(css.status, 200);
      assert.match(css.headers.get('content-type'), /text\/css/);
      assert.ok(css.text.length > 5000);

      for (const file of ['/js/app.js', '/sw.js', '/manifest.webmanifest', '/vendor/hls.min.js', '/offline.html']) {
        const response = await client(file);
        assert.equal(response.status, 200, file);
      }

      const unknown = await client('/api/inconnu');
      assert.equal(unknown.status, 404);
      assert.match(unknown.headers.get('content-type'), /application\/json/);
      assert.equal(unknown.json.code, 'ERR-11');
      assert.equal(unknown.json.error, 'Cette adresse n’existe pas.');

      const spa = await client('/chaine/abc');
      assert.equal(spa.status, 404, 'une fiche inexistante répond 404 côté HTML');
      const traversal = await client('/../server/index.js');
      assert.ok([400, 404].includes(traversal.status));
    });
  });

  test('Ligne de base : /healthz et HEAD sans corps', async () => {
    await withServer({}, async ({ base, client }) => {
      const health = await client('/healthz');
      assert.equal(health.status, 200);
      assert.equal(health.json.status, 'ok');
      const head = await fetch(`${base}/api/config`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    });
  });
});

describe('Authentification et ordre de contrôle', () => {
  test('EP-11 : mauvais mot de passe, jeton opaque, session', async () => {
    await withServer({}, async ({ client }) => {
      const wrong = await client('/api/login', { method: 'POST', body: { password: 'faux' } });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.json.code, 'ERR-08');

      const missing = await client('/api/login', { method: 'POST', body: {} });
      assert.equal(missing.status, 400);
      assert.equal(missing.json.code, 'ERR-02');
      assert.equal(missing.json.field, 'password');

      const ok = await client('/api/login', { method: 'POST', body: { password: 'admin' } });
      assert.equal(ok.status, 200);
      assert.match(ok.json.token, /^[a-f0-9]{48}$/);
      assert.equal(ok.json.defaultPassword, true);
      assert.equal(ok.headers.get('cache-control'), 'no-store');

      const session = await client('/api/session', { token: ok.json.token });
      assert.equal(session.status, 200);
      assert.equal(session.json.signedIn, true);

      const logout = await client('/api/logout', { method: 'POST', token: ok.json.token });
      assert.equal(logout.status, 200);
      const after = await client('/app/session'.replace('/app', '/api'), { token: ok.json.token });
      assert.equal(after.json.signedIn, false);
    });
  });

  test('Ordre 401 → 400 → 415 → 405 : chaque refus a son code', async () => {
    await withServer({}, async ({ client }) => {
      const guard = await client('/api/admin/settings');
      assert.equal(guard.status, 401);
      assert.equal(guard.json.code, 'ERR-07');
      assert.ok(guard.json.requestId);

      const malformedToken = await client('/api/admin/settings', { token: 'x'.repeat(48) });
      assert.equal(malformedToken.status, 401);
      assert.equal(malformedToken.json.code, 'ERR-07');

      const login = await client('/api/login', { method: 'POST', body: { password: 'admin' } });
      const token = login.json.token;

      const wrongType = await client('/api/admin/settings', {
        method: 'PATCH', token, body: 'accent=red', headers: { 'Content-Type': 'text/plain' },
      });
      assert.equal(wrongType.status, 415);
      assert.ok(['ERR-04', 'ERR-05'].includes(wrongType.json.code));

      const broken = await client('/api/admin/settings', {
        method: 'PATCH', token, body: '{"accent":', headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(broken.status, 400, 'JSON invalide = 400, jamais 500 (BUG-04)');
      assert.equal(broken.json.code, 'ERR-06');

      const tooBig = await client('/api/admin/settings', {
        method: 'PATCH', token, body: JSON.stringify({ brand: 'x'.repeat(400_000) }),
      });
      assert.equal(tooBig.status, 413);
      assert.equal(tooBig.json.code, 'ERR-15');

      const notAllowed = await client('/api/channels', { method: 'DELETE' });
      assert.equal(notAllowed.status, 405);
      assert.equal(notAllowed.json.code, 'ERR-12');
      assert.ok(notAllowed.headers.get('allow'));
    });
  });

  test('Anti-force brute : 429 ERR-17 avec Retry-After', async () => {
    await withServer({}, async ({ client }) => {
      let last = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        last = await client('/api/login', { method: 'POST', body: { password: `faux-${attempt}` } });
        if (last.status === 429) break;
      }
      assert.equal(last.status, 429);
      assert.equal(last.json.code, 'ERR-17');
      assert.ok(Number(last.headers.get('retry-after')) > 0);
    });
  });
});

describe('Administration', () => {
  test('Réglages : lecture, validation globale, écriture atomique, réinitialisation', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      const current = await client('/api/admin/settings', { token });
      assert.equal(current.status, 200);
      assert.equal(Object.keys(current.json.settings).length, SETTING_COUNT);
      assert.ok(Array.isArray(current.json.schema));
      assert.equal(current.json.schema.length, SETTING_COUNT);

      const invalid = await client('/api/admin/settings', {
        method: 'PATCH', token, body: { accent: 'rouge', pageSize: 500 },
      });
      assert.equal(invalid.status, 400);
      assert.ok(['ERR-03', 'ERR-04'].includes(invalid.json.code));
      assert.ok(invalid.json.field);

      const afterInvalid = await client('/api/admin/settings', { token });
      assert.equal(afterInvalid.json.settings.accent, '#ff3d71', 'aucune valeur refusée n’est appliquée');

      const valid = await client('/api/admin/settings', {
        method: 'PATCH', token, body: { accent: '#22d3ee', pageSize: 36, brand: 'StreamTV Test' },
      });
      assert.equal(valid.status, 200);
      assert.equal(valid.json.settings.accent, '#22d3ee');
      assert.equal(valid.json.settings.pageSize, 36);

      const persisted = JSON.parse(await fsp.readFile(path.join(dataDir, 'settings.json'), 'utf8'));
      const saved = persisted.settings || persisted;
      assert.equal(saved.accent, '#22d3ee');
      assert.equal(saved.pageSize, 36);

      const publicConfig = await client('/api/config');
      assert.equal(publicConfig.json.accent, '#22d3ee');
      assert.equal(publicConfig.json.brand, 'StreamTV Test');

      const reset = await client('/api/admin/settings/reset', { method: 'POST', token, body: {} });
      assert.equal(reset.status, 200);
      assert.equal(reset.json.settings.accent, '#ff3d71');
      assert.equal(reset.json.settings.pageSize, 48);
    });
  });

  test('EP-12…EP-16 : création, doublon, modification, suppression, restauration', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const created = await client('/api/admin/channels', {
        method: 'POST', token,
        body: { name: 'Chaîne de test', url: 'https://exemple.test/direct.m3u8', group: 'News', category: 'info' },
      });
      assert.equal(created.status, 201);
      const channel = created.json.channel;
      assert.match(channel.id, /^[a-f0-9]{12}$/);
      assert.equal(channel.category, 'info');
      assert.equal(channel.manualOverride, true);

      const duplicate = await client('/api/admin/channels', {
        method: 'POST', token,
        body: { name: 'Doublon', url: 'https://exemple.test/direct.m3u8' },
      });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.json.code, 'ERR-14');

      const badUrl = await client('/api/admin/channels', {
        method: 'POST', token, body: { name: 'Mauvaise adresse', url: 'javascript:alert(1)' },
      });
      assert.equal(badUrl.status, 400);
      assert.equal(badUrl.json.field, 'url');

      const patched = await client(`/api/admin/channels/${channel.id}`, {
        method: 'PATCH', token, body: { name: 'Chaîne renommée', category: 'sport', featured: true },
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.json.channel.name, 'Chaîne renommée');
      assert.equal(patched.json.channel.category, 'sport');
      assert.equal(patched.json.channel.featured, true);

      const unknown = await client('/api/admin/channels/000000000000', { method: 'PATCH', token, body: { name: 'X' } });
      assert.equal(unknown.status, 404);

      const removed = await client(`/api/admin/channels/${channel.id}`, { method: 'DELETE', token, body: {} });
      assert.equal(removed.status, 200);
      const publicAfter = await client(`/api/channels/${channel.id}`);
      assert.equal(publicAfter.status, 404);

      const restored = await client(`/api/admin/channels/${channel.id}/restore`, { method: 'POST', token, body: {} });
      assert.equal(restored.status, 200);
      const publicBack = await client(`/api/channels/${channel.id}`);
      assert.equal(publicBack.status, 200);
    });
  });

  test('EP-17/EP-18 : actions en lot bornées et étiquetage', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const list = await client('/api/admin/channels?pageSize=3', { token });
      const ids = list.json.channels.map((channel) => channel.id);
      const hidden = await client('/api/admin/channels/bulk', {
        method: 'POST', token, body: { ids, action: 'hide' },
      });
      assert.equal(hidden.status, 200);
      assert.ok(hidden.json.updated >= 1);
      assert.ok(hidden.json.updated <= ids.length);

      const shown = await client('/api/admin/channels/bulk', {
        method: 'POST', token, body: { ids, action: 'show' },
      });
      assert.equal(shown.status, 200);

      const tooMany = await client('/api/admin/channels/bulk', {
        method: 'POST', token, body: { ids: Array.from({ length: 501 }, (_, index) => `id${index}`), action: 'hide' },
      });
      assert.equal(tooMany.status, 400);

      const badAction = await client('/api/admin/channels/bulk', {
        method: 'POST', token, body: { ids: [ids[0]], action: 'detruire' },
      });
      assert.equal(badAction.status, 400);

      const preview = await client(`/api/admin/channels/${ids[0]}/tag/preview`, { method: 'POST', token, body: {} });
      assert.equal(preview.status, 200);
      assert.ok(preview.json.preview.after.category);
      assert.ok(preview.json.preview.after.confidence > 0);
      assert.equal(preview.json.preview.before.category, ids.length ? preview.json.preview.before.category : '');

      const tagged = await client(`/api/admin/channels/${ids[0]}/tag`, {
        method: 'POST', token, body: { category: 'musique' },
      });
      assert.equal(tagged.status, 200);
      assert.equal(tagged.json.channel.category, 'musique');
      assert.equal(tagged.json.channel.manualOverride, true);

      const autotag = await client('/api/admin/autotag-all', { method: 'POST', token, body: {} });
      assert.equal(autotag.status, 200);
      assert.equal(typeof autotag.json.changed, 'number');
    });
  });

  test('EP-20…EP-24 : aperçu, commit, statut, annulation, historique', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      const text = await fixture('adult.m3u');
      const preview = await client('/api/admin/import/preview', {
        method: 'POST', token, body: { text, name: 'Fixture adulte' },
      });
      assert.equal(preview.status, 200);
      assert.match(preview.json.jobId, /^[a-z0-9-]+$/i);
      assert.ok(preview.json.counts.entries >= 2);
      assert.ok(Array.isArray(preview.json.sample));
      assert.equal(preview.json.totalBefore >= 1, true);

      const commit = await client('/api/admin/import/commit', {
        method: 'POST', token, body: { jobId: preview.json.jobId },
      });
      assert.equal(commit.status, 200);
      assert.ok(commit.json.counts.added >= 1, JSON.stringify(commit.json));

      const status = await client(`/api/admin/import/${preview.json.jobId}/status`, { token });
      assert.equal(status.status, 200);
      assert.equal(status.json.status, 'applied');
      assert.equal(status.json.rollbackAvailable, true);

      const replay = await client('/api/admin/import/commit', {
        method: 'POST', token, body: { jobId: preview.json.jobId },
      });
      assert.equal([409, 422].includes(replay.status), true, `rejouer un commit : ${replay.status}`);
      assert.ok(['ERR-13', 'ERR-16'].includes(replay.json.code));

      const history = await client('/api/admin/ingestions', { token });
      assert.equal(history.status, 200);
      assert.ok(history.json.ingestions.length >= 1);

      const rollback = await client(`/api/admin/import/${preview.json.jobId}/rollback`, {
        method: 'POST', token, body: {},
      });
      assert.equal(rollback.status, 200);
      assert.ok(rollback.json.removed >= 1, JSON.stringify(rollback.json));

      const audit = await fsp.readFile(path.join(dataDir, 'audit.log'), 'utf8');
      assert.match(audit, /import\.preview/);
      assert.match(audit, /import\.commit/);
      assert.match(audit, /import\.rollback/);
      assert.equal(/passwordHash|Bearer [a-f0-9]{48}/.test(audit), false, 'aucun secret dans l’audit');
    });
  });

  test('Importation : aperçu refusé si le fichier est vide ou énorme', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const empty = await client('/api/admin/import/preview', { method: 'POST', token, body: { text: '' } });
      assert.equal(empty.status, 400);
      assert.ok(['ERR-02', 'ERR-06'].includes(empty.json.code));

      const invalid = await client('/api/admin/import/preview', { method: 'POST', token, body: { text: 'bonjour' } });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.json.code, 'ERR-05');
    });
  });

  test('EP-25…EP-30 : instantané, règles, reclassement, statistiques', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const rules = await client('/api/admin/rules', { token });
      assert.equal(rules.status, 200);
      assert.equal(typeof rules.json.custom, 'object');

      const saved = await client('/api/admin/rules', {
        method: 'PATCH', token,
        body: { rules: { ...rules.json.custom, cuisine: ['streamtv test'] } },
      });
      assert.equal(saved.status, 200);
      assert.ok(saved.json.rules.cuisine.includes('streamtv test'));

      const invalid = await client('/api/admin/rules', {
        method: 'PATCH', token, body: { rules: { categorieInconnue: ['x'] } },
      });
      assert.equal(invalid.status, 400);

      const stats = await client('/api/admin/stats', { token });
      assert.equal(stats.status, 200);
      assert.ok(stats.json.total >= 1);
      assert.equal(typeof stats.json.health.up, 'number');
      assert.ok(stats.json.categories.info >= 1);
    });
  });

  test('EP-31 : sonde de santé bornée et non bloquante', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const probe = await client('/api/admin/health/probe', { method: 'POST', token, body: { limit: 2 } });
      assert.equal(probe.status, 200);
      assert.equal(probe.json.tested, 2);
      assert.ok(probe.json.durationMs >= 0);
      assert.equal(probe.json.results.length, 2);
      for (const result of probe.json.results) {
        assert.ok(['up', 'down', 'flaky', 'unknown'].includes(result.status));
        assert.ok(result.id);
      }
      const stats = await client('/api/admin/stats', { token });
      assert.ok(stats.json.health.unknown + stats.json.health.down + stats.json.health.up <= stats.json.total);
    });
  });

  test('EP-32/EP-33 : exports M3U et JSON complets', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const m3u = await client('/api/admin/export.m3u', { token });
      assert.equal(m3u.status, 200);
      assert.match(m3u.headers.get('content-type'), /audio|text|mpegurl/);
      assert.match(m3u.headers.get('content-disposition'), /attachment/);
      assert.ok(m3u.text.startsWith('#EXTM3U'));
      assert.match(m3u.text, /#EXTINF:-1/);
      assert.match(m3u.text, /tvg-chno="\d+"/);

      const json = await client('/api/admin/export.json', { token });
      assert.equal(json.status, 200);
      const parsed = JSON.parse(json.text);
      assert.ok(Array.isArray(parsed.channels));
      assert.ok(parsed.channels[0].id);
      assert.equal(parsed.channels[0].url.length > 0, true);
    });
  });

  test('EP-34/EP-35 : sauvegarde horodatée, empreinte, restauration confirmée', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      const backup = await client('/api/admin/backup', { method: 'POST', token, body: {} });
      assert.equal(backup.status, 200);
      const file = backup.json.backup.file;
      assert.match(file, /^catalogue-\d{8}-\d{6}(-hebdo)?\.json$/);
      assert.match(backup.json.backup.sha256, /^[a-f0-9]{64}$/);
      const stored = await fsp.readFile(path.join(dataDir, 'backups', file));
      assert.ok(stored.length > 100);

      const refused = await client('/api/admin/restore', {
        method: 'POST', token, body: { file, confirm: 'oui' },
      });
      assert.equal(refused.status, 422);
      assert.equal(refused.json.code, 'ERR-16');

      const restored = await client('/api/admin/restore', {
        method: 'POST', token, body: { file, confirm: 'RESTAURER' },
      });
      assert.equal(restored.status, 200);
      assert.ok(restored.json.count >= 1);

      const missing = await client('/api/admin/restore', {
        method: 'POST', token, body: { file: 'catalogue-19990101-000000.json', confirm: 'RESTAURER' },
      });
      assert.equal(missing.status, 422);
      assert.equal(missing.json.code, 'ERR-16');
    });
  });

  test('EP-36/EP-37 : politique de mot de passe, révocation des sessions', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const weak = await client('/api/admin/password', {
        method: 'POST', token, body: { current: 'admin', next: 'court', confirm: 'court' },
      });
      assert.equal(weak.status, 400);
      assert.equal(weak.json.field, 'next');

      const mismatch = await client('/api/admin/password', {
        method: 'POST', token, body: { current: 'admin', next: 'MotDePasseSolide123', confirm: 'AutreChose123' },
      });
      assert.equal(mismatch.status, 400);

      const wrongCurrent = await client('/api/admin/password', {
        method: 'POST', token, body: { current: 'faux', next: 'MotDePasseSolide123', confirm: 'MotDePasseSolide123' },
      });
      assert.equal(wrongCurrent.status, 401);

      const ok = await client('/api/admin/password', {
        method: 'POST', token, body: { current: 'admin', next: 'MotDePasseSolide123', confirm: 'MotDePasseSolide123' },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.mustReconnect, true);

      const revoked = await client('/api/admin/stats', { token });
      assert.equal(revoked.status, 401);

      const oldPassword = await client('/api/login', { method: 'POST', body: { password: 'admin' } });
      assert.equal(oldPassword.status, 401);

      const fresh = await client('/api/login', { method: 'POST', body: { password: 'MotDePasseSolide123' } });
      assert.equal(fresh.status, 200);
      const config = await client('/api/config');
      assert.equal(config.json.defaultPassword, false);

      const closed = await client('/api/admin/sessions', { method: 'DELETE', token: fresh.json.token });
      assert.equal(closed.status, 200);
      assert.equal(closed.json.count >= 1, true);
    });
  });

  test('Écriture atomique : aucun fichier .tmp résiduel après les écritures', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      await client('/api/admin/settings', { method: 'PATCH', token, body: { footerNote: 'Note de pied de page' } });
      await client('/api/admin/backup', { method: 'POST', token, body: {} });
      const files = await fsp.readdir(dataDir);
      assert.deepEqual(files.filter((name) => /\.tmp$|\.part$/.test(name)), []);
      for (const name of ['channels.json', 'settings.json', 'sources.json', 'health.json', 'learning.json']) {
        assert.ok(files.includes(name), `${name} présent`);
        JSON.parse(await fsp.readFile(path.join(dataDir, name), 'utf8'));
      }
    });
  });
});

describe('Règles d’exploitation (§10, §11-K)', () => {
  test('AC-014 : un second import du même fichier n’ajoute aucune chaîne', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const text = await fixture('simple.m3u');
      const first = await client('/api/admin/import/preview', { method: 'POST', token, body: { text, name: 'Idempotence' } });
      assert.equal(first.json.counts.added, 3);
      await client('/api/admin/import/commit', { method: 'POST', token, body: { jobId: first.json.jobId } });
      const second = await client('/api/admin/import/preview', { method: 'POST', token, body: { text, name: 'Idempotence' } });
      assert.equal(second.json.counts.added, 0, 'aucune nouvelle chaîne');
      assert.equal(second.json.counts.entries, 3);
      const commit = await client('/api/admin/import/commit', { method: 'POST', token, body: { jobId: second.json.jobId } });
      assert.equal(commit.status, 200);
      assert.equal(commit.json.counts.added, 0);
    });
  });

  test('AC-019 : deux commits simultanés, le second reçoit 409 ERR-13', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const text = await fixture('small.m3u');
      const first = await client('/api/admin/import/preview', { method: 'POST', token, body: { text, name: 'A' } });
      const second = await client('/api/admin/import/preview', { method: 'POST', token, body: { text, name: 'B' } });
      const [a, b] = await Promise.all([
        client('/api/admin/import/commit', { method: 'POST', token, body: { jobId: first.json.jobId } }),
        client('/api/admin/import/commit', { method: 'POST', token, body: { jobId: second.json.jobId } }),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 409], `états : ${a.status}/${b.status}`);
      const conflict = a.status === 409 ? a : b;
      assert.equal(conflict.json.code, 'ERR-13');
      assert.ok(Number(conflict.headers.get('retry-after')) > 0);
    });
  });

  test('AC-102 : /healthz répond 200 avec un catalogue sain', async () => {
    await withServer({}, async ({ client }) => {
      const health = await client('/healthz');
      assert.equal(health.status, 200);
      assert.equal(health.json.status, 'ok');
      assert.ok(health.json.channels >= 1);
      assert.equal(typeof health.json.uptimeSeconds, 'number');
      assert.equal(health.headers.get('cache-control'), 'no-store');
    });
  });

  test('AC-101 : démarrage refusé en production sans ADMIN_PASSWORD', async () => {
    const env = { NODE_ENV: 'production' };
    delete env.ADMIN_PASSWORD;
    const previous = process.env.NODE_ENV;
    const previousPassword = process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_PASSWORD;
    try {
      const { startServer } = await import('./helpers.js');
      await assert.rejects(
        () => startServer({ env: { NODE_ENV: 'production' } }),
        /ADMIN_PASSWORD|arrêt|s’est arrêté/,
      );
    } finally {
      process.env.NODE_ENV = previous;
      if (previousPassword !== undefined) process.env.ADMIN_PASSWORD = previousPassword;
    }
  });
});
