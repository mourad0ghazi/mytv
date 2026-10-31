// public/js/player.js · lecteur : 7 états, détection de cause, 12 mires (§8).
// Invariants : une seule reprise automatique, hls.destroy() à chaque sortie, aucun minuteur orphelin.

import { consoleHref } from './console.js?v=3.20.0';
import { api } from './api.js?v=3.20.0';
import { COPY } from './copy.js?v=3.20.0';
import { h, icon, toast, copyText, logoNode } from './ui.js?v=3.20.0';
import { openPlayerOptions, openShortcuts } from './player-menu.js?v=3.20.0';
import { leaveFullscreen, toggleFullscreen } from './player-fullscreen.js?v=3.20.0';
import { prefs } from './prefs.js?v=3.20.0';
import { nowFor, heureCourte, progression } from './epg-now.js?v=3.20.0';
import {
  mireActionNodes, mireForBlocked, mireNode, mireRetryNode, similarPanel, wireGestures,
} from './player-similar.js?v=3.20.0';

const MIRES = COPY.player.mires;

/** Trois habillages, mémorisés sur l'appareil : poste ancien, plein cadre, minimal. */
const SKINS = [
  { id: 'cadre', label: 'Cadre TV' },
  { id: 'plein', label: 'Plein écran' },
  { id: 'minimal', label: 'Minimal' },
];
const RETRYABLE = new Set(['P-03', 'P-04', 'P-10', 'P-12', 'P-07']);

class Player {
  constructor() {
    this.root = null;
    this.overlay = null;
    this.video = null;
    this.hls = null;
    this.channel = null;
    this.queue = [];
    this.index = -1;
    this.state = 'IDLE';
    this.attempts = 0;
    this.retryTimer = null;
    this.osdTimer = null;
    this.manifestTimer = null;
    this.digitBuffer = '';
    this.digitTimer = null;
    this.onKeyDown = null;
    this.onClose = null;
    this.previousFocus = null;
    this.previousOverflow = '';
    this.liveRegion = null;
    this.mireVisible = false;
    // 3.8.0 : niveaux HLS, chaînes proches et repli de source.
    this.levels = [];
    this.levelSelect = null;
    this.similarList = [];
    this.triedUrls = new Set();
    this.fallbackChannel = '';
    this.dock = null;
    this.similarBtn = null;
  }

  ensureRoot() {
    if (!this.root) this.root = document.getElementById('player-root');
    return this.root;
  }

  /**
   * Ouvre le lecteur sur une chaîne, un anime ou un film.
   * `startAt` (secondes) et `onTime(secondes, duree)` servent la reprise de lecture VOD :
   * la position reste dans le navigateur, elle n'est jamais envoyée au serveur.
   */
  async open(channelOrId, { queue = [], onClose = null, startAt = 0, onTime = null } = {}) {
    this.ensureRoot();
    this.onClose = onClose;
    this.startAt = Math.max(0, Math.round(Number(startAt) || 0));
    this.onTime = typeof onTime === 'function' ? onTime : null;
    this.lastTime = 0;
    this.lastDuration = 0;
    let channel = typeof channelOrId === 'string'
      ? (await api(`/api/channels/${channelOrId}`)).channel
      : channelOrId;
    // Les cartes du catalogue sont volontairement allégées : l'adresse du flux n'arrive qu'à la lecture.
    if (channel && !channel.url) {
      try {
        channel = (await api(`/api/channels/${channel.id}`)).channel;
      } catch {
        channel = { ...channel, url: '' };
      }
    }
    this.queue = Array.isArray(queue) && queue.length ? queue.map((item) => (typeof item === 'string' ? item : item.id)) : [channel.id];
    this.index = Math.max(0, this.queue.indexOf(channel.id));
    await this.mount(channel);
  }

  async mount(channel) {
    this.teardown(false);
    this.channel = channel;
    this.attempts = 0;
    this.triedUrls = new Set([channel.url]);
    this.fallbackChannel = '';
    this.similarList = [];
    this.previousFocus = document.activeElement;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    prefs.pushHistory(channel);
    prefs.setLastChannel(channel);
    // Compteur d'usage anonyme : un identifiant de chaîne, rien de plus. Un échec reste muet.
    if (channel?.id) api('/api/events/play', { method: 'POST', body: { channelId: channel.id } }).catch(() => {});

    const isHttps = location.protocol === 'https:';
    const qualityOptions = [
      { url: channel.url, quality: channel.quality || 'AUTO', label: 'Source principale' },
      ...(channel.variants || []),
    ].filter((item, i, arr) => item.url && arr.findIndex((x) => x.url === item.url) === i);

    this.video = h('video', {
      playsinline: true, autoplay: true, controls: false, preload: 'metadata',
      'aria-label': `Lecteur : ${channel.name}`,
    });
    this.video.volume = prefs.volume();
    this.video.muted = prefs.muted();

    const qualitySelect = qualityOptions.length > 1
      ? h('select', { class: 'select player-quality', 'aria-label': 'Choisir la qualité', onChange: (event) => this.switchQuality(event.target.value) },
        qualityOptions.map((item) => h('option', { value: item.url }, `${item.quality || 'AUTO'} · ${item.label || 'variante'}`)))
      : null;

    this.levelSelect = h('select', {
      class: 'select', id: 'player-level', hidden: true, 'aria-label': 'Qualité du flux',
      onChange: (event) => this.switchLevel(Number(event.target.value)),
    }, h('option', { value: '-1' }, 'Qualité auto'));

    const favBtn = h('button', {
      class: 'player-btn', type: 'button', id: 'player-fav',
      'aria-label': COPY.actions.addFavorite, 'aria-pressed': String(prefs.isFavorite(channel.id)),
      onClick: () => {
        const added = prefs.toggleFavorite(channel);
        favBtn.setAttribute('aria-pressed', String(added));
        favBtn.setAttribute('aria-label', added ? COPY.actions.removeFavorite : COPY.actions.addFavorite);
        favBtn.replaceChildren(icon('heart', 18));
        toast(added ? 'Ajoutée aux favoris.' : 'Retirée des favoris.', { tone: 'success', duration: 2500 });
      },
    }, icon('heart', 18));

    this.closeBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Fermer le lecteur', onClick: () => this.close() }, icon('close', 18));
    this.playBtn = h('button', { class: 'player-btn primary', type: 'button', 'aria-label': 'Lecture ou pause', onClick: () => this.toggle() }, icon('pause', 20));
    this.muteBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Couper le son', 'aria-pressed': String(this.video.muted), onClick: () => this.toggleMute() },
      icon(this.video.muted ? 'mute' : 'volume', 18));
    this.volumeRange = h('input', {
      type: 'range', min: '0', max: '1', step: '0.05', value: String(this.video.volume),
      'aria-label': 'Volume', onInput: (event) => this.setVolume(Number(event.target.value)),
    });
    // OSD §7.2 : nom, numéro, catégorie, qualité · rien d'autre (l'état de santé reste sur la carte).
    this.osd = h('div', { class: 'osd', dataset: { hidden: 'false' }, 'aria-hidden': 'true' },
      h('strong', { text: `#${channel.number} · ${channel.name}` }),
      h('small', { text: [channel.categoryLabel || 'Catégorie inconnue',
        channel.quality && channel.quality !== 'AUTO' ? channel.quality : null].filter(Boolean).join(' · ') }));
    this.mireHost = h('div', { class: 'mire-host' });

    const stage = h('div', { class: 'player-stage' },
      this.video,
      h('div', { class: 'player-top' },
        h('div', {},
          h('div', { class: 'player-live' }, h('i', { 'aria-hidden': 'true' }), COPY.player.live),
          h('div', { class: 'player-title', text: channel.name }),
          h('div', { class: 'player-sub', text: `Chaîne ${channel.number} · ${channel.categoryLabel || 'Catégorie inconnue'}` }),
          this.programme = h('div', { class: 'player-sub player-programme', id: 'player-programme' }, 'Programme : chargement du guide…'),
          h('div', { class: 'skin-switch', role: 'group', 'aria-label': 'Habillage du lecteur' },
            SKINS.map((skin) => h('button', {
              type: 'button', dataset: { skin: skin.id }, 'aria-pressed': String(prefs.skin() === skin.id),
              onClick: () => this.setSkin(skin.id),
            }, skin.label)))),
        h('div', { style: { display: 'flex', gap: '8px' } }, favBtn, this.closeBtn)),
      this.osd,
      this.mireHost,
      this.liveRegion = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' }));

    // La barre est un frère de la scène : la vidéo ne peut plus la rogner ni la sortir de l'écran.
    this.controls = h('div', { class: 'player-controls' },
        h('button', { class: 'player-btn', type: 'button', 'aria-label': COPY.actions.previous, disabled: this.queue.length < 2, onClick: () => this.zap(-1) }, icon('prev', 18)),
        this.playBtn,
        h('button', { class: 'player-btn', type: 'button', 'aria-label': COPY.actions.next, disabled: this.queue.length < 2, onClick: () => this.zap(1) }, icon('next', 18)),
        h('div', { class: 'volume' }, this.muteBtn, this.volumeRange),
        h('span', { class: 'spacer' }),
        this.levelSelect,
        qualitySelect,
        this.similarBtn = h('button', {
          class: 'player-btn player-inline', type: 'button', 'aria-label': 'Chaînes similaires', 'aria-expanded': 'false',
          onClick: () => this.toggleSimilar(),
        }, icon('grid', 18)),
        h('button', { class: 'player-btn player-inline', type: 'button', 'aria-label': 'Image dans l’image', onClick: () => this.pictureInPicture() }, icon('pip', 18)),
        h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Plein écran', onClick: () => this.fullscreen() }, icon('full', 18)),
        h('button', { class: 'player-btn player-inline', type: 'button', 'aria-label': 'Raccourcis du lecteur', onClick: () => this.showShortcuts() }, icon('settings', 18)),
        // Au téléphone, les commandes rares passent dans ce menu : une rangée lisible au pouce.
        h('button', { class: 'player-btn player-more', type: 'button', 'aria-label': 'Plus d’options de lecture', onClick: () => this.showOptions() }, icon('dots', 18)));

    this.dock = h('div', { class: 'player-dock', hidden: true, 'aria-label': 'Chaînes proches' },
      h('div', { class: 'player-similar', id: 'player-similar' }));
    this.overlay = h('div', {
      class: 'player-overlay', role: 'dialog', 'aria-modal': 'true',
      'aria-label': `Lecteur : ${channel.name}`, dataset: { skin: prefs.skin() },
    }, stage, this.controls, this.dock);
    this.ensureRoot().replaceChildren(this.overlay);

    this.loadProgramme(channel);
    this.bindMediaEvents();
    this.bindKeys();
    this.bindGestures(stage);
    this.setState('PREPARING');
    if (this.channel.blocked) {
      this.setState('BLOCKED');
      this.showMire(this.mireForBlocked(this.channel.blocked), this.channel);
      return;
    }
    if (!this.channel.url) {
      this.setState('ERROR');
      this.showMire('P-11', this.channel);
      return;
    }
    if (!navigator.onLine) {
      this.setState('BLOCKED');
      this.showMire('P-09', this.channel);
      return;
    }
    if (isHttps && String(this.channel.url).startsWith('http:')) {
      this.setState('BLOCKED');
      this.showMire('P-01', this.channel);
      return;
    }
    this.startPlayback(this.channel.url);
  }

  startPlayback(url) {
    const video = this.video;
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    const isHls = /\.m3u8(\?|$)/i.test(url);
    this.clearTimers();

    // Garde-fou : 15 s sans image = source muette (P-10).
    this.manifestTimer = setTimeout(() => {
      if (this.state === 'PREPARING') {
        this.setState('ERROR');
        this.showMire('P-10', this.channel);
      }
    }, 15_000);

    if (isHls && window.Hls && window.Hls.isSupported()) {
      try {
        this.hls = new window.Hls({
          enableWorker: false, // évite tout blob: sous CSP stricte
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 20,
          manifestLoadingTimeOut: 12_000,
          manifestLoadingMaxRetry: 0,
          levelLoadingMaxRetry: 0,
          fragLoadingMaxRetry: 0,
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(video);
        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => { this.buildLevels(); this.attemptAutoplay(); });
        this.hls.on(window.Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          this.handleFatalError(data);
        });
      } catch {
        this.setState('ERROR');
        this.showMire('P-12', this.channel);
      }
      return;
    }

    if (isHls && !window.Hls && !canNative) {
      this.setState('ERROR');
      this.showMire('P-08', this.channel);
      return;
    }

    // MP4, ou HLS natif (Safari/iOS), ou HLS sans hls.js mais support natif.
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      this.applyStartPosition();
      this.attemptAutoplay();
    }, { once: true });
    video.addEventListener('error', () => this.handleMediaError(), { once: true });
  }

  /**
   * Reprise de lecture : la position mémorisée est appliquée une seule fois, après les
   * métadonnées. Un contenu terminé repart du début (décidé par l'appelant, qui n'envoie
   * alors aucune position).
   */
  applyStartPosition() {
    const video = this.video;
    if (!video || !this.startAt) return;
    const duration = Number(video.duration);
    const target = Number.isFinite(duration) && duration > 0
      ? Math.min(this.startAt, Math.max(0, duration - 2))
      : this.startAt;
    try { video.currentTime = target; } catch { /* le média refuse le saut : on lit depuis le début */ }
    this.announce(`Reprise à ${Math.round(target / 60)} minutes.`);
  }

  /** Enregistre la position courante pour la reprise, au plus une fois par seconde. */
  reportTime() {
    if (!this.onTime || !this.video) return;
    const seconds = Math.floor(Number(this.video.currentTime) || 0);
    const duration = Number(this.video.duration);
    const known = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (seconds === this.lastTime && known === this.lastDuration) return;
    this.lastTime = seconds;
    this.lastDuration = known;
    try { this.onTime(seconds, known); } catch { /* un enregistrement local ne casse pas la lecture */ }
  }

  attemptAutoplay() {
    if (this.state === 'BLOCKED') return;
    const promise = this.video.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch((error) => {
        if (error && error.name === 'NotAllowedError') {
          this.setState('PAUSED');
          this.showMire('P-07', this.channel);
        } else if (error && error.name === 'NotSupportedError') {
          this.setState('ERROR');
          this.showMire('P-06', this.channel);
        }
        // AbortError : changement de source pendant la lecture, sans conséquence.
      });
    }
  }

  handleFatalError(data) {
    clearTimeout(this.manifestTimer);
    const code = data.response?.code || 0;
    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (code === 403) return this.fail('P-05');
      if (code === 404 || code === 410) return this.fail('P-04');
      if (code === 0) return this.fail('P-03');
      return this.fail('P-04');
    }
    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) return this.fail('P-06');
    return this.fail('P-12');
  }

  handleMediaError() {
    clearTimeout(this.manifestTimer);
    const error = this.video.error;
    if (!error) return this.fail('P-12');
    if (error.code === 4) return this.fail('P-06');
    if (error.code === 2) return this.fail('P-04');
    return this.fail('P-12');
  }

  /** Une seule reprise automatique, sans boucle (BUG-05). */
  fail(code) {
    const params = { nom: this.channel?.name || '', code: code === 'P-12' ? 'PLAY-12' : '' };
    if (RETRYABLE.has(code) && this.attempts < 1) {
      this.attempts += 1;
      this.setState('RETRYING');
      this.setMireState(`Nouvelle tentative…`, 'La source n’a pas répondu. Une seconde tentative est en cours.');
      this.retryTimer = setTimeout(() => {
        this.hideMire();
        this.releaseEngine();
        this.setState('PREPARING');
        this.startPlayback(this.channel.url);
      }, 800);
      return;
    }
    if (this.tryFallback()) return;
    this.setState('ERROR');
    this.showMire(code, params);
  }

  toastFallback(message) {
    try { toast(message, { tone: 'info', duration: 5000 }); } catch { /* sans importance */ }
  }

  /**
   * Repli après la reprise unique : une variante, une autre source, puis une chaîne proche.
   * Chaque piste n'est tentée qu'une fois, pour ne jamais boucler.
   */
  tryFallback() {
    const variante = (this.channel?.variants || []).find((item) => item.url && !this.triedUrls.has(item.url));
    if (variante) {
      this.triedUrls.add(variante.url);
      this.announce('Source de secours de la même chaîne.');
      this.releaseEngine();
      this.setState('PREPARING');
      this.startPlayback(variante.url);
      return true;
    }
    // Recherche multi-sources : même tvg-id, puis même nom normalisé, dans toutes les sources ingérées.
    const autre = (this.channel?.alternatives || []).find((item) => item.url
      && !item.blockedReason && !this.triedUrls.has(item.url)
      && !(location.protocol === 'https:' && String(item.url).startsWith('http:')));
    if (autre) {
      this.triedUrls.add(autre.url);
      this.announce(`Autre source trouvée pour cette chaîne (${autre.match === 'tvg-id' ? 'même identifiant' : 'même nom'}).`);
      this.toastFallback(`Autre source : ${autre.name}${autre.quality !== 'AUTO' ? ` (${autre.quality})` : ''}.`);
      this.releaseEngine();
      this.setState('PREPARING');
      this.startPlayback(autre.url);
      return true;
    }
    const proche = this.similarList.find((item) => item.id !== this.channel?.id && item.id !== this.fallbackChannel);
    if (proche) {
      this.fallbackChannel = proche.id;
      this.announce(`Signal indisponible. Ouverture de ${proche.name}.`);
      this.switchChannel(proche.id);
      return true;
    }
    return false;
  }

  releaseEngine() {
    if (this.hls) {
      try { this.hls.destroy(); } catch { /* déjà détruit */ }
      this.hls = null;
    }
    try { this.video?.removeAttribute('src'); this.video?.load(); } catch { /* sans objet */ }
  }

  /* ------------------------------------------------ 3.8.0 : habillages, niveaux, proches */

  setSkin(id) {
    if (!SKINS.some((skin) => skin.id === id)) return;
    prefs.setSkin(id);
    this.overlay.dataset.skin = id;
    this.overlay.querySelectorAll('.skin-switch button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.skin === id));
    });
    this.announce(`Habillage ${SKINS.find((skin) => skin.id === id).label}.`);
  }

  /** Programme en cours dans le lecteur : nom, horaires, progression. Jamais bloquant. */
  loadProgramme(channel) {
    if (!this.programme || channel.blocked) return;
    nowFor(channel.id).then((programme) => {
      if (!this.programme || !this.overlay?.isConnected) return;
      if (!programme) { this.programme.textContent = 'Programme non communiqué par la chaîne.'; return; }
      const pct = Math.round(progression(programme) * 100);
      this.programme.replaceChildren(
        h('strong', { text: programme.title }),
        ` · ${heureCourte(programme.start)} – ${heureCourte(programme.stop)} · ${pct} % écoulé`);
    }).catch(() => { if (this.programme) this.programme.textContent = 'Programme non communiqué par la chaîne.'; });
  }

  /** Niveaux du manifeste : « Qualité auto » reste le choix par défaut. */
  buildLevels() {
    const levels = Array.isArray(this.hls?.levels) ? this.hls.levels : [];
    this.levels = levels;
    if (!this.levelSelect) return;
    if (levels.length < 2) { this.levelSelect.hidden = true; this.renderStreamInfo(levels[0] ? 0 : -1); return; }
    this.levelSelect.hidden = false;
    this.levelSelect.replaceChildren(
      h('option', { value: '-1' }, 'Qualité auto'),
      ...levels.map((level, index) => h('option', { value: String(index) },
        level.height ? `${level.height}p` : `${Math.round((level.bitrate || 0) / 1000)} kb/s`)));
    this.hls.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => this.renderStreamInfo(data?.level ?? -1));
    this.renderStreamInfo(this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel);
  }

  switchLevel(index) {
    if (!this.hls) return;
    this.hls.currentLevel = index; // −1 : retour à l'automatique
    const label = this.levelSelect?.options?.[index + 1]?.textContent || '';
    this.announce(index < 0 ? 'Qualité automatique.' : `Qualité ${label}.`);
    this.renderStreamInfo(index);
  }

  /** Résolution, débit et codec, lus sur le niveau réellement en service. */
  renderStreamInfo(index = -1) {
    const host = this.overlay?.querySelector('.stream-info');
    if (!host) return;
    const level = index >= 0 ? this.levels?.[index] || null : (this.hls?.levels?.[this.hls?.currentLevel] || null);
    const hauteur = level?.height || this.video?.videoHeight || 0;
    const largeur = level?.width || this.video?.videoWidth || 0;
    const debit = level?.bitrate ? `${Math.round(level.bitrate / 1000)} kb/s` : 'non communiqué';
    const codec = level?.videoCodec || level?.attrs?.CODECS || this.video?.codecLabel || 'non communiqué';
    host.replaceChildren(
      h('span', {}, 'Résolution ', h('b', { text: hauteur ? `${largeur}×${hauteur}` : 'inconnue' })),
      h('span', {}, 'Débit ', h('b', { text: debit })),
      h('span', {}, 'Codec ', h('b', { text: String(codec).split(',')[0] })),
      h('span', {}, 'Réglage ', h('b', { text: this.hls?.currentLevel >= 0 ? 'manuel' : 'auto' })));
  }

  toggleSimilar() {
    if (!this.dock) return;
    const ouvert = this.dock.hidden;
    this.dock.hidden = !ouvert;
    this.similarBtn?.setAttribute('aria-expanded', String(ouvert));
    if (ouvert) {
      if (!this.dock.querySelector('.similar-track')) this.dock.querySelector('.player-similar')
        ?.replaceChildren(h('p', { class: 'player-sub' }, 'Recherche des chaînes proches…'));
      this.loadSimilar();
      this.dock.querySelector('button')?.focus({ preventScroll: true });
    }
    this.announce(ouvert ? 'Chaînes proches affichées.' : 'Chaînes proches masquées.');
  }

  /**
   * Chaînes proches : même catégorie, puis même pays, puis même langue ; « dans la même veine »
   * regroupe les déclinaisons du même nom (beIN Sports 2 après beIN Sports 1).
   */
  async loadSimilar() {
    const channel = this.channel;
    const host = this.dock?.querySelector('.player-similar');
    if (!channel || !host) return;
    const demander = (url) => api(url).then((payload) => payload.channels || []).catch(() => []);
    const [categorie, pays, langue] = await Promise.all([
      channel.category ? demander(`/api/channels?category=${encodeURIComponent(channel.category)}&pageSize=18&sort=confidence`) : [],
      channel.country ? demander(`/api/channels?country=${encodeURIComponent(channel.country)}&pageSize=18&sort=confidence`) : [],
      channel.language ? demander(`/api/channels?language=${encodeURIComponent(channel.language)}&pageSize=18&sort=confidence`) : [],
    ]);
    const famille = (String(channel.name).match(/^[\p{L}\p{N}]+/u) || [''])[0];
    const memeNom = famille.length > 3
      ? (await demander(`/api/channels/search?q=${encodeURIComponent(famille)}&pageSize=18`))
        .filter((item) => String(item.name).toLowerCase().includes(famille.toLowerCase()))
      : [];
    if (!host.isConnected) return;

    const vus = new Set([channel.id]);
    const prendre = (liste, limite) => {
      const sortie = [];
      for (const item of liste) {
        if (vus.has(item.id)) continue;
        vus.add(item.id);
        sortie.push(item);
        if (sortie.length >= limite) break;
      }
      return sortie;
    };
    const proches = prendre([...categorie, ...pays, ...langue], 10);
    const veine = prendre(memeNom, 10);
    this.similarList = proches;

    host.replaceChildren(...similarPanel({
      proches,
      veine,
      onNext: () => this.zap(1),
      onPick: (id) => this.switchChannel(id),
      onSimilaire: () => this.switchChannel(this.similarList[0]?.id),
    }));
    this.renderStreamInfo(this.hls?.currentLevel ?? -1);
  }

  /** Bascule vers une autre chaîne sans fermer le lecteur. */
  switchChannel(id) {
    if (!id || id === this.channel?.id) return;
    this.open(id, { queue: this.queue, onClose: this.onClose }).catch(() => this.close());
  }

  /** Annonce vocale discrète : jamais de doublon, jamais de texte technique. */
  announce(message) {
    if (!this.liveRegion) return;
    this.liveRegion.textContent = '';
    const text = String(message || '').trim();
    if (!text) return;
    setTimeout(() => { if (this.liveRegion) this.liveRegion.textContent = text; }, 40);
  }

  setMireState(title, explanation) {
    this.mireHost.replaceChildren(mireRetryNode({ title, explanation }));
    this.osd.dataset.hidden = 'true';
    this.mireVisible = true;
    this.announce(`${title}. ${explanation}`);
  }

  hideMire() {
    this.mireHost.replaceChildren();
    this.mireVisible = false;
    if (this.osd) this.osd.dataset.hidden = 'false';
  }

  mireForBlocked(blocked) {
    return mireForBlocked(blocked);
  }

  showMire(code, params = {}) {
    const mire = MIRES[code] || MIRES['P-12'];
    try { this.video.pause(); this.video.muted = true; } catch { /* rien à couper */ }
    const explanation = mire.explanation.replace('{nom}', params.nom || this.channel?.name || 'cette chaîne')
      .replace('{code}', params.code || code);
    const actions = mireActionNodes(mire.actions, this.mireHandlers());
    this.mireHost.replaceChildren(mireNode({ mire, explanation, actions }));
    this.osd.dataset.hidden = 'true';
    this.mireVisible = true;
    this.announce(`${mire.title}. ${explanation}`);
    this.setState(code === 'P-07' ? 'PAUSED' : 'ERROR');
  }

  /** Chaque action d'une mire a un effet réel : rien n'est affiché sans effet. */
  mireHandlers() {
    return {
      next: () => this.zap(1),
      retry: () => this.restart(),
      play: () => this.restart(),
      copy: () => copyText(this.channel.url).then((ok) => toast(
        ok ? 'Lien copié.' : 'Copie impossible sur ce navigateur.', { tone: ok ? 'success' : 'error' })),
      report: () => window.location.assign(`/signaler?chaine=${encodeURIComponent(this.channel.name)}&id=${this.channel.id}`),
      admin: () => window.location.assign(consoleHref()),
      reload: () => window.location.reload(),
    };
  }

  restart() {
    this.attempts = 0;
    this.hideMire();
    this.releaseEngine();
    this.setState('PREPARING');
    this.startPlayback(this.channel.url);
  }

  bindMediaEvents() {
    const video = this.video;
    video.addEventListener('playing', () => {
      clearTimeout(this.manifestTimer);
      this.attempts = 0;
      this.setState('PLAYING');
      this.hideMire();
      this.showOsd();
    });
    video.addEventListener('pause', () => {
      if (this.state === 'PLAYING') this.setState('PAUSED');
      this.playBtn?.replaceChildren(icon('play', 20));
      this.reportTime();
    });
    video.addEventListener('play', () => this.playBtn?.replaceChildren(icon('pause', 20)));
    /* Tampon réseau : ni erreur ni lecture · l'état BUFFERING est signalé une seule fois. */
    video.addEventListener('waiting', () => {
      if (this.state === 'PLAYING' && !this.mireVisible) {
        this.setState('BUFFERING');
        this.announce('Mise en mémoire du flux…');
      }
    });
    video.addEventListener('stalled', () => {
      if (this.state === 'PLAYING') this.setState('BUFFERING');
    });
    video.addEventListener('loadedmetadata', () => this.renderStreamInfo(this.hls?.currentLevel ?? -1));
    video.addEventListener('canplay', () => {
      if (this.state === 'BUFFERING') this.setState('PLAYING');
    });
    video.addEventListener('timeupdate', () => this.reportTime());
    video.addEventListener('ended', () => { this.reportTime(); this.setState('ENDED'); this.zap(1); });
    video.addEventListener('volumechange', () => {
      prefs.setVolume(video.volume);
      prefs.setMuted(video.muted);
      this.muteBtn?.setAttribute('aria-pressed', String(video.muted));
      this.muteBtn?.setAttribute('aria-label', video.muted ? 'Rétablir le son' : 'Couper le son');
      this.muteBtn?.replaceChildren(icon(video.muted ? 'mute' : 'volume', 18));
      if (this.volumeRange) this.volumeRange.value = String(video.volume);
    });
    video.addEventListener('click', () => this.toggle());
    video.addEventListener('dblclick', () => this.fullscreen());
    video.addEventListener('mousemove', () => this.showOsd());
  }

  bindKeys() {
    this.onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); if (leaveFullscreen()) return; this.close(); return; }
      const target = event.target;
      const typing = target && (target.closest('input, textarea, select, [contenteditable="true"]'));
      if (typing) return; // BUG-03 : aucun raccourci dans un champ
      if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); this.toggle(); return; }
      if (event.key === 'm') { this.toggleMute(); return; }
      if (event.key === 'f') { this.fullscreen(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); this.setVolume(Math.min(1, this.video.volume + 0.1)); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); this.setVolume(Math.max(0, this.video.volume - 0.1)); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); this.zap(1); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); this.zap(-1); return; }
      if (/^[0-9]$/.test(event.key)) {
        this.digitBuffer += event.key;
        clearTimeout(this.digitTimer);
        this.digitTimer = setTimeout(() => {
          const number = Number(this.digitBuffer);
          this.digitBuffer = '';
          if (number > 0) this.jumpToNumber(number);
        }, 900);
      }
    };
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  /**
   * Gestes tactiles : un tap affiche ou masque l'OSD, un glissement vertical règle le volume,
   * un glissement horizontal change de chaîne. Les commandes de la barre gardent la main :
   * le geste ne s'arme que sur la surface vidéo.
   */
  bindGestures(stage) {
    if (!stage || !this.video) return;
    this.detachGestures = wireGestures(this.video, {
      getVolume: () => this.video.volume,
      getState: () => this.osd?.dataset.hidden,
      onVolume: (value) => {
        this.setVolume(value);
        this.showOsd(`Volume ${Math.round(this.video.volume * 100)} %`);
      },
      onZap: (direction) => {
        this.zap(direction);
        this.showOsd(direction > 0 ? COPY.actions.next : COPY.actions.previous);
      },
      // Un tap sur l'image : l'OSD s'affiche, puis s'efface s'il était déjà visible.
      onTap: (hidden) => (hidden === 'false' ? this.hideOsd() : this.showOsd()),
    });
  }

  setVolume(value) {
    if (!this.video) return;
    this.video.volume = Math.min(1, Math.max(0, value));
    this.video.muted = false;
  }

  /** Le retour est immédiat : icône, état annoncé et repère à l'écran, sans attendre un événement. */
  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    const coupe = this.video.muted;
    this.muteBtn?.setAttribute('aria-pressed', String(coupe));
    this.muteBtn?.setAttribute('aria-label', coupe ? 'Rétablir le son' : 'Couper le son');
    this.muteBtn?.replaceChildren(icon(coupe ? 'mute' : 'volume', 18));
    if (this.volumeRange) this.volumeRange.value = String(this.video.volume);
    this.showOsd(coupe ? 'Son coupé' : 'Son rétabli');
  }

  toggle() {
    if (!this.video) return;
    if (this.state === 'ERROR' || this.state === 'BLOCKED') return;
    if (this.video.paused) {
      this.hideMire();
      this.video.play().catch(() => this.showMire('P-07', this.channel));
    } else {
      this.video.pause();
    }
  }

  showOsd(message = '') {
    if (!this.osd) return;
    if (this.mireHost?.childElementCount) return;
    if (message) {
      clearTimeout(this.osdNoteTimer);
      const note = this.osd.querySelector('.osd-note') || h('em', { class: 'osd-note' });
      note.textContent = message;
      if (!note.isConnected) this.osd.append(note);
      this.osdNoteTimer = setTimeout(() => note.remove(), 1400);
    }
    this.osd.dataset.hidden = 'false';
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => {
      if (this.osd && this.state === 'PLAYING') this.osd.dataset.hidden = 'true';
    }, 3800);
  }

  hideOsd() {
    if (!this.osd) return;
    clearTimeout(this.osdTimer);
    this.osd.dataset.hidden = 'true';
  }

  async zap(direction) {
    if (this.queue.length < 2) return;
    const nextIndex = (this.index + direction + this.queue.length) % this.queue.length;
    const id = this.queue[nextIndex];
    if (!id) return;
    try {
      const { channel } = await api(`/api/channels/${id}`);
      this.index = nextIndex;
      await this.mount(channel);
    } catch (error) {
      toast(error.message || 'Chaîne introuvable.', { tone: 'error' });
    }
  }

  async jumpToNumber(number) {
    try {
      // Les numéros ne sont pas contigus : on passe par l'index de recherche, qui remonte
      // d'abord la chaîne portant exactement ce numéro (score +50, cf. F-18).
      const list = await api(`/api/channels/search?q=${encodeURIComponent(String(number))}&pageSize=24`);
      const found = list.channels.find((item) => item.number === number) || list.channels[0];
      if (!found) {
        toast(`Aucune chaîne au numéro ${number}.`, { tone: 'info' });
        return;
      }
      this.queue = list.channels.map((item) => item.id);
      this.index = this.queue.indexOf(found.id);
      const { channel } = await api(`/api/channels/${found.id}`);
      await this.mount(channel);
    } catch (error) {
      toast(error.message || 'Numéro injoignable.', { tone: 'error' });
    }
  }

  async switchQuality(url) {
    if (!url || !this.video) return;
    this.setState('PREPARING');
    this.attempts = 0;
    this.hideMire();
    this.releaseEngine();
    this.startPlayback(url);
  }

  pictureInPicture() {
    if (document.pictureInPictureEnabled && this.video?.requestPictureInPicture) {
      this.video.requestPictureInPicture().catch(() => toast('L’image dans l’image n’est pas disponible ici.', { tone: 'info' }));
    } else {
      toast('L’image dans l’image n’est pas prise en charge par ce navigateur.', { tone: 'info' });
    }
  }

  fullscreen() { toggleFullscreen(this); }

  showShortcuts() {
    openShortcuts();
  }

  showOptions() {
    openPlayerOptions(this);
  }

  setState(state) {
    this.state = state;
    if (this.video) {
      if (state === 'PLAYING') this.video.dataset.state = 'playing';
      else this.video.dataset.state = state.toLowerCase();
    }
  }

  clearTimers() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.manifestTimer);
    clearTimeout(this.osdTimer);
    clearTimeout(this.osdNoteTimer);
  }

  teardown(closeOverlay = true) {
    // La dernière position est enregistrée avant que le média ne disparaisse.
    this.reportTime();
    this.clearTimers();
    clearTimeout(this.digitTimer);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true);
    this.onKeyDown = null;
    this.detachGestures?.();
    this.detachGestures = null;
    this.releaseEngine();
    if (this.video) {
      try { this.video.pause(); } catch { /* déjà arrêté */ }
      this.video.replaceChildren?.();
      this.video.removeAttribute('src');
      this.video.load?.();
    }
    if (closeOverlay && this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    document.body.style.overflow = this.previousOverflow || '';
    this.video = null;
    this.hls = null;
    this.setState('IDLE');
    if (this.previousFocus && this.previousFocus.focus) {
      try { this.previousFocus.focus(); } catch { /* élément disparu */ }
    }
  }

  close() {
    const channelName = this.channel?.name;
    this.teardown(true);
    this.channel = null;
    if (this.onClose) this.onClose(channelName);
  }
}

let instance = null;
export function getPlayer() {
  if (!instance) instance = new Player();
  return instance;
}
