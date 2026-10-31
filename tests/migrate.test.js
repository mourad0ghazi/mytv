// tests/migrate.test.js — F-24 : JSON v1 → SQL v2, réversible, idempotent, journalisé.
// On vérifie le schéma produit, l'échappement, l'aller-retour exact, l'idempotence et le journal.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { CHANNEL_FIELDS } from '../server/core/channels.js';
import {
  CHANNEL_COLUMNS, buildMigration, channelInserts, channelsFromSql, columnType, parseDataSql,
  schemaSql, sqlLiteral, verifyRoundTrip,
} from '../server/core/migrate.js';
import { ROOT, tempDataDir } from './helpers.js';

function channel(overrides = {}) {
  return {
    id: 'abc123def456',
    number: 1,
    name: 'Chaîne témoin',
    rawName: 'Chaine temoin',
    url: 'https://exemple.test/live.m3u8',
    urlNormalized: 'https://exemple.test/live.m3u8',
    logo: '',
    group: 'Généralistes',
    groupKind: 'genre',
    tvgId: 'Temoin.fr',
    tvgName: 'Temoin',
    category: 'divertissement',
    categoryLabel: 'Divertissement',
    categorySource: 'manual',
    confidence: 0.8123,
    reasons: ['décision manuelle confirmée'],
    quality: 'HD',
    language: 'fr',
    country: 'FR',
    tags: ['généraliste', 'hd'],
    hue: 210,
    visible: true,
    blocked: false,
    blockedReason: '',
    health: { status: 'up', checkedAt: '2026-10-25T10:00:00.000Z', latencyMs: 42, cors: true, httpStatus: 200, consecutiveFailures: 0 },
    variants: [],
    sourceId: 'seed',
    licenseNote: 'Flux public',
    manualOverride: true,
    featured: false,
    notes: '',
    createdAt: '2026-10-25T09:00:00.000Z',
    updatedAt: '2026-10-25T09:00:00.000Z',
    lastSeenInSourceAt: '2026-10-25T09:00:00.000Z',
    epgId: 'Temoin.fr',
    position: 0,
    ...overrides,
  };
}

async function writeChannels(dataDir, channels) {
  await fsp.writeFile(path.join(dataDir, 'channels.json'), `${JSON.stringify({
    version: 3, updatedAt: new Date().toISOString(), count: channels.length, channels,
  })}\n`, 'utf8');
}

const run = (args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('exit', (code) => resolve({ code, stdout, stderr }));
});

describe('Schéma PostgreSQL (F-24)', () => {
  test('les 36 colonnes du contrat sont présentes, typées, une seule fois', () => {
    const ddl = schemaSql();
    for (const field of CHANNEL_FIELDS) {
      assert.match(ddl, new RegExp(`\\n  ${field} (?:text|integer|numeric\\(4,2\\)|boolean|jsonb)`), `${field} absent du DDL`);
    }
    assert.equal(CHANNEL_COLUMNS.length, CHANNEL_FIELDS.length);
    assert.equal(new Set(CHANNEL_FIELDS).size, CHANNEL_FIELDS.length, 'aucun champ en double');
    assert.equal(columnType('id'), 'text');
    assert.equal(columnType('number'), 'integer');
    assert.equal(columnType('confidence'), 'numeric(4,2)');
    assert.equal(columnType('visible'), 'boolean');
    assert.equal(columnType('health'), 'jsonb');
  });

  test('le DDL est idempotent et ne supprime jamais de données', () => {
    const ddl = schemaSql();
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS channels/);
    assert.match(ddl, /CREATE INDEX IF NOT EXISTS/);
    assert.equal(/DROP TABLE|DROP DATABASE|TRUNCATE|DELETE FROM/i.test(ddl), false);
    assert.match(ddl, /INSERT INTO streamtv_schema[\s\S]*ON CONFLICT \(version\) DO NOTHING/);
  });

  test('les tables annexes existent : réglages, sources, apprentissage, importations, audit', () => {
    const ddl = schemaSql();
    for (const table of ['settings', 'sources', 'learning', 'ingestions', 'audit_log']) {
      assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} absent`);
    }
  });
});

describe('Littéraux SQL', () => {
  test('les apostrophes sont doublées, jamais concaténées', () => {
    assert.equal(sqlLiteral("L'Équipe"), "'L''Équipe'");
    assert.equal(sqlLiteral("'; DROP TABLE channels; --"), "'''; DROP TABLE channels; --'");
    assert.equal(sqlLiteral(null), 'NULL');
    assert.equal(sqlLiteral(undefined), 'NULL');
    assert.equal(sqlLiteral(true, 'boolean'), 'TRUE');
    assert.equal(sqlLiteral(false, 'boolean'), 'FALSE');
    assert.equal(sqlLiteral('12', 'integer'), '12');
    assert.equal(sqlLiteral('pas-un-nombre', 'integer'), 'NULL');
    assert.equal(sqlLiteral({ a: 1 }, 'jsonb'), `'{"a":1}'`);
  });
});

describe('Aller-retour et idempotence', () => {
  test('un aller-retour conserve accents, guillemets, retours ligne et arabe', () => {
    const tricky = channel({
      id: 'tricky000001',
      name: 'Canal "Élite"\nعربية & <balises>',
      notes: "ligne 1\nligne 2\tavec tabulation et 'apostrophe'",
      reasons: ['a', "b'c"],
      tags: [],
    });
    const result = verifyRoundTrip([tricky]);
    assert.equal(result.ok, true, `différence à la ligne ${result.firstDifference}`);
    const back = channelsFromSql(channelInserts([tricky]).sql)[0];
    assert.equal(back.name, tricky.name);
    assert.equal(back.notes, tricky.notes);
    assert.deepEqual(back.reasons, tricky.reasons);
    assert.deepEqual(back.health, tricky.health);
  });

  test('deux exports du même catalogue sont identiques (empreintes égales)', () => {
    const channels = [channel(), channel({ id: 'zzz999', number: 2, name: 'Deuxième' })];
    const first = buildMigration({ channels, settings: { brand: 'StreamTV', pageSize: 48 } });
    const second = buildMigration({ channels: [...channels].reverse(), settings: { pageSize: 48, brand: 'StreamTV' } });
    assert.equal(first.checksums.data, second.checksums.data, 'l’ordre d’entrée ne change pas le fichier');
    assert.equal(first.checksums.schema, second.checksums.schema);
  });

  test('les INSERT sont rejouables : ON CONFLICT met à jour sans doublon', () => {
    const { sql } = channelInserts([channel()]);
    assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET/);
    assert.equal((sql.match(/INSERT INTO channels/g) || []).length, 1);
    assert.equal(/INSERT INTO channels[\s\S]*createdAt/.test(sql), true, 'toutes les colonnes sont écrites');
  });

  test('les tables annexes sont relues : réglages, apprentissage', () => {
    const migration = buildMigration({
      channels: [channel()],
      settings: { brand: 'StreamTV', pageSize: 48, maintenanceMode: false },
      learning: { rules: { sport: ['rugby|1'] }, learned: { sport: ['sport|0.5'] }, corrections: [{ to: 'sport' }] },
    });
    const { tables } = parseDataSql(migration.data);
    const brand = tables.settings.find((row) => row.key === 'brand');
    assert.equal(brand.value, 'StreamTV');
    assert.equal(tables.settings.find((row) => row.key === 'pageSize').value, 48);
    assert.deepEqual(tables.learning[0].learned, { sport: ['sport|0.5'] });
    assert.deepEqual(tables.learning[0].corrections, [{ to: 'sport' }]);
  });

  test('un lot volumineux reste borné en taille de requête', () => {
    const channels = Array.from({ length: 450 }, (_, index) => channel({ id: `id${String(index).padStart(8, '0')}`, number: index + 1 }));
    const { sql, count } = channelInserts(channels);
    assert.equal(count, 450);
    assert.equal((sql.match(/INSERT INTO channels/g) || []).length, 3, 'paquets de 200');
  });

  test('un catalogue vide produit un fichier de données valide, sans INSERT de chaîne', () => {
    const migration = buildMigration({ channels: [] });
    assert.equal(migration.counts.channels, 0);
    assert.equal(/INSERT INTO channels/.test(migration.data), false);
    assert.match(migration.data, /BEGIN;/);
    assert.match(migration.data, /COMMIT;/);
  });
});

describe('Script de migration (F-24)', () => {
  test('--verify sort en 0 et annonce la réversibilité', async () => {
    const dataDir = await tempDataDir();
    const result = await run(['--verify'], { DATA_DIR: dataDir });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /identiques\s+oui/);
    assert.match(result.stdout, /idempotence\s+oui/);
    assert.match(result.stdout, /réversibilité\s+oui/);
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  test('--write produit les trois fichiers et journalise l’action', async () => {
    const dataDir = await tempDataDir();
    await writeChannels(dataDir, [channel(), channel({ id: 'second000001', number: 2, name: 'Deuxième' })]);
    const result = await run(['--write'], { DATA_DIR: dataDir });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Migration préparée/);
    const dirs = await fsp.readdir(path.join(dataDir, 'migrations'));
    assert.equal(dirs.length, 1);
    const dir = path.join(dataDir, 'migrations', dirs[0]);
    const files = await fsp.readdir(dir);
    assert.deepEqual(files.sort(), ['data.sql', 'manifest.json', 'schema.sql']);
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.reversible, true);
    assert.equal(manifest.idempotent, true);
    assert.equal(manifest.checksums.data.length, 64);
    const audit = await fsp.readFile(path.join(dataDir, 'audit.log'), 'utf8');
    assert.match(audit, /migration\.export/);
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  test('--plan n’écrit rien et annonce le seuil de bascule', async () => {
    const dataDir = await tempDataDir();
    await writeChannels(dataDir, [channel()]);
    const result = await run(['--plan'], { DATA_DIR: dataDir });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /seuil de bascule\s+30000 chaînes/);
    assert.match(result.stdout, /Aucune écriture effectuée/);
    assert.equal((await fsp.readdir(dataDir)).includes('migrations'), false, 'aucun dossier de migration créé');
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  test('--reverse reconstruit un JSON équivalent depuis un data.sql', async () => {
    const dataDir = await tempDataDir();
    await writeChannels(dataDir, [channel(), channel({ id: 'second000001', number: 2, name: 'Deuxième' })]);
    const written = await run(['--write'], { DATA_DIR: dataDir });
    assert.equal(written.code, 0, written.stderr);
    const dirs = await fsp.readdir(path.join(dataDir, 'migrations'));
    const dataFile = path.join(dataDir, 'migrations', dirs[0], 'data.sql');
    const back = await run(['--reverse', dataFile], { DATA_DIR: dataDir });
    assert.equal(back.code, 0, back.stderr);
    assert.match(back.stdout, /Retour arrière préparé/);
    const files = (await fsp.readdir(path.join(dataDir, 'migrations'))).filter((name) => name.startsWith('reversed-'));
    assert.equal(files.length, 1);
    const restored = JSON.parse(await fsp.readFile(path.join(dataDir, 'migrations', files[0]), 'utf8'));
    assert.ok(restored.count > 0);
    assert.equal(restored.channels.length, restored.count);
    assert.ok(restored.channels.every((entry) => entry.id && entry.name));
    await fsp.rm(dataDir, { recursive: true, force: true });
  });
});
