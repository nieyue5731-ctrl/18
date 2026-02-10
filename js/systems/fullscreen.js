// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Fullscreen Manager
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        (() => {
            'use strict';

            class FullscreenManager {
                static supported() {
                    const de = document.documentElement;
                    return !!(de && de.requestFullscreen && document.exitFullscreen);
                }

                static async request() {
                    const doc = document;
                    if (!doc.documentElement || !doc.documentElement.requestFullscreen) return false;
                    await doc.documentElement.requestFullscreen();
                    // 尝试锁定横屏（失败不影响）
                    try {
                        if (screen.orientation && screen.orientation.lock) {
                            await screen.orientation.lock('landscape');
                        }
                    } catch { }
                    return true;
                }

                static async exit() {
                    const doc = document;
                    if (!doc.exitFullscreen) return false;
                    await doc.exitFullscreen();
                    return true;
                }

                static _toast(msg, ms = 1000) {
                    try {
                        const toast = window.TU && window.TU.Toast;
                        if (toast && typeof toast.show === 'function') {
                            toast.show(msg, ms);
                            return;
                        }
                    } catch { }
                    // fallback
                    console.log(msg);
                }

                static async toggle() {
                    try {
                        const doc = document;
                        if (!FullscreenManager.supported()) {
                            FullscreenManager._toast('⚠️ 设备不支持全屏', 1200);
                            return;
                        }
                        if (doc.fullscreenElement) {
                            await FullscreenManager.exit();
                            FullscreenManager._toast('🧩 已退出全屏', 900);
                        } else {
                            await FullscreenManager.request();
                            FullscreenManager._toast('🖥 已进入全屏', 900);
                        }
                    } catch {
                        FullscreenManager._toast('⚠️ 全屏请求失败', 1200);
                    }
                }
            }

            window.TU = window.TU || {};
            window.TU.FullscreenManager = FullscreenManager;
        })();
