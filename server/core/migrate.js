// server/core/migrate.js — F-24 : JSON v1 → SQL v2, réversible, idempotent, journalisé.
// Aucun pilote PostgreSQL n'est embarqué (zéro dépendance) : la migration produit un schéma et un
// jeu d'INSERT que `psql` applique, et sait relire ce qu'elle a écrit pour revenir au JSON.

import { createHash } from 'node:crypto';

import { CHANNEL_FIELDS } from './channels.js';

export const SCHEMA_VERSION = 'streamtv-sql-1';

/** Colonnes de `channels` avec leur type PostgreSQL. L'ordre est celui du contrat (§4.1). */
export const CHANNEL_COLUMNS = Object.freeze(CHANNEL_FIELDS.map((field) => {
  if (['number', 'hue', 'position'].includes(field)) return { name: field, type: 'integer' };
  if (field === 'confidence') return { name: field, type: 'numeric(4,2)' };
  if (['visible', 'blocked', 'manualOverride', 'featured'].includes(field)) return { name: field, type: 'boolean' };
  if (['reasons', 'tags', 'variants', 'health'].includes(field)) return { name: field, type: 'jsonb' };
  return { name: field, type: 'text' };
}));

const COLUMN_BY_NAME = new Map(CHANNEL_COLUMNS.map((column) => [column.name, column]));

/** Type simplifié utilisé à la relecture : integer, numeric, boolean, jsonb, text. */
const COLUMN_TYPES = {
  ...Object.fromEntries(CHANNEL_COLUMNS.map((column) => [
    column.name,
    column.type === 'numeric(4,2)' ? 'numeric' : column.type,
  ])),
  // Colonnes des tables annexes.
  value: 'jsonb', rules: 'jsonb', learned: 'jsonb', corrections: 'jsonb', payload: 'jsonb',
  number_internal: 'integer',
};

/** Valeur JavaScript → littéral SQL sûr (aucune concaténation de chaîne non échappée). */
export function sqlLiteral(value, type = 'text') {
  if (value === null || value === undefined) return 'NULL';
  if (type === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (type === 'integer' || type === 'numeric(4,2)') {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : 'NULL';
  }
  if (type === 'jsonb') {
    const text = JSON.stringify(value);
    return text === undefined ? 'NULL' : `'${text.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function columnList(columns = CHANNEL_COLUMNS) {
  return columns.map((column) => column.name).join(', ');
}

/** DDL complet : idempotent (`IF NOT EXISTS`), rejouable sur une base déjà migrée. */
export function schemaSql({ schema = 'public' } = {}) {
  const columns = CHANNEL_COLUMNS
    .map((column) => `  ${column.name} ${column.type}${column.name === 'id' ? ' PRIMARY KEY' : ''}`)
    .join(',\n');
  return `-- ${SCHEMA_VERSION} — schéma PostgreSQL 15 pour StreamTV
-- Idempotent : rejouable sans perte (aucun DROP).
BEGIN;

CREATE SCHEMA IF NOT EXISTS ${schema};
SET search_path TO ${schema};

CREATE TABLE IF NOT EXISTS streamtv_schema (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
${columns}
);

CREATE INDEX IF NOT EXISTS channels_number_idx ON channels (number);
CREATE INDEX IF NOT EXISTS channels_category_idx ON channels (category);
CREATE INDEX IF NOT EXISTS channels_country_idx ON channels (country);
CREATE INDEX IF NOT EXISTS channels_visible_idx ON channels (visible) WHERE visible;
CREATE INDEX IF NOT EXISTS channels_search_idx ON channels (lower(name) text_pattern_ops);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning (
  id integer PRIMARY KEY,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  learned jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrections jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestions (
  id text PRIMARY KEY,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  action text NOT NULL,
  actor text,
  ip text,
  request_id text,
  channel_ids text[],
  result text,
  detail text
);

CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_log (action, at DESC);

INSERT INTO streamtv_schema (version) VALUES ('${SCHEMA_VERSION}')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
`;
}

/** Découpe une liste de chaînes en paquets d'INSERT de taille raisonnable. */
function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

function upsertTail(columns) {
  const updates = columns
    .filter((column) => column.name !== 'id')
    .map((column) => `${column.name} = EXCLUDED.${column.name}`)
    .join(', ');
  return `ON CONFLICT (id) DO UPDATE SET ${updates}`;
}

/**
 * INSERT idempotents : rejouer le même fichier met à jour sans doublon ni erreur.
 * Les lignes sont triées par identifiant pour que deux exports identiques soient identiques.
 */
export function channelInserts(channels, { table = 'channels', batchSize = 200 } = {}) {
  const rows = [...channels]
    .filter((channel) => channel && typeof channel.id === 'string' && channel.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const statements = [];
  for (const batch of chunk(rows, batchSize)) {
    const values = batch.map((channel) => `  (${CHANNEL_COLUMNS.map((column) => sqlLiteral(channel[column.name], column.type)).join(', ')})`);
    statements.push(`INSERT INTO ${table} (${columnList()}) VALUES\n${values.join(',\n')}\n${upsertTail(CHANNEL_COLUMNS)};`);
  }
  return { sql: statements.join('\n\n'), count: rows.length };
}

function settingsInserts(settings = {}) {
  const rows = Object.entries(settings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `  (${sqlLiteral(key)}, ${sqlLiteral(value, 'jsonb')})`);
  if (!rows.length) return { sql: '', count: 0 };
  return {
    sql: `INSERT INTO settings (key, value) VALUES\n${rows.join(',\n')}\n`
      + 'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();',
    count: rows.length,
  };
}

function learningInsert(learning = {}) {
  return {
    sql: 'INSERT INTO learning (id, rules, learned, corrections) VALUES\n'
      + `  (1, ${sqlLiteral(learning.rules || {}, 'jsonb')}, ${sqlLiteral(learning.learned || {}, 'jsonb')}, `
      + `${sqlLiteral(learning.corrections || [], 'jsonb')})\n`
      + 'ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules, learned = EXCLUDED.learned, '
      + 'corrections = EXCLUDED.corrections, updated_at = now();',
    count: 1,
  };
}

function sourcesInserts(sources = []) {
  const rows = [...sources]
    .filter((source) => source && source.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((source) => `  (${sqlLiteral(source.id)}, ${sqlLiteral(source, 'jsonb')})`);
  if (!rows.length) return { sql: '', count: 0 };
  return {
    sql: `INSERT INTO sources (id, payload) VALUES\n${rows.join(',\n')}\nON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;`,
    count: rows.length,
  };
}

function ingestionsInserts(ingestions = []) {
  const rows = [...ingestions]
    .filter((record) => record && (record.id || record.jobId))
    .sort((a, b) => String(a.id || a.jobId).localeCompare(String(b.id || b.jobId)))
    .map((record) => {
      const id = record.id || record.jobId;
      return `  (${sqlLiteral(id)}, ${sqlLiteral(record.status || 'unknown')}, ${sqlLiteral(record, 'jsonb')})`;
    });
  if (!rows.length) return { sql: '', count: 0 };
  return {
    sql: `INSERT INTO ingestions (id, status, payload) VALUES\n${rows.join(',\n')}\n`
      + 'ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload;',
    count: rows.length,
  };
}

function checksum(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Construit les deux fichiers SQL et le manifeste, sans rien écrire sur le disque. */
export function buildMigration({ channels = [], settings = {}, sources = [], learning = {}, ingestions = [], schema = 'public' } = {}) {
  const ddl = schemaSql({ schema });
  const channelPart = channelInserts(channels);
  const settingsPart = settingsInserts(settings);
  const learningPart = learningInsert(learning);
  const sourcesPart = sourcesInserts(sources);
  const ingestionsPart = ingestionsInserts(ingestions);

  const data = [
    `-- ${SCHEMA_VERSION} — données StreamTV (idempotent, rejouable)`,
    'BEGIN;',
    settingsPart.sql,
    learningPart.sql,
    sourcesPart.sql,
    ingestionsPart.sql,
    channelPart.sql,
    'COMMIT;',
  ].filter(Boolean).join('\n\n') + '\n';

  const counts = {
    channels: channelPart.count,
    settings: settingsPart.count,
    sources: sourcesPart.count,
    ingestions: ingestionsPart.count,
    learning: learningPart.count,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    schema: ddl,
    data,
    counts,
    checksums: { schema: checksum(ddl), data: checksum(data) },
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      schema: schema,
      counts,
      checksums: { schema: checksum(ddl), data: checksum(data) },
      reversible: true,
      idempotent: true,
      generatedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ lecture inverse */

/** Analyse les INSERT produits par ce module et reconstruit les enregistrements. */
export function parseDataSql(sql) {
  const source = String(sql || '');
  const tables = {};
  const insertRe = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?)\s*ON CONFLICT[\s\S]*?;/g;
  let match;
  while ((match = insertRe.exec(source)) !== null) {
    const [, table, cols, body] = match;
    const columns = cols.split(',').map((column) => column.trim());
    const rows = parseTuples(body);
    if (!tables[table]) tables[table] = [];
    for (const values of rows) {
      const record = {};
      columns.forEach((column, index) => {
        record[column] = coerce(values[index], column);
      });
      tables[table].push(record);
    }
  }
  return { tables };
}

function coerce(literal, column) {
  if (literal === 'NULL') return null;
  if (/^TRUE$/i.test(literal)) return true;
  if (/^FALSE$/i.test(literal)) return false;
  const unquoted = literal.startsWith("'") ? literal.slice(1, -1).replace(/''/g, "'") : literal;
  const type = COLUMN_TYPES[column];
  if (type === 'integer') return Number.parseInt(unquoted, 10);
  if (type === 'numeric') return Number(unquoted);
  if (type === 'jsonb') {
    try { return JSON.parse(unquoted); } catch { return unquoted; }
  }
  return unquoted;
}

/** Lit les tuples `(…), (…)` en respectant les chaînes entre apostrophes. */
function parseTuples(body) {
  const tuples = [];
  let index = 0;
  const text = body.trim();
  while (index < text.length) {
    if (text[index] !== '(') { index += 1; continue; }
    index += 1;
    const values = [];
    let current = '';
    let quoted = false;
    let depth = 0;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === "'" && text[index + 1] === "'") { current += "''"; index += 1; continue; }
        if (char === "'") { current += char; quoted = false; continue; }
        current += char;
        continue;
      }
      if (char === "'") { quoted = true; current += char; continue; }
      if (char === '(') { depth += 1; current += char; continue; }
      if (char === ')') {
        if (depth > 0) { depth -= 1; current += char; continue; }
        values.push(current.trim());
        current = '';
        break;
      }
      if (char === ',' && depth === 0) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    index += 1;
    if (values.length) tuples.push(values);
  }
  return tuples;
}

/** Reconstruit les chaînes depuis un `data.sql` : c'est le chemin de retour vers JSON. */
export function channelsFromSql(sql) {
  const { tables } = parseDataSql(sql);
  const rows = tables.channels || [];
  return rows.map((row) => {
    const channel = {};
    for (const column of CHANNEL_COLUMNS) channel[column.name] = row[column.name] ?? null;
    return channel;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalized(channel) {
  const out = {};
  for (const column of CHANNEL_COLUMNS) {
    const value = channel[column.name];
    if (column.type === 'integer') out[column.name] = Number.isFinite(Number(value)) ? Number(value) : null;
    else if (column.type === 'numeric(4,2)') out[column.name] = Number.isFinite(Number(value)) ? Number(value) : null;
    else if (column.type === 'boolean') out[column.name] = value === undefined || value === null ? null : Boolean(value);
    else if (column.type === 'jsonb') out[column.name] = value === undefined ? null : value;
    else out[column.name] = value === undefined || value === null ? null : String(value);
  }
  return out;
}

/** Aller-retour : export puis relecture doit rendre exactement les mêmes valeurs. */
export function verifyRoundTrip(channels) {
  const { sql } = channelInserts(channels);
  const back = channelsFromSql(sql);
  const expected = [...channels]
    .filter((channel) => channel && channel.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(normalized);
  const ok = expected.length === back.length && expected.every((row, index) => (
    Object.keys(row).every((key) => JSON.stringify(row[key]) === JSON.stringify(back[index][key]))
  ));
  return {
    ok,
    checked: expected.length,
    restored: back.length,
    firstDifference: ok ? null : expected.findIndex((row, index) => (
      Object.keys(row).some((key) => JSON.stringify(row[key]) !== JSON.stringify(back[index]?.[key]))
    )),
  };
}

/** Type PostgreSQL d'une colonne de chaîne (utile aux scripts et aux tests). */
export function columnType(name) {
  return COLUMN_BY_NAME.get(name)?.type || 'text';
}
