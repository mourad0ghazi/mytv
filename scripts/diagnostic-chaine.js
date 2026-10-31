#!/usr/bin/env node
// scripts/diagnostic-chaine.js — pourquoi CETTE chaîne ne s'ouvre-t-elle pas ?
//
//   node scripts/diagnostic-chaine.js "2M Monde"
//   node scripts/diagnostic-chaine.js 5a81c70138ed --json
//
// Le script ne devine pas : il refait le chemin du lecteur, étape par étape, depuis la machine
// où il tourne — DNS, TLS, code HTTP, en-têtes CORS, playlist, premier fragment. La conclusion
// distingue une adresse morte, une restriction de zone, un refus CORS et un simple réseau muet.
// Lecture seule : il n'écrit ni catalogue ni état de santé.

import dns from 'node:dns/promises';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(RACINE, 'data');
const DELAI_MS = 15_000;

const ETAPES = ['dns', 'tls', 'http', 'cors', 'playlist', 'fragment'];

const args = process.argv.slice(2);
const enJson = args.includes('--json');
const cible = args.filter((item) => !item.startsWith('--')).join(' ').trim();

if (!cible || args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage : node scripts/diagnostic-chaine.js <identifiant ou nom de chaîne> [--json]',
    '',
    '  Refait le chemin du lecteur : DNS, TLS, code HTTP, en-têtes CORS, playlist, fragment.',
    '  Lecture seule. Pour enregistrer le résultat dans le catalogue :',
    '    node scripts/probe-chaines.js --id <identifiant> --commit',
    '',
  ].join('\n'));
  process.exit(cible ? 0 : 1);
}

async function chargerCatalogue() {
  let raw;
  try {
    raw = await fsp.readFile(path.join(DATA_DIR, 'channels.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      process.stderr.write(`Aucun catalogue dans ${DATA_DIR} : lancez d’abord « npm start ».\n`);
      process.exit(1);
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.channels || [];
}

/** Nom normalisé pour retrouver « 2M Monde » sans accent ni casse. */
function normaliser(texte) {
  return String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function trouverChaine(channels, recherche) {
  const exact = channels.find((channel) => channel.id === recherche);
  if (exact) return { channel: exact, exact: true };
  const cle = normaliser(recherche);
  const candidats = channels.filter((channel) => normaliser(channel.name).includes(cle)
    || normaliser(channel.rawName).includes(cle));
  if (!candidats.length) return { channel: null, candidats: [] };
  return { channel: candidats[0], candidats, exact: false };
}

function avecDelai(promesse, ms, libelle) {
  let minuteur;
  return Promise.race([
    promesse.finally(() => clearTimeout(minuteur)),
    new Promise((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(Object.assign(new Error(`${libelle} : délai de ${ms / 1000} s dépassé`), { code: 'DELAI' })), ms);
    }),
  ]);
}

async function etapeDns(url) {
  const host = new URL(url).hostname;
  try {
    const adresses = await dns.lookup(host, { all: true });
    return { etape: 'dns', ok: true, detail: `${host} → ${adresses.map((item) => item.address).join(', ')}` };
  } catch (error) {
    return { etape: 'dns', ok: false, cause: 'dead', detail: `${host} introuvable (${error.code || error.message})` };
  }
}

async function requete(url, { methode = 'GET', entetes = {}, tailleMax = 512 * 1024 } = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MS);
  const debut = Date.now();
  try {
    const reponse = await fetch(url, { method: methode, headers: entetes, redirect: 'manual', signal: controleur.signal });
    const type = reponse.headers.get('content-type') || '';
    let corps = Buffer.alloc(0);
    if (methode !== 'HEAD' && reponse.body) {
      const lecteur = reponse.body.getReader();
      const morceaux = [];
      let taille = 0;
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        taille += value.byteLength;
        if (taille > tailleMax) { await lecteur.cancel().catch(() => {}); break; }
        morceaux.push(Buffer.from(value));
      }
      corps = Buffer.concat(morceaux);
    }
    return {
      ok: true,
      statut: reponse.status,
      type,
      entetes: {
        cors: reponse.headers.get('access-control-allow-origin'),
        serveur: reponse.headers.get('server'),
        emplacement: reponse.headers.get('location'),
      },
      corps,
      millisecondes: Date.now() - debut,
    };
  } catch (error) {
    // « fetch failed » ne dit rien : la cause réelle (TCP, TLS, DNS) est dans error.cause.
    const cause = error.cause || {};
    const code = error.name === 'AbortError' ? 'DELAI' : (cause.code || error.code || 'RESEAU');
    const message = [error.message, cause.message].filter(Boolean).join(' · ');
    return { ok: false, code, message, millisecondes: Date.now() - debut };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Verdict : ce que le visiteur verra, et pourquoi. */
function conclure({ dnsOk, reponse, playlistOk, fragmentOk, relayable }) {
  if (!dnsOk) return { verdict: 'dead', titre: 'Adresse introuvable', action: 'Le domaine du flux n’existe plus : l’adresse a changé. Corrigez la fiche ou retirez la chaîne.' };
  if (!reponse.ok) {
    if (reponse.code === 'DELAI') return { verdict: 'timeout', titre: 'Le serveur du diffuseur ne répond pas', action: 'Le flux est peut-être éteint. Réessayez plus tard, puis retirez-le s’il reste muet.' };
    if (String(reponse.code).includes('CERT') || /certificate/i.test(reponse.message || '')) return { verdict: 'dead', titre: 'Certificat TLS invalide', action: 'Le flux n’est pas fiable en HTTPS : ne le diffusez pas, remplacez l’adresse.' };
    return { verdict: 'unreachable', titre: 'Connexion impossible depuis cette machine', action: 'Vérifiez votre accès Internet ; si d’autres chaînes passent, le diffuseur bloque cette adresse.' };
  }
  if (reponse.statut === 403 || reponse.statut === 451) {
    return { verdict: 'geo', titre: `Le diffuseur refuse l’accès (HTTP ${reponse.statut})`, action: 'Restriction de zone ou d’ayant droit. Aucun relais ne la contourne : retirez la chaîne ou signalez-la comme indisponible dans votre pays.' };
  }
  if (reponse.statut === 404 || reponse.statut === 410) {
    return { verdict: 'dead', titre: `Adresse expirée (HTTP ${reponse.statut})`, action: 'L’adresse du flux a changé. Cherchez la nouvelle source de cette chaîne, sinon retirez-la du catalogue.' };
  }
  if (reponse.statut >= 300 && reponse.statut < 400) {
    return { verdict: 'dead', titre: `Redirection non suivie (HTTP ${reponse.statut})`, action: `Adresse déplacée vers ${reponse.entetes.emplacement || 'une autre adresse'}. Mettez la fiche à jour avec cette destination.` };
  }
  if (reponse.statut >= 500) {
    return { verdict: 'dead', titre: `Erreur du diffuseur (HTTP ${reponse.statut})`, action: 'Le serveur d’origine est en panne. Réessayez plus tard ; la chaîne reste publique.' };
  }
  if (reponse.statut >= 400) {
    return { verdict: 'dead', titre: `Réponse inattendue (HTTP ${reponse.statut})`, action: 'Le diffuseur refuse la requête telle quelle. Vérifiez l’adresse exacte dans la liste d’origine.' };
  }
  if (!reponse.entetes.cors) {
    return {
      verdict: 'cors',
      titre: 'Le flux existe, mais le navigateur n’a pas le droit de le lire',
      action: relayable
        ? 'Le relais du serveur peut le lire : ouvrez la chaîne dans le lecteur, il bascule automatiquement.'
        : 'Ce flux ne sera pas lisible dans un navigateur. Gardez-le pour un lecteur externe ou retirez-le.',
    };
  }
  if (!playlistOk) {
    return { verdict: 'dead', titre: 'La réponse n’est pas une playlist HLS', action: `Le diffuseur répond « ${reponse.type || 'sans type'} » au lieu de #EXTM3U : l’adresse ne pointe pas sur un flux.` };
  }
  if (!fragmentOk) {
    return { verdict: 'dead', titre: 'Playlist valide, fragments inaccessibles', action: 'La liste existe mais les segments ne se téléchargent pas : flux à moitié en panne, à revérifier plus tard.' };
  }
  if (reponse.millisecondes > 4000) {
    return { verdict: 'flaky', titre: 'Le flux fonctionne, lentement', action: `Première réponse en ${reponse.millisecondes} ms : lecteur instable attendu. Surveillez cette chaîne.` };
  }
  return { verdict: 'up', titre: 'Le flux fonctionne', action: 'Rien à corriger : la chaîne est lisible dans le navigateur depuis cette machine.' };
}

async function diagnostiquer(channel) {
  const rapport = { id: channel.id, nom: channel.name, url: channel.url, etapes: [] };
  if (!channel.url) {
    rapport.conclusion = { verdict: 'dead', titre: 'Aucune adresse', action: 'La fiche n’a pas de flux : renseignez-en un ou retirez la chaîne.' };
    return rapport;
  }

  const dnsOk = await etapeDns(channel.url);
  rapport.etapes.push(dnsOk);
  if (!dnsOk.ok) {
    rapport.conclusion = conclure({ dnsOk: false });
    return rapport;
  }

  const reponse = await requete(channel.url, {
    entetes: { accept: '*/*', origin: 'https://mytv.exemple' },
  });
  rapport.etapes.push({
    etape: 'tls+http',
    ok: reponse.ok && reponse.statut < 400,
    detail: reponse.ok
      ? `HTTP ${reponse.statut} · ${reponse.type || 'sans type'} · ${reponse.millisecondes} ms · CORS ${reponse.entetes.cors || 'absent'} · serveur ${reponse.entetes.serveur || 'inconnu'}`
      : `${reponse.code} · ${reponse.message} · ${reponse.millisecondes} ms`,
  });

  let playlistOk = false;
  let fragmentOk = false;
  if (reponse.ok && reponse.statut < 400) {
    const texte = reponse.corps.toString('utf8');
    playlistOk = texte.startsWith('#EXTM3U');
    rapport.etapes.push({
      etape: 'playlist',
      ok: playlistOk,
      detail: playlistOk
        ? `${texte.split('\n').filter((ligne) => ligne.trim() && !ligne.startsWith('#')).length} adresse(s), ${texte.length} octets`
        : `la réponse ne commence pas par #EXTM3U`,
    });

    if (playlistOk) {
      const base = new URL(channel.url);
      const premiere = texte.split(/\r?\n/)
        .map((ligne) => ligne.trim())
        .filter((ligne) => ligne && !ligne.startsWith('#'))
        .map((ligne) => { try { return new URL(ligne, base).toString(); } catch { return ''; } })
        .filter(Boolean)[0];
      if (premiere) {
        const entete = await requete(premiere, { methode: 'HEAD' });
        fragmentOk = Boolean(entete.ok && entete.statut < 400);
        rapport.etapes.push({
          etape: 'fragment',
          ok: fragmentOk,
          detail: `${premiere.slice(0, 96)}${premiere.length > 96 ? '…' : ''} → ${entete.ok ? `HTTP ${entete.statut} · ${entete.type || 'sans type'}` : entete.code}`,
        });
      }
    }
  }

  rapport.conclusion = conclure({ dnsOk: true, reponse, playlistOk, fragmentOk, relayable: Boolean(channel.licenseNote) });
  return rapport;
}

function afficher(rapport) {
  const lignes = [];
  lignes.push(`Chaîne : ${rapport.nom} (${rapport.id})`);
  lignes.push(`Adresse : ${rapport.url || 'aucune'}`);
  lignes.push('');
  for (const etape of rapport.etapes) {
    lignes.push(`${etape.ok ? '✓' : '✗'} ${etape.etape.padEnd(8)} ${etape.detail}`);
  }
  lignes.push('');
  const { conclusion } = rapport;
  lignes.push(`Verdict : ${conclusion.verdict.toUpperCase()} · ${conclusion.titre}`);
  lignes.push(`À faire : ${conclusion.action}`);
  return lignes.join('\n');
}

const channels = await chargerCatalogue();
const trouve = trouverChaine(channels, cible);
if (!trouve.channel) {
  process.stderr.write(`Aucune chaîne ne correspond à « ${cible} » dans ${channels.length} entrées.\n`);
  if (trouve.candidats?.length) process.stderr.write(`Pistes : ${trouve.candidats.slice(0, 5).map((item) => item.name).join(', ')}\n`);
  process.exit(1);
}
if (!trouve.exact && trouve.candidats?.length > 1) {
  const autres = trouve.candidats.filter((item) => item.id !== trouve.channel.id).slice(0, 5);
  if (autres.length) process.stdout.write(`(autres correspondances : ${autres.map((item) => item.name).join(', ')})\n\n`);
}

const rapport = await diagnostiquer(trouve.channel);
if (enJson) process.stdout.write(`${JSON.stringify(rapport, null, 2)}\n`);
else process.stdout.write(`${afficher(rapport)}\n`);
process.exit(rapport.conclusion.verdict === 'up' ? 0 : 1);
