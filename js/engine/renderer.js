// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Renderer
// MERGED: Original class + experience_optimized_v2 patches
// Includes: renderParallaxMountains, renderSky, renderWorld, applyPostFX
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

    <!-- ========================= MODULE: render/renderer ========================= -->
    <script>
        // ═══════════════════════════════════════════════════════════════════════
        const WALL_COLORS = ['#2b2f3a', '#353b48', '#2d3436', '#1e272e'];
        const PARALLAX_LAYERS = [
            // 更精致的多层山脉（根据昼夜自动换色）
            {
                p: 0.05, y: 260, amp: 145, freq: 0.0019, detail: 0.0065, sharp: 1.60, seed: 17,
                snow: 1, snowLine: 0.74,
                palette: {
                    night: ['#070a18', '#111a33'],
                    dawn: ['#20122f', '#3a1f48'],
                    day: ['#b7d4f4', '#7a9cc2'],
                    dusk: ['#1c1430', '#3b2953']
                }
            },
            {
                p: 0.10, y: 215, amp: 120, freq: 0.0025, detail: 0.0078, sharp: 1.45, seed: 33,
                snow: 1, snowLine: 0.76,
                palette: {
                    night: ['#0b1024', '#18284a'],
                    dawn: ['#2a1430', '#5a2a3f'],
                    day: ['#9cc0e0', '#5f86b5'],
                    dusk: ['#22193f', '#5a3b6d']
                }
            },
            {
                p: 0.18, y: 165, amp: 105, freq: 0.0034, detail: 0.0105, sharp: 1.30, seed: 57,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#111c2c', '#243a4e'],
                    dawn: ['#3a2340', '#7a3b4b'],
                    day: ['#7db6c9', '#3d6f86'],
                    dusk: ['#2b2447', '#7a4b6d']
                }
            },
            {
                p: 0.30, y: 110, amp: 90, freq: 0.0046, detail: 0.0135, sharp: 1.18, seed: 89,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#162a2f', '#2f4a45'],
                    dawn: ['#3a2f3c', '#8a4a4a'],
                    day: ['#5fa39b', '#2f6b5f'],
                    dusk: ['#2a2f47', '#6a5a6d']
                }
            },
            {
                p: 0.45, y: 65, amp: 70, freq: 0.0060, detail: 0.0180, sharp: 1.10, seed: 123,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#1b2a2a', '#3a4a3f'],
                    dawn: ['#3a2a2a', '#7a3a2f'],
                    day: ['#4f8a4f', '#2e5f35'],
                    dusk: ['#2a2a3a', '#4a3a3f']
                }
            }
        ];

        // ═══════════════════════════════════════════════════════════════════════
        //                    Parallax Mountains (重绘美化版)
        //   目标：更像“层叠远山 + 空气透视 + 细节脊线”，替代原本的正弦波山丘
        // ═══════════════════════════════════════════════════════════════════════

        const _PX = (() => {
            // 快速 1D 噪声（整数 hash + smoothstep 插值），足够做山脊轮廓且很轻量。
            const hash = (n) => {
                n = (n << 13) ^ n;
                return 1.0 - (((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);
            };

            const smooth = (t) => t * t * (3 - 2 * t);

            const noise1 = (x, seed) => {
                const i = Math.floor(x);
                const f = x - i;
                const u = smooth(f);
                const a = hash(((i + seed) | 0));
                const b = hash(((i + 1 + seed) | 0));
                return a + (b - a) * u; // -1..1
            };

            const fbm = (x, seed, oct = 4) => {
                let v = 0;
                let amp = 0.55;
                let freq = 1;
                for (let o = 0; o < oct; o++) {
                    v += amp * noise1(x * freq, seed + o * 101);
                    freq *= 2;
                    amp *= 0.5;
                }
                return v; // ~[-1,1]
            };

            // ridged fbm：更“尖”的山脊
            const ridged = (x, seed, oct = 4) => {
                let v = 0;
                let amp = 0.65;
                let freq = 1;
                for (let o = 0; o < oct; o++) {
                    let n = noise1(x * freq, seed + o * 131);
                    n = 1 - Math.abs(n);
                    v += (n * n) * amp;
                    freq *= 2;
                    amp *= 0.55;
                }
                return v; // ~[0,1]
            };

            return { fbm, ridged };
        })();

        function renderParallaxMountains(renderer, cam, time = 0.5) {
            const ctx = renderer.ctx;
            const w = (renderer.w | 0);
            const h = (renderer.h | 0);
            if (!ctx || w <= 0 || h <= 0) return;

            // 可选：用户主动关闭“背景墙山脉”或性能管理器临时禁用
            try {
                const gs = window.GAME_SETTINGS || {};
                if (gs.bgMountains === false) return;
                if (gs.__bgMountainsEffective === false) return;
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

            // ───────────────────────── Static helpers（只初始化一次） ─────────────────────────
            const PM = renderParallaxMountains.__PM || (renderParallaxMountains.__PM = (() => {
                const CHUNK_W = 512;   // 山脉“横向缓存块”宽度（px）
                const OVERLAP = 64;    // 两侧重叠，避免 chunk 拼接处的描边断裂
                const PAD_CHUNKS = 2;  // 视野外多缓存几个 chunk，减少移动时抖动/瞬时生成

                const makeCanvas = (cw, ch) => {
                    let c = null;
                    // OffscreenCanvas：更快且不进 DOM（不支持会回退）
                    if (typeof OffscreenCanvas !== 'undefined') {
                        try { c = new OffscreenCanvas(cw, ch); } catch (_) { c = null; }
                    }
                    if (!c) {
                        c = document.createElement('canvas');
                    }
                    // 无论 OffscreenCanvas / Canvas 都支持 width/height
                    c.width = cw;
                    c.height = ch;
                    return c;
                };

                const getCtx = (c) => {
                    try { return c.getContext('2d', { alpha: true }); } catch (e) {
                        try { return c.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                    }
                };

                return { CHUNK_W, OVERLAP, PAD_CHUNKS, makeCanvas, getCtx };
            })());

            const low = !!renderer.lowPower;
            const step = low ? 24 : 12;
            const layers = low ? PARALLAX_LAYERS.slice(0, 3) : PARALLAX_LAYERS;

            // ── Mountain Rendering Patch v2: deterministic theme derivation ──
            // Always derive the theme directly from the time value, never from
            // renderer._getSkyBucket which has multiple conflicting implementations
            // (class returns t*100, patch returns 0-3). This guarantees theme
            // is always correct regardless of which _getSkyBucket is active.
            const theme = (time < 0.2) ? 'night'
                        : (time < 0.3) ? 'dawn'
                        : (time < 0.7) ? 'day'
                        : (time < 0.8) ? 'dusk'
                        : 'night';

            // ───────────────────────── Cache（按主题/分辨率/低功耗重建） ─────────────────────────
            const cacheKey = theme + '|' + h + '|' + (low ? 1 : 0) + '|' + step + '|' + layers.length;
            let cache = renderer._parallaxMountainCache;
            if (!cache || cache.key !== cacheKey) {
                cache = renderer._parallaxMountainCache = {
                    key: cacheKey,
                    theme,
                    h,
                    low,
                    step,
                    chunkW: PM.CHUNK_W,
                    over: PM.OVERLAP,
                    pad: PM.PAD_CHUNKS,
                    layerMaps: Array.from({ length: layers.length }, () => new Map()),
                    fogKey: '',
                    fogGrad: null
                };
            } else {
                // 保险：层数变化时补齐/裁剪 map
                while (cache.layerMaps.length < layers.length) cache.layerMaps.push(new Map());
                if (cache.layerMaps.length > layers.length) cache.layerMaps.length = layers.length;
            }

            const ridgeStroke = (theme === 'day') ? 'rgba(255,255,255,0.20)' : 'rgba(220,230,255,0.14)';
            const snowStroke = (theme === 'day') ? 'rgba(255,255,255,0.75)' : 'rgba(220,230,255,0.55)';

            const chunkW = cache.chunkW;
            const over = cache.over;
            const fullW = chunkW + over * 2;

            // chunk 构建：只在“第一次进入视野”时生成（大幅减少每帧噪声/路径计算）
            const buildChunk = (layer, li, chunkIndex) => {
                const canvas = PM.makeCanvas(fullW, h);
                const g = PM.getCtx(canvas);
                if (!g) return { canvas };

                g.clearRect(0, 0, fullW, h);

                // 渐变填充
                const cols = (layer.palette && layer.palette[theme]) ? layer.palette[theme]
                    : (layer.palette ? layer.palette.night : ['#222', '#444']);
                const grad = g.createLinearGradient(0, h - layer.y - 160, 0, h);
                grad.addColorStop(0, cols[0]);
                grad.addColorStop(1, cols[1]);
                g.fillStyle = grad;

                const worldStart = chunkIndex * chunkW; // “山脉空间”的起点
                const x0 = -over;
                const x1 = chunkW + over;

                // 记录点：用于脊线高光与雪线（避免二次采样）
                const pts = [];

                // 轮廓填充
                g.beginPath();
                g.moveTo(0, h + 2);

                // 采样（用 < 再补一个端点，确保拼接处严格对齐）
                for (let x = x0; x < x1; x += step) {
                    const wx = worldStart + x;
                    const r = _PX.ridged(wx * layer.freq, layer.seed);
                    const f = _PX.fbm(wx * layer.detail, layer.seed + 999);

                    const contour = 0.72 * r + 0.28 * Math.pow(r, layer.sharp || 1.2);
                    const wobble = 0.86 + 0.14 * f;
                    const hh = layer.amp * contour * wobble;

                    const y = h - layer.y - hh;
                    const cx = x + over;
                    pts.push(cx, y, hh);
                    g.lineTo(cx, y);
                }

                // 末端精确补点（x1）
                {
                    const x = x1;
                    const wx = worldStart + x;
                    const r = _PX.ridged(wx * layer.freq, layer.seed);
                    const f = _PX.fbm(wx * layer.detail, layer.seed + 999);

                    const contour = 0.72 * r + 0.28 * Math.pow(r, layer.sharp || 1.2);
                    const wobble = 0.86 + 0.14 * f;
                    const hh = layer.amp * contour * wobble;

                    const y = h - layer.y - hh;
                    const cx = x + over;
                    pts.push(cx, y, hh);
                    g.lineTo(cx, y);
                }

                g.lineTo(fullW, h + 2);
                g.closePath();
                g.fill();

                // 脊线高光（薄薄一条，增强立体感）
                g.save();
                g.globalAlpha = low ? 0.10 : (0.12 + li * 0.02);
                g.strokeStyle = ridgeStroke;
                g.lineWidth = low ? 1 : 2;
                g.lineJoin = 'round';
                g.lineCap = 'round';
                g.beginPath();
                if (pts.length >= 3) {
                    g.moveTo(pts[0], pts[1]);
                    for (let i = 3; i < pts.length; i += 3) g.lineTo(pts[i], pts[i + 1]);
                }
                g.stroke();
                g.restore();

                // 雪线（只给最远两层，避免“到处发白”）
                if (layer.snow && !low) {
                    const threshold = (layer.snowLine || 0.75) * layer.amp;
                    g.save();
                    g.globalAlpha = (theme === 'day') ? 0.22 : 0.15;
                    g.strokeStyle = snowStroke;
                    g.lineWidth = 2;
                    g.lineJoin = 'round';
                    g.lineCap = 'round';
                    g.beginPath();
                    let inSeg = false;
                    for (let i = 0; i < pts.length; i += 3) {
                        const x = pts[i];
                        const y = pts[i + 1];
                        const hh = pts[i + 2];
                        if (hh > threshold) {
                            if (!inSeg) { g.moveTo(x, y + 1); inSeg = true; }
                            else g.lineTo(x, y + 1);
                        } else {
                            inSeg = false;
                        }
                    }
                    g.stroke();
                    g.restore();
                }

                return { canvas };
            };

            // ───────────────────────── Draw（按层绘制 chunk） ─────────────────────────
            for (let li = 0; li < layers.length; li++) {
                const layer = layers[li];
                const map = cache.layerMaps[li];

                // cam.x -> “山脉空间”偏移（与旧实现保持一致）
                const camP = (cam.x || 0) * layer.p;

                // 覆盖范围：与旧版一致，左右多画一点避免边缘露底
                const startWX = camP - 80;
                const endWX = camP + w + 80;

                const first = Math.floor(startWX / chunkW);
                const last = Math.floor(endWX / chunkW);

                const keepMin = first - cache.pad;
                const keepMax = last + cache.pad;

                // 生成缺失 chunk
                for (let ci = keepMin; ci <= keepMax; ci++) {
                    if (!map.has(ci)) {
                        map.set(ci, buildChunk(layer, li, ci));
                    }
                }

                // 清理远离视野的 chunk（控制内存 + Map 遍历成本）
                for (const k of map.keys()) {
                    if (k < keepMin || k > keepMax) map.delete(k);
                }

                // 绘制可见 chunk（裁剪掉 overlap 区域，拼接处无缝）
                for (let ci = first; ci <= last; ci++) {
                    const chunk = map.get(ci);
                    if (!chunk || !chunk.canvas) continue;

                    const dx = (ci * chunkW) - camP; // chunkStart - camOffset
                    try {
                        ctx.drawImage(chunk.canvas, over, 0, chunkW, h, dx, 0, chunkW, h);
                    } catch (_) {
                        // 某些极端环境下 OffscreenCanvas.drawImage 可能失败：降级为不渲染山脉（不影响游戏）
                    }
                }
            }

            // ───────────────────────── Fog overlay（缓存渐变，避免每帧 createLinearGradient） ─────────────────────────
            const fogKey = theme + '|' + h;
            if (!cache.fogGrad || cache.fogKey !== fogKey) {
                const fog = ctx.createLinearGradient(0, h * 0.35, 0, h);
                if (theme === 'day') {
                    fog.addColorStop(0, 'rgba(255,255,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(220,235,255,0.10)');
                    fog.addColorStop(1, 'rgba(200,230,255,0.14)');
                } else if (theme === 'dawn') {
                    fog.addColorStop(0, 'rgba(255,120,180,0.00)');
                    fog.addColorStop(0.72, 'rgba(255,170,140,0.06)');
                    fog.addColorStop(1, 'rgba(190,210,255,0.10)');
                } else if (theme === 'dusk') {
                    fog.addColorStop(0, 'rgba(170,140,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(255,160,120,0.05)');
                    fog.addColorStop(1, 'rgba(140,170,230,0.10)');
                } else {
                    fog.addColorStop(0, 'rgba(190,210,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(160,180,255,0.06)');
                    fog.addColorStop(1, 'rgba(110,140,210,0.12)');
                }
                cache.fogGrad = fog;
                cache.fogKey = fogKey;
            }

            ctx.save();
            ctx.fillStyle = cache.fogGrad;
            ctx.fillRect(0, h * 0.35, w, h);
            ctx.restore();
        }


        // ═══════════════════ 渲染批量优化 ═══════════════════
        const RenderBatcher = {
            _batches: new Map(),

            begin() {
                this._batches.clear();
            },

            add(texture, x, y, alpha = 1) {
                if (!this._batches.has(texture)) {
                    this._batches.set(texture, []);
                }
                this._batches.get(texture).push({ x, y, alpha });
            },

            render(ctx) {
                for (const [texture, positions] of this._batches) {
                    ctx.save();
                    for (const pos of positions) {
                        if (pos.alpha !== 1) {
                            ctx.globalAlpha = pos.alpha;
                        }
                        ctx.drawImage(texture, pos.x, pos.y);
                        if (pos.alpha !== 1) {
                            ctx.globalAlpha = 1;
                        }
                    }
                    ctx.restore();
                }
            }
        };

        class Renderer {
            constructor(canvas) {
                this.canvas = canvas;
                this.ctx = null;
                if (canvas && canvas.getContext) {
                    try { this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                    if (!this.ctx) {
                        try { this.ctx = canvas.getContext('2d', { alpha: false }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                    }
                }
                if (!this.ctx) {
                    throw new Error('Canvas 2D context 初始化失败');
                }
                this._pp = {
                    canvas: document.createElement('canvas'),
                    ctx: null,
                    noise: document.createElement('canvas'),
                    nctx: null,
                    seed: 0,
                    _bloom: null
                };
                this._pp.ctx = this._pp.canvas.getContext('2d', { alpha: false });
                this._pp.nctx = this._pp.noise.getContext('2d', { alpha: true });
                this.textures = new TextureGenerator();
                this.enableGlow = true;
                this.lowPower = false;
                this.resolutionScale = 1;

                // Sprint Blur Props
                this._speedBlurAmt = 0;
                this._speedBlurDirX = 1;
                this._speedBlurBuf = null;

                // Caches
                this._tileBuckets = null;
                this._texArr = null;

                this.resize();
                this._resizeRAF = 0;
                this._resizeRafCb = this._resizeRafCb || (() => {
                    this._resizeRAF = 0;
                    this.resize();
                });
                this._onResize = this._onResize || (() => {
                    if (this._resizeRAF) return;
                    this._resizeRAF = requestAnimationFrame(this._resizeRafCb);
                });
                window.addEventListener('resize', this._onResize, { passive: true });
                window.addEventListener('orientationchange', this._onResize, { passive: true });
            }

            resize() {
                const gs = (window.GAME_SETTINGS || {});
                const effCap = (gs && typeof gs.__dprCapEffective === 'number') ? gs.__dprCapEffective : null;
                const dprCap = (effCap && effCap > 0) ? effCap : ((gs && gs.dprCap) ? gs.dprCap : 2);

                // 基础 DPR（用户上限 + 设备 DPR）
                const baseDpr = Math.min(window.devicePixelRatio || 1, dprCap);

                // 动态分辨率：通过 resolutionScale 调节负载，但要避免“半像素/非整数像素映射”造成的 tile 缝闪烁
                const scale = (typeof this.resolutionScale === 'number' && isFinite(this.resolutionScale)) ? this.resolutionScale : 1;

                // 目标 DPR（先算，再做量化）
                let desiredDpr = Math.max(0.5, Math.min(3, baseDpr * scale));

                // 关键修复：把 DPR 量化到 0.25 步进（16px tile * 0.25 = 4px，能显著降低 tile 边缘采样/拼缝闪动）
                const DPR_STEP = 0.25;
                desiredDpr = Math.round(desiredDpr / DPR_STEP) * DPR_STEP;
                desiredDpr = Math.max(0.5, Math.min(3, desiredDpr));

                const wCss = window.innerWidth;
                const hCss = window.innerHeight;

                // 关键修复：先按宽度取整得到像素尺寸，再反算“真实 DPR”，并用同一个 DPR 推导高度
                // 这样 setTransform 与 canvas 实际像素比例严格一致，避免每次 resize 的四舍五入误差引起的网格线闪动
                const wPx = Math.max(1, Math.round(wCss * desiredDpr));
                const dprActual = wPx / Math.max(1, wCss);
                const hPx = Math.max(1, Math.round(hCss * dprActual));

                // 史诗级优化：避免重复 resize 触发导致的 canvas 反复重分配（极容易引发卡顿/闪黑）
                if (this.canvas.width === wPx && this.canvas.height === hPx && this.w === wCss && this.h === hCss && Math.abs((this.dpr || 0) - dprActual) < 1e-6) {
                    return;
                }

                this.dpr = dprActual;

                // 画布内部像素缩放（动态分辨率）：不影响 UI 布局，只影响渲染负载
                this.canvas.width = wPx;
                this.canvas.height = hPx;
                this.canvas.style.width = wCss + 'px';
                this.canvas.style.height = hCss + 'px';

                // PostFX 缓冲区尺寸跟随主画布（像素级）
                if (this._pp && this._pp.canvas) {
                    this._pp.canvas.width = this.canvas.width;
                    this._pp.canvas.height = this.canvas.height;
                    // 噪点纹理固定较小尺寸，按需重建
                    const n = this._pp.noise;
                    const nSize = 256;
                    if (n.width !== nSize || n.height !== nSize) {
                        n.width = nSize; n.height = nSize;
                        this._pp.seed = 0;
                    }
                }

                // 用真实 DPR 做变换（与实际像素尺寸一致）
                this.ctx.setTransform(dprActual, 0, 0, dprActual, 0, 0);
                this.ctx.imageSmoothingEnabled = false;

                // w/h 仍以 CSS 像素作为世界视窗单位
                this.w = wCss;
                this.h = hCss;
            }

            setResolutionScale(scale01) {
                const s = Math.max(0.5, Math.min(1, Number(scale01) || 1));
                if (Math.abs((this.resolutionScale || 1) - s) < 0.001) return;
                this.resolutionScale = s;
                this.resize();
            }

            clear() {
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, this.w, this.h);
            }

            renderSky(cam, time) {
                const ctx = this.ctx;
                // Ultra Visual FX v3 Sky Logic
                const kfs = this._skyKeyframes || (this._skyKeyframes = [
                    { t: 0.00, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 0.22, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 0.30, c: ['#1a1a2e', '#4a1942', '#ff6b6b'] },
                    { t: 0.36, c: ['#74b9ff', '#81ecec', '#dfe6e9'] },
                    { t: 0.64, c: ['#74b9ff', '#81ecec', '#dfe6e9'] },
                    { t: 0.72, c: ['#6c5ce7', '#fd79a8', '#ffeaa7'] },
                    { t: 0.78, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 1.00, c: ['#0c0c1e', '#1a1a2e', '#16213e'] }
                ]);

                let i = 0;
                while (i < kfs.length - 2 && time >= kfs[i + 1].t) i++;
                const k0 = kfs[i], k1 = kfs[i + 1];
                const u = (k1.t === k0.t) ? 0 : Math.max(0, Math.min(1, (time - k0.t) / (k1.t - k0.t)));
                const eased = u * u * (3 - 2 * u); // smoothstep
                const colors = k0.c.map((c, idx) => Utils.lerpColor(c, k1.c[idx], eased));

                const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.75);
                grad.addColorStop(0, colors[0]);
                grad.addColorStop(0.5, colors[1]);
                grad.addColorStop(1, colors[2]);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, this.w, this.h);

                const night = Utils.nightFactor(time);
                // Stars
                if (night > 0.01) {
                    ctx.globalAlpha = night * 0.85;
                    if (!this._starCanvas) {
                        this._starCanvas = document.createElement('canvas');
                        this._starCanvas.width = this.w;
                        this._starCanvas.height = this.h * 0.6;
                        const sctx = this._starCanvas.getContext('2d');
                        for (let j = 0; j < 120; j++) {
                            const sx = Math.random() * this.w;
                            const sy = Math.random() * this.h * 0.5;
                            const size = Math.random() * 1.5 + 0.5;
                            sctx.fillStyle = '#fff';
                            sctx.beginPath();
                            sctx.arc(sx, sy, size, 0, Math.PI * 2);
                            sctx.fill();
                        }
                    }
                    if (this._starCanvas.width !== this.w) { this._starCanvas = null; } // dumb resize check
                    else ctx.drawImage(this._starCanvas, 0, 0);
                    ctx.globalAlpha = 1;
                }

                // Sun/Moon
                const cx = this.w * ((time + 0.25) % 1);
                const cy = this.h * 0.15 + Math.sin(((time + 0.25) % 1) * Math.PI) * (-this.h * 0.1);

                if (time > 0.2 && time < 0.8) {
                    // Sun
                    const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
                    sunGlow.addColorStop(0, 'rgba(255, 255, 220, 0.9)');
                    sunGlow.addColorStop(0.3, 'rgba(255, 240, 150, 0.4)');
                    sunGlow.addColorStop(1, 'rgba(255, 200, 50, 0)');
                    ctx.fillStyle = sunGlow;
                    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
                } else {
                    // Moon
                    ctx.fillStyle = '#f0f0f5';
                    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#d0d0d8';
                    ctx.beginPath(); ctx.arc(cx - 6, cy - 4, 5, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(cx + 8, cy + 6, 4, 0, Math.PI * 2); ctx.fill();
                }

                // --- TU Mount Fix Logic (DISABLED) ---
                // Mountains are now drawn from a single authoritative call site in
                // Game.prototype.render (see "Mountain Rendering Patch v2" below).
                // Drawing them inside renderSky caused double-draws, cache
                // interference, and desync with the sky/lighting system.
            }

            renderParallax(cam, time = 0.5) {
                renderParallaxMountains(this, cam, time);
            }

            renderWorld(world, cam, time) {
                if (!world || !world.tiles || !world.light) return;

                const ctx = this.ctx;
                const ts = CONFIG.TILE_SIZE;
                const startX = Math.max(0, ((cam.x / ts) | 0) - 1);
                const startY = Math.max(0, ((cam.y / ts) | 0) - 1);
                const endX = Math.min(world.w - 1, startX + ((this.w / ts) | 0) + 3);
                const endY = Math.min(world.h - 1, startY + ((this.h / ts) | 0) + 3);
                const camCeilX = Math.ceil(cam.x);
                const camCeilY = Math.ceil(cam.y);
                const lut = window.BLOCK_LIGHT_LUT;
                if (!lut) return;

                // Prepare Bucket
                const bucket = this._getBucketState();
                bucket.reset();
                const texArr = this._ensureTexArray();

                const tiles = world.tiles;
                const light = world.light;
                const BL = window.BLOCK_LIGHT;
                const AIR = (window.BLOCK && window.BLOCK.AIR) || 0;

                // Fill buckets
                // Check for flatified world (optimization)
                if (world.tilesFlat && world.lightFlat && world.tilesFlat.length === world.w * world.h) {
                    const H = world.h | 0;
                    const tf = world.tilesFlat;
                    const lf = world.lightFlat;
                    for (let x = startX; x <= endX; x++) {
                        const base = x * H;
                        for (let y = startY; y <= endY; y++) {
                            const idx = base + y;
                            const block = tf[idx] | 0;
                            if (block === AIR) continue;

                            const px = x * ts - camCeilX;
                            const py = y * ts - camCeilY;
                            const pp = ((px & 0xffff) << 16) | (py & 0xffff);

                            const bl = BL[block] | 0;
                            if (bl > 5) {
                                if (bucket.glowLists[block].length === 0) bucket.glowKeys.push(block);
                                bucket.glowLists[block].push(pp);
                            }

                            const lv = lf[idx] & 255;
                            const a = lut[lv];
                            if (a) {
                                if (bucket.darkLists[lv].length === 0) bucket.darkKeys.push(lv);
                                bucket.darkLists[lv].push(pp);
                            }
                        }
                    }
                } else {
                    // Legacy array of arrays
                    for (let x = startX; x <= endX; x++) {
                        const colT = tiles[x];
                        const colL = light[x];
                        for (let y = startY; y <= endY; y++) {
                            const block = colT[y] | 0;
                            if (block === AIR) continue;

                            const px = x * ts - camCeilX;
                            const py = y * ts - camCeilY;
                            const pp = ((px & 0xffff) << 16) | (py & 0xffff);

                            const bl = BL[block] | 0;
                            if (bl > 5) {
                                if (bucket.glowLists[block].length === 0) bucket.glowKeys.push(block);
                                bucket.glowLists[block].push(pp);
                            }
                            const lv = colL[y] & 255;
                            const a = lut[lv];
                            if (a) {
                                if (bucket.darkLists[lv].length === 0) bucket.darkKeys.push(lv);
                                bucket.darkLists[lv].push(pp);
                            }
                        }
                    }
                }

                // Render Glow Tiles
                if (this.enableGlow) {
                    ctx.shadowBlur = 0; // optimized handling inside loop? no, batch shadow change
                    // Group by block to share shadow color
                    for (let i = 0; i < bucket.glowKeys.length; i++) {
                        const bid = bucket.glowKeys[i];
                        const list = bucket.glowLists[bid];
                        const tex = texArr ? texArr[bid] : this.textures.get(bid);
                        if (!tex) continue;

                        const color = BLOCK_COLOR[bid] || '#fff';
                        const bl = BL[bid];
                        ctx.shadowColor = color;
                        ctx.shadowBlur = bl * 2;

                        for (let j = 0; j < list.length; j++) {
                            const p = list[j];
                            ctx.drawImage(tex, (p >> 16) & 0xffff, p & 0xffff);
                        }
                    }
                    ctx.shadowBlur = 0;
                } else {
                    // No glow, just draw
                    for (let i = 0; i < bucket.glowKeys.length; i++) {
                        const bid = bucket.glowKeys[i];
                        const list = bucket.glowLists[bid];
                        const tex = texArr ? texArr[bid] : this.textures.get(bid);
                        if (!tex) continue;
                        for (let j = 0; j < list.length; j++) {
                            const p = list[j];
                            ctx.drawImage(tex, (p >> 16) & 0xffff, p & 0xffff);
                        }
                    }
                }

                // Render Dark Mask
                ctx.fillStyle = '#000';
                bucket.darkKeys.sort((a, b) => a - b);
                for (let i = 0; i < bucket.darkKeys.length; i++) {
                    const lv = bucket.darkKeys[i];
                    const list = bucket.darkLists[lv];
                    ctx.globalAlpha = lut[lv];
                    ctx.beginPath();
                    for (let j = 0; j < list.length; j++) {
                        const p = list[j];
                        ctx.rect((p >> 16) & 0xffff, p & 0xffff, ts, ts);
                    }
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }

            renderHighlight(tx, ty, cam, inRange) {
                const ctx = this.ctx;
                const ts = CONFIG.TILE_SIZE;
                const sx = tx * ts - Math.ceil(cam.x);
                const sy = ty * ts - Math.ceil(cam.y);

                if (inRange) {
                    // 发光选框
                    ctx.shadowColor = '#ffeaa7';
                    ctx.shadowBlur = 15;
                    ctx.strokeStyle = 'rgba(255, 234, 167, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(sx, sy, ts, ts);
                    ctx.shadowBlur = 0;

                    ctx.fillStyle = 'rgba(255, 234, 167, 0.15)';
                    ctx.fillRect(sx, sy, ts, ts);
                } else {
                    ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(sx, sy, ts, ts);
                }
            }

            // Unified Post Process (incorporating Sprint Blur and Ultra Visuals)
            applyPostFX(time, depth01, reducedMotion) {
                // 1. Sprint Blur (Speed Lines)
                const amtRaw = (typeof this._speedBlurAmt === 'number') ? this._speedBlurAmt : 0;
                const amt = Math.max(0, Math.min(1, amtRaw));

                if (!reducedMotion && amt > 0.04) {
                    try {
                        const canvas = this.canvas;
                        const wPx = canvas.width | 0;
                        const hPx = canvas.height | 0;

                        let buf = this._speedBlurBuf;
                        if (!buf) {
                            const c = document.createElement('canvas');
                            const ctx = c.getContext('2d', { alpha: false });
                            buf = this._speedBlurBuf = { c, ctx };
                        }
                        if (buf.c.width !== wPx || buf.c.height !== hPx) {
                            buf.c.width = wPx;
                            buf.c.height = hPx;
                        }

                        const bctx = buf.ctx;
                        bctx.setTransform(1, 0, 0, 1, 0, 0);
                        bctx.globalCompositeOperation = 'copy';
                        bctx.globalAlpha = 1;

                        // Directional blur simulation
                        const blurPx = Math.min(2.6, 0.7 + amt * 1.4);
                        bctx.filter = `blur(${blurPx.toFixed(2)}px)`;
                        bctx.drawImage(canvas, 0, 0);
                        bctx.filter = 'none';

                        const ctx = this.ctx;
                        ctx.save();
                        ctx.setTransform(1, 0, 0, 1, 0, 0);

                        const dir = (this._speedBlurDirX === -1) ? -1 : 1;
                        const off = (-dir) * Math.min(18, (4 + amt * 11));

                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = Math.min(0.22, 0.06 + amt * 0.14);
                        ctx.drawImage(buf.c, off, 0);

                        ctx.globalAlpha = Math.min(0.18, 0.04 + amt * 0.10);
                        ctx.drawImage(buf.c, off * 0.5, 0);
                        ctx.restore();
                    } catch (_) { }
                }

                // 2. Ultra Visual FX Logic
                const gs = (window.GAME_SETTINGS || {});
                let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                if (!Number.isFinite(mode)) mode = 2;
                if (mode <= 0) return;
                if (this.lowPower && mode > 1) mode = 1;

                const ctx = this.ctx;
                const canvas = this.canvas;
                const dpr = this.dpr || 1;
                const wPx = canvas.width;
                const hPx = canvas.height;

                const night = Utils.nightFactor(time);
                const dusk = Math.max(0, 1 - Math.abs(time - 0.72) / 0.08);
                const dawn = Math.max(0, 1 - Math.abs(time - 0.34) / 0.08);
                const warm = Utils.clamp(dawn * 0.9 + dusk * 1.1, 0, 1);
                const cool = Utils.clamp(night * 0.9, 0, 1);

                const d = Utils.clamp(depth01 || 0, 0, 1);
                const underground = Utils.smoothstep(0.22, 0.62, d);

                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);

                // A) Mode 2: Bloom
                if (mode >= 2) {
                    const pp = this._pp;
                    if (pp && pp.canvas && pp.ctx) {
                        const bctx = pp.ctx;
                        bctx.setTransform(1, 0, 0, 1, 0, 0);
                        bctx.globalCompositeOperation = 'copy';
                        bctx.filter = 'none';
                        bctx.globalAlpha = 1;
                        bctx.drawImage(canvas, 0, 0);

                        // Grading
                        const contrast = 1.05 + warm * 0.03 + night * 0.06 + underground * 0.03;
                        const saturate = 1.07 + warm * 0.05 + cool * 0.03 - underground * 0.05;
                        const brightness = 1.01 + warm * 0.015 - cool * 0.008 - underground * 0.015;

                        ctx.globalCompositeOperation = 'copy';
                        ctx.filter = `contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) brightness(${brightness.toFixed(3)})`;
                        ctx.drawImage(pp.canvas, 0, 0);
                        ctx.filter = 'none';

                        // Bloom
                        // (simplified for conciseness, assuming similar logic to v3)
                        const bloomBase = 0.33 + night * 0.10 + underground * 0.06;
                        const blur1 = Math.max(1, Math.round(2.5 * dpr));

                        ctx.globalCompositeOperation = 'screen';
                        ctx.filter = `blur(${blur1}px) brightness(1.2)`;
                        ctx.globalAlpha = bloomBase;
                        ctx.drawImage(pp.canvas, 0, 0);

                        ctx.filter = 'none';
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = 1;
                    }
                }

                // B) Fog, Vignette, Grain (simplified)
                const fogAmt = Utils.smoothstep(0.18, 0.62, d) * (0.60 + night * 0.25);
                if (fogAmt > 0) {
                    const fog = ctx.createLinearGradient(0, hPx * 0.4, 0, hPx);
                    fog.addColorStop(0, 'rgba(30,20,50,0)');
                    fog.addColorStop(1, `rgba(30,20,50,${(0.25 * fogAmt).toFixed(2)})`);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = fog;
                    ctx.fillRect(0, 0, wPx, hPx);
                }

                const vig = (0.2 + night * 0.2) * (mode === 1 ? 0.9 : 1);
                if (vig > 0.01) {
                    // simplified vignette
                    const vg = ctx.createRadialGradient(wPx / 2, hPx / 2, wPx * 0.3, wPx / 2, hPx / 2, wPx * 0.8);
                    vg.addColorStop(0, 'rgba(0,0,0,0)');
                    vg.addColorStop(1, `rgba(0,0,0,${vig.toFixed(2)})`);
                    ctx.fillStyle = vg;
                    ctx.fillRect(0, 0, wPx, hPx);
                }

                ctx.restore();
            }

            postProcess(time = 0.5) {
                this.applyPostFX(time, 0, false);
            }

            // --- Helper Methods (Consolidated from patches) ---

            renderBackgroundCached(cam, time, drawParallax = true) {
                // ── Mountain Rendering Patch v2 ──
                // This method now ONLY caches the sky gradient + celestial bodies.
                // Mountains are drawn exclusively by Game.prototype.render after
                // this method returns, eliminating double-draw and cache-desync bugs.
                this._ensureBgCache();
                const bg = this._bgCache;
                if (!bg || !bg.canvas || !bg.ctx) {
                    this.renderSky(cam, time);
                    // Mountains intentionally NOT drawn here; Game.render handles them.
                    return;
                }

                this._resizeBgCache();

                const now = performance.now();
                const dt = now - (bg.lastAt || 0);
                const refreshInterval = this.lowPower ? 4600 : 750;
                const t = (typeof time === 'number' && isFinite(time)) ? time : (bg.lastTime || 0);

                // Check triggers
                const bucket = this._getSkyBucket(t);
                const bucketChanged = (bucket !== bg.lastBucket);
                const skyKey = this._getSkyKey(t, bucket);
                const skyKeyChanged = (skyKey != null && skyKey !== bg.lastSkyKey);
                const timeChanged = Math.abs(t - (bg.lastTime || 0)) > (this.lowPower ? 0.018 : 0.01);
                const needUpdate = !!bg.dirty || bucketChanged || skyKeyChanged || (dt >= refreshInterval && timeChanged);

                if (needUpdate) {
                    bg.dirty = false;
                    bg.lastAt = now;
                    bg.lastTime = t;
                    bg.lastBucket = bucket;
                    bg.lastSkyKey = skyKey;

                    const origCtx = this.ctx;
                    this.ctx = bg.ctx;
                    this._bgCacheDrawing = true;
                    try {
                        bg.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
                        bg.ctx.imageSmoothingEnabled = false;
                        bg.ctx.clearRect(0, 0, this.w, this.h);
                        this.renderSky(cam, t); // Only sky, not parallax
                    } finally {
                        this._bgCacheDrawing = false;
                        this.ctx = origCtx;
                    }
                }

                this.ctx.drawImage(bg.canvas, 0, 0, this.w, this.h);
                // Mountains intentionally NOT drawn here; Game.render handles them.
            }

            _ensureBgCache() {
                if (this._bgCache) return;
                const c = document.createElement('canvas');
                c.width = this.canvas.width;
                c.height = this.canvas.height;
                this._bgCache = {
                    canvas: c,
                    ctx: c.getContext('2d', { alpha: false }),
                    wPx: c.width,
                    hPx: c.height,
                    dirty: true
                };
            }

            _resizeBgCache() {
                const bg = this._bgCache;
                if (!bg) return;
                const w = this.canvas.width;
                const h = this.canvas.height;
                if (bg.wPx !== w || bg.hPx !== h) {
                    bg.canvas.width = w;
                    bg.canvas.height = h;
                    bg.wPx = w;
                    bg.hPx = h;
                    bg.dirty = true;
                }
            }

            _getSkyBucket(t) {
                // Simple bucket to avoid thrashing
                return (t * 100) | 0;
            }

            _getSkyKey(t, bucket) {
                // Simplified signature for sky color
                return bucket;
            }

            _ensureTexArray() {
                if (!this.textures || typeof this.textures.get !== 'function') return null;
                if (this._texArr && this._texArrMap === this.textures) return this._texArr;
                this._texArr = new Array(256).fill(null);
                try { this.textures.forEach((v, k) => { this._texArr[k & 255] = v; }); } catch (_) { }
                this._texArrMap = this.textures;
                return this._texArr;
            }

            _getBucketState() {
                if (this._tileBuckets) return this._tileBuckets;
                this._tileBuckets = {
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
                for (let i = 0; i < 256; i++) {
                    this._tileBuckets.glowLists[i] = [];
                    this._tileBuckets.darkLists[i] = [];
                }
                return this._tileBuckets;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                   配方数据
        // ═══════════════════════════════════════════════════════════════════════════════
        const RECIPES = [
            { out: BLOCK.PLANKS, count: 4, req: [{ id: BLOCK.LOG, count: 1 }], desc: "基础建筑材料，由原木加工而成。" },
            { out: BLOCK.TORCH, count: 4, req: [{ id: BLOCK.WOOD, count: 1 }], desc: "照亮黑暗的必需品。" },
            { out: BLOCK.BRICK, count: 4, req: [{ id: BLOCK.CLAY, count: 2 }], desc: "坚固的红色砖块。" },
            { out: BLOCK.GLASS, count: 2, req: [{ id: BLOCK.SAND, count: 2 }], desc: "透明的装饰方块。" },
            { out: BLOCK.TREASURE_CHEST, count: 1, req: [{ id: BLOCK.WOOD, count: 8 }], desc: "用于储存物品的箱子。" },
            { out: BLOCK.LANTERN, count: 1, req: [{ id: BLOCK.TORCH, count: 1 }, { id: BLOCK.IRON_ORE, count: 1 }], desc: "比火把更优雅的照明工具。" },
            { out: BLOCK.FROZEN_STONE, count: 4, req: [{ id: BLOCK.ICE, count: 2 }, { id: BLOCK.STONE, count: 2 }], desc: "寒冷的建筑石材。" },
            { out: BLOCK.GLOWSTONE, count: 1, req: [{ id: BLOCK.GLASS, count: 1 }, { id: BLOCK.TORCH, count: 2 }], desc: "人造发光石块。" },
            { out: BLOCK.METEORITE_BRICK, count: 4, req: [{ id: BLOCK.METEORITE, count: 1 }, { id: BLOCK.STONE, count: 1 }], desc: "来自外太空的建筑材料。" },
            { out: BLOCK.RAINBOW_BRICK, count: 10, req: [{ id: BLOCK.CRYSTAL, count: 1 }, { id: BLOCK.BRICK, count: 10 }], desc: "散发着彩虹光芒的砖块。" },
            { out: BLOCK.PARTY_BLOCK, count: 5, req: [{ id: BLOCK.PINK_FLOWER, count: 1 }, { id: BLOCK.DIRT, count: 5 }], desc: "让每一天都变成派对！" },
            { out: BLOCK.WOOD, count: 1, req: [{ id: BLOCK.PLANKS, count: 2 }], desc: "将木板还原为木材。" },
            { out: BLOCK.BONE, count: 2, req: [{ id: BLOCK.STONE, count: 1 }], desc: "由石头雕刻而成的骨头形状。" },
            { out: BLOCK.HAY, count: 4, req: [{ id: BLOCK.TALL_GRASS, count: 8 }], desc: "干草堆，适合建造农场。" }
        ];

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                  合成系统

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { Renderer });

    </script>

    <!-- ========================= SECTION: Core Systems ========================= -->

// ─── Merged Renderer Patches (experience_optimized_v2) ───
// Patches: resize, _ensureStars, _getSkyBucket, _ensureSkyGradient,
// renderSky, renderParallax, renderWorld, _ensureGrain, applyPostFX
if (typeof Renderer !== 'undefined' && Renderer.prototype) {
                                                if (Renderer && Renderer.prototype) {
                                                    const origResize = Renderer.prototype.resize;
                                                    Renderer.prototype.resize = function () {
                                                        origResize.call(this);
                                                        // 尺寸变化时清空缓存
                                                        this._skyGrad = null;
                                                        this._skyBucket = -1;
                                                        this._skyGradH = 0;

                                                        this._stars = null;
                                                        this._starsW = 0;
                                                        this._starsH = 0;
                                                        this._starsCount = 0;

                                                        this._parallaxGrad = null;
                                                        this._parallaxGradH = 0;
                                                    };

                                                    Renderer.prototype._ensureStars = function () {
                                                        const want = (this.lowPower ? 40 : 80);
                                                        if (this._stars && this._starsCount === want && this._starsW === this.w && this._starsH === this.h) return;

                                                        const stars = new Array(want);
                                                        const w = Math.max(1, this.w);
                                                        const h = Math.max(1, this.h * 0.5);

                                                        // 保持“看起来随机但稳定”的分布：沿用原有的取模方案
                                                        for (let i = 0; i < want; i++) {
                                                            const sx = (12345 * i * 17) % w;
                                                            const sy = (12345 * i * 31) % h;
                                                            const size = (i % 3) + 1;
                                                            const phase = i * 1.73;
                                                            const baseA = 0.55 + (i % 7) * 0.05; // 0.55~0.85
                                                            stars[i] = { x: sx, y: sy, s: size, p: phase, a: baseA };
                                                        }

                                                        this._stars = stars;
                                                        this._starsW = this.w;
                                                        this._starsH = this.h;
                                                        this._starsCount = want;
                                                    };

                                                    Renderer.prototype._getSkyBucket = function (time) {
                                                        if (time < 0.2) return 0;      // night
                                                        if (time < 0.3) return 1;      // dawn
                                                        if (time < 0.7) return 2;      // day
                                                        if (time < 0.8) return 3;      // dusk
                                                        return 0;                      // night
                                                    };

                                                    Renderer.prototype._ensureSkyGradient = function (bucket) {
                                                        if (this._skyGrad && this._skyBucket === bucket && this._skyGradH === this.h) return;

                                                        const ctx = this.ctx;
                                                        let colors;
                                                        if (bucket === 0) colors = ['#0c0c1e', '#1a1a2e', '#16213e'];
                                                        else if (bucket === 1) colors = ['#1a1a2e', '#4a1942', '#ff6b6b'];
                                                        else if (bucket === 2) colors = ['#74b9ff', '#81ecec', '#dfe6e9'];
                                                        else colors = ['#6c5ce7', '#fd79a8', '#ffeaa7'];

                                                        const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.7);
                                                        grad.addColorStop(0, colors[0]);
                                                        grad.addColorStop(0.5, colors[1]);
                                                        grad.addColorStop(1, colors[2]);

                                                        this._skyGrad = grad;
                                                        this._skyBucket = bucket;
                                                        this._skyGradH = this.h;
                                                    };

                                                    // 覆写天空渲染：同视觉，少分配/少字符串/少 arc
                                                    Renderer.prototype.renderSky = function (cam, time) {
                                                        const ctx = this.ctx;

                                                        // —— 平滑天空过渡：在关键时间点附近，用两套渐变叠加做 smoothstep 淡入淡出 ——
                                                        const transitions = this._skyTransitions || (this._skyTransitions = [
                                                            { at: 0.2, from: 0, to: 1, w: 0.04 }, // night -> dawn
                                                            { at: 0.3, from: 1, to: 2, w: 0.04 }, // dawn -> day
                                                            { at: 0.7, from: 2, to: 3, w: 0.04 }, // day -> dusk
                                                            { at: 0.8, from: 3, to: 0, w: 0.04 }  // dusk -> night
                                                        ]);

                                                        let bucketA = this._getSkyBucket(time);
                                                        let bucketB = bucketA;
                                                        let blend = 0;

                                                        for (let i = 0; i < transitions.length; i++) {
                                                            const tr = transitions[i];
                                                            const a = tr.at - tr.w, b = tr.at + tr.w;
                                                            if (time >= a && time <= b) {
                                                                bucketA = tr.from;
                                                                bucketB = tr.to;
                                                                blend = Utils.smoothstep(a, b, time);
                                                                break;
                                                            }
                                                        }

                                                        // 底层渐变
                                                        this._ensureSkyGradient(bucketA);
                                                        const gradA = this._skyGrad;
                                                        ctx.fillStyle = gradA;
                                                        ctx.fillRect(0, 0, this.w, this.h);

                                                        // 叠加渐变（仅在过渡期）
                                                        if (blend > 0.001 && bucketB !== bucketA) {
                                                            this._ensureSkyGradient(bucketB);
                                                            const gradB = this._skyGrad;
                                                            ctx.save();
                                                            ctx.globalAlpha = blend;
                                                            ctx.fillStyle = gradB;
                                                            ctx.fillRect(0, 0, this.w, this.h);
                                                            ctx.restore();
                                                        }

                                                        const night = Utils.nightFactor(time);

                                                        // 星星：夜晚按 nightFactor 平滑淡入淡出（避免“瞬间出现/消失”）
                                                        if (night > 0.01) {
                                                            const baseAlpha = night * 0.8;
                                                            this._ensureStars();
                                                            const stars = this._stars;
                                                            const now = Date.now() * 0.003;

                                                            ctx.save();
                                                            for (let i = 0; i < stars.length; i++) {
                                                                const s = stars[i];
                                                                const twinkle = Math.sin(now + i) * 0.3 + 0.7;
                                                                ctx.globalAlpha = baseAlpha * twinkle;
                                                                ctx.fillStyle = '#fff';
                                                                // fillRect 比 arc 省
                                                                ctx.fillRect(s.x, s.y, s.size, s.size);
                                                            }
                                                            ctx.restore();
                                                        }

                                                        // 太阳/月亮：使用透明度做平滑交接
                                                        const cx = this.w * ((time + 0.25) % 1);
                                                        const cy = 80 + Math.sin(((time + 0.25) % 1) * Math.PI) * -60;

                                                        const sunAlpha = Utils.smoothstep(0.18, 0.26, time) * (1 - Utils.smoothstep(0.74, 0.82, time));
                                                        const moonAlpha = night;

                                                        if (sunAlpha > 0.001) {
                                                            ctx.save();
                                                            ctx.globalAlpha = sunAlpha;

                                                            const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
                                                            sunGlow.addColorStop(0, 'rgba(255, 255, 200, 1)');
                                                            sunGlow.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
                                                            sunGlow.addColorStop(0.5, 'rgba(255, 180, 50, 0.3)');
                                                            sunGlow.addColorStop(1, 'rgba(255, 150, 0, 0)');
                                                            ctx.fillStyle = sunGlow;
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 60, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = '#FFF';
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 25, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.restore();
                                                        }

                                                        if (moonAlpha > 0.001) {
                                                            ctx.save();
                                                            ctx.globalAlpha = moonAlpha;

                                                            const moonGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
                                                            moonGlow.addColorStop(0, 'rgba(230, 230, 255, 1)');
                                                            moonGlow.addColorStop(0.5, 'rgba(200, 200, 255, 0.3)');
                                                            moonGlow.addColorStop(1, 'rgba(150, 150, 255, 0)');
                                                            ctx.fillStyle = moonGlow;
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 40, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = '#E8E8F0';
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 18, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = 'rgba(200, 200, 210, 0.5)';
                                                            ctx.beginPath();
                                                            ctx.arc(cx - 5, cy - 3, 4, 0, Math.PI * 2);
                                                            ctx.arc(cx + 6, cy + 5, 3, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.restore();
                                                        }
                                                    };

                                                    // 覆写视差：低功耗时减少采样点/层数（更省）
                                                    Renderer.prototype.renderParallax = function (cam, time) {
                                                        renderParallaxMountains(this, cam, time);
                                                    };

                                                    // 覆写世界渲染：暗角 LUT 只在 levels 变化时构建（每帧少 256 次循环）
                                                    const buildDarkLUT = (levels, nightBonus) => {
                                                        const lut = new Float32Array(256);
                                                        for (let i = 0; i < 256; i++) {
                                                            const darkness = 1 - (i / levels);
                                                            let totalDark = darkness * 0.6 + nightBonus;
                                                            if (totalDark > 0.88) totalDark = 0.88;
                                                            lut[i] = (totalDark > 0.05) ? totalDark : 0;
                                                        }
                                                        return lut;
                                                    };

                                                    Renderer.prototype.renderWorld = function (world, cam, time) {
                                                        const ctx = this.ctx;
                                                        const ts = CONFIG.TILE_SIZE;

                                                        let startX = Math.floor(cam.x / ts) - 1;
                                                        let startY = Math.floor(cam.y / ts) - 1;
                                                        let endX = startX + Math.ceil(this.w / ts) + 2;
                                                        let endY = startY + Math.ceil(this.h / ts) + 2;

                                                        if (startX < 0) startX = 0;
                                                        if (startY < 0) startY = 0;
                                                        if (endX >= world.w) endX = world.w - 1;
                                                        if (endY >= world.h) endY = world.h - 1;

                                                        const tiles = world.tiles;
                                                        const light = world.light;

                                                        const camCeilX = Math.ceil(cam.x);
                                                        const camCeilY = Math.ceil(cam.y);

                                                        const night = Utils.nightFactor(time);
                                                        const qNight = Math.round(night * 100) / 100;
                                                        const levels = CONFIG.LIGHT_LEVELS;

                                                        if (!this._darkAlphaLUTDay || this._darkAlphaLUTLevels !== levels) {
                                                            this._darkAlphaLUTLevels = levels;
                                                            this._darkAlphaLUTDay = buildDarkLUT(levels, 0);
                                                            this._darkAlphaLUTNight = buildDarkLUT(levels, 0.2);
                                                        }
                                                        let lut = this._darkAlphaLUTBlend;
                                                        if (!lut || this._darkAlphaLUTBlendNight !== qNight || this._darkAlphaLUTBlendLevels !== levels) {
                                                            lut = this._darkAlphaLUTBlend || (this._darkAlphaLUTBlend = new Float32Array(256));
                                                            for (let i = 0; i < 256; i++) {
                                                                lut[i] = this._darkAlphaLUTDay[i] + (this._darkAlphaLUTNight[i] - this._darkAlphaLUTDay[i]) * qNight;
                                                            }
                                                            this._darkAlphaLUTBlendNight = qNight;
                                                            this._darkAlphaLUTBlendLevels = levels;
                                                        }

                                                        ctx.globalAlpha = 1;
                                                        ctx.fillStyle = 'rgb(10,5,20)';

                                                        for (let x = startX; x <= endX; x++) {
                                                            const colTiles = tiles[x];
                                                            const colLight = light[x];
                                                            for (let y = startY; y <= endY; y++) {
                                                                const block = colTiles[y];
                                                                if (block === BLOCK.AIR) continue;

                                                                const tex = this.textures.get(block);
                                                                const px = x * ts - camCeilX;
                                                                const py = y * ts - camCeilY;

                                                                const bl = BLOCK_LIGHT[block];
                                                                if (this.enableGlow && bl > 5 && tex) {
                                                                    ctx.save();
                                                                    ctx.shadowColor = BLOCK_COLOR[block];
                                                                    ctx.shadowBlur = bl * 2;
                                                                    ctx.drawImage(tex, px, py);
                                                                    ctx.restore();
                                                                } else if (tex) {
                                                                    ctx.drawImage(tex, px, py);
                                                                }

                                                                const a = lut[colLight[y]];
                                                                if (a) {
                                                                    ctx.globalAlpha = a;
                                                                    ctx.fillRect(px, py, ts, ts);
                                                                    ctx.globalAlpha = 1;
                                                                }
                                                            }
                                                        }

                                                        ctx.globalAlpha = 1;
                                                    };
                                                    // ───────────────────────── PostFX：色彩分级 / 氛围雾化 / 暗角 / 电影颗粒 ─────────────────────────
                                                    // 目标：在不引入昂贵像素级后处理（getImageData）的前提下，显著提升“质感”和层次
                                                    Renderer.prototype._ensureGrain = function () {
                                                        const size = 128; // 小纹理 + repeat，成本低
                                                        if (!this._grainCanvas) {
                                                            this._grainCanvas = document.createElement('canvas');
                                                            this._grainCanvas.width = size;
                                                            this._grainCanvas.height = size;
                                                            this._grainCtx = this._grainCanvas.getContext('2d', { alpha: true });
                                                            this._grainFrame = 0;
                                                            this._grainPattern = null;
                                                        }
                                                        // 每隔若干帧刷新一次噪声，避免每帧随机成本
                                                        const step = this.lowPower ? 18 : 10;
                                                        this._grainFrame = (this._grainFrame || 0) + 1;
                                                        if (!this._grainPattern || (this._grainFrame % step) === 0) {
                                                            const g = this._grainCtx;
                                                            const img = g.createImageData(size, size);
                                                            const d = img.data;
                                                            // LCG 伪随机（比 Math.random 更稳定更快）
                                                            let seed = (this._grainSeed = ((this._grainSeed || 1234567) * 1664525 + 1013904223) >>> 0);
                                                            for (let i = 0; i < d.length; i += 4) {
                                                                seed = (seed * 1664525 + 1013904223) >>> 0;
                                                                const v = (seed >>> 24); // 0..255
                                                                d[i] = v; d[i + 1] = v; d[i + 2] = v;
                                                                // 噪声 alpha：偏低，避免“脏屏”
                                                                d[i + 3] = 24 + (v & 15); // 24..39
                                                            }
                                                            g.putImageData(img, 0, 0);
                                                            this._grainPattern = this.ctx.createPattern(this._grainCanvas, 'repeat');
                                                        }
                                                    };

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        const ctx = this.ctx;
                                                        if (!ctx || reducedMotion) return;
                                                        const w = this.w, h = this.h;
                                                        const lowFx = !!this.lowPower;

                                                        // Precompute vignette once per resize
                                                        if (!this._vignetteFx || this._vignetteFx.w !== w || this._vignetteFx.h !== h) {
                                                            const vc = document.createElement('canvas');
                                                            vc.width = Math.max(1, w);
                                                            vc.height = Math.max(1, h);
                                                            const vctx = vc.getContext('2d', { alpha: true });
                                                            const r = Math.max(w, h) * 0.75;
                                                            const g = vctx.createRadialGradient(w * 0.5, h * 0.5, r * 0.15, w * 0.5, h * 0.5, r);
                                                            g.addColorStop(0, 'rgba(0,0,0,0)');
                                                            g.addColorStop(1, 'rgba(0,0,0,1)');
                                                            vctx.fillStyle = g;
                                                            vctx.fillRect(0, 0, w, h);
                                                            this._vignetteFx = { c: vc, w, h };
                                                        }

                                                        // Ensure grain pattern exists (generated once)
                                                        if (!this._grainPattern && this._ensureGrain) this._ensureGrain();

                                                        const night = Utils.nightFactor(time);
                                                        const dusk = Math.max(0, 1 - Math.abs(time - 0.72) / 0.08);
                                                        const dawn = Math.max(0, 1 - Math.abs(time - 0.34) / 0.08);

                                                        // Cheap “grading” using only a few translucent overlays (no ctx.filter)
                                                        const warmA = Utils.clamp(dawn * 0.22 + dusk * 0.30, 0, 0.35);
                                                        const coolA = Utils.clamp(night * 0.28, 0, 0.35);
                                                        const fogA = Utils.clamp((depth01 * 0.10) + (night * 0.06), 0, 0.20);

                                                        ctx.save();

                                                        if (warmA > 0.001) {
                                                            ctx.globalAlpha = warmA;
                                                            ctx.fillStyle = 'rgba(255,180,90,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }
                                                        if (coolA > 0.001) {
                                                            ctx.globalAlpha = coolA;
                                                            ctx.fillStyle = 'rgba(90,150,255,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }
                                                        if (fogA > 0.001) {
                                                            ctx.globalAlpha = fogA;
                                                            ctx.fillStyle = 'rgba(24,28,36,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        // Vignette
                                                        ctx.globalAlpha = (lowFx ? 0.16 : 0.24) + night * (lowFx ? 0.08 : 0.12);
                                                        ctx.drawImage(this._vignetteFx.c, 0, 0);

                                                        // Subtle grain (skip on low power)
                                                        if (this._grainPattern && !lowFx) {
                                                            ctx.globalAlpha = 0.045;
                                                            ctx.fillStyle = this._grainPattern;
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        ctx.restore();
                                                    };

                                                }
}

window.TU = window.TU || {};
Object.assign(window.TU, { Renderer });
