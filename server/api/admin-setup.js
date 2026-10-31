// server/api/admin-setup.js · état du premier lancement (3.14.0).
// La console ne laisse pas le propriétaire travailler avec un mot de passe partagé et un
// nom absent : cet état est calculé ici, côté serveur, pour que l'écran ne décide de rien.

import { AppError } from '../core/errors.js';
import { LIMITS } from '../core/constants.js';

/** Ce qui manque pour que la console soit vraiment personnelle. */
export function setupState(app) {
  const settings = app.store.settings;
  const nom = String(settings.adminName || '').trim();
  const adresse = String(settings.adminEmail || '').trim();
  const motDePasseParDefaut = app.auth.isDefaultPasswordActive();
  const appareils = app.store.devices.length;
  const etapes = [
    {
      id: 'identite',
      titre: 'Votre nom',
      aide: 'Il signe chaque action du journal. Un nom, pas un rôle.',
      fait: Boolean(nom),
      obligatoire: true,
    },
    {
      id: 'mot-de-passe',
      titre: 'Votre mot de passe',
      aide: motDePasseParDefaut
        ? 'Le mot de passe de démonstration est encore actif : toute personne qui connaît « admin » entre dans la console.'
        : 'Douze caractères au moins, une lettre et un chiffre. Changer ferme les sessions ouvertes.',
      fait: !motDePasseParDefaut,
      obligatoire: true,
    },
    {
      id: 'code',
      titre: 'Code de connexion par e-mail',
      aide: adresse
        ? `Un code à six chiffres part vers ${adresse} à chaque connexion.`
        : 'Facultatif mais recommandé : le mot de passe seul ne suffira plus.',
      fait: Boolean(adresse),
      obligatoire: false,
    },
    {
      id: 'appareil',
      titre: 'Cet appareil',
      aide: appareils
        ? `${appareils} appareil${appareils > 1 ? 's' : ''} autorisé${appareils > 1 ? 's' : ''}. Le verrou peut être activé.`
        : 'Autorisez l’appareil depuis lequel vous travaillez, puis activez le verrou.',
      fait: appareils > 0,
      obligatoire: false,
    },
  ];
  const restantes = etapes.filter((etape) => etape.obligatoire && !etape.fait);
  return {
    etapes,
    termine: restantes.length === 0,
    restantes: restantes.map((etape) => etape.id),
    motDePasseParDefaut,
    nom,
    adresse,
    appareils,
    verrou: Boolean(settings.adminDeviceLock),
    chemin: settings.adminPath,
    regleMotDePasse: {
      min: 12,
      max: 200,
      aide: 'Douze caractères au moins, une lettre, un chiffre, différent de l’actuel.',
    },
    limiteCorps: LIMITS.maxBodyAdmin,
  };
}

export function registerSetupRoutes(base, app) {
  base.get('/api/admin/setup', () => ({ body: setupState(app), cache: 'no-store' }));

  // Le nom du propriétaire se pose ici aussi : un écran, une action, aucun détour.
  base.post('/api/admin/setup/identity', async ({ body, ip }) => {
    const nom = String(body?.name || '').replace(/\s+/g, ' ').trim();
    if (nom.length < 2 || nom.length > 60) {
      throw new AppError('ERR-04', { field: 'name', params: { champ: 'nom du propriétaire' } });
    }
    await app.store.saveSettings({ ...app.store.settings, adminName: nom }, 'setup.identity');
    await app.store.audit('settings.update', { ip, detail: 'adminName', result: 'nom du propriétaire défini' });
    return { body: { nom, ...setupState(app) }, cache: 'no-store' };
  });
}
