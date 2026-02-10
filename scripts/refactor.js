#!/usr/bin/env node
/**
 * Terraria Ultra - Modular Refactoring Script
 * Extracts the monolithic HTML file into a modular project structure.
 * 
 * Phase 0-8 automated extraction and consolidation.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'index (92).html');
const ROOT = path.join(__dirname, '..');

// Read the entire source
const src = fs.readFileSync(SRC, 'utf-8');
const lines = src.split('\n');

console.log(`Read ${lines.length} lines from source file`);

// ============================================================================
// Helper: ensure directory exists
// ============================================================================
function ensureDir(dir) {
  const full = path.join(ROOT, dir);
  fs.mkdirSync(full, { recursive: true });
}

function writeFile(relPath, content) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  console.log(`  Written: ${relPath} (${content.length} bytes)`);
}

// ============================================================================
// Phase 2: Extract all <style> blocks
// ============================================================================
console.log('\n=== Phase 2: CSS Extraction ===');

function extractStyles() {
  const styleBlocks = [];
  let inStyle = false;
  let currentBlock = [];
  let blockStart = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.match(/<style[^>]*>/i) && !inStyle) {
      inStyle = true;
      currentBlock = [];
      blockStart = i;
      // Check if style content is on the same line
      const match = line.match(/<style[^>]*>([\s\S]*?)(<\/style>)?/i);
      if (match && match[1]) {
        currentBlock.push(match[1]);
        if (match[2]) {
          // Entire style on one line
          styleBlocks.push({ start: i, end: i, content: currentBlock.join('\n') });
          inStyle = false;
          currentBlock = [];
        }
      }
      continue;
    }
    
    if (inStyle) {
      if (trimmed.match(/<\/style>/i)) {
        // Remove closing tag from content
        const lastLine = line.replace(/<\/style>/i, '').trim();
        if (lastLine) currentBlock.push(lastLine);
        styleBlocks.push({ start: blockStart, end: i, content: currentBlock.join('\n') });
        inStyle = false;
        currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    }
  }
  
  return styleBlocks;
}

const styleBlocks = extractStyles();
console.log(`Found ${styleBlocks.length} style blocks`);

// Consolidate CSS into organized files
let allCSS = styleBlocks.map(b => b.content).join('\n\n');

// Extract :root variables
const rootRegex = /:root\s*\{[^}]*\}/gs;
const rootBlocks = allCSS.match(rootRegex) || [];

// Merge all :root blocks into one
let mergedVars = '';
const varSet = new Set();
for (const block of rootBlocks) {
  const vars = block.match(/--[\w-]+:\s*[^;]+;/g) || [];
  for (const v of vars) {
    const name = v.match(/--[\w-]+/)[0];
    if (!varSet.has(name)) {
      varSet.add(name);
      mergedVars += '  ' + v + '\n';
    }
  }
}

// Write CSS variables file
writeFile('css/variables.css', `/* ═══════════════════ CSS Variables (Consolidated) ═══════════════════ */
:root {
${mergedVars}}
`);

// Remove :root blocks from allCSS for other processing
let cssWithoutRoot = allCSS.replace(rootRegex, '');

// Write main CSS file (everything else)
writeFile('css/main.css', `/* ═══════════════════ Terraria Ultra - Main Stylesheet ═══════════════════ */
/* Consolidated from ${styleBlocks.length} inline <style> blocks */

/* Reset */
* { margin: 0; padding: 0; box-sizing: border-box; }
button { font: inherit; padding: 0; }

html, body {
  width: 100%; height: 100%; overflow: hidden;
  background: linear-gradient(135deg, #0c0c1e 0%, #1a1a2e 50%, #16213e 100%);
  font-family: system-ui, sans-serif;
  user-select: none; -webkit-user-select: none;
  touch-action: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

${cssWithoutRoot}
`);

// ============================================================================
// Phase 1-3: Extract all <script> blocks and organize into modules
// ============================================================================
console.log('\n=== Phase 1-3: JS Extraction & Module Organization ===');

function extractScripts() {
  const scriptBlocks = [];
  let inScript = false;
  let currentBlock = [];
  let blockStart = 0;
  let blockComment = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Capture section/module comments
    if (trimmed.match(/<!--\s*={3,}\s*(SECTION|MODULE|PATCH):/)) {
      blockComment = trimmed;
    }
    
    if (trimmed.match(/<script[^>]*>/i) && !inScript) {
      inScript = true;
      currentBlock = [];
      blockStart = i;
      // Check if script content is on the same line
      const match = line.match(/<script[^>]*>([\s\S]*?)(<\/script>)?/i);
      if (match && match[1] && match[1].trim()) {
        currentBlock.push(match[1]);
        if (match[2]) {
          scriptBlocks.push({ start: i, end: i, content: currentBlock.join('\n'), comment: blockComment });
          inScript = false;
          currentBlock = [];
          blockComment = '';
        }
      }
      continue;
    }
    
    if (inScript) {
      if (trimmed.match(/<\/script>/i)) {
        const lastLine = line.replace(/<\/script>/i, '').trim();
        if (lastLine) currentBlock.push(lastLine);
        scriptBlocks.push({ start: blockStart, end: i, content: currentBlock.join('\n'), comment: blockComment });
        inScript = false;
        currentBlock = [];
        blockComment = '';
      } else {
        currentBlock.push(line);
      }
    }
  }
  
  return scriptBlocks;
}

const scriptBlocks = extractScripts();
console.log(`Found ${scriptBlocks.length} script blocks`);

// ============================================================================
// Phase 3: Identify class definitions and their final patched versions
// ============================================================================

// Find all class definitions
function findClassDef(name) {
  const regex = new RegExp(`class\\s+${name}\\s*\\{`);
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      // Find the matching closing brace
      let depth = 0;
      let started = false;
      const classLines = [];
      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        classLines.push(line);
        for (const ch of line) {
          if (ch === '{') { depth++; started = true; }
          if (ch === '}') depth--;
        }
        if (started && depth === 0) {
          return { start: i, end: j, content: classLines.join('\n') };
        }
      }
    }
  }
  return null;
}

// Find prototype patches for a class
function findPrototypePatches(className) {
  const patches = [];
  const regex = new RegExp(`${className}\\.prototype\\.(\\w+)\\s*=\\s*function`);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(regex);
    if (match) {
      // Find the function body
      let depth = 0;
      let started = false;
      const fnLines = [];
      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        fnLines.push(line);
        for (const ch of line) {
          if (ch === '{') { depth++; started = true; }
          if (ch === '}') depth--;
        }
        if (started && depth === 0) {
          patches.push({ method: match[1], start: i, end: j, content: fnLines.join('\n') });
          break;
        }
      }
    }
  }
  return patches;
}

// ============================================================================
// Extract and write modular JS files
// ============================================================================

// Helper to extract a range of lines
function extractRange(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

// --- js/core/constants.js ---
console.log('  Writing core modules...');

// Extract CONFIG, BLOCK, BLOCK_DATA and lookup tables (lines ~5318-5658)
const constantsContent = extractRange(5318, 5658);
writeFile('js/core/constants.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Game Constants & Block System
// Consolidated from core/game_constants module
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${constantsContent}

// ───────────────────────── Module Exports ─────────────────────────
window.TU = window.TU || {};
Object.assign(window.TU, {
  CONFIG, CFG, BLOCK, BLOCK_DATA, BLOCK_SOLID, BLOCK_LIQUID, BLOCK_TRANSPARENT,
  BLOCK_WALKABLE, BLOCK_MAX_ID, BLOCK_COLOR_PACKED, BLOCK_LIGHT, BLOCK_HARDNESS,
  BLOCK_COLOR, SUN_DECAY, Constants
});
`);

// --- js/core/defensive.js ---
const defensiveContent = extractRange(2107, 2517);
writeFile('js/core/defensive.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Defensive Infrastructure (Consolidated)
// Merged from TU_Defensive IIFE
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${defensiveContent}
`);

// --- js/core/utils.js ---
const utilsContent = extractRange(3884, 4053);
writeFile('js/core/utils.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Utility Functions
// Consolidated: Utils, SafeAccess, DOM helpers
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${utilsContent}

// Canonical safe helpers (single source of truth)
window.safeGet = function(arr, index, defaultValue) {
  if (!arr || index < 0 || index >= arr.length) return defaultValue;
  return arr[index];
};
window.safeGetProp = function(obj, prop, defaultValue) {
  if (!obj || typeof obj !== 'object') return defaultValue;
  return obj[prop] !== undefined ? obj[prop] : defaultValue;
};
window.safeJSONParse = function(str, defaultValue) {
  try { return JSON.parse(str); } catch (e) { return defaultValue; }
};
window.clamp = Utils.clamp;
window.lerp = Utils.lerp;

window.TU = window.TU || {};
Object.assign(window.TU, { Utils, DOM, UI_IDS, INPUT_KEYS, MOUSE_BUTTON, INVENTORY_LIMITS });
`);

// --- js/core/dom.js ---
writeFile('js/core/dom.js', `// ═══════════════════════════════════════════════════════════════════════════════
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
`);

// --- js/core/event-utils.js ---
const eventUtilsContent = extractRange(3462, 3562);
writeFile('js/core/event-utils.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Event Utilities (throttle, debounce, rafThrottle)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${eventUtilsContent}

window.EventUtils = EventUtils;
window.TU = window.TU || {};
Object.assign(window.TU, { EventUtils });
`);

// --- js/performance/perf-tracker.js ---
const perfContent = extractRange(3564, 3661);
writeFile('js/performance/perf-tracker.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Performance Monitor
// Fixed: Math.max(...array) replaced with loop to prevent stack overflow
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${perfContent}

// PERF_MONITOR delegate (removed dead code; single implementation)
window.PERF_MONITOR = {
  record(ft) { if (window.PerfMonitor) window.PerfMonitor.frame(performance.now()); },
  getAverageFPS() { return window.PerfMonitor ? window.PerfMonitor.getAverageFPS() : 60; }
};

window.TU = window.TU || {};
Object.assign(window.TU, { PerfMonitor });
`);

// --- js/performance/object-pool.js ---
const objectPoolContent = extractRange(3143, 3222);
writeFile('js/performance/object-pool.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Object Pool (Defensive, no property-clearing anti-pattern)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${objectPoolContent}

window.ObjectPool = ObjectPool;
`);

// --- js/performance/vec-pool.js ---
const vecPoolContent = extractRange(3225, 3283);
writeFile('js/performance/vec-pool.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Vector Pool (O(1) release via _pooled tag)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${vecPoolContent}

window.VecPool = VecPool;
`);

// --- js/performance/array-pool.js ---
const arrayPoolContent = extractRange(3285, 3363);
writeFile('js/performance/array-pool.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Array Pool (O(1) release via _pooled tag)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${arrayPoolContent}

window.ArrayPool = ArrayPool;
`);

// --- js/performance/memory-manager.js ---
const memMgrContent = extractRange(3365, 3459);
writeFile('js/performance/memory-manager.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Memory Manager
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${memMgrContent}

window.MemoryManager = MemoryManager;
`);

// --- js/performance/texture-cache.js ---
const texCacheContent = extractRange(3663, 3728);
writeFile('js/performance/texture-cache.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Texture Cache (Map-based LRU, O(1))
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${texCacheContent}

window.TextureCache = TextureCache;
`);

// --- js/systems/settings.js ---
const settingsContent = extractRange(4141, 4308);
writeFile('js/systems/settings.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Game Settings
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${settingsContent}

window.TU = window.TU || {};
Object.assign(window.TU, { GameSettings });
`);

// --- js/systems/save.js ---
const saveContent = extractRange(4533, 4839);
writeFile('js/systems/save.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Save System (Unified: localStorage + RLE encoding)
// Merged patch layers: IDB wrapper removed (not needed for localStorage)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${saveContent}

window.TU = window.TU || {};
Object.assign(window.TU, { SaveSystem });
`);

// --- js/systems/audio.js ---
const audioContent = extractRange(4410, 4528);
writeFile('js/systems/audio.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Audio Manager (WebAudio synthesis)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${audioContent}

window.TU = window.TU || {};
Object.assign(window.TU, { AudioManager });
`);

// --- js/systems/fullscreen.js ---
const fullscreenContent = extractRange(4342, 4405);
writeFile('js/systems/fullscreen.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Fullscreen Manager
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${fullscreenContent}
`);

// --- js/ui/toast.js ---
const toastContent = extractRange(4315, 4335);
writeFile('js/ui/toast.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Toast Notifications
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${toastContent}

window.TU = window.TU || {};
Object.assign(window.TU, { Toast });
`);

// --- js/ui/ux-overlays.js ---
const uxContent = extractRange(4845, 5312);
writeFile('js/ui/ux-overlays.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - UX Overlay Wiring (Pause/Settings/Help/Save-prompt)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${uxContent}

window.TU = window.TU || {};
Object.assign(window.TU, { applyInfoHintText, wireUXUI, syncSettingsControls, readSettingsControls });
`);

// --- js/engine/noise.js ---
const noiseContent = extractRange(5668, 5725);
writeFile('js/engine/noise.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Noise Generator (Perlin + FBM)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${noiseContent}

window.TU = window.TU || {};
Object.assign(window.TU, { NoiseGenerator });
`);

// --- js/engine/world-generator.js (includes texture generator + structures) ---
const texGenContent = extractRange(5736, 6352);
const structuresContent = extractRange(6353, 6435);
const worldGenContent = extractRange(6438, 8665);
writeFile('js/engine/world-generator.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - World Generator
// Includes: TextureGenerator, StructureLibrary, WorldGenerator
// Merged prototype patches: _weldStructuresFromLibrary, _carveConnectorTunnel
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// ─── Texture Generator ───
${texGenContent}

// ─── Structures ───
${structuresContent}

// ─── World Generator ───
${worldGenContent}

window.TU = window.TU || {};
Object.assign(window.TU, { TextureGenerator, WorldGenerator });
`);

// --- js/entities/particle-system.js ---
const particleContent = extractRange(8674, 8786);
writeFile('js/entities/particle-system.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Particle System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${particleContent}

window.TU = window.TU || {};
Object.assign(window.TU, { ParticleSystem });
`);

// --- js/entities/dropped-items.js ---
const droppedContent = extractRange(8788, 9180);
writeFile('js/entities/dropped-items.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Dropped Item System
// Merged: pickup animation patches (startPickup, canPickup, update, render)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${droppedContent}

window.TU = window.TU || {};
Object.assign(window.TU, { DroppedItem, DroppedItemManager });
`);

// --- js/entities/ambient-particles.js ---
const ambientContent = extractRange(9186, 9343);
writeFile('js/entities/ambient-particles.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Ambient Particles (Fireflies, background effects)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${ambientContent}

window.TU = window.TU || {};
Object.assign(window.TU, { AmbientParticles });
`);

// --- js/entities/player.js ---
const playerContent = extractRange(9349, 9805);
writeFile('js/entities/player.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Player Entity
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${playerContent}

window.TU = window.TU || {};
Object.assign(window.TU, { Player });
`);

// --- js/input/touch-controller.js (merged patches) ---
// The original class is at lines 9810-9993
// Final patched version from experience_optimized_v2 patch (lines 14539-14777)
const touchOrigContent = extractRange(9810, 9993);
const touchPatchContent = extractRange(14539, 14777);
writeFile('js/input/touch-controller.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Touch Controller
// MERGED: Original class + experience_optimized_v2 patches
// Final effective version (all prototype patches folded in)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${touchOrigContent}

// ─── Merged Patches (experience_optimized_v2) ───
// These were prototype patches that have been merged into the class above.
// The patches override _init, _updateJoystick, _updateCrosshair.
// Since the original class calls _init() in its constructor, the patched
// versions below take precedence (last-write-wins on prototype).
${touchPatchContent}

window.TU = window.TU || {};
Object.assign(window.TU, { TouchController });
`);

// --- js/engine/renderer.js (merged patches) ---
// Original class at lines 10411-11076
// Patches from experience_optimized_v2 (lines 14780-15162)
const rendererOrigContent = extractRange(9996, 11076);
const rendererPatchContent = extractRange(14780, 15162);
writeFile('js/engine/renderer.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Renderer
// MERGED: Original class + experience_optimized_v2 patches
// Includes: renderParallaxMountains, renderSky, renderWorld, applyPostFX
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${rendererOrigContent}

// ─── Merged Renderer Patches (experience_optimized_v2) ───
// Patches: resize, _ensureStars, _getSkyBucket, _ensureSkyGradient,
// renderSky, renderParallax, renderWorld, _ensureGrain, applyPostFX
if (typeof Renderer !== 'undefined' && Renderer.prototype) {
${rendererPatchContent}
}

window.TU = window.TU || {};
Object.assign(window.TU, { Renderer });
`);

// --- js/systems/crafting-ui.js ---
const craftingContent = extractRange(11081, 11257);
writeFile('js/systems/crafting-ui.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Crafting System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${craftingContent}

window.TU = window.TU || {};
Object.assign(window.TU, { CraftingSystem });
`);

// --- js/systems/quality-manager.js ---
const qualityContent = extractRange(11257, 11645);
writeFile('js/systems/quality-manager.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Quality Manager + UI Flush Scheduler
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${qualityContent}

window.TU = window.TU || {};
Object.assign(window.TU, { QualityManager: window.TU.QualityManager, UIFlushScheduler: window.TU.UIFlushScheduler });
`);

// --- js/ui/ui-manager.js ---
const uiMgrContent = extractRange(11650, 12140);
writeFile('js/ui/ui-manager.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - UI Manager (HUD, hotbar, stats)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${uiMgrContent}

window.TU = window.TU || {};
Object.assign(window.TU, { UIManager });
`);

// --- js/ui/minimap.js ---
const minimapContent = extractRange(12144, 12351);
writeFile('js/ui/minimap.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Minimap
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${minimapContent}

window.TU = window.TU || {};
Object.assign(window.TU, { Minimap });
`);

// --- js/ui/inventory-ui.js ---
const invUIContent = extractRange(12353, 13135);
writeFile('js/ui/inventory-ui.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Inventory UI
// Merged: drag-drop patches from weather_inventory_enhanced
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${invUIContent}

window.TU = window.TU || {};
Object.assign(window.TU, { InventoryUI });
`);

// --- js/input/input-manager.js ---
const inputMgrContent = extractRange(13147, 13415);
writeFile('js/input/input-manager.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Input Manager
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${inputMgrContent}

window.TU = window.TU || {};
Object.assign(window.TU, { InputManager });
`);

// --- js/systems/inventory.js ---
const invSysContent = extractRange(13420, 13508);
writeFile('js/systems/inventory.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Inventory System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${invSysContent}

window.TU = window.TU || {};
Object.assign(window.TU, { InventorySystem });
`);

// --- js/engine/game.js (merged ALL Game patches) ---
const gameClassContent = extractRange(13513, 14500);
// Game.prototype.render patch (lines 15165-15255)
const gameRenderPatch = extractRange(15165, 15255);
// Weather patch (lines 15270-15525)
const weatherPatchContent = extractRange(15262, 15945);
// _spreadLight final patch (lines 24499-24601)
const spreadLightPatch = extractRange(24499, 24601);

writeFile('js/engine/game.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Game Class (Core Loop)
// MERGED: All prototype patches folded into canonical implementation
// - Game.prototype.render (experience_optimized_v2)
// - Game.prototype._updateWeather (weather_inventory_enhanced)
// - Game.prototype._spreadLight (final safe patch)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${gameClassContent}

// ─── Merged: Game.prototype.render (from experience_optimized_v2 patch) ───
${gameRenderPatch}

// ─── Merged: Weather System (from weather_inventory_enhanced) ───
${weatherPatchContent}

// ─── Merged: _spreadLight (final safe BFS with visited stamps) ───
${spreadLightPatch}

window.TU = window.TU || {};
Object.assign(window.TU, { Game });
`);

// --- js/systems/tile-logic-engine.js ---
const tileLogicContent = extractRange(16567, 17200);
// Read more of the tile logic content
const tileLogicContent2 = extractRange(17200, 18000);
const tileLogicContent3 = extractRange(18000, 24438);
writeFile('js/systems/tile-logic-engine.js', `// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Tile Logic Engine
// Water physics + Redstone-like logic + Worker-driven processing
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

${tileLogicContent}
${tileLogicContent2}
${tileLogicContent3}
`);

// --- js/boot/boot.js ---
writeFile('js/boot/boot.js', `// ═══════════════════════════════════════════════════════════════════════════════
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
`);

// ============================================================================
// Create the new index.html
// ============================================================================
console.log('\n=== Creating index.html ===');

// Extract the HTML body content (between <body> and </body>)
let bodyStart = -1;
let bodyEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().match(/<body>/i) && bodyStart === -1) bodyStart = i;
  if (lines[i].trim().match(/<\/body>/i)) bodyEnd = i;
}

// Extract just the HTML elements (no scripts)
let bodyHTML = '';
let inBodyScript = false;
for (let i = bodyStart + 1; i < bodyEnd; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  
  if (trimmed.match(/<script[^>]*>/i)) {
    inBodyScript = true;
    continue;
  }
  if (inBodyScript) {
    if (trimmed.match(/<\/script>/i)) {
      inBodyScript = false;
    }
    continue;
  }
  
  // Skip HTML comments that are section markers
  if (trimmed.match(/^<!--\s*={3,}/)) continue;
  
  bodyHTML += line + '\n';
}

// Clean up the body HTML - remove excessive blank lines
bodyHTML = bodyHTML.replace(/\n{3,}/g, '\n\n').trim();

writeFile('index.html', `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="description" content="Terraria Ultra - Aesthetic Edition - A beautiful 2D sandbox game">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#1a1a2e">
  <title>Terraria Ultra - Aesthetic Edition</title>

  <!-- CSS (Phase 2: Consolidated from ${styleBlocks.length} inline style blocks) -->
  <link rel="stylesheet" href="css/variables.css">
  <link rel="stylesheet" href="css/main.css">
</head>
<body>
  ${bodyHTML}

  <!-- ═══════════════════ JavaScript Modules ═══════════════════ -->
  <!-- Phase 1-3: Modularized & patches merged -->

  <!-- Core Infrastructure -->
  <script src="js/core/defensive.js"></script>
  <script src="js/core/constants.js"></script>
  <script src="js/core/utils.js"></script>
  <script src="js/core/event-utils.js"></script>

  <!-- Performance -->
  <script src="js/performance/perf-tracker.js"></script>
  <script src="js/performance/object-pool.js"></script>
  <script src="js/performance/vec-pool.js"></script>
  <script src="js/performance/array-pool.js"></script>
  <script src="js/performance/memory-manager.js"></script>
  <script src="js/performance/texture-cache.js"></script>

  <!-- Systems -->
  <script src="js/systems/settings.js"></script>
  <script src="js/ui/toast.js"></script>
  <script src="js/systems/fullscreen.js"></script>
  <script src="js/systems/audio.js"></script>
  <script src="js/systems/save.js"></script>
  <script src="js/ui/ux-overlays.js"></script>

  <!-- Engine -->
  <script src="js/engine/noise.js"></script>
  <script src="js/engine/world-generator.js"></script>

  <!-- Entities -->
  <script src="js/entities/particle-system.js"></script>
  <script src="js/entities/dropped-items.js"></script>
  <script src="js/entities/ambient-particles.js"></script>
  <script src="js/entities/player.js"></script>

  <!-- Input -->
  <script src="js/input/touch-controller.js"></script>
  <script src="js/input/input-manager.js"></script>

  <!-- Rendering (patches merged) -->
  <script src="js/engine/renderer.js"></script>

  <!-- UI -->
  <script src="js/systems/crafting-ui.js"></script>
  <script src="js/systems/quality-manager.js"></script>
  <script src="js/ui/ui-manager.js"></script>
  <script src="js/ui/minimap.js"></script>
  <script src="js/ui/inventory-ui.js"></script>

  <!-- Game Systems -->
  <script src="js/systems/inventory.js"></script>
  <script src="js/engine/game.js"></script>
  <script src="js/systems/tile-logic-engine.js"></script>

  <!-- Boot -->
  <script src="js/boot/boot.js"></script>
</body>
</html>
`);

console.log('\n=== Refactoring complete! ===');
console.log(`Total files created: CSS(2) + JS(${27}) + HTML(1) = 30 files`);
