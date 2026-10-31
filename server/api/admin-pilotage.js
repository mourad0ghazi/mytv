// server/api/admin-pilotage.js — équipe, journal, agent de diagnostic et usage (3.9.0).
// Ces routes complètent la console : elles disent qui a accès, ce qui a été fait,
// ce qui bloque les visiteurs et ce qui est réellement regardé. Aucune ne modifie le catalogue.

import { AppError, requireField } from '../core/errors.js';
import { hashPassword } from '../core/auth.js';
import { isPublic } from '../core/channels.js';
import {
  buildMember, checkMemberPassword, findMember, PERMISSIONS, publicMember, ROLES, ROLE_IDS,
} from '../core/team.js';
import { queryInt, queryString } from '../http/router.js';
import { cleanLabel, deviceDigest, newDeviceId, normalizeDeviceId, publicDevice } from '../core/devices.js';
import { describeAudit } from '../core/journal.js';

/** Nom lisible d'une chaîne, y compris retirée : les compteurs d'usage la retrouvent. */
function channelName(app, id) {
  const channel = app.store.channels.find((item) => item.id === id);
  return channel ? channel.name : 'Chaîne retirée';
}

export function registerPilotageRoutes(base, app) {
  /* ------------------------------------------------------------- appareils (3.11.0)
     Le propriétaire voit, ajoute et retire les appareils qui peuvent ouvrir la console.
     L'identifiant complet n'est jamais renvoyé : seul son état et son étiquette le sont. */

  base.get('/api/admin/devices', ({ query }) => {
    const courant = normalizeDeviceId(queryString(query, 'current', { max: 64 }));
    const digestCourant = courant ? deviceDigest(courant) : '';
    return {
      body: {
        devices: app.store.devices.map((device) => ({
          ...publicDevice(device),
          current: Boolean(digestCourant) && device.digest === digestCourant,
        })),
        lock: Boolean(app.store.settings.adminDeviceLock),
        path: app.store.settings.adminPath,
      },
      cache: 'no-store',
    };
  });

  base.post('/api/admin/devices', async ({ body, ip }) => {
    const demandé = normalizeDeviceId(body?.deviceId) || newDeviceId();
    const digest = deviceDigest(demandé);
    if (app.store.devices.some((device) => device.digest === digest)) {
      return { body: { ok: true, deviceId: demandé, already: true }, cache: 'no-store' };
    }
    if (app.store.devices.length >= 8) {
      throw new AppError('ERR-16', { params: { raison: 'huit appareils sont déjà enregistrés' } });
    }
    app.store.devices.push({
      id: `d-${digest.slice(0, 10)}`,
      digest,
      label: cleanLabel(body?.label, 'Appareil'),
      addedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      addedFrom: String(ip || '').slice(0, 60),
    });
    await app.store.saveDevices('ajout appareil');
    await app.store.audit('device.added', { ip, appareil: cleanLabel(body?.label, 'Appareil') });
    return { body: { ok: true, deviceId: demandé }, cache: 'no-store' };
  });

  base.delete('/api/admin/devices/:id', async ({ params, ip }) => {
    const appareil = app.store.devices.find((device) => device.id === params.id);
    if (!appareil) throw new AppError('ERR-10');
    app.store.devices = app.store.devices.filter((device) => device.id !== params.id);
    await app.store.saveDevices('retrait appareil');
    await app.store.audit('device.removed', { ip, appareil: appareil.label });
    return { body: { ok: true, devices: app.store.devices.map(publicDevice) }, cache: 'no-store' };
  });

  /* ------------------------------------------------------------------ équipe (3.9.0)
     Le propriétaire crée des comptes, choisit le rôle et ferme l'accès d'un membre.
     Aucun mot de passe n'est jamais renvoyé : seulement l'empreinte est conservée. */

  base.get('/api/admin/team', ({ session }) => ({
    body: {
      members: app.store.team.map(publicMember),
      roles: ROLE_IDS.map((id) => ({ id, label: ROLES[id].label, description: ROLES[id].description, permissions: ROLES[id].permissions })),
      permissions: PERMISSIONS,
      current: { role: session?.role || 'proprietaire', memberId: session?.memberId || '', memberName: session?.memberName || 'Propriétaire' },
      ownerEmail: app.store.settings.ownerEmail || '',
    },
    cache: 'no-store',
  }));

  base.post('/api/admin/team', async ({ body, session, ip, requestId }) => {
    const member = await buildMember(body || {});
    if (findMember(app.store.team, member.email)) {
      throw new AppError('ERR-04', { field: 'email', params: { champ: 'adresse e-mail déjà utilisée' } });
    }
    app.store.team.push(member);
    await app.store.saveTeam('membre.création');
    await app.store.audit('team.create', { detail: `${member.email} (${member.role})`, ip });
    return { body: { member: publicMember(member), message: 'Compte créé. Communiquez le mot de passe par un canal sûr.' }, cache: 'no-store' };
  });

  base.patch('/api/admin/team/:id', async ({ params, body, session, ip }) => {
    const member = app.store.team.find((item) => item.id === params.id);
    if (!member) throw new AppError('ERR-10');
    if (body?.role !== undefined) {
      if (!ROLES[body.role] || body.role === 'proprietaire') {
        throw new AppError('ERR-04', { field: 'role', params: { champ: 'rôle' } });
      }
      member.role = body.role;
    }
    if (body?.name !== undefined) member.name = requireField(body.name, 'name', 'nom du membre', { max: 60 });
    if (body?.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new AppError('ERR-04', { field: 'email', params: { champ: 'adresse e-mail' } });
      const other = findMember(app.store.team, email);
      if (other && other.id !== member.id) throw new AppError('ERR-04', { field: 'email', params: { champ: 'adresse e-mail déjà utilisée' } });
      member.email = email;
    }
    if (body?.disabled !== undefined) {
      member.disabled = Boolean(body.disabled);
      // Fermer un accès coupe immédiatement les sessions de ce membre, sans toucher aux autres.
      if (member.disabled) app.sessions.revokeMember(member.id);
    }
    if (body?.password !== undefined) {
      const secret = String(body.password || '');
      if (secret.length < 10) throw new AppError('ERR-04', { field: 'password', params: { champ: 'mot de passe' } });
      const { passwordHash, salt, iterations } = await hashPassword(secret);
      Object.assign(member, { passwordHash, salt, iterations });
      app.sessions.revokeMember(member.id);
    }
    member.updatedAt = new Date().toISOString();
    await app.store.saveTeam('membre.modification');
    await app.store.audit('team.update', { detail: `${member.email} (${member.role})`, ip });
    return { body: { member: publicMember(member), message: 'Compte mis à jour.' }, cache: 'no-store' };
  });

  base.delete('/api/admin/team/:id', async ({ params, ip }) => {
    const member = app.store.team.find((item) => item.id === params.id);
    if (!member) throw new AppError('ERR-10');
    app.store.team = app.store.team.filter((item) => item.id !== params.id);
    await app.store.saveTeam('membre.suppression');
    app.sessions.revokeMember(member.id);
    await app.store.audit('team.delete', { detail: member.email, ip });
    return { body: { message: 'Compte supprimé. Ses sessions ont été fermées.' }, cache: 'no-store' };
  });

  // Journal d'activité lisible : qui a fait quoi, dans l'ordre inverse.
  /* Test d'une adresse candidate, avant enregistrement. Rien n'est écrit dans le catalogue. */
  base.post('/api/admin/link/test', async ({ body }) => {
    const url = String(body?.url || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048) {
      throw new AppError('ERR-04', { field: 'url', params: { champ: 'adresse du flux' } });
    }
    const started = Date.now();
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), 8000);
    try {
      const reponse = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controleur.signal,
        headers: { 'user-agent': 'StreamTV/3.9 (test de lien)', accept: '*/*' },
      });
      const type = String(reponse.headers.get('content-type') || '');
      const corps = (await reponse.text()).slice(0, 4096);
      const manifeste = /#EXTM3U/i.test(corps);
      const ok = reponse.ok && (manifeste || /mpegurl|video|octet-stream/i.test(type) || /\.m3u8($|\?)/i.test(url));
      return {
        body: {
          ok,
          httpStatus: reponse.status,
          latencyMs: Date.now() - started,
          contentType: type,
          manifeste,
          verdict: ok ? 'Adresse joignable et lisible comme un flux.'
            : manifeste ? 'Le fichier répond mais le serveur annonce une erreur.'
              : 'Le serveur répond, sans manifeste HLS reconnu.',
        },
        cache: 'no-store',
      };
    } catch (error) {
      const expire = error?.name === 'AbortError';
      return {
        body: {
          ok: false,
          httpStatus: 0,
          latencyMs: Date.now() - started,
          contentType: '',
          manifeste: false,
          verdict: expire ? 'Aucune réponse en 8 secondes : le flux est probablement indisponible.' : 'Connexion impossible depuis le serveur.',
        },
        cache: 'no-store',
      };
    } finally {
      clearTimeout(minuteur);
    }
  });

  base.get('/api/admin/audit', async ({ query }) => {
    const entries = await app.store.readAudit(queryInt(query, 'lines', { min: 10, max: 200, fallback: 60 }));
    // Deux lectures du même journal : les lignes brutes pour chercher, les phrases pour décider.
    const phrases = describeAudit(entries);
    return {
      body: {
        entries: entries.map((entry, index) => ({ ...entry, phrase: phrases[index].phrase, ton: phrases[index].ton })),
        resume: phrases,
        total: entries.length,
      },
      cache: 'no-store',
    };
  });

  /* ------------------------------------------------------------------- agent de diagnostic
     Ne modifie rien : lit l'état réel, hiérarchise ce qui bloque les utilisateurs,
     puis rend une conclusion par constat avec l'action attendue. */

  base.get('/api/admin/diagnostic', async () => {
    const settings = app.store.settings;
    const channels = app.store.channels.filter((channel) => !channel.deleted);
    const visibles = channels.filter((channel) => isPublic(channel, settings));
    const down = channels.filter((channel) => channel.health?.status === 'down');
    const flaky = channels.filter((channel) => channel.health?.status === 'flaky');
    const inconnues = channels.filter((channel) => !channel.health?.status || channel.health.status === 'unknown');
    const bloquees = channels.filter((channel) => channel.blocked);
    const sansGuide = visibles.filter((channel) => !channel.tvgId && !channel.epgId);
    const sansLogo = visibles.filter((channel) => !channel.logo);
    const sansVariante = visibles.filter((channel) => !(channel.variants || []).length && channel.health?.status === 'down');
    const faibles = visibles.filter((channel) => (channel.confidence ?? 1) < settings.confidenceFloor && !channel.manualOverride);

    const constats = [];
    const ajouter = (severite, code, titre, detail, action, lien) => constats.push({ severite, code, titre, detail, action, lien });
    if (app.auth.isDefaultPasswordActive()) {
      ajouter('critique', 'SEC-01', 'Mot de passe par défaut actif', 'Toute personne qui connaît « admin » entre dans la console.', 'Réglages, puis changer le mot de passe', '/admin?onglet=reglages');
    }
    if (down.length) {
      ajouter('critique', 'LECT-01', `${down.length} chaîne${down.length > 1 ? 's' : ''} ne répond${down.length > 1 ? 'ent' : ''} plus`, 'La sonde a mesuré un flux mort : le visiteur voit une mire.', 'Remplacer le lien ou masquer la chaîne', '/admin?onglet=liens&sante=down');
    }
    if (bloquees.length) {
      ajouter('avertissement', 'LECT-02', `${bloquees.length} chaîne${bloquees.length > 1 ? 's' : ''} bloquée${bloquees.length > 1 ? 's' : ''}`, 'Flux en HTTP sous un site HTTPS, ou droits retirés : le navigateur refuse.', 'Vérifier la source ou remplacer l’adresse', '/admin?onglet=liens&sante=blocked');
    }
    if (flaky.length) {
      ajouter('avertissement', 'LECT-03', `${flaky.length} flux instable${flaky.length > 1 ? 's' : ''}`, 'Réponse irrégulière : coupures probables en soirée.', 'Tester puis remplacer le lien', '/admin?onglet=liens&sante=flaky');
    }
    if (sansVariante.length) {
      ajouter('avertissement', 'LECT-04', `${sansVariante.length} chaîne${sansVariante.length > 1 ? 's' : ''} en panne sans secours`, 'Aucune variante ni autre source : le repli automatique ne peut pas s’appliquer.', 'Ajouter une variante ou une autre source', '/admin?onglet=liens');
    }
    if (inconnues.length > visibles.length * 0.5) {
      ajouter('info', 'SANTE-01', `${inconnues.length} chaînes jamais mesurées`, 'La sonde n’a pas encore tourné : la santé affichée reste « non testée ».', 'Lancer une sonde depuis l’onglet Santé', '/admin?onglet=sante');
    }
    if (sansGuide.length) {
      ajouter('info', 'EPG-01', `${sansGuide.length} chaîne${sansGuide.length > 1 ? 's' : ''} sans identifiant de guide`, 'Aucun programme ne peut être affiché pour ces chaînes.', 'Vérifier le tvg-id dans la source', '/admin?onglet=liens');
    }
    if (sansLogo.length > 20) {
      ajouter('info', 'VIS-01', `${sansLogo.length} chaînes sans logo`, 'Les cartes affichent les initiales : lisible, mais moins vendeur.', 'Ajouter un logo dans la fiche chaîne', '/admin?onglet=catalogue');
    }
    if (faibles.length) {
      ajouter('info', 'CLASS-01', `${faibles.length} chaînes sous le seuil de confiance`, 'Classement automatique incertain, la catégorie peut tromper le visiteur.', 'Reclasser ou apprendre des corrections', '/admin?onglet=catalogue');
    }
    const ordre = { critique: 0, avertissement: 1, info: 2 };
    constats.sort((a, b) => ordre[a.severite] - ordre[b.severite]);

    const score = Math.max(0, 100
      - constats.filter((item) => item.severite === 'critique').length * 18
      - constats.filter((item) => item.severite === 'avertissement').length * 7
      - constats.filter((item) => item.severite === 'info').length * 2);

    return {
      body: {
        score,
        verdict: score >= 85 ? 'Le site est prêt pour le public.' : score >= 60
          ? 'Le site fonctionne, quelques points méritent une action aujourd’hui.'
          : 'Des points bloquants nuisent à l’expérience : traitez les constats critiques.',
        constats,
        chiffres: {
          total: channels.length,
          visibles: visibles.length,
          down: down.length,
          flaky: flaky.length,
          bloquees: bloquees.length,
          inconnues: inconnues.length,
          sansGuide: sansGuide.length,
          sansLogo: sansLogo.length,
        },
        genereLe: new Date().toISOString(),
      },
      cache: 'no-store',
    };
  });

  /* ----------------------------------------------------------------- usage réel (anonyme)
     Aucune adresse, aucun identifiant : un compteur par chaîne et par heure. */

  base.get('/api/admin/analytics', ({ query }) => {
    const plays = app.store.plays || { totals: {}, hours: {} };
    const heures = Math.max(1, Math.min(720, queryInt(query, 'heures', { min: 1, max: 720, fallback: 168 })));
    const seuil = new Date(Date.now() - heures * 3600_000).toISOString().slice(0, 13);
    const parHeure = Object.entries(plays.hours || {})
      .filter(([hour]) => hour >= seuil)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, count]) => ({ hour, count }));
    const totalFenetre = parHeure.reduce((sum, item) => sum + item.count, 0);
    const parChaine = Object.entries(plays.totals || {})
      .map(([id, entry]) => ({
        id,
        name: channelName(app, id),
        count: Number(entry.count || 0),
        lastAt: entry.lastAt || '',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const totalGeneral = Object.values(plays.totals || {}).reduce((sum, entry) => sum + Number(entry.count || 0), 0);
    return {
      body: {
        fenetreHeures: heures,
        totalFenetre,
        totalGeneral,
        chainesSuivies: Object.keys(plays.totals || {}).length,
        parHeure,
        parChaine,
        exemple: totalGeneral === 0 ? 'Les compteurs démarrent avec la première lecture : ils sont anonymes et cumulatifs.' : '',
      },
      cache: 'no-store',
    };
  });

}
