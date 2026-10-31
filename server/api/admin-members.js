// server/api/admin-members.js · modération des comptes visiteurs dans la console (3.19.0).
// Même authentification que le reste de la console : jeton d'administration et permission
// « team ». Un jeton visiteur ne franchit jamais ces routes. Aucune donnée secrète n'est listée.

import { AppError } from '../core/errors.js';
import { queryInt, queryString } from '../http/router.js';

function memberOr404(app, id) {
  const user = app.users.byId(id);
  if (!user) throw new AppError('ERR-11');
  return user;
}

export function registerAdminMembersRoutes(router, app) {
  const guard = { auth: true, permission: 'team' };

  router.get('/api/admin/membres', (context) => {
    const page = app.users.listPage({
      page: queryInt(context.query, 'page', { min: 1, max: 10_000, fallback: 1 }),
      pageSize: queryInt(context.query, 'pageSize', { min: 5, max: 60, fallback: 20 }),
      q: queryString(context.query, 'q', { max: 120 }),
      statut: queryString(context.query, 'statut', { max: 12 }),
    });
    return { body: page, cache: 'no-store' };
  }, guard);

  router.get('/api/admin/membres/:id', (context) => {
    const user = memberOr404(app, context.params.id);
    return {
      body: {
        membre: app.users.publicUser(user),
        donnees: app.users.exportData(user),
      },
      cache: 'no-store',
    };
  }, guard);

  router.patch('/api/admin/membres/:id', async (context) => {
    const user = memberOr404(app, context.params.id);
    const statut = String(context.body?.statut || '');
    await app.users.setStatus(user, statut, { actor: 'admin' });
    if (statut !== 'actif') app.accountSessions.revokeMember(user.id);
    return {
      body: {
        message: statut === 'suspendu'
          ? 'Compte suspendu. Ses sessions sont fermées.'
          : `Compte marqué « ${app.users.publicUser(user).statusLabel} ».`,
        membre: app.users.publicUser(user),
      },
      cache: 'no-store',
    };
  }, { ...guard, bodyLimit: 4096 });

  router.delete('/api/admin/membres/:id', async (context) => {
    const user = memberOr404(app, context.params.id);
    const id = user.id;
    await app.users.remove(user, { actor: 'admin' });
    app.accountSessions.revokeMember(id);
    return { body: { message: 'Compte supprimé. Ses données personnelles ont été retirées.' }, cache: 'no-store' };
  }, guard);
}
