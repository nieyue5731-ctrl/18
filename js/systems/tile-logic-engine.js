// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Tile Logic Engine
// Water physics + Redstone-like logic + Worker-driven processing
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

                            <!-- ========================= PATCH: patch/script_35 ========================= -->
                            <script>
                                /* =====================================================================
                                   v12: TileLogic Refactor (UpdateTick observer pattern) + Fluids + Logic
                                   - Water "pressure-ish" flow (down + side equalization)
                                   - Redstone-like power propagation (wire/switch/lamp)
                                   - Logic runs in Web Worker; main thread applies diffs in requestIdleCallback
                                   - If Worker is unavailable/blocked, falls back to requestIdleCallback simulation
                                ===================================================================== */
                                (() => {
                                    const TU = window.TU || (window.TU = {});
                                    if (TU.__tileLogicV12) return;
                                    TU.__tileLogicV12 = true;

                                    const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : (TU.CONFIG || { TILE_SIZE: 16, REACH_DISTANCE: 6 });
                                    const B = (typeof BLOCK !== 'undefined') ? BLOCK : (TU.BLOCK || {});
                                    const BD = (typeof BLOCK_DATA !== 'undefined') ? BLOCK_DATA : (TU.BLOCK_DATA || {});
                                    const SOLID = (typeof BLOCK_SOLID !== 'undefined') ? BLOCK_SOLID : (TU.BLOCK_SOLID || new Uint8Array(256));
                                    const LIQ = (typeof BLOCK_LIQUID !== 'undefined') ? BLOCK_LIQUID : (TU.BLOCK_LIQUID || new Uint8Array(256));
                                    const TRANSP = (typeof BLOCK_TRANSPARENT !== 'undefined') ? BLOCK_TRANSPARENT : (TU.BLOCK_TRANSPARENT || new Uint8Array(256));
                                    const WALK = (typeof BLOCK_WALKABLE !== 'undefined') ? BLOCK_WALKABLE : (TU.BLOCK_WALKABLE || new Uint8Array(256));
                                    const BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : null;
                                    const BH = (typeof BLOCK_HARDNESS !== 'undefined') ? BLOCK_HARDNESS : null;
                                    const BC = (typeof BLOCK_COLOR !== 'undefined') ? BLOCK_COLOR : null;
                                    const BCP = (typeof BLOCK_COLOR_PACKED !== 'undefined') ? BLOCK_COLOR_PACKED : null;
                                    const SD = (typeof SUN_DECAY !== 'undefined') ? SUN_DECAY : null;

                                    const IDS = {
                                        WIRE_OFF: 200,
                                        WIRE_ON: 201,
                                        SWITCH_OFF: 202,
                                        SWITCH_ON: 203,
                                        LAMP_OFF: 204,
                                        LAMP_ON: 205
                                    };
                                    TU.LOGIC_BLOCKS = IDS;

                                    // ─────────────────────────────────────────────────────────────
                                    // 1) Register new blocks into BLOCK_DATA + lookup tables
                                    // ─────────────────────────────────────────────────────────────
                                    function _hexToPacked(c) {
                                        try {
                                            if (typeof c === 'string' && c.length === 7 && c[0] === '#') {
                                                const r = parseInt(c.slice(1, 3), 16) | 0;
                                                const g = parseInt(c.slice(3, 5), 16) | 0;
                                                const b = parseInt(c.slice(5, 7), 16) | 0;
                                                return ((r << 16) | (g << 8) | b) >>> 0;
                                            }
                                        } catch { }
                                        return ((240 << 16) | (15 << 8) | 0) >>> 0;
                                    }

                                    function addBlock(id, def) {
                                        BD[id] = def;
                                        try { SOLID[id] = def.solid ? 1 : 0; } catch { }
                                        try { TRANSP[id] = def.transparent ? 1 : 0; } catch { }
                                        try { LIQ[id] = def.liquid ? 1 : 0; } catch { }
                                        try { if (BL) BL[id] = def.light ? (def.light | 0) : 0; } catch { }
                                        try { if (BH) BH[id] = def.hardness ? +def.hardness : 0; } catch { }
                                        try { if (BC) BC[id] = def.color; } catch { }
                                        try {
                                            if (SD) {
                                                const AIR = (B && B.AIR !== undefined) ? B.AIR : 0;
                                                let v = 0;
                                                if (def.solid && !def.transparent) v = 3;
                                                else if (def.transparent && id !== AIR) v = 1;
                                                SD[id] = v;
                                            }
                                        } catch { }
                                        try { if (BCP) BCP[id] = _hexToPacked(def.color); } catch { }
                                        try { if (WALK) WALK[id] = def.solid ? 0 : 1; } catch { }
                                    }

                                    function ensureBlocks() {
                                        if (BD[IDS.WIRE_OFF]) return; // already added
                                        addBlock(IDS.WIRE_OFF, { name: '逻辑线', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.2, color: '#7f1d1d' });
                                        addBlock(IDS.WIRE_ON, { name: '逻辑线(通电)', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.2, color: '#ff4d4d' });
                                        addBlock(IDS.SWITCH_OFF, { name: '开关', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.4, color: '#8b5e3c' });
                                        addBlock(IDS.SWITCH_ON, { name: '开关(开启)', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.4, color: '#d4a373' });

                                        // LAMP_ON: light>5 会进入 glow 绘制路径；数量通常不大。想更省就把 light <= 5。
                                        addBlock(IDS.LAMP_OFF, { name: '逻辑灯', solid: true, transparent: false, liquid: false, light: 0, hardness: 1.0, color: '#444444' });
                                        addBlock(IDS.LAMP_ON, { name: '逻辑灯(亮)', solid: true, transparent: false, liquid: false, light: 10, hardness: 1.0, color: '#ffe8a3' });
                                    }
                                    try { ensureBlocks(); } catch (e) { console.warn('ensureBlocks failed', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 2) TextureGenerator: custom pixel art for logic blocks
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof TextureGenerator !== 'undefined' && TextureGenerator.prototype && !TextureGenerator.prototype.__logicV12Patched) {
                                            TextureGenerator.prototype.__logicV12Patched = true;
                                            const _old = TextureGenerator.prototype._drawPixelArt;

                                            TextureGenerator.prototype._drawPixelArt = function (ctx, id, data) {
                                                const s = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;

                                                if (id === IDS.WIRE_OFF || id === IDS.WIRE_ON) {
                                                    ctx.clearRect(0, 0, s, s);
                                                    const col = (id === IDS.WIRE_ON) ? '#ff4d4d' : '#7f1d1d';
                                                    ctx.fillStyle = col;
                                                    ctx.fillRect(0, (s / 2) | 0, s, 2);
                                                    ctx.fillRect((s / 2) | 0, 0, 2, s);
                                                    ctx.fillStyle = (id === IDS.WIRE_ON) ? '#ffd6d6' : '#3b0a0a';
                                                    ctx.fillRect(((s / 2) | 0) - 1, ((s / 2) | 0) - 1, 4, 4);
                                                    return;
                                                }

                                                if (id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON) {
                                                    ctx.clearRect(0, 0, s, s);
                                                    ctx.fillStyle = '#5b3a29';
                                                    ctx.fillRect(3, 10, s - 6, 4);
                                                    ctx.fillStyle = '#2b1a12';
                                                    ctx.fillRect(3, 14, s - 6, 1);

                                                    const on = (id === IDS.SWITCH_ON);
                                                    ctx.fillStyle = '#c9a227';
                                                    if (on) {
                                                        ctx.fillRect(9, 4, 2, 8);
                                                        ctx.fillRect(8, 4, 4, 2);
                                                    } else {
                                                        ctx.fillRect(5, 6, 8, 2);
                                                        ctx.fillRect(11, 4, 2, 8);
                                                    }
                                                    ctx.fillStyle = on ? '#ffe08a' : '#d8c9a8';
                                                    ctx.fillRect(on ? 8 : 11, on ? 2 : 11, 4, 4);
                                                    return;
                                                }

                                                if (id === IDS.LAMP_OFF || id === IDS.LAMP_ON) {
                                                    const on = (id === IDS.LAMP_ON);
                                                    ctx.fillStyle = '#2f2f2f';
                                                    ctx.fillRect(0, 0, s, s);
                                                    ctx.fillStyle = '#3a3a3a';
                                                    ctx.fillRect(1, 1, s - 2, s - 2);
                                                    ctx.fillStyle = on ? '#ffe8a3' : '#555555';
                                                    ctx.fillRect(3, 3, s - 6, s - 6);
                                                    ctx.fillStyle = on ? '#fff6d6' : '#777777';
                                                    ctx.fillRect(4, 4, 3, 3);
                                                    ctx.fillStyle = on ? '#d8b54a' : '#333333';
                                                    ctx.fillRect(3, (s / 2) | 0, s - 6, 1);
                                                    ctx.fillRect((s / 2) | 0, 3, 1, s - 6);
                                                    return;
                                                }

                                                return _old.call(this, ctx, id, data);
                                            };
                                        }
                                    } catch (e) {
                                        console.warn('logic textures patch failed', e);
                                    }

                                    // ─────────────────────────────────────────────────────────────
                                    // 3) Recipes + starter items (idempotent)
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof RECIPES !== 'undefined' && RECIPES && !RECIPES.__logicV12Added) {
                                            RECIPES.__logicV12Added = true;
                                            RECIPES.push(
                                                { out: IDS.WIRE_OFF, count: 12, req: [{ id: B.IRON_ORE, count: 1 }], desc: '基础逻辑导线（传导电力）。' },
                                                { out: IDS.SWITCH_OFF, count: 1, req: [{ id: B.WOOD, count: 1 }, { id: IDS.WIRE_OFF, count: 2 }], desc: '开关：对准并“右键 + 镐”切换开/关。' },
                                                { out: IDS.LAMP_OFF, count: 1, req: [{ id: B.GLASS, count: 1 }, { id: IDS.WIRE_OFF, count: 2 }], desc: '逻辑灯：与通电导线相邻时点亮。' }
                                            );
                                        }
                                    } catch { }

                                    // ─────────────────────────────────────────────────────────────
                                    // 4) Drop remap: ON-state drops OFF-state
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof DroppedItemManager !== 'undefined' && DroppedItemManager.prototype && !DroppedItemManager.prototype.__logicV12DropPatch) {
                                            DroppedItemManager.prototype.__logicV12DropPatch = true;
                                            const _spawn = DroppedItemManager.prototype.spawn;
                                            DroppedItemManager.prototype.spawn = function (x, y, blockId, count) {
                                                if (blockId === IDS.WIRE_ON) blockId = IDS.WIRE_OFF;
                                                else if (blockId === IDS.SWITCH_ON) blockId = IDS.SWITCH_OFF;
                                                else if (blockId === IDS.LAMP_ON) blockId = IDS.LAMP_OFF;
                                                return _spawn.call(this, x, y, blockId, count);
                                            };
                                        }
                                    } catch { }

                                    // ─────────────────────────────────────────────────────────────
                                    // 5) TileLogicEngine: Worker-driven + idle apply
                                    // ─────────────────────────────────────────────────────────────
                                    const ric = (typeof requestIdleCallback !== 'undefined')
                                        ? requestIdleCallback.bind(window)
                                        : (cb, opts) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), (opts && opts.timeout) ? opts.timeout : 0);

                                    class TileLogicEngine {
                                        constructor(game) {
                                            this.game = game;
                                            this.world = game.world;
                                            this.w = this.world.w | 0;
                                            this.h = this.world.h | 0;

                                            this.worker = null;
                                            this.pending = []; // { arr:Int32Array, pos:number }
                                            this._applyScheduled = false;

                                            this._lastRegionSent = 0;
                                            this._lastPerfSent = '';
                                            this._minimapDirty = false;
                                            this._lastMinimapFlush = 0;
                                            this._enabled = true;

                                            this._idle = null; // fallback state
                                            this._initWorker();
                                        }

                                        _flattenTiles() {
                                            const out = new Uint8Array(this.w * this.h);
                                            for (let x = 0; x < this.w; x++) out.set(this.world.tiles[x], x * this.h);
                                            return out;
                                        }

                                        _initWorker() {
                                            if (typeof Worker === 'undefined') {
                                                console.warn('Worker not available; TileLogicEngine uses idle fallback');
                                                this._initIdleFallback();
                                                return;
                                            }

                                            const code = TileLogicEngine._workerSource();
                                            const blob = new Blob([code], { type: 'text/javascript' });
                                            const url = URL.createObjectURL(blob);

                                            let worker;
                                            try {
                                                worker = new Worker(url);
                                            } catch (e) {
                                                console.warn('Worker blocked; fallback to idle', e);
                                                try { URL.revokeObjectURL(url); } catch { }
                                                this._initIdleFallback();
                                                return;
                                            }

                                            try { URL.revokeObjectURL(url); } catch { }

                                            this.worker = worker;

                                            worker.onmessage = (e) => {
                                                const msg = e.data;
                                                if (!msg || !msg.type) return;
                                                if (msg.type === 'changes' && msg.buf) {
                                                    try {
                                                        const arr = new Int32Array(msg.buf);
                                                        this.pending.push({ arr, pos: 0 });
                                                        this._scheduleApply();
                                                    } catch { }
                                                }
                                            };

                                            worker.onerror = (e) => {
                                                console.warn('TileLogic worker error', e);
                                                try { worker.terminate(); } catch { }
                                                this.worker = null;
                                                this._initIdleFallback();
                                            };

                                            try {
                                                const tilesFlat = this._flattenTiles();
                                                const solidCopy = new Uint8Array(256);
                                                try { solidCopy.set(SOLID); } catch { }
                                                worker.postMessage({
                                                    type: 'init',
                                                    w: this.w,
                                                    h: this.h,
                                                    tiles: tilesFlat.buffer,
                                                    solid: solidCopy.buffer,
                                                    ids: IDS,
                                                    blocks: { AIR: (B && B.AIR !== undefined) ? B.AIR : 0, WATER: (B && B.WATER !== undefined) ? B.WATER : 27 }
                                                }, [tilesFlat.buffer, solidCopy.buffer]);
                                            } catch (e) {
                                                console.warn('TileLogic worker init failed', e);
                                            }
                                        }

                                        _initIdleFallback() {
                                            // Full idle fallback: water + logic, both processed during requestIdleCallback.
                                            const tiles = this._flattenTiles();
                                            const N = tiles.length;

                                            const WATER = (B && B.WATER !== undefined) ? B.WATER : 27;
                                            const AIR = (B && B.AIR !== undefined) ? B.AIR : 0;
                                            const MAX = 8;

                                            const water = new Uint8Array(N);
                                            for (let i = 0; i < N; i++) if (tiles[i] === WATER) water[i] = MAX;

                                            const waterMark = new Uint8Array(N);
                                            const waterQ = [];
                                            const logicMark = new Uint8Array(N);
                                            const logicQ = [];

                                            // Region limiter for main-thread fallback (protect FPS)
                                            const region = { x0: 0, y0: 0, x1: -1, y1: -1, set: false, key: '' };

                                            const inRegionIndex = (i) => {
                                                if (!region.set) return false;
                                                const x = (i / this.h) | 0;
                                                const y = i - x * this.h;
                                                return (x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1);
                                            };

                                            const idx = (x, y) => x * this.h + y;

                                            const scheduleWater = (i) => {
                                                if (!inRegionIndex(i)) return;
                                                if (waterMark[i]) return;
                                                waterMark[i] = 1;
                                                waterQ.push(i);
                                            };
                                            const scheduleWaterAround = (x, y) => {
                                                if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
                                                scheduleWater(idx(x, y));
                                                if (x > 0) scheduleWater(idx(x - 1, y));
                                                if (x + 1 < this.w) scheduleWater(idx(x + 1, y));
                                                if (y > 0) scheduleWater(idx(x, y - 1));
                                                if (y + 1 < this.h) scheduleWater(idx(x, y + 1));
                                            };

                                            const scheduleLogic = (i) => {
                                                if (!inRegionIndex(i)) return;
                                                if (logicMark[i]) return;
                                                logicMark[i] = 1;
                                                logicQ.push(i);
                                            };
                                            const scheduleLogicAround = (x, y) => {
                                                if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
                                                scheduleLogic(idx(x, y));
                                                if (x > 0) scheduleLogic(idx(x - 1, y));
                                                if (x + 1 < this.w) scheduleLogic(idx(x + 1, y));
                                                if (y > 0) scheduleLogic(idx(x, y - 1));
                                                if (y + 1 < this.h) scheduleLogic(idx(x, y + 1));
                                            };

                                            const isWire = (id) => id === IDS.WIRE_OFF || id === IDS.WIRE_ON;
                                            const isSwitch = (id) => id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON;
                                            const isSource = (id) => id === IDS.SWITCH_ON;
                                            const isLamp = (id) => id === IDS.LAMP_OFF || id === IDS.LAMP_ON;
                                            const isConductor = (id) => isWire(id) || isSwitch(id);

                                            const canWaterEnterTile = (id) => (id === AIR || id === WATER);

                                            const setTile = (i, newId, changes) => {
                                                const old = tiles[i];
                                                if (old === newId) return false;
                                                tiles[i] = newId;
                                                changes.push(i, old, newId);
                                                const x = (i / this.h) | 0;
                                                const y = i - x * this.h;
                                                scheduleWaterAround(x, y);
                                                scheduleLogicAround(x, y);
                                                return true;
                                            };

                                            const ensureWaterTile = (i, changes) => {
                                                if (water[i] > 0) {
                                                    if (tiles[i] !== WATER) setTile(i, WATER, changes);
                                                } else {
                                                    if (tiles[i] === WATER) setTile(i, AIR, changes);
                                                }
                                            };

                                            const waterTick = (i, changes) => {
                                                waterMark[i] = 0;
                                                if (!inRegionIndex(i)) return;

                                                let a = water[i] | 0;
                                                if (a <= 0) return;

                                                const tid = tiles[i];
                                                if (tid !== WATER && tid !== AIR) { water[i] = 0; return; }

                                                const x = (i / this.h) | 0;
                                                const y = i - x * this.h;

                                                if (y + 1 < this.h) {
                                                    const d = i + 1;
                                                    const dt = tiles[d];
                                                    if (canWaterEnterTile(dt)) {
                                                        const b = water[d] | 0;
                                                        const space = MAX - b;
                                                        if (space > 0) {
                                                            const mv = a < space ? a : space;
                                                            water[i] = a - mv;
                                                            water[d] = b + mv;
                                                            a = water[i] | 0;

                                                            ensureWaterTile(i, changes);
                                                            ensureWaterTile(d, changes);

                                                            scheduleWater(d);
                                                            scheduleWater(i);
                                                            scheduleWaterAround(x, y);
                                                            scheduleWaterAround(x, y + 1);
                                                        }
                                                    }
                                                }

                                                if (a <= 0) return;

                                                const flowSide = (n) => {
                                                    const nt = tiles[n];
                                                    if (!canWaterEnterTile(nt)) return;
                                                    const nb = water[n] | 0;
                                                    const diff = a - nb;
                                                    if (diff <= 1) return;
                                                    let mv = diff >> 1;
                                                    if (mv < 1) mv = 1;
                                                    const space = MAX - nb;
                                                    if (mv > space) mv = space;
                                                    if (mv <= 0) return;

                                                    water[i] = (water[i] | 0) - mv;
                                                    water[n] = nb + mv;
                                                    a = water[i] | 0;

                                                    ensureWaterTile(i, changes);
                                                    ensureWaterTile(n, changes);

                                                    scheduleWater(n);
                                                    scheduleWater(i);
                                                };

                                                if (x > 0) flowSide(i - this.h);
                                                if (x + 1 < this.w) flowSide(i + this.h);
                                            };

                                            // logic BFS bookkeeping
                                            let vis = new Uint32Array(N);
                                            let stamp = 1;

                                            const lampShouldOn = (iLamp) => {
                                                const x = (iLamp / this.h) | 0;
                                                const y = iLamp - x * this.h;
                                                if (x > 0) { const t = tiles[iLamp - this.h]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
                                                if (x + 1 < this.w) { const t = tiles[iLamp + this.h]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
                                                if (y > 0) { const t = tiles[iLamp - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
                                                if (y + 1 < this.h) { const t = tiles[iLamp + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
                                                return false;
                                            };

                                            const updateLampAt = (iLamp, changes) => {
                                                const t = tiles[iLamp];
                                                if (!isLamp(t)) return;
                                                const want = lampShouldOn(iLamp) ? IDS.LAMP_ON : IDS.LAMP_OFF;
                                                if (t !== want) setTile(iLamp, want, changes);
                                            };

                                            const logicRecomputeFromSeed = (seed, changes) => {
                                                logicMark[seed] = 0;

                                                stamp = (stamp + 1) >>> 0;
                                                if (stamp === 0) { stamp = 1; vis.fill(0); }

                                                const starts = [];
                                                const sid = tiles[seed];
                                                if (isConductor(sid)) starts.push(seed);
                                                else {
                                                    const x = (seed / this.h) | 0;
                                                    const y = seed - x * this.h;
                                                    if (x > 0) { const n = seed - this.h; if (isConductor(tiles[n])) starts.push(n); }
                                                    if (x + 1 < this.w) { const n = seed + this.h; if (isConductor(tiles[n])) starts.push(n); }
                                                    if (y > 0) { const n = seed - 1; if (isConductor(tiles[n])) starts.push(n); }
                                                    if (y + 1 < this.h) { const n = seed + 1; if (isConductor(tiles[n])) starts.push(n); }
                                                    if (isLamp(sid)) updateLampAt(seed, changes);
                                                }
                                                if (!starts.length) return;

                                                const q = [];
                                                const comp = [];
                                                let powered = false;

                                                for (let si = 0; si < starts.length; si++) {
                                                    const s = starts[si];
                                                    if (vis[s] === stamp) continue;
                                                    vis[s] = stamp;
                                                    q.push(s);

                                                    while (q.length) {
                                                        const i = q.pop();
                                                        const t = tiles[i];
                                                        if (!isConductor(t)) continue;

                                                        comp.push(i);
                                                        if (isSource(t)) powered = true;

                                                        const x = (i / this.h) | 0;
                                                        const y = i - x * this.h;

                                                        if (x > 0) { const n = i - this.h; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
                                                        if (x + 1 < this.w) { const n = i + this.h; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
                                                        if (y > 0) { const n = i - 1; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
                                                        if (y + 1 < this.h) { const n = i + 1; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }

                                                        if (comp.length > 12000) break;
                                                    }
                                                    if (comp.length > 12000) break;
                                                }

                                                const wantWire = powered ? IDS.WIRE_ON : IDS.WIRE_OFF;

                                                for (let i = 0; i < comp.length; i++) {
                                                    const p = comp[i];
                                                    const t = tiles[p];
                                                    if (isWire(t) && t !== wantWire) setTile(p, wantWire, changes);
                                                }

                                                for (let i = 0; i < comp.length; i++) {
                                                    const p = comp[i];
                                                    const x = (p / this.h) | 0;
                                                    const y = p - x * this.h;
                                                    if (x > 0) updateLampAt(p - this.h, changes);
                                                    if (x + 1 < this.w) updateLampAt(p + this.h, changes);
                                                    if (y > 0) updateLampAt(p - 1, changes);
                                                    if (y + 1 < this.h) updateLampAt(p + 1, changes);
                                                }
                                            };

                                            const primeRegion = () => {
                                                if (!region.set) return;
                                                for (let x = region.x0; x <= region.x1; x++) {
                                                    const base = x * this.h;
                                                    for (let y = region.y0; y <= region.y1; y++) {
                                                        const i = base + y;
                                                        if (water[i] > 0) scheduleWater(i);
                                                        const t = tiles[i];
                                                        if (t === IDS.SWITCH_ON || isWire(t) || isLamp(t)) scheduleLogic(i);
                                                    }
                                                }
                                            };

                                            // store fallback state
                                            this._idle = {
                                                tiles, water, waterMark, waterQ,
                                                logicMark, logicQ,
                                                region,
                                                idx, scheduleWaterAround, scheduleLogicAround,
                                                setTile, primeRegion,
                                                waterTick, logicRecomputeFromSeed,
                                                perfLevel: 'high',
                                                WATER, AIR
                                            };

                                            const step = (deadline) => {
                                                if (!this._enabled || !this._idle) return;

                                                const st = this._idle;
                                                const changes = [];

                                                const waterBudget = (st.perfLevel === 'low') ? 220 : 520;
                                                const logicBudget = 1;

                                                let ops = 0;
                                                while (ops < waterBudget && st.waterQ.length && (deadline.timeRemaining() > 1 || deadline.didTimeout)) {
                                                    const i = st.waterQ.pop();
                                                    st.waterTick(i, changes);
                                                    ops++;
                                                }

                                                let lops = 0;
                                                while (lops < logicBudget && st.logicQ.length && (deadline.timeRemaining() > 1 || deadline.didTimeout)) {
                                                    const i = st.logicQ.pop();
                                                    st.logicRecomputeFromSeed(i, changes);
                                                    lops++;
                                                }

                                                if (changes.length) {
                                                    this.pending.push({ arr: new Int32Array(changes), pos: 0 });
                                                    this._scheduleApply();
                                                }

                                                ric(step, { timeout: 50 });
                                            };

                                            ric(step, { timeout: 50 });
                                        }

                                        notifyTileWrite(x, y, newId) {
                                            if (!this._enabled) return;

                                            if (this.worker) {
                                                try { this.worker.postMessage({ type: 'tileWrite', x: x | 0, y: y | 0, id: newId | 0 }); } catch { }
                                                return;
                                            }

                                            if (!this._idle) return;
                                            const st = this._idle;

                                            const idx = (x | 0) * this.h + (y | 0);
                                            const old = st.tiles[idx];
                                            st.tiles[idx] = newId | 0;

                                            if (newId === st.WATER) st.water[idx] = 8;
                                            if (old === st.WATER && newId !== st.WATER) st.water[idx] = 0;

                                            st.scheduleWaterAround(x, y);
                                            st.scheduleLogicAround(x, y);
                                        }

                                        onFrame(dt) {
                                            // 防御性参数检查
                                            if (typeof dt !== 'number' || dt < 0) {
                                                console.warn(`[TileLogicEngine.onFrame] Invalid dt: ${dt}`);
                                                dt = 16.67;
                                            }

                                            if (!this._enabled) return;

                                            // 防御性：检查game和world
                                            if (!this.game || !this.game.world) {
                                                console.warn('[TileLogicEngine.onFrame] Game/World not available');
                                                return;
                                            }

                                            const now = performance.now();

                                            if (this.worker) {
                                                if (now - this._lastRegionSent > 250) {
                                                    this._lastRegionSent = now;
                                                    try {
                                                        const px = (this.game.player.x / CFG.TILE_SIZE) | 0;
                                                        const py = (this.game.player.y / CFG.TILE_SIZE) | 0;
                                                        this.worker.postMessage({ type: 'region', cx: px, cy: py, rx: 60, ry: 45 });
                                                    } catch { }
                                                }

                                                const lvl = (this.game._perf && this.game._perf.level) ? this.game._perf.level : 'high';
                                                if (lvl !== this._lastPerfSent) {
                                                    this._lastPerfSent = lvl;
                                                    try { this.worker.postMessage({ type: 'perf', level: lvl }); } catch { }
                                                }
                                                }
                                                return;
                                            }

                                            // idle fallback: update region & perf
                                            if (this._idle && (now - this._lastRegionSent > 350)) {
                                                this._lastRegionSent = now;
                                                const st = this._idle;

                                                const px = (this.game.player.x / CFG.TILE_SIZE) | 0;
                                                const py = (this.game.player.y / CFG.TILE_SIZE) | 0;
                                                const rx = 60, ry = 45;

                                                const x0 = Math.max(0, px - rx);
                                                const x1 = Math.min(this.w - 1, px + rx);
                                                const y0 = Math.max(0, py - ry);
                                                const y1 = Math.min(this.h - 1, py + ry);

                                                const key = x0 + ',' + y0 + ',' + x1 + ',' + y1;
                                                if (key !== st.region.key) {
                                                    st.region.key = key;
                                                    st.region.x0 = x0; st.region.x1 = x1; st.region.y0 = y0; st.region.y1 = y1; st.region.set = true;
                                                    st.primeRegion();
                                                } else {
                                                    st.region.set = true;
                                                }

                                                const lvl = (this.game._perf && this.game._perf.level) ? this.game._perf.level : 'high';
                                                st.perfLevel = lvl;
                                            }
                                        }

                                        _scheduleApply() {
                                            if (this._applyScheduled) return;
                                            this._applyScheduled = true;
                                            ric((deadline) => this._applyPending(deadline), { timeout: 50 });
                                        }

                                        _applyPending(deadline) {
                                            // 防御性参数检查
                                            if (!deadline) {
                                                console.warn('[TileLogicEngine._applyPending] No deadline provided');
                                                deadline = { timeRemaining: () => 16, didTimeout: false };
                                            }

                                            this._applyScheduled = false;
                                            if (!this.pending || !this.pending.length) return;

                                            // 防御性：检查game和world
                                            if (!this.game || !this.game.world) {
                                                console.warn('[TileLogicEngine._applyPending] Game/World not available');
                                                return;
                                            }

                                            const game = this.game;
                                            const world = this.world;
                                            const renderer = game && game.renderer;

                                            let any = false;
                                            let lightSeeds = [];
                                            const maxLightSeeds = 16;

                                            const maxOps = 1600;
                                            let ops = 0;

                                            while (this.pending.length && (deadline.timeRemaining() > 2 || deadline.didTimeout) && ops < maxOps) {
                                                const cur = this.pending[0];
                                                const arr = cur.arr;

                                                while (cur.pos < arr.length && ops < maxOps) {
                                                    const idx = arr[cur.pos++];
                                                    const expectOld = arr[cur.pos++];
                                                    const newId = arr[cur.pos++];

                                                    const x = (idx / this.h) | 0;
                                                    const y = idx - x * this.h;
                                                    if (x < 0 || y < 0 || x >= this.w || y >= this.h) { ops++; continue; }

                                                    const col = world.tiles[x];
                                                    const oldMain = col[y];
                                                    if (oldMain !== expectOld) { ops++; continue; } // stale -> ignore

                                                    col[y] = newId;
                                                    any = true;

                                                    try { renderer && renderer.invalidateTile && renderer.invalidateTile(x, y); } catch { }

                                                    if (BL) {
                                                        const blOld = BL[expectOld] | 0;
                                                        const blNew = BL[newId] | 0;
                                                        if (blOld !== blNew && lightSeeds.length < maxLightSeeds) lightSeeds.push([x, y]);
                                                    }

                                                    this._minimapDirty = true;

                                                    ops++;
                                                }

                                                if (cur.pos >= arr.length) this.pending.shift();
                                                else break;
                                            }

                                            if (any) {
                                                if (lightSeeds.length && game && game._deferLightUpdate) {
                                                    for (let i = 0; i < lightSeeds.length; i++) {
                                                        const p = lightSeeds[i];
                                                        try { game._deferLightUpdate(p[0], p[1]); } catch { }
                                                    }
                                                }

                                                const now = performance.now();
                                                if (this._minimapDirty && (now - this._lastMinimapFlush > 600)) {
                                                    this._minimapDirty = false;
                                                    this._lastMinimapFlush = now;
                                                    try { game._deferMinimapUpdate && game._deferMinimapUpdate(); } catch { }
                                                }
                                            }

                                            if (this.pending.length) this._scheduleApply();
                                        }

                                        static _workerSource() {
                                            return `/* TileLogic Worker v12 */
(() => {
  let W = 0, H = 0;
  let tiles = null;
  let water = null;
  let solid = null;

  let AIR = 0, WATER = 27;
  let IDS = null;

  const region = { x0: 0, y0: 0, x1: -1, y1: -1, set: false };
  let lastRegionKey = '';
  let perfLevel = 'high';
  const MAX = 8;

  const waterQ = [];
  let waterMark = null;
  const logicQ = [];
  let logicMark = null;
function scheduleLogic(i) {
    if (!logicMark) return;
    if (!inRegionIndex(i)) return;
    if (logicMark[i]) return;
    logicMark[i] = 1;
    logicQ.push(i);
  }

  function scheduleLogicAround(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    scheduleLogic(idx(x, y));
    if (x > 0) scheduleLogic(idx(x - 1, y));
    if (x + 1 < W) scheduleLogic(idx(x + 1, y));
    if (y > 0) scheduleLogic(idx(x, y - 1));
    if (y + 1 < H) scheduleLogic(idx(x, y + 1));
  }

  function setTile(i, newId, changes) {
    const old = tiles[i];
    if (old === newId) return false;
    tiles[i] = newId;
    changes.push(i, old, newId);
    const x = (i / H) | 0;
    const y = i - x * H;
    scheduleWaterAround(x, y);
    scheduleLogicAround(x, y);
    return true;
  }

  function ensureWaterTile(i, changes) {
    if (water[i] > 0) {
      if (tiles[i] !== WATER) setTile(i, WATER, changes);
    } else {
      if (tiles[i] === WATER) setTile(i, AIR, changes);
    }
  }

  function waterTick(i, changes) {
    waterMark[i] = 0;
    if (!inRegionIndex(i)) return;

    let a = water[i] | 0;
    if (a <= 0) return;

    const tid = tiles[i];
    if (tid !== WATER && tid !== AIR) { water[i] = 0; return; }

    const x = (i / H) | 0;
    const y = i - x * H;

    if (y + 1 < H) {
      const d = i + 1;
      const dt = tiles[d];
      if (canWaterEnterTile(dt)) {
        const b = water[d] | 0;
        const space = MAX - b;
        if (space > 0) {
          const mv = a < space ? a : space;
          water[i] = a - mv;
          water[d] = b + mv;
          a = water[i] | 0;

          ensureWaterTile(i, changes);
          ensureWaterTile(d, changes);

          scheduleWater(d);
          scheduleWater(i);
          scheduleWaterAround(x, y);
          scheduleWaterAround(x, y + 1);
        }
      }
    }

    if (a <= 0) return;

    function flowSide(n) {
      const nt = tiles[n];
      if (!canWaterEnterTile(nt)) return;
      const nb = water[n] | 0;
      const diff = a - nb;
      if (diff <= 1) return;
      let mv = diff >> 1;
      if (mv < 1) mv = 1;
      const space = MAX - nb;
      if (mv > space) mv = space;
      if (mv <= 0) return;

      water[i] = (water[i] | 0) - mv;
      water[n] = nb + mv;
      a = water[i] | 0;

      ensureWaterTile(i, changes);
      ensureWaterTile(n, changes);

      scheduleWater(n);
      scheduleWater(i);
    }

    if (x > 0) flowSide(i - H);
    if (x + 1 < W) flowSide(i + H);
  }

  let vis = null;
  let stamp = 1;
  function ensureVis() {
    const N = W * H;
    if (!vis || vis.length !== N) vis = new Uint32Array(N);
  }

  function lampShouldOn(iLamp) {
    const x = (iLamp / H) | 0;
    const y = iLamp - x * H;
    if (x > 0) { const t = tiles[iLamp - H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
    if (x + 1 < W) { const t = tiles[iLamp + H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
    if (y > 0) { const t = tiles[iLamp - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
    if (y + 1 < H) { const t = tiles[iLamp + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON) return true; }
    return false;
  }

  function updateLampAt(iLamp, changes) {
    const t = tiles[iLamp];
    if (!(t === IDS.LAMP_OFF || t === IDS.LAMP_ON)) return;
    const want = lampShouldOn(iLamp) ? IDS.LAMP_ON : IDS.LAMP_OFF;
    if (t !== want) setTile(iLamp, want, changes);
  }

  function logicRecomputeFromSeed(seed, changes) {
    logicMark[seed] = 0;

    ensureVis();
    stamp = (stamp + 1) >>> 0;
    if (stamp === 0) { stamp = 1; vis.fill(0); }

    const starts = [];
    const sid = tiles[seed];
    if (isConductor(sid)) starts.push(seed);
    else {
      const x = (seed / H) | 0;
      const y = seed - x * H;
      if (x > 0) { const n = seed - H; if (isConductor(tiles[n])) starts.push(n); }
      if (x + 1 < W) { const n = seed + H; if (isConductor(tiles[n])) starts.push(n); }
      if (y > 0) { const n = seed - 1; if (isConductor(tiles[n])) starts.push(n); }
      if (y + 1 < H) { const n = seed + 1; if (isConductor(tiles[n])) starts.push(n); }
      if (isLamp(sid)) updateLampAt(seed, changes);
    }
    if (!starts.length) return;

    const q = [];
    const comp = [];
    let powered = false;

    for (let si = 0; si < starts.length; si++) {
      const s = starts[si];
      if (vis[s] === stamp) continue;
      vis[s] = stamp;
      q.push(s);

      while (q.length) {
        const i = q.pop();
        const t = tiles[i];
        if (!isConductor(t)) continue;

        comp.push(i);
        if (isSource(t)) powered = true;

        const x = (i / H) | 0;
        const y = i - x * H;

        if (x > 0) { const n = i - H; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
        if (x + 1 < W) { const n = i + H; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
        if (y > 0) { const n = i - 1; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }
        if (y + 1 < H) { const n = i + 1; if (vis[n] !== stamp && isConductor(tiles[n])) { vis[n] = stamp; q.push(n); } }

        if (comp.length > 12000) break;
      }
      if (comp.length > 12000) break;
    }

    const wantWire = powered ? IDS.WIRE_ON : IDS.WIRE_OFF;
    for (let i = 0; i < comp.length; i++) {
      const p = comp[i];
      const t = tiles[p];
      if (isWire(t) && t !== wantWire) setTile(p, wantWire, changes);
    }

    for (let i = 0; i < comp.length; i++) {
      const p = comp[i];
      const x = (p / H) | 0;
      const y = p - x * H;
      if (x > 0) updateLampAt(p - H, changes);
      if (x + 1 < W) updateLampAt(p + H, changes);
      if (y > 0) updateLampAt(p - 1, changes);
      if (y + 1 < H) updateLampAt(p + 1, changes);
    }
  }

  function primeRegionWork() {
    if (!region.set) return;
    for (let x = region.x0; x <= region.x1; x++) {
      const base = x * H;
      for (let y = region.y0; y <= region.y1; y++) {
        const i = base + y;
        if (water[i] > 0) scheduleWater(i);
        const t = tiles[i];
        if (t === IDS.SWITCH_ON || isWire(t) || isLamp(t)) scheduleLogic(i);
      }
    }
  }

  function step() {
    const changes = [];

    const waterBudget = (perfLevel === 'low') ? 350 : 900;
    for (let ops = 0; ops < waterBudget && waterQ.length; ops++) {
      waterTick(waterQ.pop(), changes);
    }

    const logicBudget = 1;
    for (let ops = 0; ops < logicBudget && logicQ.length; ops++) {
      logicRecomputeFromSeed(logicQ.pop(), changes);
    }

    if (changes.length) {
      const buf = new Int32Array(changes);
      postMessage({ type: 'changes', buf: buf.buffer }, [buf.buffer]);
    }

    const tickMs = (perfLevel === 'low') ? 55 : 35;
    setTimeout(step, tickMs);
  }

  onmessage = (e) => {
    const m = e.data;
    if (!m || !m.type) return;

    switch (m.type) {
      case 'init': {
        W = m.w | 0;
        H = m.h | 0;
        IDS = m.ids;
        AIR = (m.blocks && (m.blocks.AIR | 0) >= 0) ? (m.blocks.AIR | 0) : 0;
        WATER = (m.blocks && (m.blocks.WATER | 0) >= 0) ? (m.blocks.WATER | 0) : 27;

        tiles = new Uint8Array(m.tiles);
        solid = new Uint8Array(m.solid);

        const N = W * H;
        water = new Uint8Array(N);
        waterMark = new Uint8Array(N);
        logicMark = new Uint8Array(N);
        ensureVis();

        for (let i = 0; i < N; i++) if (tiles[i] === WATER) water[i] = MAX;

        step();
        break;
      }

      case 'tileWrite': {
        if (!tiles) return;
        const x = m.x | 0;
        const y = m.y | 0;
        if (x < 0 || y < 0 || x >= W || y >= H) return;

        const i = idx(x, y);
        const newId = m.id | 0;
        const oldId = tiles[i];
        tiles[i] = newId;

        if (newId === WATER) {
          water[i] = MAX;
          scheduleWaterAround(x, y);
        } else if (oldId === WATER && newId !== WATER) {
          water[i] = 0;
          scheduleWaterAround(x, y);
        }

        scheduleLogicAround(x, y);
        break;
      }

      case 'region': {
        const cx = m.cx | 0, cy = m.cy | 0;
        const rx = m.rx | 0, ry = m.ry | 0;

        const x0 = Math.max(0, cx - rx);
        const x1 = Math.min(W - 1, cx + rx);
        const y0 = Math.max(0, cy - ry);
        const y1 = Math.min(H - 1, cy + ry);

        const key = x0 + ',' + y0 + ',' + x1 + ',' + y1;
        if (key !== lastRegionKey) {
          lastRegionKey = key;
          region.x0 = x0; region.x1 = x1; region.y0 = y0; region.y1 = y1; region.set = true;
          primeRegionWork();
        } else {
          region.set = true;
        }
        break;
      }

      case 'perf': {
        perfLevel = m.level || 'high';
        break;
      }
      default: {
        console.warn('[Worker] Unknown message type: ' + m.type);
        break;
      }
    }
  };
})();`;
                                        }
                                    }

                                    TU.TileLogicEngine = TileLogicEngine;

                                    // ─────────────────────────────────────────────────────────────
                                    // 6) Hook into game lifecycle + markTile
                                    // ─────────────────────────────────────────────────────────────
                                    function attachToGame(game) {
                                        if (!game || !game.world || !game.player) return;
                                        if (game.tileLogic) return;

                                        try {
                                            game.tileLogic = new TileLogicEngine(game);
                                        } catch (e) {
                                            console.warn('TileLogicEngine attach failed', e);
                                            return;
                                        }

                                        // starter items (idempotent)
                                        try {
                                            const inv = game.player.inventory;
                                            if (!inv || !inv.push) return;
                                            const has = (id) => inv.some(it => it && it.id === id);
                                            if (!has(IDS.WIRE_OFF)) inv.push({ id: IDS.WIRE_OFF, name: '逻辑线', count: 48 });
                                            if (!has(IDS.SWITCH_OFF)) inv.push({ id: IDS.SWITCH_OFF, name: '开关', count: 6 });
                                            if (!has(IDS.LAMP_OFF)) inv.push({ id: IDS.LAMP_OFF, name: '逻辑灯', count: 12 });
                                            game._deferHotbarUpdate && game._deferHotbarUpdate();
                                        } catch { }
                                    }

                                    // Patch Game.init + Game.update
                                    try {
                                        const GameClass = (typeof Game !== 'undefined') ? Game : (TU.Game || null);
                                        if (GameClass && GameClass.prototype && !GameClass.prototype.__logicV12InitPatched) {
                                            GameClass.prototype.__logicV12InitPatched = true;

                                            const _init = GameClass.prototype.init;
                                            GameClass.prototype.init = async function () {
                                                await _init.call(this);
                                                try { attachToGame(this); } catch { }
                                            };

                                            const _update = GameClass.prototype.update;
                                            GameClass.prototype.update = function (dt) {
                                                const r = _update.call(this, dt);
                                                try { this.tileLogic && this.tileLogic.onFrame && this.tileLogic.onFrame(dt); } catch { }
                                                return r;
                                            };
                                        }
                                    } catch (e) {
                                        console.warn('Game patch failed', e);
                                    }

                                    // Patch SaveSystem.markTile to notify tile logic
                                    try {
                                        const SS = (typeof SaveSystem !== 'undefined') ? SaveSystem : (TU.SaveSystem || null);
                                        if (SS && SS.prototype && !SS.prototype.__logicV12MarkTilePatched) {
                                            SS.prototype.__logicV12MarkTilePatched = true;
                                            const _mark = SS.prototype.markTile;
                                            SS.prototype.markTile = function (x, y, newId) {
                                                const r = _mark.call(this, x, y, newId);
                                                try {
                                                    const g = this.game;
                                                    if (g && g.tileLogic && g.tileLogic.notifyTileWrite) g.tileLogic.notifyTileWrite(x, y, newId);
                                                } catch { }
                                                return r;
                                            };
                                        }
                                    } catch { }

                                    // ─────────────────────────────────────────────────────────────
                                    // 7) Right-click toggle switch with pickaxe
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        const GameClass = (typeof Game !== 'undefined') ? Game : (TU.Game || null);
                                        if (GameClass && GameClass.prototype && !GameClass.prototype.__logicV12InteractPatched) {
                                            GameClass.prototype.__logicV12InteractPatched = true;
                                            const _handle = GameClass.prototype._handleInteraction;

                                            GameClass.prototype._handleInteraction = function (input, dtScale) {
                                                try {
                                                    if (!this._inputBlocked && input && input.mouseRight && !input.mouseLeft) {
                                                        const worldX = input.mouseX + this.camera.x;
                                                        const worldY = input.mouseY + this.camera.y;

                                                        let tileX = Math.floor(worldX / CFG.TILE_SIZE);
                                                        let tileY = Math.floor(worldY / CFG.TILE_SIZE);

                                                        if (this.isMobile && this.settings && this.settings.aimAssist) {
                                                            tileX = Math.floor((worldX + CFG.TILE_SIZE * 0.5) / CFG.TILE_SIZE);
                                                            tileY = Math.floor((worldY + CFG.TILE_SIZE * 0.5) / CFG.TILE_SIZE);
                                                        }

                                                        if (tileX >= 0 && tileY >= 0 && tileX < this.world.w && tileY < this.world.h) {
                                                            const dx = worldX - this.player.cx();
                                                            const dy = worldY - this.player.cy();
                                                            const reachPx = CFG.REACH_DISTANCE * CFG.TILE_SIZE;
                                                            const inRange = (dx * dx + dy * dy) <= (reachPx * reachPx);

                                                            if (inRange) {
                                                                const item = this.player.getItem();
                                                                const id = this.world.tiles[tileX][tileY];

                                                                if (item && item.id === 'pickaxe' && (id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON)) {
                                                                    const newId = (id === IDS.SWITCH_OFF) ? IDS.SWITCH_ON : IDS.SWITCH_OFF;
                                                                    this.world.tiles[tileX][tileY] = newId;

                                                                    if (this.saveSystem && this.saveSystem.markTile) this.saveSystem.markTile(tileX, tileY, newId);

                                                                    this.audio && this.audio.play('ui');
                                                                    try {
                                                                        this.particles && this.particles.emit(tileX * CFG.TILE_SIZE + 8, tileY * CFG.TILE_SIZE + 8, {
                                                                            color: '#ffd166', count: 6, speed: 2, up: true
                                                                        });
                                                                    } catch { }

                                                                    input.mouseRight = false;
                                                                }
                                                            }
                                                        }
                                                    }
                                                } catch { }

                                                return _handle.call(this, input, dtScale);
                                            };
                                        }
                                    } catch { }

                                })();
                            </script>

                            <!-- ========================= PATCH: weather_lighting_audio_sync_v1 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'weather_lighting_audio_sync_v1',
                                            order: 50,
                                            description: "天气-光照-音频同步修复（v1）",
                                            apply: () => {
                                                const TU = window.TU || {};
                                                const AudioManager = TU.AudioManager;
                                                const Renderer = TU.Renderer;

                                                // ───────────────────────── WebAudio: real-time rain synth (sync with weather particles)
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__rainSynthInstalled) {
                                                    AudioManager.prototype.__rainSynthInstalled = true;

                                                    AudioManager.prototype._makeLoopNoiseBuffer = function (seconds) {
                                                        try {
                                                            if (!this.ctx) return null;
                                                            const ctx = this.ctx;
                                                            const sr = ctx.sampleRate || 44100;
                                                            const len = Math.max(1, (sr * (seconds || 2)) | 0);
                                                            const buf = ctx.createBuffer(1, len, sr);
                                                            const d = buf.getChannelData(0);

                                                            // white noise
                                                            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);

                                                            // fade-in/out to avoid loop clicks
                                                            const fade = Math.min((sr * 0.02) | 0, (len / 2) | 0);
                                                            for (let i = 0; i < fade; i++) {
                                                                const t = i / fade;
                                                                d[i] *= t;
                                                                d[len - 1 - i] *= t;
                                                            }
                                                            return buf;
                                                        } catch (_) {
                                                            return null;
                                                        }
                                                    };

                                                    AudioManager.prototype._startRainSynth = function () {
                                                        if (!this.ctx) return false;
                                                        const ctx = this.ctx;
                                                        if (ctx.state === 'suspended') return false;

                                                        const st = this._rainSynth || (this._rainSynth = { active: false, dropAcc: 0 });
                                                        if (st.active) return true;

                                                        if (!st.buf) st.buf = this._makeLoopNoiseBuffer(2.0);
                                                        if (!st.buf) return false;

                                                        const src = ctx.createBufferSource();
                                                        src.buffer = st.buf;
                                                        src.loop = true;

                                                        const hp = ctx.createBiquadFilter();
                                                        hp.type = 'highpass';
                                                        hp.frequency.value = 140;

                                                        const lp = ctx.createBiquadFilter();
                                                        lp.type = 'lowpass';
                                                        lp.frequency.value = 4200;

                                                        const gain = ctx.createGain();
                                                        gain.gain.value = 0;

                                                        src.connect(hp);
                                                        hp.connect(lp);
                                                        lp.connect(gain);
                                                        gain.connect(ctx.destination);

                                                        try { src.start(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        st.src = src;
                                                        st.hp = hp;
                                                        st.lp = lp;
                                                        st.gain = gain;
                                                        st.active = true;
                                                        st.dropAcc = 0;

                                                        return true;
                                                    };

                                                    AudioManager.prototype._stopRainSynth = function () {
                                                        const st = this._rainSynth;
                                                        if (!st || !st.active) return;

                                                        st.active = false;

                                                        try {
                                                            const ctx = this.ctx;
                                                            if (ctx && st.gain && st.gain.gain) {
                                                                const now = ctx.currentTime;
                                                                try { st.gain.gain.setTargetAtTime(0, now, 0.08); } catch (_) { st.gain.gain.value = 0; }
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        const src = st.src;
                                                        const hp = st.hp, lp = st.lp, gain = st.gain;

                                                        st.src = null;
                                                        st.hp = null;
                                                        st.lp = null;
                                                        st.gain = null;

                                                        // 延迟 stop，给淡出留时间
                                                        setTimeout(() => {
                                                            try { if (src) src.stop(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (src) src.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (hp) hp.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (lp) lp.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (gain) gain.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }, 520);
                                                    };

                                                    // 主入口：每帧调用（由 Game._updateWeather 驱动）
                                                    AudioManager.prototype.updateWeatherAmbience = function (dtMs, weather) {
                                                        const wType = (weather && weather.type) ? weather.type : 'clear';
                                                        const wInt = (weather && Number.isFinite(weather.intensity)) ? weather.intensity : 0;

                                                        const wantRain = (wInt > 0.06) && (wType === 'rain' || wType === 'thunder');
                                                        const thunder = (wType === 'thunder');

                                                        // 没有交互解锁音频时，ctx 可能不存在；这里不强行创建，等 arm() 的手势触发
                                                        if (!this.ctx || !this.enabled) {
                                                            if (!wantRain) return;
                                                            return;
                                                        }

                                                        const sv = (this.settings && Number.isFinite(this.settings.sfxVolume)) ? this.settings.sfxVolume : 0;
                                                        if (sv <= 0.001) {
                                                            // 音量为 0：确保停掉
                                                            if (this._rainSynth && this._rainSynth.active) this._stopRainSynth();
                                                            return;
                                                        }

                                                        if (!wantRain) {
                                                            if (this._rainSynth && this._rainSynth.active) this._stopRainSynth();
                                                            return;
                                                        }

                                                        if (!this._startRainSynth()) return;

                                                        const st = this._rainSynth;
                                                        if (!st || !st.active || !this.ctx) return;

                                                        const ctx = this.ctx;
                                                        const now = ctx.currentTime;

                                                        // 目标音量：与粒子强度同步（雷雨略更重一些）
                                                        const base = sv * (thunder ? 0.22 : 0.16);
                                                        const targetVol = base * Math.min(1, Math.max(0, wInt));

                                                        try { st.gain.gain.setTargetAtTime(targetVol, now, 0.08); } catch (_) { st.gain.gain.value = targetVol; }

                                                        // 过滤器：雨越大，高频越多；雷雨略加强低频/压抑感
                                                        const hpHz = 110 + wInt * (thunder ? 260 : 200);
                                                        const lpHz = 2600 + wInt * (thunder ? 5200 : 4200);

                                                        try { st.hp.frequency.setTargetAtTime(hpHz, now, 0.08); } catch (_) { st.hp.frequency.value = hpHz; }
                                                        try { st.lp.frequency.setTargetAtTime(lpHz, now, 0.08); } catch (_) { st.lp.frequency.value = lpHz; }

                                                        // 雨点：用短噪声 burst 模拟“打在叶子/地面”的颗粒感（频率与强度同步）
                                                        st.dropAcc = (st.dropAcc || 0) + (dtMs || 0);

                                                        const rate = (thunder ? 3.2 : 2.2) + wInt * (thunder ? 7.0 : 5.0); // 次/秒
                                                        const interval = 1000 / Math.max(0.8, rate);

                                                        let fired = 0;
                                                        while (st.dropAcc >= interval && fired < 4) {
                                                            st.dropAcc -= interval;
                                                            fired++;

                                                            // 避免过“嘈杂”：一定概率跳过
                                                            if (Math.random() < 0.35) continue;

                                                            const dVol = (thunder ? 0.055 : 0.045) + wInt * 0.065;
                                                            const dur = 0.018 + Math.random() * 0.03;
                                                            try { this.noise(dur, dVol); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }
                                                    };
                                                }

                                                // ───────────────────────── Renderer: postProcess 色偏叠加（血月/雷雨）
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__weatherPostTintInstalled) {
                                                    Renderer.prototype.__weatherPostTintInstalled = true;

                                                    const _orig = Renderer.prototype.applyPostFX;

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        const gs = (window.GAME_SETTINGS || {});
                                                        let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                                                        if (!Number.isFinite(mode)) mode = 2;
                                                        if (mode <= 0) return;

                                                        // 先跑原有后期（Bloom/雾化/暗角/颗粒等）
                                                        if (_orig) _orig.call(this, time, depth01, reducedMotion);

                                                        const fx = window.TU_WEATHER_FX;
                                                        if (!fx) return;

                                                        const a = Number(fx.postA) || 0;
                                                        const lightning = Number(fx.lightning) || 0;

                                                        if (a <= 0.001 && lightning <= 0.001) return;

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;


                                                        ctx.save();
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;

                                                        // 1) 色偏（压抑氛围）
                                                        if (a > 0.001) {
                                                            const r = (fx.postR | 0) & 255;
                                                            const g = (fx.postG | 0) & 255;
                                                            const b = (fx.postB | 0) & 255;
                                                            const mode2 = fx.postMode || 'source-over';

                                                            ctx.globalCompositeOperation = mode2;
                                                            ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 2) 雷雨闪电：短促 screen 叠加 + 轻微径向高光
                                                        if (lightning > 0.001) {
                                                            const f = Math.min(1, Math.max(0, lightning));

                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = `rgba(210,230,255,${(0.10 + 0.34 * f).toFixed(3)})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            const cx = wPx * 0.5;
                                                            const cy = hPx * 0.45;
                                                            const r0 = Math.min(wPx, hPx) * 0.06;
                                                            const r1 = Math.max(wPx, hPx) * 0.95;

                                                            const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                            g.addColorStop(0, `rgba(255,255,255,${(0.18 * f).toFixed(3)})`);
                                                            g.addColorStop(1, 'rgba(255,255,255,0)');

                                                            ctx.fillStyle = g;
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 恢复
                                                        ctx.globalCompositeOperation = 'source-over';
                                                        try { ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        ctx.restore();
                                                    };
                                                }

                                                // ───────────────────────── Debug helper (Console)
                                                // 用法示例：
                                                //   TU.forceWeather('thunder', 1, 30000)   // 30 秒雷雨
                                                //   TU.forceWeather('bloodmoon', 1, 30000) // 30 秒血月（夜晚效果更明显）
                                                //   TU.forceWeather('clear', 0, 1)        // 清空天气
                                                if (TU && !TU.forceWeather) {
                                                    TU.forceWeather = function (type, intensity, durationMs) {
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            if (!g) return;

                                                            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                            const dur = Math.max(1, Number(durationMs) || 30000);

                                                            if (!g.weather) {
                                                                g.weather = { type: 'clear', intensity: 0, targetIntensity: 0, nextType: 'clear', nextIntensity: 0, lightning: 0 };
                                                            }

                                                            const w = g.weather;
                                                            const tt = (type || 'clear').toString();
                                                            const ii = (tt === 'clear') ? 0 : Math.min(1, Math.max(0, Number(intensity)));
                                                            w.nextType = tt;
                                                            w.nextIntensity = ii;

                                                            // 若需要换类型：先淡出
                                                            if (w.type !== tt) w.targetIntensity = 0;
                                                            else w.targetIntensity = ii;

                                                            // 延后系统随机决策
                                                            g._weatherNextAt = now + dur;

                                                            // 若强制 clear：直接清空 lightning
                                                            if (tt === 'clear') {
                                                                w.lightning = 0;
                                                                w._lightningNextAt = 0;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: weather_canvas_fx_perf_v1 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'weather_canvas_fx_perf_v1',
                                            order: 60,
                                            description: "天气 Canvas 特效与性能优化（v1）",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || (window.TU = {});
                                                const Game = TU.Game;
                                                const Renderer = TU.Renderer;

                                                // ───────────────────────── CSS: add weather overlay canvas + disable expensive CSS filter on #game
                                                try {
                                                    const style = document.createElement('style');
                                                    style.setAttribute('data-tu-patch', 'weather_canvas_fx_perf_v1');
                                                    style.textContent = `
            #weatherfx{
              position: fixed;
              top: 0; left: 0;
              width: 100%; height: 100%;
              pointer-events: none;
              z-index: 55; /* above ambient particles (50), below UI (100) */
            }
            .reduced-motion #weatherfx{ display:none !important; }
            body.weather-on #game{ filter:none !important; }
          `;
                                                    document.head && document.head.appendChild(style);
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // ───────────────────────── Ensure overlay canvas exists
                                                function ensureWeatherCanvas() {
                                                    // DOM-less offscreen canvas: avoid extra overlay layer & DOM reflow
                                                    let c = (window.TU && TU.__weatherfxCanvas) || null;
                                                    if (c) return c;
                                                    c = document.createElement('canvas'); // offscreen (NOT appended)
                                                    c.width = 1; c.height = 1;
                                                    if (window.TU) TU.__weatherfxCanvas = c;
                                                    return c;
                                                }

                                                // ───────────────────────── WeatherCanvasFX: fast rain/snow + lightning on a single canvas
                                                class WeatherCanvasFX {
                                                    constructor(canvas) {
                                                        this.canvas = canvas;
                                                        this.ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null;

                                                        this._wPx = 0;
                                                        this._hPx = 0;
                                                        this._wCss = 0;
                                                        this._hCss = 0;
                                                        this._dpr = 1;

                                                        this._lastNow = 0;
                                                        this._hadFx = false;

                                                        // deterministic-ish RNG (xorshift32) to reduce Math.random usage during generation
                                                        this._seed = 0x12345678;

                                                        // Rain / snow pattern buffers (offscreen)
                                                        this._rain = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                        this._snow = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };

                                                        // Lightning flash gradient cache (depends on resolution only)
                                                        this._flash = { w: 0, h: 0, grad: null };

                                                        // Lightning bolt (reused object + typed array)
                                                        this._bolt = { pts: null, n: 0, life: 0, maxLife: 0 };
                                                        this._prevLightning = 0;
                                                    }

                                                    _rand01() {
                                                        // xorshift32
                                                        let x = this._seed | 0;
                                                        x ^= (x << 13);
                                                        x ^= (x >>> 17);
                                                        x ^= (x << 5);
                                                        this._seed = x | 0;
                                                        return ((x >>> 0) / 4294967296);
                                                    }

                                                    _makeOffscreenCanvas(w, h) {
                                                        try {
                                                            if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        const c = document.createElement('canvas');
                                                        c.width = w; c.height = h;
                                                        return c;
                                                    }

                                                    resizeLike(renderer) {
                                                        if (!renderer || !renderer.canvas || !this.canvas || !this.ctx) return;
                                                        const wPx = renderer.canvas.width | 0;
                                                        const hPx = renderer.canvas.height | 0;

                                                        // renderer.w/h are CSS px viewport units used by the game
                                                        const wCss = (renderer.w | 0) || Math.round(window.innerWidth || 0);
                                                        const hCss = (renderer.h | 0) || Math.round(window.innerHeight || 0);

                                                        const dpr = Number(renderer.dpr) || (window.devicePixelRatio || 1);

                                                        const sizeChanged = (this.canvas.width !== wPx) || (this.canvas.height !== hPx);

                                                        if (sizeChanged) {
                                                            this.canvas.width = wPx;
                                                            this.canvas.height = hPx;
                                                            this.canvas.style.width = wCss + 'px';
                                                            this.canvas.style.height = hCss + 'px';

                                                            this._wPx = wPx; this._hPx = hPx;
                                                            this._wCss = wCss; this._hCss = hCss;
                                                            this._dpr = dpr;

                                                            // invalidate caches on resize
                                                            this._rain.pattern = null;
                                                            this._rain.tile = null;
                                                            this._snow.pattern = null;
                                                            this._snow.tile = null;
                                                            this._flash.grad = null;
                                                            this._flash.w = 0; this._flash.h = 0;
                                                        } else {
                                                            this._wPx = wPx; this._hPx = hPx;
                                                            this._wCss = wCss; this._hCss = hCss;
                                                            this._dpr = dpr;
                                                        }

                                                        // Always render in pixel space (identity transform) for predictable pattern scrolling
                                                        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        // Keep smoothing on for nicer rain streaks; it mainly affects drawImage scaling.
                                                        try { this.ctx.imageSmoothingEnabled = true; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }

                                                    _ensureRainPattern() {
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        // Choose tile size by DPR for fewer repeats
                                                        const tile = (this._dpr > 1.25) ? 512 : 256;
                                                        if (this._rain.pattern && this._rain.size === tile) return;

                                                        const c = this._makeOffscreenCanvas(tile, tile);
                                                        const g = c.getContext('2d', { alpha: true });
                                                        if (!g) return;

                                                        // draw rain streaks onto tile (one-time cost)
                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        g.lineCap = 'round';
                                                        g.lineJoin = 'round';

                                                        const drops = Math.round((tile * tile) / 2600); // density knob (higher = denser)
                                                        const angle = 12 * Math.PI / 180;
                                                        const sx = Math.sin(angle);
                                                        const cy = Math.cos(angle);

                                                        // two passes: thin + thick for variation
                                                        for (let pass = 0; pass < 2; pass++) {
                                                            g.lineWidth = pass === 0 ? 1 : 2;
                                                            g.strokeStyle = pass === 0 ? 'rgba(180,220,255,0.55)' : 'rgba(180,220,255,0.35)';

                                                            const n = pass === 0 ? drops : Math.round(drops * 0.35);
                                                            for (let i = 0; i < n; i++) {
                                                                const x = this._rand01() * tile;
                                                                const y = this._rand01() * tile;

                                                                const len = (8 + this._rand01() * 22) * (pass === 0 ? 1 : 1.2);
                                                                const dx = sx * len;
                                                                const dy = cy * len;

                                                                const a = pass === 0
                                                                    ? (0.10 + this._rand01() * 0.22)
                                                                    : (0.06 + this._rand01() * 0.16);

                                                                g.globalAlpha = a;
                                                                g.beginPath();
                                                                g.moveTo(x, y);
                                                                g.lineTo(x + dx, y + dy);
                                                                g.stroke();
                                                            }
                                                        }

                                                        g.globalAlpha = 1;

                                                        // pattern is tied to output ctx
                                                        const p = ctxOut.createPattern(c, 'repeat');
                                                        if (!p) return;

                                                        this._rain.tile = c;
                                                        this._rain.ctx = g;
                                                        this._rain.pattern = p;
                                                        this._rain.size = tile;
                                                        this._rain.ox = 0;
                                                        this._rain.oy = 0;
                                                    }

                                                    _ensureSnowPattern() {
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        const tile = (this._dpr > 1.25) ? 384 : 256;
                                                        if (this._snow.pattern && this._snow.size === tile) return;

                                                        const c = this._makeOffscreenCanvas(tile, tile);
                                                        const g = c.getContext('2d', { alpha: true });
                                                        if (!g) return;

                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        const flakes = Math.round((tile * tile) / 5200);
                                                        g.fillStyle = 'rgba(255,255,255,0.9)';
                                                        for (let i = 0; i < flakes; i++) {
                                                            const x = this._rand01() * tile;
                                                            const y = this._rand01() * tile;
                                                            const r = 0.8 + this._rand01() * 1.8;
                                                            const a = 0.10 + this._rand01() * 0.35;

                                                            g.globalAlpha = a;
                                                            g.beginPath();
                                                            g.arc(x, y, r, 0, Math.PI * 2);
                                                            g.fill();
                                                        }
                                                        g.globalAlpha = 1;

                                                        const p = ctxOut.createPattern(c, 'repeat');
                                                        if (!p) return;

                                                        this._snow.tile = c;
                                                        this._snow.ctx = g;
                                                        this._snow.pattern = p;
                                                        this._snow.size = tile;
                                                        this._snow.ox = 0;
                                                        this._snow.oy = 0;
                                                    }

                                                    drawRain(intensity, dtMs, isThunder) {
                                                        if (!this.ctx) return;
                                                        this._ensureRainPattern();
                                                        if (!this._rain.pattern) return;

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = this._rain.size | 0;

                                                        // Speed in px/s, scaled by DPR for consistent look
                                                        const base = (isThunder ? 1400 : 1100) * this._dpr;
                                                        const speed = base * (0.55 + 0.85 * Math.min(1, Math.max(0, intensity)));

                                                        const dt = (dtMs || 0) / 1000;
                                                        // scroll diagonally to match streak angle
                                                        this._rain.oy = (this._rain.oy + speed * dt) % tile;
                                                        this._rain.ox = (this._rain.ox + speed * 0.18 * dt) % tile;

                                                        const ox = this._rain.ox;
                                                        const oy = this._rain.oy;

                                                        // Density & alpha: draw one or two layers (still just 1–2 fillRect calls)
                                                        const aBase = (0.10 + 0.28 * intensity) * (isThunder ? 1.10 : 1.0);

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = this._rain.pattern;

                                                        // Far layer (subtle)
                                                        ctx.globalAlpha = aBase * 0.55;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.65, -oy * 0.65);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Reset
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    }

                                                    drawSnow(intensity, dtMs) {
                                                        if (!this.ctx) return;
                                                        this._ensureSnowPattern();
                                                        if (!this._snow.pattern) return;

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = this._snow.size | 0;

                                                        const dt = (dtMs || 0) / 1000;

                                                        // Slow fall + gentle drift
                                                        const fall = (180 + 240 * intensity) * this._dpr;
                                                        const drift = (40 + 80 * intensity) * this._dpr;

                                                        this._snow.oy = (this._snow.oy + fall * dt) % tile;
                                                        this._snow.ox = (this._snow.ox + drift * dt) % tile;

                                                        const ox = this._snow.ox;
                                                        const oy = this._snow.oy;

                                                        const aBase = 0.08 + 0.22 * intensity;

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = this._snow.pattern;

                                                        // Far layer (less alpha, slower)
                                                        ctx.globalAlpha = aBase * 0.50;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.55, -oy * 0.55);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    }

                                                    _ensureFlashGradient() {
                                                        const ctx = this.ctx;
                                                        if (!ctx) return;

                                                        const w = this._wPx | 0;
                                                        const h = this._hPx | 0;

                                                        if (this._flash.grad && this._flash.w === w && this._flash.h === h) return;

                                                        const cx = w * 0.5;
                                                        const cy = h * 0.45;
                                                        const r0 = Math.min(w, h) * 0.06;
                                                        const r1 = Math.max(w, h) * 0.95;

                                                        const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                        g.addColorStop(0, 'rgba(255,255,255,1)');
                                                        g.addColorStop(1, 'rgba(255,255,255,0)');

                                                        this._flash.grad = g;
                                                        this._flash.w = w;
                                                        this._flash.h = h;
                                                    }

                                                    _spawnBolt() {
                                                        const w = this._wPx | 0;
                                                        const h = this._hPx | 0;
                                                        if (w <= 0 || h <= 0) return;

                                                        const segs = 18;
                                                        if (!this._bolt.pts || this._bolt.pts.length !== segs * 2) {
                                                            this._bolt.pts = new Float32Array(segs * 2);
                                                        }

                                                        let x = w * (0.22 + this._rand01() * 0.56);
                                                        let y = -h * 0.05;
                                                        const stepY = (h * 1.08) / (segs - 1);
                                                        let amp = w * 0.10;

                                                        const pts = this._bolt.pts;
                                                        for (let i = 0; i < segs; i++) {
                                                            pts[i * 2] = x;
                                                            pts[i * 2 + 1] = y;

                                                            y += stepY;
                                                            x += (this._rand01() - 0.5) * amp;
                                                            amp *= 0.82;
                                                        }

                                                        this._bolt.n = segs;
                                                        this._bolt.maxLife = 120 + (this._rand01() * 80); // ms
                                                        this._bolt.life = this._bolt.maxLife;
                                                    }

                                                    drawLightning(lightning, dtMs) {
                                                        if (!this.ctx) return;
                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;

                                                        const f = Math.min(1, Math.max(0, Number(lightning) || 0));
                                                        if (f <= 0.001) return;

                                                        // Rising edge: spawn a visible bolt sometimes
                                                        if (f > 0.75 && this._prevLightning <= 0.12) {
                                                            this._spawnBolt();
                                                        }

                                                        // 1) Flash overlay (cheap): 2 fillRect, cached gradient, no string allocations per frame
                                                        this._ensureFlashGradient();

                                                        ctx.globalCompositeOperation = 'screen';

                                                        // Full-screen cool flash
                                                        ctx.globalAlpha = 0.10 + 0.34 * f;
                                                        ctx.fillStyle = 'rgb(210,230,255)';
                                                        ctx.fillRect(0, 0, w, h);

                                                        // Radial highlight
                                                        if (this._flash.grad) {
                                                            ctx.globalAlpha = 0.18 * f;
                                                            ctx.fillStyle = this._flash.grad;
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        // 2) Bolt (optional, short-lived)
                                                        if (this._bolt && this._bolt.life > 0 && this._bolt.pts && this._bolt.n >= 2) {
                                                            const dt = Math.max(0, Number(dtMs) || 0);
                                                            this._bolt.life = Math.max(0, this._bolt.life - dt);

                                                            const life01 = this._bolt.maxLife > 0 ? (this._bolt.life / this._bolt.maxLife) : 0;
                                                            if (life01 > 0.001) {
                                                                const pts = this._bolt.pts;
                                                                const n = this._bolt.n;

                                                                ctx.lineCap = 'round';
                                                                ctx.lineJoin = 'round';

                                                                ctx.beginPath();
                                                                ctx.moveTo(pts[0], pts[1]);
                                                                for (let i = 1; i < n; i++) {
                                                                    const j = i * 2;
                                                                    ctx.lineTo(pts[j], pts[j + 1]);
                                                                }

                                                                const s = (this._dpr || 1);

                                                                // Outer glow-ish stroke (no shadowBlur to keep it cheap)
                                                                ctx.globalAlpha = 0.10 * f * life01;
                                                                ctx.strokeStyle = 'rgb(140,190,255)';
                                                                ctx.lineWidth = 5.5 * s;
                                                                ctx.stroke();

                                                                // Core stroke
                                                                ctx.globalAlpha = 0.70 * f * life01;
                                                                ctx.strokeStyle = 'rgb(255,255,255)';
                                                                ctx.lineWidth = 1.8 * s;
                                                                ctx.stroke();
                                                            }
                                                        }

                                                        // reset minimal states
                                                        ctx.globalAlpha = 1;
                                                        ctx.globalCompositeOperation = 'source-over';
                                                    }

                                                    render(weather, renderer) {
                                                        if (!this.ctx || !this.canvas) return;

                                                        // Respect reduced-motion: hide & clear once
                                                        const reduced = !!(document.documentElement && document.documentElement.classList.contains('reduced-motion'));
                                                        if (reduced) {
                                                            if (this._hadFx) {
                                                                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                this.ctx.clearRect(0, 0, this._wPx || this.canvas.width, this._hPx || this.canvas.height);
                                                                this._hadFx = false;
                                                            }
                                                            return;
                                                        }

                                                        this.resizeLike(renderer);

                                                        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                        let dtMs = now - (this._lastNow || now);
                                                        if (!Number.isFinite(dtMs)) dtMs = 0;
                                                        if (dtMs < 0) dtMs = 0;
                                                        if (dtMs > 200) dtMs = 200;
                                                        this._lastNow = now;

                                                        const w = weather || {};
                                                        const type = (w.type || 'clear').toString();
                                                        const intensity = Number(w.intensity) || 0;
                                                        const lightning = Number(w.lightning) || 0;

                                                        // If nothing to draw, clear once then stop touching the canvas (saves fill-rate)
                                                        if (intensity <= 0.001 && lightning <= 0.001) {
                                                            if (this._hadFx) {
                                                                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                this.ctx.clearRect(0, 0, this._wPx, this._hPx);
                                                                this._hadFx = false;
                                                            }
                                                            this._prevLightning = lightning;
                                                            return;
                                                        }

                                                        this._hadFx = true;

                                                        // Clear overlay each frame when active (transparent canvas)
                                                        const ctx = this.ctx;
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.clearRect(0, 0, this._wPx, this._hPx);

                                                        if ((type === 'rain' || type === 'thunder') && intensity > 0.01) {
                                                            this.drawRain(intensity, dtMs, type === 'thunder');
                                                        } else if (type === 'snow' && intensity > 0.01) {
                                                            this.drawSnow(intensity, dtMs);
                                                        }

                                                        if (lightning > 0.001) {
                                                            this.drawLightning(lightning, dtMs);
                                                        } else if (this._bolt && this._bolt.life > 0) {
                                                            // Let bolt fade out naturally even if lightning param drops fast
                                                            this.drawLightning(Math.max(0, this._prevLightning * 0.8), dtMs);
                                                        }

                                                        this._prevLightning = lightning;
                                                    }
                                                }

                                                TU.WeatherCanvasFX = WeatherCanvasFX;

                                                // ───────────────────────── AmbientParticles: fix missing container + skip rain/snow DOM particles (we draw on canvas)
                                                const AP = TU.AmbientParticles;
                                                if (AP && AP.prototype && !AP.prototype.__weatherCanvasFxInstalled) {
                                                    AP.prototype.__weatherCanvasFxInstalled = true;
                                                    const _oldUpdate = AP.prototype.update;

                                                    AP.prototype.update = function (timeOfDay, weather) {
                                                        // Hotfix: Game 构造时没传 containerId，导致 container 为 null
                                                        if (!this.container) this.container = document.getElementById('ambient-particles');
                                                        if (!this.container) return;

                                                        const w = weather || {};
                                                        const t = w.type;
                                                        const it = Number(w.intensity) || 0;

                                                        // rain/snow/thunder：改为 canvas 绘制，DOM 粒子直接关闭，避免大量节点/动画导致卡顿 + GC
                                                        if ((t === 'rain' || t === 'snow' || t === 'thunder') && it > 0.05) {
                                                            if (this.mode !== 'none' || (this.particles && this.particles.length)) {
                                                                try { this._clearAll(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            this.mode = 'none';
                                                            return;
                                                        }

                                                        return _oldUpdate.call(this, timeOfDay, weather);
                                                    };
                                                }

                                                // ───────────────────────── Weather color grading: move rain/snow tone into Canvas PostFX tint (offscreen pipeline)
                                                // We keep the original weather system, but override the post tint params after its update.
                                                if (Game && Game.prototype && !Game.prototype.__weatherCanvasFxPostTint) {
                                                    Game.prototype.__weatherCanvasFxPostTint = true;
                                                    const _oldWeather = Game.prototype._updateWeather;

                                                    if (typeof _oldWeather === 'function') {
                                                        Game.prototype._updateWeather = function (dtMs) {
                                                            _oldWeather.call(this, dtMs);

                                                            const w = this.weather || {};
                                                            const fx = window.TU_WEATHER_FX || (window.TU_WEATHER_FX = {});

                                                            // Only override for rain/snow (thunder/bloodmoon already managed by the original patch)
                                                            if (w && w.intensity > 0.06) {
                                                                if (w.type === 'rain') {
                                                                    // Slight cool/dim, like wet weather; multiply darkens and shifts
                                                                    fx.postMode = 'multiply';
                                                                    fx.postR = 110;
                                                                    fx.postG = 125;
                                                                    fx.postB = 155;
                                                                    fx.postA = Math.min(0.22, 0.05 + 0.14 * w.intensity);
                                                                } else if (w.type === 'snow') {
                                                                    // Slight cool brightening; screen lightens gently
                                                                    fx.postMode = 'screen';
                                                                    fx.postR = 210;
                                                                    fx.postG = 228;
                                                                    fx.postB = 255;
                                                                    fx.postA = Math.min(0.20, 0.04 + 0.12 * w.intensity);
                                                                }
                                                            }
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── Renderer: optimize weather tint + lightning flash overlay to reduce allocations & state churn
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__weatherPostTintOptimizedV2) {
                                                    Renderer.prototype.__weatherPostTintOptimizedV2 = true;

                                                    const prev = Renderer.prototype.applyPostFX;

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        // Respect postFxMode like original wrapper
                                                        const gs = (window.GAME_SETTINGS || {});
                                                        let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                                                        if (!Number.isFinite(mode)) mode = 2;

                                                        const fx = window.TU_WEATHER_FX;
                                                        let a = 0, lightning = 0, r = 0, g = 0, b = 0, comp = 'source-over';

                                                        if (fx) {
                                                            a = Number(fx.postA) || 0;
                                                            lightning = Number(fx.lightning) || 0;
                                                            r = (fx.postR | 0) & 255;
                                                            g = (fx.postG | 0) & 255;
                                                            b = (fx.postB | 0) & 255;
                                                            comp = fx.postMode || 'source-over';
                                                        }

                                                        // Temporarily disable the older weather wrapper (so we don't double-apply)
                                                        let restoreA = null, restoreL = null;
                                                        if (fx && (a > 0.001 || lightning > 0.001)) {
                                                            restoreA = fx.postA;
                                                            restoreL = fx.lightning;
                                                            fx.postA = 0;
                                                            fx.lightning = 0;
                                                        }

                                                        // Run original postFX pipeline
                                                        if (prev) prev.call(this, time, depth01, reducedMotion);

                                                        // Restore fx params for the rest of the game
                                                        if (fx && restoreA !== null) {
                                                            fx.postA = restoreA;
                                                            fx.lightning = restoreL;
                                                        }

                                                        // If postFx is off, keep behavior consistent (no extra tint)
                                                        if (mode <= 0) return;

                                                        if (a <= 0.001 && lightning <= 0.001) return;

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;

                                                        // Cache to avoid per-frame string/gradient allocations
                                                        const cache = this._weatherPostCache || (this._weatherPostCache = {});
                                                        if (cache.w !== wPx || cache.h !== hPx) {
                                                            cache.w = wPx; cache.h = hPx;

                                                            // lightning radial gradient (alpha handled via globalAlpha)
                                                            const cx = wPx * 0.5;
                                                            const cy = hPx * 0.45;
                                                            const r0 = Math.min(wPx, hPx) * 0.06;
                                                            const r1 = Math.max(wPx, hPx) * 0.95;
                                                            const lg = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                            lg.addColorStop(0, 'rgba(255,255,255,1)');
                                                            lg.addColorStop(1, 'rgba(255,255,255,0)');
                                                            cache.lg = lg;
                                                        }

                                                        // tint color string cache
                                                        if (cache.r !== r || cache.g !== g || cache.b !== b) {
                                                            cache.r = r; cache.g = g; cache.b = b;
                                                            cache.tintRGB = `rgb(${r},${g},${b})`;
                                                        }

                                                        ctx.save();
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);

                                                        // 1) Color tint overlay (use globalAlpha + rgb() to avoid rgba() string churn)
                                                        if (a > 0.001) {
                                                            ctx.globalCompositeOperation = comp;
                                                            ctx.globalAlpha = a;
                                                            ctx.fillStyle = cache.tintRGB || 'rgb(0,0,0)';
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 2) Lightning flash (screen + cached gradient)
                                                        if (lightning > 0.001) {
                                                            const f = Math.min(1, Math.max(0, lightning));

                                                            ctx.globalCompositeOperation = 'screen';

                                                            // Fullscreen flash
                                                            ctx.globalAlpha = 0.10 + 0.34 * f;
                                                            ctx.fillStyle = 'rgb(210,230,255)';
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            // Radial highlight
                                                            if (cache.lg) {
                                                                ctx.globalAlpha = 0.18 * f;
                                                                ctx.fillStyle = cache.lg;
                                                                ctx.fillRect(0, 0, wPx, hPx);
                                                            }
                                                        }

                                                        // Reset
                                                        ctx.globalAlpha = 1;
                                                        ctx.globalCompositeOperation = 'source-over';
                                                        try { ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        ctx.restore();
                                                    };
                                                }

                                                // ───────────────────────── Game.render: draw weather overlay after main render/postFX (keeps rain cheap, avoids DOM particles)
                                                if (Game && Game.prototype && !Game.prototype.__weatherCanvasFxRenderInstalled) {
                                                    Game.prototype.__weatherCanvasFxRenderInstalled = true;

                                                    const _oldRender = Game.prototype.render;

                                                    Game.prototype.render = function () {
                                                        _oldRender.call(this);

                                                        // Lazy init overlay
                                                        if (!this._weatherCanvasFx) {
                                                            try {
                                                                const c = ensureWeatherCanvas();
                                                                this._weatherCanvasFx = new TU.WeatherCanvasFX(c);
                                                            } catch (_) {
                                                                this._weatherCanvasFx = null;
                                                            }
                                                        }

                                                        if (!this._weatherCanvasFx) return;

                                                        // Render overlay
                                                        try {
                                                            this._weatherCanvasFx.render(this.weather, this.renderer);

                                                            try {
                                                                const __c = this._weatherCanvasFx && this._weatherCanvasFx.canvas;
                                                                const __r = this.renderer;
                                                                if (__c && __r && __r.ctx) __r.ctx.drawImage(__c, 0, 0, __r.w, __r.h);
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: tu_experience_optimizations_v3 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_experience_optimizations_v3',
                                            order: 70,
                                            description: "体验优化（v3）",
                                            apply: () => {
                                                const TU = window.TU || {};
                                                const Game = TU.Game;
                                                const InputManager = TU.InputManager;
                                                const AudioManager = TU.AudioManager;

                                                // ───────────────────────── 1) Dispatch tu:gameReady after init completes ─────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__tuGameReadyEvent) {
                                                    Game.prototype.__tuGameReadyEvent = true;
                                                    const _init = Game.prototype.init;
                                                    if (typeof _init === 'function') {
                                                        Game.prototype.init = async function (...args) {
                                                            const r = await _init.apply(this, args);
                                                            try {
                                                                document.dispatchEvent(new CustomEvent('tu:gameReady', { detail: { game: this } }));
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── 2) Input safety + mouse wheel hotbar (desktop QoL) ─────────────────────────
                                                if (InputManager && InputManager.prototype && !InputManager.prototype.__tuInputSafety) {
                                                    InputManager.prototype.__tuInputSafety = true;
                                                    const _bind = InputManager.prototype.bind;

                                                    InputManager.prototype.bind = function (...args) {
                                                        if (typeof _bind === 'function') _bind.apply(this, args);

                                                        if (this.__tuExtraBound) return;
                                                        this.__tuExtraBound = true;

                                                        const game = this.game;

                                                        const resetKeys = () => {
                                                            if (!game || !game.input) return;
                                                            game.input.left = false;
                                                            game.input.right = false;
                                                            game.input.jump = false;
                                                            game.input.sprint = false;
                                                        };
                                                        const resetMouseButtons = () => {
                                                            if (!game || !game.input) return;
                                                            game.input.mouseLeft = false;
                                                            game.input.mouseRight = false;
                                                        };
                                                        const resetAll = () => { resetKeys(); resetMouseButtons(); };

                                                        // Window blur/tab switch: avoid “stuck key/button”
                                                        window.addEventListener('blur', resetAll, { passive: true });
                                                        document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll(); }, { passive: true });

                                                        // Mouse leaves canvas: clear mouse buttons to avoid “stuck mining/placing”
                                                        if (game && game.canvas) {
                                                            game.canvas.addEventListener('mouseleave', resetMouseButtons, { passive: true });
                                                        }
                                                        // Mouse up anywhere: clear buttons even if released outside canvas
                                                        window.addEventListener('mouseup', resetMouseButtons, { passive: true });

                                                        // Mouse wheel: switch hotbar slot (1..9)
                                                        const onWheel = (e) => {
                                                            if (e.ctrlKey) return; // allow browser zoom / trackpad pinch
                                                            const g = game || window.__GAME_INSTANCE__;
                                                            if (!g || !g.ui || !g.player) return;

                                                            // If UI modal open, do nothing
                                                            const modal = (g.inventoryUI && g.inventoryUI.isOpen) ||
                                                                (g.crafting && g.crafting.isOpen) ||
                                                                g.paused || g._inputBlocked;
                                                            if (modal) return;

                                                            const dx = Number(e.deltaX) || 0;
                                                            const dy = Number(e.deltaY) || 0;
                                                            const delta = (Math.abs(dy) >= Math.abs(dx)) ? dy : dx;

                                                            // Ignore tiny noise
                                                            if (!delta || Math.abs(delta) < 1) return;

                                                            e.preventDefault();

                                                            const dir = delta > 0 ? 1 : -1;
                                                            const size = 9;

                                                            const cur = (Number.isFinite(g.player.selectedSlot) ? g.player.selectedSlot : 0) | 0;
                                                            const next = (cur + dir + size) % size;
                                                            try { g.ui.selectSlot(next); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };

                                                        if (game && game.canvas && !game.canvas.__tuWheelBound) {
                                                            game.canvas.__tuWheelBound = true;
                                                            game.canvas.addEventListener('wheel', onWheel, { passive: false });
                                                        }
                                                    };
                                                }

                                                // ───────────────────────── 3) Low-power CSS: reduce expensive UI effects ─────────────────────────
                                                const ensureLowPowerCSS = () => {
                                                    if (document.getElementById('tu-low-power-css')) return;
                                                    const style = document.createElement('style');
                                                    style.id = 'tu-low-power-css';
                                                    style.textContent = `
            /* Low power mode: reduce expensive backdrop-filter / shadows / animations */
            html.low-power *, html.low-power *::before, html.low-power *::after {
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
            }
            html.low-power .shimmer,
            html.low-power .pulse,
            html.low-power .sparkle,
            html.low-power .floating,
            html.low-power .glow {
              animation: none !important;
            }
            html.low-power #ambient-particles {
              opacity: 0.5 !important;
              filter: none !important;
            }
          `;
                                                    document.head.appendChild(style);
                                                };

                                                if (Game && Game.prototype && !Game.prototype.__tuLowPowerCssHook) {
                                                    Game.prototype.__tuLowPowerCssHook = true;
                                                    ensureLowPowerCSS();

                                                    const _setQuality = Game.prototype._setQuality;
                                                    if (typeof _setQuality === 'function') {
                                                        Game.prototype._setQuality = function (level) {
                                                            const r = _setQuality.call(this, level);
                                                            try {
                                                                document.documentElement.classList.toggle('low-power', level === 'low');
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── 4) Weather ambience audio: enable flag fix + suspend on hidden ─────────────────────────
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__tuAudioVisPatch) {
                                                    AudioManager.prototype.__tuAudioVisPatch = true;

                                                    // Fix: updateWeatherAmbience uses this.enabled, but base AudioManager doesn't define it
                                                    if (typeof AudioManager.prototype.updateWeatherAmbience === 'function') {
                                                        const _ua = AudioManager.prototype.updateWeatherAmbience;
                                                        AudioManager.prototype.updateWeatherAmbience = function (dtMs, weather) {
                                                            if (typeof this.enabled === 'undefined') this.enabled = true;
                                                            return _ua.call(this, dtMs, weather);
                                                        };
                                                    }

                                                    // Battery saver: suspend audio context when hidden
                                                    const suspendAudio = () => {
                                                        const g = window.__GAME_INSTANCE__;
                                                        const audio = g && g.audio;
                                                        const ctx = audio && audio.ctx;
                                                        if (!ctx) return;
                                                        try { if (ctx.state === 'running') ctx.suspend().catch(() => { }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                    const resumeAudio = () => {
                                                        const g = window.__GAME_INSTANCE__;
                                                        const audio = g && g.audio;
                                                        const ctx = audio && audio.ctx;
                                                        if (!ctx) return;
                                                        try { if (ctx.state === 'suspended') ctx.resume().catch(() => { }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };

                                                    document.addEventListener('visibilitychange', () => {
                                                        if (document.hidden) suspendAudio();
                                                        else resumeAudio();
                                                    }, { passive: true });

                                                    // pagehide: always suspend (best-effort)
                                                    window.addEventListener('pagehide', suspendAudio, { passive: true });
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: v9_biomes_mines_dynamic_water_pumps_clouds_reverb ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'v9_biomes_mines_dynamic_water_pumps_clouds_reverb',
                                            order: 80,
                                            description: "v9 生物群系/矿洞/动态水泵/云层/混响",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || (window.TU = {});
                                                const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : (TU.CONFIG || { TILE_SIZE: 16 });
                                                const BLOCK = (typeof window.BLOCK !== 'undefined') ? window.BLOCK : (TU.BLOCK || {});
                                                const BD = (typeof window.BLOCK_DATA !== 'undefined') ? window.BLOCK_DATA : (TU.BLOCK_DATA || {});
                                                const SOLID = (typeof window.BLOCK_SOLID !== 'undefined') ? window.BLOCK_SOLID : (TU.BLOCK_SOLID || new Uint8Array(256));
                                                const LIQ = (typeof window.BLOCK_LIQUID !== 'undefined') ? window.BLOCK_LIQUID : (TU.BLOCK_LIQUID || new Uint8Array(256));
                                                const TRANSP = (typeof window.BLOCK_TRANSPARENT !== 'undefined') ? window.BLOCK_TRANSPARENT : (TU.BLOCK_TRANSPARENT || new Uint8Array(256));
                                                const WALK = (typeof window.BLOCK_WALKABLE !== 'undefined') ? window.BLOCK_WALKABLE : (TU.BLOCK_WALKABLE || new Uint8Array(256));
                                                const BL = (typeof window.BLOCK_LIGHT !== 'undefined') ? window.BLOCK_LIGHT : null;
                                                const BH = (typeof window.BLOCK_HARDNESS !== 'undefined') ? window.BLOCK_HARDNESS : null;
                                                const BC = (typeof window.BLOCK_COLOR !== 'undefined') ? window.BLOCK_COLOR : null;
                                                const SD = (typeof window.SUN_DECAY !== 'undefined') ? window.SUN_DECAY : null;

                                                const Game = (typeof window.Game !== 'undefined') ? window.Game : (TU.Game || null);
                                                const Renderer = TU.Renderer || window.Renderer || null;
                                                const AudioManager = TU.AudioManager || window.AudioManager || null;
                                                const WorldGenerator = TU.WorldGenerator || window.WorldGenerator || null;

                                                // ─────────────────────────────────────────────────────────────
                                                // 0) Biome utilities (3 bands: forest/desert/snow)
                                                // ─────────────────────────────────────────────────────────────
                                                const Biomes = TU.Biomes || (TU.Biomes = {});
                                                Biomes.bandAt = function (worldW, x) {
                                                    const t = worldW > 0 ? (x / worldW) : 0.5;
                                                    if (t < 0.34) return 'forest';
                                                    if (t < 0.68) return 'desert';
                                                    return 'snow';
                                                };

                                                // ─────────────────────────────────────────────────────────────
                                                // 1) Add Pump + Pressure Plate blocks (logic compatible)
                                                // ─────────────────────────────────────────────────────────────
                                                const IDS = TU.LOGIC_BLOCKS || (TU.LOGIC_BLOCKS = {});
                                                function allocId(start) {
                                                    try {
                                                        const used = new Set();
                                                        if (BLOCK && typeof BLOCK === 'object') {
                                                            for (const k in BLOCK) used.add(BLOCK[k] | 0);
                                                        }
                                                        for (let id = start; id < 255; id++) {
                                                            if (BD[id] || used.has(id)) continue;
                                                            return id;
                                                        }
                                                    } catch { }
                                                    return start;
                                                }

                                                if (!IDS.PUMP_IN) IDS.PUMP_IN = allocId(206);
                                                if (!IDS.PUMP_OUT) IDS.PUMP_OUT = allocId((IDS.PUMP_IN | 0) + 1);
                                                if (!IDS.PLATE_OFF) IDS.PLATE_OFF = allocId((IDS.PUMP_OUT | 0) + 1);
                                                if (!IDS.PLATE_ON) IDS.PLATE_ON = allocId((IDS.PLATE_OFF | 0) + 1);

                                                function addBlock(id, def) {
                                                    try { BD[id] = def; } catch { }
                                                    try { SOLID[id] = def.solid ? 1 : 0; } catch { }
                                                    try { TRANSP[id] = def.transparent ? 1 : 0; } catch { }
                                                    try { LIQ[id] = def.liquid ? 1 : 0; } catch { }
                                                    try { if (BL) BL[id] = def.light ? (def.light | 0) : 0; } catch { }
                                                    try { if (BH) BH[id] = def.hardness ? +def.hardness : 0; } catch { }
                                                    try { if (BC) BC[id] = def.color; } catch { }
                                                    try { if (WALK) WALK[id] = def.solid ? 0 : 1; } catch { }
                                                    try {
                                                        if (SD) {
                                                            const AIR = (BLOCK && BLOCK.AIR !== undefined) ? BLOCK.AIR : 0;
                                                            let v = 0;
                                                            if (def.solid && !def.transparent) v = 3;
                                                            else if (def.transparent && id !== AIR) v = 1;
                                                            SD[id] = v;
                                                        }
                                                    } catch { }
                                                }

                                                try {
                                                    if (!BD[IDS.PUMP_IN]) {
                                                        addBlock(IDS.PUMP_IN, { name: '泵(入水口)', solid: true, transparent: false, liquid: false, light: 0, hardness: 1.2, color: '#3b3f46' });
                                                        addBlock(IDS.PUMP_OUT, { name: '泵(出水口)', solid: true, transparent: false, liquid: false, light: 0, hardness: 1.2, color: '#3b3f46' });
                                                        addBlock(IDS.PLATE_OFF, { name: '压力板', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.3, color: '#a37c57' });
                                                        addBlock(IDS.PLATE_ON, { name: '压力板(触发)', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.3, color: '#d6a77a' });
                                                    }
                                                } catch (e) { console.warn('pump/plate block register failed', e); }

                                                // Pixel art for pump/plate (optional)
                                                try {
                                                    if (typeof TextureGenerator !== 'undefined' && TextureGenerator.prototype && !TextureGenerator.prototype.__pumpPlatePixV1) {
                                                        TextureGenerator.prototype.__pumpPlatePixV1 = true;
                                                        const _old = TextureGenerator.prototype._drawPixelArt;
                                                        TextureGenerator.prototype._drawPixelArt = function (ctx, id, data) {
                                                            const s = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (id === IDS.PUMP_IN || id === IDS.PUMP_OUT) {
                                                                ctx.fillStyle = '#2b2f36'; ctx.fillRect(0, 0, s, s);
                                                                ctx.fillStyle = '#4a4f59'; ctx.fillRect(2, 2, s - 4, s - 4);
                                                                ctx.fillStyle = '#0f1115'; ctx.fillRect(4, 4, s - 8, s - 8);
                                                                ctx.fillStyle = (id === IDS.PUMP_IN) ? '#42a5f5' : '#64dd17';
                                                                ctx.fillRect(6, 6, 4, 4);
                                                                ctx.fillStyle = '#cfd8dc';
                                                                ctx.fillRect(11, 5, 2, 7);
                                                                ctx.fillRect(5, 11, 7, 2);
                                                                return;
                                                            }
                                                            if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) {
                                                                ctx.fillStyle = '#00000000'; ctx.clearRect(0, 0, s, s);
                                                                ctx.fillStyle = (id === IDS.PLATE_ON) ? '#d6a77a' : '#a37c57';
                                                                ctx.fillRect(2, s - 4, s - 4, 2);
                                                                ctx.fillStyle = '#00000033';
                                                                ctx.fillRect(2, s - 3, s - 4, 1);
                                                                return;
                                                            }
                                                            return _old.call(this, ctx, id, data);
                                                        };
                                                    }
                                                } catch { }

                                                // ─────────────────────────────────────────────────────────────
                                                // 2) WorldGenerator: 3-biome bands + biome sky palette + temple styles + multi-layer mines
                                                // ─────────────────────────────────────────────────────────────
                                                function fillEnclosedWalls(tiles, walls, x0, y0, w, h, wallId) {
                                                    try {
                                                        const WW = tiles.length | 0;
                                                        const HH = (tiles[0] ? tiles[0].length : 0) | 0;
                                                        if (!WW || !HH) return;

                                                        const x1 = Math.min(WW - 1, x0 + w - 1);
                                                        const y1 = Math.min(HH - 1, y0 + h - 1);
                                                        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
                                                        if (x1 <= x0 || y1 <= y0) return;

                                                        const bw = (x1 - x0 + 1) | 0;
                                                        const bh = (y1 - y0 + 1) | 0;
                                                        const mark = new Uint8Array(bw * bh);

                                                        const qx = [];
                                                        const qy = [];
                                                        const push = (xx, yy) => {
                                                            const ix = xx - x0, iy = yy - y0;
                                                            const k = ix + iy * bw;
                                                            if (mark[k]) return;
                                                            if (tiles[xx][yy] !== BLOCK.AIR) return;
                                                            mark[k] = 1;
                                                            qx.push(xx); qy.push(yy);
                                                        };

                                                        // Seed from boundary: "outside air"
                                                        for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
                                                        for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }

                                                        while (qx.length) {
                                                            const xx = qx.pop();
                                                            const yy = qy.pop();
                                                            if (xx > x0) push(xx - 1, yy);
                                                            if (xx < x1) push(xx + 1, yy);
                                                            if (yy > y0) push(xx, yy - 1);
                                                            if (yy < y1) push(xx, yy + 1);
                                                        }

                                                        // Fill enclosed air that is NOT connected to outside air
                                                        for (let yy = y0; yy <= y1; yy++) {
                                                            for (let xx = x0; xx <= x1; xx++) {
                                                                if (tiles[xx][yy] !== BLOCK.AIR) continue;
                                                                const ix = xx - x0, iy = yy - y0;
                                                                const k = ix + iy * bw;
                                                                if (!mark[k]) walls[xx][yy] = wallId & 255;
                                                            }
                                                        }
                                                    } catch { }
                                                }

                                                if (WorldGenerator && WorldGenerator.prototype) {
                                                    // 2.1 Biome: override to 3 bands, with slightly wavy borders
                                                    WorldGenerator.prototype._biome = function (x) {
                                                        const w = this.w | 0;
                                                        let t = w > 0 ? x / w : 0.5;
                                                        // Wavy boundaries (stable per seed) – keeps bands readable but not "cut by knife"
                                                        let n = 0;
                                                        try { n = this.biomeNoise ? this.biomeNoise.fbm(x * 0.006, 0, 2) : 0; } catch { }
                                                        t += n * 0.03;
                                                        if (t < 0.34) return 'forest';
                                                        if (t < 0.68) return 'desert';
                                                        return 'snow';
                                                    };

                                                    // 2.2 Biome-specific surface & subsurface blocks
                                                    WorldGenerator.prototype._getSurfaceBlock = function (biome) {
                                                        if (biome === 'snow') return BLOCK.SNOW_GRASS;
                                                        if (biome === 'desert') return BLOCK.SAND;
                                                        return BLOCK.GRASS;
                                                    };
                                                    WorldGenerator.prototype._getSubSurfaceBlock = function (biome) {
                                                        if (biome === 'snow') return Math.random() > 0.78 ? BLOCK.ICE : BLOCK.SNOW;
                                                        if (biome === 'desert') return Math.random() > 0.68 ? BLOCK.SANDSTONE : BLOCK.SAND;
                                                        return BLOCK.DIRT;
                                                    };

                                                    // 2.3 Biome-tinted underground composition (keeps original noise but nudges materials)
                                                    const _oldUG = WorldGenerator.prototype._getUndergroundBlock;
                                                    WorldGenerator.prototype._getUndergroundBlock = function (x, y, layer) {
                                                        const biome = this._biome(x);
                                                        const base = _oldUG ? _oldUG.call(this, x, y, layer) : BLOCK.STONE;
                                                        if (biome === 'desert') {
                                                            if (layer === 'upper') return (Math.random() > 0.65) ? BLOCK.SANDSTONE : (Math.random() > 0.8 ? BLOCK.LIMESTONE : base);
                                                            if (layer === 'middle') return (Math.random() > 0.55) ? BLOCK.SANDSTONE : (Math.random() > 0.75 ? BLOCK.GRANITE : base);
                                                            return (Math.random() > 0.6) ? BLOCK.BASALT : base;
                                                        }
                                                        if (biome === 'snow') {
                                                            if (layer === 'upper') return (Math.random() > 0.82) ? BLOCK.ICE : base;
                                                            if (layer === 'middle') return (Math.random() > 0.7) ? BLOCK.GRANITE : (Math.random() > 0.86 ? BLOCK.ICE : base);
                                                            return (Math.random() > 0.78) ? BLOCK.OBSIDIAN : base;
                                                        }
                                                        return base;
                                                    };

                                                    // 2.4 Temple styles by depth (brick / marble / granite / hell)
                                                    WorldGenerator.prototype._placeTemple = function (tiles, walls, x, y) {
                                                        const w = 14 + ((Math.random() * 10) | 0);
                                                        const h = 9 + ((Math.random() * 6) | 0);

                                                        const WW = this.w | 0, HH = this.h | 0;
                                                        const depth01 = HH > 0 ? (y / HH) : 0.6;
                                                        const biome = this._biome(x);

                                                        let shell = BLOCK.BRICK;
                                                        let accent = BLOCK.COBBLESTONE;
                                                        let wallId = 2;

                                                        if (depth01 < 0.58) {
                                                            shell = (biome === 'desert') ? BLOCK.SANDSTONE : (Math.random() > 0.5 ? BLOCK.BRICK : BLOCK.COBBLESTONE);
                                                            accent = BLOCK.PLANKS;
                                                            wallId = 1;
                                                        } else if (depth01 < 0.78) {
                                                            shell = BLOCK.MARBLE;
                                                            accent = (biome === 'desert') ? BLOCK.SANDSTONE : BLOCK.BRICK;
                                                            wallId = 2;
                                                        } else if (depth01 < 0.90) {
                                                            shell = BLOCK.GRANITE;
                                                            accent = BLOCK.SLATE;
                                                            wallId = 2;
                                                        } else {
                                                            shell = BLOCK.OBSIDIAN;
                                                            accent = BLOCK.BASALT;
                                                            wallId = 3;
                                                        }

                                                        const tlx = x, tly = y;
                                                        for (let dx = 0; dx < w; dx++) {
                                                            for (let dy = 0; dy < h; dy++) {
                                                                const tx = tlx + dx, ty = tly + dy;
                                                                if (tx < 1 || tx >= WW - 1 || ty < 1 || ty >= HH - 1) continue;

                                                                const border = (dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1);
                                                                const pillar = ((dx === 3 || dx === w - 4) && dy > 1 && dy < h - 2);
                                                                const cornice = (dy === 1 && (dx % 3 === 0));
                                                                if (border || pillar) tiles[tx][ty] = shell;
                                                                else if (cornice && Math.random() > 0.4) tiles[tx][ty] = accent;
                                                                else { tiles[tx][ty] = BLOCK.AIR; walls[tx][ty] = wallId; }
                                                            }
                                                        }

                                                        // Inner details by style
                                                        const cx = tlx + (w >> 1);
                                                        const cy = tly + h - 2;

                                                        if (cx > 1 && cx < WW - 1 && cy > 1 && cy < HH - 1) {
                                                            tiles[cx][cy] = BLOCK.TREASURE_CHEST;
                                                            if (tly + 1 < HH) tiles[cx][tly + 1] = BLOCK.LANTERN;

                                                            // ornaments
                                                            const gem = (depth01 < 0.78) ? BLOCK.CRYSTAL : (depth01 < 0.90 ? BLOCK.AMETHYST : BLOCK.OBSIDIAN);
                                                            for (let i = 0; i < 6; i++) {
                                                                const ox = cx + ((i % 3) - 1) * 2;
                                                                const oy = cy - 1 - ((i / 3) | 0);
                                                                if (ox > 1 && ox < WW - 1 && oy > 1 && oy < HH - 1 && tiles[ox][oy] === BLOCK.AIR) tiles[ox][oy] = gem;
                                                            }
                                                        }

                                                        // Auto-fill background walls in enclosed interior (for "indoor" checks)
                                                        fillEnclosedWalls(tiles, walls, tlx, tly, w, h, wallId);

                                                        // Light cobwebs near ceiling (only shallow styles)
                                                        if (depth01 < 0.85) {
                                                            const webN = 3 + ((Math.random() * 5) | 0);
                                                            for (let i = 0; i < webN; i++) {
                                                                const wx = tlx + 1 + ((Math.random() * (w - 2)) | 0);
                                                                const wy = tly + 1 + ((Math.random() * 3) | 0);
                                                                if (wx > 0 && wx < WW && wy > 0 && wy < HH && tiles[wx][wy] === BLOCK.AIR) tiles[wx][wy] = BLOCK.SPIDER_WEB;
                                                            }
                                                        }
                                                    };

                                                    // 2.5 Multi-layer mines (connected tunnels, rooms, shafts)
                                                    WorldGenerator.prototype._generateMultiLayerMines = function (tiles, walls) {
                                                        const WW = this.w | 0, HH = this.h | 0;
                                                        const levels = 3 + ((Math.random() * 2) | 0); // 3-4
                                                        const y0 = (HH * 0.42) | 0;
                                                        const yStep = (HH * 0.10) | 0;

                                                        const carve = (x, y, r, wallId) => {
                                                            for (let dx = -r; dx <= r; dx++) {
                                                                for (let dy = -r; dy <= r; dy++) {
                                                                    if ((dx * dx + dy * dy) > (r * r + 0.4)) continue;
                                                                    const xx = x + dx, yy = y + dy;
                                                                    if (xx < 2 || xx >= WW - 2 || yy < 2 || yy >= HH - 2) continue;
                                                                    tiles[xx][yy] = BLOCK.AIR;
                                                                    walls[xx][yy] = wallId & 255;
                                                                }
                                                            }
                                                        };

                                                        const placeSupport = (x, y, wallId) => {
                                                            // 3-high tunnel supports: |-| with occasional torch
                                                            for (let dy = -1; dy <= 1; dy++) {
                                                                const yy = y + dy;
                                                                if (yy < 2 || yy >= HH - 2) continue;
                                                                if (x - 1 > 1) tiles[x - 1][yy] = BLOCK.PLANKS;
                                                                if (x + 1 < WW - 2) tiles[x + 1][yy] = BLOCK.PLANKS;
                                                            }
                                                            if (y - 2 > 1) tiles[x][y - 2] = BLOCK.PLANKS;
                                                            if (Math.random() > 0.6 && x - 2 > 1 && y > 2) tiles[x - 2][y] = BLOCK.TORCH;
                                                            // make interior count as "indoors"
                                                            if (walls[x][y] === 0) walls[x][y] = wallId & 255;
                                                        };

                                                        const placeRoom = (rx, ry, wallId) => {
                                                            const rw = 9 + ((Math.random() * 6) | 0);
                                                            const rh = 6 + ((Math.random() * 4) | 0);
                                                            const tlx = rx - (rw >> 1);
                                                            const tly = ry - (rh >> 1);
                                                            if (tlx < 3 || tly < 3 || tlx + rw >= WW - 3 || tly + rh >= HH - 3) return;
                                                            for (let dx = 0; dx < rw; dx++) {
                                                                for (let dy = 0; dy < rh; dy++) {
                                                                    const x = tlx + dx, y = tly + dy;
                                                                    const border = (dx === 0 || dx === rw - 1 || dy === 0 || dy === rh - 1);
                                                                    if (border) tiles[x][y] = (Math.random() > 0.5) ? BLOCK.PLANKS : BLOCK.COBBLESTONE;
                                                                    else { tiles[x][y] = BLOCK.AIR; walls[x][y] = wallId & 255; }
                                                                }
                                                            }
                                                            fillEnclosedWalls(tiles, walls, tlx, tly, rw, rh, wallId);
                                                            // Decor: lantern + chest by depth
                                                            if (rx > 2 && ry > 2 && rx < WW - 2 && ry < HH - 2) {
                                                                tiles[rx][tly + 1] = BLOCK.LANTERN;
                                                                if (Math.random() > 0.45) tiles[tlx + rw - 2][tly + rh - 2] = BLOCK.TREASURE_CHEST;
                                                            }
                                                        };

                                                        // Build each level as a wiggly horizontal backbone
                                                        const wallId = 1;
                                                        for (let lv = 0; lv < levels; lv++) {
                                                            let y = y0 + lv * yStep + ((Math.random() * 10) | 0) - 5;
                                                            y = Math.max((HH * 0.34) | 0, Math.min((HH * 0.86) | 0, y));

                                                            let x = 20 + ((Math.random() * 20) | 0);
                                                            const xEnd = WW - 20 - ((Math.random() * 20) | 0);

                                                            let seg = 0;
                                                            while (x < xEnd) {
                                                                // carve tunnel
                                                                carve(x, y, 1, wallId);
                                                                carve(x, y - 1, 1, wallId);
                                                                carve(x, y + 1, 1, wallId);

                                                                // gentle vertical drift
                                                                if ((seg % 7) === 0) {
                                                                    const drift = (Math.random() < 0.5 ? -1 : 1);
                                                                    const ny = y + drift;
                                                                    if (ny > (HH * 0.30) && ny < (HH * 0.88)) y = ny;
                                                                }

                                                                // supports
                                                                if ((seg % 10) === 0) placeSupport(x, y, wallId);

                                                                // rooms
                                                                if ((seg % 38) === 0 && Math.random() > 0.35) placeRoom(x + 6, y, wallId);

                                                                x++;
                                                                seg++;
                                                            }
                                                        }

                                                        // Connect levels with shafts (vertical connectors)
                                                        const shaftN = 4 + ((Math.random() * 5) | 0);
                                                        for (let i = 0; i < shaftN; i++) {
                                                            const sx = 30 + ((Math.random() * (WW - 60)) | 0);
                                                            const top = y0 + ((Math.random() * 10) | 0);
                                                            const bot = y0 + (levels - 1) * yStep + ((Math.random() * 10) | 0);
                                                            const yA = Math.min(top, bot), yB = Math.max(top, bot);
                                                            for (let y = yA; y <= yB; y++) {
                                                                carve(sx, y, 1, wallId);
                                                                // platforms every few tiles
                                                                if ((y % 8) === 0) {
                                                                    if (sx - 1 > 1) tiles[sx - 1][y] = BLOCK.PLANKS;
                                                                    if (sx + 1 < WW - 2) tiles[sx + 1][y] = BLOCK.PLANKS;
                                                                }
                                                                if ((y % 12) === 0 && Math.random() > 0.5) tiles[sx][y] = BLOCK.TORCH;
                                                            }
                                                        }
                                                    };

                                                    // 2.6 Hook mines into structure pass
                                                    if (!WorldGenerator.prototype.__mineV9Hooked) {
                                                        WorldGenerator.prototype.__mineV9Hooked = true;
                                                        const _oldStructures = WorldGenerator.prototype._structures;
                                                        WorldGenerator.prototype._structures = function (tiles, walls) {
                                                            if (_oldStructures) _oldStructures.call(this, tiles, walls);
                                                            try { this._generateMultiLayerMines(tiles, walls); } catch (e) { console.warn('mine gen failed', e); }
                                                        };
                                                    }

                                                    // 2.7 Extend StructureLibrary with mine pieces (pattern based, compatible with ruin_shrine descriptor)
                                                    try {
                                                        const lib = TU.Structures;
                                                        if (lib && !TU.__mineDescsAddedV9) {
                                                            TU.__mineDescsAddedV9 = true;
                                                            lib.ensureLoaded && lib.ensureLoaded();
                                                            const extra = [
                                                                {
                                                                    id: 'mine_room_small',
                                                                    tags: ['mine', 'room'],
                                                                    weight: 3,
                                                                    depth: [0.40, 0.82],
                                                                    anchor: [0.5, 0.5],
                                                                    placement: { mode: 'underground', minSolidRatio: 0.40, defaultWall: 1 },
                                                                    pattern: [
                                                                        "###########",
                                                                        "#.........#",
                                                                        "#..t...t..#",
                                                                        "#....C....#",
                                                                        "#.........#",
                                                                        "#..t...t..#",
                                                                        "###########"
                                                                    ],
                                                                    legend: {
                                                                        "#": { tile: "PLANKS", replace: "any" },
                                                                        ".": { tile: "AIR", wall: 1, replace: "any" },
                                                                        "t": { tile: "TORCH", replace: "any" },
                                                                        "C": { tile: "TREASURE_CHEST", replace: "any" }
                                                                    },
                                                                    connectors: [
                                                                        { x: 0, y: 3, dir: "left", len: 14, carve: true, wall: 1 },
                                                                        { x: 10, y: 3, dir: "right", len: 14, carve: true, wall: 1 },
                                                                        { x: 5, y: 6, dir: "down", len: 10, carve: true, wall: 1 }
                                                                    ]
                                                                },
                                                                {
                                                                    id: 'mine_junction',
                                                                    tags: ['mine', 'junction'],
                                                                    weight: 2,
                                                                    depth: [0.45, 0.88],
                                                                    anchor: [0.5, 0.5],
                                                                    placement: { mode: 'underground', minSolidRatio: 0.40, defaultWall: 1 },
                                                                    pattern: [
                                                                        "#####",
                                                                        "#...#",
                                                                        "#...#",
                                                                        "#...#",
                                                                        "#####"
                                                                    ],
                                                                    legend: {
                                                                        "#": { tile: "COBBLESTONE", replace: "any" },
                                                                        ".": { tile: "AIR", wall: 1, replace: "any" }
                                                                    },
                                                                    connectors: [
                                                                        { x: 0, y: 2, dir: "left", len: 18, carve: true, wall: 1 },
                                                                        { x: 4, y: 2, dir: "right", len: 18, carve: true, wall: 1 },
                                                                        { x: 2, y: 0, dir: "up", len: 10, carve: true, wall: 1 },
                                                                        { x: 2, y: 4, dir: "down", len: 10, carve: true, wall: 1 }
                                                                    ]
                                                                }
                                                            ];
                                                            lib.loadFromArray && lib.loadFromArray(extra, { replace: false });
                                                        }
                                                    } catch { }
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 3) Treasure chest: depth-based loot table (on break)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__chestLootV9) {
                                                    Game.prototype.__chestLootV9 = true;

                                                    Game.prototype._rollChestLoot = function (depth01) {
                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const picks = [];
                                                        const add = (id, cMin, cMax, chance = 1) => {
                                                            if (Math.random() > chance) return;
                                                            const c = (cMin === cMax) ? cMin : (cMin + ((Math.random() * (cMax - cMin + 1)) | 0));
                                                            if (c > 0) picks.push([id, c]);
                                                        };

                                                        // Tier thresholds
                                                        if (d < 0.36) {
                                                            add(BLOCK.TORCH, 6, 14, 1);
                                                            add(BLOCK.WOOD, 10, 30, 0.85);
                                                            add(BLOCK.COPPER_ORE || BLOCK.STONE, 6, 18, 0.75);
                                                            add(BLOCK.IRON_ORE || BLOCK.STONE, 4, 12, 0.55);
                                                        } else if (d < 0.62) {
                                                            add(BLOCK.TORCH, 8, 18, 1);
                                                            add(BLOCK.IRON_ORE || BLOCK.STONE, 10, 24, 0.85);
                                                            add(BLOCK.SILVER_ORE || BLOCK.IRON_ORE || BLOCK.STONE, 6, 16, 0.6);
                                                            add(BLOCK.GOLD_ORE || BLOCK.SILVER_ORE || BLOCK.STONE, 3, 10, 0.45);
                                                            add(BLOCK.LIFE_CRYSTAL || BLOCK.CRYSTAL, 1, 1, 0.18);
                                                        } else if (d < 0.86) {
                                                            add(BLOCK.TORCH, 10, 20, 1);
                                                            add(BLOCK.GOLD_ORE || BLOCK.SILVER_ORE || BLOCK.STONE, 8, 22, 0.8);
                                                            add(BLOCK.DIAMOND_ORE || BLOCK.RUBY_ORE || BLOCK.CRYSTAL, 1, 3, 0.35);
                                                            add(BLOCK.MANA_CRYSTAL || BLOCK.AMETHYST || BLOCK.CRYSTAL, 1, 2, 0.25);
                                                            add(BLOCK.CRYSTAL, 2, 6, 0.55);
                                                        } else {
                                                            add(BLOCK.HELLSTONE || BLOCK.BASALT || BLOCK.STONE, 10, 26, 0.85);
                                                            add(BLOCK.OBSIDIAN || BLOCK.BASALT, 8, 20, 0.75);
                                                            add(BLOCK.DIAMOND_ORE || BLOCK.CRYSTAL, 2, 4, 0.35);
                                                            add(BLOCK.LAVA || BLOCK.OBSIDIAN, 1, 1, 0.10);
                                                        }

                                                        // Small bonus: building supplies
                                                        add(BLOCK.PLANKS || BLOCK.WOOD, 6, 16, 0.45);
                                                        add(BLOCK.LANTERN, 1, 1, 0.15);

                                                        // De-dup (merge same ids)
                                                        const m = new Map();
                                                        for (const [id, c] of picks) m.set(id, (m.get(id) || 0) + c);
                                                        return Array.from(m.entries());
                                                    };

                                                    Game.prototype._spawnTreasureChestLoot = function (tileX, tileY, px, py) {
                                                        try {
                                                            const ts = CFG.TILE_SIZE || 16;
                                                            const depth01 = (this.world && this.world.h) ? (tileY / this.world.h) : 0.5;
                                                            const drops = this._rollChestLoot(depth01);

                                                            // Drop the chest itself
                                                            this.droppedItems && this.droppedItems.spawn(px, py, BLOCK.TREASURE_CHEST, 1);

                                                            // Scatter loot a bit so pickups feel good
                                                            for (let i = 0; i < drops.length; i++) {
                                                                const [id, count] = drops[i];
                                                                const sx = px + ((Math.random() * 18) - 9);
                                                                const sy = py + ((Math.random() * 10) - 5);
                                                                this.droppedItems && this.droppedItems.spawn(sx, sy, id, count);
                                                            }

                                                            // Feedback
                                                            try { this.audio && this.audio.play('pickup'); } catch { }
                                                            try { this.particles && this.particles.emit(tileX * ts + 8, tileY * ts + 8, { color: '#ffd166', count: 18, speed: 3.5, up: true, glow: true }); } catch { }
                                                        } catch (e) {
                                                            // Fallback: at least drop chest block
                                                            try { this.droppedItems && this.droppedItems.spawn(px, py, BLOCK.TREASURE_CHEST, 1); } catch { }
                                                        }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 4) Dynamic Water v2 + U-tube pressure: upgrade TileLogicEngine worker + idle fallback
                                                // ─────────────────────────────────────────────────────────────
                                                function buildTileLogicWorkerSourceV9() {
                                                    // Keep message protocol identical to v12, but improve fluid + add plate/pump awareness in logic scan.
                                                    // NOTE: This string is intentionally "plain JS" (no template interpolations).
                                                    return `/* TileLogic Worker v12+ (v9 fluids) */
      (() => {
        let W = 0, H = 0;
        let tiles = null;
        let water = null;
        let solid = null;

        let AIR = 0, WATER = 27;
        let IDS = null;

        const region = { x0: 0, y0: 0, x1: -1, y1: -1, set: false };
        let lastRegionKey = '';
        let perfLevel = 'high';
        const MAX = 8;

        const waterQ = [];
        let waterMark = null;
        const logicQ = [];
        let logicMark = null;

        function idx(x, y) { return x * H + y; }

        function inRegionIndex(i) {
          if (!region.set) return false;
          const x = (i / H) | 0;
          const y = i - x * H;
          return (x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1);
        }

        function isWire(id)   { return id === IDS.WIRE_OFF || id === IDS.WIRE_ON; }
        function isSwitch(id) { return id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON || id === IDS.PLATE_OFF || id === IDS.PLATE_ON; }
        function isSource(id) { return id === IDS.SWITCH_ON || id === IDS.PLATE_ON; }
        function isLamp(id)   { return id === IDS.LAMP_OFF || id === IDS.LAMP_ON; }
        function isPump(id)   { return id === IDS.PUMP_IN || id === IDS.PUMP_OUT; }
        function isConductor(id) { return isWire(id) || isSwitch(id) || isPump(id); }

        function canWaterEnterTile(id) { return id === AIR || id === WATER; }

        function scheduleWater(i) {
          if (!waterMark) return;
          if (!inRegionIndex(i)) return;
          if (waterMark[i]) return;
          waterMark[i] = 1;
          waterQ.push(i);
        }

        function scheduleWaterAround(x, y) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          scheduleWater(idx(x, y));
          if (x > 0) scheduleWater(idx(x - 1, y));
          if (x + 1 < W) scheduleWater(idx(x + 1, y));
          if (y > 0) scheduleWater(idx(x, y - 1));
          if (y + 1 < H) scheduleWater(idx(x, y + 1));
        }

        function scheduleLogic(i) {
          if (!logicMark) return;
          if (!inRegionIndex(i)) return;
          if (logicMark[i]) return;
          logicMark[i] = 1;
          logicQ.push(i);
        }

        function scheduleLogicAround(x, y) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          scheduleLogic(idx(x, y));
          if (x > 0) scheduleLogic(idx(x - 1, y));
          if (x + 1 < W) scheduleLogic(idx(x + 1, y));
          if (y > 0) scheduleLogic(idx(x, y - 1));
          if (y + 1 < H) scheduleLogic(idx(x, y + 1));
        }

        function setTile(i, newId, changes) {
          const old = tiles[i];
          if (old === newId) return false;
          tiles[i] = newId;
          changes.push(i, old, newId);
          const x = (i / H) | 0;
          const y = i - x * H;
          scheduleWaterAround(x, y);
          scheduleLogicAround(x, y);
          return true;
        }

        function ensureWaterTile(i, changes) {
          if (water[i] > 0) {
            if (tiles[i] !== WATER) setTile(i, WATER, changes);
          } else {
            if (tiles[i] === WATER) setTile(i, AIR, changes);
          }
        }

        // Dynamic water with smoothing + limited pressure-up (U-tube-ish)
        function waterTick(i, changes) {
          waterMark[i] = 0;
          if (!inRegionIndex(i)) return;

          let a = water[i] | 0;
          if (a <= 0) return;

          const tid = tiles[i];
          if (tid !== WATER && tid !== AIR) { water[i] = 0; return; }

          const x = (i / H) | 0;
          const y = i - x * H;

          // Snapshot neighbors (avoid directional bias)
          const down = (y + 1 < H) ? (i + 1) : -1;
          const up   = (y > 0) ? (i - 1) : -1;
          const left = (x > 0) ? (i - H) : -1;
          const right= (x + 1 < W) ? (i + H) : -1;

          // 1) Down flow (strong)
          if (down !== -1 && canWaterEnterTile(tiles[down])) {
            const b = water[down] | 0;
            const space = MAX - b;
            if (space > 0) {
              const mv = (a < space) ? a : space;
              water[i] = a - mv;
              water[down] = b + mv;
              a = water[i] | 0;

              ensureWaterTile(i, changes);
              ensureWaterTile(down, changes);

              scheduleWater(down);
              scheduleWater(i);
              scheduleWaterAround(x, y);
              scheduleWaterAround(x, y + 1);
            }
          }
          if (a <= 0) return;

          // 2) Horizontal smoothing (simultaneous-ish)
          let a0 = a;
          let mvL = 0, mvR = 0;

          if (left !== -1 && canWaterEnterTile(tiles[left])) {
            const b = water[left] | 0;
            const diff = a0 - b;
            if (diff > 1) {
              mvL = (diff / 3) | 0; // gentler than half, smoother
              if (mvL < 1) mvL = 1;
              const space = MAX - b;
              if (mvL > space) mvL = space;
            }
          }
          if (right !== -1 && canWaterEnterTile(tiles[right])) {
            const b = water[right] | 0;
            const diff = a0 - b;
            if (diff > 1) {
              mvR = (diff / 3) | 0;
              if (mvR < 1) mvR = 1;
              const space = MAX - b;
              if (mvR > space) mvR = space;
            }
          }

          // Cap total move to available water
          const tot = mvL + mvR;
          if (tot > a0) {
            // scale down proportionally
            mvL = ((mvL * a0) / tot) | 0;
            mvR = a0 - mvL;
          }

          if (mvL > 0 && left !== -1) {
            water[i] = (water[i] | 0) - mvL;
            water[left] = (water[left] | 0) + mvL;
            ensureWaterTile(i, changes);
            ensureWaterTile(left, changes);
            scheduleWater(left); scheduleWater(i);
          }
          if (mvR > 0 && right !== -1) {
            water[i] = (water[i] | 0) - mvR;
            water[right] = (water[right] | 0) + mvR;
            ensureWaterTile(i, changes);
            ensureWaterTile(right, changes);
            scheduleWater(right); scheduleWater(i);
          }

          a = water[i] | 0;
          if (a <= 0) return;

          // 3) Pressure-up (limited): if fully pressurized and blocked below, allow a tiny move upward
          if (up !== -1 && canWaterEnterTile(tiles[up])) {
            const ub = water[up] | 0;
            const belowBlocked = (down === -1) || !canWaterEnterTile(tiles[down]) || (water[down] | 0) >= MAX;
            if (belowBlocked && a >= MAX && ub + 1 < a && ub < MAX) {
              water[i] = (water[i] | 0) - 1;
              water[up] = ub + 1;
              ensureWaterTile(i, changes);
              ensureWaterTile(up, changes);
              scheduleWater(up); scheduleWater(i);
            }
          }
        }

        // Logic: same as v12, but treat pressure plate as switch/source and pumps as conductors (for connectivity)
        let vis = null;
        let stamp = 1;
        function ensureVis() {
          const N = W * H;
          if (!vis || vis.length !== N) vis = new Uint32Array(N);
        }

        function lampShouldOn(iLamp) {
          const x = (iLamp / H) | 0;
          const y = iLamp - x * H;
          if (x > 0) { const t = tiles[iLamp - H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (x + 1 < W) { const t = tiles[iLamp + H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y > 0) { const t = tiles[iLamp - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y + 1 < H) { const t = tiles[iLamp + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          return false;
        }

        function updateLampAt(iLamp, changes) {
          const t = tiles[iLamp];
          if (!(t === IDS.LAMP_OFF || t === IDS.LAMP_ON)) return;
          const want = lampShouldOn(iLamp) ? IDS.LAMP_ON : IDS.LAMP_OFF;
          if (t !== want) setTile(iLamp, want, changes);
        }

        function logicRecomputeFromSeed(seed, changes) {
          logicMark[seed] = 0;

          ensureVis();
          stamp = (stamp + 1) >>> 0;
          if (stamp === 0) { stamp = 1; vis.fill(0); }

          const starts = [];
          const sid = tiles[seed];
          if (isConductor(sid) || isLamp(sid)) starts.push(seed);
          else {
            const x = (seed / H) | 0;
            const y = seed - x * H;
            if (x > 0) { const n = seed - H; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (x + 1 < W) { const n = seed + H; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (y > 0) { const n = seed - 1; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (y + 1 < H) { const n = seed + 1; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
          }
          if (!starts.length) return;

          const q = [];
          const comp = [];
          let powered = false;

          for (let si = 0; si < starts.length; si++) {
            const s = starts[si];
            if (vis[s] === stamp) continue;
            vis[s] = stamp;
            q.push(s);

            while (q.length) {
              const i = q.pop();
              const t = tiles[i];
              if (!(isConductor(t) || isLamp(t))) continue;

              comp.push(i);
              if (isSource(t)) powered = true;

              const x = (i / H) | 0;
              const y = i - x * H;

              if (x > 0) { const n = i - H; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (x + 1 < W) { const n = i + H; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (y > 0) { const n = i - 1; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (y + 1 < H) { const n = i + 1; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }

              if (comp.length > 14000) break;
            }
            if (comp.length > 14000) break;
          }

          const wantWire = powered ? IDS.WIRE_ON : IDS.WIRE_OFF;
          for (let i = 0; i < comp.length; i++) {
            const p = comp[i];
            const t = tiles[p];
            if (isWire(t) && t !== wantWire) setTile(p, wantWire, changes);
            if (isLamp(t)) updateLampAt(p, changes);
          }
        }

        function primeRegionWork() {
          if (!region.set) return;
          for (let x = region.x0; x <= region.x1; x++) {
            const base = x * H;
            for (let y = region.y0; y <= region.y1; y++) {
              const i = base + y;
              if (water[i] > 0) scheduleWater(i);
              const t = tiles[i];
              if (t === IDS.SWITCH_ON || t === IDS.PLATE_ON || isWire(t) || isLamp(t) || isPump(t)) scheduleLogic(i);
            }
          }
        }

        // Optional: pump tick inside region (small budget), teleports 1 water unit between linked pumps along wires
        const pumpQ = [];
        const pumpMark = new Uint8Array(1);
        let pumpAcc = 0;

        function schedulePumpInRegion() {
          if (!region.set) return;
          pumpQ.length = 0;
          for (let x = region.x0; x <= region.x1; x++) {
            const base = x * H;
            for (let y = region.y0; y <= region.y1; y++) {
              const i = base + y;
              if (tiles[i] === IDS.PUMP_IN) pumpQ.push(i);
            }
          }
        }

        function pumpPowered(iPump) {
          const x = (iPump / H) | 0;
          const y = iPump - x * H;
          if (x > 0) { const t = tiles[iPump - H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (x + 1 < W) { const t = tiles[iPump + H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y > 0) { const t = tiles[iPump - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y + 1 < H) { const t = tiles[iPump + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          return false;
        }

        function findPumpOut(iSeed, maxNodes) {
          ensureVis();
          stamp = (stamp + 1) >>> 0;
          if (stamp === 0) { stamp = 1; vis.fill(0); }

          const q = [iSeed];
          vis[iSeed] = stamp;

          let found = -1;
          let nodes = 0;

          while (q.length && nodes < maxNodes) {
            const i = q.pop();
            nodes++;

            const t = tiles[i];
            if (t === IDS.PUMP_OUT) { found = i; break; }

            const x = (i / H) | 0;
            const y = i - x * H;

            // Traverse conductors (wire/switch/plate/pumps)
            const tryN = (n) => {
              if (n < 0 || n >= W * H) return;
              if (vis[n] === stamp) return;
              const tt = tiles[n];
              if (!isConductor(tt)) return;
              vis[n] = stamp;
              q.push(n);
            };

            if (x > 0) tryN(i - H);
            if (x + 1 < W) tryN(i + H);
            if (y > 0) tryN(i - 1);
            if (y + 1 < H) tryN(i + 1);
          }

          return found;
        }

        function pumpTransfer(iIn, iOut, changes) {
          const xi = (iIn / H) | 0;
          const yi = iIn - xi * H;
          const xo = (iOut / H) | 0;
          const yo = iOut - xo * H;

          // intake neighbor preference: below, left, right, up
          const nIn = [];
          if (yi + 1 < H) nIn.push(iIn + 1);
          if (xi > 0) nIn.push(iIn - H);
          if (xi + 1 < W) nIn.push(iIn + H);
          if (yi > 0) nIn.push(iIn - 1);

          let took = 0;
          for (let k = 0; k < nIn.length && took < 2; k++) {
            const n = nIn[k];
            if (!canWaterEnterTile(tiles[n])) continue;
            const a = water[n] | 0;
            if (a <= 0) continue;
            water[n] = a - 1;
            took++;
            ensureWaterTile(n, changes);
            scheduleWater(n);
          }
          if (took <= 0) return;

          // output neighbor preference: above, right, left, down
          const nOut = [];
          if (yo > 0) nOut.push(iOut - 1);
          if (xo + 1 < W) nOut.push(iOut + H);
          if (xo > 0) nOut.push(iOut - H);
          if (yo + 1 < H) nOut.push(iOut + 1);

          for (let t = 0; t < took; t++) {
            let placed = false;
            for (let k = 0; k < nOut.length; k++) {
              const n = nOut[k];
              if (!canWaterEnterTile(tiles[n])) continue;
              const b = water[n] | 0;
              if (b >= MAX) continue;
              water[n] = b + 1;
              ensureWaterTile(n, changes);
              scheduleWater(n);
              placed = true;
              break;
            }
            if (!placed) break;
          }
        }

        function step() {
          const changes = [];

          const waterBudget = (perfLevel === 'low') ? 420 : 1100;
          for (let ops = 0; ops < waterBudget && waterQ.length; ops++) {
            waterTick(waterQ.pop(), changes);
          }

          const logicBudget = 1;
          for (let ops = 0; ops < logicBudget && logicQ.length; ops++) {
            logicRecomputeFromSeed(logicQ.pop(), changes);
          }

          // Pump budget (light): run once every ~6 ticks
          pumpAcc = (pumpAcc + 1) | 0;
          if ((pumpAcc % 6) === 0) {
            if (!pumpQ.length) schedulePumpInRegion();
            const pumpBudget = (perfLevel === 'low') ? 1 : 2;
            for (let p = 0; p < pumpBudget && pumpQ.length; p++) {
              const iIn = pumpQ.pop();
              if (!pumpPowered(iIn)) continue;
              const out = findPumpOut(iIn, 9000);
              if (out !== -1) pumpTransfer(iIn, out, changes);
            }
          }

          if (changes.length) {
            const buf = new Int32Array(changes);
            postMessage({ type: 'changes', buf: buf.buffer }, [buf.buffer]);
          }

          const tickMs = (perfLevel === 'low') ? 55 : 35;
          setTimeout(step, tickMs);
        }

        onmessage = (e) => {
          const m = e.data;
          if (!m || !m.type) return;

          switch (m.type) {
            case 'init': {
              W = m.w | 0;
              H = m.h | 0;
              IDS = m.ids || {};
              AIR = (m.blocks && (m.blocks.AIR | 0) >= 0) ? (m.blocks.AIR | 0) : 0;
              WATER = (m.blocks && (m.blocks.WATER | 0) >= 0) ? (m.blocks.WATER | 0) : 27;

              tiles = new Uint8Array(m.tiles);
              solid = new Uint8Array(m.solid);

              const N = W * H;
              water = new Uint8Array(N);
              waterMark = new Uint8Array(N);
              logicMark = new Uint8Array(N);
              ensureVis();

              for (let i = 0; i < N; i++) if (tiles[i] === WATER) water[i] = MAX;

              step();
              break;
            }

            case 'tileWrite': {
              if (!tiles) return;
              const x = m.x | 0;
              const y = m.y | 0;
              if (x < 0 || y < 0 || x >= W || y >= H) return;

              const i = idx(x, y);
              const newId = m.id | 0;
              const oldId = tiles[i];
              tiles[i] = newId;

              if (newId === WATER) {
                water[i] = MAX;
                scheduleWaterAround(x, y);
              } else if (oldId === WATER && newId !== WATER) {
                water[i] = 0;
                scheduleWaterAround(x, y);
              }

              scheduleLogicAround(x, y);
              break;
            }

            case 'region': {
              const cx = m.cx | 0, cy = m.cy | 0;
              const rx = m.rx | 0, ry = m.ry | 0;

              const x0 = Math.max(0, cx - rx);
              const x1 = Math.min(W - 1, cx + rx);
              const y0 = Math.max(0, cy - ry);
              const y1 = Math.min(H - 1, cy + ry);

              const key = x0 + ',' + y0 + ',' + x1 + ',' + y1;
              if (key !== lastRegionKey) {
                lastRegionKey = key;
                region.x0 = x0; region.x1 = x1; region.y0 = y0; region.y1 = y1; region.set = true;
                primeRegionWork();
                schedulePumpInRegion();
              } else {
                region.set = true;
              }
              break;
            }

            case 'perf': {
              perfLevel = m.level || 'high';
              break;
            }
          }
        };
      })();`;
                                                }

                                                try {
                                                    const TileLogicEngine = TU.TileLogicEngine;
                                                    if (TileLogicEngine && !TileLogicEngine.__workerV9Installed) {
                                                        TileLogicEngine.__workerV9Installed = true;
                                                        TileLogicEngine._workerSource = buildTileLogicWorkerSourceV9;

                                                        // Upgrade running instance (if any)
                                                        const g = window.__GAME_INSTANCE__;
                                                        if (g && g.tileLogic && g.tileLogic.worker) {
                                                            try { g.tileLogic.worker.terminate(); } catch { }
                                                            g.tileLogic.worker = null;
                                                            try { g.tileLogic._initWorker && g.tileLogic._initWorker(); } catch { }
                                                        }
                                                    }
                                                } catch (e) {
                                                    console.warn('TileLogicEngine upgrade failed', e);
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 5) Light propagation: stronger shadowing for solid opaque blocks
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__shadowLightV9) {
                                                    Game.prototype.__shadowLightV9 = true;

                                                    // ═══════════════════ 光照传播优化 ═══════════════════
                                                    // 注意：OptimizedLighting 定义在此但未被实际使用
                                                    // 实际使用的是 Game.prototype._spreadLight 的下方实现
                                                    const OptimizedLighting = {
                                                        MAX_DEPTH: 15,
                                                        _lightQueue: new Int16Array(10000),
                                                        _queueHead: 0,
                                                        _queueTail: 0,

                                                        spreadLight(world, sx, sy, level) {
                                                            if (!world || !world.w || !world.h) return;
                                                            const w = world.w | 0, h = world.h | 0;
                                                            if (level <= 0 || level > this.MAX_DEPTH) return;

                                                            this._queueHead = 0;
                                                            this._queueTail = 0;

                                                            // 使用队列替代递归
                                                            this._enqueue(sx, sy, level);

                                                            let iterations = 0;
                                                            const MAX_ITERATIONS = 5000;

                                                            while (this._queueHead < this._queueTail && iterations < MAX_ITERATIONS) {
                                                                iterations++;

                                                                const x = this._lightQueue[this._queueHead++];
                                                                const y = this._lightQueue[this._queueHead++];
                                                                const l = this._lightQueue[this._queueHead++];

                                                                if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;

                                                                const colLight = world.light[x];
                                                                if (!colLight) continue;
                                                                const current = colLight[y] || 0;
                                                                if (l <= current) continue;

                                                                colLight[y] = l;

                                                                const nl = l - 1;
                                                                if (nl > 0) {
                                                                    // 检查四个方向
                                                                    const colTiles = world.tiles[x];
                                                                    const block = colTiles ? colTiles[y] : 0;
                                                                    const attenuation = (BLOCK_DATA[block] && BLOCK_DATA[block].lightAttenuation) || 1;
                                                                    const nextLevel = nl - attenuation + 1;

                                                                    if (nextLevel > 0) {
                                                                        this._enqueue(x - 1, y, nextLevel);
                                                                        this._enqueue(x + 1, y, nextLevel);
                                                                        // 防御性边界检查
                                                                        if (y - 1 >= 0 && y - 1 < h) {
                                                                            this._enqueue(x, y - 1, nextLevel);
                                                                        }
                                                                        if (y + 1 >= 0 && y + 1 < h) {
                                                                            this._enqueue(x, y + 1, nextLevel);
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        },

                                                        _enqueue(x, y, l) {
                                                            if (this._queueTail >= this._lightQueue.length - 3) return;
                                                            this._lightQueue[this._queueTail++] = x;
                                                            this._lightQueue[this._queueTail++] = y;
                                                            this._lightQueue[this._queueTail++] = l;
                                                        }
                                                    };

                                                    Game.prototype._spreadLight = function (sx, sy, level) {
                                                        const world = this.world;
                                                        if (!world) return;
                                                        const w = world.w | 0, h = world.h | 0;
                                                        const tiles = world.tiles;
                                                        const light = world.light;

                                                        if (!this._lightVisited || this._lightVisited.length !== w * h) {
                                                            this._lightVisited = new Uint32Array(w * h);
                                                            this._lightVisitMark = 1;
                                                        }

                                                        let mark = (this._lightVisitMark + 1) >>> 0;
                                                        if (mark === 0) { this._lightVisited.fill(0); mark = 1; }
                                                        this._lightVisitMark = mark;

                                                        const visited = this._lightVisited;
                                                        const qx = this._lightQx || (this._lightQx = []); const qy = this._lightQy || (this._lightQy = []); const ql = this._lightQl || (this._lightQl = []);
                                                        qx.length = 0; qy.length = 0; ql.length = 0;
                                                        let head = 0;

                                                        qx.push(sx); qy.push(sy); ql.push(level);

                                                        while (head < qx.length) {
                                                            const x = qx[head];
                                                            const y = qy[head];
                                                            const l = ql[head];
                                                            head++;

                                                            if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;
                                                            const idx = x + y * w;
                                                            if (visited[idx] === mark) continue;
                                                            visited[idx] = mark;

                                                            const colLight = light[x];
                                                            if (l > colLight[y]) colLight[y] = l;

                                                            const id = tiles[x][y] | 0;
                                                            let decay = 1;
                                                            if (SOLID[id]) decay += (TRANSP[id] ? 1 : 4);         // opaque blocks cast strong shadows
                                                            else if (LIQ[id]) decay += 2;                         // liquids attenuate a bit
                                                            else decay += 0;

                                                            const nl = l - decay;
                                                            if (nl > 0) {
                                                                qx.push(x - 1, x + 1, x, x);
                                                                qy.push(y, y, y - 1, y + 1);
                                                                ql.push(nl, nl, nl, nl);
                                                            }
                                                        }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 6) Underwater filter + deeper animated fog (applyPostFX)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__underwaterFogV9) {
                                                    Renderer.prototype.__underwaterFogV9 = true;

                                                    const prev = Renderer.prototype.applyPostFX;
                                                    Renderer.prototype._ensureFogNoise = function () {
                                                        const size = 96;
                                                        if (this._fogNoise && this._fogNoise.width === size) return;
                                                        const c = document.createElement('canvas');
                                                        c.width = c.height = size;
                                                        const ctx = c.getContext('2d', { alpha: true });
                                                        const img = ctx.createImageData(size, size);
                                                        for (let i = 0; i < img.data.length; i += 4) {
                                                            const v = (Math.random() * 255) | 0;
                                                            img.data[i] = v;
                                                            img.data[i + 1] = v;
                                                            img.data[i + 2] = v;
                                                            img.data[i + 3] = 255;
                                                        }
                                                        ctx.putImageData(img, 0, 0);
                                                        this._fogNoise = c;
                                                    };

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        if (prev) prev.call(this, time, depth01, reducedMotion);

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;

                                                        // Animated deep fog (add motion/noise so it feels alive)
                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const deep = Math.max(0, (d - 0.55) / 0.45);
                                                        if (deep > 0.01) {
                                                            this._ensureFogNoise();
                                                            const n = this._fogNoise;
                                                            const t = performance.now() * 0.00004;
                                                            const ox = ((t * 80) % n.width) | 0;
                                                            const oy = ((t * 55) % n.height) | 0;

                                                            ctx.save();
                                                            ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                            ctx.globalCompositeOperation = 'multiply';
                                                            ctx.globalAlpha = Math.min(0.22, 0.06 + deep * 0.18);

                                                            // tint base
                                                            ctx.fillStyle = `rgba(30, 40, 55, ${Math.min(0.28, 0.08 + deep * 0.20)})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            // noise overlay (scaled up)
                                                            ctx.globalCompositeOperation = 'overlay';
                                                            ctx.globalAlpha = Math.min(0.14, 0.04 + deep * 0.10);
                                                            for (let y = -1; y <= 1; y++) {
                                                                for (let x = -1; x <= 1; x++) {
                                                                    ctx.drawImage(n, ox, oy, n.width - ox, n.height - oy, x * (wPx / 2), y * (hPx / 2), wPx / 2, hPx / 2);
                                                                }
                                                            }
                                                            ctx.restore();
                                                        }

                                                        // Underwater overlay
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            const p = g && g.player;
                                                            const world = g && g.world;
                                                            const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (p && world && world.tiles) {
                                                                const tx = ((p.x + p.w * 0.5) / ts) | 0;
                                                                const ty = ((p.y + p.h * 0.6) / ts) | 0;
                                                                const inW = (tx >= 0 && ty >= 0 && tx < world.w && ty < world.h) ? (world.tiles[tx][ty] === BLOCK.WATER) : false;
                                                                if (inW) {
                                                                    ctx.save();
                                                                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                    ctx.globalCompositeOperation = 'screen';
                                                                    ctx.globalAlpha = 0.14;
                                                                    ctx.fillStyle = 'rgba(90, 170, 255, 1)';
                                                                    ctx.fillRect(0, 0, wPx, hPx);
                                                                    ctx.globalAlpha = 0.08;
                                                                    const g2 = ctx.createLinearGradient(0, 0, 0, hPx);
                                                                    g2.addColorStop(0, 'rgba(120,200,255,0.0)');
                                                                    g2.addColorStop(1, 'rgba(40,110,220,0.9)');
                                                                    ctx.fillStyle = g2;
                                                                    ctx.fillRect(0, 0, wPx, hPx);
                                                                    ctx.restore();
                                                                }
                                                            }
                                                        } catch { }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 7) Sky: biome-tinted gradients + cloud layer (Renderer.renderSky)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__cloudBiomeSkyV9) {
                                                    Renderer.prototype.__cloudBiomeSkyV9 = true;

                                                    // Palette per biome + time bucket
                                                    const SKY = {
                                                        forest: {
                                                            0: ['#0c0c1e', '#1a1a2e', '#16213e'],
                                                            1: ['#1a1a2e', '#3b2855', '#ff7b7b'],
                                                            2: ['#74b9ff', '#81ecec', '#dfe6e9'],
                                                            3: ['#6c5ce7', '#ff8fab', '#ffeaa7']
                                                        },
                                                        desert: {
                                                            0: ['#0b1022', '#1a1a2e', '#2b2a3a'],
                                                            1: ['#2b1d2f', '#7a3a2d', '#ffb37b'],
                                                            2: ['#ffcc80', '#ffd180', '#fff3e0'],
                                                            3: ['#ff8a65', '#ffb74d', '#ffeaa7']
                                                        },
                                                        snow: {
                                                            0: ['#08131f', '#102a43', '#0b1b2b'],
                                                            1: ['#16213e', '#3a6ea5', '#b3e5fc'],
                                                            2: ['#b3e5fc', '#e3f2fd', '#ffffff'],
                                                            3: ['#4f6d7a', '#9ad1d4', '#fff1c1']
                                                        }
                                                    };

                                                    // Override gradient cache: bucket + biome
                                                    Renderer.prototype._ensureSkyGradient = function (bucket) {
                                                        const biome = this._skyBiome || 'forest';
                                                        const key = biome + '|' + bucket + '|' + (this.h | 0);

                                                        const map = this._skyGradMap || (this._skyGradMap = Object.create(null));
                                                        if (map[key]) { this._skyGrad = map[key]; this._skyBucket = bucket; this._skyGradH = this.h; return; }

                                                        const ctx = this.ctx;
                                                        const colors = (SKY[biome] && SKY[biome][bucket]) ? SKY[biome][bucket] : SKY.forest[bucket];
                                                        const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.7);
                                                        grad.addColorStop(0, colors[0]);
                                                        grad.addColorStop(0.5, colors[1]);
                                                        grad.addColorStop(1, colors[2]);
                                                        map[key] = grad;
                                                        this._skyGrad = grad;
                                                        this._skyBucket = bucket;
                                                        this._skyGradH = this.h;
                                                    };

                                                    const prevSky = Renderer.prototype.renderSky;
                                                    Renderer.prototype._ensureClouds = function () {
                                                        const want = (this.lowPower ? 8 : 16);
                                                        if (this._clouds && this._clouds.length === want) return;
                                                        const arr = [];
                                                        const w = Math.max(1, this.w | 0);
                                                        const h = Math.max(1, (this.h * 0.55) | 0);

                                                        for (let i = 0; i < want; i++) {
                                                            const seed = i * 9973;
                                                            arr.push({
                                                                x: (seed * 17) % w,
                                                                y: 20 + ((seed * 31) % h),
                                                                s: 0.6 + ((seed % 100) / 100) * 1.2,
                                                                sp: 8 + (seed % 13),
                                                                p: seed * 0.017
                                                            });
                                                        }
                                                        this._clouds = arr;
                                                    };

                                                    function cloudColor(time, biome) {
                                                        // interpolate between day and night-ish tints
                                                        const night = (typeof Utils !== 'undefined' && Utils.nightFactor) ? Utils.nightFactor(time) : ((time < 0.2 || time > 0.8) ? 1 : 0);
                                                        if (biome === 'desert') return night > 0.5 ? 'rgba(140,160,190,0.45)' : 'rgba(255,245,230,0.55)';
                                                        if (biome === 'snow') return night > 0.5 ? 'rgba(120,160,200,0.40)' : 'rgba(255,255,255,0.60)';
                                                        return night > 0.5 ? 'rgba(130,150,190,0.42)' : 'rgba(255,255,255,0.52)';
                                                    }

                                                    Renderer.prototype.renderSky = function (cam, time) {
                                                        // determine biome from camera center tile
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            const world = g && g.world;
                                                            const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (world && world.w) {
                                                                const centerTileX = ((cam.x + this.w * 0.5) / ts) | 0;
                                                                this._skyBiome = Biomes.bandAt(world.w, centerTileX);
                                                            } else {
                                                                this._skyBiome = 'forest';
                                                            }
                                                        } catch { this._skyBiome = 'forest'; }

                                                        if (prevSky) prevSky.call(this, cam, time);

                                                        // cloud layer
                                                        try {
                                                            this._ensureClouds();
                                                            const ctx = this.ctx;
                                                            const biome = this._skyBiome || 'forest';
                                                            const cCol = cloudColor(time, biome);
                                                            const t = performance.now() * 0.001;

                                                            ctx.save();
                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = cCol;

                                                            for (let i = 0; i < this._clouds.length; i++) {
                                                                const c = this._clouds[i];
                                                                const speed = (c.sp * 0.35);
                                                                const px = (c.x + (t * speed) + cam.x * 0.08) % (this.w + 240);
                                                                const x = px - 120;
                                                                const y = c.y + Math.sin(t * 0.2 + c.p) * 6;

                                                                const s = 44 * c.s;
                                                                const h = 18 * c.s;

                                                                ctx.globalAlpha = 0.18 + (i % 3) * 0.06;
                                                                // puffy blobs (cheap: rect+arc)
                                                                ctx.beginPath();
                                                                ctx.ellipse(x, y, s, h, 0, 0, Math.PI * 2);
                                                                ctx.ellipse(x + s * 0.6, y + 3, s * 0.85, h * 0.95, 0, 0, Math.PI * 2);
                                                                ctx.ellipse(x - s * 0.6, y + 2, s * 0.72, h * 0.9, 0, 0, Math.PI * 2);
                                                                ctx.fill();
                                                            }
                                                            ctx.restore();
                                                        } catch { }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 8) Pressure plates + Pumps (Game logic, cross-region capable)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__machinesV9) {
                                                    Game.prototype.__machinesV9 = true;

                                                    Game.prototype._indexMachines = function () {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        const w = world.w | 0, h = world.h | 0;
                                                        const pumpsIn = [];
                                                        const pumpsOut = [];
                                                        const plates = [];

                                                        for (let x = 0; x < w; x++) {
                                                            const col = world.tiles[x];
                                                            for (let y = 0; y < h; y++) {
                                                                const id = col[y];
                                                                if (id === IDS.PUMP_IN) pumpsIn.push([x, y]);
                                                                else if (id === IDS.PUMP_OUT) pumpsOut.push([x, y]);
                                                                else if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) plates.push([x, y]);
                                                            }
                                                        }
                                                        this._machines = { pumpsIn, pumpsOut, plates };
                                                    };

                                                    Game.prototype._writeTileFast = function (x, y, id, persist) {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        if (x < 0 || y < 0 || x >= world.w || y >= world.h) return;
                                                        const old = world.tiles[x][y];
                                                        if (old === id) return;

                                                        world.tiles[x][y] = id;

                                                        // notify tilelogic worker (fluids + logic)
                                                        try { this.tileLogic && this.tileLogic.notifyTileWrite && this.tileLogic.notifyTileWrite(x, y, id); } catch { }
                                                        try { this.renderer && this.renderer.invalidateTile && this.renderer.invalidateTile(x, y); } catch { }
                                                        try { if (persist && this.saveSystem && this.saveSystem.markTile) this.saveSystem.markTile(x, y, id); } catch { }
                                                    };

                                                    Game.prototype._ensureMachineItems = function () {
                                                        try {
                                                            const inv = this.player && this.player.inventory;
                                                            if (!inv || !inv.push) return;
                                                            const has = (id) => inv.some(it => it && it.id === id);
                                                            if (!has(IDS.PUMP_IN)) inv.push({ id: IDS.PUMP_IN, name: '泵(入水口)', count: 4 });
                                                            if (!has(IDS.PUMP_OUT)) inv.push({ id: IDS.PUMP_OUT, name: '泵(出水口)', count: 4 });
                                                            if (!has(IDS.PLATE_OFF)) inv.push({ id: IDS.PLATE_OFF, name: '压力板', count: 8 });
                                                            this._deferHotbarUpdate && this._deferHotbarUpdate();
                                                        } catch { }
                                                    };

                                                    // Patch init: index machines + starter items
                                                    const _init = Game.prototype.init;
                                                    Game.prototype.init = async function () {
                                                        const r = await _init.call(this);
                                                        try { this._indexMachines(); } catch { }
                                                        try { this._ensureMachineItems(); } catch { }
                                                        return r;
                                                    };

                                                    // Pressure plate collision
                                                    Game.prototype._updatePressurePlates = function () {
                                                        const world = this.world;
                                                        const m = this._machines;
                                                        if (!world || !m || !m.plates || !m.plates.length) return;

                                                        const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;

                                                        // collect pressed positions this frame
                                                        const pressed = this._platePressed || (this._platePressed = new Set());
                                                        const next = new Set();

                                                        const markPlateUnder = (ent) => {
                                                            if (!ent) return;
                                                            const cx = (ent.x + ent.w * 0.5);
                                                            const fy = (ent.y + ent.h + 1);
                                                            const tx = (cx / ts) | 0;
                                                            const ty = (fy / ts) | 0;
                                                            if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return;
                                                            const id = world.tiles[tx][ty];
                                                            if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) {
                                                                next.add(tx + ',' + ty);
                                                            }
                                                        };

                                                        // player
                                                        markPlateUnder(this.player);

                                                        // mobs/enemies if present
                                                        try {
                                                            const ents = this.entities || this.mobs || this.enemies;
                                                            if (Array.isArray(ents)) for (let i = 0; i < ents.length; i++) markPlateUnder(ents[i]);
                                                        } catch { }

                                                        // Apply state changes (ON for pressed, OFF for released)
                                                        next.forEach((k) => {
                                                            if (pressed.has(k)) return;
                                                            pressed.add(k);
                                                            const [x, y] = k.split(',').map(n => n | 0);
                                                            this._writeTileFast(x, y, IDS.PLATE_ON, false);
                                                        });

                                                        pressed.forEach((k) => {
                                                            if (next.has(k)) return;
                                                            pressed.delete(k);
                                                            const [x, y] = k.split(',').map(n => n | 0);
                                                            this._writeTileFast(x, y, IDS.PLATE_OFF, false);
                                                        });
                                                    };

                                                    // Pump simulation (cross-region): moves water between PUMP_IN and PUMP_OUT on same wire network
                                                    Game.prototype._pumpSim = function (dtMs) {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                        const m = this._machines;
                                                        if (!m || !m.pumpsIn || !m.pumpsOut) return;
                                                        if (!m.pumpsIn.length || !m.pumpsOut.length) return;

                                                        this._pumpAcc = (this._pumpAcc || 0) + (dtMs || 0);
                                                        if (this._pumpAcc < 220) return;
                                                        this._pumpAcc = 0;

                                                        const w = world.w | 0, h = world.h | 0;
                                                        const tiles = world.tiles;

                                                        // Visited marks for BFS
                                                        if (!this._pumpVisited || this._pumpVisited.length !== w * h) {
                                                            this._pumpVisited = new Uint32Array(w * h);
                                                            this._pumpStamp = 1;
                                                        }
                                                        let stamp = (this._pumpStamp + 1) >>> 0;
                                                        if (stamp === 0) { this._pumpVisited.fill(0); stamp = 1; }
                                                        this._pumpStamp = stamp;
                                                        const vis = this._pumpVisited;

                                                        const isWire = (id) => (id === IDS.WIRE_OFF || id === IDS.WIRE_ON);
                                                        const isSwitch = (id) => (id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON || id === IDS.PLATE_OFF || id === IDS.PLATE_ON);
                                                        const isPump = (id) => (id === IDS.PUMP_IN || id === IDS.PUMP_OUT);
                                                        const isConductor = (id) => isWire(id) || isSwitch(id) || isPump(id);
                                                        const isPoweredSource = (id) => (id === IDS.SWITCH_ON || id === IDS.PLATE_ON);

                                                        const pickNeighborWater = (x, y) => {
                                                            // prefer below
                                                            const neigh = [[x, y + 1], [x - 1, y], [x + 1, y], [x, y - 1]];
                                                            for (let i = 0; i < neigh.length; i++) {
                                                                const nx = neigh[i][0], ny = neigh[i][1];
                                                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                                                                if (tiles[nx][ny] === BLOCK.WATER) return [nx, ny];
                                                            }
                                                            return null;
                                                        };
                                                        const pickNeighborOutput = (x, y) => {
                                                            const neigh = [[x, y - 1], [x + 1, y], [x - 1, y], [x, y + 1]];
                                                            for (let i = 0; i < neigh.length; i++) {
                                                                const nx = neigh[i][0], ny = neigh[i][1];
                                                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                                                                const id = tiles[nx][ny];
                                                                if (id === BLOCK.AIR) return [nx, ny];
                                                            }
                                                            return null;
                                                        };

                                                        // Process a small number of pumps per tick to keep fps stable
                                                        const budget = (this._perf && this._perf.level === 'low') ? 1 : 3;

                                                        for (let pi = 0, done = 0; pi < m.pumpsIn.length && done < budget; pi++) {
                                                            const [sx, sy] = m.pumpsIn[pi];
                                                            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                                                            if (tiles[sx][sy] !== IDS.PUMP_IN) continue;

                                                            // BFS wire network
                                                            const qx = [sx], qy = [sy];
                                                            const out = [];
                                                            let powered = false;
                                                            let nodes = 0;

                                                            const mark = (x, y) => { vis[x + y * w] = stamp; };

                                                            mark(sx, sy);

                                                            while (qx.length && nodes < 24000) {
                                                                const x = qx.pop();
                                                                const y = qy.pop();
                                                                nodes++;

                                                                const id = tiles[x][y];
                                                                if (isPoweredSource(id)) powered = true;
                                                                if (id === IDS.PUMP_OUT) out.push([x, y]);

                                                                const push = (nx, ny) => {
                                                                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
                                                                    const k = nx + ny * w;
                                                                    if (vis[k] === stamp) return;
                                                                    const tid = tiles[nx][ny];
                                                                    if (!isConductor(tid)) return;
                                                                    vis[k] = stamp;
                                                                    qx.push(nx); qy.push(ny);
                                                                };

                                                                push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
                                                            }

                                                            if (!powered || !out.length) continue;

                                                            // intake -> output water teleport
                                                            const inN = pickNeighborWater(sx, sy);
                                                            if (!inN) continue;

                                                            // pick a deterministic output (round-robin)
                                                            const rr = (this._pumpRR || 0) % out.length;
                                                            this._pumpRR = (rr + 1) | 0;
                                                            const [ox, oy] = out[rr];

                                                            const outN = pickNeighborOutput(ox, oy);
                                                            if (!outN) continue;

                                                            // move one tile of water (coarse, region independent)
                                                            this._writeTileFast(inN[0], inN[1], BLOCK.AIR, false);
                                                            this._writeTileFast(outN[0], outN[1], BLOCK.WATER, false);

                                                            done++;
                                                        }
                                                    };

                                                    const _update = Game.prototype.update;
                                                    Game.prototype.update = function (dt) {
                                                        // 防御性参数检查
                                                        if (typeof dt !== 'number' || dt < 0 || dt > 1000) {
                                                            console.warn(`[Game.update] Invalid dt: ${dt}, using default`);
                                                            dt = 16.67;
                                                        }

                                                        const r = _update.call(this, dt);
                                                        try {
                                                            if (!this._machines) this._indexMachines();
                                                            this._updatePressurePlates();
                                                            this._pumpSim(dt);
                                                            // Cave ambience for audio (depth-based)
                                                            if (this.audio && this.audio.setEnvironment) {
                                                                const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                                const d01 = Utils.clamp((this.player.y + this.player.h * 0.6) / (this.world.h * ts), 0, 1);
                                                                // crude enclosure check: solid above head
                                                                const tx = ((this.player.x + this.player.w * 0.5) / ts) | 0;
                                                                const ty = ((this.player.y + 2) / ts) | 0;
                                                                const enclosed = (tx >= 0 && ty >= 0 && tx < this.world.w && ty < this.world.h) ? (SOLID[this.world.tiles[tx][ty]] ? 1 : 0) : 0;
                                                                this.audio.setEnvironment(d01, enclosed);
                                                            }
                                                        } catch { }
                                                        return r;
                                                    };

                                                    // Keep machine index fresh on tile changes (best-effort)
                                                    try {
                                                        const SS = window.SaveSystem;
                                                        if (SS && SS.prototype && !SS.prototype.__machineIndexPatchedV9) {
                                                            SS.prototype.__machineIndexPatchedV9 = true;
                                                            const _mark = SS.prototype.markTile;
                                                            SS.prototype.markTile = function (x, y, newId) {
                                                                const r = _mark.call(this, x, y, newId);
                                                                try {
                                                                    const g = this.game;
                                                                    if (!g) return r;
                                                                    if (!g._machines) return r;
                                                                    // Minimal: invalidate index when machine blocks changed
                                                                    if (newId === IDS.PUMP_IN || newId === IDS.PUMP_OUT || newId === IDS.PLATE_OFF || newId === IDS.PLATE_ON) g._machines = null;
                                                                } catch { }
                                                                return r;
                                                            };
                                                        }
                                                    } catch { }
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 9) Audio: cave reverb/echo for mining and ambience
                                                // ─────────────────────────────────────────────────────────────
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__caveReverbV9) {
                                                    AudioManager.prototype.__caveReverbV9 = true;

                                                    AudioManager.prototype._ensureCaveFx = function () {
                                                        if (!this.ctx || this._caveFx) return;
                                                        const ctx = this.ctx;

                                                        const inGain = ctx.createGain();
                                                        const dry = ctx.createGain();
                                                        const wet = ctx.createGain();

                                                        const delay = ctx.createDelay(0.35);
                                                        delay.delayTime.value = 0.12;

                                                        const fb = ctx.createGain();
                                                        fb.gain.value = 0.28;

                                                        const lp = ctx.createBiquadFilter();
                                                        lp.type = 'lowpass';
                                                        lp.frequency.value = 1800;

                                                        inGain.connect(dry);
                                                        dry.connect(ctx.destination);

                                                        inGain.connect(delay);
                                                        delay.connect(lp);
                                                        lp.connect(wet);
                                                        wet.connect(ctx.destination);

                                                        lp.connect(fb);
                                                        fb.connect(delay);

                                                        dry.gain.value = 1;
                                                        wet.gain.value = 0;

                                                        this._caveFx = { inGain, dry, wet, delay, fb, lp };
                                                    };

                                                    AudioManager.prototype.setEnvironment = function (depth01, enclosed01) {
                                                        if (!this.ctx) return;
                                                        this._ensureCaveFx();
                                                        const fx = this._caveFx;
                                                        if (!fx) return;

                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const e = Math.max(0, Math.min(1, +enclosed01 || 0));
                                                        const cave = Math.max(0, (d - 0.42) / 0.55) * (0.65 + 0.35 * e);
                                                        this._caveAmt = cave;

                                                        const now = this.ctx.currentTime;
                                                        try { fx.wet.gain.setTargetAtTime(Math.min(0.55, cave * 0.55), now, 0.08); } catch { fx.wet.gain.value = Math.min(0.55, cave * 0.55); }
                                                        try { fx.dry.gain.setTargetAtTime(1 - Math.min(0.25, cave * 0.25), now, 0.08); } catch { fx.dry.gain.value = 1 - Math.min(0.25, cave * 0.25); }
                                                        try { fx.delay.delayTime.setTargetAtTime(0.09 + cave * 0.08, now, 0.08); } catch { fx.delay.delayTime.value = 0.09 + cave * 0.08; }
                                                        try { fx.fb.gain.setTargetAtTime(0.18 + cave * 0.18, now, 0.08); } catch { fx.fb.gain.value = 0.18 + cave * 0.18; }
                                                        try { fx.lp.frequency.setTargetAtTime(2200 - cave * 900, now, 0.08); } catch { fx.lp.frequency.value = 2200 - cave * 900; }
                                                    };

                                                    // Allow beep/noise to route through a destination node
                                                    const _beep = AudioManager.prototype.beep;
                                                    AudioManager.prototype.beep = function (freq, dur, type, vol, dest) {
                                                        if (!this.ctx) return;
                                                        const out = dest || (this._caveFx ? this._caveFx.inGain : null) || this.ctx.destination;
                                                        // re-implement lightly (avoid calling old which always connects destination)
                                                        const v = (this.settings.sfxVolume || 0) * (vol || 1);
                                                        if (v <= 0.0001) return;

                                                        const o = this.ctx.createOscillator();
                                                        o.type = type || 'sine';
                                                        o.frequency.value = freq || 440;

                                                        const g = this.ctx.createGain();
                                                        const now = this.ctx.currentTime;
                                                        g.gain.setValueAtTime(0.0001, now);
                                                        g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                                                        g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.06));

                                                        o.connect(g);
                                                        g.connect(out);

                                                        o.start(now);
                                                        o.stop(now + (dur || 0.06) + 0.02);
                                                    };

                                                    AudioManager.prototype.noise = function (dur, vol, dest) {
                                                        if (!this.ctx || !this._noiseBuf) return;
                                                        const out = dest || (this._caveFx ? this._caveFx.inGain : null) || this.ctx.destination;
                                                        const v = (this.settings.sfxVolume || 0) * (vol || 1);
                                                        if (v <= 0.0001) return;

                                                        const src = this.ctx.createBufferSource();
                                                        src.buffer = this._noiseBuf;

                                                        const g = this.ctx.createGain();
                                                        const now = this.ctx.currentTime;
                                                        g.gain.setValueAtTime(0.0001, now);
                                                        g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                                                        g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.08));

                                                        src.connect(g);
                                                        g.connect(out);

                                                        src.start(now);
                                                        src.stop(now + (dur || 0.08) + 0.02);
                                                    };

                                                    // Patch play: mining gets subtle echo underground
                                                    const _play = AudioManager.prototype.play;
                                                    AudioManager.prototype.play = function (kind) {
                                                        if (!this.ctx) { try { return _play.call(this, kind); } catch { return; } }
                                                        const cave = (this._caveAmt || 0);
                                                        const dest = (cave > 0.05 && this._caveFx) ? this._caveFx.inGain : this.ctx.destination;

                                                        switch (kind) {
                                                            case 'mine':
                                                                this.noise(0.06, 0.9, dest);
                                                                this.beep(220, 0.05, 'triangle', 0.35, dest);
                                                                if (cave > 0.35) this.noise(0.03, 0.28, dest); // extra slapback
                                                                break;
                                                            default:
                                                                try { _play.call(this, kind); } catch { }
                                                        }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: patch/script_40 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    const IDS = TU.LOGIC_BLOCKS || {};
                                    const Dim = window.DroppedItemManager || TU.DroppedItemManager;
                                    if (!Dim || !Dim.prototype || Dim.prototype.__logicDropNormalizeV9) return;
                                    Dim.prototype.__logicDropNormalizeV9 = true;

                                    const prev = Dim.prototype.spawn;
                                    if (typeof prev !== 'function') return;
                                    Dim.prototype.spawn = function (x, y, blockId, count) {
                                        try {
                                            if (blockId === IDS.WIRE_ON) blockId = IDS.WIRE_OFF;
                                            if (blockId === IDS.SWITCH_ON) blockId = IDS.SWITCH_OFF;
                                            if (blockId === IDS.LAMP_ON) blockId = IDS.LAMP_OFF;
                                            if (blockId === IDS.PLATE_ON) blockId = IDS.PLATE_OFF;
                                        } catch { }
                                        return prev.call(this, x, y, blockId, count);
                                    };
                                })();
                            </script>

                            <!-- ========================= PATCH: tu_weather_rain_visible_fix_v1 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_weather_rain_visible_fix_v1',
                                            order: 90,
                                            description: "雨滴可见性修复（v1）",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || {};
                                                const W = TU.WeatherCanvasFX;
                                                if (!W || !W.prototype) return;
                                                if ((window.TU && window.TU.PatchManager) ? !window.TU.PatchManager.once('tu_weather_rain_visible_fix_v1', null) : W.prototype.__tu_weather_rain_visible_fix_v1) return;

                                                // 1) Ensure the weather overlay canvas is NOT hidden (some builds hid it under reduced-motion)
                                                try {
                                                    const st = document.createElement('style');
                                                    st.setAttribute('data-tu-patch', 'tu_weather_rain_visible_fix_v1');
                                                    st.textContent = `
            #weatherfx{ display:block !important; opacity:1 !important; }
            .reduced-motion #weatherfx{ display:block !important; opacity:1 !important; }
          `;
                                                    document.head && document.head.appendChild(st);
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // Helper: get 2D ctx with maximum compatibility (some browsers return null when passing options)
                                                function get2dCtx(canvas) {
                                                    if (!canvas || !canvas.getContext) return null;
                                                    try {
                                                        return canvas.getContext('2d', { alpha: true }) || canvas.getContext('2d', { willReadFrequently: true });
                                                    } catch (e) {
                                                        try { return canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                                                    }
                                                }

                                                // 2) Ensure WeatherCanvasFX always has a valid ctx (fallback to getContext('2d', { willReadFrequently: true }) without options)
                                                if (!W.prototype._ensure2d) {
                                                    W.prototype._ensure2d = function () {
                                                        if (this.ctx) return true;
                                                        this.ctx = get2dCtx(this.canvas);
                                                        if (this.ctx) {
                                                            try { this.ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }
                                                        return !!this.ctx;
                                                    };
                                                }

                                                // 3) More robust pattern builders (use ctx fallback on OffscreenCanvas / old WebViews)
                                                const _mk = (typeof W.prototype._makeOffscreenCanvas === 'function')
                                                    ? W.prototype._makeOffscreenCanvas
                                                    : function (w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

                                                W.prototype._ensureRainPattern = function () {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctxOut = this.ctx;
                                                    if (!ctxOut) return;

                                                    const tile = (this._dpr > 1.25) ? 512 : 256;
                                                    if (this._rain && this._rain.pattern && this._rain.size === tile) return;

                                                    const c = _mk.call(this, tile, tile);
                                                    const g = get2dCtx(c);
                                                    if (!g) return;

                                                    g.setTransform(1, 0, 0, 1, 0, 0);
                                                    g.clearRect(0, 0, tile, tile);

                                                    // Draw diagonal rain streaks (one-time cost)
                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const count = Math.max(220, (tile === 512 ? 420 : 260));
                                                    g.lineCap = 'round';

                                                    for (let i = 0; i < count; i++) {
                                                        const x = rand() * tile;
                                                        const y = rand() * tile;
                                                        const len = 18 + rand() * 46;
                                                        const lw = 0.55 + rand() * 0.95;

                                                        // Around 78deg (down-right)
                                                        const ang = (Math.PI / 180) * (74 + rand() * 10);
                                                        const dx = Math.cos(ang) * len;
                                                        const dy = Math.sin(ang) * len;

                                                        const grad = g.createLinearGradient(x, y, x + dx, y + dy);
                                                        grad.addColorStop(0.00, 'rgba(180,220,255,0.00)');
                                                        grad.addColorStop(0.55, 'rgba(180,220,255,0.20)');
                                                        grad.addColorStop(1.00, 'rgba(180,220,255,0.85)');

                                                        g.strokeStyle = grad;
                                                        g.lineWidth = lw;
                                                        g.beginPath();
                                                        g.moveTo(x, y);
                                                        g.lineTo(x + dx, y + dy);
                                                        g.stroke();
                                                    }

                                                    let p = null;
                                                    try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                    if (!p) return;

                                                    this._rain = this._rain || { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                    this._rain.tile = c;
                                                    this._rain.ctx = g;
                                                    this._rain.pattern = p;
                                                    this._rain.size = tile;
                                                    this._rain.ox = 0;
                                                    this._rain.oy = 0;
                                                };

                                                W.prototype._ensureSnowPattern = function () {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctxOut = this.ctx;
                                                    if (!ctxOut) return;

                                                    const tile = (this._dpr > 1.25) ? 512 : 256;
                                                    if (this._snow && this._snow.pattern && this._snow.size === tile) return;

                                                    const c = _mk.call(this, tile, tile);
                                                    const g = get2dCtx(c);
                                                    if (!g) return;

                                                    g.setTransform(1, 0, 0, 1, 0, 0);
                                                    g.clearRect(0, 0, tile, tile);

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const count = Math.max(160, (tile === 512 ? 320 : 220));

                                                    for (let i = 0; i < count; i++) {
                                                        const x = rand() * tile;
                                                        const y = rand() * tile;
                                                        const r = 0.6 + rand() * 1.8;

                                                        // soft snow dot
                                                        const grad = g.createRadialGradient(x, y, 0, x, y, r);
                                                        grad.addColorStop(0.00, 'rgba(255,255,255,0.85)');
                                                        grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');

                                                        g.fillStyle = grad;
                                                        g.beginPath();
                                                        g.arc(x, y, r, 0, Math.PI * 2);
                                                        g.fill();
                                                    }

                                                    let p = null;
                                                    try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                    if (!p) return;

                                                    this._snow = this._snow || { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                    this._snow.tile = c;
                                                    this._snow.ctx = g;
                                                    this._snow.pattern = p;
                                                    this._snow.size = tile;
                                                    this._snow.ox = 0;
                                                    this._snow.oy = 0;
                                                };

                                                // 4) Fallback draw (if pattern creation fails on some devices)
                                                W.prototype._drawRainFallback = function (intensity, dtMs, isThunder) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctx = this.ctx;
                                                    if (!ctx) return;

                                                    const w = this._wPx || (this.canvas ? this.canvas.width : 0);
                                                    const h = this._hPx || (this.canvas ? this.canvas.height : 0);
                                                    if (!w || !h) return;

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const dt = (dtMs || 0) / 1000;
                                                    const speed = (isThunder ? 1600 : 1250) * (0.55 + 0.85 * Math.min(1, Math.max(0, intensity))) * (this._dpr || 1);

                                                    // Advance a rolling offset so rain "moves"
                                                    this._rain = this._rain || { ox: 0, oy: 0 };
                                                    this._rain.oy = (this._rain.oy + speed * dt) % (h + 1);
                                                    this._rain.ox = (this._rain.ox + speed * 0.18 * dt) % (w + 1);

                                                    const n = Math.max(60, Math.min(240, (80 + intensity * 220) | 0));
                                                    const alpha = (0.08 + 0.22 * intensity) * (isThunder ? 1.10 : 1.0);

                                                    ctx.save();
                                                    ctx.globalCompositeOperation = 'source-over';
                                                    ctx.globalAlpha = alpha;
                                                    ctx.strokeStyle = 'rgba(190,225,255,0.9)';
                                                    ctx.lineCap = 'round';

                                                    for (let i = 0; i < n; i++) {
                                                        const x = ((rand() * (w + 200)) - 100 + (this._rain.ox || 0)) % (w + 200) - 100;
                                                        const y = ((rand() * (h + 200)) - 100 + (this._rain.oy || 0)) % (h + 200) - 100;

                                                        const len = 10 + rand() * 22;
                                                        const lw = 0.7 + rand() * 1.1;
                                                        const dx = len * 0.30;
                                                        const dy = len * 1.00;

                                                        ctx.lineWidth = lw;
                                                        ctx.beginPath();
                                                        ctx.moveTo(x, y);
                                                        ctx.lineTo(x + dx, y + dy);
                                                        ctx.stroke();
                                                    }
                                                    ctx.restore();
                                                };

                                                W.prototype._drawSnowFallback = function (intensity, dtMs) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctx = this.ctx;
                                                    if (!ctx) return;

                                                    const w = this._wPx || (this.canvas ? this.canvas.width : 0);
                                                    const h = this._hPx || (this.canvas ? this.canvas.height : 0);
                                                    if (!w || !h) return;

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const dt = (dtMs || 0) / 1000;

                                                    this._snow = this._snow || { ox: 0, oy: 0 };
                                                    const speed = 280 * (0.35 + 0.8 * Math.min(1, Math.max(0, intensity))) * (this._dpr || 1);
                                                    this._snow.oy = (this._snow.oy + speed * dt) % (h + 1);
                                                    this._snow.ox = (this._snow.ox + speed * 0.12 * dt) % (w + 1);

                                                    const n = Math.max(40, Math.min(180, (60 + intensity * 180) | 0));
                                                    const alpha = 0.10 + 0.25 * intensity;

                                                    ctx.save();
                                                    ctx.globalCompositeOperation = 'source-over';
                                                    ctx.globalAlpha = alpha;
                                                    ctx.fillStyle = 'rgba(255,255,255,0.95)';

                                                    for (let i = 0; i < n; i++) {
                                                        const x = ((rand() * (w + 200)) - 100 + (this._snow.ox || 0)) % (w + 200) - 100;
                                                        const y = ((rand() * (h + 200)) - 100 + (this._snow.oy || 0)) % (h + 200) - 100;
                                                        const r = 0.7 + rand() * 1.9;
                                                        ctx.beginPath();
                                                        ctx.arc(x, y, r, 0, Math.PI * 2);
                                                        ctx.fill();
                                                    }
                                                    ctx.restore();
                                                };

                                                // 5) Wrap drawRain/drawSnow: if the pattern path fails, use fallback so "只有声音没画面" never happens
                                                const _origDrawRain = W.prototype.drawRain;
                                                W.prototype.drawRain = function (intensity, dtMs, isThunder) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    try { if (typeof _origDrawRain === 'function') _origDrawRain.call(this, intensity, dtMs, isThunder); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    if (!this._rain || !this._rain.pattern) {
                                                        try { this._drawRainFallback(intensity, dtMs, isThunder); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                };

                                                const _origDrawSnow = W.prototype.drawSnow;
                                                W.prototype.drawSnow = function (intensity, dtMs) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    try { if (typeof _origDrawSnow === 'function') _origDrawSnow.call(this, intensity, dtMs); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    if (!this._snow || !this._snow.pattern) {
                                                        try { this._drawSnowFallback(intensity, dtMs); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                };

                                                // 6) Override render: do NOT early-return just because of reduced-motion; instead render with slower motion.
                                                W.prototype.render = function (weather, renderer) {
                                                    if (!this.canvas) return;
                                                    if (!this._ensure2d || !this._ensure2d()) return;

                                                    const reduced = !!(document.documentElement && document.documentElement.classList.contains('reduced-motion'));
                                                    const motionScale = reduced ? 0.15 : 1.0;
                                                    const densityScale = reduced ? 0.75 : 1.0;

                                                    // Keep size synced to main renderer
                                                    try { this.resizeLike(renderer); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                    let dtMs = now - (this._lastNow || now);
                                                    if (!Number.isFinite(dtMs)) dtMs = 0;
                                                    if (dtMs < 0) dtMs = 0;
                                                    if (dtMs > 200) dtMs = 200;
                                                    this._lastNow = now;
                                                    dtMs *= motionScale;

                                                    const w = weather || {};
                                                    const type = (w.type || 'clear').toString();
                                                    const intensity = (Number(w.intensity) || 0) * densityScale;
                                                    const lightning = Number(w.lightning) || 0;

                                                    // If nothing to draw, clear once then stop touching the canvas
                                                    if (intensity <= 0.001 && lightning <= 0.001) {
                                                        if (this._hadFx) {
                                                            const ctx = this.ctx;
                                                            ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                            ctx.clearRect(0, 0, (this._wPx || this.canvas.width), (this._hPx || this.canvas.height));
                                                            this._hadFx = false;
                                                        }
                                                        this._prevLightning = lightning;
                                                        return;
                                                    }

                                                    this._hadFx = true;

                                                    const ctx = this.ctx;
                                                    const wPx = this._wPx || this.canvas.width;
                                                    const hPx = this._hPx || this.canvas.height;

                                                    // Clear overlay each frame when active (transparent canvas)
                                                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                    ctx.clearRect(0, 0, wPx, hPx);

                                                    if ((type === 'rain' || type === 'thunder') && intensity > 0.01) {
                                                        this.drawRain(intensity, dtMs, type === 'thunder');
                                                    } else if (type === 'snow' && intensity > 0.01) {
                                                        this.drawSnow(intensity, dtMs);
                                                    }

                                                    if (lightning > 0.001) {
                                                        this.drawLightning(lightning, dtMs);
                                                    } else if (this._bolt && this._bolt.life > 0) {
                                                        // Let bolt fade out naturally even if lightning param drops fast
                                                        this.drawLightning(Math.max(0, this._prevLightning * 0.8), dtMs);
                                                    }

                                                    this._prevLightning = lightning;
                                                };
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: tu_acid_rain_hazard_v1 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_acid_rain_hazard_v1',
                                            order: 100,
                                            description: "酸雨危害机制（v1）",
                                            apply: () => {
                                                'use strict';
                                                if (window.__TU_ACID_RAIN_HAZARD_V1__) return;
                                                window.__TU_ACID_RAIN_HAZARD_V1__ = true;

                                                const TU = window.TU || {};
                                                const Game = TU.Game;
                                                const Player = TU.Player;
                                                const UIManager = TU.UIManager;
                                                const WeatherCanvasFX = TU.WeatherCanvasFX;

                                                if (!Game || !Game.prototype) return;

                                                const ACID_CHANCE = 0.30;          // 30% chance when rain starts
                                                const ACID_MIN_INTENSITY = 0.06;   // below this, no damage / no strong effects
                                                const SHELTER_CHECK_MS = 120;      // shelter raycast throttling
                                                const DMG_INTERVAL_MIN = 250;      // ms
                                                const DMG_INTERVAL_MAX = 1050;     // ms

                                                // ───────────────────────── CSS & overlay element ─────────────────────────
                                                function ensureStyle() {
                                                    try {
                                                        if (document.getElementById('tu-acid-rain-style')) return;
                                                        const st = document.createElement('style');
                                                        st.id = 'tu-acid-rain-style';
                                                        st.textContent = `
              /* Acid rain damage flash overlay */
              #damage-flash{
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 80; /* above weatherfx (55), below UI (100) */
                opacity: 0;
                background: radial-gradient(circle at 50% 45%,
                  rgba(255, 90, 90, 0.22),
                  rgba(0, 0, 0, 0)
                );
                mix-blend-mode: screen;
              }
              #damage-flash.acid{
                background: radial-gradient(circle at 50% 45%,
                  rgba(0, 255, 140, 0.20),
                  rgba(0, 0, 0, 0)
                );
              }
              #damage-flash.flash{
                animation: tuDamageFlash 0.28s ease-out 1;
              }
              @keyframes tuDamageFlash{
                0%{ opacity: 0; }
                28%{ opacity: 1; }
                100%{ opacity: 0; }
              }

              /* Health bar feedback when taking damage */
              .stat-bar.hurt-acid{
                animation: tuHurtShake 0.28s ease-out 1;
                border-color: rgba(0, 255, 140, 0.55) !important;
                box-shadow: 0 0 0 2px rgba(0, 255, 140, 0.25), var(--shadow);
              }
              .stat-bar.hurt-acid .fill{
                filter: brightness(1.25) saturate(1.35);
              }
              @keyframes tuHurtShake{
                0%{ transform: translateX(0) scale(1); }
                25%{ transform: translateX(-2px) scale(1.06); }
                55%{ transform: translateX(2px) scale(1.04); }
                100%{ transform: translateX(0) scale(1); }
              }
            `;
                                                        document.head && document.head.appendChild(st);
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                }

                                                function ensureDamageFlashEl() {
                                                    try {
                                                        let el = document.getElementById('damage-flash');
                                                        if (el) return el;
                                                        el = document.createElement('div');
                                                        el.id = 'damage-flash';
                                                        document.body && document.body.appendChild(el);
                                                        return el;
                                                    } catch (_) {
                                                        return null;
                                                    }
                                                }

                                                ensureStyle();
                                                const damageFlashEl = ensureDamageFlashEl();

                                                // ───────────────────────── UI: flash damage feedback ─────────────────────────
                                                if (UIManager && UIManager.prototype && !UIManager.prototype.flashDamage) {
                                                    UIManager.prototype.flashDamage = function (kind) {
                                                        try {
                                                            const isAcid = (kind === 'acid' || kind === 'acidRain');
                                                            const bar = this.healthFillEl && this.healthFillEl.closest ? this.healthFillEl.closest('.stat-bar') : null;
                                                            if (bar) {
                                                                // restart animation
                                                                bar.classList.remove('hurt-acid');
                                                                if (isAcid) {
                                                                    // force reflow once (only on damage, not per-frame)
                                                                    void bar.offsetWidth;
                                                                    bar.classList.add('hurt-acid');
                                                                }
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }

                                                // ───────────────────────── Player: simple hurt flash (render overlay) ─────────────────────────
                                                if (Player && Player.prototype && !Player.prototype.__tuAcidRainHurtFlash) {
                                                    Player.prototype.__tuAcidRainHurtFlash = true;

                                                    const _update = Player.prototype.update;
                                                    if (typeof _update === 'function') {
                                                        Player.prototype.update = function (input, world, dt) {
                                                            // 防御性参数检查
                                                            if (!world) {
                                                                console.warn('[Player.update] World not provided');
                                                                return;
                                                            }
                                                            if (typeof dt !== 'number' || dt <= 0) {
                                                                console.warn(`[Player.update] Invalid dt: ${dt}`);
                                                                dt = 16.67;
                                                            }

                                                            _update.call(this, input, world, dt);
                                                            const d = Math.min(50, Math.max(0, Number(dt) || 0));
                                                            if (this._hurtFlashMs > 0) {
                                                                this._hurtFlashMs = Math.max(0, this._hurtFlashMs - d);
                                                            }
                                                        };
                                                    }

                                                    const _render = Player.prototype.render;
                                                    if (typeof _render === 'function') {
                                                        Player.prototype.render = function (ctx, cam) {
                                                            _render.call(this, ctx, cam);
                                                            const ms = Number(this._hurtFlashMs) || 0;
                                                            if (ms <= 0 || !ctx || !cam) return;

                                                            const t = Math.min(1, ms / 240);
                                                            const sx = Math.floor(this.x - cam.x);
                                                            const sy = Math.floor(this.y - cam.y);

                                                            ctx.save();
                                                            try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            ctx.globalAlpha = 0.28 * t;
                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = (this._hurtKind === 'acid') ? 'rgba(0,255,140,0.75)' : 'rgba(255,90,90,0.75)';
                                                            // slightly larger than hitbox for visibility
                                                            ctx.fillRect(sx - 2, sy - 2, (this.w | 0) + 4, (this.h | 0) + 4);
                                                            ctx.globalAlpha = 1;
                                                            ctx.globalCompositeOperation = 'source-over';
                                                            ctx.restore();
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── WeatherCanvasFX: green rain variant when acid ─────────────────────────
                                                if (WeatherCanvasFX && WeatherCanvasFX.prototype && !WeatherCanvasFX.prototype.__tuAcidRainGreen) {
                                                    WeatherCanvasFX.prototype.__tuAcidRainGreen = true;

                                                    // Helper: robust ctx getter (some browsers dislike passing options)
                                                    function get2dCtx(canvas) {
                                                        if (!canvas || !canvas.getContext) return null;
                                                        try { return canvas.getContext('2d', { alpha: true }) || canvas.getContext('2d', { willReadFrequently: true }); } catch (e) {
                                                            try { return canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                                                        }
                                                    }

                                                    // Ensure acid rain pattern cache slot exists
                                                    function acidSlot(self) {
                                                        if (!self._rainAcid) self._rainAcid = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                        return self._rainAcid;
                                                    }

                                                    // Invalidate acid cache on resize (pattern is ctx-bound)
                                                    const _resizeLike = WeatherCanvasFX.prototype.resizeLike;
                                                    if (typeof _resizeLike === 'function') {
                                                        WeatherCanvasFX.prototype.resizeLike = function (renderer) {
                                                            const oldW = this.canvas ? this.canvas.width : 0;
                                                            const oldH = this.canvas ? this.canvas.height : 0;
                                                            _resizeLike.call(this, renderer);
                                                            const nw = this.canvas ? this.canvas.width : 0;
                                                            const nh = this.canvas ? this.canvas.height : 0;
                                                            if (nw !== oldW || nh !== oldH) {
                                                                const s = acidSlot(this);
                                                                s.pattern = null; s.tile = null; s.size = 0; s.ox = 0; s.oy = 0;
                                                            }
                                                        };
                                                    }

                                                    // Build a green rain pattern (same performance profile as normal rain)
                                                    WeatherCanvasFX.prototype._ensureAcidRainPattern = function () {
                                                        // If the fixed patch installed _ensure2d, use it (it also restores ctx on old browsers)
                                                        if (typeof this._ensure2d === 'function') {
                                                            if (!this._ensure2d()) return;
                                                        }
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        const tile = (this._dpr > 1.25) ? 512 : 256;
                                                        const slot = acidSlot(this);
                                                        if (slot.pattern && slot.size === tile) return;

                                                        const mk = (typeof this._makeOffscreenCanvas === 'function')
                                                            ? (w, h) => this._makeOffscreenCanvas(w, h)
                                                            : (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

                                                        const c = mk(tile, tile);
                                                        const g = get2dCtx(c);
                                                        if (!g) return;

                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        // Use deterministic RNG if available
                                                        const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                        const count = Math.max(220, (tile === 512 ? 420 : 260));

                                                        g.lineCap = 'round';

                                                        // Draw diagonal streaks with green gradient (one-time cost)
                                                        for (let i = 0; i < count; i++) {
                                                            const x = rand() * tile;
                                                            const y = rand() * tile;
                                                            const len = 18 + rand() * 46;
                                                            const lw = 0.55 + rand() * 0.95;

                                                            const ang = (Math.PI / 180) * (74 + rand() * 10);
                                                            const dx = Math.cos(ang) * len;
                                                            const dy = Math.sin(ang) * len;

                                                            const grad = g.createLinearGradient(x, y, x + dx, y + dy);
                                                            grad.addColorStop(0.00, 'rgba(0,255,140,0.00)');
                                                            grad.addColorStop(0.55, 'rgba(0,255,140,0.22)');
                                                            grad.addColorStop(1.00, 'rgba(0,255,140,0.85)');

                                                            g.strokeStyle = grad;
                                                            g.lineWidth = lw;
                                                            g.beginPath();
                                                            g.moveTo(x, y);
                                                            g.lineTo(x + dx, y + dy);
                                                            g.stroke();
                                                        }

                                                        let p = null;
                                                        try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                        if (!p) return;

                                                        slot.tile = c;
                                                        slot.ctx = g;
                                                        slot.pattern = p;
                                                        slot.size = tile;
                                                        slot.ox = 0;
                                                        slot.oy = 0;
                                                    };

                                                    // Use acid pattern when the render wrapper marked it as acid rain
                                                    const _render = WeatherCanvasFX.prototype.render;
                                                    if (typeof _render === 'function') {
                                                        WeatherCanvasFX.prototype.render = function (weather, renderer) {
                                                            this._tuIsAcidRain = !!(weather && weather.acid);
                                                            return _render.call(this, weather, renderer);
                                                        };
                                                    }

                                                    // Override drawRain to optionally use acid pattern (no extra draw calls)
                                                    const _drawRain = WeatherCanvasFX.prototype.drawRain;
                                                    WeatherCanvasFX.prototype.drawRain = function (intensity, dtMs, isThunder) {
                                                        const useAcid = !!this._tuIsAcidRain;
                                                        if (!this.ctx) return;

                                                        if (useAcid) this._ensureAcidRainPattern();
                                                        else if (typeof this._ensureRainPattern === 'function') this._ensureRainPattern();

                                                        const rain = useAcid ? acidSlot(this) : this._rain;
                                                        if (!rain || !rain.pattern) {
                                                            // fallback to original if something went wrong
                                                            if (!useAcid && typeof _drawRain === 'function') return _drawRain.call(this, intensity, dtMs, isThunder);
                                                            return;
                                                        }

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = rain.size | 0;
                                                        if (!tile) return;

                                                        const it = Math.min(1, Math.max(0, Number(intensity) || 0));
                                                        const base = ((isThunder ? 1400 : 1100) * (this._dpr || 1));
                                                        const speed = base * (0.55 + 0.85 * it);

                                                        const dt = (Number(dtMs) || 0) / 1000;
                                                        rain.oy = (rain.oy + speed * dt) % tile;
                                                        rain.ox = (rain.ox + speed * 0.18 * dt) % tile;

                                                        const ox = rain.ox;
                                                        const oy = rain.oy;

                                                        const aBase = (0.10 + 0.28 * it) * (isThunder ? 1.10 : 1.0);

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = rain.pattern;

                                                        // Far layer
                                                        ctx.globalAlpha = aBase * 0.55;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.65, -oy * 0.65);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    };
                                                }

                                                // ───────────────────────── Weather logic: decide acid rain (30%) when rain starts ─────────────────────────
                                                if (!Game.prototype.__tuAcidRainWeatherLogic) {
                                                    Game.prototype.__tuAcidRainWeatherLogic = true;

                                                    const _updateWeather = Game.prototype._updateWeather;
                                                    if (typeof _updateWeather === 'function') {
                                                        Game.prototype._updateWeather = function (dtMs) {
                                                            _updateWeather.call(this, dtMs);

                                                            const w = this.weather;
                                                            if (!w) return;

                                                            const inRainDomain = (w.type === 'rain' || w.type === 'thunder');
                                                            const wasInRain = !!this._tuWasInRainDomain;

                                                            if (inRainDomain && !wasInRain) {
                                                                // New rain event => roll acid chance
                                                                let r = Math.random();
                                                                try {
                                                                    const rng = this._weatherRng;
                                                                    if (typeof rng === 'function') r = rng();
                                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                                w.acid = (r < ACID_CHANCE);

                                                                if (w.acid) {
                                                                    try { if (typeof Toast !== 'undefined' && Toast && Toast.show) Toast.show('☣️ 酸雨降临！躲到遮挡物下避免伤害', 1800); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            } else if (!inRainDomain) {
                                                                w.acid = false;
                                                            } else {
                                                                // staying in rain domain => keep previous
                                                                if (typeof w.acid !== 'boolean') w.acid = !!this._tuAcidWasOn;
                                                            }

                                                            this._tuWasInRainDomain = inRainDomain;
                                                            this._tuAcidWasOn = !!w.acid;

                                                            // Optional: let CSS react if you want (debug / future UI)
                                                            try { document.body && document.body.classList.toggle('weather-acid', inRainDomain && !!w.acid); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── Acid rain damage (only if exposed to sky) ─────────────────────────
                                                function isSolid(blockId) {
                                                    try {
                                                        if (typeof BLOCK_SOLID !== 'undefined' && BLOCK_SOLID && BLOCK_SOLID[blockId]) return true;
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    try {
                                                        const bs = TU && TU.BLOCK_SOLID;
                                                        if (bs && bs[blockId]) return true;
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return false;
                                                }

                                                // Blocks that count as "cover" even if not solid (platforms, leaves, etc.)
                                                const __TU_RAIN_COVER_IDS__ = (() => {
                                                    try {
                                                        if (typeof BLOCK !== 'undefined' && BLOCK) {
                                                            return new Set([
                                                                BLOCK.LEAVES, BLOCK.PALM_LEAVES, BLOCK.CHERRY_LEAVES, BLOCK.PINE_LEAVES,
                                                                BLOCK.LIVING_LEAF, BLOCK.MAHOGANY_LEAVES,
                                                                BLOCK.PLATFORMS_WOOD, BLOCK.PLATFORMS_STONE, BLOCK.PLATFORMS_METAL
                                                            ]);
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return null;
                                                })();

                                                function blocksRain(id) {
                                                    if (isSolid(id)) return true;
                                                    const set = __TU_RAIN_COVER_IDS__;
                                                    if (set && set.has(id)) return true;

                                                    // Fallback: match by Chinese block name ("叶" / "平台")
                                                    try {
                                                        if (typeof BLOCK_META !== 'undefined' && BLOCK_META && BLOCK_META[id] && BLOCK_META[id].name) {
                                                            const n = BLOCK_META[id].name;
                                                            if (n.indexOf('叶') !== -1 || n.indexOf('平台') !== -1) return true;
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return false;
                                                }

                                                function isShelteredFromRain(game) {
                                                    const world = game && game.world;
                                                    const p = game && game.player;
                                                    const ts = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.TILE_SIZE) ? CONFIG.TILE_SIZE : 16;
                                                    if (!world || !world.tiles || !p) return true;

                                                    const tiles = world.tiles;
                                                    const wW = world.w || tiles.length || 0;
                                                    if (wW <= 0) return true;

                                                    const AIR = (typeof BLOCK !== 'undefined' && BLOCK && typeof BLOCK.AIR !== 'undefined') ? BLOCK.AIR : 0;

                                                    const left = Math.floor(p.x / ts);
                                                    const right = Math.floor((p.x + p.w - 1) / ts);
                                                    const topY = Math.floor(p.y / ts) - 1;

                                                    if (topY <= 0) return false; // head is at/above top => exposed

                                                    // Rain can hit if ANY column above the player's width is open to sky
                                                    for (let tx = left; tx <= right; tx++) {
                                                        if (tx < 0 || tx >= wW) continue;
                                                        const col = tiles[tx];
                                                        if (!col) continue;

                                                        let blocked = false;
                                                        for (let ty = topY; ty >= 0; ty--) {
                                                            const id = col[ty];
                                                            if (id !== AIR && blocksRain(id)) { blocked = true; break; }
                                                        }
                                                        if (!blocked) return false;
                                                    }
                                                    return true;
                                                }

                                                function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

                                                function ensureFlash(game, kind) {
                                                    const el = (game && game._tuDamageFlashEl) || damageFlashEl || document.getElementById('damage-flash');
                                                    if (!el) return;
                                                    try {
                                                        if (game) game._tuDamageFlashEl = el;
                                                        el.classList.toggle('acid', kind === 'acid' || kind === 'acidRain');
                                                        el.classList.remove('flash');
                                                        void el.offsetWidth;
                                                        el.classList.add('flash');
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                }

                                                function applyDamage(game, amount, kind) {
                                                    const p = game && game.player;
                                                    if (!p) return;

                                                    const dmg = Math.max(0, amount | 0);
                                                    if (!dmg) return;

                                                    // Apply damage
                                                    p.health = Math.max(0, (p.health | 0) - dmg);

                                                    // Feedback (UI + flash + haptic)
                                                    p._hurtFlashMs = 240;
                                                    p._hurtKind = (kind === 'acidRain') ? 'acid' : (kind || 'acid');

                                                    try { if (game.ui && typeof game.ui.flashDamage === 'function') game.ui.flashDamage(p._hurtKind); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    ensureFlash(game, p._hurtKind);
                                                    try { if (typeof game._haptic === 'function') game._haptic(8); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    // Death / respawn (simple)
                                                    if (p.health <= 0) {
                                                        try { if (typeof Toast !== 'undefined' && Toast && Toast.show) Toast.show('💀 你被酸雨腐蚀了…', 1500); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        p.health = p.maxHealth | 0;
                                                        if (game._tuSpawnPoint) {
                                                            p.x = game._tuSpawnPoint.x;
                                                            p.y = game._tuSpawnPoint.y;
                                                        }
                                                        p.vx = 0; p.vy = 0;
                                                    }
                                                }

                                                // Store spawn point after init
                                                if (!Game.prototype.__tuAcidRainSpawnPoint) {
                                                    Game.prototype.__tuAcidRainSpawnPoint = true;
                                                    const _init = Game.prototype.init;
                                                    if (typeof _init === 'function') {
                                                        Game.prototype.init = async function (...args) {
                                                            const r = await _init.apply(this, args);
                                                            try {
                                                                if (this.player && (this._tuSpawnPoint == null)) {
                                                                    this._tuSpawnPoint = { x: this.player.x, y: this.player.y };
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // Damage tick in update
                                                if (!Game.prototype.__tuAcidRainDamageTick) {
                                                    Game.prototype.__tuAcidRainDamageTick = true;

                                                    Game.prototype._tuUpdateAcidRainDamage = function (dtMs) {
                                                        const w = this.weather;
                                                        const p = this.player;
                                                        if (!w || !p) return false;

                                                        const inRainDomain = (w.type === 'rain' || w.type === 'thunder');
                                                        const acid = !!w.acid;
                                                        const it = clamp01(Number(w.intensity) || 0);

                                                        if (!inRainDomain || !acid || it < ACID_MIN_INTENSITY) {
                                                            this._tuAcidDmgAcc = 0;
                                                            this._tuShelterAcc = 0;
                                                            this._tuSheltered = true;
                                                            return false;
                                                        }

                                                        // Shelter check (throttled)
                                                        this._tuShelterAcc = (this._tuShelterAcc || 0) + (Number(dtMs) || 0);
                                                        if (this._tuShelterAcc >= SHELTER_CHECK_MS || this._tuSheltered === undefined) {
                                                            this._tuShelterAcc = 0;
                                                            this._tuSheltered = isShelteredFromRain(this);
                                                        }

                                                        if (this._tuSheltered) {
                                                            this._tuAcidDmgAcc = 0; // don't "bank" damage while protected
                                                            return false;
                                                        }

                                                        // Damage interval scales with intensity
                                                        const interval = Math.max(DMG_INTERVAL_MIN, Math.min(DMG_INTERVAL_MAX, DMG_INTERVAL_MAX - 650 * it));
                                                        this._tuAcidDmgAcc = (this._tuAcidDmgAcc || 0) + (Number(dtMs) || 0);

                                                        let didDamage = false;
                                                        while (this._tuAcidDmgAcc >= interval) {
                                                            this._tuAcidDmgAcc -= interval;
                                                            const dmg = 1 + (it > 0.82 ? 1 : 0);
                                                            applyDamage(this, dmg, 'acidRain');
                                                            didDamage = true;
                                                        }
                                                        return didDamage;
                                                    };

                                                    const _update = Game.prototype.update;
                                                    if (typeof _update === 'function') {
                                                        Game.prototype.update = function (dt) {
                                                            _update.call(this, dt);
                                                            try {
                                                                const d = Math.min(50, Math.max(0, Number(dt) || 0));
                                                                const did = this._tuUpdateAcidRainDamage(d);
                                                                // Ensure UI reflects health change immediately (only when damage happened)
                                                                if (did && this.ui && typeof this.ui.updateStats === 'function') this.ui.updateStats();
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>

                            <!-- ========================= PATCH: tu_world_worker_patch_v1 ========================= -->
                            <script>
                                (() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_world_worker_patch_v1',
                                            order: 110,
                                            description: "世界生成 Worker + 渲染解耦（v1）",
                                            apply: () => {
                                                'use strict';
                                                if (window.__TU_WORLD_WORKER_PATCHED__) return;
                                                window.__TU_WORLD_WORKER_PATCHED__ = true;

                                                const TU = (window.TU = window.TU || {});

                                                const SUPPORT_GEN_WORKER = (typeof Worker !== 'undefined') && (typeof Blob !== 'undefined') && (typeof URL !== 'undefined');
                                                const SUPPORT_RENDER_WORKER =
                                                    SUPPORT_GEN_WORKER &&
                                                    (typeof OffscreenCanvas !== 'undefined') &&
                                                    (typeof ImageBitmap !== 'undefined');

                                                function _safeNow() {
                                                    try { return performance.now(); } catch (_) { return Date.now(); }
                                                }

                                                function _fnToExpr(fn) {
                                                    const s = String(fn);
                                                    // For class methods, toString() returns "name(args){...}" which isn't a valid expression.
                                                    // Prefix with "function " to make it a valid function expression.
                                                    if (s.startsWith('function')) return s;
                                                    return 'function ' + s;
                                                }

                                                class WorldWorkerClient {
                                                    constructor() {
                                                        // 防御性初始化
                                                        this.worker = null;
                                                        this._initSent = false;
                                                        this._pendingGen = null;
                                                        this._reqId = 1;
                                                        this._state = 'idle';
                                                        this._stateLock = Promise.resolve();
                                                        this._seq = 0;
                                                        this._pending = new Map();
                                                        this._processedSeqs = new Set();

                                                        let __tuWwRender = true;
                                                        try { __tuWwRender = (typeof localStorage === 'undefined' || localStorage.getItem('tuWorkerRender') !== '0'); } catch (_) { __tuWwRender = true; }
                                                        this._renderEnabled = !!SUPPORT_RENDER_WORKER && __tuWwRender;
                                                        this._worldReady = false;

                                                        this._frameInFlight = false;
                                                        this._frameId = 1;
                                                        this._initializing = false;
                                                        this._lastBitmap = null;
                                                        this._lastFrameSentAt = 0;
                                                        this._frameTimeouts = 0;

                                                        this._lightSynced = false;

                                                        this.perf = {
                                                            genMs: null
                                                        };
                                                    }

                                                    get renderEnabled() { return this._renderEnabled; }
                                                    get worldReady() { return this._worldReady; }
                                                    get lightSynced() { return this._lightSynced; }

                                                    _ensureWorker() {
                                                        if (this.worker) return;

                                                        const parts = WorldWorkerClient._buildWorkerSourceParts();
                                                        const blob = new Blob(parts, { type: 'application/javascript' });
                                                        const url = URL.createObjectURL(blob);

                                                        try {
                                                            this.worker = new Worker(url);
                                                        } catch (e) {
                                                            console.error('[WorldWorkerClient] Failed to create worker:', e);
                                                            this._initializing = false;
                                                            throw e;
                                                        }
                                                        URL.revokeObjectURL(url);

                                                        this.worker.onmessage = (e) => this._onMessage(e.data);
                                                        this.worker.onerror = (e) => {
                                                            console.error('[WorldWorker] error event', e);
                                                            if (this._pendingGen) {
                                                                const rej = this._pendingGen.reject;
                                                                this._pendingGen = null;
                                                                try { rej(new Error((e && e.message) ? e.message : 'Worker error')); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            } try { this._frameInFlight = false; this._renderEnabled = false; this._worldReady = false; this._lightSynced = false; if (this._lastBitmap && this._lastBitmap.close) { try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this._lastBitmap = null; const _w = this.worker; if (_w && _w.terminate) { try { _w.terminate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this.worker = null; this._initSent = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }

                                                    _sendInitOnce() {
                                                        if (this._initSent) return;
                                                        this._initSent = true;

                                                        const structuresEl = document.getElementById('tu-structures-json');
                                                        const structuresJSON = structuresEl ? structuresEl.textContent : '[]';

                                                        // Copy typed arrays so we can transfer their buffers without detaching originals.
                                                        let solidBuf = null;
                                                        let lightBuf = null;
                                                        let sunDecayBuf = null;

                                                        try {
                                                            if (typeof BLOCK_SOLID !== 'undefined' && BLOCK_SOLID) {
                                                                const c = new Uint8Array(BLOCK_SOLID);
                                                                solidBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        try {
                                                            if (typeof BLOCK_LIGHT !== 'undefined' && BLOCK_LIGHT) {
                                                                const c = new Uint8Array(BLOCK_LIGHT);
                                                                lightBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        try {
                                                            if (typeof SUN_DECAY !== 'undefined' && SUN_DECAY) {
                                                                const c = new Uint8Array(SUN_DECAY);
                                                                sunDecayBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        const transfer = [];
                                                        if (solidBuf) transfer.push(solidBuf);
                                                        if (lightBuf) transfer.push(lightBuf);
                                                        if (sunDecayBuf) transfer.push(sunDecayBuf);

                                                        this.worker.postMessage({
                                                            type: 'init',
                                                            CONFIG,
                                                            BLOCK,
                                                            BLOCK_DATA,
                                                            structuresJSON,
                                                            solid: solidBuf,
                                                            light: lightBuf,
                                                            sunDecay: sunDecayBuf,
                                                            renderEnabled: this._renderEnabled
                                                        }, transfer);
                                                    }

                                                    async generate(w, h, seed, progressCb) {
                                                        // 防御性参数验证
                                                        if (!SUPPORT_GEN_WORKER) {
                                                            throw new Error('Worker not supported');
                                                        }

                                                        // 验证世界尺寸
                                                        if (!Number.isInteger(w) || w <= 0 || w > 10000) {
                                                            throw new Error(`Invalid world width: ${w}`);
                                                        }
                                                        if (!Number.isInteger(h) || h <= 0 || h > 10000) {
                                                            throw new Error(`Invalid world height: ${h}`);
                                                        }

                                                        // 验证种子
                                                        if (seed === undefined || seed === null) {
                                                            seed = Date.now();
                                                        }

                                                        this._ensureWorker();
                                                        this._sendInitOnce();

                                                        this._worldReady = false;
                                                        this._lightSynced = false;

                                                        return await new Promise((resolve, reject) => {
                                                            const id = this._reqId++;
                                                            this._pendingGen = {
                                                                id,
                                                                resolve,
                                                                reject,
                                                                progressCb: (typeof progressCb === 'function') ? progressCb : null,
                                                                t0: _safeNow()
                                                            };
                                                            this.worker.postMessage({
                                                                type: 'generate',
                                                                id,
                                                                w: w | 0,
                                                                h: h | 0,
                                                                seed: seed,
                                                                keepCopy: !!this._renderEnabled
                                                            });
                                                        });
                                                    }

                                                    _onMessage(msg) {
                                                        // 防御性：验证消息格式
                                                        if (!msg || typeof msg !== 'object') {
                                                            console.warn('[WorldWorkerClient] Invalid message format');
                                                            return;
                                                        }
                                                        if (!msg.type) {
                                                            console.warn('[WorldWorkerClient] Message missing type');
                                                            return;
                                                        }

                                                        // 序列号验证（防重放）
                                                        if (msg._seq !== undefined) {
                                                            if (this._processedSeqs.has(msg._seq)) {
                                                                console.warn(`[WorldWorkerClient] Duplicate message seq: ${msg._seq}`);
                                                                return;
                                                            }
                                                            this._processedSeqs.add(msg._seq);
                                                            if (this._processedSeqs.size > 4096) {
                                                                this._processedSeqs.clear();
                                                                this._processedSeqs.add(msg._seq);
                                                            }
                                                        }

                                                        if (msg.type === 'progress') {
                                                            if (this._pendingGen && msg.id === this._pendingGen.id && this._pendingGen.progressCb) {
                                                                try { this._pendingGen.progressCb(msg.status, msg.percent); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            return;
                                                        }

                                                        if (msg.type === 'done') {
                                                            if (!this._pendingGen || msg.id !== this._pendingGen.id) return;

                                                            const { resolve, t0 } = this._pendingGen;
                                                            this._pendingGen = null;

                                                            const w = msg.w | 0;
                                                            const h = msg.h | 0;

                                                            const tilesBuf = msg.tiles;
                                                            const wallsBuf = msg.walls;
                                                            const lightBuf = msg.light;

                                                            const world = { w, h, tiles: new Array(w), walls: new Array(w), light: new Array(w) };
                                                            for (let x = 0; x < w; x++) {
                                                                world.tiles[x] = new Uint8Array(tilesBuf, x * h, h);
                                                                world.walls[x] = new Uint8Array(wallsBuf, x * h, h);
                                                                world.light[x] = new Uint8Array(lightBuf, x * h, h);
                                                            }

                                                            this._worldReady = true;

                                                            const genMs = (typeof msg.genMs === 'number') ? msg.genMs : (_safeNow() - t0);
                                                            this.perf.genMs = genMs;
                                                            try {
                                                                console.info(`[WorldWorker] generated ${w}x${h} in ${genMs.toFixed(1)}ms`);
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            // Expose perf for manual benchmarking in devtools.
                                                            window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                            window.__TU_PERF__.worldGenMs = genMs;

                                                            resolve(world);
                                                            return;
                                                        }

                                                        if (msg.type === 'error') {
                                                            console.error('[WorldWorker] message error', msg);
                                                            if (this._pendingGen && msg.id === this._pendingGen.id) {
                                                                const rej = this._pendingGen.reject;
                                                                this._pendingGen = null;
                                                                try { rej(new Error(msg.message || 'Worker error')); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            try { this._frameInFlight = false; this._renderEnabled = false; this._worldReady = false; this._lightSynced = false; if (this._lastBitmap && this._lastBitmap.close) { try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this._lastBitmap = null; const _w = this.worker; if (_w && _w.terminate) { try { _w.terminate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this.worker = null; this._initSent = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } return;
                                                        }

                                                        if (msg.type === 'frame') {
                                                            // Bitmap world layer for main thread to draw.
                                                            if (this._lastBitmap && this._lastBitmap.close) {
                                                                try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            this._lastBitmap = msg.bitmap || null;
                                                            this._frameInFlight = false;
                                                            this._lastFrameSentAt = 0;
                                                            this._frameTimeouts = 0;
                                                            return;
                                                        }
                                                    }

                                                    requestFrame(cam, time, renderer) {
                                                        // 防御性状态检查
                                                        if (!this._renderEnabled || !this._worldReady || !this.worker) return;

                                                        // 验证相机对象
                                                        if (!cam || typeof cam.x !== 'number' || typeof cam.y !== 'number') {
                                                            console.warn('[WorldWorkerClient] Invalid camera object');
                                                            return;
                                                        }

                                                        // 验证renderer
                                                        if (!renderer || typeof renderer.w !== 'number' || typeof renderer.h !== 'number') {
                                                            console.warn('[WorldWorkerClient] Invalid renderer object');
                                                            return;
                                                        }

                                                        const now = (performance && performance.now) ? performance.now() : Date.now();

                                                        // Watchdog: prevent permanent stall if worker never returns a frame.
                                                        if (this._frameInFlight) {
                                                            if (this._lastFrameSentAt && (now - this._lastFrameSentAt) > 1500) {
                                                                this._frameTimeouts = (this._frameTimeouts | 0) + 1;
                                                                console.warn('[WorldWorkerClient] Frame timeout, resetting inFlight (count=' + this._frameTimeouts + ')');

                                                                this._frameInFlight = false;

                                                                // Too many consecutive timeouts -> disable worker rendering to fall back.
                                                                if (this._frameTimeouts >= 3) {
                                                                    console.warn('[WorldWorkerClient] Too many frame timeouts, disabling worker rendering');
                                                                    this._renderEnabled = false;
                                                                    this._frameTimeouts = 0;
                                                                    return;
                                                                }
                                                            }
                                                            return;
                                                        }

                                                        this._frameInFlight = true;
                                                        this._lastFrameSentAt = now;
                                                        const id = this._frameId++;

                                                        // Use renderer's CSS units & DPR to match its coordinate system.
                                                        const wCss = renderer && renderer.w ? renderer.w : 0;
                                                        const hCss = renderer && renderer.h ? renderer.h : 0;
                                                        const dpr = renderer && renderer.dpr ? renderer.dpr : 1;

                                                        try {
                                                            this.worker.postMessage({
                                                                type: 'render',
                                                                id,
                                                                camX: cam.x,
                                                                camY: cam.y,
                                                                time: time,
                                                                wCss: wCss,
                                                                hCss: hCss,
                                                                dpr: dpr
                                                            });
                                                        } catch (e) {
                                                            // If postMessage fails (e.g., terminated worker), reset flags to avoid perma-stall
                                                            this._frameInFlight = false;
                                                            this._lastFrameSentAt = 0;
                                                            this._frameTimeouts = 0;
                                                            this._renderEnabled = false; // fall back to main-thread renderer
                                                            window.TU_Defensive && window.TU_Defensive.ErrorReporter && window.TU_Defensive.ErrorReporter.report(e, { source: 'WorldWorkerClient.postMessage' });
                                                        }
                                                    }

                                                    consumeBitmap() {
                                                        const bm = this._lastBitmap;
                                                        this._lastBitmap = null;
                                                        return bm;
                                                    }

                                                    notifyTile(x, y, id) {
                                                        if (!this._renderEnabled || !this.worker) return;
                                                        this.worker.postMessage({ type: 'tile', x: x | 0, y: y | 0, id: id | 0 });
                                                    }

                                                    applyDiffMap(diffMap) {
                                                        if (!this._renderEnabled || !this.worker || !diffMap || !diffMap.size) return;

                                                        const n = diffMap.size;
                                                        const triples = new Int32Array(n * 3);
                                                        let i = 0;

                                                        for (const [key, val] of diffMap.entries()) {
                                                            const comma = key.indexOf(',');
                                                            if (comma < 0) continue;
                                                            triples[i++] = (key.slice(0, comma) | 0);
                                                            triples[i++] = (key.slice(comma + 1) | 0);
                                                            triples[i++] = (val | 0);
                                                        }

                                                        // If some entries were skipped due to malformed keys, slice to real size.
                                                        const buf = (i === triples.length) ? triples.buffer : triples.slice(0, i).buffer;
                                                        this.worker.postMessage({ type: 'tileBatch', buf }, [buf]);
                                                    }

                                                    syncLightFull(world) {
                                                        if (!this._renderEnabled || !this.worker || !world || !world.light) return;

                                                        const w = world.w | 0;
                                                        const h = world.h | 0;

                                                        const flat = new Uint8Array(w * h);
                                                        for (let x = 0; x < w; x++) {
                                                            flat.set(world.light[x], x * h);
                                                        }

                                                        const buf = flat.buffer;
                                                        this.worker.postMessage({ type: 'lightFull', w, h, buf }, [buf]);
                                                        this._lightSynced = true;
                                                    }

                                                    syncLightRegion(world, cx, cy, r) {
                                                        if (!this._renderEnabled || !this.worker || !world || !world.light) return;
                                                        if (!this._lightSynced) return; // suppress spam during load; full sync happens after init

                                                        const w = world.w | 0;
                                                        const h = world.h | 0;
                                                        const rr = (r == null) ? 14 : (r | 0);

                                                        const x0 = Math.max(0, (cx | 0) - rr);
                                                        const x1 = Math.min(w - 1, (cx | 0) + rr);
                                                        const y0 = Math.max(0, (cy | 0) - rr);
                                                        const y1 = Math.min(h - 1, (cy | 0) + rr);

                                                        const rw = (x1 - x0 + 1) | 0;
                                                        const rh = (y1 - y0 + 1) | 0;
                                                        if (rw <= 0 || rh <= 0) return;

                                                        const flat = new Uint8Array(rw * rh);
                                                        for (let x = x0; x <= x1; x++) {
                                                            const col = world.light[x];
                                                            const off = (x - x0) * rh;
                                                            for (let y = y0; y <= y1; y++) {
                                                                flat[off + (y - y0)] = col[y] | 0;
                                                            }
                                                        }

                                                        const buf = flat.buffer;
                                                        this.worker.postMessage({ type: 'lightRegion', x0, y0, w: rw, h: rh, buf }, [buf]);
                                                    }

                                                    static _buildWorkerSourceParts() {
                                                        if (WorldWorkerClient.__cachedWorkerParts) return WorldWorkerClient.__cachedWorkerParts;

                                                        // Capture current (possibly patched) generator code.
                                                        const NG = (typeof NoiseGenerator !== 'undefined') ? NoiseGenerator : null;
                                                        const WG = (typeof WorldGenerator !== 'undefined') ? WorldGenerator : null;

                                                        const parts = [];
                                                        const PRE = `'use strict';\n` +
                                                            `const window = self;\n` +
                                                            `let CONFIG=null, BLOCK=null, BLOCK_DATA=null;\n` +
                                                            `let BLOCK_SOLID=null, BLOCK_LIGHT=null, SUN_DECAY=null;\n` +
                                                            `let __STRUCT_JSON='[]';\n` +
                                                            `let __AIR=0;\n` +
                                                            `const Utils = { clamp: (v,a,b) => Math.max(a, Math.min(b, v)) };\n`;
                                                        parts.push(PRE);

                                                        // Minimal TU.Structures for patched structure welding.
                                                        parts.push("self.TU = self.TU || {};\n");
                                                        parts.push("self.TU.Structures = (function(){\n");
                                                        parts.push("  let _loaded = false;\n");
                                                        parts.push("  let _list = [];\n");
                                                        parts.push("  function _normDepth(d){\n");
                                                        parts.push("    if (Array.isArray(d) && d.length>=2) return [+(d[0]||0), +(d[1]||1)];\n");
                                                        parts.push("    return [0,1];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function _toId(name){\n");
                                                        parts.push("    if (!name) return 0;\n");
                                                        parts.push("    const v = BLOCK && (BLOCK[name] != null) ? BLOCK[name] : 0;\n");
                                                        parts.push("    return v|0;\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function _normalize(raw){\n");
                                                        parts.push("    if (!raw || !Array.isArray(raw.pattern)) return null;\n");
                                                        parts.push("    const grid = raw.pattern.slice();\n");
                                                        parts.push("    const h = grid.length|0;\n");
                                                        parts.push("    let w = 0;\n");
                                                        parts.push("    for (let i=0;i<grid.length;i++){ const row=grid[i]||''; if (row.length>w) w=row.length; }\n");
                                                        parts.push("    const legend = {};\n");
                                                        parts.push("    if (raw.legend){\n");
                                                        parts.push("      for (const ch in raw.legend){\n");
                                                        parts.push("        const r = raw.legend[ch] || {};\n");
                                                        parts.push("        legend[ch] = {\n");
                                                        parts.push("          tile: _toId(r.tile),\n");
                                                        parts.push("          wall: _toId(r.wall),\n");
                                                        parts.push("          replace: r.replace || 'any',\n");
                                                        parts.push("          chance: (r.chance==null?1:+r.chance)\n");
                                                        parts.push("        };\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    return {\n");
                                                        parts.push("      id: raw.id || '',\n");
                                                        parts.push("      tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],\n");
                                                        parts.push("      weight: +raw.weight || 1,\n");
                                                        parts.push("      depth: _normDepth(raw.depth),\n");
                                                        parts.push("      anchor: Array.isArray(raw.anchor) ? [raw.anchor[0]|0, raw.anchor[1]|0] : [0,0],\n");
                                                        parts.push("      placement: raw.placement || {},\n");
                                                        parts.push("      grid,\n");
                                                        parts.push("      w,\n");
                                                        parts.push("      h,\n");
                                                        parts.push("      legend,\n");
                                                        parts.push("      connectors: Array.isArray(raw.connectors) ? raw.connectors.map(c=>({x:c.x|0,y:c.y|0,dir:c.dir||'down'})) : []\n");
                                                        parts.push("    };\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function ensureLoaded(){\n");
                                                        parts.push("    if (_loaded) return;\n");
                                                        parts.push("    _loaded = true;\n");
                                                        parts.push("    let raw = [];\n");
                                                        parts.push("    try { raw = JSON.parse(__STRUCT_JSON || '[]'); } catch (_) { raw = []; }\n");
                                                        parts.push("    _list = raw.map(_normalize).filter(Boolean);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function count(){ ensureLoaded(); return _list.length; }\n");
                                                        parts.push("  function pick(depthN, tags){\n");
                                                        parts.push("    ensureLoaded();\n");
                                                        parts.push("    const tagArr = Array.isArray(tags) ? tags : (tags ? [tags] : []);\n");
                                                        parts.push("    const candidates = [];\n");
                                                        parts.push("    for (let i=0;i<_list.length;i++){\n");
                                                        parts.push("      const d = _list[i];\n");
                                                        parts.push("      if (depthN < d.depth[0] || depthN > d.depth[1]) continue;\n");
                                                        parts.push("      if (tagArr.length){\n");
                                                        parts.push("        let ok=false;\n");
                                                        parts.push("        for (let k=0;k<tagArr.length;k++){ if (d.tags && d.tags.indexOf(tagArr[k])>=0){ ok=true; break; } }\n");
                                                        parts.push("        if (!ok) continue;\n");
                                                        parts.push("      }\n");
                                                        parts.push("      candidates.push(d);\n");
                                                        parts.push("    }\n");
                                                        parts.push("    const pool = candidates.length ? candidates : _list;\n");
                                                        parts.push("    if (!pool.length) return null;\n");
                                                        parts.push("    let sum = 0;\n");
                                                        parts.push("    for (let i=0;i<pool.length;i++) sum += pool[i].weight || 1;\n");
                                                        parts.push("    let r = Math.random() * sum;\n");
                                                        parts.push("    for (let i=0;i<pool.length;i++){ r -= pool[i].weight || 1; if (r<=0) return pool[i]; }\n");
                                                        parts.push("    return pool[pool.length-1];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  return { ensureLoaded, count, pick };\n");
                                                        parts.push("})();\n");

                                                        // Include generator classes.
                                                        if (NG) parts.push(NG.toString(), "\n");
                                                        if (WG) parts.push(WG.toString(), "\n");

                                                        // Re-apply any prototype patches that were applied on the main thread (biomes/structures/etc).
                                                        const patchNames = [
                                                            '_weldStructuresFromLibrary',
                                                            '_carveConnectorTunnel',
                                                            '_biome',
                                                            '_getSurfaceBlock',
                                                            '_getSubSurfaceBlock',
                                                            '_getUndergroundBlock',
                                                            '_getUndergroundBlockLegacy',
                                                            '_placeTemple',
                                                            '_generateMultiLayerMines',
                                                            '_structures'
                                                        ];
                                                        if (WG && WG.prototype) {
                                                            for (let i = 0; i < patchNames.length; i++) {
                                                                const name = patchNames[i];
                                                                const fn = WG.prototype[name];
                                                                if (typeof fn === 'function') {
                                                                    const expr = _fnToExpr(fn.toString());
                                                                    parts.push("WorldGenerator.prototype.", name, " = ", expr, ";\n");
                                                                }
                                                            }
                                                        }

                                                        // Simple render (world layer only) to ImageBitmap using OffscreenCanvas.
                                                        parts.push("let __renderEnabled = false;\n");
                                                        parts.push("let __worldW=0, __worldH=0;\n");
                                                        parts.push("let __tiles=null, __walls=null, __light=null;\n");
                                                        parts.push("let __tileLUT=null, __wallLUT=null, __maxId=0;\n");
                                                        parts.push("function __nightFactor(time){\n");
                                                        parts.push("  // same shape as Utils.nightFactor (0 day -> 1 night)\n");
                                                        parts.push("  const t = time - Math.floor(time);\n");
                                                        parts.push("  const d = Math.min(Math.abs(t - 0.5) * 2, 1);\n");
                                                        parts.push("  return Math.min(1, Math.pow(d, 2));\n");
                                                        parts.push("}\n");
                                                        parts.push("function __parseHexColor(hex){\n");
                                                        parts.push("  if (!hex || typeof hex !== 'string') return [128,128,128];\n");
                                                        parts.push("  const s = hex.trim();\n");
                                                        parts.push("  if (s[0] !== '#') return [128,128,128];\n");
                                                        parts.push("  if (s.length === 4){\n");
                                                        parts.push("    const r = parseInt(s[1]+s[1],16), g=parseInt(s[2]+s[2],16), b=parseInt(s[3]+s[3],16);\n");
                                                        parts.push("    return [r|0,g|0,b|0];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  if (s.length === 7){\n");
                                                        parts.push("    const r = parseInt(s.slice(1,3),16), g=parseInt(s.slice(3,5),16), b=parseInt(s.slice(5,7),16);\n");
                                                        parts.push("    return [r|0,g|0,b|0];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  return [128,128,128];\n");
                                                        parts.push("}\n");
                                                        parts.push("function __buildColorLUT(){\n");
                                                        parts.push("  if (!BLOCK_DATA || !BLOCK) return;\n");
                                                        parts.push("  __maxId = 0;\n");
                                                        parts.push("  for (const k in BLOCK){ const v = BLOCK[k]|0; if (v>__maxId) __maxId=v; }\n");
                                                        parts.push("  const maxLight = 15;\n");
                                                        parts.push("  __tileLUT = new Array((__maxId+1)*16);\n");
                                                        parts.push("  __wallLUT = new Array((__maxId+1)*16);\n");
                                                        parts.push("  for (let id=0; id<=__maxId; id++){\n");
                                                        parts.push("    const data = BLOCK_DATA[id] || BLOCK_DATA[String(id)] || {};\n");
                                                        parts.push("    const rgb = __parseHexColor(data.color);\n");
                                                        parts.push("    for (let l=0; l<16; l++){\n");
                                                        parts.push("      const m = l / maxLight;\n");
                                                        parts.push("      const r = (rgb[0]*m)|0, g=(rgb[1]*m)|0, b=(rgb[2]*m)|0;\n");
                                                        parts.push("      __tileLUT[id*16+l] = 'rgb(' + r + ',' + g + ',' + b + ')';\n");
                                                        parts.push("      const wr=(rgb[0]*m*0.6)|0, wg=(rgb[1]*m*0.6)|0, wb=(rgb[2]*m*0.6)|0;\n");
                                                        parts.push("      __wallLUT[id*16+l] = 'rgb(' + wr + ',' + wg + ',' + wb + ')';\n");
                                                        parts.push("    }\n");
                                                        parts.push("  }\n");
                                                        parts.push("}\n");
                                                        parts.push("class __SimpleWorldRenderer {\n");
                                                        parts.push("  constructor(){\n");
                                                        parts.push("    this.canvas = new OffscreenCanvas(1,1);\n");
                                                        parts.push("    this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });\n");
                                                        parts.push("    this.wCss = 1; this.hCss = 1; this.dpr = 1;\n");
                                                        parts.push("    this.ts = (CONFIG && CONFIG.TILE_SIZE) ? CONFIG.TILE_SIZE : 16;\n");
                                                        parts.push("  }\n");
                                                        parts.push("  resize(wCss,hCss,dpr){\n");
                                                        parts.push("    wCss = Math.max(1, wCss|0);\n");
                                                        parts.push("    hCss = Math.max(1, hCss|0);\n");
                                                        parts.push("    dpr = (dpr && dpr>0) ? dpr : 1;\n");
                                                        parts.push("    const wPx = Math.max(1, Math.floor(wCss * dpr));\n");
                                                        parts.push("    const hPx = Math.max(1, Math.floor(hCss * dpr));\n");
                                                        parts.push("    if (this.canvas.width !== wPx) this.canvas.width = wPx;\n");
                                                        parts.push("    if (this.canvas.height !== hPx) this.canvas.height = hPx;\n");
                                                        parts.push("    this.wCss = wCss; this.hCss = hCss; this.dpr = dpr;\n");
                                                        parts.push("    this.ctx.setTransform(dpr,0,0,dpr,0,0);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  render(camX, camY, time){\n");
                                                        parts.push("    const ctx = this.ctx;\n");
                                                        parts.push("    const ts = this.ts;\n");
                                                        parts.push("    const wCss = this.wCss;\n");
                                                        parts.push("    const hCss = this.hCss;\n");
                                                        parts.push("    const halfW = wCss/2;\n");
                                                        parts.push("    const halfH = hCss/2;\n");
                                                        parts.push("    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);\n");
                                                        parts.push("    ctx.clearRect(0,0,wCss,hCss);\n");
                                                        parts.push("    const margin = 2;\n");
                                                        parts.push("    const x0 = Math.max(0, Math.floor((camX - halfW)/ts) - margin);\n");
                                                        parts.push("    const x1 = Math.min(__worldW-1, Math.floor((camX + halfW)/ts) + margin);\n");
                                                        parts.push("    const y0 = Math.max(0, Math.floor((camY - halfH)/ts) - margin);\n");
                                                        parts.push("    const y1 = Math.min(__worldH-1, Math.floor((camY + halfH)/ts) + margin);\n");
                                                        parts.push("    // Walls behind air\n");
                                                        parts.push("    for (let y=y0; y<=y1; y++){\n");
                                                        parts.push("      const sy = y*ts - camY + halfH;\n");
                                                        parts.push("      let runStart = x0;\n");
                                                        parts.push("      let runStyle = null;\n");
                                                        parts.push("      for (let x=x0; x<=x1+1; x++){\n");
                                                        parts.push("        let style = null;\n");
                                                        parts.push("        if (x<=x1){\n");
                                                        parts.push("          const idx = x*__worldH + y;\n");
                                                        parts.push("          const tid = __tiles ? __tiles[idx] : 0;\n");
                                                        parts.push("          const wid = __walls ? __walls[idx] : 0;\n");
                                                        parts.push("          if (wid && tid===__AIR){\n");
                                                        parts.push("            const lv = __light ? (__light[idx]&15) : 15;\n");
                                                        parts.push("            style = __wallLUT ? __wallLUT[wid*16 + lv] : 'rgb(40,40,40)';\n");
                                                        parts.push("          }\n");
                                                        parts.push("        }\n");
                                                        parts.push("        if (style !== runStyle){\n");
                                                        parts.push("          if (runStyle){\n");
                                                        parts.push("            ctx.fillStyle = runStyle;\n");
                                                        parts.push("            const sx = runStart*ts - camX + halfW;\n");
                                                        parts.push("            ctx.fillRect(sx, sy, (x-runStart)*ts, ts);\n");
                                                        parts.push("          }\n");
                                                        parts.push("          runStyle = style;\n");
                                                        parts.push("          runStart = x;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    // Foreground tiles\n");
                                                        parts.push("    for (let y=y0; y<=y1; y++){\n");
                                                        parts.push("      const sy = y*ts - camY + halfH;\n");
                                                        parts.push("      let runStart = x0;\n");
                                                        parts.push("      let runStyle = null;\n");
                                                        parts.push("      for (let x=x0; x<=x1+1; x++){\n");
                                                        parts.push("        let style = null;\n");
                                                        parts.push("        if (x<=x1){\n");
                                                        parts.push("          const idx = x*__worldH + y;\n");
                                                        parts.push("          const tid = __tiles ? __tiles[idx] : 0;\n");
                                                        parts.push("          if (tid && tid!==__AIR){\n");
                                                        parts.push("            const lv = __light ? (__light[idx]&15) : 15;\n");
                                                        parts.push("            style = __tileLUT ? __tileLUT[tid*16 + lv] : 'rgb(120,120,120)';\n");
                                                        parts.push("          }\n");
                                                        parts.push("        }\n");
                                                        parts.push("        if (style !== runStyle){\n");
                                                        parts.push("          if (runStyle){\n");
                                                        parts.push("            ctx.fillStyle = runStyle;\n");
                                                        parts.push("            const sx = runStart*ts - camX + halfW;\n");
                                                        parts.push("            ctx.fillRect(sx, sy, (x-runStart)*ts, ts);\n");
                                                        parts.push("          }\n");
                                                        parts.push("          runStyle = style;\n");
                                                        parts.push("          runStart = x;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    // Global night tint (cheap)\n");
                                                        parts.push("    const nf = __nightFactor(time || 0);\n");
                                                        parts.push("    if (nf > 0.001){\n");
                                                        parts.push("      ctx.fillStyle = 'rgba(0,0,0,' + (nf*0.35) + ')';\n");
                                                        parts.push("      ctx.fillRect(0,0,wCss,hCss);\n");
                                                        parts.push("    }\n");
                                                        parts.push("    return this.canvas.transferToImageBitmap();\n");
                                                        parts.push("  }\n");
                                                        parts.push("}\n");

                                                        // Worker message handler.
                                                        parts.push("async function __doGenerate(id,w,h,seed,keepCopy){\n");
                                                        parts.push("  const t0 = (self.performance && performance.now) ? performance.now() : Date.now();\n");
                                                        parts.push("  const gen = new WorldGenerator(w,h,seed);\n");
                                                        parts.push("  const data = await gen.generate((status, percent)=>{\n");
                                                        parts.push("    self.postMessage({ type: 'progress', id, status, percent });\n");
                                                        parts.push("  });\n");
                                                        parts.push("  // Flatten column arrays into a single transferable buffer per layer.\n");
                                                        parts.push("  const tilesBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const wallsBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const lightBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const tilesFlat = new Uint8Array(tilesBuf);\n");
                                                        parts.push("  const wallsFlat = new Uint8Array(wallsBuf);\n");
                                                        parts.push("  const lightFlat = new Uint8Array(lightBuf);\n");
                                                        parts.push("  for (let x=0; x<w; x++){\n");
                                                        parts.push("    tilesFlat.set(data.tiles[x], x*h);\n");
                                                        parts.push("    wallsFlat.set(data.walls[x], x*h);\n");
                                                        parts.push("    lightFlat.set(data.light[x], x*h);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  if (keepCopy && __renderEnabled){\n");
                                                        parts.push("    __worldW = w; __worldH = h;\n");
                                                        parts.push("    __tiles = new Uint8Array(tilesBuf.slice(0));\n");
                                                        parts.push("    __walls = new Uint8Array(wallsBuf.slice(0));\n");
                                                        parts.push("    __light = new Uint8Array(lightBuf.slice(0));\n");
                                                        parts.push("    if (!__tileLUT) __buildColorLUT();\n");
                                                        parts.push("  }\n");
                                                        parts.push("  const t1 = (self.performance && performance.now) ? performance.now() : Date.now();\n");
                                                        parts.push("  const genMs = t1 - t0;\n");
                                                        parts.push("  self.postMessage({ type: 'done', id, w, h, tiles: tilesBuf, walls: wallsBuf, light: lightBuf, genMs }, [tilesBuf, wallsBuf, lightBuf]);\n");
                                                        parts.push("}\n");

                                                        parts.push("self.onmessage = async (e) => {\n");
                                                        parts.push("  const msg = e.data || {};\n");
                                                        parts.push("  const type = msg.type;\n");
                                                        parts.push("  try {\n");
                                                        parts.push("    if (type === 'init'){\n");
                                                        parts.push("      CONFIG = msg.CONFIG || null;\n");
                                                        parts.push("      BLOCK = msg.BLOCK || null;\n");
                                                        parts.push("      BLOCK_DATA = msg.BLOCK_DATA || null;\n");
                                                        parts.push("      __STRUCT_JSON = msg.structuresJSON || '[]';\n");
                                                        parts.push("      BLOCK_SOLID = msg.solid ? new Uint8Array(msg.solid) : null;\n");
                                                        parts.push("      BLOCK_LIGHT = msg.light ? new Uint8Array(msg.light) : null;\n");
                                                        parts.push("      SUN_DECAY = msg.sunDecay ? new Uint8Array(msg.sunDecay) : null;\n");
                                                        parts.push("      __AIR = (BLOCK && (BLOCK.AIR != null)) ? (BLOCK.AIR|0) : 0;\n");
                                                        parts.push("      __renderEnabled = !!msg.renderEnabled && (typeof OffscreenCanvas !== 'undefined');\n");
                                                        parts.push("      __buildColorLUT();\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'generate'){\n");
                                                        parts.push("      const id = msg.id|0;\n");
                                                        parts.push("      const w = msg.w|0;\n");
                                                        parts.push("      const h = msg.h|0;\n");
                                                        parts.push("      const seed = msg.seed;\n");
                                                        parts.push("      const keepCopy = !!msg.keepCopy;\n");
                                                        parts.push("      await __doGenerate(id,w,h,seed,keepCopy);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'tile'){\n");
                                                        parts.push("      if (!__tiles) return;\n");
                                                        parts.push("      const x = msg.x|0, y = msg.y|0, id = msg.id|0;\n");
                                                        parts.push("      if (x<0||y<0||x>=__worldW||y>=__worldH) return;\n");
                                                        parts.push("      __tiles[x*__worldH + y] = id;\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'tileBatch'){\n");
                                                        parts.push("      if (!__tiles || !msg.buf) return;\n");
                                                        parts.push("      const a = new Int32Array(msg.buf);\n");
                                                        parts.push("      for (let i=0; i<a.length; i+=3){\n");
                                                        parts.push("        const x=a[i]|0, y=a[i+1]|0, id=a[i+2]|0;\n");
                                                        parts.push("        if (x<0||y<0||x>=__worldW||y>=__worldH) continue;\n");
                                                        parts.push("        __tiles[x*__worldH + y] = id;\n");
                                                        parts.push("      }\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'lightFull'){\n");
                                                        parts.push("      if (!msg.buf) return;\n");
                                                        parts.push("      const w = msg.w|0, h = msg.h|0;\n");
                                                        parts.push("      __worldW = w; __worldH = h;\n");
                                                        parts.push("      __light = new Uint8Array(msg.buf);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'lightRegion'){\n");
                                                        parts.push("      if (!__light || !msg.buf) return;\n");
                                                        parts.push("      const x0 = msg.x0|0, y0 = msg.y0|0;\n");
                                                        parts.push("      const w = msg.w|0, h = msg.h|0;\n");
                                                        parts.push("      const src = new Uint8Array(msg.buf);\n");
                                                        parts.push("      for (let dx=0; dx<w; dx++){\n");
                                                        parts.push("        const off = dx*h;\n");
                                                        parts.push("        const x = x0 + dx;\n");
                                                        parts.push("        if (x<0||x>=__worldW) continue;\n");
                                                        parts.push("        for (let dy=0; dy<h; dy++){\n");
                                                        parts.push("          const y = y0 + dy;\n");
                                                        parts.push("          if (y<0||y>=__worldH) continue;\n");
                                                        parts.push("          __light[x*__worldH + y] = src[off + dy] & 15;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'render'){\n");
                                                        parts.push("      if (!__renderEnabled || !__tiles) return;\n");
                                                        parts.push("      if (!__tileLUT) __buildColorLUT();\n");
                                                        parts.push("      if (!self.__tuRenderer) self.__tuRenderer = new __SimpleWorldRenderer();\n");
                                                        parts.push("      const r = self.__tuRenderer;\n");
                                                        parts.push("      const wCss = msg.wCss|0;\n");
                                                        parts.push("      const hCss = msg.hCss|0;\n");
                                                        parts.push("      const dpr = msg.dpr || 1;\n");
                                                        parts.push("      r.resize(wCss,hCss,dpr);\n");
                                                        parts.push("      const bmp = r.render(+msg.camX||0, +msg.camY||0, +msg.time||0);\n");
                                                        parts.push("      self.postMessage({ type: 'frame', id: msg.id|0, bitmap: bmp }, [bmp]);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("  } catch (err) {\n");
                                                        parts.push("    self.postMessage({ type: 'error', id: msg.id|0, message: String(err && err.message ? err.message : err), stack: err && err.stack ? String(err.stack) : '' });\n");
                                                        parts.push("  }\n");
                                                        parts.push("};\n");

                                                        WorldWorkerClient.__cachedWorkerParts = parts;
                                                        return parts;
                                                    }
                                                }

                                                TU._worldWorkerClient = TU._worldWorkerClient || new WorldWorkerClient();

                                                // 1) Patch WorldGenerator.generate -> delegate to worker (fallback to main thread on any failure).
                                                if (typeof WorldGenerator !== 'undefined' && WorldGenerator.prototype && typeof WorldGenerator.prototype.generate === 'function') {
                                                    const _origGenerate = WorldGenerator.prototype.generate;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerGenerateWrapped', null) : !WorldGenerator.prototype.__tu_workerGenerateWrapped) {
                                                        // [refactor] Removed obsolete alias: WorldGenerator.prototype._generateMainThread (keep local _origGenerate only).
                                                        WorldGenerator.prototype.generate = async function (progressCb) {
                                                            const client = TU._worldWorkerClient;

                                                            // If workers aren't supported, keep original behavior.
                                                            if (!SUPPORT_GEN_WORKER) {
                                                                return _origGenerate.call(this, progressCb);
                                                            }

                                                            try {
                                                                const world = await client.generate(this.w, this.h, this.seed, progressCb);

                                                                // Attach bridge to current game instance (boot script sets window.__GAME_INSTANCE__).
                                                                const g = window.__GAME_INSTANCE__;
                                                                if (g) {
                                                                    g._worldWorkerClient = client;
                                                                    if (g.renderer) g.renderer.__ww = client;
                                                                }

                                                                return world;
                                                            } catch (err) {
                                                                console.warn('[WorldWorker] generation failed; falling back to main thread.', err);
                                                                return _origGenerate.call(this, progressCb);
                                                            }
                                                        };
                                                    }
                                                }

                                                // 2) Patch Renderer.renderWorld: if worker has a ready bitmap, draw it; otherwise fallback.
                                                if (typeof Renderer !== 'undefined' && Renderer.prototype && typeof Renderer.prototype.renderWorld === 'function') {
                                                    const _origRW = Renderer.prototype.renderWorld;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerRenderWorldWrapped', null) : !Renderer.prototype.__tu_workerRenderWorldWrapped) {
                                                        Renderer.prototype.renderWorld = function (world, cam, time) {
                                                            const ww = this.__ww;
                                                            if (ww && ww.renderEnabled && ww.worldReady) {
                                                                ww.requestFrame(cam, time, this);
                                                                const bm = ww.consumeBitmap();
                                                                if (bm) {
                                                                    try {
                                                                        // Canvas context is in CSS units (scaled by DPR). Draw bitmap scaled to CSS size.
                                                                        this.ctx.drawImage(bm, 0, 0, this.w, this.h);
                                                                        return;
                                                                    } finally {
                                                                        if (bm.close) {
                                                                            try { bm.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                            return _origRW.call(this, world, cam, time);
                                                        };
                                                    }
                                                }

                                                // 3) Keep worker's world copy in sync with live gameplay edits (tiles).
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._writeTileFast === 'function') {
                                                    const _origWTF = Game.prototype._writeTileFast;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerWriteTileWrapped', null) : !Game.prototype.__tu_workerWriteTileWrapped) {
                                                        Game.prototype._writeTileFast = function (x, y, id, persist = true) {
                                                            const r = _origWTF.call(this, x, y, id, persist);
                                                            const ww = this._worldWorkerClient;
                                                            if (ww) ww.notifyTile(x, y, id);
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // 4) Keep worker's world copy in sync with save diffs applied on load (batch).
                                                if (typeof SaveSystem !== 'undefined' && SaveSystem.prototype && typeof SaveSystem.prototype.applyToWorld === 'function') {
                                                    const _origApply = SaveSystem.prototype.applyToWorld;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerApplyToWorldWrapped', null) : !SaveSystem.prototype.__tu_workerApplyToWorldWrapped) {
                                                        SaveSystem.prototype.applyToWorld = function (world, save) {
                                                            const r = _origApply.call(this, world, save);
                                                            try {
                                                                const g = this.game;
                                                                const ww = g && g._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && save && save._diffMap && save._diffMap.size) {
                                                                    ww.applyDiffMap(save._diffMap);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // 5) Sync light map (full once after init), and optionally region updates for dynamic changes.
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype.init === 'function') {
                                                    const _origInit = Game.prototype.init;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerInitWrapped', null) : !Game.prototype.__tu_workerInitWrapped) {
                                                        Game.prototype.init = async function (...args) {
                                                            window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                            if (!window.__TU_PERF__.initStart) window.__TU_PERF__.initStart = _safeNow();
                                                            const r = await _origInit.apply(this, args);
                                                            window.__TU_PERF__.initEnd = _safeNow();
                                                            window.__TU_PERF__.initMs = window.__TU_PERF__.initEnd - window.__TU_PERF__.initStart;

                                                            // After init completes, do a single full light sync so worker rendering matches loaded saves.
                                                            try {
                                                                const ww = this._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && this.world) {
                                                                    ww.syncLightFull(this.world);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            return r;
                                                        };
                                                    }
                                                }

                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._updateLight === 'function') {
                                                    const _origUL = Game.prototype._updateLight;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerUpdateLightWrapped', null) : !Game.prototype.__tu_workerUpdateLightWrapped) {
                                                        Game.prototype._updateLight = function (x, y) {
                                                            _origUL.call(this, x, y);
                                                            try {
                                                                const ww = this._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && this.world) {
                                                                    ww.syncLightRegion(this.world, x, y, 14);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }

                                                // PERF: record first frame timing (init -> first RAF)
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._startRaf === 'function') {
                                                    const _origStartRaf = Game.prototype._startRaf;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_perfStartRafWrapped', null) : !Game.prototype.__tu_perfStartRafWrapped) {

                                                        Game.prototype._startRaf = function () {
                                                            try {
                                                                window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                                if (!window.__TU_PERF__.rafStart) window.__TU_PERF__.rafStart = _safeNow();

                                                                if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_perfRafCbWrapped', null) : (!this.__tu_perfRafCbWrapped && this._rafCb)) {
                                                                    const _origCb = this._rafCb;

                                                                    this._rafCb = (t) => {
                                                                        const perf = (window.__TU_PERF__ = window.__TU_PERF__ || {});
                                                                        if (!perf.firstFrameAt) {
                                                                            perf.firstFrameAt = t;
                                                                            perf.firstFrameMs = _safeNow() - (perf.rafStart || _safeNow());
                                                                            if (perf.initStart) perf.firstFrameFromInitMs = _safeNow() - perf.initStart;
                                                                        }
                                                                        return _origCb(t);
                                                                    };
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            return _origStartRaf.call(this);
                                                        };
                                                    }
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();
                            </script>



                            <!-- ========================= PATCH: global error guards (stability) ========================= -->
                            <script>
                                (() => {
                                    // 防止 toast 无限刷屏
                                    let lastAt = 0;
                                    let lastMsg = '';
                                    const safeToast = (msg) => {
                                        const now = Date.now();
                                        const m = String(msg || '未知错误');
                                        if (m === lastMsg && (now - lastAt) < 1500) return;
                                        lastAt = now;
                                        lastMsg = m;
                                        try { if (typeof Toast !== 'undefined' && Toast && Toast.show) Toast.show(m, 2600); }
                                        catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                    };

                                    window.addEventListener('error', (ev) => {
                                        try {
                                            const msg = ev && ev.message ? ev.message : '运行时错误';
                                            safeToast('⚠️ ' + msg);
                                            // 打印更完整的堆栈，方便排查
                                            if (ev && ev.error) console.error(ev.error);
                                            else console.error(ev);
                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                    });

                                    window.addEventListener('unhandledrejection', (ev) => {
                                        try {
                                            const r = ev && ev.reason;
                                            const msg = (r && (r.message || r.toString())) || '未处理的异步错误';
                                            safeToast('⚠️ ' + msg);
                                            console.error(r || ev);
                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                    });
                                })();
                            </script>

                            <!-- ========================= PATCH: tu_perf_pack_v1 ========================= -->
                            <script>
                                (() => {
                                    'use strict';
                                    const TU = window.TU = window.TU || {};

                                    // ------------------------------------------------------------
                                    // Lightweight Profiler (default OFF)
                                    // ------------------------------------------------------------
                                    const Profiler = TU.Profiler = TU.Profiler || (function () {
                                        const P = {
                                            enabled: false,
                                            frame: 0,
                                            _lastUI: 0,
                                            _uiInterval: 250, // ms
                                            _now: (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now(),
                                            _m: Object.create(null),
                                            _c: Object.create(null),
                                            _extra: Object.create(null),
                                            ui: null,

                                            beginFrame() {
                                                this.frame = (this.frame + 1) | 0;
                                                this._m.renderWorld = 0;
                                                this._m.updateLight = 0;
                                                this._m.workerApply = 0;
                                                this._c.renderWorld = 0;
                                                this._c.updateLight = 0;
                                                this._c.workerApply = 0;
                                                this._extra.workerChanges = 0;
                                            },

                                            add(name, dt, countInc = 1, extraKey = null, extraVal = 0) {
                                                if (!this.enabled) return;
                                                this._m[name] = (this._m[name] || 0) + dt;
                                                this._c[name] = (this._c[name] || 0) + countInc;
                                                if (extraKey) this._extra[extraKey] = (this._extra[extraKey] || 0) + extraVal;
                                            },

                                            ensureUI() {
                                                if (this.ui) return this.ui;
                                                const div = document.createElement('div');
                                                div.id = 'tu-profiler';
                                                div.style.cssText = [
                                                    'position:fixed',
                                                    'left:8px',
                                                    'top:8px',
                                                    'z-index:9999',
                                                    'padding:6px 8px',
                                                    'background:rgba(0,0,0,0.55)',
                                                    'color:#e8f0ff',
                                                    'font:12px/1.25 ui-monospace,Menlo,Consolas,monospace',
                                                    'border:1px solid rgba(255,255,255,0.18)',
                                                    'border-radius:6px',
                                                    'pointer-events:none',
                                                    'white-space:pre',
                                                    'image-rendering:pixelated'
                                                ].join(';');
                                                div.textContent = 'Profiler ON';
                                                document.body.appendChild(div);
                                                this.ui = div;
                                                return div;
                                            },

                                            setEnabled(v) {
                                                this.enabled = !!v;
                                                try {
                                                    if (this.enabled) this.ensureUI().style.display = 'block';
                                                    else if (this.ui) this.ui.style.display = 'none';
                                                    try { localStorage.setItem('tu_profiler_enabled', this.enabled ? '1' : '0'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            },

                                            toggle() { this.setEnabled(!this.enabled); },

                                            updateUI(game) {
                                                if (!this.enabled) return;
                                                const now = this._now();
                                                if (now - this._lastUI < this._uiInterval) return;
                                                this._lastUI = now;

                                                const fps = game && game.fps ? game.fps : 0;
                                                const rw = this._m.renderWorld || 0;
                                                const ul = this._m.updateLight || 0;
                                                const wa = this._m.workerApply || 0;

                                                const c_rw = this._c.renderWorld || 0;
                                                const c_ul = this._c.updateLight || 0;
                                                const c_wa = this._c.workerApply || 0;

                                                const ch = this._extra.workerChanges || 0;

                                                const text =
                                                    'TU Profiler (toggle: F3)\n' +
                                                    'FPS: ' + fps.toFixed(1) + '\n' +
                                                    'renderWorld: ' + rw.toFixed(2) + 'ms (' + c_rw + ')\n' +
                                                    'updateLight: ' + ul.toFixed(2) + 'ms (' + c_ul + ')\n' +
                                                    'workerApply: ' + wa.toFixed(2) + 'ms (' + c_wa + ') chg:' + ch + '\n';

                                                this.ensureUI().textContent = text;
                                            }
                                        };

                                        try { P.enabled = (localStorage.getItem('tu_profiler_enabled') === '1'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                        return P;
                                    })();

                                    // Key toggle (F3)
                                    try {
                                        window.addEventListener('keydown', (e) => {
                                            if (e.key === 'F3') {
                                                e.preventDefault();
                                                Profiler.toggle();
                                            }
                                        }, { passive: false });
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ------------------------------------------------------------
                                    // World buffers: tiles/light/walls -> flat TypedArray + subarray views
                                    // ------------------------------------------------------------
                                    function flatifyColumns(cols, w, h, ctor) {
                                        if (!cols || !cols.length || !w || !h) return null;
                                        if (cols.__tu_flat && cols.__tu_flat.buf) return cols.__tu_flat;

                                        const flat = new ctor(w * h);
                                        for (let x = 0; x < w; x++) flat.set(cols[x], x * h);

                                        const views = new Array(w);
                                        for (let x = 0; x < w; x++) views[x] = flat.subarray(x * h, (x + 1) * h);

                                        views.__tu_flat = { buf: flat, views, w, h };
                                        return { buf: flat, views, w, h };
                                    }

                                    TU.flatifyWorld = TU.flatifyWorld || function (world) {
                                        try {
                                            if (!world || !world.w || !world.h) return false;
                                            if (world.__tu_flatified) return true;
                                            const w = world.w | 0, h = world.h | 0;

                                            if (world.tiles && Array.isArray(world.tiles) && world.tiles.length === w) {
                                                const t = flatifyColumns(world.tiles, w, h, Uint8Array);
                                                if (t) { world.tilesFlat = t.buf; world.tiles = t.views; }
                                            }
                                            if (world.light && Array.isArray(world.light) && world.light.length === w) {
                                                const l = flatifyColumns(world.light, w, h, Uint8Array);
                                                if (l) { world.lightFlat = l.buf; world.light = l.views; }
                                            }
                                            if (world.walls && Array.isArray(world.walls) && world.walls.length === w) {
                                                const wa = flatifyColumns(world.walls, w, h, Uint8Array);
                                                if (wa) { world.wallsFlat = wa.buf; world.walls = wa.views; }
                                            }

                                            world.__tu_flatified = true;
                                            return true;
                                        } catch (e) {
                                            try { console.warn('[tu_perf_pack] flatifyWorld failed', e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            return false;
                                        }
                                    };

                                    // Wrap WorldGenerator.generate to flatify at world creation
                                    try {
                                        if (typeof WorldGenerator !== 'undefined' && WorldGenerator && WorldGenerator.prototype && typeof WorldGenerator.prototype.generate === 'function') {
                                            const _origGen = WorldGenerator.prototype.generate;
                                            if (!WorldGenerator.prototype.__tu_perfPackGenWrapped) {
                                                WorldGenerator.prototype.__tu_perfPackGenWrapped = true;
                                                WorldGenerator.prototype.generate = async function (progress) {
                                                    const data = await _origGen.call(this, progress);
                                                    try { TU.flatifyWorld(data); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return data;
                                                };
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ------------------------------------------------------------
                                    // Renderer: reduce per-tile Canvas API cost (glow + dark mask)
                                    // ------------------------------------------------------------
                                    function ensureTexArray(renderer) {
                                        try {
                                            const map = renderer && renderer.textures;
                                            if (!map || typeof map.get !== 'function') return null;
                                            if (renderer.__tu_texArr && renderer.__tu_texArrMap === map) return renderer.__tu_texArr;

                                            const arr = renderer.__tu_texArr || (renderer.__tu_texArr = new Array(256));
                                            for (let i = 0; i < 256; i++) arr[i] = null;
                                            try { map.forEach((v, k) => { arr[k & 255] = v; }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            renderer.__tu_texArrMap = map;
                                            return arr;
                                        } catch (_) { return null; }
                                    }

                                    function getBucketState(renderer) {
                                        let st = renderer.__tu_tileBuckets;
                                        if (st) return st;
                                        st = renderer.__tu_tileBuckets = {
                                            glowKeys: [],
                                            glowLists: new Array(256),
                                            darkKeys: [],
                                            darkLists: new Array(256),
                                            reset() {
                                                for (let i = 0; i < this.glowKeys.length; i++) this.glowLists[this.glowKeys[i]].length = 0;
                                                for (let i = 0; i < this.darkKeys.length; i++) this.darkLists[this.darkKeys[i]].length = 0;
                                                this.glowKeys.length = 0;
                                                this.darkKeys.length = 0;
                                            }
                                        };
                                        for (let i = 0; i < 256; i++) { st.glowLists[i] = []; st.darkLists[i] = []; }
                                        return st;
                                    }

                                    function packPos(px, py) { return ((px & 0xffff) << 16) | (py & 0xffff); }
                                    function unpackX(p) { return (p >> 16) & 0xffff; }
                                    function unpackY(p) { return p & 0xffff; }

                                    try {
                                        if (typeof Renderer !== 'undefined' && Renderer && Renderer.prototype && typeof Renderer.prototype.renderWorld === 'function') {
                                            const _baseRenderWorld = Renderer.prototype.renderWorld;
                                            if (!Renderer.prototype.__tu_perfPackRenderWrapped) {
                                                Renderer.prototype.__tu_perfPackRenderWrapped = true;

                                                Renderer.prototype.renderWorld = function (world, cam, time) {
                                                    if (this.__tu_disablePerfPackRender) return _baseRenderWorld.call(this, world, cam, time);
                                                    const doProf = Profiler.enabled;
                                                    const t0 = doProf ? (performance.now ? performance.now() : Date.now()) : 0;

                                                    try {
                                                        if (!world || !world.tiles || !world.light || !this.textures || !window.BLOCK_LIGHT || !window.CONFIG) {
                                                            return _baseRenderWorld.call(this, world, cam, time);
                                                        }
                                                        if (this.__disableChunkBatching) return _baseRenderWorld.call(this, world, cam, time);

                                                        const ctx = this.ctx;
                                                        const ts = CONFIG.TILE_SIZE;

                                                        let startX = ((cam.x / ts) | 0) - 1;
                                                        let startY = ((cam.y / ts) | 0) - 1;
                                                        let endX = startX + ((this.w / ts) | 0) + 3;
                                                        let endY = startY + ((this.h / ts) | 0) + 3;

                                                        if (startX < 0) startX = 0;
                                                        if (startY < 0) startY = 0;
                                                        if (endX >= world.w) endX = world.w - 1;
                                                        if (endY >= world.h) endY = world.h - 1;

                                                        const camCeilX = Math.ceil(cam.x);
                                                        const camCeilY = Math.ceil(cam.y);

                                                        const lut = window.BLOCK_LIGHT_LUT;
                                                        if (!lut || lut.length < 16) return _baseRenderWorld.call(this, world, cam, time);

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.globalAlpha = 1;
                                                        ctx.shadowBlur = 0;

                                                        // Draw chunks using existing cache
                                                        const cfg = this.__cb2_cfg || { tiles: 16 };
                                                        const cts = (cfg.tiles | 0) || 16;

                                                        const cx0 = (startX / cts) | 0;
                                                        const cy0 = (startY / cts) | 0;
                                                        const cx1 = (endX / cts) | 0;
                                                        const cy1 = (endY / cts) | 0;

                                                        for (let cx = cx0; cx <= cx1; cx++) {
                                                            for (let cy = cy0; cy <= cy1; cy++) {
                                                                const entry = this.__cb2_getEntry ? this.__cb2_getEntry(world, cx, cy) : null;
                                                                if (!entry || !entry.canvas) continue;
                                                                ctx.drawImage(entry.canvas, cx * cts * ts - camCeilX, cy * cts * ts - camCeilY);
                                                            }
                                                        }

                                                        // Bucket tiles
                                                        const tilesCols = world.tiles;
                                                        const lightCols = world.light;
                                                        const tilesFlat = world.tilesFlat;
                                                        const lightFlat = world.lightFlat;

                                                        const BL = window.BLOCK_LIGHT;
                                                        const BC = window.BLOCK_COLOR || null;
                                                        const AIR = (window.BLOCK && window.BLOCK.AIR !== undefined) ? window.BLOCK.AIR : 0;

                                                        const bucket = getBucketState(this);
                                                        bucket.reset();

                                                        const texArr = ensureTexArray(this);
                                                        const H = world.h | 0;

                                                        if (tilesFlat && lightFlat && tilesFlat.length === (world.w * world.h)) {
                                                            for (let x = startX; x <= endX; x++) {
                                                                const base = x * H;
                                                                for (let y = startY; y <= endY; y++) {
                                                                    const idx = base + y;
                                                                    const block = tilesFlat[idx] | 0;
                                                                    if (block === AIR) continue;

                                                                    const px = x * ts - camCeilX;
                                                                    const py = y * ts - camCeilY;

                                                                    const bl = BL[block] | 0;
                                                                    if (bl > 5) {
                                                                        const list = bucket.glowLists[block];
                                                                        if (list.length === 0) bucket.glowKeys.push(block);
                                                                        list.push(packPos(px, py));
                                                                    }

                                                                    const lv = lightFlat[idx] & 255;
                                                                    const a = lut[lv];
                                                                    if (a) {
                                                                        const dl = bucket.darkLists[lv];
                                                                        if (dl.length === 0) bucket.darkKeys.push(lv);
                                                                        dl.push(packPos(px, py));
                                                                    }
                                                                }
                                                            }
                                                        } else {
                                                            for (let x = startX; x <= endX; x++) {
                                                                const colT = tilesCols[x];
                                                                const colL = lightCols[x];
                                                                for (let y = startY; y <= endY; y++) {
                                                                    const block = colT[y] | 0;
                                                                    if (block === AIR) continue;

                                                                    const px = x * ts - camCeilX;
                                                                    const py = y * ts - camCeilY;

                                                                    const bl = BL[block] | 0;
                                                                    if (bl > 5) {
                                                                        const list = bucket.glowLists[block];
                                                                        if (list.length === 0) bucket.glowKeys.push(block);
                                                                        list.push(packPos(px, py));
                                                                    }

                                                                    const lv = colL[y] & 255;
                                                                    const a = lut[lv];
                                                                    if (a) {
                                                                        const dl = bucket.darkLists[lv];
                                                                        if (dl.length === 0) bucket.darkKeys.push(lv);
                                                                        dl.push(packPos(px, py));
                                                                    }
                                                                }
                                                            }
                                                        }

                                                        // Draw glow tiles grouped by block
                                                        if (bucket.glowKeys.length) {
                                                            const enableGlow = !!this.enableGlow;
                                                            for (let ki = 0; ki < bucket.glowKeys.length; ki++) {
                                                                const blockId = bucket.glowKeys[ki] | 0;
                                                                const list = bucket.glowLists[blockId];
                                                                if (!list || !list.length) continue;

                                                                const tex = texArr ? texArr[blockId] : this.textures.get(blockId);
                                                                if (!tex) continue;

                                                                const bl = BL[blockId] | 0;

                                                                if (enableGlow) {
                                                                    ctx.shadowColor = (BC && BC[blockId]) ? BC[blockId] : '#fff';
                                                                    ctx.shadowBlur = bl * 2;
                                                                } else {
                                                                    ctx.shadowBlur = 0;
                                                                }

                                                                for (let i = 0; i < list.length; i++) {
                                                                    const p = list[i] | 0;
                                                                    ctx.drawImage(tex, unpackX(p), unpackY(p));
                                                                }
                                                            }
                                                            ctx.shadowBlur = 0;
                                                        }

                                                        // Draw dark mask grouped by light value (one fill per bucket)
                                                        if (bucket.darkKeys.length) {
                                                            ctx.fillStyle = '#000';
                                                            bucket.darkKeys.sort((a, b) => a - b);
                                                            for (let ki = 0; ki < bucket.darkKeys.length; ki++) {
                                                                const lv = bucket.darkKeys[ki] & 255;
                                                                const a = lut[lv];
                                                                if (!a) continue;
                                                                const list = bucket.darkLists[lv];
                                                                if (!list || !list.length) continue;

                                                                ctx.globalAlpha = a;
                                                                ctx.beginPath();
                                                                for (let i = 0; i < list.length; i++) {
                                                                    const p = list[i] | 0;
                                                                    ctx.rect(unpackX(p), unpackY(p), ts, ts);
                                                                }
                                                                ctx.fill();
                                                            }
                                                            ctx.globalAlpha = 1;
                                                        }

                                                    } catch (e) {
                                                        this.__tu_disablePerfPackRender = true;
                                                        try { console.warn('[tu_perf_pack] renderWorld patch disabled:', e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        return _baseRenderWorld.call(this, world, cam, time);
                                                    } finally {
                                                        if (doProf) {
                                                            const t1 = (performance.now ? performance.now() : Date.now());
                                                            Profiler.add('renderWorld', t1 - t0, 1);
                                                        }
                                                    }
                                                };
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ------------------------------------------------------------
                                    // TileLogicEngine worker: diff buffer reuse + recycle
                                    // ------------------------------------------------------------
                                    function patchWorkerSource() {
                                        try {
                                            if (typeof TileLogicEngine === 'undefined' || !TileLogicEngine) return false;
                                            if (TileLogicEngine.__tu_perfPackWorkerSource) return true;

                                            const orig = TileLogicEngine._workerSource;
                                            if (typeof orig !== 'function') return false;

                                            const inject = `

  // __TU_OUT_POOL__: preallocated out buffers (recycled by main thread)
  const __TU_OUT_POOL__ = [];
  let __tuOutView = null;
  let __tuOutLen = 0;

  function __tuAllocOut(minInts) {
    minInts = (minInts|0) || 1024;
    for (let i = __TU_OUT_POOL__.length - 1; i >= 0; i--) {
      const buf = __TU_OUT_POOL__[i];
      if (buf && buf.byteLength >= (minInts << 2)) {
        __TU_OUT_POOL__.splice(i, 1);
        return buf;
      }
    }
    return new ArrayBuffer(minInts << 2);
  }

  function __tuEnsureOut(extraInts) {
    if (!__tuOutView) {
      __tuOutView = new Int32Array(__tuAllocOut(2048));
      __tuOutLen = 0;
      return;
    }
    if ((__tuOutLen + extraInts) <= __tuOutView.length) return;

    // grow: allocate bigger, copy, recycle old
    const need = (__tuOutLen + extraInts) | 0;
    let next = __tuOutView.length << 1;
    while (next < need) next = next << 1;
    const nb = __tuAllocOut(next);
    const nv = new Int32Array(nb);
    nv.set(__tuOutView.subarray(0, __tuOutLen));
    try { __TU_OUT_POOL__.push(__tuOutView.buffer); } catch(_) { /* silently ignore */ }
    __tuOutView = nv;
  }

  const __tuChanges = {
    length: 0,
    reset() {
      __tuEnsureOut(0);
      __tuOutLen = 0;
      this.length = 0;
    },
    push(i, oldId, newId) {
      __tuEnsureOut(3);
      __tuOutView[__tuOutLen++] = i|0;
      __tuOutView[__tuOutLen++] = oldId|0;
      __tuOutView[__tuOutLen++] = newId|0;
      this.length = __tuOutLen;
    }
  };
`;

                                            TileLogicEngine._workerSource = function () {
                                                let s = orig.call(TileLogicEngine);
                                                if (!s || s.indexOf("const changes = [];") === -1 || s.indexOf("postMessage({ type: 'changes'") === -1) return s;
                                                if (s.indexOf('__TU_OUT_POOL__') !== -1) return s;

                                                const injectKey = "let AIR = 0, WATER = 27;";
                                                if (s.indexOf(injectKey) === -1) return s;

                                                s = s.replace(injectKey, injectKey + inject);

                                                s = s.replace(/function step\(\)\s*\{\s*\n\s*const changes = \[\];/m,
                                                    "function step() {\n    __tuChanges.reset();\n    const changes = __tuChanges;"
                                                );

                                                s = s.replace(/if\s*\(changes\.length\)\s*\{\s*\n\s*const buf = new Int32Array\(changes\);\s*\n\s*postMessage\(\{ type: 'changes', buf: buf\.buffer \}, \[buf\.buffer\]\);\s*\n\s*\}/m,
                                                    "if (changes.length) {\n      const len = changes.length|0;\n      const buf = __tuOutView.buffer;\n      postMessage({ type: 'changes', buf: buf, len: len }, [buf]);\n      __tuOutView = null;\n      __tuOutLen = 0;\n      __tuChanges.length = 0;\n    }"
                                                );

                                                s = s.replace(/switch\s*\(m\.type\)\s*\{\s*/m,
                                                    (m) => m + "\n      case 'recycle': {\n        if (m.buf) {\n          try { __TU_OUT_POOL__.push(m.buf); } catch(_) { /* silently ignore */ }\n        }\n        break;\n      }\n"
                                                );

                                                return s;
                                            };

                                            TileLogicEngine.__tu_perfPackWorkerSource = true;
                                            return true;
                                        } catch (e) {
                                            try { console.warn('[tu_perf_pack] patchWorkerSource failed', e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            return false;
                                        }
                                    }

                                    patchWorkerSource();

                                    try {
                                        if (typeof TileLogicEngine !== 'undefined' && TileLogicEngine && TileLogicEngine.prototype) {

                                            if (typeof TileLogicEngine.prototype._flattenTiles === 'function' && !TileLogicEngine.prototype.__tu_perfPackFlattenWrapped) {
                                                TileLogicEngine.prototype.__tu_perfPackFlattenWrapped = true;
                                                const _origFlat = TileLogicEngine.prototype._flattenTiles;
                                                TileLogicEngine.prototype._flattenTiles = function () {
                                                    try {
                                                        const w = this.world;
                                                        if (w && w.tilesFlat && w.tilesFlat.length === (this.w * this.h)) {
                                                            return new Uint8Array(w.tilesFlat);
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return _origFlat.call(this);
                                                };
                                            }

                                            if (typeof TileLogicEngine.prototype._initWorker === 'function' && !TileLogicEngine.prototype.__tu_perfPackInitWrapped) {
                                                TileLogicEngine.prototype.__tu_perfPackInitWrapped = true;
                                                const _origInit = TileLogicEngine.prototype._initWorker;
                                                TileLogicEngine.prototype._initWorker = function () {
                                                    _origInit.call(this);

                                                    try {
                                                        if (!this.worker || this.__tu_perfPackOnMsgWrapped) return;
                                                        this.__tu_perfPackOnMsgWrapped = true;

                                                        const self = this;
                                                        const w = this.worker;

                                                        const pendingPool = [];
                                                        function allocPending(arr) {
                                                            const o = pendingPool.pop() || { arr: null, pos: 0 };
                                                            o.arr = arr; o.pos = 0;
                                                            return o;
                                                        }
                                                        function freePending(o) {
                                                            o.arr = null; o.pos = 0;
                                                            pendingPool.push(o);
                                                        }
                                                        self.__tu_pendingPool = { allocPending, freePending };

                                                        w.onmessage = (e) => {
                                                            const msg = e.data;
                                                            if (!msg || !msg.type) return;
                                                            if (msg.type === 'changes' && msg.buf) {
                                                                try {
                                                                    const len = (msg.len | 0) > 0 ? (msg.len | 0) : 0;
                                                                    const arr = len ? new Int32Array(msg.buf, 0, len) : new Int32Array(msg.buf);
                                                                    self.pending.push(allocPending(arr));
                                                                    self._scheduleApply();
                                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                        };
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                };
                                            }

                                            if (typeof TileLogicEngine.prototype._applyPending === 'function' && !TileLogicEngine.prototype.__tu_perfPackApplyWrapped) {
                                                TileLogicEngine.prototype.__tu_perfPackApplyWrapped = true;
                                                const _origApply = TileLogicEngine.prototype._applyPending;

                                                function pendingRemaining(pending) {
                                                    let rem = 0;
                                                    for (let i = 0; i < pending.length; i++) {
                                                        const it = pending[i];
                                                        if (!it || !it.arr) continue;
                                                        rem += (it.arr.length - (it.pos | 0));
                                                    }
                                                    return rem;
                                                }

                                                TileLogicEngine.prototype._applyPending = function (deadline) {
                                                    const doProf = Profiler.enabled;
                                                    const before = doProf ? pendingRemaining(this.pending) : 0;
                                                    const t0 = doProf ? (performance.now ? performance.now() : Date.now()) : 0;

                                                    _origApply.call(this, deadline);

                                                    try {
                                                        while (this.pending.length && this.pending[0] && this.pending[0].arr && (this.pending[0].pos >= this.pending[0].arr.length)) {
                                                            const done = this.pending.shift();
                                                            const buf = done && done.arr && done.arr.buffer;
                                                            if (buf && this.worker && typeof this.worker.postMessage === 'function') {
                                                                try { this.worker.postMessage({ type: 'recycle', buf: buf }, [buf]); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            try {
                                                                const pool = this.__tu_pendingPool;
                                                                if (pool && pool.freePending) pool.freePending(done);
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    if (doProf) {
                                                        const t1 = (performance.now ? performance.now() : Date.now());
                                                        const after = pendingRemaining(this.pending);
                                                        const processedElems = (before - after) | 0;
                                                        const changes = processedElems > 0 ? ((processedElems / 3) | 0) : 0;
                                                        Profiler.add('workerApply', t1 - t0, 1, 'workerChanges', changes);
                                                    }
                                                };
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ------------------------------------------------------------
                                    // Profile hooks: Game.loop + Game._updateLight
                                    // ------------------------------------------------------------
                                    try {
                                        if (typeof Game !== 'undefined' && Game && Game.prototype) {
                                            if (typeof Game.prototype.loop === 'function' && !Game.prototype.__tu_profLoopWrapped) {
                                                Game.prototype.__tu_profLoopWrapped = true;
                                                const _origLoop = Game.prototype.loop;
                                                Game.prototype.loop = function (timestamp) {
                                                    if (Profiler.enabled) Profiler.beginFrame();
                                                    const r = _origLoop.call(this, timestamp);
                                                    if (Profiler.enabled) Profiler.updateUI(this);
                                                    return r;
                                                };
                                            }

                                            if (typeof Game.prototype._updateLight === 'function' && !Game.prototype.__tu_profUpdateLightWrapped) {
                                                Game.prototype.__tu_profUpdateLightWrapped = true;
                                                const _origUL = Game.prototype._updateLight;
                                                Game.prototype._updateLight = function (x, y) {
                                                    if (!Profiler.enabled) return _origUL.call(this, x, y);
                                                    const t0 = performance.now ? performance.now() : Date.now();
                                                    try { return _origUL.call(this, x, y); }
                                                    finally {
                                                        const t1 = performance.now ? performance.now() : Date.now();
                                                        Profiler.add('updateLight', t1 - t0, 1);
                                                    }
                                                };
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                })();
                            </script>

                            <!-- ========================= PATCH: glow_bake_alpha_mask_tilelogic_pack ========================= -->
                            <script>
                                (() => {
                                    'use strict';

                                    // ─────────────────────────────────────────────────────────────
                                    // 1) Chunk glow bake: bake glow layer into chunk glowCanvas (with padding)
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Renderer !== 'undefined' && Renderer && Renderer.prototype && Renderer.prototype.__cb2_getEntry) {
                                            const GLOW_PAD = 32; // chunk-level padding to avoid blur clipping on chunk borders

                                            // Wrap/replace rebuildChunk to draw BOTH base + glow layers into chunk-local canvases.
                                            const _origRebuild = Renderer.prototype.__cb2_rebuildChunk;
                                            Renderer.prototype.__cb2_rebuildChunk = function (entry, world) {
                                                try {
                                                    const cfg = this.__cb2_cfg || { tiles: 16 };
                                                    const cts = (cfg.tiles | 0) || 16;
                                                    const ts = (CONFIG && CONFIG.TILE_SIZE) ? (CONFIG.TILE_SIZE | 0) : 16;

                                                    const pxW = cts * ts;
                                                    const pad = GLOW_PAD | 0;
                                                    const glowW = pxW + pad * 2;

                                                    // Ensure base canvas
                                                    if (!entry.canvas) {
                                                        entry.canvas = document.createElement('canvas');
                                                        entry.ctx = entry.canvas.getContext('2d', { alpha: true });
                                                        entry.ctx.imageSmoothingEnabled = false;
                                                    }
                                                    if (entry.canvas.width !== pxW || entry.canvas.height !== pxW) {
                                                        entry.canvas.width = entry.canvas.height = pxW;
                                                    }
                                                    const ctx = entry.ctx;

                                                    // Ensure glow canvas
                                                    if (!entry.glowCanvas) {
                                                        entry.glowCanvas = document.createElement('canvas');
                                                        entry.glowCtx = entry.glowCanvas.getContext('2d', { alpha: true });
                                                        entry.glowCtx.imageSmoothingEnabled = false;
                                                        entry.glowPad = pad;
                                                        entry.hasGlow = false;
                                                    }
                                                    if (entry.glowCanvas.width !== glowW || entry.glowCanvas.height !== glowW) {
                                                        entry.glowCanvas.width = entry.glowCanvas.height = glowW;
                                                    }
                                                    const gctx = entry.glowCtx;
                                                    entry.glowPad = pad;
                                                    entry.hasGlow = false;

                                                    // Clear
                                                    ctx.clearRect(0, 0, pxW, pxW);
                                                    gctx.clearRect(0, 0, glowW, glowW);

                                                    const tilesCols = world && world.tiles;
                                                    const tilesFlat = world && world.tilesFlat;
                                                    const H = world ? (world.h | 0) : 0;

                                                    const texGen = this.textures;
                                                    const BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : null;

                                                    const cx0 = (entry.cx | 0) * cts;
                                                    const cy0 = (entry.cy | 0) * cts;

                                                    for (let lx = 0; lx < cts; lx++) {
                                                        const wx = cx0 + lx;
                                                        if (wx < 0 || wx >= world.w) continue;

                                                        let col = null;
                                                        let baseIdx = 0;
                                                        if (tilesFlat && H) {
                                                            baseIdx = (wx * H) | 0;
                                                        } else if (tilesCols) {
                                                            col = tilesCols[wx];
                                                        }

                                                        for (let ly = 0; ly < cts; ly++) {
                                                            const wy = cy0 + ly;
                                                            if (wy < 0 || wy >= world.h) continue;

                                                            const id = (tilesFlat && H) ? (tilesFlat[baseIdx + wy] | 0) : (col ? (col[wy] | 0) : 0);
                                                            if (id === 0) continue;

                                                            // Base tile & glow bake
                                                            const tex = texGen && texGen.get ? texGen.get(id) : null;
                                                            const bl = BL ? (BL[id] | 0) : 0;

                                                            if (bl > 5) {
                                                                // Glow tiles: draw into glowCanvas (includes tile content when using getGlow fallback),
                                                                // base canvas intentionally skips to avoid double-draw.
                                                                const gtex = (texGen && texGen.getGlow) ? texGen.getGlow(id) : null;
                                                                if (gtex) {
                                                                    const gp = gtex.__pad | 0;
                                                                    gctx.drawImage(gtex, lx * ts + pad - gp, ly * ts + pad - gp);
                                                                    entry.hasGlow = true;
                                                                } else if (tex) {
                                                                    // Fallback: shadowBlur bake directly into glowCanvas
                                                                    try {
                                                                        gctx.save();
                                                                        gctx.shadowColor = (typeof BLOCK_COLOR !== 'undefined' && BLOCK_COLOR[id]) ? BLOCK_COLOR[id] : '#ffffff';
                                                                        gctx.shadowBlur = bl * 2;
                                                                        gctx.drawImage(tex, lx * ts + pad, ly * ts + pad);
                                                                        gctx.restore();
                                                                        entry.hasGlow = true;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            } else {
                                                                if (tex) ctx.drawImage(tex, lx * ts, ly * ts);
                                                            }

                                                        }
                                                    }

                                                    entry.dirty = false;
                                                    return;
                                                } catch (e) {
                                                    // Fallback to previous rebuild if anything goes wrong.
                                                    try { if (_origRebuild) return _origRebuild.call(this, entry, world); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    entry.dirty = false;
                                                }
                                            };

                                            // Ensure existing cached entries get glow canvases after patch
                                            try {
                                                const oldGet = Renderer.prototype.__cb2_getEntry;
                                                Renderer.prototype.__cb2_getEntry = function (world, cx, cy) {
                                                    const e = oldGet.call(this, world, cx, cy);
                                                    if (e && !e.glowCanvas) {
                                                        e.dirty = true; // force rebuild with new glow bake path
                                                        try { this.__cb2_rebuildChunk(e, world); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                    return e;
                                                };
                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 2) Vignette/darkness: tile-resolution alpha-map (offscreen ImageData), single draw
                                    //    + draw glowCanvas per chunk (no per-tile glow loops)
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Renderer !== 'undefined' && Renderer && Renderer.prototype && typeof Renderer.prototype.renderWorld === 'function') {
                                            const _prevRW = Renderer.prototype.renderWorld;

                                            function parseRgb(str) {
                                                // supports 'rgb(r,g,b)' or 'rgba(r,g,b,a)' or '#rrggbb'
                                                if (!str) return { r: 10, g: 5, b: 20 };
                                                const s = String(str).trim();
                                                let m = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*/i);
                                                if (m) return { r: (m[1] | 0), g: (m[2] | 0), b: (m[3] | 0) };
                                                m = s.match(/^#([0-9a-f]{6})$/i);
                                                if (m) {
                                                    const n = parseInt(m[1], 16);
                                                    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
                                                }
                                                return { r: 10, g: 5, b: 20 };
                                            }

                                            // dark LUT builder (same as original renderWorld)
                                            function buildDarkLUT(levels, nightBonus) {
                                                const lut = new Float32Array(256);
                                                for (let i = 0; i < 256; i++) {
                                                    const darkness = 1 - (i / levels);
                                                    let totalDark = darkness * 0.6 + nightBonus;
                                                    if (totalDark > 0.88) totalDark = 0.88;
                                                    lut[i] = (totalDark > 0.05) ? totalDark : 0;
                                                }
                                                return lut;
                                            }

                                            Renderer.prototype.renderWorld = function (world, cam, time) {
                                                // Preserve worker-rendered fast path (if present)
                                                try {
                                                    const ww = this.__ww;
                                                    if (ww && ww.renderEnabled && ww.worldReady) {
                                                        ww.requestFrame(cam, time, this);
                                                        const bm = ww.consumeBitmap();
                                                        if (bm) {
                                                            try { this.ctx.drawImage(bm, 0, 0, this.w, this.h); return; }
                                                            finally { try { bm.close && bm.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } }
                                                        }
                                                    }
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // Preconditions for our path
                                                if (!world || !cam || !this.__cb2_getEntry || !this.__cb2_cfg || !this.ctx) {
                                                    return _prevRW.call(this, world, cam, time);
                                                }
                                                const ts = (CONFIG && CONFIG.TILE_SIZE) ? (CONFIG.TILE_SIZE | 0) : 16;
                                                const ctx = this.ctx;

                                                // Visible tile range (clamped once)
                                                let startX = (cam.x / ts) | 0; startX -= 1;
                                                let startY = (cam.y / ts) | 0; startY -= 1;
                                                let endX = startX + ((this.w / ts) | 0) + 3;
                                                let endY = startY + ((this.h / ts) | 0) + 3;

                                                if (startX < 0) startX = 0;
                                                if (startY < 0) startY = 0;
                                                if (endX >= world.w) endX = world.w - 1;
                                                if (endY >= world.h) endY = world.h - 1;

                                                const camCeilX = Math.ceil(cam.x);
                                                const camCeilY = Math.ceil(cam.y);

                                                // ───────── LUT (day/night + weather gloom/flash) ─────────
                                                const Utils = window.Utils || (window.TU && window.TU.Utils);
                                                const night = Utils && Utils.nightFactor ? Utils.nightFactor(time) : 0;
                                                const qNight = Math.round(night * 100) / 100;
                                                const levels = (CONFIG && CONFIG.LIGHT_LEVELS) ? (CONFIG.LIGHT_LEVELS | 0) : 16;

                                                const wf = window.TU_WEATHER_FX || null;
                                                let wType = (wf && wf.type) ? wf.type : 'clear';
                                                let wGloom = (wf && typeof wf.gloom === 'number') ? wf.gloom : 0;
                                                let wFlash = (wf && typeof wf.lightning === 'number') ? wf.lightning : 0;
                                                if (wGloom < 0) wGloom = 0;
                                                if (wGloom > 1) wGloom = 1;
                                                if (wFlash < 0) wFlash = 0;
                                                if (wFlash > 1) wFlash = 1;
                                                const wKey = wType + ':' + ((wGloom * 100) | 0) + ':' + ((wFlash * 100) | 0) + ':' + qNight + ':' + levels;

                                                if (!this._darkAlphaLUTDay || this._darkAlphaLUTLevels !== levels) {
                                                    this._darkAlphaLUTLevels = levels;
                                                    this._darkAlphaLUTDay = buildDarkLUT(levels, 0);
                                                    this._darkAlphaLUTNight = buildDarkLUT(levels, 0.2);
                                                }
                                                let lut = this._darkAlphaLUTBlend;
                                                if (!lut || this._darkAlphaLUTBlendWeatherKey !== wKey || this._darkAlphaLUTBlendNight !== qNight || this._darkAlphaLUTBlendLevels !== levels) {
                                                    lut = this._darkAlphaLUTBlend || (this._darkAlphaLUTBlend = new Float32Array(256));
                                                    const dayL = this._darkAlphaLUTDay;
                                                    const nightL = this._darkAlphaLUTNight;
                                                    const lv = levels || 1;
                                                    const gloom = wGloom;
                                                    const flash = wFlash;
                                                    let th = 0.05 - gloom * 0.02;
                                                    if (th < 0.02) th = 0.02;

                                                    for (let i = 0; i < 256; i++) {
                                                        let v = dayL[i] + (nightL[i] - dayL[i]) * qNight;

                                                        if (gloom > 0.001) {
                                                            let light01 = i / lv;
                                                            if (light01 < 0) light01 = 0;
                                                            if (light01 > 1) light01 = 1;
                                                            const sh = 1 - light01;
                                                            v += gloom * (0.08 + 0.22 * sh);
                                                            v *= (1 + gloom * 0.18);
                                                        }

                                                        if (flash > 0.001) {
                                                            v *= (1 - flash * 0.75);
                                                            v -= flash * 0.08;
                                                        }

                                                        if (v > 0.92) v = 0.92;
                                                        if (v < th) v = 0;
                                                        lut[i] = v;
                                                    }
                                                    this._darkAlphaLUTBlendNight = qNight;
                                                    this._darkAlphaLUTBlendLevels = levels;
                                                    this._darkAlphaLUTBlendWeatherKey = wKey;
                                                }
                                                window.BLOCK_LIGHT_LUT = lut;

                                                // ───────── 1) Draw tile chunks (base) ─────────
                                                ctx.globalCompositeOperation = 'source-over';
                                                ctx.globalAlpha = 1;
                                                ctx.shadowBlur = 0;

                                                const cfg = this.__cb2_cfg || { tiles: 16 };
                                                const cts = (cfg.tiles | 0) || 16;

                                                const cStartX = (startX / cts) | 0;
                                                const cStartY = (startY / cts) | 0;
                                                const cEndX = (endX / cts) | 0;
                                                const cEndY = (endY / cts) | 0;

                                                for (let cy = cStartY; cy <= cEndY; cy++) {
                                                    for (let cx = cStartX; cx <= cEndX; cx++) {
                                                        const e = this.__cb2_getEntry(world, cx, cy);
                                                        if (!e || !e.canvas) continue;
                                                        const dx = cx * cts * ts - camCeilX;
                                                        const dy = cy * cts * ts - camCeilY;
                                                        ctx.drawImage(e.canvas, dx, dy);
                                                    }
                                                }

                                                // ───────── 2) Draw baked glow canvases (chunk-level) ─────────
                                                if (this.enableGlow) {
                                                    for (let cy = cStartY; cy <= cEndY; cy++) {
                                                        for (let cx = cStartX; cx <= cEndX; cx++) {
                                                            const e = this.__cb2_getEntry(world, cx, cy);
                                                            if (!e || !e.glowCanvas || !e.hasGlow) continue;
                                                            const pad = e.glowPad | 0;
                                                            const dx = cx * cts * ts - camCeilX - pad;
                                                            const dy = cy * cts * ts - camCeilY - pad;
                                                            ctx.drawImage(e.glowCanvas, dx, dy);
                                                        }
                                                    }
                                                }

                                                // ───────── 3) Tile-resolution darkness alpha-map (offscreen ImageData) ─────────
                                                const tilesCols = world.tiles;
                                                const lightCols = world.light;
                                                const tilesFlat = world.tilesFlat;
                                                const lightFlat = world.lightFlat;
                                                const H = world.h | 0;

                                                const wTiles = (endX - startX + 1) | 0;
                                                const hTiles = (endY - startY + 1) | 0;

                                                let mask = this.__tu_darkMask;
                                                if (!mask || mask.w !== wTiles || mask.h !== hTiles) {
                                                    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(wTiles, hTiles) : document.createElement('canvas');
                                                    c.width = wTiles; c.height = hTiles;
                                                    const mctx = c.getContext('2d', { alpha: true });
                                                    mask = this.__tu_darkMask = { canvas: c, ctx: mctx, w: wTiles, h: hTiles, imageData: mctx.createImageData(wTiles, hTiles) };
                                                }

                                                const wfShadow = wf && wf.shadowColor ? wf.shadowColor : 'rgb(10,5,20)';
                                                const rgb = parseRgb(wfShadow);

                                                const data = mask.imageData.data;
                                                // Fill
                                                let di = 0;
                                                if (tilesFlat && lightFlat && H) {
                                                    // x-major scan for cache friendliness on column-major flat arrays
                                                    // We write into row-major ImageData with a constant stride.
                                                    for (let y = 0; y < hTiles; y++) {
                                                        const wy = startY + y;
                                                        const rowBase = (y * wTiles) << 2;
                                                        for (let x = 0; x < wTiles; x++) {
                                                            const wx = startX + x;
                                                            const idx = (wx * H + wy) | 0;
                                                            const id = tilesFlat[idx] | 0;
                                                            const a = id ? lut[lightFlat[idx] | 0] : 0;
                                                            const o = rowBase + (x << 2);
                                                            data[o] = rgb.r;
                                                            data[o + 1] = rgb.g;
                                                            data[o + 2] = rgb.b;
                                                            data[o + 3] = a ? ((a * 255) | 0) : 0;
                                                        }
                                                    }
                                                } else {
                                                    for (let y = startY; y <= endY; y++) {
                                                        for (let x = startX; x <= endX; x++) {
                                                            const id = tilesCols && tilesCols[x] ? (tilesCols[x][y] | 0) : 0;
                                                            const lv = lightCols && lightCols[x] ? (lightCols[x][y] | 0) : 0;
                                                            const a = id ? lut[lv] : 0;
                                                            data[di++] = rgb.r;
                                                            data[di++] = rgb.g;
                                                            data[di++] = rgb.b;
                                                            data[di++] = a ? ((a * 255) | 0) : 0;
                                                        }
                                                    }
                                                }

                                                mask.ctx.putImageData(mask.imageData, 0, 0);

                                                const oldSmooth = ctx.imageSmoothingEnabled;
                                                ctx.imageSmoothingEnabled = false;
                                                ctx.globalAlpha = 1;
                                                ctx.globalCompositeOperation = 'source-over';

                                                ctx.drawImage(
                                                    mask.canvas,
                                                    0, 0, wTiles, hTiles,
                                                    startX * ts - camCeilX,
                                                    startY * ts - camCeilY,
                                                    wTiles * ts,
                                                    hTiles * ts
                                                );

                                                ctx.imageSmoothingEnabled = oldSmooth;
                                                ctx.globalAlpha = 1;
                                            };
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 3) TileLogic diff: column-view bitpack (only when diff is huge) + apply path
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof TileLogicEngine !== 'undefined' && TileLogicEngine) {

                                            // ---- Worker source: add packed path when len is large ----
                                            if (!TileLogicEngine.__tu_packXYWorkerSourcePatched && typeof TileLogicEngine._workerSource === 'function') {
                                                const _orig = TileLogicEngine._workerSource;
                                                TileLogicEngine._workerSource = function () {
                                                    let s = _orig.call(TileLogicEngine);
                                                    try {
                                                        if (!s || s.indexOf("type: 'changes'") === -1) return s;
                                                        if (s.indexOf("type: 'changesXY'") !== -1) return s;

                                                        // 1) inject allocator + threshold near pool definition
                                                        const poolDecl = "const __TU_OUT_POOL__ = [];";
                                                        if (s.indexOf(poolDecl) !== -1) {
                                                            const inject = `
  const __TU_PACK_THRESHOLD__ = 6144; // ints (3 per change); only pack when very large
  function __tuAllocOutPacked(n) {
    const need = (n << 3) >>> 0; // 8 bytes per change (xy uint32 + ids uint16 + pad)
    let b = null;
    for (let i = __TU_OUT_POOL__.length - 1; i >= 0; i--) {
      const cand = __TU_OUT_POOL__[i];
      if (cand && cand.byteLength >= need) { b = cand; __TU_OUT_POOL__.splice(i, 1); break; }
    }
    return b || new ArrayBuffer(need);
  }
`;
                                                            s = s.replace(poolDecl, poolDecl + inject);
                                                        }

                                                        // 2) replace postMessage line with conditional packed send
                                                        const needle = "postMessage({ type: 'changes', buf: buf, len: len }, [buf]);";
                                                        if (s.indexOf(needle) !== -1) {
                                                            const repl = `
      if (len >= __TU_PACK_THRESHOLD__) {
        const n = (len / 3) | 0;
        const pbuf = __tuAllocOutPacked(n);
        const xy = new Uint32Array(pbuf, 0, n);
        const ids = new Uint16Array(pbuf, n * 4, n);
        for (let k = 0, j = 0; k < n; k++, j += 3) {
          const idx = __tuOutView[j] | 0;
          const x = (idx / H) | 0;
          const y = idx - x * H;
          xy[k] = ((x & 0xffff) << 16) | (y & 0xffff);
          const oldId = __tuOutView[j + 1] | 0;
          const newId = __tuOutView[j + 2] | 0;
          ids[k] = ((oldId & 255) | ((newId & 255) << 8)) & 0xffff;
        }
        try { __TU_OUT_POOL__.push(buf); } catch(_) { /* silently ignore */ }
        postMessage({ type: 'changesXY', buf: pbuf, n: n }, [pbuf]);
      } else {
        postMessage({ type: 'changes', buf: buf, len: len }, [buf]);
      }`;
                                                            s = s.replace(needle, repl);
                                                        }

                                                        return s;
                                                    } catch (_) {
                                                        return s;
                                                    }
                                                };
                                                TileLogicEngine.__tu_packXYWorkerSourcePatched = true;
                                            }

                                            // ---- Main thread: accept changesXY and apply using column view getter ----
                                            if (TileLogicEngine.prototype && !TileLogicEngine.prototype.__tu_packXYApplyWrapped) {
                                                TileLogicEngine.prototype.__tu_packXYApplyWrapped = true;

                                                // Column view getter (cached)
                                                TileLogicEngine.prototype.__tu_getTileCol = function (x) {
                                                    const wx = x | 0;
                                                    if (this.__tu_lastColX === wx && this.__tu_lastCol) return this.__tu_lastCol;
                                                    const cols = this.world && this.world.tiles;
                                                    const col = cols ? cols[wx] : null;
                                                    this.__tu_lastColX = wx;
                                                    this.__tu_lastCol = col;
                                                    return col;
                                                };

                                                // Wrap _initWorker to extend onmessage
                                                if (typeof TileLogicEngine.prototype._initWorker === 'function') {
                                                    const _origInit = TileLogicEngine.prototype._initWorker;
                                                    TileLogicEngine.prototype._initWorker = function () {
                                                        _origInit.call(this);

                                                        try {
                                                            if (!this.worker || this.__tu_packXYOnMsgWrapped) return;
                                                            this.__tu_packXYOnMsgWrapped = true;

                                                            const self = this;
                                                            const w = this.worker;
                                                            const oldHandler = w.onmessage;

                                                            // pending pool (reuse objects)
                                                            const pendingPool = [];
                                                            function allocPendingPacked(buf, n) {
                                                                const o = pendingPool.pop() || { type: 'xy', buf: null, n: 0, pos: 0 };
                                                                o.type = 'xy';
                                                                o.buf = buf;
                                                                o.n = n | 0;
                                                                o.pos = 0;
                                                                return o;
                                                            }
                                                            function allocPendingArr(arr) {
                                                                const o = pendingPool.pop() || { type: 'i32', arr: null, pos: 0 };
                                                                o.type = 'i32';
                                                                o.arr = arr;
                                                                o.pos = 0;
                                                                return o;
                                                            }
                                                            function freePending(o) {
                                                                o.type = 'i32';
                                                                o.arr = null;
                                                                o.buf = null;
                                                                o.n = 0;
                                                                o.pos = 0;
                                                                pendingPool.push(o);
                                                            }
                                                            self.__tu_pendingPool2 = { allocPendingPacked, allocPendingArr, freePending };

                                                            w.onmessage = (e) => {
                                                                const msg = e.data;
                                                                if (!msg || !msg.type) { if (oldHandler) try { oldHandler(e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } return; }

                                                                if (msg.type === 'changes' && msg.buf) {
                                                                    try {
                                                                        const len = (msg.len | 0) > 0 ? (msg.len | 0) : 0;
                                                                        const arr = len ? new Int32Array(msg.buf, 0, len) : new Int32Array(msg.buf);
                                                                        self.pending.push(allocPendingArr(arr));
                                                                        self._scheduleApply();
                                                                        return;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }

                                                                if (msg.type === 'changesXY' && msg.buf) {
                                                                    try {
                                                                        const n = (msg.n | 0) > 0 ? (msg.n | 0) : 0;
                                                                        self.pending.push(allocPendingPacked(msg.buf, n));
                                                                        self._scheduleApply();
                                                                        return;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }

                                                                if (oldHandler) {
                                                                    try { oldHandler(e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            };
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }

                                                // Replace _applyPending with a packed-aware version (keeps recycle behavior)
                                                if (typeof TileLogicEngine.prototype._applyPending === 'function') {
                                                    const _origApply = TileLogicEngine.prototype._applyPending;

                                                    TileLogicEngine.prototype._applyPending = function (deadline) {
                                                        // If we don't have packed items, just use original (perfpack wrapper will recycle buffers)
                                                        let hasPacked = false;
                                                        for (let i = 0; i < this.pending.length; i++) {
                                                            const it = this.pending[i];
                                                            if (it && it.type === 'xy') { hasPacked = true; break; }
                                                        }
                                                        if (!hasPacked) return _origApply.call(this, deadline);

                                                        this._applyScheduled = false;
                                                        if (!this.pending.length) return;

                                                        const game = this.game;
                                                        const world = this.world;
                                                        const renderer = game && game.renderer;

                                                        const BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : null;

                                                        let any = false;
                                                        const lightSeeds = [];
                                                        const maxLightSeeds = 16;

                                                        const maxOps = 2000;
                                                        let ops = 0;

                                                        const pool = this.__tu_pendingPool2 || null;
                                                        const getCol = this.__tu_getTileCol ? this.__tu_getTileCol.bind(this) : null;

                                                        while (this.pending.length && (deadline.timeRemaining() > 2 || deadline.didTimeout) && ops < maxOps) {
                                                            const cur = this.pending[0];

                                                            if (cur.type === 'xy') {
                                                                const n = cur.n | 0;
                                                                const buf = cur.buf;
                                                                if (!buf || !n) { this.pending.shift(); ops++; continue; }

                                                                const xy = new Uint32Array(buf, 0, n);
                                                                const ids = new Uint16Array(buf, n * 4, n);

                                                                while ((cur.pos | 0) < n && ops < maxOps) {
                                                                    const k = cur.pos | 0;
                                                                    cur.pos = k + 1;

                                                                    const v = xy[k] >>> 0;
                                                                    const x = (v >>> 16) & 0xffff;
                                                                    const y = v & 0xffff;
                                                                    if (x >= (this.w | 0) || y >= (this.h | 0)) { ops++; continue; }

                                                                    const pack = ids[k] >>> 0;
                                                                    const expectOld = pack & 255;
                                                                    const newId = (pack >>> 8) & 255;

                                                                    const col = getCol ? getCol(x) : (world.tiles ? world.tiles[x] : null);
                                                                    if (!col) { ops++; continue; }
                                                                    const oldMain = col[y] | 0;
                                                                    if (oldMain !== expectOld) { ops++; continue; }

                                                                    col[y] = newId;
                                                                    any = true;

                                                                    try { renderer && renderer.invalidateTile && renderer.invalidateTile(x, y); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                                    if (BL) {
                                                                        const blOld = BL[expectOld] | 0;
                                                                        const blNew = BL[newId] | 0;
                                                                        if (blOld !== blNew && lightSeeds.length < maxLightSeeds) lightSeeds.push([x, y]);
                                                                    }

                                                                    this._minimapDirty = true;
                                                                    ops++;
                                                                }

                                                                if ((cur.pos | 0) >= n) {
                                                                    this.pending.shift();
                                                                    // recycle packed buffer back to worker
                                                                    const rbuf = cur.buf;
                                                                    if (rbuf && this.worker && typeof this.worker.postMessage === 'function') {
                                                                        try { this.worker.postMessage({ type: 'recycle', buf: rbuf }, [rbuf]); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                    }
                                                                    if (pool && pool.freePending) try { pool.freePending(cur); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                } else {
                                                                    break;
                                                                }
                                                            } else {
                                                                // Non-packed: delegate to original apply for this timeslice (keeps semantics & recycling)
                                                                _origApply.call(this, deadline);
                                                                break;
                                                            }
                                                        }

                                                        if (any) {
                                                            if (lightSeeds.length && game && game._deferLightUpdate) {
                                                                for (let i = 0; i < lightSeeds.length; i++) {
                                                                    const p = lightSeeds[i];
                                                                    try { game._deferLightUpdate(p[0], p[1]); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            }

                                                            const now = performance.now();
                                                            if (this._minimapDirty && (now - this._lastMinimapFlush > 600)) {
                                                                this._minimapDirty = false;
                                                                this._lastMinimapFlush = now;
                                                                try { game._deferMinimapUpdate && game._deferMinimapUpdate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                        }

                                                        if (this.pending.length) this._scheduleApply();
                                                    };
                                                }
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                })();
                            </script>

                            <!-- ========================= PATCH: tu_gc_opt_v1 ========================= -->
                            <script>
                                (() => {
                                    'use strict';

                                    const TU = window.TU = window.TU || {};

                                    // ─────────────────────────────────────────────────────────────
                                    // 1) Toast：对象池 + 并发上限，降低 DOM churn（频繁提示时更稳）
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Toast !== 'undefined' && Toast && !Toast.__tuPoolV1) {
                                            Toast.__tuPoolV1 = true;

                                            const _getHost = Toast.el ? Toast.el.bind(Toast) : (() => document.getElementById('toast-container'));

                                            const pool = [];
                                            const active = [];
                                            const MAX_ACTIVE = 4;

                                            const clearTimers = (t) => {
                                                try { if (t._hideTimer) { clearTimeout(t._hideTimer); t._hideTimer = 0; } } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                try { if (t._rmTimer) { clearTimeout(t._rmTimer); t._rmTimer = 0; } } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            };

                                            const detach = (t) => {
                                                try {
                                                    const idx = active.indexOf(t);
                                                    if (idx >= 0) active.splice(idx, 1);
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                            };

                                            const recycle = (t) => {
                                                if (!t) return;
                                                clearTimers(t);
                                                try { t.classList.remove('show'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                detach(t);
                                                pool.push(t);
                                            };

                                            const make = () => {
                                                const t = document.createElement('div');
                                                t.className = 'toast';
                                                t._hideTimer = 0;
                                                t._rmTimer = 0;
                                                return t;
                                            };

                                            Toast.show = function (msg, ms = 1600) {
                                                const host = _getHost();
                                                if (!host) return;

                                                // 并发上限：超出则先回收最旧的 toast
                                                while (active.length >= MAX_ACTIVE) {
                                                    recycle(active[0]);
                                                }

                                                const t = pool.pop() || make();
                                                clearTimers(t);

                                                try { t.textContent = String(msg ?? ''); } catch (_) { t.textContent = '' + msg; }
                                                try { t.classList.remove('show'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                host.appendChild(t);
                                                active.push(t);

                                                requestAnimationFrame(() => { try { t.classList.add('show'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } });

                                                t._hideTimer = setTimeout(() => {
                                                    try { t.classList.remove('show'); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    t._rmTimer = setTimeout(() => recycle(t), 220);
                                                }, ms);
                                            };
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 2) 机器逻辑：压力板 + 抽水泵（减少每帧/每 tick 的小对象分配）
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Game !== 'undefined' && Game.prototype) {
                                            const GP = Game.prototype;

                                            // 2.1 压力板：用 int key 代替 "x,y" 字符串；复用 Set/Array
                                            if (typeof GP._updatePressurePlates === 'function' && !GP.__tuPlateGcOptV1) {
                                                GP.__tuPlateGcOptV1 = true;

                                                const _old = GP._updatePressurePlates;

                                                GP._updatePressurePlates = function () {
                                                    const world = this.world;
                                                    const m = this._machines;
                                                    if (!world || !m || !m.plates || !m.plates.length) return;

                                                    const IDS = (TU && TU.LOGIC_BLOCKS) ? TU.LOGIC_BLOCKS : {};
                                                    const PL_OFF = IDS.PLATE_OFF;
                                                    const PL_ON = IDS.PLATE_ON;

                                                    // 兜底：若缺少依赖，走旧实现
                                                    if (PL_OFF == null || PL_ON == null || typeof this._writeTileFast !== 'function') {
                                                        return _old.call(this);
                                                    }

                                                    const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : (TU.CONFIG || { TILE_SIZE: 16 });
                                                    const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                    const w = world.w | 0;
                                                    const h = world.h | 0;
                                                    const tiles = world.tiles;

                                                    const pressed = this._platePressed || (this._platePressed = new Set());
                                                    const next = this._plateNext || (this._plateNext = new Set());
                                                    next.clear();

                                                    const markPlateUnder = (ent) => {
                                                        if (!ent) return;
                                                        const cx = (ent.x + ent.w * 0.5);
                                                        const fy = (ent.y + ent.h + 1);
                                                        const tx = (cx / ts) | 0;
                                                        const ty = (fy / ts) | 0;
                                                        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
                                                        const id = tiles[tx][ty];
                                                        if (id === PL_OFF || id === PL_ON) {
                                                            next.add(tx + ty * w);
                                                        }
                                                    };

                                                    // player
                                                    markPlateUnder(this.player);

                                                    // mobs/enemies if present
                                                    try {
                                                        const ents = this.entities || this.mobs || this.enemies;
                                                        if (Array.isArray(ents)) {
                                                            for (let i = 0; i < ents.length; i++) markPlateUnder(ents[i]);
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    // Apply state changes (ON for pressed, OFF for released)
                                                    for (const k of next) {
                                                        if (pressed.has(k)) continue;
                                                        pressed.add(k);
                                                        const y = (k / w) | 0;
                                                        const x = (k - y * w) | 0;
                                                        this._writeTileFast(x, y, PL_ON, false);
                                                    }

                                                    if (pressed.size) {
                                                        // 收集释放列表：避免在迭代 Set 时 delete 的边缘行为
                                                        const toOff = this._plateToOff || (this._plateToOff = []);
                                                        toOff.length = 0;
                                                        for (const k of pressed) {
                                                            if (!next.has(k)) toOff.push(k);
                                                        }
                                                        for (let i = 0; i < toOff.length; i++) {
                                                            const k = toOff[i] | 0;
                                                            pressed.delete(k);
                                                            const y = (k / w) | 0;
                                                            const x = (k - y * w) | 0;
                                                            this._writeTileFast(x, y, PL_OFF, false);
                                                        }
                                                    }
                                                };
                                            }

                                            // 2.2 抽水泵：复用 BFS 数组；邻居选择不再分配小数组
                                            if (typeof GP._pumpSim === 'function' && !GP.__tuPumpGcOptV1) {
                                                GP.__tuPumpGcOptV1 = true;

                                                const _oldPump = GP._pumpSim;

                                                GP._pumpSim = function (dtMs) {
                                                    const world = this.world;
                                                    if (!world || !world.tiles) return;

                                                    const m = this._machines;
                                                    if (!m || !m.pumpsIn || !m.pumpsOut) return;
                                                    if (!m.pumpsIn.length || !m.pumpsOut.length) return;

                                                    this._pumpAcc = (this._pumpAcc || 0) + (dtMs || 0);
                                                    if (this._pumpAcc < 220) return;
                                                    this._pumpAcc = 0;

                                                    const IDS = (TU && TU.LOGIC_BLOCKS) ? TU.LOGIC_BLOCKS : {};
                                                    const B = (typeof BLOCK !== 'undefined') ? BLOCK : (TU.BLOCK || {});

                                                    // 兜底：关键 ID/常量不全则走旧实现
                                                    if (!IDS || IDS.PUMP_IN == null || IDS.PUMP_OUT == null || IDS.WIRE_OFF == null || IDS.WIRE_ON == null || B.AIR == null || B.WATER == null) {
                                                        return _oldPump.call(this, dtMs);
                                                    }

                                                    const w = world.w | 0, h = world.h | 0;
                                                    const tiles = world.tiles;

                                                    // Visited marks for BFS
                                                    if (!this._pumpVisited || this._pumpVisited.length !== w * h) {
                                                        this._pumpVisited = new Uint32Array(w * h);
                                                        this._pumpStamp = 1;
                                                    }
                                                    let stamp = (this._pumpStamp + 1) >>> 0;
                                                    if (stamp === 0) { this._pumpVisited.fill(0); stamp = 1; }
                                                    this._pumpStamp = stamp;
                                                    const vis = this._pumpVisited;

                                                    const isWire = (id) => (id === IDS.WIRE_OFF || id === IDS.WIRE_ON);
                                                    const isSwitch = (id) => (id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON || id === IDS.PLATE_OFF || id === IDS.PLATE_ON);
                                                    const isPump = (id) => (id === IDS.PUMP_IN || id === IDS.PUMP_OUT);
                                                    const isConductor = (id) => isWire(id) || isSwitch(id) || isPump(id);
                                                    const isPoweredSource = (id) => (id === IDS.SWITCH_ON || id === IDS.PLATE_ON);

                                                    const tmpIn = this._pumpTmpIn || (this._pumpTmpIn = new Int32Array(2));
                                                    const tmpOut = this._pumpTmpOut || (this._pumpTmpOut = new Int32Array(2));

                                                    const pickNeighborWater = (x, y, outXY) => {
                                                        // prefer below
                                                        let nx = x, ny = y + 1;
                                                        if (ny >= 0 && ny < h && tiles[nx][ny] === B.WATER) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x - 1; ny = y;
                                                        if (nx >= 0 && nx < w && tiles[nx][ny] === B.WATER) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x + 1;
                                                        if (nx >= 0 && nx < w && tiles[nx][ny] === B.WATER) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x; ny = y - 1;
                                                        if (ny >= 0 && ny < h && tiles[nx][ny] === B.WATER) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        return false;
                                                    };

                                                    const pickNeighborOutput = (x, y, outXY) => {
                                                        let nx = x, ny = y - 1;
                                                        if (ny >= 0 && ny < h && tiles[nx][ny] === B.AIR) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x + 1; ny = y;
                                                        if (nx >= 0 && nx < w && tiles[nx][ny] === B.AIR) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x - 1;
                                                        if (nx >= 0 && nx < w && tiles[nx][ny] === B.AIR) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        nx = x; ny = y + 1;
                                                        if (ny >= 0 && ny < h && tiles[nx][ny] === B.AIR) { outXY[0] = nx; outXY[1] = ny; return true; }
                                                        return false;
                                                    };

                                                    // Process a small number of pumps per tick to keep fps stable
                                                    const budget = (this._perf && this._perf.level === 'low') ? 1 : 3;

                                                    const qx = this._pumpQX || (this._pumpQX = []);
                                                    const qy = this._pumpQY || (this._pumpQY = []);
                                                    const outList = this._pumpOutList || (this._pumpOutList = []);

                                                    let done = 0;

                                                    for (let pi = 0; pi < m.pumpsIn.length && done < budget; pi++) {
                                                        const pIn = m.pumpsIn[pi];
                                                        if (!pIn) continue;

                                                        const sx = pIn[0] | 0;
                                                        const sy = pIn[1] | 0;

                                                        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                                                        if (tiles[sx][sy] !== IDS.PUMP_IN) continue;

                                                        // BFS wire network
                                                        qx.length = 0; qy.length = 0;
                                                        outList.length = 0;
                                                        qx.push(sx); qy.push(sy);

                                                        let powered = false;
                                                        let nodes = 0;

                                                        vis[sx + sy * w] = stamp;

                                                        while (qx.length && nodes < 24000) {
                                                            const x = qx.pop() | 0;
                                                            const y = qy.pop() | 0;
                                                            nodes++;

                                                            const id = tiles[x][y];
                                                            if (isPoweredSource(id)) powered = true;
                                                            if (id === IDS.PUMP_OUT) outList.push(x + y * w);

                                                            const push = (nx, ny) => {
                                                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
                                                                const k = nx + ny * w;
                                                                if (vis[k] === stamp) return;
                                                                const tid = tiles[nx][ny];
                                                                if (!isConductor(tid)) return;
                                                                vis[k] = stamp;
                                                                qx.push(nx); qy.push(ny);
                                                            };

                                                            push(x - 1, y);
                                                            push(x + 1, y);
                                                            push(x, y - 1);
                                                            push(x, y + 1);
                                                        }

                                                        if (!powered || !outList.length) continue;

                                                        // intake -> output water teleport
                                                        if (!pickNeighborWater(sx, sy, tmpIn)) continue;

                                                        // pick a deterministic output (round-robin)
                                                        const rr = (this._pumpRR || 0) % outList.length;
                                                        this._pumpRR = (rr + 1) | 0;
                                                        const outK = outList[rr] | 0;
                                                        const oy = (outK / w) | 0;
                                                        const ox = (outK - oy * w) | 0;

                                                        if (!pickNeighborOutput(ox, oy, tmpOut)) continue;

                                                        // move one tile of water (coarse, region independent)
                                                        this._writeTileFast(tmpIn[0], tmpIn[1], B.AIR, false);
                                                        this._writeTileFast(tmpOut[0], tmpOut[1], B.WATER, false);

                                                        done++;
                                                    }
                                                };
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                })();
                            </script>
