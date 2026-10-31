// server/http/router.js — routage, lecture du corps, authentification et ordre de contrôle en 7 étapes (§6.2).
// 1 méthode → 2 taille → 3 type de contenu → 4 authentification → 5 validation → 6 conflit → 7 exécution.

import { LIMITS } from '../core/constants.js';
import { AppError, ERRORS } from '../core/errors.js';
import { newRequestId, sendError, sendJson, sendSecurityHeaders } from './respond.js';

export class HttpError extends Error {
  constructor(status, message, { code = 'ERR-18', headers = {} } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  constructor({ sessions = null, logger = console, config = {}, authorize = null } = {}) {
    this.routes = [];
    this.sessions = sessions;
    // 3.9.0 : contrôle de permission délégué au domaine (server/core/team.js).
    this.authorize = authorize;
    this.logger = logger;
    this.config = config;
  }

  add(method, pattern, handler, options = {}) {
    const { regex, keys } = compile(pattern);
    this.routes.push({
      method,
      pattern,
      regex,
      keys,
      handler,
      auth: Boolean(options.auth),
      permission: options.permission || '',
      bodyLimit: options.bodyLimit ?? LIMITS.maxBodyPublic,
      allowBody: options.allowBody !== false,
      name: options.name || '',
    });
    return this;
  }

  get(pattern, handler, options = {}) { return this.add('GET', pattern, handler, options); }
  post(pattern, handler, options = {}) { return this.add('POST', pattern, handler, options); }
  patch(pattern, handler, options = {}) { return this.add('PATCH', pattern, handler, options); }
  put(pattern, handler, options = {}) { return this.add('PUT', pattern, handler, options); }
  delete(pattern, handler, options = {}) { return this.add('DELETE', pattern, handler, options); }

  match(method, pathname) {
    const found = [];
    for (const route of this.routes) {
      const result = route.regex.exec(pathname);
      if (!result) continue;
      const params = {};
      route.keys.forEach((key, index) => {
        try { params[key] = decodeURIComponent(result[index + 1]); } catch { params[key] = result[index + 1]; }
      });
      found.push({ route, params });
    }
    if (!found.length) return { route: null, params: {}, allowed: [] };
    // Les routes statiques priment sur les routes paramétrées : /api/channels/search avant /api/channels/:id.
    found.sort((a, b) => a.route.keys.length - b.route.keys.length);
    const exact = found.find((item) => item.route.method === method)
      || (method === 'HEAD' ? found.find((item) => item.route.method === 'GET') : null);
    const allowed = [...new Set(found.map((item) => item.route.method).concat(found.some((item) => item.route.method === 'GET') ? ['HEAD'] : []))];
    return { route: exact?.route || null, params: exact?.params || {}, allowed };
  }

  async readBody(req, limit) {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > limit) {
      const error = new AppError('ERR-15', { params: { max: `${Math.round(limit / 1024)} Ko` } });
      error.status = 413;
      throw error;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        const error = new AppError('ERR-15', { params: { max: `${Math.round(limit / 1024)} Ko` } });
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  parseJson(buffer) {
    if (!buffer.length) return null;
    const text = buffer.toString('utf8');
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError('ERR-06');
    }
  }

  /**
   * @returns {Promise<boolean>} true si la requête a été traitée.
   */
  async handle(req, res, extras = {}) {
    const started = Date.now();
    const requestId = newRequestId();
    const url = new URL(req.url, 'http://internal');
    const pathname = decodeURI(url.pathname);
    const query = Object.fromEntries(url.searchParams);
    sendSecurityHeaders(res);

    const method = req.method === 'HEAD' ? 'HEAD' : req.method;
    const { route, params, allowed } = this.match(method, pathname);
    if (!route) {
      if (allowed.length) {
        sendError(req, res, 'ERR-12', { headers: { Allow: allowed.join(', ') }, requestId });
        this.logRequest(method, pathname, 405, started);
        return true;
      }
      return false;
    }

    try {
      // Étape 2 — taille.
      const limit = route.bodyLimit;
      const declared = Number(req.headers['content-length'] || 0);
      if (route.allowBody && declared > limit) {
        throw new AppError('ERR-15', { params: { max: `${Math.round(limit / 1024)} Ko` } });
      }

      // Étape 3 — type de contenu (uniquement s'il y a un corps).
      const hasBody = declared > 0 || req.headers['transfer-encoding'];
      if (route.allowBody && hasBody) {
        const type = String(req.headers['content-type'] || '');
        if (!/^application\/json\b/i.test(type)) {
          res.statusCode = 415;
          sendJson(req, res, 415, {
            error: 'Le format d’envoi n’est pas accepté : JSON attendu.',
            code: 'ERR-04',
            field: 'content-type',
            requestId,
          }, { requestId });
          this.logRequest(method, pathname, 415, started);
          return true;
        }
      }

      // Étape 4 — authentification.
      let session = null;
      if (route.auth) {
        const header = String(req.headers.authorization || '');
        const token = /^Bearer\s+([a-f0-9]{48})$/i.exec(header)?.[1] || '';
        session = token && this.sessions ? this.sessions.touch(token) : null;
        if (!session) throw new AppError('ERR-07');
        if (route.permission && this.authorize && !this.authorize(session, route.permission, this)) {
          throw new AppError('ERR-09');
        }
      }

      // Étape 5 — lecture et validation du corps.
      let body = null;
      if (route.allowBody && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
        const buffer = await this.readBody(req, limit);
        body = this.parseJson(buffer);
      }

      const context = {
        req,
        res,
        params,
        query,
        body,
        session,
        requestId,
        method,
        pathname,
        ip: extras.ip || req.socket?.remoteAddress || '',
        security: extras.security || null,
        services: extras.services || {},
        https: Boolean(extras.https),
        log: this.logger,
      };

      // Étape 6 et 7 sont portées par le gestionnaire (verrous, conflits, exécution).
      const result = await route.handler(context);
      if (res.writableEnded || res.headersSent) return true;
      if (result === undefined || result === null) {
        sendJson(req, res, 204, {}, { requestId });
        this.logRequest(method, pathname, 204, started);
        return true;
      }
      if (result.redirect) {
        res.statusCode = result.status || 302;
        res.setHeader('Location', result.redirect);
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        this.logRequest(method, pathname, res.statusCode, started);
        return true;
      }
      if (result.file) {
        const { sendBuffer } = await import('./respond.js');
        sendBuffer(req, res, result.status || 200, result.file.content, {
          type: result.file.type,
          cache: result.cache || 'no-store',
          headers: { 'Content-Disposition': result.file.disposition || 'attachment', ...(result.headers || {}) },
        });
        this.logRequest(method, pathname, result.status || 200, started);
        return true;
      }
      sendJson(req, res, result.status || 200, result.body ?? {}, {
        cache: result.cache || 'no-store',
        headers: result.headers || {},
        requestId,
      });
      this.logRequest(method, pathname, result.status || 200, started);
      return true;
    } catch (error) {
      this.respondError(req, res, error, requestId);
      this.logRequest(method, pathname, error.status || 500, started);
      return true;
    }
  }

  respondError(req, res, error, requestId) {
    if (res.headersSent) return;
    if (error instanceof AppError) {
      sendError(req, res, error.code, {
        params: error.params,
        field: error.field,
        status: error.status,
        headers: error.headers,
        requestId,
        message: error.custom ? error.message : '',
      });
      return;
    }
    if (error instanceof HttpError) {
      sendError(req, res, error.code, { status: error.status, headers: error.headers, requestId, params: { raison: error.message } });
      return;
    }
    // Une erreur métier connue (ex. sauvegarde absente) ne devient jamais un 500 (BUG-04).
    if (error?.code && ERRORS[error.code]) {
      const params = error.code === 'ERR-16' && error.message ? { raison: error.message } : {};
      sendError(req, res, error.code, { status: ERRORS[error.code].status, requestId, params });
      return;
    }
    const status = 500;
    this.logger.error?.(`${requestId} ${req.method} ${req.url} → ${error?.message}`);
    if (error?.stack) this.logger.debug?.(error.stack);
    sendError(req, res, 'ERR-18', { status, requestId });
  }

  logRequest(method, pathname, status, started) {
    const duration = Date.now() - started;
    const line = `${method} ${pathname} ${status} ${duration}ms`;
    if (status >= 500) this.logger.error?.(line);
    else this.logger.info?.(line);
  }
}

/** Lit un paramètre de requête borné. */
export function queryString(query, key, { max = 200, fallback = '' } = {}) {
  const value = query?.[key];
  if (value === undefined || value === null) return fallback;
  return String(value).slice(0, max);
}

export function queryInt(query, key, { min = 1, max = LIMITS.maxPage, fallback = min } = {}) {
  const number = Number(query?.[key]);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export function queryBool(query, key, fallback = false) {
  const value = query?.[key];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}
