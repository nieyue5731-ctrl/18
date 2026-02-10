// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Event Utilities (throttle, debounce, rafThrottle)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        const EventUtils = {
            throttle(fn, delay) {
                let last = 0;
                let timer = null;
                return function (...args) {
                    const now = Date.now();
                    if (now - last >= delay) {
                        last = now;
                        fn.apply(this, args);
                    } else if (!timer) {
                        timer = setTimeout(() => {
                            timer = null;
                            last = Date.now();
                            fn.apply(this, args);
                        }, delay - (now - last));
                    }
                };
            },

            debounce(fn, delay) {
                let timer = null;
                return function (...args) {
                    clearTimeout(timer);
                    timer = setTimeout(() => fn.apply(this, args), delay);
                };
            },

            // RAF节流 - 确保每帧最多执行一次 (防御性重构版)
            rafThrottle(fn) {
                // 验证函数参数
                if (typeof fn !== 'function') {
                    console.warn('[EventUtils.rafThrottle] Invalid function');
                    return () => {};
                }
                
                let scheduled = false;
                let lastArgs = null;
                let rafId = null;
                
                return function (...args) {
                    lastArgs = args;
                    if (!scheduled) {
                        scheduled = true;
                        rafId = requestAnimationFrame(() => {
                            scheduled = false;
                            rafId = null;
                            try {
                                fn.apply(this, lastArgs);
                            } catch (e) {
                                console.error('[EventUtils.rafThrottle] Callback error:', e);
                            }
                            lastArgs = null; // 清理引用
                        });
                    }
                };
            },
            
            // 带取消功能的throttle
            throttleCancellable(fn, delay) {
                if (typeof fn !== 'function') {
                    console.warn('[EventUtils.throttleCancellable] Invalid function');
                    return { call: () => {}, cancel: () => {} };
                }
                
                let last = 0;
                let timer = null;
                
                const call = function (...args) {
                    const now = Date.now();
                    if (now - last >= delay) {
                        last = now;
                        clearTimeout(timer);
                        timer = null;
                        try {
                            fn.apply(this, args);
                        } catch (e) {
                            console.error('[EventUtils.throttleCancellable] Error:', e);
                        }
                    } else if (!timer) {
                        timer = setTimeout(() => {
                            timer = null;
                            last = Date.now();
                            try {
                                fn.apply(this, args);
                            } catch (e) {
                                console.error('[EventUtils.throttleCancellable] Delayed error:', e);
                            }
                        }, delay - (now - last));
                    }
                };
                
                const cancel = () => {
                    clearTimeout(timer);
                    timer = null;
                    last = 0;
                };
                
                return { call, cancel };
            }
        };
        window.EventUtils = EventUtils;

window.EventUtils = EventUtils;
window.TU = window.TU || {};
Object.assign(window.TU, { EventUtils });
