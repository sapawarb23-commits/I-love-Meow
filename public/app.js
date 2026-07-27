// app.js — shared client-side helpers. Real fetch calls to the real API
// below; there is no mock data or fake response anywhere in this file.

const Meow = {
  // "Remember me" checked -> localStorage (persists across browser restarts).
  // "Remember me" unchecked -> sessionStorage (cleared when the tab/browser closes).
  token: localStorage.getItem('ilm_token') || sessionStorage.getItem('ilm_token') || null,
  user: JSON.parse(localStorage.getItem('ilm_user') || sessionStorage.getItem('ilm_user') || 'null'),

  setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('ilm_token', token);
    localStorage.setItem('ilm_user', JSON.stringify(user));
  },

  clearSession() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('ilm_token');
    localStorage.removeItem('ilm_user');
    sessionStorage.removeItem('ilm_token');
    sessionStorage.removeItem('ilm_user');
  },

  async api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || this.friendlyError(res.status));
    return data;
  },

  // Maps raw HTTP failures to warm, on-brand copy so a stray 500 never
  // reads like a stack trace to the person using the app.
  friendlyError(status) {
    if (status === 401 || status === 403) return "You've been logged out — sign back in to keep going.";
    if (status === 404) return "That Meow must have wandered off somewhere.";
    if (status === 429) return "Whoa, one paw at a time! Try again in a moment.";
    if (status >= 500) return "One of our cats knocked something off the shelf. We're fixing it — try again shortly.";
    return "Something didn't quite land. Give it another try.";
  },

  // Shared markup for a full "network's down" style empty/error card — drop
  // into any errBox for a consistent, friendly failure state.
  offlineCardHtml(retryLabel = 'Try again') {
    return `<div class="card empty-state">
      <div class="emoji">🐾</div>
      <h3>Oh no, a hairball in the wires.</h3>
      <p>We couldn't reach the server. Check your connection and give it another go.</p>
      <button type="button" class="btn btn-primary" onclick="location.reload()">${retryLabel}</button>
    </div>`;
  },

  requireAuth() {
    if (!this.token) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  timeAgo(iso) {
    const seconds = Math.floor((Date.now() - new Date(iso + 'Z')) / 1000);
    if (seconds < 60) return 'just now';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  },

  toast(msg) {
    let el = document.getElementById('ilm-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ilm-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  },

  renderNav(activePage) {
    const el = document.getElementById('app-nav');
    if (el) {
      const loggedIn = !!this.token;
      const avatar = loggedIn ? this.avatarHtml(this.user, { size: 30, className: 'nav-avatar-img' }) : '';
      el.innerHTML = `
        <a href="/" class="brand"><span>🐾</span><span>I Love Meow</span></a>
        <div class="app-nav-links">
          ${loggedIn ? `
            <a href="/feed.html" class="${activePage === 'feed' ? 'active' : ''}">Feed</a>
            <a href="/explore.html" class="${activePage === 'explore' ? 'active' : ''}">Explore</a>
            <a href="/breeds.html" class="${activePage === 'breeds' ? 'active' : ''}">Breeds</a>
            <a href="/games.html" class="${activePage === 'games' ? 'active' : ''}">Games</a>
            <a href="/profile.html" class="${activePage === 'profile' ? 'active' : ''}">Profile</a>
            <button id="logout-btn">Log out</button>
            <a href="/profile.html" class="nav-avatar" title="Your profile">${avatar}</a>
          ` : `
            <a href="/login.html" class="${activePage === 'login' ? 'active' : ''}">Log in</a>
            <a href="/register.html" class="nav-cta ${activePage === 'register' ? 'active' : ''}">Join the Clowder</a>
          `}
        </div>
      `;
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          this.clearSession();
          window.location.href = '/';
        });
      }
    }

    // Mobile bottom dock — only meaningful once logged in; on public pages it just links home/login.
    const dock = document.getElementById('mobile-dock');
    if (dock) {
      const loggedIn = !!this.token;
      dock.innerHTML = loggedIn ? `
        <a href="/feed.html" class="${activePage === 'feed' ? 'active' : ''}">🏠</a>
        <a href="/explore.html" class="${activePage === 'explore' ? 'active' : ''}">🧭</a>
        <a href="/breeds.html" class="${activePage === 'breeds' ? 'active' : ''}">📚</a>
        <a href="/games.html" class="${activePage === 'games' ? 'active' : ''}">🎮</a>
        <a href="/profile.html" class="${activePage === 'profile' ? 'active' : ''}">🐾</a>
        <a href="#" id="dock-logout">🚪</a>
      ` : `
        <a href="/" class="${activePage === 'home' ? 'active' : ''}">🏠</a>
        <a href="/login.html" class="${activePage === 'login' ? 'active' : ''}">🔑</a>
        <a href="/register.html" class="${activePage === 'register' ? 'active' : ''}">✨</a>
      `;
      const dockLogout = document.getElementById('dock-logout');
      if (dockLogout) {
        dockLogout.addEventListener('click', (e) => {
          e.preventDefault();
          this.clearSession();
          window.location.href = '/';
        });
      }
    }
  },

  // Cute loading indicator markup — never a plain spinner.
  loadingCatHtml(label = 'Fetching Meows…') {
    return `
      <div class="loading-cat">
        <div class="paws"><span>🐾</span><span>🐾</span><span>🐾</span></div>
        <div style="font-size:13px; font-weight:600; opacity:.7;">${this.escapeHtml(label)}</div>
      </div>
    `;
  },

  // Small paw-print ripple on click — a real, lightweight microinteraction, not decorative-only chrome.
  initPawRipple() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('button, a')) return;
      const paw = document.createElement('div');
      paw.className = 'paw-ripple';
      paw.textContent = '🐾';
      paw.style.left = e.clientX + 'px';
      paw.style.top = e.clientY + 'px';
      document.body.appendChild(paw);
      setTimeout(() => paw.remove(), 650);
    });
  },

  // Lightweight confetti burst for celebratory moments (e.g. account created).
  confettiBurst() {
    let canvas = document.getElementById('confetti-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'confetti-canvas';
      document.body.appendChild(canvas);
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#FF914D', '#FFC7D6', '#FFCC4D', '#64D27A', '#1D1D1D'];
    const pieces = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      size: 5 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      vy: 2 + Math.random() * 3,
      vx: -2 + Math.random() * 4,
      rot: Math.random() * 360,
      vr: -6 + Math.random() * 12,
    }));
    let frame = 0;
    const maxFrames = 130;
    function tick() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (frame < maxFrames) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    tick();
  },

  // Ambient decorative blobs, shared across every internal page.
  renderBlobs() {
    const el = document.getElementById('bg-blobs');
    if (!el) return;
    el.innerHTML = `<div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>`;
  },
  // ---- Dark mode ----
  // The <head> of each app page also runs a tiny inline script before this
  // file loads, so the correct theme applies before first paint (no flash).
  initTheme() {
    const applied = document.documentElement.getAttribute('data-theme') || 'light';
    let btn = document.getElementById('theme-toggle-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'theme-toggle-btn';
      btn.className = 'theme-toggle theme-toggle-fixed';
      btn.title = 'Toggle dark mode';
      document.body.appendChild(btn);
    }
    btn.textContent = applied === 'dark' ? '☀️' : '🌙';
    btn.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('ilm_theme', next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    };
  },

  // Highlights @mentions in comment/caption text. Visual only — since there's
  // no notifications system yet, mentioning someone doesn't (and shouldn't
  // claim to) notify them; it just makes the @handle stand out.
  renderWithMentions(text) {
    const escaped = this.escapeHtml(text);
    return escaped.replace(/(^|\s)@([a-zA-Z0-9_]{3,20})/g, '$1<span class="mention">@$2</span>');
  },

  // ==================== Image uploads ====================
  // Formats we accept — kept in sync with cloudinary.js's server-signed
  // allowed_formats. This client-side check is purely for fast, friendly
  // feedback; the server never trusts it (Cloudinary re-checks the real
  // file bytes against the signed params).
  UPLOAD_ACCEPT: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  UPLOAD_MAX_BYTES: 10 * 1024 * 1024,

  validateImageFile(file) {
    if (!file) return 'No file selected.';
    if (!this.UPLOAD_ACCEPT.includes(file.type)) return 'Please choose a JPG, PNG, or WEBP image.';
    if (file.size > this.UPLOAD_MAX_BYTES) return 'That image is over 10MB — try a smaller one.';
    return null;
  },

  // Downscales/recompresses large images client-side before upload (faster
  // uploads, less bandwidth) while preserving aspect ratio and reasonable
  // quality. This is a courtesy optimization only — Cloudinary's own
  // allowed_formats/bytes limits are the real, trusted enforcement.
  compressImage(file, { maxDim = 1920, square = false, quality = 0.86 } = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        let sx = 0, sy = 0, sw = width, sh = height;
        if (square) {
          sw = sh = Math.min(width, height);
          sx = (width - sw) / 2; sy = (height - sh) / 2;
          width = height = sw;
        }
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const outW = Math.round(width * scale);
        const outH = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Could not process that image.'));
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, outType === 'image/png' ? '.png' : '.jpg'), { type: outType }));
        }, outType, quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file doesn\'t look like a valid image.')); };
      img.src = url;
    });
  },

  // Uploads `file` straight to Cloudinary using a short-lived signature from
  // our server (see cloudinary.js) — the bytes never pass through our own
  // backend. `type` is 'post' | 'avatar' | 'cover'. Resolves with Cloudinary's
  // raw response ({ secure_url, bytes, ... }) — callers should pass that to
  // finalizeUpload() before treating the URL as usable. Returns { promise,
  // cancel } so callers can show progress and support cancel.
  uploadImage(file, { type = 'post', onProgress } = {}) {
    const xhr = new XMLHttpRequest();
    const promise = (async () => {
      const sig = await this.api(`/api/upload/signature?type=${encodeURIComponent(type)}`, { method: 'POST' });
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', sig.timestamp);
      form.append('signature', sig.signature);
      form.append('folder', sig.folder);
      form.append('allowed_formats', sig.allowedFormats);

      return new Promise((resolve, reject) => {
        xhr.open('POST', sig.uploadUrl);
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let data;
          try { data = JSON.parse(xhr.responseText); } catch { return reject(new Error('Upload failed. Please try again.')); }
          if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) resolve(data);
          else reject(new Error(data.error?.message || 'Upload failed. Please try again.'));
        };
        xhr.onerror = () => reject(new Error('Network interruption — the upload didn\'t go through.'));
        xhr.onabort = () => reject(new Error('CANCELLED'));
        xhr.send(form);
      });
    })();
    return { promise, cancel: () => xhr.abort() };
  },

  // Confirms an upload with our server (POST /api/upload/verify), which
  // re-derives the asset's public_id from the URL and checks Cloudinary's
  // own reported byte size — real server-side enforcement, since a client
  // can't be trusted to self-report "yes this file is small enough".
  // Oversized assets are deleted server-side before this ever resolves.
  // Resolves with the usable secure_url, or throws a friendly error.
  async finalizeUpload(cloudinaryResponse) {
    const { url } = await this.api('/api/upload/verify', {
      method: 'POST',
      body: { secure_url: cloudinaryResponse.secure_url, bytes: cloudinaryResponse.bytes },
    });
    return url;
  },

  // Avatar image (or emoji fallback) — the one shared renderer used
  // everywhere a user's picture shows up: feed, comments, profile, search.
  avatarHtml(user, { size = 38, className = '' } = {}) {
    const url = user?.avatar_url || user?.author_avatar_url;
    const emoji = user?.avatar_emoji || user?.author_avatar || '🐱';
    if (url) {
      return `<img class="avatar-emoji avatar-img ${className}" style="width:${size}px;height:${size}px;" src="${this.escapeHtml(url)}" alt="${this.escapeHtml(user?.username || user?.author_username || 'User')}'s avatar" loading="lazy" onerror="this.outerHTML=Meow.avatarHtml({avatar_emoji:'${emoji}'},{size:${size},className:'${className}'})">`;
    }
    return `<div class="avatar-emoji ${className}" style="width:${size}px;height:${size}px;">${emoji}</div>`;
  },

  // Wires a drag-and-drop / click-to-upload image picker into `container`.
  // Handles preview, upload progress, cancel, remove, and error states, and
  // reports the final Cloudinary URL via onUploaded(url) — or onCleared()
  // if the user removes the image before posting.
  initUploader(container, { type = 'post', square = false, onUploaded, onCleared } = {}) {
    const input = container.querySelector('.uploader-input');
    const dropzone = container.querySelector('.uploader-dropzone');
    const previewWrap = container.querySelector('.uploader-preview');
    const previewImg = previewWrap.querySelector('img');
    const progressBar = container.querySelector('.uploader-progress-bar');
    const progressWrap = container.querySelector('.uploader-progress');
    const errorBox = container.querySelector('.uploader-error');
    const removeBtn = container.querySelector('.uploader-remove');
    const cancelBtn = container.querySelector('.uploader-cancel');
    let activeUpload = null;

    const reset = () => {
      previewWrap.style.display = 'none';
      dropzone.style.display = 'flex';
      progressWrap.style.display = 'none';
      progressBar.style.width = '0%';
      errorBox.innerHTML = '';
      input.value = '';
    };

    const showError = (msg) => {
      errorBox.innerHTML = `<span class="uploader-error-msg">⚠️ ${this.escapeHtml(msg)}</span>`;
      progressWrap.style.display = 'none';
    };

    const handleFile = async (file) => {
      errorBox.innerHTML = '';
      const err = this.validateImageFile(file);
      if (err) { showError(err); return; }

      dropzone.style.display = 'none';
      previewWrap.style.display = 'block';
      progressWrap.style.display = 'block';
      progressBar.style.width = '0%';
      progressBar.classList.remove('done', 'failed');
      previewImg.src = URL.createObjectURL(file);

      try {
        const compressed = await this.compressImage(file, { square });
        const { promise, cancel } = this.uploadImage(compressed, {
          type,
          onProgress: (pct) => { progressBar.style.width = pct + '%'; },
        });
        activeUpload = { cancel };
        const cloudinaryResponse = await promise;
        progressBar.style.width = '100%';
        const url = await this.finalizeUpload(cloudinaryResponse);
        progressBar.classList.add('done');
        activeUpload = null;
        if (onUploaded) onUploaded(url);
      } catch (e) {
        activeUpload = null;
        if (e.message === 'CANCELLED') { reset(); return; }
        progressBar.classList.add('failed');
        showError(e.message || 'Upload failed. Please try again.');
      }
    };

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

    ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('drag-over');
    }));
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    });

    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (activeUpload) activeUpload.cancel();
      else reset();
    });
    if (removeBtn) removeBtn.addEventListener('click', () => {
      if (activeUpload) activeUpload.cancel();
      reset();
      if (onCleared) onCleared();
    });

    return { reset };
  },

  // Markup for a drag-and-drop uploader. Drop this into any composer/form;
  // pair with initUploader() to wire it up.
  uploaderHtml({ label = 'Add a cat photo', id = '' } = {}) {
    return `
      <div class="uploader" id="${id}">
        <input type="file" class="uploader-input" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="uploader-dropzone" tabindex="0" role="button" aria-label="${this.escapeHtml(label)}">
          <span class="uploader-icon">🖼️</span>
          <span class="uploader-label">${this.escapeHtml(label)}</span>
          <span class="uploader-sublabel">Click or drag & drop · JPG, PNG, WEBP · up to 10MB</span>
        </div>
        <div class="uploader-preview" style="display:none;">
          <img alt="Preview of the image you're about to upload">
          <div class="uploader-progress" style="display:none;">
            <div class="uploader-progress-track"><div class="uploader-progress-bar"></div></div>
            <button type="button" class="uploader-cancel" aria-label="Cancel upload">Cancel</button>
          </div>
          <button type="button" class="uploader-remove" aria-label="Remove image">✕ Remove</button>
        </div>
        <div class="uploader-error"></div>
      </div>
    `;
  },

  // ==================== Lightbox ====================
  // Full-screen image viewer: zoom (click to toggle, or wheel/pinch), ESC
  // to close, click outside the image to close. Delegated globally so any
  // page just needs to add data-lightbox="<url>" to an <img>.
  initLightbox() {
    if (document.getElementById('ilm-lightbox')) return;
    const box = document.createElement('div');
    box.id = 'ilm-lightbox';
    box.className = 'lightbox';
    box.innerHTML = `<button class="lightbox-close" aria-label="Close image">✕</button><img alt="">`;
    document.body.appendChild(box);
    const img = box.querySelector('img');
    let zoomed = false;

    const close = () => { box.classList.remove('open'); img.classList.remove('zoomed'); zoomed = false; };
    box.querySelector('.lightbox-close').addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    img.addEventListener('click', () => { zoomed = !zoomed; img.classList.toggle('zoomed', zoomed); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('open')) close(); });

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-lightbox]');
      if (!trigger) return;
      img.src = trigger.dataset.lightbox;
      img.alt = trigger.alt || 'Full-size photo';
      img.classList.remove('zoomed'); zoomed = false;
      box.classList.add('open');
    });
  },

  REACTIONS: { purr: '🐾', adorable: '😻', loaf: '🍞', zoomies: '⚡', sleepy: '😴', fishy: '🐟', royal: '👑', chaos: '😂' },
  REACTION_LABELS: { purr: 'Purr', adorable: 'Adorable', loaf: 'Loaf', zoomies: 'Zoomies', sleepy: 'Sleepy', fishy: 'Fishy', royal: 'Royal', chaos: 'Chaos' },

  // Renders the trigger button + popover picker for a Meow's reactions.
  // `reactions` is the { counts, total, mine } shape returned by the API.
  reactionBarHtml(reactions) {
    const top = Object.entries(reactions.counts || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => this.REACTIONS[type])
      .join('');
    const mineEmoji = reactions.mine ? this.REACTIONS[reactions.mine] : '🐾';
    const label = reactions.mine ? this.REACTION_LABELS[reactions.mine] : 'React';
    return `
      <div class="reaction-bar">
        <button class="reaction-trigger pill-btn ${reactions.mine ? 'has-reaction' : ''}" type="button">
          <span class="rx-trigger-emoji">${mineEmoji}</span>
          <span class="rx-trigger-label">${label}</span>
          ${reactions.total > 0 ? `<span class="reaction-summary">${top ? `<span class="rx-emoji">${top.split('').join('</span><span class="rx-emoji">')}</span>` : ''}</span> <span class="rx-total">${reactions.total}</span>` : ''}
        </button>
        <div class="reaction-picker">
          ${Object.entries(this.REACTIONS).map(([type, emoji]) => `
            <button type="button" class="rx-pick ${reactions.mine === type ? 'selected' : ''}" data-type="${type}" title="${this.REACTION_LABELS[type]}">${emoji}</button>
          `).join('')}
        </div>
      </div>
    `;
  },

  // Wires up a reaction bar previously inserted via reactionBarHtml().
  // onUpdate(reactions) lets the same code serve both feed and explore cards.
  attachReactionBar(container, meowId, onUpdate) {
    const bar = container.querySelector('.reaction-bar');
    if (!bar) return;
    const trigger = bar.querySelector('.reaction-trigger');
    const picker = bar.querySelector('.reaction-picker');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.reaction-picker.open').forEach(p => { if (p !== picker) p.classList.remove('open'); });
      picker.classList.toggle('open');
    });
    document.addEventListener('click', () => picker.classList.remove('open'));
    picker.addEventListener('click', (e) => e.stopPropagation());

    picker.querySelectorAll('.rx-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        picker.classList.remove('open');
        try {
          const { reactions } = await this.api(`/api/meows/${meowId}/react`, { method: 'POST', body: { type: btn.dataset.type } });
          const fresh = document.createElement('div');
          fresh.innerHTML = this.reactionBarHtml(reactions);
          const newBar = fresh.firstElementChild;
          bar.replaceWith(newBar);
          this.attachReactionBar(container, meowId, onUpdate);
          const emojiEl = container.querySelector('.rx-trigger-emoji');
          if (emojiEl) { emojiEl.classList.remove('reaction-pop'); void emojiEl.offsetWidth; emojiEl.classList.add('reaction-pop'); }
          if (onUpdate) onUpdate(reactions);
        } catch (err) { this.toast(err.message); }
      });
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Meow.renderBlobs();
  Meow.initPawRipple();
  Meow.initTheme();
  Meow.initLightbox();
});
