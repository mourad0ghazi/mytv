// server/core/exports.js — F-22 : exports M3U et JSON, contenus normalisés, horodatés.
// Un export ne contient jamais les notes privées ni les décisions internes.

import { buildM3U } from './m3u.js';
import { isPublic, projectCard, projectDetail } from './channels.js';
import { VERSION } from './constants.js';

export function exportFileName(extension, date = new Date()) {
  const stamp = date.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `streamtv-${stamp}.${extension}`;
}

export function exportM3U(channels, { title = 'StreamTV', epgUrl = '', includeHidden = false, settings = {} } = {}) {
  const list = includeHidden ? channels : channels.filter((channel) => isPublic(channel, settings));
  const text = buildM3U(list, { title, epgUrl });
  return {
    content: Buffer.from(text, 'utf8'),
    type: 'audio/x-mpegurl; charset=utf-8',
    disposition: `attachment; filename="${exportFileName('m3u')}"`,
    count: list.length,
  };
}

export function exportJson(channels, { settings = {}, includeHidden = false, siteProtocol = 'https:' } = {}) {
  const list = includeHidden
    ? channels.map((channel) => ({ ...projectDetail(channel, settings, siteProtocol), notes: channel.notes, manualOverride: channel.manualOverride }))
    : channels.filter((channel) => isPublic(channel, settings)).map((channel) => projectDetail(channel, settings, siteProtocol));
  const payload = {
    format: 'streamtv.catalogue',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    count: list.length,
    settings: {
      brand: settings.brand,
      tagline: settings.tagline,
      pageSize: settings.pageSize,
      defaultSort: settings.defaultSort,
      showAdult: settings.showAdult,
      autoHideAdult: settings.autoHideAdult,
      confidenceFloor: settings.confidenceFloor,
    },
    channels: list,
  };
  return {
    content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
    type: 'application/json; charset=utf-8',
    disposition: `attachment; filename="${exportFileName('json')}"`,
    count: list.length,
  };
}

export function exportCards(channels) {
  return channels.map(projectCard);
}
