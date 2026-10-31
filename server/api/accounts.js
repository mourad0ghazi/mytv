// server/api/accounts.js · routes des comptes visiteurs (3.19.0).
// Aucune de ces routes ne donne accès à la console : les sessions visiteurs vivent dans un
// registre distinct de celui de l'administration, et un jeton de visiteur n'ouvre aucune
// route /api/admin/*. Le mot de passe, le sel et les codes ne sortent jamais d'ici.

import { LIMITS } from '../core/constants.js';
import { AppError } from '../core/errors.js';
import { assertEmail, normalizeEmail } from '../core/team.js';

/** Le jeton visiteur est facultatif (voir la fiche d'un signalement). */
export function visitorSession(app, req, { optional = false } = {}) {
  const header = String(req?.headers?.authorization || '');
  const token = /^Bearer\s+([a-f0-9]{48})$/i.exec(header)?.[1] || '';
  const session = token && app.accountSessions ? app.accountSessions.touch(token) : null;
  const user = session ? app.users.byId(session.memberId) : null;
  if (!user) {
    if (optional) return { user: null, session: null, token: '' };
    throw new AppError('ERR-07');
  }
  if (user.status !== 'actif' && !optional) {
    throw new AppError('ERR-09', { message: 'Ce compte est suspendu. Contactez l’administrateur du site.' });
  }
  return { user, session, token };
}

function openSession(app, user, { ip = '', userAgent = '' } = {}) {
  const session = app.accountSessions.create({
    ip,
    userAgent,
    role: 'visiteur',
    memberId: user.id,
    memberName: user.name,
  });
  return session.token;
}

function clampText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function registerAccountRoutes(router, app) {
  const body = { bodyLimit: 8192 };

  router.post('/api/compte/inscription', async (context) => {
    const { body: input } = context;
    const result = await app.users.register({
      name: input?.name,
      email: input?.email,
      password: input?.password,
      ip: context.ip,
    });
    return {
      status: 201,
      body: {
        message: result.resent
          ? 'Un nouveau code de confirmation vient d’être envoyé à cette adresse.'
          : 'Compte créé. Un code de confirmation vient d’être envoyé à votre adresse.',
        email: result.user.email,
        compte: result.user,
        resendAfter: result.resendAfter,
        verificationRequired: true,
      },
      cache: 'no-store',
    };
  }, body);

  router.post('/api/compte/verification', async (context) => {
    const { body: input } = context;
    const email = input?.email;
    const user = await app.users.verify({ email, code: input?.code });
    const token = openSession(app, user, { ip: context.ip, userAgent: context.req.headers['user-agent'] });
    return {
      status: 200,
      body: { message: 'Adresse confirmée. Votre compte est actif.', token, compte: app.users.publicUser(user) },
      cache: 'no-store',
    };
  }, body);

  router.post('/api/compte/renvoyer-code', async (context) => {
    const result = await app.users.resend({ email: context.body?.email, ip: context.ip });
    return { status: 202, body: result, cache: 'no-store' };
  }, body);

  router.post('/api/compte/connexion', async (context) => {
    const input = context.body || {};
    const email = assertEmail(input.email);
    const user = await app.users.login({ email, password: input.password, ip: context.ip });
    const token = openSession(app, user, { ip: context.ip, userAgent: context.req.headers['user-agent'] });
    return {
      status: 200,
      body: { message: 'Vous êtes connecté.', token, compte: app.users.publicUser(user) },
      cache: 'no-store',
    };
  }, body);

  router.post('/api/compte/code-oublie', async (context) => {
    const value = context.body?.email;
    let result;
    try {
      result = await app.users.requestReset({ email: assertEmail(value), ip: context.ip });
    } catch (error) {
      // Une adresse mal formée ne doit pas révéler si elle existe : même réponse générique.
      if (error?.code !== 'ERR-04') throw error;
      result = { message: 'Si cette adresse a un compte, un code de réinitialisation vient d’être envoyé.', sent: false };
    }
    return { status: 202, body: result, cache: 'no-store' };
  }, body);

  router.post('/api/compte/reinitialisation', async (context) => {
    const input = context.body || {};
    const email = assertEmail(input.email);
    const user = await app.users.reset({ email, code: input.code, password: input.password, ip: context.ip });
    app.accountSessions.revokeMember(user.id);
    const token = openSession(app, user, { ip: context.ip, userAgent: context.req.headers['user-agent'] });
    return {
      status: 200,
      body: { message: 'Mot de passe remplacé. Vous êtes connecté.', token, compte: app.users.publicUser(user) },
      cache: 'no-store',
    };
  }, body);

  router.get('/api/compte/profil', (context) => {
    const { user } = visitorSession(app, context.req);
    return { body: { compte: app.users.publicUser(user), donnees: app.users.exportData(user) }, cache: 'no-store' };
  });

  router.patch('/api/compte/profil', async (context) => {
    const { user } = visitorSession(app, context.req);
    if (context.body?.name !== undefined) await app.users.rename(user, context.body.name);
    return { body: { message: 'Profil mis à jour.', compte: app.users.publicUser(user) }, cache: 'no-store' };
  }, body);

  router.post('/api/compte/mot-de-passe', async (context) => {
    const { user } = visitorSession(app, context.req);
    await app.users.changePassword(user, { current: context.body?.actuel, next: context.body?.nouveau });
    app.accountSessions.revokeMember(user.id);
    const token = openSession(app, user, { ip: context.ip, userAgent: context.req.headers['user-agent'] });
    return {
      status: 200,
      body: { message: 'Mot de passe remplacé. Les autres appareils sont déconnectés.', token },
      cache: 'no-store',
    };
  }, body);

  router.post('/api/compte/sortie', (context) => {
    const { session, token } = visitorSession(app, context.req);
    if (session && token) app.accountSessions.revoke(token);
    return { body: { message: 'Vous êtes déconnecté.' }, cache: 'no-store' };
  });

  router.get('/api/compte/donnees', (context) => {
    const { user } = visitorSession(app, context.req);
    return { body: app.users.exportData(user), cache: 'no-store' };
  });

  router.put('/api/compte/donnees', async (context) => {
    const { user } = visitorSession(app, context.req);
    const donnees = await app.users.merge(user, context.body || {});
    return { body: { message: 'Données enregistrées.', ...donnees }, cache: 'no-store' };
  }, body);

  router.put('/api/compte/preferences', async (context) => {
    const { user } = visitorSession(app, context.req);
    const preferences = await app.users.savePreferences(user, context.body || {});
    return { body: { message: 'Préférences enregistrées.', preferences }, cache: 'no-store' };
  }, body);

  router.post('/api/compte/favoris', async (context) => {
    const { user } = visitorSession(app, context.req);
    const input = context.body || {};
    const active = input.actif !== false;
    const result = active
      ? await app.users.addFavorite(user, input)
      : await app.users.removeFavorite(user, input);
    return { body: { ...result, actif: active }, cache: 'no-store' };
  }, body);

  router.post('/api/compte/historique', async (context) => {
    const { user } = visitorSession(app, context.req);
    const entry = await app.users.recordHistory(user, context.body || {});
    return { body: { message: 'Reprise enregistrée.', entree: entry }, cache: 'no-store' };
  }, body);

  router.get('/api/compte/signalements', (context) => {
    const { user } = visitorSession(app, context.req);
    const refs = new Set((user.reports || []).map((item) => item.ref));
    const signalements = (user.reports || []).map((item) => {
      const report = app.store.reports.reports.find((entry) => entry.ref === item.ref);
      return {
        ref: item.ref,
        at: item.at,
        type: item.type,
        name: item.name,
        status: report ? report.status : 'introuvable',
        decidedAt: report?.decidedAt || '',
      };
    });
    return { body: { signalements, suivis: refs.size }, cache: 'no-store' };
  });

  // Rappel utile au client : la fiche du compte ne promet jamais un rôle.
  router.get('/api/compte/droits', (context) => {
    visitorSession(app, context.req);
    return {
      body: {
        role: 'visiteur',
        permissions: [],
        message: 'Un compte visiteur ne donne aucun droit sur la console d’administration.',
      },
      cache: 'no-store',
    };
  });
}

/** Appliqué après la création d'un signalement : le compte suit ses propres signalements. */
export async function linkReportToVisitor(app, req, { ref, contentType, name }) {
  const { user } = visitorSession(app, req, { optional: true });
  if (!user) return false;
  return app.users.linkReport(user, { ref, contentType, name: clampText(name, 120) });
}

export const ACCOUNT_ROUTES_LIMIT = LIMITS.maxBodyPublic;
export const normalizeAccountEmail = normalizeEmail;
