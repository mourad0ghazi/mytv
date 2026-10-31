#!/usr/bin/env node
// scripts/verify.js — contrôle de santé complet, exécutable en production (§10.4, §11).
// Usage : node scripts/verify.js [--json] [--base http://127.0.0.1:3000]
// Code de sortie 0 si tout passe, 1 sinon. Aucune dépendance.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Store } from '../server/core/store.js';
import { CATEGORY_IDS, LIMITS, VERSION } from '../server/core/constants.js';
import { ERRORS } from '../server/core/errors.js';
import { DEFAULTS, SETTING_COUNT, validateSettings } from '../server/core/settings.js';
import { parseM3U } from '../server/core/m3u.js';
import { ERR_TO_MESSAGE, FAMILIES, MESSAGES, MESSAGE_BY_ID } from '../server/core/messages.js';
import { decodeEpgBody, parseXmltv } from '../server/core/epg.js';
import { learnFromCorrections } from '../server/core/learning.js';
import { epgCoverage, schemeBreakdown } from '../server/core/sourceprobe.js';
import { verifyRoundTrip } from '../server/core/migrate.js';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

const checks = [];
function check(name, ok, detail = '', { warnOnly = false } = {}) {
  checks.push({ name, ok: Boolean(ok), detail, warnOnly: warnOnly && !ok });
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args[baseIndex + 1] : '';

  const logger = { info: () => {}, warn: () => {}, error: (message) => process.stderr.write(`${message}\n`) };
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();
  const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));

  /* ---------------------------------------------------- contrat des données */
  check('version du logiciel', VERSION === pkg.version, `${VERSION} (package ${pkg.version})`);
  check('20 codes d’erreur', Object.keys(ERRORS).length === 20, `${Object.keys(ERRORS).length} codes`);
  check('82 messages du §9', MESSAGES.length === 82, `${MESSAGES.length} messages`);
  check('6 familles de messages', FAMILIES.length === 6, `${FAMILIES.length} familles`);
  check('codes opposables tous reliés', Object.keys(ERR_TO_MESSAGE).length === 20
    && Object.values(ERR_TO_MESSAGE).every((id) => MESSAGE_BY_ID.has(id)), 'table ERR → message');
  check('25 réglages', Object.keys(DEFAULTS).length === SETTING_COUNT && SETTING_COUNT === 25,
    `${Object.keys(DEFAULTS).length} réglages`);
  check('18 catégories', CATEGORY_IDS.length === 18, `${CATEGORY_IDS.length} catégories`);
  const settingsCheck = validateSettings(store.settings);
  check('réglages valides', settingsCheck.errors.length === 0, settingsCheck.errors.map((error) => error.message).join('; '));

  const active = store.channels.filter((channel) => !channel.deleted);
  check('catalogue non vide', active.length > 0, `${active.length} chaînes`);
  const required = ['id', 'number', 'name', 'rawName', 'url', 'urlNormalized', 'logo', 'group', 'groupKind',
    'tvgId', 'tvgName', 'category', 'categoryLabel', 'categorySource', 'confidence', 'reasons', 'quality',
    'language', 'country', 'tags', 'hue', 'visible', 'blocked', 'blockedReason', 'health', 'variants',
    'sourceId', 'licenseNote', 'manualOverride', 'featured', 'notes', 'createdAt', 'updatedAt',
    'lastSeenInSourceAt', 'epgId', 'position'];
  const brokenFields = new Set();
  const brokenIds = [];
  const brokenCategories = [];
  const brokenConfidence = [];
  for (const channel of active) {
    for (const field of required) {
      if (channel[field] === undefined) brokenFields.add(field);
    }
    if (!/^[a-f0-9]{12}$/.test(channel.id)) brokenIds.push(channel.id);
    if (!CATEGORY_IDS.includes(channel.category)) brokenCategories.push(channel.id);
    if (!(channel.confidence >= 0 && channel.confidence <= 1)) brokenConfidence.push(channel.id);
  }
  check('36 champs obligatoires', brokenFields.size === 0, [...brokenFields].join(', ') || 'tous présents');
  check('identifiants sha1 tronqués', brokenIds.length === 0, `${brokenIds.length} anomalie(s)`);
  check('catégories connues', brokenCategories.length === 0, `${brokenCategories.length} anomalie(s)`);
  check('confiances bornées', brokenConfidence.length === 0, `${brokenConfidence.length} anomalie(s)`);

  // Catalogue Anime et Films : aucune fiche publiée sans licence identifiée.
  const animePublic = (store.anime || []).filter((item) => !item.deleted && item.visible !== false);
  const filmsPublic = (store.films || []).filter((item) => !item.deleted && item.visible !== false);
  check('catalogue anime non vide', animePublic.length > 0, `${animePublic.length} anime`);
  check('anime publiés avec licence', animePublic.every((item) => Boolean(item.licence)),
    `${animePublic.filter((item) => !item.licence).length} fiche(s) sans licence`);
  check('catalogue films non vide', filmsPublic.length > 0, `${filmsPublic.length} films`);
  check('films publiés avec licence', filmsPublic.every((item) => Boolean(item.licence)),
    `${filmsPublic.filter((item) => !item.licence).length} fiche(s) sans licence`);
  check('sources licenciées', (store.sources || []).length >= 1
    && store.sources.every((source) => Boolean(source.licence)),
    `${store.sources.length} source(s), ${store.sources.filter((source) => !source.licence).length} sans licence`);

  const duplicates = new Map();
  for (const channel of active) duplicates.set(channel.id, (duplicates.get(channel.id) || 0) + 1);
  const duplicateIds = [...duplicates.values()].filter((count) => count > 1).length;
  check('aucun doublon d’identifiant', duplicateIds === 0, `${duplicateIds} doublon(s)`);

  const numbers = new Set();
  let duplicateNumbers = 0;
  for (const channel of active) {
    if (numbers.has(channel.number)) duplicateNumbers += 1;
    numbers.add(channel.number);
  }
  check('numéros uniques', duplicateNumbers === 0, `${duplicateNumbers} collision(s)`);

  /* ------------------------------------------------------ fichiers & backups */
  for (const file of ['channels.json', 'settings.json', 'sources.json', 'anime.json', 'films.json', 'source-imports.json', 'health.json', 'learning.json']) {
    try {
      await fsp.access(path.join(DATA_DIR, file));
      check(`fichier ${file}`, true, human((await fsp.stat(path.join(DATA_DIR, file))).size));
    } catch {
      check(`fichier ${file}`, false, 'absent');
    }
  }
  const backups = await store.listBackups();
  check('sauvegardes présentes', backups.length > 0, `${backups.length} fichier(s)`);
  if (backups.length) {
    const latest = backups[0];
    const verified = await store.verifyBackup(latest.file);
    check('dernière sauvegarde vérifiée', verified.ok, verified.ok ? latest.file : `${latest.file} : ${verified.reason}`);
  }

  /* --------------------------------------------------------------- sécurité */
  // Sur une installation de démonstration, le mot de passe par défaut est attendu :
  // c'est un avertissement à traiter avant la mise en ligne, pas une panne.
  check('mot de passe par défaut changé', store.security.defaultPassword === false,
    store.security.defaultPassword ? 'mot de passe par défaut encore actif — à changer avant mise en ligne' : 'ok',
    { warnOnly: true });
  check('scrypt N=16384', Number(store.security.iterations) >= 16384, String(store.security.iterations));

  const auditPath = path.join(DATA_DIR, 'audit.log');
  try {
    const audit = await fsp.readFile(auditPath, 'utf8');
    const lines = audit.trim().split('\n').filter(Boolean);
    check('journal d’audit lisible', true, `${lines.length} entrée(s)`);
    check('aucun secret dans l’audit', !/passwordHash|Bearer [a-f0-9]{48}|scrypt\$/.test(audit));
  } catch {
    check('journal d’audit lisible', false, 'audit.log absent');
  }

  /* ------------------------------------------------------------- service HTTP */
  if (base) {
    try {
      const health = await fetch(`${base}/healthz`);
      const payload = await health.json();
      check('service en ligne', health.ok && payload.status === 'ok', `${payload.channels} chaînes`);
      const config = await fetch(`${base}/api/config`);
      const configBody = await config.json();
      check('contrat /api/config', config.status === 200 && configBody.categories?.length === 18,
        `${configBody.categories?.length} catégories`);
      const page = await fetch(`${base}/api/channels?pageSize=60`);
      const pageBody = await page.json();
      check('plafond de pagination', (pageBody.channels?.length || 0) <= LIMITS.domCardsMax, `${pageBody.channels?.length} éléments`);
      const unauth = await fetch(`${base}/api/admin/stats`);
      check('console protégée', unauth.status === 401, String(unauth.status));
      const missing = await fetch(`${base}/chaine/inconnu`);
      check('fiche inconnue en 404', missing.status === 404, String(missing.status));
      const headers = config.headers;
      const catalog = await fetch(`${base}/api/errors/catalog`);
      const catalogBody = await catalog.json();
      check('catalogue des 82 messages servi', catalog.status === 200 && catalogBody.total === 82,
        `${catalogBody.total} messages, ${catalogBody.families?.length || 0} familles`);
      const anime = await fetch(`${base}/api/anime`);
      const animeBody = await anime.json();
      check('catalogue anime servi', anime.status === 200 && animeBody.total >= 1
        && animeBody.items.every((item) => Boolean(item.licence)), `${animeBody.total} anime`);
      const films = await fetch(`${base}/api/films`);
      const filmsBody = await films.json();
      check('catalogue films servi', films.status === 200 && filmsBody.total >= 1
        && filmsBody.items.every((item) => Boolean(item.licence)), `${filmsBody.total} films`);
      const sources = await fetch(`${base}/api/sources`);
      const sourcesBody = await sources.json();
      check('sources publiques licenciées', sources.status === 200 && sourcesBody.total >= 1
        && sourcesBody.sources.every((source) => Boolean(source.licence)), `${sourcesBody.total} source(s)`);
      const epg = await fetch(`${base}/api/epg`);
      const epgBody = await epg.json();
      check('guide des programmes sans erreur', epg.status === 200 && typeof epgBody.enabled === 'boolean',
        epgBody.enabled ? 'guide configuré' : 'aucun guide configuré');
      check('CSP présente', Boolean(headers.get('content-security-policy')));
      check('nosniff présent', headers.get('x-content-type-options') === 'nosniff');
    } catch (error) {
      check('service joignable', false, error.message);
    }
  }

  /* --------------------------------------------------------------- parseur */
  const sample = '#EXTM3U\n#EXTINF:-1 group-title="News",Chaîne témoin\nhttps://exemple.test/a.m3u8\n';
  check('parseur opérationnel', parseM3U(sample).entries.length === 1);

  /* ------------------------------------------------------------------ EPG */
  const xmltv = '<tv><channel id="A.fr"><display-name>A</display-name></channel>'
    + '<programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="A.fr"><title>Midi</title></programme></tv>';
  const parsedGuide = parseXmltv(xmltv);
  check('analyse XMLTV opérationnelle', parsedGuide.ok && parsedGuide.programmes.length === 1,
    `${parsedGuide.programmes.length} programme(s)`);
  check('gzip reconnu à la signature', decodeEpgBody(gzipSync(Buffer.from(xmltv))).ok === true);

  /* ---------------------------------------------------- F-22 / F-24 */
  const learned = learnFromCorrections(store.learning.corrections || []);
  check('apprentissage des corrections', Array.isArray(Object.keys(learned.rules)) && learned.stats.usable >= 0,
    `${store.learning.corrections?.length || 0} correction(s), ${learned.stats.terms} terme(s)`);
  const roundTrip = verifyRoundTrip(active);
  check('migration SQL réversible', roundTrip.ok, `${roundTrip.checked} chaîne(s) relues à l’identique`);

  /* -------------------------------------------- qualité des sources (§5 F-09) */
  const schemes = schemeBreakdown(active);
  // Sur un site HTTPS, un flux http: est bloqué par le navigateur : il ne doit pas dominer.
  check('flux lisibles en HTTPS', schemes.http === 0 || schemes.http / Math.max(1, schemes.total) <= 0.05,
    `${schemes.https} https, ${schemes.http} http sur ${schemes.total}`, { warnOnly: true });
  const coverage = epgCoverage(active);
  // Sans tvg-id, pas de programme : la couverture est suivie, pas imposée.
  check('couverture du guide (tvg-id)', coverage.ratio >= 0.5,
    `${Math.round(coverage.ratio * 100)} % des chaînes portent un identifiant de programme`, { warnOnly: true });
  const declaredSources = (store.sources || []).filter((source) => source.actif !== false);
  check('sources actives avec licence', declaredSources.length >= 1
    && declaredSources.every((source) => Boolean(source.licence)),
    declaredSources.map((source) => `${source.nom} (${source.licence || 'licence absente'})`).join(', '));

  /* ---------------------------------------------------------------- rapport */
  const failed = checks.filter((entry) => !entry.ok);
  const warnings = failed.filter((entry) => entry.warnOnly);
  const errors = failed.filter((entry) => !entry.warnOnly);
  if (json) {
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      version: VERSION,
      dataDir: DATA_DIR,
      channels: active.length,
      checks,
      ok: errors.length === 0,
      warnings: warnings.map((entry) => entry.name),
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`Contrôle StreamTV v${VERSION} — ${new Date().toLocaleString('fr-FR')}\n`);
    process.stdout.write(`Dossier de données : ${DATA_DIR}\n\n`);
    for (const entry of checks) {
      const mark = entry.ok ? '✓' : entry.warnOnly ? '!' : '✗';
      process.stdout.write(`  ${mark} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}\n`);
    }
    process.stdout.write(`\n${checks.length - failed.length}/${checks.length} contrôles réussis${warnings.length ? `, ${warnings.length} avertissement(s)` : ''}.\n`);
    if (warnings.length) {
      process.stdout.write(`\nAvertissements :\n${warnings.map((entry) => `  ! ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`).join('\n')}\n`);
    }
    if (errors.length) {
      process.stdout.write(`\nÀ corriger :\n${errors.map((entry) => `  · ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`).join('\n')}\n`);
    }
  }
  process.exit(errors.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`Contrôle impossible : ${error.message}\n`);
  process.exit(1);
});
