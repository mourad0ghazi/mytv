// tests/helpers-smtp.js — faux serveur SMTP local, sans TLS ni dépendance.
// Il parle le protocole pour de vrai : EHLO, MAIL FROM, RCPT TO, DATA, QUIT.
// Les messages reçus sont décodés (base64) pour que les tests lisent le code envoyé.

import net from 'node:net';

export async function startSmtpServer({ reject = false } = {}) {
  const received = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let message = [];
    let envelope = { from: '', to: [] };
    socket.setEncoding('utf8');

    const write = (line) => socket.write(`${line}\r\n`);
    write('220 faux-smtp.local ESMTP prêt');

    socket.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');

        if (inData) {
          if (line === '.') {
            inData = false;
            received.push({ ...envelope, body: message.join('\n') });
            message = [];
            write(reject ? '554 message refusé' : '250 2.0.0 message accepté');
          } else {
            message.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          write('250-faux-smtp.local');
          write('250 AUTH PLAIN LOGIN');
        } else if (upper.startsWith('AUTH PLAIN')) {
          write('235 2.7.0 authentifié');
        } else if (upper.startsWith('AUTH LOGIN')) {
          write('334 VXNlcm5hbWU6');
        } else if (/^[A-Za-z0-9+/=]+$/.test(line) && line.length > 4) {
          write('235 2.7.0 authentifié');
        } else if (upper.startsWith('MAIL FROM')) {
          envelope = { from: /<([^>]*)>/.exec(line)?.[1] || '', to: [] };
          write('250 2.1.0 expéditeur accepté');
        } else if (upper.startsWith('RCPT TO')) {
          envelope.to.push(/<([^>]*)>/.exec(line)?.[1] || '');
          write('250 2.1.5 destinataire accepté');
        } else if (upper === 'DATA') {
          inData = true;
          write('354 envoyez le message');
        } else if (upper === 'QUIT') {
          write('221 2.0.0 au revoir');
          socket.end();
        } else {
          write('250 2.0.0 ok');
        }
      }
    });
    socket.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    received,
    /** Dernier message reçu, corps décodé. */
    last() {
      const entry = received[received.length - 1];
      if (!entry) return null;
      const [headers, ...rest] = entry.body.split(/\n\s*\n/);
      const body = rest.join('\n').replace(/\s+/g, '');
      let texte = '';
      try { texte = Buffer.from(body, 'base64').toString('utf8'); } catch { texte = ''; }
      const champ = (nom) => new RegExp(`^${nom}:\\s*(.+)$`, 'mi').exec(headers)?.[1]?.trim() || '';
      return { ...entry, headers, texte, subject: champ('Subject'), to: champ('To') };
    },
    /** Code à six chiffres contenu dans le dernier message. */
    code() {
      return /(\d{6})/.exec(this.last()?.texte || '')?.[1] || '';
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
