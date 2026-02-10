// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Ambient Particles (Fireflies, background effects)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class AmbientParticles {
            constructor(containerId) {
                this.container = document.getElementById(containerId);
                this.particles = [];
                this.mode = 'none';
                this._night = 0;
                this._lastOpacity = -1;
            }

            update(timeOfDay, weather) {
                if (!this.container) return;

                const reducedMotion = !!(window.GAME_SETTINGS && window.GAME_SETTINGS.reducedMotion);
                if (reducedMotion) {
                    if (this.mode !== 'none' || this.particles.length) this._clearAll();
                    this.mode = 'none';
                    return;
                }

                const nightFactor = Utils.nightFactor(timeOfDay);

                const wType = (weather && weather.type) ? weather.type : 'clear';
                const wInt = (weather && Number.isFinite(weather.intensity)) ? weather.intensity : 0;

                let mode = 'none';
                let target = 0;

                // 天气优先：雨/雪会替代夜晚萤火虫
                if ((wType === 'rain' || wType === 'thunder') && wInt > 0.06) {
                    mode = 'rain';
                    target = Math.round(35 + wInt * 95);   // 35 ~ 130
                } else if (wType === 'snow' && wInt > 0.06) {
                    mode = 'snow';
                    target = Math.round(20 + wInt * 70);   // 20 ~ 90
                } else if (nightFactor > 0.25) {
                    mode = 'firefly';
                    target = Math.round(10 + nightFactor * 18); // 10 ~ 28
                }

                // 低画质：适当减量（DOM 粒子更省）
                try {
                    const gs = window.GAME_SETTINGS || {};
                    const cap = (typeof gs.__dprCapEffective === 'number') ? gs.__dprCapEffective : gs.dprCap;
                    if (cap && cap <= 1.25) target = Math.floor(target * 0.75);
                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                // 切换模式：重建粒子（避免同时存在多种粒子造成冗余开销）
                if (mode !== this.mode) {
                    this._clearAll();
                    this.mode = mode;
                }

                // 容器透明度：只在变化明显时写入，减少 layout/style 抖动
                let opacity = 0;
                if (mode === 'firefly') opacity = 0.25 + nightFactor * 0.75;
                else if (mode === 'rain') opacity = 0.35 + wInt * 0.65;
                else if (mode === 'snow') opacity = 0.25 + wInt * 0.75;
                opacity = Math.min(1, Math.max(0, opacity));
                if (this._lastOpacity < 0 || Math.abs(opacity - this._lastOpacity) > 0.03) {
                    this.container.style.opacity = opacity.toFixed(3);
                    this._lastOpacity = opacity;
                }

                // 数量调整（上限保护）
                target = Math.max(0, Math.min(target, mode === 'rain' ? 140 : 110));
                if (this.particles.length < target) this._spawn(target - this.particles.length, mode, wInt, nightFactor);
                else if (this.particles.length > target) {
                    for (let i = this.particles.length - 1; i >= target; i--) {
                        const p = this.particles.pop();
                        if (p && p.parentNode) p.parentNode.removeChild(p);
                    }
                }

                // 萤火虫：夜晚因子变化时，才更新每个粒子 opacity
                if (mode === 'firefly') {
                    if (Math.abs(nightFactor - this._night) > 0.03) {
                        this._night = nightFactor;
                        for (const p of this.particles) {
                            const o = (p._baseOpacity || 1) * nightFactor;
                            p.style.opacity = o.toFixed(3);
                        }
                    }
                }
            }

            _spawn(n, mode, intensity, nightFactor) {
                const frag = document.createDocumentFragment();

                for (let i = 0; i < n; i++) {
                    const p = document.createElement('div');

                    if (mode === 'firefly') {
                        p.className = 'firefly';
                        p.style.left = (Math.random() * 100).toFixed(2) + '%';
                        p.style.top = (30 + Math.random() * 40).toFixed(2) + '%';
                        p.style.animationDelay = (-Math.random() * 8).toFixed(2) + 's';
                        p.style.animationDuration = (6 + Math.random() * 4).toFixed(2) + 's';
                        const base = 0.2 + Math.random() * 0.8;
                        p._baseOpacity = base;
                        p.style.opacity = (base * nightFactor).toFixed(3);
                    }
                    else if (mode === 'rain') {
                        p.className = 'raindrop';
                        p.style.left = (Math.random() * 100).toFixed(2) + '%';
                        p.style.top = (-20 - Math.random() * 35).toFixed(2) + '%';
                        const len = 10 + Math.random() * 18;
                        p.style.height = len.toFixed(1) + 'px';
                        p.style.opacity = (0.25 + Math.random() * 0.55).toFixed(3);
                        const baseDur = 1.05 - 0.45 * intensity;
                        const dur = Math.max(0.45, baseDur + (Math.random() * 0.35));
                        p.style.animationDuration = dur.toFixed(2) + 's';
                        p.style.animationDelay = (-Math.random() * 1.5).toFixed(2) + 's';
                    }
                    else if (mode === 'snow') {
                        p.className = 'snowflake';
                        p.style.left = (Math.random() * 100).toFixed(2) + '%';
                        p.style.top = (-10 - Math.random() * 25).toFixed(2) + '%';
                        const size = 2 + Math.random() * 3.5;
                        p.style.width = size.toFixed(1) + 'px';
                        p.style.height = size.toFixed(1) + 'px';
                        p.style.opacity = (0.35 + Math.random() * 0.55).toFixed(3);
                        const drift = (Math.random() * 80 - 40).toFixed(0) + 'px';
                        p.style.setProperty('--drift', drift);
                        const baseDur = 6.5 - 2.2 * intensity;
                        const dur = Math.max(3.0, baseDur + (Math.random() * 3.0));
                        p.style.animationDuration = dur.toFixed(2) + 's';
                        p.style.animationDelay = (-Math.random() * 3.5).toFixed(2) + 's';
                    }
                    else {
                        continue;
                    }

                    frag.appendChild(p);
                    this.particles.push(p);
                }

                this.container.appendChild(frag);
            }

            _clearAll() {
                for (const p of this.particles) {
                    if (p && p.parentNode) p.parentNode.removeChild(p);
                }
                this.particles.length = 0;
                this._night = 0;
                this._lastOpacity = -1;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                      玩家

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { AmbientParticles });

    </script>


window.TU = window.TU || {};
Object.assign(window.TU, { AmbientParticles });
