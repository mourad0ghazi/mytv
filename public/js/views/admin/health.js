// public/js/views/admin/health.js · onglet Santé : sonde bornée, états up/flaky/down/unknown.
// Une sonde ne bloque jamais la console : elle est plafonnée en durée et en nombre.

import { Admin } from '../../api.js?v=3.18.1';
import { h, icon, modal, toast, spinner, emptyState, fmtNumber, healthLabel } from '../../ui.js?v=3.18.1';
import { statCard } from '../../components.js?v=3.18.1';
import { confirmModal, apiGuard } from './common.js?v=3.18.1';
import { channelModal } from './catalogue.js?v=3.18.1';

/* ------------------------------------------------------------------ F-22 : apprentissage */

/** Ce que l'administration a appris des corrections : visible, borné, jamais opaque. */
function learningPanel(learning, onRefresh) {
  const data = learning || { corrections: 0, usable: 0, categories: 0, terms: 0, minSupport: 2, top: [], manualRules: 0 };
  const top = Array.isArray(data.top) ? data.top : [];
  return h('section', { class: 'panel', style: { marginTop: '16px' } },
    h('div', { class: 'section-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Apprentissage'), h('h2', { style: { fontSize: '20px' } }, 'Règles apprises des corrections')),
      h('span', { class: 'badge' }, icon('database', 12), `${fmtNumber(data.terms)} terme${data.terms > 1 ? 's' : ''} appris`)),
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Chaque correction manuelle nourrit un lexique pondéré (TF-IDF simple, support minimal de '
      + `${data.minSupport} corrections). Les règles manuelles gardent la priorité : un apprentissage ne peut jamais annuler une décision explicite.`),
    h('div', { class: 'stat-grid' },
      statCard('Corrections', fmtNumber(data.corrections), `${fmtNumber(data.usable)} exploitables`, 'ok'),
      statCard('Termes appris', fmtNumber(data.terms), `${fmtNumber(data.categories)} catégories`, data.terms ? 'ok' : ''),
      statCard('Règles manuelles', fmtNumber(data.manualRules), 'priorité absolue', 'ok'),
      statCard('Support minimal', fmtNumber(data.minSupport), 'corrections identiques')),
    top.length
      ? h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Terme appris'), h('th', {}, 'Catégorie'), h('th', {}, 'Poids'))),
        h('tbody', {}, top.map((entry) => h('tr', {},
          h('td', { dir: 'auto' }, entry.term),
          h('td', {}, entry.category),
          h('td', { class: 'tabular' }, entry.weight.toFixed(2)))))))
      : h('p', { class: 'muted', style: { margin: '12px 0 0' } },
        'Aucune règle apprise pour l’instant : corrigez deux fois le même mot dans une catégorie pour la voir apparaître ici.'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { marginTop: '12px' }, onClick: onRefresh },
      icon('retry', 14), 'Recalculer'));
}

/* ------------------------------------------------------------------ alertes */

const SEVERITY_LABEL = { error: 'Bloquante', warn: 'À surveiller', ok: 'Situation normale' };

/** §10.4 · chaque alerte affiche sa valeur, son seuil et l'action attendue. */
function alertPanel(alerts, onRefresh) {
  const items = Array.isArray(alerts.items) ? alerts.items : [];
  const tone = alerts.level === 'error' ? 'danger' : alerts.level === 'warn' ? 'warn' : 'ok';
  if (!items.length) {
    return h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('div', { class: 'section-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Exploitation'), h('h2', { style: { fontSize: '20px' } }, 'Alertes de seuil')),
        h('span', { class: 'badge', dataset: { tone: 'ok' } }, icon('check', 12), 'Aucune alerte')),
      h('p', { class: 'muted', style: { margin: '0' } },
        'Douze seuils sont surveillés en continu : variation du catalogue, confiance, disponibilité, échecs de connexion, espace disque, âge des sauvegardes.'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { marginTop: '12px' }, onClick: onRefresh },
        icon('retry', 14), 'Recalculer'));
  }
  return h('section', { class: 'panel', style: { marginTop: '16px' } },
    h('div', { class: 'section-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Exploitation'), h('h2', { style: { fontSize: '20px' } }, 'Alertes de seuil')),
      h('span', { class: 'badge', dataset: { tone } },
        icon(alerts.level === 'error' ? 'alert' : 'clock', 12),
        `${items.length} alerte${items.length > 1 ? 's' : ''} · ${SEVERITY_LABEL[alerts.level] || SEVERITY_LABEL.ok}`)),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Gravité'), h('th', {}, 'Constat'), h('th', {}, 'Mesure'), h('th', {}, 'Seuil'), h('th', {}, 'Action'))),
      h('tbody', {}, items.map((item) => h('tr', {},
        h('td', {}, h('span', { class: 'badge', dataset: { tone: item.severity === 'error' ? 'danger' : 'warn' } }, SEVERITY_LABEL[item.severity] || item.severity)),
        h('td', { dir: 'auto' }, item.label),
        h('td', { class: 'tabular' }, `${fmtNumber(Math.round(item.value * 10) / 10)}${item.detail ? ` ${item.detail}` : ''}`),
        h('td', { class: 'tabular muted' }, String(item.threshold)),
        h('td', { class: 'muted', dir: 'auto' }, item.action)))))));
}

/* ------------------------------------------------------------------ santé */

async function renderHealth(host, ctx, state, { refreshStats, stats }) {
  const current = stats();
  const probeHost = h('div', {});
  const limit = h('select', { class: 'select', 'aria-label': 'Nombre de chaînes à sonder' },
    [20, 40, 80, 100].map((value) => h('option', { value: String(value), selected: value === 40 }, `${value} chaînes`)));
  const probeBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' },
    icon('heart', 14), 'Lancer une sonde');

  probeBtn.addEventListener('click', () => {
    confirmModal({
      title: 'Sonder les flux',
      message: 'Chaque flux est testé une seule fois, sans lecture vidéo. Les résultats mettent à jour la pastille de santé et les blocages automatiques.',
      confirmLabel: 'Sonder',
      danger: false,
      onConfirm: async () => {
        document.querySelector('.modal-backdrop')?.remove();
        probeBtn.disabled = true;
        probeBtn.replaceChildren(icon('retry', 14), 'Sonde en cours…');
        probeHost.replaceChildren(spinner('Test des flux, 8 en parallèle, 6 secondes maximum par flux…'));
        try {
          const result = await Admin.probe({ limit: Number(limit.value) });
          state.probe = result;
          probeHost.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'info' } },
            icon('check', 16), h('p', { text: result.message })));
          toast(result.message, { tone: 'success', duration: 6000 });
          await refreshStats();
          renderHealth(host, ctx, state, { refreshStats, stats });
        } catch (error) {
          if (apiGuard(ctx, error)) return;
          probeHost.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'danger' } }, icon('alert', 16), h('p', { text: error.message })));
        } finally {
          probeBtn.disabled = false;
          probeBtn.replaceChildren(icon('heart', 14), 'Lancer une sonde');
        }
      },
    });
  });

  const alerts = current.alerts || { level: 'ok', items: [], metrics: {} };
  const engine = current.confidence.engine;
  const maxCount = Math.max(...current.confidence.histogram.map((bucket) => bucket.count), 1);
  const host2 = h('div', {});
  host.replaceChildren(
    h('div', { class: 'stat-grid' },
      statCard('Disponibles', fmtNumber(current.health.up), 'sonde réussie', 'ok'),
      statCard('Instables', fmtNumber(current.health.flaky), 'lenteur, CORS ou 5xx', 'warn'),
      statCard('Indisponibles', fmtNumber(current.health.down), '3 échecs consécutifs', 'danger'),
      statCard('Non testées', fmtNumber(current.health.unknown), 'état initial obligatoire')),
    alertPanel(alerts, () => renderHealth(host, ctx, state, { refreshStats, stats })),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('p', { class: 'eyebrow' }, 'Mesure'),
      h('h2', { style: { fontSize: '20px', marginBottom: '4px' } }, 'Sonde de disponibilité'),
      h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Concurrence 8, délai 6 secondes, plafond de 300 sondes par minute.'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, limit, probeBtn),
      probeHost),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('p', { class: 'eyebrow' }, 'Cerveau du catalogue'),
      h('h2', { style: { fontSize: '20px', marginBottom: '12px' } }, 'Moteur de catégorisation'),
      h('div', { class: 'stat-grid' },
        statCard('Vitesse', `${fmtNumber(engine.vitesse)} ch/s`, 'cible ≥ 5 000', engine.vitesse >= 5000 ? 'ok' : 'warn'),
        statCard('Accord au groupe', `${Math.round(engine.accordGenre * 100)} %`, 'cible ≥ 85 %', engine.accordGenre >= 0.85 ? 'ok' : 'warn'),
        statCard('Sous 0,45', `${(engine.sous045 * 100).toFixed(1)} %`, 'cible ≤ 10 %', engine.sous045 <= 0.1 ? 'ok' : 'warn'),
        statCard('Confiance moyenne', (engine.confianceMoyenne || 0).toFixed(2), 'cible ≥ 0,80', engine.confianceMoyenne >= 0.8 ? 'ok' : 'warn')),
      h('div', { class: 'histogram', style: { marginTop: '16px' } },
        current.confidence.histogram.map((bucket) => h('div', { class: 'hist-row' },
          h('span', { class: 'count-label' }, `${Math.round(bucket.min * 100)}–${Math.round(bucket.max * 100)} %`),
          h('span', { class: 'hist-bar' }, h('span', { style: { width: `${Math.round((bucket.count / maxCount) * 100)}%` } })),
          h('span', { class: 'tabular' }, fmtNumber(bucket.count))))),
      h('p', { class: 'muted', style: { marginTop: '12px', fontSize: '13px' } },
        `Décisions : ${Object.entries(current.sources).map(([key, value]) => `${key} ${fmtNumber(value)}`).join(' · ')} · ${fmtNumber(engine.total)} chaînes mesurées en ${engine.durationMs} ms.`)),
    learningPanel(current.learning, () => renderHealth(host, ctx, state, { refreshStats, stats })),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('div', { class: 'section-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Qualité'), h('h2', { style: { fontSize: '20px' } }, 'File « à vérifier »')),
        h('span', { class: 'badge' }, `seuil ${Math.round(current.confidence.floor * 100)} %`)),
      current.queue.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'N°'), h('th', {}, 'Chaîne'), h('th', {}, 'Catégorie'), h('th', {}, 'Confiance'), h('th', {}, 'Motif'), h('th', {}, ''))),
          h('tbody', {}, current.queue.map((item) => h('tr', {},
            h('td', { class: 'num' }, String(item.number)),
            h('td', { dir: 'auto' }, item.name),
            h('td', {}, item.categoryLabel),
            h('td', { class: 'num' }, `${Math.round(item.confidence * 100)} %`),
            h('td', { class: 'muted', style: { fontSize: '12px' } }, item.reasons?.[0] || 'Non renseigné'),
            h('td', {}, h('button', {
              class: 'btn btn-quiet btn-sm', type: 'button',
              onClick: () => channelModal(ctx, item.id, { onDone: () => renderHealth(host, ctx, state, { refreshStats, stats }) }),
            }, icon('edit', 14), 'Corriger')))))))
        : emptyState({ iconName: 'check', title: 'Aucune chaîne en attente', message: 'Toutes les chaînes dépassent le seuil de confiance.' })),
    state.probe?.results?.length ? h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', { style: { fontSize: '18px', marginBottom: '10px' } }, `Résultat de la dernière sonde (${state.probe.durationMs} ms)`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'N°'), h('th', {}, 'Chaîne'), h('th', {}, 'État'), h('th', {}, 'HTTP'), h('th', {}, 'Latence'), h('th', {}, 'Cause'))),
        h('tbody', {}, state.probe.results.slice(0, 60).map((item) => h('tr', {},
          h('td', { class: 'num' }, String(item.number)),
          h('td', { dir: 'auto' }, item.name),
          h('td', {}, healthLabel(item.status)),
          h('td', { class: 'num' }, item.httpStatus ? String(item.httpStatus) : 'Non renseigné'),
          h('td', { class: 'num' }, `${item.latencyMs} ms`),
          h('td', { class: 'muted' }, item.reason))))))) : null);
  host.append(host2);
}

export { renderHealth };
