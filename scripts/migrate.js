// scripts/migrate.js — F-24 : préparer, vérifier et rejouer la migration JSON → PostgreSQL 15.
// Le script n'ouvre aucune connexion : il produit des fichiers SQL que `psql` applique, et sait
// relire ce qu'il a écrit. Aucune dépendance, aucun pilote embarqué.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Store } from '../server/core/store.js';
import { buildMigration, channelInserts, channelsFromSql, verifyRoundTrip } from '../server/core/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const MIGRATIONS_DIR = path.join(DATA_DIR, 'migrations');

// Un tuyau fermé (`| head`) ne doit pas produire de trace technique.
process.stdout.on('error', (error) => { if (error.code !== 'EPIPE') throw error; });
const out = (text = '') => {
  if (process.stdout.writableEnded) return;
  process.stdout.write(`${text}\n`);
};
const human = (bytes) => `${(bytes / 1024).toFixed(1)} Ko`;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function usage() {
  out('Usage : node scripts/migrate.js [--plan | --verify | --write | --reverse <fichier>]');
  out('');
  out('  --plan            (défaut) inventaire et contrôle, aucune écriture');
  out('  --verify          aller-retour SQL sur le catalogue réel (aucune écriture)');
  out('  --write           écrit data/migrations/<horodatage>/{schema.sql,data.sql,manifest.json}');
  out('  --reverse <file>  reconstruit un JSON de chaînes depuis un data.sql exporté');
  out('');
  out('Après --write, appliquer avec psql (PostgreSQL 15) :');
  out('  psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f data/migrations/<horodatage>/schema.sql');
  out('  psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f data/migrations/<horodatage>/data.sql');
}

async function loadStore() {
  const logger = { info: () => {}, warn: () => {}, error: (message) => process.stderr.write(`${message}\n`) };
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();
  return store;
}

function payload(store) {
  return {
    channels: store.channels.filter((channel) => !channel.deleted),
    settings: store.settings,
    sources: store.sources,
    learning: store.learning,
    ingestions: Array.isArray(store.ingestions) ? store.ingestions : [],
  };
}

async function plan(store) {
  const data = payload(store);
  const migration = buildMigration(data);
  const active = data.channels.length;
  out(`Plan de migration — ${migration.schemaVersion}`);
  out('');
  out(`  chaînes actives           ${active}`);
  out(`  réglages                  ${migration.counts.settings}`);
  out(`  sources                   ${migration.counts.sources}`);
  out(`  importations              ${migration.counts.ingestions}`);
  out(`  schéma SQL                ${migration.schema.split('\n').length} lignes, ${human(Buffer.byteLength(migration.schema))}`);
  out(`  données SQL               ${migration.data.split('\n').length} lignes, ${human(Buffer.byteLength(migration.data))}`);
  out(`  empreinte des données     ${migration.checksums.data.slice(0, 16)}…`);
  out('');
  const threshold = 30_000;
  out(`  seuil de bascule          ${threshold} chaînes (${active >= threshold ? 'ATTEINT — migration à planifier' : `${Math.round((active / threshold) * 100)} % du seuil`})`);
  out(`  réglage targetTable       ${store.settings.targetTable || 'non défini'}`);
  out(`  taille des données        ${human(Buffer.byteLength(migration.data))} en SQL`);
  out('');
  out('Aucune écriture effectuée. Utiliser --write pour produire les fichiers, puis --verify.');
}

async function verify(store) {
  const data = payload(store);
  const result = verifyRoundTrip(data.channels);
  out(`Aller-retour SQL — ${result.checked} chaînes`);
  out(`  relues                  ${result.restored}`);
  out(`  identiques              ${result.ok ? 'oui' : `non (première différence : ligne ${result.firstDifference})`}`);
  if (!result.ok) {
    out('  conclusion              migration interrompue : ne pas appliquer ces fichiers');
    process.exitCode = 1;
    return;
  }
  const migration = buildMigration(data);
  const again = buildMigration(data);
  out(`  idempotence             ${migration.checksums.data === again.checksums.data ? 'oui (deux exports identiques)' : 'non'}`);
  out(`  réversibilité           oui (channelsFromSql lit ce que channelInserts écrit)`);
  out(`  empreinte               ${migration.checksums.data}`);
}

async function write(store, ip = 'cli') {
  const data = payload(store);
  const migration = buildMigration(data);
  const dir = path.join(MIGRATIONS_DIR, stamp());
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'schema.sql'), migration.schema, 'utf8');
  await fsp.writeFile(path.join(dir, 'data.sql'), migration.data, 'utf8');
  await fsp.writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify({
    ...migration.manifest,
    counts: migration.counts,
  }, null, 2)}\n`, 'utf8');
  await store.audit('migration.export', {
    ip,
    count: migration.counts.channels,
    detail: `${path.relative(DATA_DIR, dir)} (${migration.checksums.data.slice(0, 12)})`,
  });
  out(`Migration préparée : ${path.relative(ROOT, dir)}`);
  out(`  schema.sql              ${human(Buffer.byteLength(migration.schema))}`);
  out(`  data.sql                ${human(Buffer.byteLength(migration.data))}`);
  out(`  manifest.json           empreintes et compteurs`);
  out('');
  out('Application (PostgreSQL 15) :');
  out(`  psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f ${path.relative(ROOT, dir)}/schema.sql`);
  out(`  psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f ${path.relative(ROOT, dir)}/data.sql`);
  out('');
  out('Retour arrière : node scripts/migrate.js --reverse <data.sql exporté>');
}

async function reverse(file) {
  const source = path.resolve(process.cwd(), file);
  const sql = await fsp.readFile(source, 'utf8');
  const channels = channelsFromSql(sql);
  if (!channels.length) {
    process.stderr.write('Aucune chaîne lisible dans ce fichier : vérifier qu’il s’agit d’un data.sql exporté par ce script.\n');
    process.exitCode = 1;
    return;
  }
  const target = path.join(MIGRATIONS_DIR, `reversed-${stamp()}.json`);
  await fsp.mkdir(MIGRATIONS_DIR, { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify({ version: 3, count: channels.length, channels }, null, 2)}\n`, 'utf8');
  out(`Retour arrière préparé : ${path.relative(ROOT, target)}`);
  out(`  chaînes relues          ${channels.length}`);
  out(`  première                ${channels[0]?.id} ${channels[0]?.name || ''}`.trimEnd());
  out('');
  out('Pour restaurer : arrêter le serveur, puis POST /api/admin/restore ou copier le JSON dans data/channels.json (format {version,channels}).');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage();
  const reverseIndex = args.indexOf('--reverse');
  if (reverseIndex >= 0) {
    const file = args[reverseIndex + 1];
    if (!file) {
      usage();
      process.exitCode = 1;
      return;
    }
    return reverse(file);
  }
  const store = await loadStore();
  if (args.includes('--write')) return write(store);
  if (args.includes('--verify')) return verify(store);
  return plan(store);
}

main().catch((error) => {
  process.stderr.write(`échec de la migration : ${error.message}\n`);
  process.exitCode = 1;
});
