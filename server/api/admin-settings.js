// server/api/admin-settings.js · lecture et écriture des réglages du site (3.11.0).
// Extraits de admin.js pour garder chaque fichier sous la limite de 900 lignes et
// un seul rôle : ici, tout ce qui touche aux réglages, y compris l'entrée secrète.

import { LICENSE_NOTES } from '../core/constants.js';
import { AppError } from '../core/errors.js';
import { DEFAULTS, SETTING_COUNT, schemaForClient, validateSettings } from '../core/settings.js';

export function registerSettingsRoutes(base, app) {
  // Lecture : les valeurs, le schéma complet et les valeurs par défaut.
  base.get('/api/admin/settings', () => ({
    body: {
      settings: app.store.settings,
      schema: schemaForClient(),
      defaults: DEFAULTS,
      licenseNotes: LICENSE_NOTES,
      adminPath: app.store.settings.adminPath,
      deviceLock: Boolean(app.store.settings.adminDeviceLock),
      deviceCount: app.store.devices.length,
      // État de l'envoi : jamais le mot de passe, seulement de quoi comprendre un refus.
      mail: {
        ready: app.smtpReady(),
        destination: app.store.settings.adminEmail,
        host: app.mail.host || '',
        from: app.mail.from || '',
      },
    },
    cache: 'no-store',
  }));

  // Écriture : validation globale, aucune écriture partielle.
  base.patch('/api/admin/settings', async ({ body, ip, requestId }) => {
    const patch = body && typeof body === 'object' ? body : {};
    const unknown = Object.keys(patch).filter((key) => !(key in DEFAULTS));
    if (unknown.length) throw new AppError('ERR-04', { field: unknown[0], params: { champ: unknown[0] } });
    const existingIds = new Set(app.store.channels.filter((channel) => !channel.deleted).map((channel) => channel.id));
    const { settings, errors } = validateSettings(patch, { existingIds, base: app.store.settings });
    if (errors.length) {
      const first = errors[0];
      throw new AppError(first.code, { field: first.field, message: first.message });
    }
    const next = { ...app.store.settings, ...settings };
    // On ne ferme pas la porte en laissant la clé dehors : le verrou d'appareil n'est
    // accepté que si un appareil est déjà enregistré.
    if (next.adminDeviceLock && !app.store.settings.adminDeviceLock && !app.store.devices.length) {
      throw new AppError('ERR-16', { params: { raison: 'aucun appareil enregistré' } });
    }
    // Un code par e-mail sans serveur d'envoi enfermerait le propriétaire dehors.
    if (next.adminEmail && !app.smtpReady()) {
      throw new AppError('ERR-16', {
        params: { raison: 'aucun serveur d’envoi n’est configuré sur ce serveur (STREAMTV_SMTP_HOST manquant)' },
      });
    }
    const cheminChange = next.adminPath !== app.store.settings.adminPath;
    await app.store.saveSettings(next, 'settings.update');
    await app.store.audit('settings.update', { ip, requestId, detail: Object.keys(patch).join(',') });
    return {
      body: {
        settings: app.store.settings,
        message: cheminChange
          ? `Adresse de la console changée : /${app.store.settings.adminPath}`
          : 'Réglages enregistrés.',
        requiresReload: cheminChange,
        adminPath: app.store.settings.adminPath,
      },
      cache: 'no-store',
    };
  });

  // Envoi d'un message de contrôle vers l'adresse enregistrée : aucun code dedans.
  base.post('/api/admin/mail/test', async ({ ip }) => {
    const adresse = String(app.store.settings.adminEmail || '').trim();
    if (!adresse) throw new AppError('ERR-16', { params: { raison: 'aucune adresse de destination n’est enregistrée' } });
    if (!app.smtpReady()) throw new AppError('ERR-16', { params: { raison: 'aucun serveur d’envoi n’est configuré' } });
    try {
      const result = await app.mailer.test();
      await app.store.audit('mail.test', { ip, result: 'envoyé' });
      return {
        body: { ok: true, latencyMs: result.latencyMs, message: `Message de contrôle envoyé à ${adresse}.` },
        cache: 'no-store',
      };
    } catch (error) {
      await app.store.audit('mail.test', { ip, result: error.message });
      throw new AppError('ERR-16', { params: { raison: `l’envoi a échoué : ${error.message}` } });
    }
  });

  // Réinitialisation complète.
  base.post('/api/admin/settings/reset', async ({ ip }) => {
    await app.store.saveSettings({ ...DEFAULTS }, 'settings.reset');
    await app.store.audit('settings.reset', { ip });
    return {
      body: { settings: app.store.settings, message: `Les ${SETTING_COUNT} réglages ont retrouvé leurs valeurs par défaut.` },
      cache: 'no-store',
    };
  });
}
