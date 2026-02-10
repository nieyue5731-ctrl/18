// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Game Settings
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class GameSettings {
            static KEY = 'terraria_ultra_settings_v1';
            static defaults() {
                const prefersReducedMotion = (() => {
                    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
                })();
                return {
                    // 画质
                    dprCap: 2,
                    particles: true,
                    ambient: true,
                    bgMountains: true,
                    minimap: true,

                    // 后期画面增强：0 关 / 1 轻量 / 2 极致
                    postFxMode: 2,
                    // 触控与体验
                    aimAssist: true,
                    vibration: true,
                    cameraSmooth: 0.08,   // 0.03~0.18（越大越顺滑但更慢跟）
                    lookAhead: 1.0,       // 0~1.5（镜头前瞻强度）
                    placeIntervalMs: 80,  // 连续放置节流（ms）

                    // UI
                    joystickSize: 140,
                    // 摇杆：死区 + 灵敏度曲线（移动端更稳定更跟手）
                    joystickDeadzone: 0.14,
                    joystickCurve: 2.2,
                    buttonSize: 70,
                    showFps: false,

                    // 音频与无障碍
                    sfxVolume: 0.35,
                    reducedMotion: prefersReducedMotion,

                    // 性能调度
                    autoQuality: true,

                    // 存档
                    autosaveMs: 30000,
                };
            }
            static sanitize(o) {
                const d = GameSettings.defaults();
                
                // 防御性：防止原型污染
                const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];
                const safeObj = {};
                if (o && typeof o === 'object') {
                    for (const key of Object.keys(o)) {
                        if (forbiddenKeys.includes(key)) {
                            console.warn('[GameSettings] Forbidden key detected:', key);
                            continue;
                        }
                        safeObj[key] = o[key];
                    }
                }
                
                const s = Object.assign({}, d, safeObj);
                
                // 增强的数值验证器
                const num = (v, min, max, fallback) => {
                    const n = Number(v);
                    if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
                    return Math.max(min, Math.min(max, n));
                };
                
                s.dprCap = num(s.dprCap, 1, 2, d.dprCap);
                s.postFxMode = num(s.postFxMode, 0, 2, d.postFxMode);
                s.joystickSize = num(s.joystickSize, 110, 200, d.joystickSize);
                s.joystickDeadzone = num(s.joystickDeadzone, 0, 0.35, d.joystickDeadzone);
                s.joystickCurve = num(s.joystickCurve, 1, 4, d.joystickCurve);
                s.buttonSize = num(s.buttonSize, 52, 100, d.buttonSize);
                s.sfxVolume = num(s.sfxVolume, 0, 1, d.sfxVolume);
                s.autosaveMs = num(s.autosaveMs, 10000, 120000, d.autosaveMs);
                s.cameraSmooth = num(s.cameraSmooth, 0.03, 0.18, d.cameraSmooth);
                s.lookAhead = num(s.lookAhead, 0, 1.5, d.lookAhead);
                s.placeIntervalMs = num(s.placeIntervalMs, 40, 200, d.placeIntervalMs);

                s.aimAssist = !!s.aimAssist;
                s.vibration = !!s.vibration;
                s.showFps = !!s.showFps;
                s.autoQuality = (s.autoQuality === undefined) ? d.autoQuality : !!s.autoQuality;

                s.particles = !!s.particles;
                s.ambient = !!s.ambient;
                s.bgMountains = (s.bgMountains === undefined) ? d.bgMountains : !!s.bgMountains;
                s.minimap = !!s.minimap;
                s.reducedMotion = !!s.reducedMotion;
                return s;
            }
            static load() {
                try {
                    const raw = localStorage.getItem(GameSettings.KEY);
                    if (!raw) return GameSettings.defaults();
                    
                    // 检查数据大小
                    if (raw.length > 100 * 1024) { // 100KB限制
                        console.warn('[GameSettings] Settings data too large');
                        return GameSettings.defaults();
                    }
                    
                    const parsed = JSON.parse(raw);
                    return GameSettings.sanitize(parsed);
                } catch (e) {
                    console.error('[GameSettings] Load error:', e);
                    return GameSettings.defaults();
                }
            }
            
            static save(settings) {
                try {
                    const sanitized = GameSettings.sanitize(settings);
                    const serialized = JSON.stringify(sanitized);
                    
                    // 检查序列化后的大小
                    if (serialized.length > 100 * 1024) {
                        console.warn('[GameSettings] Settings too large to save');
                        return false;
                    }
                    
                    localStorage.setItem(GameSettings.KEY, serialized);
                    return true;
                } catch (e) {
                    console.error('[GameSettings] Save error:', e);
                    return false;
                }
            }
            
            static applyToDocument(settings) {
                const s = GameSettings.sanitize(settings);
                const root = document.documentElement;
                
                // 安全的CSS值设置
                const safeCSS = (value, unit = 'px') => {
                    const num = Number(value);
                    if (Number.isNaN(num) || !Number.isFinite(num)) return null;
                    const clamped = Math.max(0, Math.min(10000, num));
                    return `${clamped}${unit}`;
                };
                
                const joySize = safeCSS(s.joystickSize);
                if (joySize) root.style.setProperty('--joy-size', joySize);
                
                const btnSize = safeCSS(s.buttonSize);
                if (btnSize) root.style.setProperty('--btn-size', btnSize);
                
                root.classList.toggle('reduced-motion', !!s.reducedMotion);

                const minimap = document.getElementById('minimap');
                if (minimap) minimap.style.display = s.minimap ? '' : 'none';

                const ambient = document.getElementById('ambient-particles');
                if (ambient) ambient.style.display = s.ambient ? '' : 'none';

                const fpsEl = document.getElementById('fps');
                if (fpsEl) fpsEl.style.display = s.showFps ? '' : 'none';

                // 便于 Renderer 读到
                window.GAME_SETTINGS = s;
                return s;
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { GameSettings });


window.TU = window.TU || {};
Object.assign(window.TU, { GameSettings });
