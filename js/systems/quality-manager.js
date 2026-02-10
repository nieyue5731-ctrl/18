// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Quality Manager + UI Flush Scheduler
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

    <!-- ========================= MODULE: systems/ui_flush ========================= -->
    <script>
        (() => {
            'use strict';
            const TU = (window.TU = window.TU || {});
            if (TU.UIFlushScheduler) return;

            /**
             * UIFlushScheduler
             * - 只收集“DOM 写操作”（最后一次覆盖前面的）
             * - 在游戏 rAF 的统一 flush 阶段执行，避免每帧/每个子步频繁写 DOM
             */
            class UIFlushScheduler {
                constructor() {
                    this._map = new Map();
                    this._order = [];
                    this._flushing = false;
                }

                enqueue(key, fn) {
                    if (!key || typeof fn !== 'function') return;
                    const k = String(key);
                    if (!this._map.has(k)) this._order.push(k);
                    this._map.set(k, fn);
                }

                clear() {
                    this._map.clear();
                    this._order.length = 0;
                }

                flush() {
                    if (this._flushing) return;
                    if (this._order.length === 0) return;

                    this._flushing = true;
                    try {
                        for (let i = 0; i < this._order.length; i++) {
                            const k = this._order[i];
                            const fn = this._map.get(k);
                            if (fn) {
                                try { fn(); } catch (e) { /* 单个 UI 写入失败不影响主循环 */ }
                            }
                        }
                    } finally {
                        this.clear();
                        this._flushing = false;
                    }
                }
            }

            TU.UIFlushScheduler = UIFlushScheduler;
        })();
    </script>

    <!-- ========================= MODULE: systems/quality_manager ========================= -->
    <script>
        (() => {
            'use strict';
            const TU = (window.TU = window.TU || {});
            if (TU.QualityManager) return;

            const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
            const isNum = (v) => (typeof v === 'number' && isFinite(v));

            function defineRuntimeSetting(obj, key, value) {
                if (!obj) return;
                try {
                    const desc = Object.getOwnPropertyDescriptor(obj, key);
                    if (!desc || desc.enumerable) {
                        Object.defineProperty(obj, key, { value, writable: true, configurable: true });
                    } else {
                        obj[key] = value;
                    }
                } catch (_) {
                    try { obj[key] = value; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                }
            }

            function detectDevice() {
                const nav = (typeof navigator !== 'undefined') ? navigator : {};
                const mem = Number(nav.deviceMemory) || 0;
                const cores = Number(nav.hardwareConcurrency) || 0;
                const ua = String(nav.userAgent || '').toLowerCase();

                let mobile = false;
                try {
                    mobile = (typeof Utils !== 'undefined' && Utils.isMobile) ? Utils.isMobile() : /mobi|android|iphone|ipad|ipod/.test(ua);
                } catch (_) {
                    mobile = /mobi|android|iphone|ipad|ipod/.test(ua);
                }

                const dpr = (window.devicePixelRatio || 1);
                const lowMem = mem && mem <= 4;
                const lowCores = cores && cores <= 4;

                // 粗略低端判断：移动端 + (低内存/低核/超高 DPR) 更容易掉帧
                const lowEnd = mobile ? (lowMem || lowCores || dpr >= 2.75) : (lowMem && lowCores);

                return { mobile, mem, cores, dpr, lowEnd };
            }

            class QualityManager {
                constructor(game) {
                    this.game = game;
                    this.device = detectDevice();

                    this.state = {
                        hidden: !!(typeof document !== 'undefined' && document.hidden),
                        fps: 60,
                        level: (game && game._perf && game._perf.level) ? game._perf.level : 'high',
                        reason: 'init',
                    };

                    this.effective = {};
                    this._last = { __dprCapEffective: null };

                    // 初次下发（不依赖后续 patch）
                    this.apply({ force: true, reason: 'init' });
                }

                onVisibilityChange(hidden) {
                    this.state.hidden = !!hidden;
                    this.apply({ force: true, reason: hidden ? 'hidden' : 'visible' });
                }

                onSettingsChanged() {
                    this.apply({ force: true, reason: 'settings' });
                }

                onFpsSample(fps, spanMs = 500) {
                    if (!isNum(fps)) return;

                    const g = this.game;
                    const gs = (g && g.settings) ? g.settings : (window.GAME_SETTINGS || {});
                    const auto = !!(gs && gs.autoQuality);

                    this.state.fps = fps;

                    const p = (g && g._perf) ? g._perf : null;
                    const span = isNum(spanMs) ? spanMs : 500;

                    if (this.state.hidden) {
                        this.apply({ force: false, reason: 'hidden-fps' });
                        return;
                    }

                    if (p) {
                        if (auto) {
                            if (fps < 45) { p.lowForMs = (p.lowForMs || 0) + span; p.highForMs = 0; }
                            else if (fps > 56) { p.highForMs = (p.highForMs || 0) + span; p.lowForMs = 0; }
                            else { p.lowForMs = 0; p.highForMs = 0; }

                            // 低端设备：更积极降级（避免抖动）
                            const wantLow = (p.lowForMs >= 1000) || (this.device.lowEnd && p.lowForMs >= 600);
                            const wantHigh = (p.highForMs >= 1400);

                            if (wantLow && p.level !== 'low') {
                                p.level = 'low';
                                this.state.level = 'low';
                                this.state.reason = 'fps-low';
                                if (typeof g._setQuality === 'function') g._setQuality('low');
                            } else if (wantHigh && p.level !== 'high') {
                                p.level = 'high';
                                this.state.level = 'high';
                                this.state.reason = 'fps-high';
                                if (typeof g._setQuality === 'function') g._setQuality('high');
                            }
                        } else {
                            // 关闭自动画质：保持高画质（尊重用户显式选择）
                            p.lowForMs = 0; p.highForMs = 0;
                            if (p.level !== 'high') {
                                p.level = 'high';
                                this.state.level = 'high';
                                this.state.reason = 'manual';
                                if (typeof g._setQuality === 'function') g._setQuality('high');
                            }
                        }
                    }

                    // 动态分辨率（autoQuality 才启用）
                    this._updateResolutionScale(fps, auto);

                    // 下发其它频率/开关
                    this.apply({ force: false, reason: 'fps' });
                }

                _updateResolutionScale(fps, auto) {
                    const g = this.game;
                    if (!g || !g.renderer || typeof g.renderer.setResolutionScale !== 'function') return;

                    // 内部状态（用于节流与滞回，避免频繁 resize 造成“网格线闪动”）
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    const st = this._dynResState || (this._dynResState = { good: 0, bad: 0, lastChange: 0 });

                    if (!auto) {
                        // 用户手动：还原到 1（避免“我关了自动画质但还是糊”的困惑）
                        st.good = 0; st.bad = 0; st.lastChange = now;
                        if (g.renderer.resolutionScale !== 1) g.renderer.setResolutionScale(1);
                        return;
                    }

                    const level = (g._perf && g._perf.level) ? g._perf.level : this.state.level;
                    const low = (level === 'low');

                    let minScale = low ? 0.75 : 0.82;
                    if (this.device.lowEnd) minScale -= 0.04;
                    minScale = clamp(minScale, 0.6, 1);

                    const t01 = clamp((fps - 28) / (50 - 28), 0, 1);
                    const target = minScale + (1 - minScale) * t01;

                    // 关键修复：量化到固定步进，并增加滞回/节流，避免 500ms 一次的小幅变化触发 resize
                    const STEP = 0.125; // 1/8：配合 DPR_STEP=0.25（当 baseDpr≈2 时），能更稳定地落在 tile 像素网格上
                    const clamp01 = (v) => clamp(v, 0.5, 1);
                    const quant = (v) => clamp01(Math.round(v / STEP) * STEP);

                    const curRaw = isNum(g.renderer.resolutionScale) ? g.renderer.resolutionScale : 1;
                    const cur = quant(curRaw);
                    const want = quant(target);

                    // 已经在同一档：把实际值轻微“吸附”到档位，避免漂移
                    if (Math.abs(want - cur) < (STEP * 0.5)) {
                        st.good = 0; st.bad = 0;
                        if (Math.abs(curRaw - cur) > 0.002) g.renderer.setResolutionScale(cur);
                        return;
                    }

                    const dirDown = (want < cur);

                    // 一次只变动一档，避免突然跳变
                    const next = dirDown ? (cur - STEP) : (cur + STEP);
                    const nextClamped = clamp01(next);

                    if (dirDown) {
                        st.bad += 1; st.good = 0;

                        // 降档要快一点，但也不要抖：至少间隔 350ms
                        if (st.bad >= 1 && (now - st.lastChange) > 350) {
                            g.renderer.setResolutionScale(nextClamped);
                            st.lastChange = now;
                            st.bad = 0;
                        }
                    } else {
                        st.good += 1; st.bad = 0;

                        // 升档更保守：需要连续“好帧”样本，并且更长冷却，防止上下反复
                        if (st.good >= 3 && (now - st.lastChange) > 1600) {
                            g.renderer.setResolutionScale(nextClamped);
                            st.lastChange = now;
                            st.good = 0;
                        }
                    }
                }

                _computeEffective() {
                    const g = this.game;
                    const gs = (g && g.settings) ? g.settings : (window.GAME_SETTINGS || {});
                    const auto = !!gs.autoQuality;
                    const hidden = !!this.state.hidden;
                    const level = (g && g._perf && g._perf.level) ? g._perf.level : this.state.level;

                    // DPR cap：用户值为上限；autoQuality 时再叠加设备/低帧约束
                    const userDpr = isNum(gs.dprCap) ? gs.dprCap : 2;
                    const deviceCap = (this.device.mobile && this.device.lowEnd) ? 1.5 : 2;

                    let dprCap = userDpr;
                    if (hidden) dprCap = 1;
                    else if (auto) {
                        dprCap = Math.min(dprCap, deviceCap);
                        if (level === 'low') dprCap = Math.min(dprCap, this.device.mobile ? 1.25 : 1.5);
                    }

                    // 粒子上限：尊重开关（particles=false => 0）
                    const particlesEnabled = !!gs.particles;
                    let particlesMax = particlesEnabled ? 400 : 0;
                    if (hidden) particlesMax = 0;
                    else if (auto) {
                        if (level === 'low') particlesMax = this.device.lowEnd ? 160 : 220;
                        else if (this.device.lowEnd) particlesMax = 260;
                    }

                    // 小地图刷新频率（重建节流）
                    let minimapIntervalMs = 120;
                    if (hidden) minimapIntervalMs = 400;
                    else if (auto) {
                        if (level === 'low') minimapIntervalMs = this.device.lowEnd ? 220 : 180;
                        else if (this.device.lowEnd) minimapIntervalMs = 150;
                    }

                    // 光照刷新频率（合并节流）
                    let lightIntervalMs = 0;
                    if (hidden) lightIntervalMs = 200;
                    else if (auto) {
                        if (level === 'low') lightIntervalMs = this.device.lowEnd ? 90 : 60;
                        else if (this.device.lowEnd) lightIntervalMs = 30;
                    }

                    // 后期特效：autoQuality/低端机 自动上限
                    const userPostFx = isNum(gs.postFxMode) ? gs.postFxMode : 2;
                    let postFxMode = userPostFx;
                    if (hidden) postFxMode = 0;
                    else if (auto) {
                        if (level === 'low') postFxMode = Math.min(postFxMode, 1);
                        else if (this.device.lowEnd) postFxMode = Math.min(postFxMode, 1);
                    }

                    // 背景山脉：用户开关 + autoQuality 低档/后台临时禁用
                    const userMountains = (gs.bgMountains !== undefined) ? !!gs.bgMountains : true;
                    let bgMountains = userMountains;
                    if (hidden) bgMountains = false;
                    else if (auto && level === 'low') bgMountains = false;

                    // 渲染特效开关：辉光在低档/后台关闭
                    const enableGlow = (!hidden) && (!auto || level !== 'low');
                    const lowPower = hidden || (auto && level === 'low');

                    return {
                        level, hidden,
                        dprCap,
                        particlesMax,
                        minimapIntervalMs,
                        lightIntervalMs,
                        postFxMode,
                        bgMountains,
                        enableGlow,
                        lowPower,
                    };
                }

                apply({ force = false, reason = '' } = {}) {
                    const g = this.game;
                    if (!g) return;

                    const eff = this._computeEffective();
                    this.effective = eff;
                    if (reason) this.state.reason = reason;

                    // 下发到全局 settings（非枚举，避免存盘污染）
                    const gs = (window.GAME_SETTINGS || g.settings || null);
                    if (gs) {
                        defineRuntimeSetting(gs, '__dprCapEffective', eff.dprCap);
                        defineRuntimeSetting(gs, '__postFxModeEffective', eff.postFxMode);
                        defineRuntimeSetting(gs, '__bgMountainsEffective', eff.bgMountains);
                        // 额外下发：方便其它模块/样式根据“低功耗”做降级（非枚举，避免存盘污染）
                        defineRuntimeSetting(gs, '__lowPowerEffective', !!eff.lowPower);
                        defineRuntimeSetting(gs, '__enableGlowEffective', !!eff.enableGlow);
                    }

                    // 同步到 DOM：低功耗（autoQuality 降档/后台）时降低 UI 特效开销
                    try {
                        if (typeof document !== 'undefined' && document.documentElement) {
                            document.documentElement.classList.toggle('tu-low-power', !!eff.lowPower);
                        }
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                    // 粒子上限
                    if (g.particles && typeof g.particles.max === 'number') {
                        if (force || g.particles.max !== eff.particlesMax) g.particles.max = eff.particlesMax;
                    }

                    // 小地图重建节流
                    if (g.minimap) {
                        if (force || g.minimap.buildIntervalMs !== eff.minimapIntervalMs) g.minimap.buildIntervalMs = eff.minimapIntervalMs;
                    }

                    // 光照刷新节流
                    if (force || g._lightIntervalMs !== eff.lightIntervalMs) g._lightIntervalMs = eff.lightIntervalMs;

                    // 渲染器开关
                    if (g.renderer) {
                        if (force || g.renderer.enableGlow !== eff.enableGlow) g.renderer.enableGlow = eff.enableGlow;
                        if (force || g.renderer.lowPower !== eff.lowPower) g.renderer.lowPower = eff.lowPower;
                    }

                    // DPR cap 变化：触发 resize（避免每帧 resize）
                    const last = this._last.__dprCapEffective;
                    if (force || !isNum(last) || Math.abs(last - eff.dprCap) > 0.01) {
                        this._last.__dprCapEffective = eff.dprCap;
                        if (g.renderer && typeof g.renderer.resize === 'function') g.renderer.resize();
                    }
                }
            }

            TU.QualityManager = QualityManager;
        })();
    </script>

    <!-- ========================= SECTION: UI ========================= -->

window.TU = window.TU || {};
Object.assign(window.TU, { QualityManager: window.TU.QualityManager, UIFlushScheduler: window.TU.UIFlushScheduler });
