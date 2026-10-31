// server/core/mailer.js · envoi d'e-mail sans dépendance (3.12.0).
// Un client SMTP minimal : EHLO, STARTTLS facultatif, AUTH PLAIN ou LOGIN, DATA en base64.
// Il sert à envoyer un code de connexion, rien d'autre : pas de file d'attente, pas de pièce
// jointe, pas de HTML. Toute erreur remonte avec un message lisible pour l'écran Réglages.

import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const CONNECT_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 25_000;

/** Configuration lue dans l'environnement. Vide = pas d'envoi possible. */
export function mailConfig(env = process.env) {
  const host = String(env.STREAMTV_SMTP_HOST || '').trim();
  const user = String(env.STREAMTV_SMTP_USER || '').trim();
  const pass = String(env.STREAMTV_SMTP_PASS || '');
  const tlsEnabled = env.STREAMTV_SMTP_TLS !== '0';
  const port = Number(env.STREAMTV_SMTP_PORT || (tlsEnabled ? 465 : 587));
  const secure = env.STREAMTV_SMTP_SECURE ? env.STREAMTV_SMTP_SECURE !== '0' : port === 465 && tlsEnabled;
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 465,
    user,
    pass,
    from: String(env.STREAMTV_SMTP_FROM || user).trim(),
    tls: tlsEnabled,
    secure,
    ready: Boolean(host && port && (!user || pass)),
  };
}

/** Vrai si un envoi est possible avec cette configuration. */
export function mailReady(config) {
  return Boolean(config && config.ready);
}

function encodeHeader(value) {
  const text = String(value || '');
  // En-tête ASCII simple tant que possible, sinon RFC 2047 en base64.
  return /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** Construit le message complet, corps en base64 pour ne jamais plier une ligne au hasard. */
export function buildMessage({ from, to, subject, text, date = new Date(), id = randomUUID() }) {
  const body = Buffer.from(String(text || ''), 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  const domain = String(from).split('@')[1] || 'streamtv.local';
  return [
    `From: ${encodeHeader(from)}`,
    `To: ${encodeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
  ].join('\r\n');
}

/** Session SMTP : lecture de réponses ligne par ligne, écriture CRLF. */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pending = [];
    this.lines = [];
  }

  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      this.lines.push(line);
      // Une réponse SMTP peut tenir sur plusieurs lignes : « 250-… » puis « 250 … ».
      if (/^\d{3} /.test(line)) {
        const reply = this.lines.slice();
        this.lines = [];
        const waiter = this.pending.shift();
        if (waiter) waiter(reply);
      }
      index = this.buffer.indexOf('\n');
    }
  }

  wait(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Le serveur de messagerie ne répond pas.')), timeoutMs);
      this.pending.push((reply) => { clearTimeout(timer); resolve(reply); });
    });
  }

  send(line) {
    this.socket.write(`${line}\r\n`);
  }

  async command(line, expected, timeoutMs) {
    this.send(line);
    const reply = await this.wait(timeoutMs);
    const code = Number(String(reply[reply.length - 1]).slice(0, 3));
    if (!expected.includes(code)) {
      throw new Error(`Le serveur de messagerie a refusé ${line.split(' ')[0]} (${code} ${String(reply[reply.length - 1]).slice(4)}).`);
    }
    return reply;
  }
}

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, servername: host, timeout: CONNECT_TIMEOUT_MS };
    const socket = secure ? tls.connect(options) : net.connect(options);
    const event = secure ? 'secureConnect' : 'connect';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connexion au serveur de messagerie impossible (délai dépassé).'));
    }, CONNECT_TIMEOUT_MS);
    socket.once(event, () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(new Error(`Connexion au serveur de messagerie impossible : ${error.message}`)); });
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: host });
    const timer = setTimeout(() => reject(new Error('Chiffrement STARTTLS impossible (délai dépassé).')), CONNECT_TIMEOUT_MS);
    secured.once('secureConnect', () => { clearTimeout(timer); resolve(secured); });
    secured.once('error', (error) => { clearTimeout(timer); reject(new Error(`Chiffrement STARTTLS impossible : ${error.message}`)); });
  });
}

/**
 * Envoie un message et rend le détail utile : durée, code final.
 * Toute panne réseau, tout refus d'authentification remonte en erreur explicite.
 */
export async function sendMail(config, { to, subject, text, timeoutMs = TOTAL_TIMEOUT_MS } = {}) {
  if (!mailReady(config)) throw new Error('Aucun serveur d’envoi n’est configuré.');
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(to || ''))) throw new Error('Adresse de destination invalide.');

  const startedAt = Date.now();
  const socket = await connect(config);
  const session = new Session(null);
  session.attach(socket);
  const guard = setTimeout(() => socket.destroy(new Error('Délai d’envoi dépassé.')), timeoutMs);

  try {
    await session.wait(timeoutMs);
    const hostname = 'streamtv.local';
    let capabilities = (await session.command(`EHLO ${hostname}`, [250], timeoutMs)).join(' ').toLowerCase();

    if (!config.secure && config.tls && capabilities.includes('starttls')) {
      await session.command('STARTTLS', [220], timeoutMs);
      const secured = await upgrade(socket, config.host);
      session.socket = secured;
      session.attach(secured);
      capabilities = (await session.command(`EHLO ${hostname}`, [250], timeoutMs)).join(' ').toLowerCase();
    }

    if (config.user && config.pass) {
      if (capabilities.includes('auth') && capabilities.includes('plain')) {
        const token = Buffer.from(`\0${config.user}\0${config.pass}`, 'utf8').toString('base64');
        await session.command(`AUTH PLAIN ${token}`, [235], timeoutMs);
      } else if (capabilities.includes('auth')) {
        await session.command('AUTH LOGIN', [334], timeoutMs);
        await session.command(Buffer.from(config.user, 'utf8').toString('base64'), [334], timeoutMs);
        await session.command(Buffer.from(config.pass, 'utf8').toString('base64'), [235], timeoutMs);
      } else {
        throw new Error('Le serveur de messagerie n’accepte pas l’authentification.');
      }
    }

    await session.command(`MAIL FROM:<${config.from}>`, [250], timeoutMs);
    await session.command(`RCPT TO:<${to}>`, [250, 251], timeoutMs);
    await session.command('DATA', [354], timeoutMs);
    const message = buildMessage({ from: config.from, to, subject, text });
    session.send(message.replace(/\n\./g, '\n..'));
    const sent = await session.command('.', [250], timeoutMs);
    try { await session.command('QUIT', [221], 4000); } catch { /* la fermeture n'invalide pas l'envoi */ }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      accepte: String(sent[sent.length - 1] || '').slice(0, 120),
    };
  } finally {
    clearTimeout(guard);
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref?.();
  }
}
