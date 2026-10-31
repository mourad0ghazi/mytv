// server/index.js — point d'entrée unique : fichiers statiques, API, repli SPA, tâches d'exploitation.
// Aucune dépendance externe : node:http, node:fs, node:crypto et le reste de la bibliothèque standard.

import fsp from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CATEGORY_BY_ID, LIMITS, VERSION } from './core/constants.js';
import { Store } from './core/store.js';
import { SearchIndex } from './core/search.js';
import { Ingest } from './core/ingest.js';
import { ProbeLimiter } from './core/health.js';
import { PROBE_NIGHTLY_LIMIT } from './core/probe-plan.js';
import { lancerRonde } from './core/probe-runner.js';
import { EpgCache } from './core/epg.js';
import { computeAlerts } from './core/alerts.js';
import { can } from './core/team.js';
import { LoginGuard, Sessions, bootstrapPassword, verifyPassword } from './core/auth.js';
import { mailConfig, mailReady, sendMail } from './core/mailer.js';
import { TwoFactor } from './core/twofactor.js';
import { ACCOUNT_SESSION_TTL_MS, Users } from './core/users.js';
import { buildChannel, isPublic, sanitizeChannel } from './core/channels.js';
import { categorizeEntry, compileRules } from './core/classify.js';
import { dedupe, finalizeEntries } from './core/dedupe.js';
import { parseM3U } from './core/m3u.js';
import { Router } from './http/router.js';
import { sendError, sendSecurityHeaders, sendText } from './http/respond.js';
import { resolvePublic, serveStatic } from './http/static.js';
import { registerPublicRoutes } from './api/public.js';
import { registerRelayRoutes } from './api/relay.js';
import { registerReportRoutes } from './api/report.js';
import { registerConsoleRoutes } from './api/console.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerVodRoutes } from './api/vod.js';
import { registerSourcesRoutes } from './api/admin-sources.js';
import { registerVodAdminRoutes } from './api/admin-vod.js';
import { registerDocumentationRoutes } from './api/admin-doc.js';
import { registerAccountRoutes } from './api/accounts.js';
import { registerAdminMembersRoutes } from './api/admin-members.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SEED_FILE = path.join(DATA_DIR, 'seed', 'seed.m3u');

const logger = {
  info: (message) => process.stdout.write(`[${new Date().toISOString()}] ${message}\n`),
  warn: (message) => process.stdout.write(`[${new Date().toISOString()}] ATTENTION ${message}\n`),
  error: (message) => process.stderr.write(`[${new Date().toISOString()}] ERREUR ${message}\n`),
  debug: () => {},
};

function buildContentSecurity() {
  return { https: Boolean(process.env.HTTPS) };
}

async function seedFromFile(app) {
  if (app.store.channels.length) return 0;
  let raw = '';
  try {
    raw = await fsp.readFile(SEED_FILE, 'utf8');
  } catch {
    logger.warn('aucune liste de démonstration : le catalogue démarre vide');
    return 0;
  }
  const parsed = parseM3U(raw, { sourceLabel: 'démonstration', siteProtocol: app.siteProtocol });
  if (!parsed.entries.length) {
    logger.warn('liste de démonstration illisible : catalogue vide');
    return 0;
  }
  const deduped = dedupe(parsed.entries);
  const entries = finalizeEntries(deduped.entries);
  const table = compileRules(app.store.learning.rules);
  const now = new Date().toISOString();
  let number = 1;
  for (const entry of entries) {
    const classification = categorizeEntry(entry, table);
    const channel = buildChannel({
      entry,
      number,
      category: CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre,
      classification,
      sourceId: 'démonstration',
      licenseNote: 'libre accès public',
      siteProtocol: app.siteProtocol,
      now,
      position: number - 1,
    });
    if (channel.category === 'adulte' && app.store.settings.autoHideAdult && !app.store.settings.showAdult) {
      channel.visible = false;
    }
    const { channel: clean } = sanitizeChannel(channel, { index: number - 1, siteProtocol: app.siteProtocol });
    app.store.channels.push(clean || channel);
    number += 1;
  }
  await app.store.saveChannels('seed');
  await app.store.backup('initial');
  logger.info(`catalogue de démonstration créé : ${app.store.channels.length} chaînes`);
  return app.store.channels.length;
}

async function rotateLogs(dataDir) {
  const logsDir = path.join(dataDir, 'logs');
  try {
    const names = await fsp.readdir(logsDir);
    const cutoff = Date.now() - 14 * 86400000;
    for (const name of names) {
      const full = path.join(logsDir, name);
      try {
        const stat = await fsp.stat(full);
        if (stat.mtimeMs < cutoff) await fsp.unlink(full);
      } catch { /* fichier disparu */ }
    }
  } catch { /* pas encore de journaux */ }
  try {
    const auditFile = path.join(dataDir, 'audit.log');
    const raw = await fsp.readFile(auditFile, 'utf8');
    const cutoff = Date.now() - LIMITS.auditRetentionDays * 86400000;
    const kept = raw.split('\n').filter((line) => {
      if (!line.trim()) return false;
      try { return new Date(JSON.parse(line).at).getTime() >= cutoff; } catch { return false; }
    });
    if (kept.length !== raw.split('\n').filter(Boolean).length) {
      await fsp.writeFile(auditFile, `${kept.join('\n')}\n`, { mode: 0o600 });
    }
  } catch { /* journal absent */ }
}

function scheduleDaily(task, hour = 3) {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - Date.now();
  const timer = setTimeout(async () => {
    try { await task(); } catch (error) { logger.error(`tâche planifiée: ${error.message}`); }
    scheduleDaily(task, hour);
  }, Math.min(delay, 2 ** 31 - 1));
  timer.unref?.();
  return timer;
}

export async function createApp() {
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();
  const app = {
    version: VERSION,
    store,
    index: new SearchIndex(),
    sessions: new Sessions(),
    loginGuard: new LoginGuard(),
    reportGuard: new LoginGuard({ max: LIMITS.reportsPerHour, windowMs: 3600_000 }),
    probeLimiter: new ProbeLimiter(),
    epg: new EpgCache({ publicDir: PUBLIC_DIR }),
    ingest: null,
    // Le site est servi en HTTPS (derrière le proxy) : les flux http: sont donc bloqués par le navigateur.
    siteProtocol: 'https:',
    startedAt: new Date().toISOString(),
    measureCache: { at: 0, value: null },
    notices: () => {
      const list = [];
      if (store.security.defaultPassword) {
        list.unshift('Mot de passe par défaut actif. Changez-le maintenant pour protéger votre catalogue.');
      }
      if (store.settings.maintenanceMode) {
        list.push('Le service est en maintenance. Le catalogue reste consultable, la lecture peut être interrompue.');
      }
      for (const notice of store.notices) list.push(notice);
      return list.slice(0, 6);
    },
    auth: {
      verify: (password) => verifyPassword(password, store.security),
      isDefaultPasswordActive: () => Boolean(store.security.defaultPassword),
    },
  };

  // Envoi du code de connexion : configuration par l'environnement, jamais par le dépôt.
  app.mail = mailConfig();
  app.mailer = {
    send: (message) => sendMail(app.mail, message),
    test: () => sendMail(app.mail, {
      to: store.settings.adminEmail,
      subject: 'Test d’envoi StreamTV',
      text: 'Cet envoi confirme que la console peut vous joindre. Aucun code n’est contenu dans ce message.',
    }),
  };
  // Prêt côté serveur : un serveur d'envoi configuré, une adresse de destination enregistrée.
  app.smtpReady = () => mailReady(app.mail);
  app.mailReady = () => app.smtpReady() && Boolean(String(store.settings.adminEmail || '').trim());
  app.twoFactor = new TwoFactor();

  // Comptes visiteurs : registre de sessions distinct de la console. Un jeton visiteur ne
  // figure jamais dans app.sessions, donc aucune route /api/admin/* ne l'accepte.
  app.accountSessions = new Sessions({ ttlMs: ACCOUNT_SESSION_TTL_MS, max: 5000 });
  app.users = new Users({
    store,
    mailReady: () => app.smtpReady(),
    registrationOpen: () => store.settings.registrationMode !== 'ferme',
    deliver: (message) => sendMail(app.mail, message),
  });

  try {
    await bootstrapPassword(store);
  } catch (error) {
    // En production, un mot de passe de démonstration est un refus de démarrage, pas un avertissement.
    logger.error(error.message || 'ADMIN_PASSWORD est obligatoire en production.');
    logger.error('Démarrage interrompu : définissez ADMIN_PASSWORD puis relancez le service.');
    process.exitCode = 1;
    throw error;
  }
  app.ingest = new Ingest({ store, index: app.index, logger, siteProtocol: app.siteProtocol, dataDir: DATA_DIR });
  await app.ingest.loadHistory();
  await seedFromFile(app);
  app.index.rebuild(store.channels.filter((channel) => !channel.deleted));

  const router = new Router({
    sessions: app.sessions,
    logger,
    authorize: (session, permission) => can(session?.role, permission),
  });
  registerPublicRoutes(router, app);
  // Essai local et tests : le relais accepte HTTP sur la boucle locale. Jamais en production.
  app.relayInsecure = process.env.STREAMTV_RELAIS_HTTP === '1';
  registerRelayRoutes(router, app);
  registerVodRoutes(router, app);
  registerAdminRoutes(router, app);
  registerSourcesRoutes(router, app);
  registerVodAdminRoutes(router, app);
  registerDocumentationRoutes(router, app);
  registerReportRoutes(router, app);
  registerAccountRoutes(router, app);
  registerAdminMembersRoutes(router, app);
  registerConsoleRoutes(router, app);
  app.alerts = ({ renderCards = null } = {}) => computeAlerts(store, {
    now: Date.now(),
    logger,
    ingestions: app.ingest ? app.ingest.ingestions : [],
    renderCards,
  });
  app.routeCount = router.routes.length;
  app.router = router;

  scheduleDaily(async () => {
    const backup = await store.backup('auto');
    logger.info(`sauvegarde quotidienne : ${backup.file}`);
    await rotateLogs(DATA_DIR);
    // Ronde nocturne : le lot suivant du catalogue, pas toujours les mêmes quarante chaînes.
    // Le curseur est écrit dans health.json : un redémarrage reprend où la mesure s'était arrêtée.
    try {
      const result = await lancerRonde(app, { limit: PROBE_NIGHTLY_LIMIT, actor: 'scheduler' });
      logger.info(`ronde nocturne : ${result.up} ok, ${result.flaky} instables, ${result.down} hs, `
        + `${result.probe.remaining} restantes (${result.probe.nights} nuit(s) pour finir le tour)`);
    } catch (error) {
      logger.warn(`ronde nocturne impossible: ${error.message}`);
    }
  }, 3);

  return { app, router };
}

function acceptsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

async function serveSpa(req, res, { status = 200, headers = {} } = {}) {
  const file = path.join(PUBLIC_DIR, 'index.html');
  let buffer;
  try {
    buffer = await fsp.readFile(file);
  } catch {
    sendText(req, res, 500, 'La page principale est introuvable. Réinstallez les fichiers publics.', { head: req.method === 'HEAD' });
    return;
  }
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', String(buffer.length));
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(buffer);
}

export async function main(options = {}) {
  const { app, router } = await createApp();
  const port = Number(options.port || process.env.PORT || 3000);
  const host = options.host || process.env.HOST || '0.0.0.0';

  // Chiffrement natif : avec un certificat et sa clé, le serveur parle HTTPS directement.
  // Sans certificat, il reste en HTTP derrière un proxy ou un tunnel qui fournit le TLS.
  const certPath = process.env.STREAMTV_TLS_CERT || '';
  const keyPath = process.env.STREAMTV_TLS_KEY || '';
  let tlsOptions = null;
  if (certPath && keyPath) {
    try {
      tlsOptions = { key: await fsp.readFile(path.resolve(keyPath)), cert: await fsp.readFile(path.resolve(certPath)) };
    } catch (error) {
      throw new Error(`Certificat TLS illisible : ${error.message}`);
    }
  }

  const handler = async (req, res) => {
    const started = Date.now();
    try {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const https = forwardedProto === 'https' || Boolean(req.socket.encrypted) || Boolean(process.env.HTTPS);
      app.siteProtocol = 'https:';
      sendSecurityHeaders(res);

      let pathname = '/';
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://internal').pathname);
      } catch {
        sendText(req, res, 400, 'Adresse invalide.');
        return;
      }
      if (pathname.length > 512) { sendText(req, res, 414, 'Adresse trop longue.'); return; }

      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

      if (await router.handle(req, res, { https, ip, security: app.store.security })) return;

      if (req.method === 'GET' || req.method === 'HEAD') {
        const target = resolvePublic(PUBLIC_DIR, pathname);
        const hasExtension = /\.[a-z0-9]{2,6}$/i.test(pathname);
        if (target && await serveStatic(req, res, pathname, { publicDir: PUBLIC_DIR })) return;

        if (!hasExtension && !pathname.startsWith('/api/')) {
          // Entrée secrète : la console n'existe qu'à cette adresse. Partout ailleurs, et
          // notamment sur /admin, la réponse est la même qu'une page inconnue.
          const secretPath = `/${app.store.settings.adminPath}`;
          if (pathname === secretPath || pathname === `${secretPath}/`) {
            await serveSpa(req, res, {
              status: 200,
              headers: { 'Set-Cookie': `stv_entry=1; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}` },
            });
            return;
          }
          const known = ['/', '/guide', '/favoris', '/connexion', '/mentions-legales', '/confidentialite',
            '/signaler', '/aide', '/erreurs', '/recherche', '/anime', '/films',
            '/compte', '/compte/inscription', '/compte/connexion'];
          // Une fiche de chaîne n'est servie en 200 que si l'identifiant existe réellement :
          // une adresse inventée répond 404, jamais le catalogue (BUG-06).
          const channelMatch = /^\/chaine\/([A-Za-z0-9_-]{1,32})\/?$/.exec(pathname);
          const channelExists = channelMatch
            ? app.store.channels.some((channel) => channel.id === channelMatch[1]
              && !channel.deleted && isPublic(channel, app.store.settings))
            : false;
          // Même règle pour les fiches anime et film : une adresse inventée répond 404.
          const vodMatch = /^\/(?:anime|film)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(pathname);
          let vodExists = false;
          if (vodMatch) {
            const collection = pathname.startsWith('/anime/') ? app.store.anime : app.store.films;
            vodExists = collection.some((item) => item.id === vodMatch[1]
              && !item.deleted && item.visible !== false && !item.blocked);
          }
          // Lien d'accès : la page est servie, le jeton est vérifié par l'API côté client.
          const lienAcces = /^\/acces\/[a-f0-9]{64}\/?$/.test(pathname);
          const isKnown = known.includes(pathname) || channelExists || vodExists || lienAcces;
          await serveSpa(req, res, { status: isKnown ? 200 : 404 });
          return;
        }
      }

      if (pathname.startsWith('/api/')) {
        sendError(req, res, 'ERR-11', { requestId: '' });
        return;
      }
      sendText(req, res, 404, 'Cette adresse n’existe pas. Revenez au catalogue : /', { head: req.method === 'HEAD' });
      if (Date.now() - started > 1000) logger.warn(`réponse lente ${req.method} ${pathname}`);
    } catch (error) {
      logger.error(`requête non gérée: ${error?.message}`);
      if (!res.headersSent) sendText(req, res, 500, 'Une erreur interne est survenue. Réessayez.');
    }
  };

  const server = tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler);
  if (tlsOptions) logger.info('TLS actif : le trafic est chiffré de bout en bout.');

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 130_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logger.info(`${app.store.settings.brand} v${app.version} — ${app.store.channels.length} chaînes, ${app.routeCount} routes`);
  logger.info(`écoute sur ${tlsOptions ? 'https' : 'http'}://${host}:${port}`);

  const shutdown = async (signal) => {
    logger.info(`arrêt demandé (${signal})`);
    server.close();
    try { await app.store.flush(); } catch { /* écriture déjà terminée */ }
    setTimeout(() => process.exit(0), 250).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`promesse rejetée: ${reason?.message || reason}`);
  });

  return { server, app };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    logger.error(`démarrage impossible : ${error?.message}`);
    process.exitCode = 1;
  });
}
