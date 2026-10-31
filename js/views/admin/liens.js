// public/js/views/admin/liens.js · console « Chaînes et liens ».
// Inventaire complet : chaque chaîne, son flux, ses variantes, sa santé, ses signalements.
// Actions immédiates : copier le lien, copier la ligne M3U, télécharger la fiche, tester le flux.
// Lecture seule sur le catalogue : toute modification passe par l'onglet Catalogue.

import { Admin, download } from '../../api.js?v=3.18.0';
import { modal } from '../../ui.js?v=3.18.0';
import { h, icon, toast, copyText, emptyState, healthBadge, fmtRelative, hostOf, countryName, flagFor } from '../../ui.js?v=3.18.0';
import { statCard } from '../../components.js?v=3.18.0';
import { apiGuard } from './common.js?v=3.18.0';

const PAGE_SIZE = 25;

function m3uLine(channel) {
  const attrs = [
    channel.tvgId ? `tvg-id="${channel.tvgId}"` : '',
    channel.logo ? `tvg-logo="${channel.logo}"` : '',
    channel.group ? `group-title="${channel.group}"` : '',
  ].filter(Boolean).join(' ');
  return `#EXTINF:-1 ${attrs ? `${attrs} ` : ''},${channel.name}\n${channel.url}`;
}

function downloadText(content, filename, type = 'audio/x-mpegurl') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function copyButton(label, value, { small = true, title = '' } = {}) {
  return h('button', {
    class: `btn btn-quiet ${small ? 'btn-sm' : ''}`, type: 'button', title: title || label,
    'aria-label': title || label,
    onClick: async (event) => {
      event.stopPropagation();
      const done = await copyText(value);
      toast(done ? `${label} : copié.` : 'La copie a échoué sur ce navigateur.', { tone: done ? 'success' : 'error' });
    },
  }, icon('copy', 14), label);
}

function protocolBadge(protocol) {
  const tone = protocol === 'https' ? 'ok' : protocol === 'http' ? 'warn' : '';
  return h('span', { class: 'badge badge-mono', dataset: { tone }, title: protocol === 'http'
    ? 'Flux http : le navigateur le bloque sur un site HTTPS. Il reste lisible dans VLC.' : '' }, protocol.toUpperCase());
}

function reportsCell(channel, threshold) {
  if (!channel.reports) return h('span', { class: 'muted', text: '0' });
  const ratio = Math.min(100, Math.round((channel.reports / threshold) * 100));
  return h('div', { class: 'report-meter', title: `${channel.reports} signalements sur un seuil de ${threshold}` },
    h('span', { class: 'report-count', text: String(channel.reports) }),
    h('span', { class: 'report-bar', role: 'img', 'aria-label': `${channel.reports} signalements sur ${threshold}` },
      h('i', { style: { width: `${ratio}%` }, dataset: { tone: ratio >= 100 ? 'danger' : ratio >= 50 ? 'warn' : '' } })));
}

function detailsRow(channel) {
  const rows = [
    ['Adresse du flux', channel.url],
    ...channel.variants.map((variant) => [`Variante ${variant.quality || ''}`.trim(), variant.url]),
  ];
  const lines = rows.map(([label, url]) => h('div', { class: 'link-line' },
    h('span', { class: 'link-label', text: label }),
    h('code', { class: 'link-url', title: url, text: url }),
    copyButton('Copier', url)));
  const fact = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  const facts = h('dl', { class: 'link-facts' },
    fact('Identifiant', h('code', { text: channel.id })),
    fact('Guide (tvg-id)', h('code', { text: channel.tvgId || 'absent' })),
    fact('Source', channel.sourceId || 'inconnue'),
    fact('Droits', channel.licenseNote || 'non renseignés'),
    fact('Nom d’origine', channel.rawName || channel.name),
    fact('Dernière mesure', channel.health.checkedAt ? fmtRelative(channel.health.checkedAt) : 'jamais mesurée'));
  return h('div', { class: 'link-details' }, lines, facts);
}

/** Remplacement de lien : une seule adresse, testée avant d'enregistrer. */
function replaceLink(channel, onDone) {
  const input = h('input', {
    type: 'url', id: 'nouveau-lien', value: channel.url, required: true, maxlength: '2048',
    placeholder: 'https://…/index.m3u8', spellcheck: 'false',
  });
  const etat = h('p', { class: 'help', role: 'status' }, 'Le nouveau lien remplace l’ancien ; l’ancien est conservé comme variante.');
  const tester = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('retry', 14), 'Tester ce lien');
  const enregistrer = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 15), 'Remplacer le lien');

  tester.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) { etat.textContent = 'Adresse incomplète : elle doit commencer par https://'; etat.dataset.tone = 'danger'; return; }
    tester.disabled = true;
    etat.textContent = 'Test en cours…';
    try {
      const mesure = await Admin.testLink(url);
      etat.textContent = `${mesure.verdict}${mesure.httpStatus ? ` (HTTP ${mesure.httpStatus}, ${mesure.latencyMs} ms)` : ''}`;
      etat.dataset.tone = mesure.ok ? 'success' : 'danger';
    } catch (error) {
      etat.textContent = `Test impossible ici : ${error.message}`;
      etat.dataset.tone = 'warn';
    } finally {
      tester.disabled = false;
    }
  });

  const form = h('form', { class: 'link-form', novalidate: true },
    h('label', { for: 'nouveau-lien' }, 'Nouvelle adresse du flux'),
    input,
    h('div', { class: 'link-form-actions' }, tester, enregistrer),
    etat);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) { etat.textContent = 'Adresse incomplète : elle doit commencer par https://'; etat.dataset.tone = 'danger'; return; }
    enregistrer.disabled = true;
    try {
      await Admin.update(channel.id, { url });
      toast('Lien remplacé. L’ancienne adresse reste disponible comme variante.', { tone: 'success', duration: 6000 });
      onDone?.();
    } catch (error) {
      etat.textContent = error.message || 'Remplacement refusé.';
      etat.dataset.tone = 'danger';
      enregistrer.disabled = false;
    }
  });
  return form;
}

function openLinkDialog(channel, onDone) {
  // Le corps a besoin de la fonction de fermeture : on la récupère après création.
  const boite = { close: () => {} };
  const dialogue = modal({
    title: `Remplacer le lien · ${channel.name}`,
    body: replaceLink(channel, () => { boite.close(); onDone?.(); }),
    actions: [],
  });
  boite.close = dialogue.close;
  return dialogue;
}

function channelRow(channel, { threshold, onToggle, onTest, open, busy, onReplace }) {
  const actions = h('div', { class: 'row-actions' },
    copyButton('Lien', channel.url, { title: `Copier l’adresse du flux de ${channel.name}` }),
    copyButton('M3U', m3uLine(channel), { title: `Copier la ligne M3U de ${channel.name}` }),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', title: 'Télécharger une liste M3U contenant cette seule chaîne',
      'aria-label': `Télécharger la fiche M3U de ${channel.name}`,
      onClick: (event) => {
        event.stopPropagation();
        downloadText(`#EXTM3U\n${m3uLine(channel)}\n`, `streamtv-${channel.number || channel.id}.m3u`);
      },
    }, icon('download', 14), 'Fiche'),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', title: 'Ouvrir dans l’application VLC si elle est installée sur cet appareil',
      'aria-label': `Ouvrir ${channel.name} dans VLC`,
      onClick: (event) => {
        event.stopPropagation();
        window.location.href = `vlc://${channel.url}`;
        toast('Si VLC est installé, il ouvre le flux. Sur ordinateur, utilisez plutôt la fiche M3U.', { tone: 'info', duration: 7000 });
      },
    }, icon('external', 14), 'VLC'),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', disabled: busy ? 'disabled' : null,
      'aria-label': `Tester le flux de ${channel.name}`,
      onClick: (event) => { event.stopPropagation(); onTest(channel); },
    }, icon('retry', 14), 'Tester'),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      'aria-label': `Remplacer le lien de ${channel.name}`,
      onClick: (event) => { event.stopPropagation(); onReplace(channel); },
    }, icon('edit', 14), 'Remplacer'),
    h('a', { class: 'btn btn-quiet btn-sm', href: `/chaine/${channel.id}`, 'data-link': '', title: 'Ouvrir la fiche publique' },
      icon('tv', 14), 'Fiche site'));

  const badges = [];
  if (channel.deleted) badges.push(h('span', { class: 'badge', dataset: { tone: 'danger' } }, 'Supprimée'));
  if (!channel.deleted && !channel.visible) badges.push(h('span', { class: 'badge', dataset: { tone: 'warn' } }, channel.blockedReason === 'retrait-signalement' ? 'Retirée sur signalement' : 'Masquée'));
  if (channel.manualOverride) badges.push(h('span', { class: 'badge' }, icon('lock', 12), 'Verrou'));
  if (channel.featured) badges.push(h('span', { class: 'badge' }, icon('star', 12), 'Vedette'));

  const main = h('tr', { class: 'link-row' },
    h('td', { class: 'link-num' }, h('span', { class: 'mono', text: channel.number ?? '0' })),
    h('td', {},
      h('div', { class: 'link-channel' },
        channel.logo ? h('img', { class: 'link-logo', src: channel.logo, alt: '', loading: 'lazy', width: '28', height: '28' }) : h('span', { class: 'link-logo link-logo-empty', 'aria-hidden': 'true' }),
        h('div', {},
          h('p', { class: 'link-name', text: channel.name }),
          h('p', { class: 'link-meta' },
            `${channel.categoryLabel} · ${channel.country ? flagFor(channel.country) : ''} ${channel.country ? countryName(channel.country) : 'pays inconnu'} · ${channel.quality}`),
          badges.length ? h('div', { class: 'link-badges' }, badges) : null))),
    h('td', {}, healthBadge(channel.health.status),
      channel.health.httpStatus ? h('p', { class: 'link-meta', text: `HTTP ${channel.health.httpStatus}${channel.health.latencyMs ? ` · ${channel.health.latencyMs} ms` : ''}` }) : null),
    h('td', {},
      h('div', { class: 'link-flux' }, protocolBadge(channel.protocol),
        h('button', {
          class: 'link-host', type: 'button', 'aria-expanded': open ? 'true' : 'false',
          'aria-label': `${open ? 'Masquer' : 'Afficher'} les adresses de ${channel.name}`,
          onClick: () => onToggle(channel.id),
        }, hostOf(channel.url), icon(open ? 'chevronDown' : 'chevron', 14))),
      h('p', { class: 'link-meta', text: channel.variants.length ? `${channel.variants.length} variante${channel.variants.length > 1 ? 's' : ''}` : 'aucune variante' })),
    h('td', {}, reportsCell(channel, threshold)),
    h('td', {}, actions));

  if (!open) return main;
  return h('tbody', {}, main,
    h('tr', { class: 'link-row-details' }, h('td', { colspan: '5' }, detailsRow(channel))));
}

export async function renderLiens(panel, ctx, state, { stats } = {}) {
  const local = {
    page: 1,
    q: '',
    category: '',
    visibility: 'all',
    health: 'all',
    protocol: '',
    source: '',
    sort: 'number',
    open: new Set(),
    busy: false,
  };

  const view = h('div', { class: 'console' });
  panel.replaceChildren(view);

  const kpis = h('div', { class: 'stat-grid' });
  const countLine = h('p', { class: 'console-count', role: 'status', 'aria-live': 'polite' });
  const tableShell = h('div', { class: 'table-shell' });
  const pager = h('div', { class: 'pager' });

  const search = h('input', { type: 'search', id: 'liens-q', placeholder: 'Nom, pays, identifiant…', maxlength: '80', autocomplete: 'off' });
  const buildSelect = (id, label, options, value) => {
    const select = h('select', { id }, options.map(([optionValue, optionLabel]) => h('option', { value: optionValue, selected: optionValue === value ? 'selected' : null }, optionLabel)));
    return h('div', { class: 'field field-inline' }, h('label', { for: id }, label), select);
  };

  let meta = { categories: [], protocols: [], sources: [] };
  try {
    meta = await Admin.consoleMeta();
  } catch (error) {
    if (apiGuard(ctx, error)) return;
  }

  const categorySelect = buildSelect('liens-cat', 'Catégorie', [['', 'Toutes'], ...(meta.categories || []).map((id) => [id, id])], '');
  const visibilitySelect = buildSelect('liens-vis', 'État', [
    ['all', 'Toutes'], ['public', 'Visibles'], ['hidden', 'Masquées'], ['blocked', 'Bloquées'], ['deleted', 'Supprimées'], ['reported', 'Signalées'],
  ], 'all');
  const healthSelect = buildSelect('liens-health', 'Santé', [
    ['all', 'Toutes'], ['up', 'Disponibles'], ['flaky', 'Instables'], ['down', 'Injoignables'], ['unknown', 'Non testées'],
  ], 'all');
  const protocolSelect = buildSelect('liens-proto', 'Protocole', [['', 'Tous'], ...(meta.protocols || []).map((id) => [id, id.toUpperCase()])], '');
  const sourceSelect = buildSelect('liens-source', 'Source', [['', 'Toutes'], ...(meta.sources || []).map((item) => [item.id, item.name])], '');
  const sortSelect = buildSelect('liens-sort', 'Tri', [
    ['number', 'Numéro'], ['name', 'Nom'], ['reports', 'Signalements'], ['health', 'Santé'], ['updated', 'Modification'],
  ], 'number');

  const toolbar = h('form', { class: 'console-toolbar', role: 'search', onSubmit: (event) => { event.preventDefault(); load(1); } },
    h('div', { class: 'field field-wide' }, h('label', { for: 'liens-q' }, 'Rechercher'), search),
    categorySelect, visibilitySelect, healthSelect, protocolSelect, sourceSelect, sortSelect);

  const bind = (select, key) => select.querySelector('select').addEventListener('change', (event) => {
    local[key] = event.target.value;
    load(1);
  });
  bind(categorySelect, 'category');
  bind(visibilitySelect, 'visibility');
  bind(healthSelect, 'health');
  bind(protocolSelect, 'protocol');
  bind(sourceSelect, 'source');
  bind(sortSelect, 'sort');
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { local.q = search.value.trim(); load(1); }, 260);
  });

  async function load(page = local.page) {
    local.page = page;
    tableShell.replaceChildren(h('p', { class: 'muted console-loading' }, 'Chargement de l’inventaire…'));
    try {
      const data = await Admin.links({
        page: String(local.page),
        pageSize: String(PAGE_SIZE),
        q: local.q,
        category: local.category,
        visibility: local.visibility,
        health: local.health,
        protocol: local.protocol,
        source: local.source,
        sort: local.sort,
      });
      paint(data);
    } catch (error) {
      if (apiGuard(ctx, error, { silent: true })) return;
      tableShell.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: 'L’inventaire n’a pas répondu',
        message: error.message || 'Réessayez dans un instant.',
        actionLabel: 'Réessayer',
        onAction: () => load(local.page),
      }));
    }
  }

  function paint(data) {
    const visibleSelect = visibilitySelect.querySelector('select');
    kpis.replaceChildren(
      statCard('Chaînes', String(data.counts.catalog), `${data.counts.hidden} masquées`, ''),
      statCard('Liens en ligne', String(data.counts.visible), `${data.counts.protocols.https} en https`, 'ok'),
      statCard('Supprimées', String(data.counts.deleted), `${data.counts.blocked} bloquées`, data.counts.deleted ? 'danger' : ''),
      statCard('Signalées', String(data.counts.reported), `seuil ${data.reportThreshold}`, data.counts.reported ? 'warn' : ''),
      statCard('Variantes', String(data.counts.variants), 'flux de secours', ''),
      statCard('Http bloqués en navigateur', String(data.counts.protocols.http), 'lisibles dans VLC', data.counts.protocols.http ? 'warn' : ''));
    countLine.textContent = `${data.total} résultat${data.total > 1 ? 's' : ''} · page ${data.page} sur ${Math.max(1, data.pages)}`;
    if (!data.channels.length) {
      tableShell.replaceChildren(emptyState({
        title: 'Aucune chaîne ne correspond',
        message: 'Élargissez la recherche ou choisissez « Toutes » dans les filtres.',
        actionLabel: 'Tout afficher',
        onAction: () => {
          for (const key of ['q', 'category', 'visibility', 'health', 'protocol', 'source']) local[key] = key === 'visibility' || key === 'health' ? 'all' : '';
          search.value = '';
          if (visibleSelect) visibleSelect.value = 'all';
          load(1);
        },
      }));
      pager.replaceChildren();
      return;
    }
    const head = h('thead', {},
      h('tr', {},
        h('th', { scope: 'col', class: 'link-num' }, 'N°'),
        h('th', { scope: 'col' }, 'Chaîne'),
        h('th', { scope: 'col' }, 'Santé'),
        h('th', { scope: 'col' }, 'Flux'),
        h('th', { scope: 'col' }, 'Signalements'),
        h('th', { scope: 'col' }, 'Actions')));

    const bodies = [];
    for (const channel of data.channels) {
      const row = channelRow(channel, {
        threshold: data.reportThreshold,
        open: local.open.has(channel.id),
        busy: local.busy,
        onToggle: (id) => {
          if (local.open.has(id)) local.open.delete(id); else local.open.add(id);
          paint(data);
        },
        onReplace: (target) => {
          openLinkDialog(target, () => { stats?.(); load(local.page); });
        },
        onTest: async (target) => {
          local.busy = true;
          paint(data);
          try {
            const result = await Admin.probe({ ids: [target.id] });
            toast(`${target.name} : ${result.up ? 'disponible' : result.flaky ? 'instable' : 'injoignable'} (${result.tested} flux testé).`, {
              tone: result.up ? 'success' : result.flaky ? 'warn' : 'error',
            });
            stats?.();
            await load(local.page);
          } catch (error) {
            apiGuard(ctx, error);
          } finally {
            local.busy = false;
          }
        },
      });
      if (row.tagName === 'TBODY') bodies.push(row);
      else bodies.push(h('tbody', {}, row));
    }

    tableShell.replaceChildren(h('table', { class: 'data-table' }, head, ...bodies));

    pager.replaceChildren(
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', disabled: data.page <= 1 ? 'disabled' : null,
        onClick: () => load(data.page - 1),
      }, icon('prev', 14), 'Précédent'),
      h('span', { class: 'pager-info', text: `Page ${data.page} sur ${Math.max(1, data.pages)}` }),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', disabled: data.page >= data.pages ? 'disabled' : null,
        onClick: () => load(data.page + 1),
      }, 'Suivant', icon('next', 14)));
  }

  const exportButton = h('button', {
    class: 'btn btn-primary btn-sm', type: 'button',
    onClick: async () => {
      try {
        await download('/api/admin/export.m3u', 'streamtv.m3u');
        toast('Liste M3U téléchargée : ouvrez-la dans VLC.', { tone: 'success' });
      } catch (error) {
        apiGuard(ctx, error);
      }
    },
  }, icon('download', 14), 'Exporter pour VLC');

  view.append(
    h('div', { class: 'console-head' },
      h('div', {},
        h('h2', {}, 'Chaînes et liens'),
        h('p', { class: 'muted' }, 'Tout ce que le catalogue contient : adresse, variantes, santé mesurée et signalements. Lecture seule ici, les modifications passent par le catalogue.')),
      h('div', { class: 'console-actions' },
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => load(local.page),
        }, icon('retry', 14), 'Rafraîchir'),
        exportButton)),
    kpis,
    toolbar,
    countLine,
    tableShell,
    pager,
    h('p', { class: 'help' },
      `Un flux http s’ouvre dans VLC mais reste bloqué dans le navigateur. Un flux https sans en-tête CORS fait l’inverse. La sonde mesure les deux cas séparément.`));

  await load(1);
}
