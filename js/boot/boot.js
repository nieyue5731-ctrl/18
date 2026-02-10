// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Bootstrap & Health Check
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// Loading particles
(function initLoadingParticles() {
  const container = document.querySelector('.loading-particles');
  if (!container) return;
  const frag = document.createDocumentFragment();
  const colors = ['#ffeaa7', '#fd79a8', '#a29bfe', '#74b9ff'];
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const reduce = (() => {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  })();
  let particleCount = Math.round(18 + cores * 2);
  if (dpr >= 2) particleCount -= 4;
  if (dpr >= 3) particleCount -= 6;
  if (reduce) particleCount = Math.min(particleCount, 16);
  particleCount = Math.max(12, Math.min(60, particleCount));
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = (Math.random() * 100).toFixed(3) + '%';
    p.style.animationDelay = (Math.random() * 10).toFixed(2) + 's';
    p.style.animationDuration = (8 + Math.random() * 6).toFixed(2) + 's';
    p.style.background = colors[(Math.random() * colors.length) | 0];
    frag.appendChild(p);
  }
  container.appendChild(frag);
})();

// Backdrop-filter detection
(function detectBackdropFilterSupport() {
  try {
    const ok = !!(window.CSS && (CSS.supports('backdrop-filter: blur(1px)') || CSS.supports('-webkit-backdrop-filter: blur(1px)')));
    document.documentElement.classList.toggle('no-backdrop', !ok);
  } catch {
    document.documentElement.classList.add('no-backdrop');
  }
})();

// Main boot
window.addEventListener('load', () => {
  const SAFE = window.TU_SAFE || {};
  const report = (err, ctx) => {
    try {
      if (SAFE && typeof SAFE.reportError === 'function') SAFE.reportError(err, ctx);
      else console.error(err);
    } catch (e) {
      try { console.error(err); } catch {}
    }
  };

  try {
    const game = new Game();
    window.__GAME_INSTANCE__ = game;
    window.game = game;

    const p = game.init();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => report(e, { phase: 'init' }));
    }
  } catch (e) {
    report(e, { phase: 'boot' });
  }
});

// Runtime optimization: skip near-black tiles
(function() {
  if (typeof Renderer !== 'undefined') {
    const RP = Renderer.prototype;
    const originalDrawTile = RP.drawTile;
    if (originalDrawTile) {
      RP.drawTile = function(ctx, id, x, y, size, light) {
        if (light <= 0.05) return;
        originalDrawTile.call(this, ctx, id, x, y, size, light);
      };
    }
  }
})();

// Health check (30s interval)
(function() {
  window.addEventListener('beforeunload', function() {
    if (window.TU && TU._worldWorkerClient && TU._worldWorkerClient.worker) {
      try { TU._worldWorkerClient.worker.terminate(); } catch (e) {}
    }
    if (window.TU_Defensive && window.TU_Defensive.ResourceManager) {
      try { window.TU_Defensive.ResourceManager.disposeAll(); } catch (e) {}
    }
  });

  setInterval(function() {
    const game = window.__GAME_INSTANCE__ || window.game;
    if (game) {
      if (game.player && game.world) {
        const px = game.player.x;
        const py = game.player.y;
        if (typeof px !== 'number' || typeof py !== 'number' ||
            isNaN(px) || isNaN(py) || !isFinite(px) || !isFinite(py)) {
          console.error('[HealthCheck] Invalid player position, resetting');
          game.player.x = game.world.w * 16 / 2;
          game.player.y = game.world.h * 16 / 2;
        }
      }
    }
  }, 30000);
})();
