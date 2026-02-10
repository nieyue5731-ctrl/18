# Behavior Changes

## Summary
This refactoring targets **100% functional equivalence** with the original `index (92).html`. All changes are structural (file organization, dead code removal, patch merging) and should not alter player-perceivable behavior.

## Changes Made

### 1. Dead Code Removal
- **RingBuffer**: Class was defined but never instantiated or referenced by game logic. Removed from active codebase (retained in extraction for reference).
- **BatchRenderer**: Defined globally but never called by Renderer or Game. Removed.
- **LazyLoader**: Defined globally but never called. Removed.
- **PERF_MONITOR**: Was a thin delegate to `PerfMonitor`. Kept as compatibility shim.

**Impact**: None. These were unreachable code paths.

### 2. CSS Consolidation
- 4 separate `:root` blocks merged into 1. Variable values preserved exactly.
- No `!important` removals in this phase (preserved for safety).

**Impact**: Visual output identical.

### 3. Patch Layer Removal
- ~10,000 lines of monkey-patch IIFEs replaced by their final effective implementations merged directly into class definitions.
- PatchManager flags (`__tu_xxx`) no longer checked at runtime since patches are pre-merged.

**Impact**: Identical runtime behavior, slightly faster initialization (no prototype chain walking).

### 4. Script Loading Order
- Scripts now load via `<script src="...">` tags in dependency order instead of inline `<script>` blocks.
- Same synchronous loading semantics maintained (no `defer`/`async`).

**Impact**: Functionally identical. May have marginally different parse timing.

## Verification Method
1. Open both versions side-by-side
2. Generate world with same seed
3. Verify: terrain, biomes, structures, lighting, player spawn position
4. Test: movement, mining, placement, crafting, inventory, save/load
5. Test: mobile touch controls, settings panel, fullscreen
6. Compare: visual rendering (sky, mountains, weather, particles)
