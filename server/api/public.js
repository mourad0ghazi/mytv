// server/api/public.js — EP-01 → EP-09 + session et catalogue des messages.
// Aucune route publique ne peut renvoyer une chaîne masquée (THR-06, ER-X12).

import { CATEGORIES, LIMITS, SPEC_VERSION, VERSION } from '../core/constants.js';
import { AppError, ERRORS } from '../core/errors.js';
import { isPublic, projectCard, projectDetail } from '../core/channels.js';
import { probeStats } from '../core/probe-plan.js';
import { buildPredicate, paginate, sortChannels } from '../core/search.js';
import { normalizeQuery, normalizeKey } from '../core/text.js';
import { checkMemberPassword, findMember, publicMember, ROLES } from '../core/team.js';
import { deviceDigest, isDeviceAllowed, normalizeDeviceId } from '../core/devices.js';
import { maskEmail } from '../core/twofactor.js';
import { isLinkToken, linkDigest, linkUsable, sameDigest } from '../core/access-links.js';
import { buildEpg } from '../core/epg.js';
import { catalogForClient } from '../core/messages.js';
import { reportThreshold } from '../core/reports.js';
import { relayInfo } from '../core/relay.js';
import { queryInt, queryString } from '../http/router.js';

function publicChannels(app) {
  return app.store.channels.filter((channel) => isPublic(channel, app.store.settings));
}

/** Pays les plus représentés du catalogue public : filtre « jusqu'au pays » et rail d'accueil. */
function countryCounts(app, limit = 12) {
  const counts = new Map();
  for (const channel of app.store.channels) {
    if (!isPublic(channel, app.store.settings) || !channel.country) continue;
    counts.set(channel.country, (counts.get(channel.country) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

function categoryCounts(app) {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category.id, 0]));
  for (const channel of app.store.channels) {
    if (!isPublic(channel, app.store.settings)) continue;
    counts[channel.category] = (counts[channel.category] || 0) + 1;
  }
  return counts;
}

function resolveHero(app, visible) {
  const settings = app.store.settings;
  const featuredOrder = (settings.featuredIds || [])
    .map((id) => visible.find((channel) => channel.id === id))
    .filter(Boolean);
  if (settings.heroMode === 'first') {
    return { mode: 'first', channels: visible.slice(0, 4).map(projectCard) };
  }
  // Le bandeau ne propose que des chaînes lisibles : une chaîne bloquée en tête de page
  // est la première impression que le visiteur garde du site.
  const lisibles = visible.filter((channel) => !channel.blocked);
  if (settings.heroMode === 'featured') {
    const list = featuredOrder.length ? featuredOrder.filter((channel) => !channel.blocked) : lisibles.filter((channel) => channel.featured);
    if (list.length) return { mode: 'featured', channels: list.slice(0, 4).map(projectCard) };
  }
  // Sélection quotidienne stable : la même journée donne le même bandeau.
  const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const pool = (lisibles.length >= 4 ? lisibles : visible).filter((channel) => channel.logo);
  const picked = [];
  const source = pool.length >= 4 ? pool : (lisibles.length ? lisibles : visible);
  for (let i = 0; i < 4 && source.length; i += 1) {
    picked.push(source[(seed + i * 37) % source.length]);
  }
  return { mode: 'random', channels: picked.map(projectCard) };
}

function listResponse(app, list, { page, pageSize, sort, query }) {
  const sorted = sortChannels(list, sort || app.store.settings.defaultSort);
  const result = paginate(sorted, page, pageSize || app.store.settings.pageSize);
  const all = publicChannels(app);
  return {
    total: result.total,
    page: result.page,
    pages: result.pages,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
    showing: result.items.length,
    channels: result.items.map(projectCard),
    meta: {
      sort: sort || app.store.settings.defaultSort,
      query: query || '',
      catalogTotal: app.store.channels.length,
      visibleTotal: all.length,
      hidden: app.store.channels.length - all.length,
      filters: { category: '', country: '', language: '', quality: '', health: '', etat: '' },
    },
  };
}

/**
 * Recherche multi-sources : une même chaîne peut exister dans plusieurs sources ingérées.
 * On la retrouve par `tvg-id`, puis par nom normalisé, pour proposer une autre adresse
 * quand le flux principal ne répond pas. Aucun accès n'est élargi : seules les chaînes
 * publiques du catalogue sont proposées.
 */
function findAlternatives(app, channel, settings, limit = 6) {
  const tvgId = String(channel.tvgId || '').trim().toLowerCase();
  const nom = normalizeKey(channel.rawName || channel.name);
  const sortie = [];
  for (const candidate of app.store.channels) {
    if (candidate.id === channel.id || !candidate.url) continue;
    if (!isPublic(candidate, settings)) continue;
    const memeTvg = tvgId && String(candidate.tvgId || '').trim().toLowerCase() === tvgId;
    const memeNom = nom && normalizeKey(candidate.rawName || candidate.name) === nom;
    if (!memeTvg && !memeNom) continue;
    sortie.push({
      id: candidate.id,
      name: candidate.name,
      number: candidate.number,
      quality: candidate.quality || 'AUTO',
      url: candidate.url,
      blockedReason: candidate.blockedReason || '',
      match: memeTvg ? 'tvg-id' : 'nom',
    });
    if (sortie.length >= limit) break;
  }
  return sortie;
}

/** Texte de l'e-mail : court, sans lien, sans donnée personnelle au-delà du code. */
function codeMessage(code, minutes) {
  return [
    'Votre code de connexion StreamTV',
    '',
    `Code : ${code}`,
    '',
    `Il est valable ${minutes} minutes et ne sert qu'une fois.`,
    'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : sans ce code,',
    'aucune connexion ne peut aboutir.',
    '',
    'Ce message est envoyé automatiquement, ne répondez pas.',
  ].join('\n');
}

/** Ouvre la session et rend la charge utile attendue par le client. */
async function openSession(app, { member, identite, ip, req }) {
  app.loginGuard.success(ip);
  const session = app.sessions.create({
    ip,
    userAgent: req.headers['user-agent'] || '',
    role: identite.role,
    memberId: identite.memberId,
    memberName: identite.memberName,
  });
  if (member) {
    member.lastLoginAt = new Date().toISOString();
    await app.store.saveTeam('connexion');
  }
  await app.store.audit('login.success', { ip, role: session.role, membre: session.memberName });
  return {
    body: {
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      defaultPassword: member ? false : app.auth.isDefaultPasswordActive(),
      role: session.role,
      roleLabel: ROLES[session.role]?.label || 'Propriétaire',
      member: member ? publicMember(member) : {
        name: String(app.store.settings.adminName || '').trim() || 'Propriétaire',
        role: 'proprietaire',
        email: String(app.store.settings.adminEmail || ''),
      },
      // Destination juste après la connexion : le chemin privé de la console.
      entry: `/${app.store.settings.adminPath}`,
      message: 'Connexion réussie.',
    },
    cache: 'no-store',
  };
}

/** Refus homogène quand la limite de tentatives est atteinte. */
function guardRefusal(guard) {
  return new AppError('ERR-17', {
    params: { n: Math.max(1, Math.ceil(guard.retryAfterSeconds / 60)) },
    headers: { 'Retry-After': String(guard.retryAfterSeconds) },
  });
}

export function registerPublicRoutes(router, app) {
  // EP-01 — état du service.
  router.get('/healthz', () => ({
    // 503 : le service répond mais le catalogue est inexploitable (supervision, AC-102).
    status: app.store.error ? 503 : 200,
    body: {
      status: app.store.error ? 'degraded' : 'ok',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      channels: app.store.channels.length,
      visible: publicChannels(app).length,
      maintenance: Boolean(app.store.settings.maintenanceMode),
      time: new Date().toISOString(),
    },
    cache: 'no-store',
  }));

  /**
   * EP-00 — compteur de lecture, anonyme.
   * Un identifiant de chaîne, rien d'autre : ni adresse, ni appareil, ni identifiant visiteur.
   * Les compteurs servent au pilotage éditorial (ce qui marche, ce qui ne marche pas).
   */
  router.post('/api/events/play', async ({ body }) => {
    const id = String(body?.channelId || '').slice(0, 32);
    if (!/^[a-z0-9]{4,32}$/i.test(id)) throw new AppError('ERR-04', { field: 'channelId', params: { champ: 'chaîne' } });
    const channel = app.store.channels.find((item) => item.id === id && !item.deleted);
    if (!channel) throw new AppError('ERR-10');
    const plays = app.store.plays || (app.store.plays = { totals: {}, hours: {} });
    const heure = new Date().toISOString().slice(0, 13);
    const entry = plays.totals[id] || { count: 0, lastAt: '' };
    entry.count += 1;
    entry.lastAt = new Date().toISOString();
    plays.totals[id] = entry;
    plays.hours[heure] = (plays.hours[heure] || 0) + 1;
    // Les heures anciennes sont élaguées : 30 jours suffisent au pilotage.
    const limite = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 13);
    for (const key of Object.keys(plays.hours)) if (key < limite) delete plays.hours[key];
    app.store.savePlays('lecture').catch(() => {});
    return { body: { ok: true }, cache: 'no-store' };
  });

  // EP-02 — configuration publique.
  router.get('/api/config', () => {
    const settings = app.store.settings;
    const visible = publicChannels(app);
    const counts = categoryCounts(app);
    const featured = visible
      .filter((channel) => channel.featured || (settings.featuredIds || []).includes(channel.id))
      .slice(0, LIMITS.maxFeatured)
      .map(projectCard);
    const adultHidden = app.store.channels.filter((channel) => channel.category === 'adulte' && !isPublic(channel, settings)).length;
    return {
      body: {
        version: VERSION,
        specVersion: SPEC_VERSION,
        brand: settings.brand,
        tagline: settings.tagline,
        accent: settings.accent,
        logoUrl: settings.logoUrl,
        pageSize: settings.pageSize,
        defaultSort: settings.defaultSort,
        showHealthBadge: settings.showHealthBadge,
        footerNote: settings.footerNote,
        maintenanceMode: settings.maintenanceMode,
        heroMode: settings.heroMode,
        showAdult: settings.showAdult,
        autoHideAdult: settings.autoHideAdult,
        confidenceFloor: settings.confidenceFloor,
        reportThreshold: reportThreshold(),
        epgUrl: settings.epgUrl,
        vodEnabled: settings.vodEnabled !== false,
        vodGenreRowsMax: settings.vodGenreRowsMax,
        categories: CATEGORIES.map((category) => ({ ...category, count: counts[category.id] || 0 })),
        countries: countryCounts(app),
        totals: {
          catalog: app.store.channels.length,
          visible: visible.length,
          hidden: app.store.channels.length - visible.length,
          adultHidden,
          target: settings.targetTable || app.store.channels.length,
        },
        health: { ...app.store.healthCounts(), ...probeStats(app.store.channels), lastProbeAt: app.store.probe.lastAt },
        hero: resolveHero(app, visible),
        featured,
        defaultPassword: app.auth.isDefaultPasswordActive(),
        notices: app.notices(),
        legal: {
          mention: 'StreamTV diffuse des flux fournis par leurs ayants droit. Ce site n’héberge aucun contenu vidéo.',
          contact: String(process.env.STREAMTV_CONTACT || '').trim(),
          links: [
            { id: 'mentions-legales', title: 'Mentions légales', href: '/mentions-legales' },
            { id: 'confidentialite', title: 'Confidentialité', href: '/confidentialite' },
            { id: 'signalement', title: 'Signaler un contenu', href: '/signaler' },
            { id: 'aide', title: 'Aide & raccourcis', href: '/aide' },
          ],
        },
        time: new Date().toISOString(),
      },
      cache: 'public, max-age=20',
    };
  });

  // EP-03 — liste paginée.
  router.get('/api/channels', ({ query }) => {
    const settings = app.store.settings;
    const filters = {
      category: queryString(query, 'category', { max: 24 }),
      country: queryString(query, 'country', { max: 2 }).toUpperCase(),
      language: queryString(query, 'language', { max: 8 }).toLowerCase(),
      quality: queryString(query, 'quality', { max: 4 }).toUpperCase(),
      health: queryString(query, 'health', { max: 8 }).toLowerCase(),
      etat: queryString(query, 'etat', { max: 10 }).toLowerCase(),
      featured: query.featured === 'true' ? true : query.featured === 'false' ? false : undefined,
      visibility: 'public',
    };
    const wanted = String(queryString(query, 'ids', { max: 1200 }) || '')
      .split(',').map((id) => id.trim()).filter(Boolean).slice(0, LIMITS.pageSizeMax);
    if (wanted.length) filters.ids = wanted;
    let list = app.store.channels.filter(buildPredicate(filters, settings));
    const q = normalizeQuery(queryString(query, 'q', { max: LIMITS.searchMaxLength }));
    if (q) list = app.index.search(q, (channel) => isPublic(channel, settings));
    const body = listResponse(app, list, {
      page: queryInt(query, 'page', { min: 1, max: LIMITS.maxPage }),
      pageSize: queryInt(query, 'pageSize', { min: 1, max: LIMITS.pageSizeMax, fallback: settings.pageSize }),
      sort: queryString(query, 'sort', { max: 12 }),
      query: q,
    });
    body.meta.filters = filters;
    return { body, cache: 'public, max-age=15' };
  });

  // EP-04 — fiche d'une chaîne.
  router.get('/api/channels/:id', ({ params }) => {
    const settings = app.store.settings;
    const channel = app.store.channels.find((item) => item.id === params.id);
    if (!channel || !isPublic(channel, settings)) throw new AppError('ERR-10');
    const related = app.store.channels
      .filter((item) => item.id !== channel.id && item.category === channel.category && isPublic(item, settings))
      .slice(0, 8)
      .map(projectCard);
    const detail = projectDetail(channel, settings, app.siteProtocol);
    // Le relais n'est annoncé que s'il peut réellement servir cette chaîne.
    detail.relay = relayInfo(app.store, channel, { insecure: Boolean(app.relayInsecure) });
    return {
      body: {
        channel: detail,
        related,
        alternatives: findAlternatives(app, channel, settings),
        variants: channel.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          quality: variant.quality,
          health: variant.health?.status || 'unknown',
        })),
      },
      cache: 'public, max-age=20',
    };
  });

  // EP-05 — recherche accent-insensible.
  router.get('/api/channels/search', ({ query }) => {
    const settings = app.store.settings;
    const q = normalizeQuery(queryString(query, 'q', { max: LIMITS.searchMaxLength }));
    const filters = {
      category: queryString(query, 'category', { max: 24 }),
      country: queryString(query, 'country', { max: 2 }).toUpperCase(),
      language: queryString(query, 'language', { max: 8 }).toLowerCase(),
      quality: queryString(query, 'quality', { max: 4 }).toUpperCase(),
      visibility: 'public',
    };
    // EP-05 exige un terme : sans lui, mieux vaut un refus explicite qu'une liste trompeuse.
    if (!q) throw new AppError('ERR-02', { field: 'q', params: { champ: 'terme recherché' } });
    const predicate = buildPredicate(filters, settings);
    const list = app.index.search(q, predicate);
    const body = listResponse(app, list, {
      page: queryInt(query, 'page', { min: 1, max: LIMITS.maxPage }),
      pageSize: queryInt(query, 'pageSize', { min: 1, max: LIMITS.pageSizeMax, fallback: settings.pageSize }),
      sort: queryString(query, 'sort', { max: 12 }),
      query: q,
    });
    if (q && !body.total) body.meta.suggestions = app.index.suggestions(q);
    body.meta.filters = filters;
    return { body, cache: 'public, max-age=10' };
  });

  // EP-06 — catégories et compteurs.
  router.get('/api/categories', () => {
    const counts = categoryCounts(app);
    return {
      body: {
        categories: CATEGORIES.map((category) => ({ ...category, count: counts[category.id] || 0 })),
        total: publicChannels(app).length,
      },
      cache: 'public, max-age=30',
    };
  });

  // EP-07 — mentions et cadre légal.
  router.get('/api/legal', () => ({
    body: {
      mention: 'StreamTV diffuse des flux fournis par leurs ayants droit. Ce site n’héberge aucun contenu vidéo.',
      hosting: 'Aucun fichier vidéo n’est hébergé ni retransmis par ce service : seuls les liens publics fournis par les sources sont référencés.',
      licenseNote: 'Chaque chaîne porte une justification des droits. Une chaîne sans justification est masquée. Une demande crédible déclenche un retrait sous 72 heures ouvrées.',
      report: {
        title: 'Signaler un contenu',
        delay: '72 heures ouvrées',
        procedure: 'Indiquez le nom exact de la chaîne et le motif. Le signalement est enregistré immédiatement avec une référence de suivi ; le retrait intervient après vérification, sous 72 heures ouvrées. Une chaîne signalée 1000 fois est retirée automatiquement.',
      },
      privacy: {
        storage: 'Aucun compte visiteur. Les favoris, l’historique et le volume sont stockés dans votre navigateur, jamais sur le serveur.',
        logs: 'Les journaux techniques sont conservés 14 jours, le journal d’audit 90 jours, sans adresse IP pour les visiteurs.',
        cookies: 'Aucun cookie de mesure d’audience, aucun traceur tiers, aucun profil publicitaire.',
      },
      sources: (app.store.sources || []).filter((source) => source.enabled !== false).map((source) => ({
        name: source.name,
        url: source.url,
        licence: source.license || 'Liste publique fournie par la source',
      })),
      updatedAt: new Date().toISOString(),
    },
    cache: 'public, max-age=3600',
  }));

  // EP-08 — guide des programmes (F-23) : XMLTV tolérant, mis en cache, jamais bloquant.
  router.get('/api/epg', async ({ query }) => {
    const url = app.store.settings.epgUrl;
    if (!url) {
      return {
        body: {
          enabled: false,
          message: 'Aucun guide des programmes n’est configuré. Les chaînes restent regardables ; le guide peut être ajouté dans les réglages.',
        },
        cache: 'public, max-age=60',
      };
    }
    const hours = Math.min(48, Math.max(1, Number(query.hours) || 12));
    const loaded = await app.epg.load(url);
    if (!loaded.ok) {
      return {
        body: {
          enabled: true,
          valid: false,
          url,
          message: loaded.message,
          stats: app.epg.stats(),
          ...buildEpg([], { programmes: [] }),
        },
        cache: 'public, max-age=30',
      };
    }
    // Une fiche de chaîne ne demande que son propre programme : « ids » évite de charger
    // soixante grilles pour en afficher une seule.
    const demandes = String(queryString(query, 'ids', { max: 900 }) || '')
      .split(',').map((id) => id.trim()).filter(Boolean).slice(0, LIMITS.pageSizeMax);
    const filtre = demandes.length ? new Set(demandes) : null;
    const visible = app.store.channels
      .filter((channel) => isPublic(channel, app.store.settings) && !channel.deleted)
      .filter((channel) => !filtre || filtre.has(channel.id))
      .sort((a, b) => a.number - b.number);
    const grid = buildEpg(visible, loaded.parsed, {
      from: Date.now(),
      to: Date.now() + hours * 3600_000,
      limit: Math.min(LIMITS.pageSizeMax, Math.max(12, Number(query.pageSize) || 60)),
    });
    return {
      body: {
        enabled: true,
        valid: true,
        url,
        cached: Boolean(loaded.cached),
        fetchedAt: new Date(loaded.fetchedAt).toISOString(),
        ...grid,
      },
      cache: 'public, max-age=120',
    };
  });

  // EP-08b — « en ce moment » : programme en cours pour une sélection de chaînes.
  // Volontairement compact (titre, horaires) : appelé au survol d'une carte, jamais au chargement.
  router.get('/api/epg/now', async ({ query }) => {
    const url = app.store.settings.epgUrl;
    if (!url) return { body: { enabled: false, now: [] }, cache: 'public, max-age=60' };
    const ids = new Set(String(queryString(query, 'ids', { max: 400 }) || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, LIMITS.pageSizeMax));
    const loaded = await app.epg.load(url);
    if (!loaded.ok) {
      return { body: { enabled: true, valid: false, now: [], message: loaded.message }, cache: 'public, max-age=30' };
    }
    const pool = publicChannels(app).filter((channel) => !channel.deleted && (ids.size === 0 || ids.has(channel.id)));
    const instant = Date.now();
    const grid = buildEpg(pool, loaded.parsed, {
      from: instant, to: instant + 3 * 3600_000, limit: LIMITS.pageSizeMax, now: instant,
    });
    const now = [];
    for (const row of grid.grid) {
      const live = row.programmes.find((programme) => programme.live);
      if (!live) continue;
      now.push({
        id: row.id,
        title: live.title,
        start: live.start,
        stop: live.stop,
        category: live.category || '',
        description: String(live.description || '').slice(0, 240),
      });
    }
    return { body: { enabled: true, valid: true, fetchedAt: new Date(loaded.fetchedAt).toISOString(), now }, cache: 'public, max-age=60' };
  });

  // EP-09 — version et empreinte du service.
  router.get('/api/version', () => ({
    body: {
      version: VERSION,
      specVersion: SPEC_VERSION,
      node: process.version,
      startedAt: app.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      routes: app.routeCount || 0,
      catalog: app.store.channels.length,
      dataUpdatedAt: app.store.loadedAt,
    },
    cache: 'no-store',
  }));

  // Catalogue des messages — page /erreurs, console d'administration et support (§9).
  router.get('/api/errors/catalog', () => ({
    body: {
      ...catalogForClient(),
      errors: Object.entries(ERRORS).map(([code, entry]) => ({ code, status: entry.status, message: entry.message })),
      count: Object.keys(ERRORS).length,
      goldenRule: 'Aucun message d’erreur n’est affiché sans action concrète.',
    },
    cache: 'public, max-age=3600',
  }));

  // Session courante.
  router.get('/api/session', ({ req }) => {
    const token = /^Bearer\s+([a-f0-9]{48})$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
    const session = token ? app.sessions.touch(token) : null;
    return {
    body: {
      signedIn: Boolean(session),
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      defaultPassword: app.auth.isDefaultPasswordActive(),
      sessions: app.sessions.count(),
    },
    cache: 'no-store',
    };
  });

  // Connexion.
  // EP-31 — porte de la console : le navigateur demande s'il est entré par l'adresse secrète.
  // La réponse ne dit jamais quelle est cette adresse.
  // Porte de la console : ne dit rien à qui n'a jamais ouvert le chemin secret.
  // Le chemin lui-même n'est révélé qu'au navigateur qui porte déjà le cookie d'entrée.
  router.get('/api/admin/gate', ({ req }) => {
    const cookie = String(req.headers.cookie || '');
    const ouvert = /(?:^|;\s*)stv_entry=1(?:;|$)/.test(cookie);
    return {
      body: {
        admin: ouvert,
        deviceLock: Boolean(app.store.settings.adminDeviceLock),
        path: ouvert ? app.store.settings.adminPath : '',
      },
      cache: 'no-store',
    };
  });

  router.post('/api/login', async ({ body, ip, req }) => {
    const password = typeof body?.password === 'string' ? body.password : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!password) throw new AppError('ERR-02', { field: 'password', params: { champ: 'mot de passe' } });
    if (password.length > 200) throw new AppError('ERR-04', { field: 'password', params: { champ: 'mot de passe' } });
    const guard = app.loginGuard.check(ip);
    if (!guard.allowed) {
      throw new AppError('ERR-17', {
        params: { n: Math.max(1, Math.ceil(guard.retryAfterSeconds / 60)) },
        headers: { 'Retry-After': String(guard.retryAfterSeconds) },
      });
    }
    // Deux portes : le propriétaire par son mot de passe historique, un membre par e-mail + mot de passe.
    const member = email ? findMember(app.store.team, email) : null;
    if (email && !member) {
      app.loginGuard.fail(ip);
      await app.store.audit('login.fail', { ip, result: 'compte inconnu', email });
      throw new AppError('ERR-08');
    }
    const valid = member ? await checkMemberPassword(member, password) : await app.auth.verify(password);
    if (!valid) {
      app.loginGuard.fail(ip);
      await app.store.audit('login.fail', { ip, result: member?.disabled ? 'compte désactivé' : 'refus' });
      throw new AppError('ERR-08');
    }
    // Verrou d'appareil : quand il est actif, un mot de passe volé ne suffit pas.
    // Le refus est explicite et ne dit jamais si le mot de passe était bon.
    const role = member ? member.role : 'proprietaire';
    const demandeVerrou = Boolean(app.store.settings.adminDeviceLock) && ['proprietaire', 'administrateur'].includes(role);
    const deviceId = normalizeDeviceId(body?.deviceId);
    if (demandeVerrou && !isDeviceAllowed(app.store.devices, deviceId)) {
      app.loginGuard.fail(ip);
      await app.store.audit('login.fail', { ip, result: 'appareil non autorisé' });
      throw new AppError('ERR-09', {
        message: 'Cet appareil n’est pas autorisé. Ouvrez la console depuis un appareil enregistré, ou ajoutez celui-ci depuis la console.',
      });
    }
    if (deviceId) {
      const digest = deviceDigest(deviceId);
      const appareil = app.store.devices.find((item) => item.digest === digest);
      if (appareil) {
        appareil.lastSeenAt = new Date().toISOString();
        app.store.saveDevices('connexion').catch(() => {});
      }
    }
    const identite = member
      ? { role: member.role, memberId: member.id, memberName: member.name }
      : { role: 'proprietaire', memberId: '', memberName: String(app.store.settings.adminName || '').trim() || 'Propriétaire' };

    // Second facteur : le mot de passe juste n'ouvre encore rien, un code part par e-mail.
    const adresse = String(app.store.settings.adminEmail || '').trim();
    if (adresse && ['proprietaire', 'administrateur'].includes(identite.role) && app.mailReady()) {
      const challenge = app.twoFactor.issue({ ...identite, deviceId, email: adresse, ip });
      if (!challenge) {
        await app.store.audit('login.code.fail', { ip, result: 'plafond horaire atteint' });
        throw new AppError('ERR-17', { params: { n: 15 } });
      }
      try {
        await app.mailer.send({
          to: adresse,
          subject: 'Votre code de connexion StreamTV',
          text: codeMessage(challenge.code, Math.round((challenge.expiresAt - Date.now()) / 60_000)),
        });
      } catch (error) {
        await app.store.audit('login.code.fail', { ip, result: error.message });
        throw new AppError('ERR-16', { params: { raison: 'l’e-mail contenant le code n’a pas pu être envoyé' } });
      }
      await app.store.audit('login.code.sent', { ip, role: identite.role });
      return {
        body: {
          requiresCode: true,
          challengeId: challenge.id,
          email: maskEmail(adresse),
          expiresIn: Math.max(1, Math.round((challenge.expiresAt - Date.now()) / 1000)),
          resendAfter: challenge.resendAfter,
          message: 'Code envoyé par e-mail.',
        },
        cache: 'no-store',
      };
    }

    return openSession(app, { member, identite, ip, req });
  });

  // Second facteur : le code reçu par e-mail, lié à cet appareil et à ce challenge.
  router.post('/api/login/code', async ({ body, ip, req }) => {
    const guard = app.loginGuard.check(ip);
    if (!guard.allowed) throw guardRefusal(guard);
    const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const deviceId = normalizeDeviceId(body?.deviceId);
    const check = app.twoFactor.verify(challengeId, code, { deviceId });
    if (!check.ok) {
      const refus = ['code', 'format'].includes(check.reason);
      if (refus) app.loginGuard.fail(ip);
      await app.store.audit('login.code.fail', { ip, result: check.reason, restants: check.restants ?? null });
      if (refus) {
        const restants = check.restants ?? 0;
        throw new AppError('ERR-08', {
          message: restants > 0
            ? `Code refusé. Il reste ${restants} tentative${restants > 1 ? 's' : ''}.`
            : 'Code refusé. Demandez un nouveau code.',
        });
      }
      throw new AppError('ERR-08', {
        message: check.reason === 'appareil'
          ? 'Ce code a été demandé depuis un autre appareil.'
          : 'Ce code a expiré. Demandez-en un nouveau.',
      });
    }
    const { challenge } = check;
    const member = challenge.memberId ? app.store.team.find((item) => item.id === challenge.memberId) || null : null;
    if (challenge.memberId && (!member || member.disabled)) {
      await app.store.audit('login.code.fail', { ip, result: 'compte fermé pendant la saisie' });
      throw new AppError('ERR-08', { message: 'Ce compte n’est plus actif.' });
    }
    const reponse = await openSession(app, {
      member,
      identite: { role: challenge.role, memberId: challenge.memberId, memberName: challenge.memberName },
      ip,
      req,
    });
    return reponse;
  });

  // Renvoi du code : un par minute au plus, plafond horaire par adresse réseau.
  router.post('/api/login/code/resend', async ({ body, ip }) => {
    const guard = app.loginGuard.check(ip);
    if (!guard.allowed) throw guardRefusal(guard);
    const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : '';
    const reissue = app.twoFactor.reissue(challengeId);
    if (!reissue.ok) {
      if (reissue.reason === 'trop-tot') {
        throw new AppError('ERR-17', {
          params: { n: 1 },
          message: `Patientez ${reissue.retryAfter} secondes avant de demander un nouveau code.`,
          headers: { 'Retry-After': String(reissue.retryAfter) },
        });
      }
      throw new AppError('ERR-08', { message: 'Ce code a expiré. Recommencez la connexion.' });
    }
    const adresse = String(app.store.settings.adminEmail || '').trim();
    try {
      await app.mailer.send({
        to: adresse,
        subject: 'Votre nouveau code de connexion StreamTV',
        text: codeMessage(reissue.code, Math.round((reissue.expiresAt - Date.now()) / 60_000)),
      });
    } catch (error) {
      await app.store.audit('login.code.fail', { ip, result: error.message });
      throw new AppError('ERR-16', { params: { raison: 'l’e-mail contenant le code n’a pas pu être envoyé' } });
    }
    await app.store.audit('login.code.sent', { ip, result: 'renvoi' });
    return {
      body: {
        requiresCode: true,
        challengeId: reissue.id,
        email: maskEmail(adresse),
        expiresIn: Math.max(1, Math.round((reissue.expiresAt - Date.now()) / 1000)),
        resendAfter: reissue.resendAfter,
        message: 'Nouveau code envoyé.',
      },
      cache: 'no-store',
    };
  });


  // Lien d'accès : quiconque possède le lien entre, avec le rôle prévu par son auteur.
  // Le jeton est vérifié par condensé, jamais conservé en clair ; l'usage est décompté.
  router.post('/api/access/redeem', async ({ body, ip, req }) => {
    const guard = app.loginGuard.check(ip);
    if (!guard.allowed) throw guardRefusal(guard);
    const jeton = typeof body?.token === 'string' ? body.token : '';
    if (!isLinkToken(jeton)) {
      app.loginGuard.fail(ip);
      await app.store.audit('access.redeem.fail', { ip, result: 'jeton invalide' });
      throw new AppError('ERR-08', { message: 'Ce lien n’est pas valable.' });
    }
    const digest = linkDigest(jeton);
    const link = app.store.accessLinks.find((item) => sameDigest(item.digest, digest));
    if (!linkUsable(link)) {
      app.loginGuard.fail(ip);
      await app.store.audit('access.redeem.fail', { ip, result: link ? 'lien fermé' : 'lien inconnu' });
      throw new AppError('ERR-08', { message: 'Ce lien a expiré ou a été révoqué. Demandez-en un nouveau.' });
    }
    const deviceId = normalizeDeviceId(body?.deviceId);
    const demandeVerrou = Boolean(app.store.settings.adminDeviceLock)
      && ['proprietaire', 'administrateur'].includes(link.role);
    if (demandeVerrou && !isDeviceAllowed(app.store.devices, deviceId)) {
      app.loginGuard.fail(ip);
      await app.store.audit('access.redeem.fail', { ip, result: 'appareil non autorisé' });
      throw new AppError('ERR-09', {
        message: 'Le verrou d’appareil est actif : ce lien ne s’ouvre que sur un appareil enregistré.',
      });
    }
    link.uses += 1;
    link.lastUsedAt = new Date().toISOString();
    await app.store.saveAccessLinks('usage lien');
    const reponse = await openSession(app, {
      member: null,
      identite: { role: link.role, memberId: `lien:${link.id}`, memberName: link.label },
      ip,
      req,
    });
    await app.store.audit('access.redeem', { ip, lien: link.label, role: link.role, usages: link.uses });
    reponse.body.lien = { label: link.label, uses: link.uses, maxUses: link.maxUses };
    return reponse;
  });

  // Déconnexion.
  router.post('/api/logout', ({ session, req, ip }) => {
    const header = String(req.headers.authorization || '');
    const token = /^Bearer\s+([a-f0-9]{48})$/i.exec(header)?.[1] || '';
    if (token) app.sessions.revoke(token);
    if (session) app.store.audit('logout', { ip });
    return { status: 200, body: { message: 'Déconnecté.' }, cache: 'no-store' };
  });
}
