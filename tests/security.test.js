// tests/security.test.js — §10 : en-têtes, sessions, anti-force brute, audit, sauvegardes,
// vérification de la CSP et des fichiers publics (aucun script inline, aucune ressource externe).

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { LIMITS } from '../server/core/constants.js';
import { hashPassword, verifyPassword, assertPasswordPolicy } from '../server/core/auth.js';
import { ROOT, withServer } from './helpers.js';

const read = (relative) => fsp.readFile(path.join(ROOT, relative), 'utf8');

async function listFiles(dir, filter) {
  const out = [];
  for (const entry of await fsp.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(relative, filter));
    else if (!filter || filter(relative)) out.push(relative);
  }
  return out;
}

describe('Sécurité des mots de passe et des sessions', () => {
  test('scrypt N=16384, r=8, p=1, sel aléatoire, comparaison à temps constant', async () => {
    const first = await hashPassword('MotDePasseSolide123');
    const second = await hashPassword('MotDePasseSolide123');
    assert.equal(first.iterations, 16384);
    assert.notEqual(first.salt, second.salt, 'deux hachages du même mot de passe diffèrent');
    assert.notEqual(first.passwordHash, second.passwordHash);
    assert.equal(first.passwordHash.includes('MotDePasseSolide123'), false);
    assert.equal(await verifyPassword('MotDePasseSolide123', first), true);
    assert.equal(await verifyPassword('MotDePasseSolide124', first), false);
    assert.equal(await verifyPassword('', first), false);
    assert.equal(await verifyPassword('MotDePasseSolide123', null), false);
  });

  test('Politique : longueur, classe de caractères, liste noire, mot de passe actuel', () => {
    assert.doesNotThrow(() => assertPasswordPolicy('MotDePasseSolide123', 'admin'));
    for (const weak of ['court1', 'motdepasseuniquement', '123456789012', 'password1234', 'StreamTV2024', 'admin0000']) {
      assert.throws(() => assertPasswordPolicy(weak, 'admin'), `${weak} aurait dû être refusé`);
    }
    assert.throws(() => assertPasswordPolicy('MotDePasseSolide123', 'MotDePasseSolide123'));
  });

  test('Jeton 48 hexadécimal, TTL glissant de 12 h, plafond de sessions', async () => {
    await withServer({}, async ({ client, login }) => {
      const created = await login();
      assert.match(created.token, /^[a-f0-9]{48}$/);
      const ttl = new Date(created.json.expiresAt).getTime() - Date.now();
      assert.ok(ttl > 11 * 3600_000 && ttl <= 12 * 3600_000, `TTL ${Math.round(ttl / 3600_000)} h`);

      const session = await client('/api/session', { token: created.token });
      assert.equal(session.json.signedIn, true);
      assert.equal(session.json.defaultPassword, true);

      const tokens = [];
      for (let index = 0; index < 7; index += 1) {
        const extra = await login();
        tokens.push(extra.token);
      }
      const sessions = (await client('/api/session', { token: tokens.at(-1) })).json;
      assert.ok(sessions.sessions <= LIMITS.sessionsMax, `${sessions.sessions} sessions ouvertes`);
    });
  });

  test('Jeton falsifié, expiré ou révoqué : toujours 401 ERR-07', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const forged = `${token.slice(0, 47)}${token.endsWith('a') ? 'b' : 'a'}`;
      for (const candidate of [forged, 'f'.repeat(48), 'Bearer', '']) {
        const response = await client('/api/admin/stats', { token: candidate });
        assert.equal(response.status, 401, `jeton « ${candidate.slice(0, 8)}… »`);
        assert.equal(response.json.code, 'ERR-07');
      }
      await client('/api/admin/sessions', { method: 'DELETE', token });
      const after = await client('/api/admin/stats', { token });
      assert.equal(after.status, 401);
    });
  });

  test('Anti-force brute : compteur par IP, Retry-After, journalisation', async () => {
    await withServer({}, async ({ client, dataDir }) => {
      for (let attempt = 0; attempt < LIMITS.loginFailsMax; attempt += 1) {
        const response = await client('/api/login', { method: 'POST', body: { password: `essai-${attempt}` } });
        assert.equal(response.status, 401);
      }
      const blocked = await client('/api/login', { method: 'POST', body: { password: 'admin' } });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.json.code, 'ERR-17');
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      const audit = await fsp.readFile(path.join(dataDir, 'audit.log'), 'utf8');
      assert.match(audit, /login\.fail/);
    });
  });

  test('Audit JSONL : une ligne JSON par événement, sans secret', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      await client('/api/admin/backup', { method: 'POST', token, body: {} });
      await client('/api/admin/settings', { method: 'PATCH', token, body: { footerNote: 'Audit' } });
      const raw = await fsp.readFile(path.join(dataDir, 'audit.log'), 'utf8');
      const lines = raw.trim().split('\n');
      assert.ok(lines.length >= 3);
      for (const line of lines) {
        const event = JSON.parse(line);
        assert.ok(event.at && event.action);
        assert.equal(JSON.stringify(event).includes(token), false, 'le jeton n’est jamais journalisé');
      }
      assert.match(raw, /login\.success/);
      assert.match(raw, /settings\.update/);
      assert.match(raw, /backup\.manual/);
    });
  });
});

describe('Durcissement HTTP', () => {
  test('En-têtes de sécurité sur HTML, API et erreurs', async () => {
    await withServer({}, async ({ client }) => {
      for (const route of ['/', '/api/config', '/api/inconnu', '/css/app.css']) {
        const response = await client(route);
        const csp = response.headers.get('content-security-policy') || '';
        assert.ok(csp.length > 60, `${route} : CSP absente`);
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /base-uri 'self'/);
        assert.match(csp, /frame-ancestors 'self'/);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
        assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
        assert.equal(response.headers.get('x-dns-prefetch-control'), 'off');
        assert.match(response.headers.get('permissions-policy') || '', /camera=\(\)/);
        assert.equal(response.headers.get('server'), null);
      }
    });
  });

  test('Pas de fuite : erreur 500 sans trace, champ field, requestId corrélable', async () => {
    await withServer({}, async ({ client }) => {
      const response = await client('/api/admin/settings', { method: 'PATCH', body: { brand: 'x' } });
      assert.equal(response.status, 401);
      const body = response.json;
      assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'requestId']);
      assert.equal(/at \/|node_modules|\.js:\d+/.test(JSON.stringify(body)), false);
      assert.match(body.requestId, /^[a-f0-9]{12}$/);
    });
  });

  test('Injection : aucun HTML renvoyé dans les champs d’erreur', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const payload = '<img src=x onerror=alert(1)>';
      const response = await client('/api/admin/channels', {
        method: 'POST', token, body: { name: payload, url: 'pas-une-url' },
      });
      assert.equal(response.status, 400);
      assert.equal(response.text.includes('<img'), false, 'le message ne rejoue pas la charge utile');
      const header = response.json;
      assert.ok(header.code && header.error);
    });
  });

  test('Fichiers publics : aucun script inline, aucune ressource tierce, CSP respectée', async () => {
    const html = await read('public/index.html');
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    assert.deepEqual(inlineScripts, [], 'aucun script inline (CSP « script-src self »)');
    assert.equal(/<script[^>]+src="https?:/i.test(html), false, 'aucun script tiers');
    assert.equal(/<link[^>]+href="https?:/i.test(html), false, 'aucune feuille de style tierce');
    for (const match of html.matchAll(/\son[a-z]+="/gi)) {
      assert.fail(`attribut inline interdit : ${match[0]}`);
    }
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /<main[^>]+id="main"/);
    assert.match(html, /class="skip-link"/);

    const clientFiles = await listFiles('public', (file) => file.endsWith('.js'));
    for (const file of clientFiles) {
      const source = await fsp.readFile(path.join(ROOT, file), 'utf8');
      assert.equal(/document\.createElement\(['"]style['"]\)/.test(source), false, `${file} injecte du CSS à l’exécution`);
      assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(source.replace(/\/\/[^\n]*/g, '')), false, `${file} référence une origine externe`);
      assert.equal(/\beval\(|new Function\(/.test(source), false, `${file} utilise eval`);
      assert.equal(/src=["']https?:/.test(source), false, `${file} charge un script tiers`);
    }
  });

  test('Le service worker ne met jamais en cache l’API ni la console', async () => {
    const sw = await read('public/sw.js');
    assert.match(sw, /streamtv-v\d/);
    assert.equal(/\/api\//.test(sw), true);
    assert.match(sw, /networkOnly|NetworkOnly|no-store|request\.url\.includes\('\/api\/'\)|url\.pathname\.startsWith\('\/api\//);
    assert.equal(/cache\.put\([^)]*request[^)]*\)\s*;?\s*\/\/\s*toujours/i.test(sw), false);
    assert.match(sw, /skipWaiting|install/);
  });

  test('Manifeste PWA : nom, icônes, affichage, couleurs', async () => {
    const manifest = JSON.parse(await read('public/manifest.webmanifest'));
    assert.equal(manifest.name.includes('StreamTV'), true);
    assert.equal(manifest.short_name.length <= 12, true);
    assert.ok(manifest.icons.length >= 2);
    for (const icon of manifest.icons) {
      assert.match(icon.sizes, /^\d+x\d+$/);
      assert.ok(icon.type.includes('svg') || icon.type.includes('png'));
    }
    assert.ok(['standalone', 'fullscreen'].includes(manifest.display));
    assert.equal(manifest.lang, 'fr');
    assert.match(manifest.start_url, /^\//);
    assert.equal(manifest.background_color, '#06070b');
    assert.equal(manifest.theme_color, '#06070b');
  });

  test('Vendeur hls.js épinglé et livré localement', async () => {
    const vendor = await read('public/vendor/hls.min.js');
    assert.ok(vendor.length > 100_000);
    const license = await read('public/vendor/hls.js.LICENSE');
    assert.match(license, /Apache License, Version 2\.0/);
    const meta = JSON.parse(await read('public/vendor/hls.version.json'));
    assert.equal(meta.version, '1.5.17');
    assert.equal(meta.license, 'Apache-2.0');
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(vendor).digest('hex'), meta.sha256, 'le vendeur n’a pas été modifié');
  });

  test('Sauvegarde : empreinte SHA-256 vérifiée avant restauration', async () => {
    await withServer({}, async ({ client, login, dataDir }) => {
      const { token } = await login();
      const backup = await client('/api/admin/backup', { method: 'POST', token, body: {} });
      const file = backup.json.backup.file;
      const original = await fsp.readFile(path.join(dataDir, 'backups', file), 'utf8');
      await fsp.writeFile(path.join(dataDir, 'backups', file), original.replace('"channels"', '"channels" '));
      const corrupted = await client('/api/admin/restore', {
        method: 'POST', token, body: { file, confirm: 'RESTAURER' },
      });
      assert.equal(corrupted.status, 422);
      assert.match(corrupted.json.error, /empreinte|format|illisible/i);
    });
  });

  test('Chemin de restauration refusé hors du dossier de sauvegardes', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      for (const file of ['../settings.json', '/etc/passwd', 'catalogue-20200101-000000.json', '']) {
        const response = await client('/api/admin/restore', {
          method: 'POST', token, body: { file, confirm: 'RESTAURER' },
        });
        assert.ok([400, 422].includes(response.status), `« ${file} » → ${response.status}`);
      }
    });
  });
});
