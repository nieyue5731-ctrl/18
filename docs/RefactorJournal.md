# Refactor Journal - Terraria Ultra Modular Refactoring

## Overview
Refactored a 24,673-line monolithic HTML file (`index (92).html`) into a modular project structure with 30+ files organized by concern.

## Phase 0: Baseline Snapshot

### Dependency Graph Summary
- **Global namespace**: `window.TU` serves as the primary namespace
- **Load order**: CSS -> Defensive IIFE -> Phase 3 modules (EventManager, ParticlePool) -> Body HTML -> Core namespace/utils -> Constants -> World Gen -> Renderer -> UI -> Game -> Patch layers -> Bootstrap
- **Side effects**: 6+ IIFEs execute at parse time, 30+ `window.` assignments
- **Key classes**: Game, Renderer, WorldGenerator, Player, TouchController, InputManager, UIManager, Minimap, CraftingSystem, InventoryUI, SaveSystem, AudioManager, GameSettings, QualityManager, TileLogicEngine

### Patch Chain End-Version Table
| Method | Original Location | Final Patch | Lines |
|--------|------------------|-------------|-------|
| `Renderer.prototype.renderSky` | ~10411 | experience_optimized_v2 | 14851 |
| `Renderer.prototype.renderWorld` | ~10411 | chunk_batch_safe_v2 | 16179 |
| `Renderer.prototype.renderParallax` | ~10411 | experience_optimized_v2 | 14973 |
| `Renderer.prototype.applyPostFX` | N/A (new) | experience_optimized_v2 | 15097 |
| `Renderer.prototype.resize` | ~10411 | experience_optimized_v2 | 14782 |
| `Game.prototype.render` | ~13513 | experience_optimized_v2 | 15166 |
| `Game.prototype._updateWeather` | N/A (new) | weather_inventory_enhanced | 15281 |
| `Game.prototype._spreadLight` | ~13513 | final_spreadlight_safe | 24510 |
| `TouchController.prototype._init` | ~9810 | experience_optimized_v2 | 14540 |
| `SaveSystem.prototype.save` | ~4533 | chunk_batch_safe_v2 | 15946 |
| `SaveSystem.prototype.markTile` | ~4533 | chunk_batch_safe_v2 | 16340 |
| `DroppedItem.prototype.update` | ~8791 | pickup_anim_safe_v2 | 16407 |
| `DroppedItemManager.prototype.update` | ~8950 | pickup_anim_safe_v2 | 16449 |
| `DroppedItemManager.prototype.render` | ~8950 | pickup_anim_safe_v2 | 16494 |

### Behavior Baseline Checklist
- [x] Page loads with loading screen
- [x] World generates with biomes/structures
- [x] Player spawns and can move (A/D/W/Space)
- [x] Mining (left click) and placement (right click)
- [x] Light propagation (BFS with visited stamps)
- [x] Water physics (TileLogicEngine worker)
- [x] UI: HUD, hotbar, stats, minimap, toast
- [x] Save/load via localStorage
- [x] Weather system (rain/snow/thunder)
- [x] Audio (WebAudio synthesis)
- [x] Mobile touch controls
- [x] Fullscreen support
- [x] Settings panel
- [x] Crafting system
- [x] Inventory management
- [x] No console errors expected

## Phase 1: Safe Cleanup

### Actions Taken
1. **Renamed** `index (92).html` -> preserved as original, new `index.html` created
2. **Dead code identified**: RingBuffer (0 references in game logic), BatchRenderer (0 references), LazyLoader (0 references), PERF_MONITOR (delegates to PerfMonitor)
3. **Utility dedup**: `clamp`/`lerp`/`safeGet`/`SafeAccess` consolidated to single canonical versions in `js/core/utils.js`
4. **VecPool.release**: Already uses `_pooled` tag (O(1)) in extracted version
5. **ArrayPool.release**: Already uses `_pooled` tag (O(1)) in extracted version
6. **PerfMonitor**: `getMinFPS()` still uses `Math.max(...validSamples)` but array is capped at 60 samples - safe
7. **Duplicate `window.TU` init blocks**: Consolidated in module pattern
8. **Global error handlers**: Single registration in defensive.js

### Evidence
- `grep -c "RingBuffer" js/` -> referenced only in its own definition file
- `grep -c "BatchRenderer" js/` -> referenced only in its own definition file  
- `grep -c "LazyLoader" js/` -> referenced only in its own definition file

## Phase 2: CSS Integration

### Actions Taken
1. Extracted 5 `<style>` blocks into CSS files
2. Merged 4 `:root` blocks into single `css/variables.css` (37 unique variables)
3. All CSS consolidated into `css/main.css` (59KB)
4. `index.html` references via `<link>` tags

## Phase 3: Monkey-Patch Merging

### Actions Taken
1. **Renderer patches merged**: All prototype overrides from `experience_optimized_v2` and `chunk_batch_safe_v2` folded into `js/engine/renderer.js`
2. **TouchController patches merged**: `_init`, `_updateJoystick`, `_updateCrosshair` from `experience_optimized_v2` included in `js/input/touch-controller.js`
3. **Game.render merged**: Final version from `experience_optimized_v2` in `js/engine/game.js`
4. **Game._updateWeather merged**: From `weather_inventory_enhanced` in `js/engine/game.js`
5. **Game._spreadLight merged**: Final safe BFS version in `js/engine/game.js`
6. **SaveSystem patches merged**: `save`, `markTile`, `importLoaded` wrappers from chunk_batch_safe_v2
7. **DroppedItem/Manager patches merged**: Pickup animation from pickup_anim_safe_v2
8. **TileLogicEngine**: Full water physics + logic engine in `js/systems/tile-logic-engine.js`
9. **PatchManager**: Retained in utils but no longer needed for runtime patching

## Phase 4-5: Data Structure & Rendering Notes

### World Data
- Current: `world.tiles[x][y]` (Array of Arrays)
- Block lookup tables already use TypedArrays: `BLOCK_SOLID`, `BLOCK_TRANSPARENT`, `BLOCK_LIQUID`, `BLOCK_LIGHT`, `BLOCK_HARDNESS` (Uint8Array/Float32Array)
- `BLOCK_COLOR_PACKED` uses Uint32Array for minimap
- Light BFS uses `Uint32Array` visited stamps (already optimized)
- TileLogicEngine flattens to `Uint8Array` for worker communication

### Rendering Optimizations Present
- Sky gradient caching (`_skyGrad`, `_skyBucket`)
- Star pre-generation and caching
- Chunk-based tile batching (`__cb2_*` system)
- Texture cache with LRU eviction (Map-based O(1))
- PostFX with conditional bloom/vignette/grain
- Near-black tile skip optimization
- Resolution scaling for performance

## Phase 6-8: Architecture & HTML

### File Structure (Final)
```
index.html              - Clean HTML5 document
css/
  variables.css         - CSS custom properties
  main.css             - All styles consolidated
js/
  core/                - Constants, utils, defensive
  systems/             - Settings, save, audio, crafting, quality
  engine/              - Game, renderer, noise, world-gen
  entities/            - Player, particles, dropped items
  ui/                  - Toast, HUD, minimap, inventory
  input/               - Input manager, touch controller
  performance/         - Pools, caches, perf monitoring
  boot/                - Bootstrap & health check
docs/                  - Documentation
scripts/               - Build/refactor tooling
```
