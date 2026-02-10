// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Utility Functions
// Consolidated: Utils, SafeAccess, DOM helpers
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        const __hexToRgbCache = new Map();
        const __rgb0 = Object.freeze({ r: 0, g: 0, b: 0 });

        const Utils = {
            clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
            lerp: (a, b, t) => a + (b - a) * t,
            smoothstep: (edge0, edge1, x) => {
                if (edge0 === edge1) return x < edge0 ? 0 : 1;
                const t = Utils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
                return t * t * (3 - 2 * t);
            },
            lerpColor: (hexA, hexB, t) => {
                const a = Utils.hexToRgb(hexA);
                const b = Utils.hexToRgb(hexB);
                const r = Math.round(Utils.lerp(a.r, b.r, t));
                const g = Math.round(Utils.lerp(a.g, b.g, t));
                const b2 = Math.round(Utils.lerp(a.b, b.b, t));
                return Utils.rgbToHex(r, g, b2);
            },
            // 0=白天, 1=深夜；在黎明/黄昏附近做 smoothstep 过渡
            nightFactor: (time, dawnStart = 0.18, dawnEnd = 0.28, duskStart = 0.72, duskEnd = 0.82) => {
                const n1 = 1 - Utils.smoothstep(dawnStart, dawnEnd, time);
                const n2 = Utils.smoothstep(duskStart, duskEnd, time);
                return Utils.clamp(n1 + n2, 0, 1);
            },
            dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
            isMobile: () => {
                try {
                    // ✅ 手动强制：?forceMobile=1 / ?forceDesktop=1（或 ?mobile=1 / ?desktop=1）
                    const qs = new URLSearchParams(window.location.search);
                    if (qs.get('forceDesktop') === '1' || qs.get('desktop') === '1') return false;
                    if (qs.get('forceMobile') === '1' || qs.get('mobile') === '1') return true;

                    // ✅ 优先：User-Agent Client Hints（Chromium 系内浏览器）
                    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
                        return navigator.userAgentData.mobile;
                    }

                    const ua = (navigator.userAgent || '').toLowerCase();
                    const platform = (navigator.platform || '').toLowerCase();

                    // ✅ iPadOS 13+：可能伪装成 “Macintosh”，但通常 platform=MacIntel 且具备多点触控
                    const maxTouchPoints = navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0;
                    const isIPadOS = (platform === 'macintel' || ua.includes('macintosh')) && maxTouchPoints > 1;

                    // ✅ 常见移动/平板/阅读器 UA 关键字（部分“桌面模式”也可能带 Mobile/Tablet）
                    const uaLooksMobile = /android|iphone|ipod|ipad|windows phone|iemobile|blackberry|bb10|opera mini|opera mobi|mobile|webos|silk|kindle|kfapwi|kftt|tablet|playbook/.test(ua);

                    if (isIPadOS || uaLooksMobile) return true;

                    // ✅ 触控能力兜底（有些浏览器 UA 会伪装成桌面）
                    const hasTouch = ('ontouchstart' in window) || maxTouchPoints > 0;

                    // ✅ 媒体查询特征（部分旧 WebView 不支持，做保护）
                    const mql = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
                    const coarsePointer = mql('(pointer: coarse)') || mql('(any-pointer: coarse)');
                    const noHover = mql('(hover: none)') || mql('(any-hover: none)');

                    // ✅ 视口尺寸兜底：大屏手机横屏时 width 可能 > 768，取“短边”更可靠
                    const vw = window.innerWidth || 0;
                    const vh = window.innerHeight || 0;
                    const minSide = Math.min(vw, vh);
                    const smallViewport = minSide > 0 && minSide <= 900;

                    if (hasTouch && (coarsePointer || noHover)) return true;
                    if (hasTouch && smallViewport) return true;

                    return false;
                } catch (e) {
                    // 最终兜底：只要能触控，就当作需要移动端 UI
                    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                }
            },

            /** 给 <html> 打上 is-mobile / is-desktop，解决部分机型媒体查询/UA 异常导致的“显示电脑端界面” */
            applyDeviceClass: () => {
                const root = document.documentElement;
                if (!root) return;
                const mobile = Utils.isMobile();
                root.classList.toggle('is-mobile', mobile);
                root.classList.toggle('is-desktop', !mobile);
            },

            hexToRgb: (hex) => {
                if (typeof hex !== 'string') return __rgb0;
                // Normalize: '#rrggbb'
                let key = hex;
                if (key[0] !== '#') key = '#' + key;
                if (key.length !== 7) {
                    // best-effort normalize (rare path)
                    key = ('#' + key.replace('#', '').toLowerCase().padStart(6, '0')).slice(0, 7);
                } else {
                    key = key.toLowerCase();
                }
                let c = __hexToRgbCache.get(key);
                if (c) return c;
                const r = parseInt(key.slice(1, 3), 16) || 0;
                const g = parseInt(key.slice(3, 5), 16) || 0;
                const b = parseInt(key.slice(5, 7), 16) || 0;
                c = Object.freeze({ r, g, b });
                __hexToRgbCache.set(key, c);
                return c;
            },
            rgbToHex: (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''),
            resetGameInput: (game) => {
                try {
                    if (!game || !game.input) return;
                    const inp = game.input;
                    inp.left = false; inp.right = false; inp.jump = false; inp.sprint = false;
                    if ('mouseLeft' in inp) inp.mouseLeft = false;
                    if ('mouseRight' in inp) inp.mouseRight = false;
                    if ('mouseMiddle' in inp) inp.mouseMiddle = false;
                    const im = game.services && game.services.input;
                    if (im) {
                        if ('_holdLeftMs' in im) im._holdLeftMs = 0;
                        if ('_holdRightMs' in im) im._holdRightMs = 0;
                        if ('_holdSprint' in im) im._holdSprint = false;
                        if ('_holdDir' in im) im._holdDir = 0;
                        if ('_holdJustStarted' in im) im._holdJustStarted = false;
                    }
                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
            },
            easeOutBack: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2)
        };

        // 设备模式标记：尽早打上 class，兼容部分机型/浏览器“桌面模式”导致的移动端识别异常
        Utils.applyDeviceClass();
        // 旋转/尺寸变化时同步更新（只影响 CSS/UI，不会打断游戏进程）
        // 旋转/尺寸变化时同步更新（节流到 rAF，避免 resize 连续触发导致重复计算）
        let __tuDeviceClassRaf = 0;

        // SafeAccess: delegate to TU_Defensive.WorldAccess (already defined in head)
        // This avoids a duplicate definition while keeping the same API for existing callers
        const SafeAccess = (window.TU_Defensive && window.TU_Defensive.WorldAccess) || {
            getTile(world, x, y, defaultValue = 0) {
                if (!world || !world.tiles) return defaultValue;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) return defaultValue;
                return world.tiles[x][y];
            },
            setTile(world, x, y, value) {
                if (!world || !world.tiles) return false;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
                world.tiles[x][y] = value;
                return true;
            },
            getLight(world, x, y, defaultValue = 0) {
                if (!world || !world.light) return defaultValue;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) return defaultValue;
                return world.light[x][y];
            },
            setLight(world, x, y, value) {
                if (!world || !world.light) return false;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
                world.light[x][y] = value;
                return true;
            }
        };

        const __tuDeviceClassRafCb = () => {
            __tuDeviceClassRaf = 0;
            Utils.applyDeviceClass();
        };
        const __tuScheduleDeviceClass = () => {
            if (__tuDeviceClassRaf) return;
            __tuDeviceClassRaf = requestAnimationFrame(__tuDeviceClassRafCb);
        };
        const __tuScheduleDeviceClassDelayed = () => { setTimeout(__tuScheduleDeviceClass, 50); };
        window.addEventListener('resize', __tuScheduleDeviceClass, { passive: true });
        window.addEventListener('orientationchange', __tuScheduleDeviceClassDelayed, { passive: true });


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
