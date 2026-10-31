// server/api/admin-access.js · liens d'accès à la console (3.13.0).
// Le propriétaire crée un lien, en fixe la durée, l'usage et le rôle, puis le transmet.
// Le jeton complet n'est affiché qu'une fois, à la création : ensuite seul son état reste.

import { AppError } from '../core/errors.js';
import { ROLES } from '../core/team.js';
import {
  LINK_DEFAULT_MINUTES, LINK_MAX_ACTIVE, LINK_MAX_USES, LINK_MAX_MINUTES,
  cleanLinkLabel, clampMinutes, linkDigest, newLinkToken, publicLink,
} from '../core/access-links.js';
import { queryString } from '../http/router.js';

const ROLES_LIEN = ['administrateur', 'editeur', 'moderateur', 'analyste'];

/** Adresse publique de ce serveur, vue du client : derrière un proxy, l'en-tête fait foi. */
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function registerAccessRoutes(base, app) {
  // Liste des liens : état seulement, aucun jeton.
  base.get('/api/admin/access-links', ({ req }) => ({
    body: {
      links: app.store.accessLinks.map((link) => publicLink(link)),
      origine: originOf(req),
      chemin: app.store.settings.adminPath,
      roleParDefaut: 'administrateur',
      dureeParDefaut: LINK_DEFAULT_MINUTES,
      dureeMax: LINK_MAX_MINUTES,
      usagesMax: LINK_MAX_USES,
      actifsMax: LINK_MAX_ACTIVE,
      verrou: Boolean(app.store.settings.adminDeviceLock),
    },
    cache: 'no-store',
  }));

  // Création : le lien complet n'est rendu qu'ici, une seule fois.
  base.post('/api/admin/access-links', async ({ body, ip, req, session }) => {
    const role = ROLES_LIEN.includes(body?.role) ? body.role : 'administrateur';
    const minutes = clampMinutes(body?.minutes ?? LINK_DEFAULT_MINUTES);
    const maxUses = Math.min(LINK_MAX_USES, Math.max(1, Math.round(Number(body?.maxUses) || 1)));
    const label = cleanLinkLabel(body?.label, role === 'administrateur' ? 'Accès administrateur' : 'Accès invité');

    const actifs = app.store.accessLinks.filter((link) => !link.revokedAt
      && link.uses < link.maxUses && new Date(link.expiresAt).getTime() > Date.now());
    if (actifs.length >= LINK_MAX_ACTIVE) {
      throw new AppError('ERR-16', { params: { raison: `vingt liens sont déjà actifs : révoquez-en un avant d'en créer un autre` } });
    }

    const token = newLinkToken();
    const now = Date.now();
    const link = {
      id: `l-${token.slice(0, 10)}`,
      digest: linkDigest(token),
      label,
      role,
      roleLabel: ROLES[role]?.label || 'Administrateur',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + minutes * 60_000).toISOString(),
      uses: 0,
      maxUses,
      lastUsedAt: '',
      revokedAt: '',
      creePar: session?.memberName || 'Propriétaire',
    };
    app.store.accessLinks.push(link);
    await app.store.saveAccessLinks('création lien');
    await app.store.audit('access.link.created', { ip, lien: label, role, minutes, maxUses });

    return {
      body: {
        lien: `${originOf(req)}/acces/${token}`,
        chemin: app.store.settings.adminPath,
        // Rappel explicite dans l'écran : le jeton ne sera plus affiché.
        afficheUneFois: true,
        link: publicLink(link),
        message: 'Lien créé. Copiez-le maintenant : il ne sera plus affiché.',
      },
      cache: 'no-store',
    };
  });

  // Révocation immédiate.
  base.delete('/api/admin/access-links/:id', async ({ params, ip }) => {
    const link = app.store.accessLinks.find((item) => item.id === params.id);
    if (!link) throw new AppError('ERR-10', { message: 'Ce lien n’existe plus.' });
    if (!link.revokedAt) {
      link.revokedAt = new Date().toISOString();
      await app.store.saveAccessLinks('révocation lien');
      await app.store.audit('access.link.revoked', { ip, lien: link.label });
    }
    return { body: { ok: true, link: publicLink(link), message: 'Lien révoqué.' }, cache: 'no-store' };
  });

  // Vérification d'existence pour l'écran : un identifiant inconnu répond 404.
  base.get('/api/admin/access-links/:id', ({ params, query }) => {
    const link = app.store.accessLinks.find((item) => item.id === params.id);
    if (!link) throw new AppError('ERR-10', { message: 'Ce lien n’existe plus.' });
    const chemin = queryString(query, 'chemin', { max: 40 });
    return { body: { link: publicLink(link), chemin: chemin || app.store.settings.adminPath }, cache: 'no-store' };
  });
}
