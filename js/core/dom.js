// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - DOM Utilities & Constants
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const DOM = Object.freeze({
  byId: (id) => document.getElementById(id),
  qs: (sel, root = document) => root.querySelector(sel),
  qsa: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
});

const UI_IDS = Object.freeze({
  loading: 'loading',
  loadProgress: 'load-progress',
  loadStatus: 'load-status',
  fullscreenBtn: 'fullscreen-btn',
});

const INPUT_KEYS = Object.freeze({
  LEFT: new Set(['KeyA', 'ArrowLeft']),
  RIGHT: new Set(['KeyD', 'ArrowRight']),
  JUMP: new Set(['KeyW', 'ArrowUp', 'Space']),
  SPRINT: new Set(['ShiftLeft', 'ShiftRight'])
});

const MOUSE_BUTTON = Object.freeze({ LEFT: 0, RIGHT: 2 });

const INVENTORY_LIMITS = Object.freeze({
  MAX_SIZE: 36,
  MAX_STACK: 999
});
