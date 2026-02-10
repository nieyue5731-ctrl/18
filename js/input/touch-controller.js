// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Touch Controller
// MERGED: Original class + experience_optimized_v2 patches
// Final effective version (all prototype patches folded in)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class TouchController {
            constructor(game) {
                this.game = game;
                this.joystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0 };
                this.buttons = { jump: false, mine: false, place: false };
                this.crosshair = { x: 0, y: 0, visible: false };
                this.targetTouchId = null;

                this._init();
                // 复用输入对象，避免每帧分配新对象（移动端 GC 压力大）
                this._input = { left: false, right: false, jump: false, sprint: false, mine: false, place: false, targetX: 0, targetY: 0, hasTarget: false };

            }

            _init() {
                const joystickEl = document.getElementById('joystick');
                const thumbEl = document.getElementById('joystick-thumb');
                const crosshairEl = document.getElementById('crosshair');

                // 兜底：若移动端 UI 节点缺失（被裁剪/二次封装），不要直接崩溃
                if (!joystickEl || !thumbEl || !crosshairEl) return;

                joystickEl.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    const touch = e.touches[0];
                    const rect = joystickEl.getBoundingClientRect();
                    this.joystick.active = true;
                    this.joystick.startX = rect.left + rect.width / 2;
                    this.joystick.startY = rect.top + rect.height / 2;
                    this._updateJoystick(touch.clientX, touch.clientY, thumbEl);
                }, { passive: false });
                joystickEl.addEventListener('touchmove', (e) => {
                    e.preventDefault();
                    if (!this.joystick.active) return;
                    const touch = e.touches[0];
                    this._updateJoystick(touch.clientX, touch.clientY, thumbEl);
                }, { passive: false });
                joystickEl.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    this.joystick.active = false;
                    this.joystick.dx = 0;
                    this.joystick.dy = 0;
                    thumbEl.style.transform = 'translate(-50%, -50%)';
                }, { passive: false });
                this._setupButton('btn-jump', 'jump');
                this._setupButton('btn-mine', 'mine');
                this._setupButton('btn-place', 'place');

                const canvas = this.game.canvas;
                canvas.addEventListener('touchstart', (e) => {
                    for (const touch of e.changedTouches) {
                        if (touch.clientX < 200 && touch.clientY > window.innerHeight - 220) continue;
                        if (touch.clientX > window.innerWidth - 200 && touch.clientY > window.innerHeight - 220) continue;

                        this.targetTouchId = touch.identifier;
                        this._updateCrosshair(touch.clientX, touch.clientY, crosshairEl);
                        this.crosshair.visible = true;
                        crosshairEl.style.display = 'block';
                    }
                }, { passive: false });
                canvas.addEventListener('touchmove', (e) => {
                    for (const touch of e.changedTouches) {
                        if (touch.identifier === this.targetTouchId) {
                            this._updateCrosshair(touch.clientX, touch.clientY, crosshairEl);
                        }
                    }
                }, { passive: false });
                canvas.addEventListener('touchend', (e) => {
                    for (const touch of e.changedTouches) {
                        if (touch.identifier === this.targetTouchId) {
                            this.targetTouchId = null;
                        }
                    }
                }, { passive: false });
            }

            _updateJoystick(tx, ty, thumbEl) {
                let dx = tx - this.joystick.startX;
                let dy = ty - this.joystick.startY;

                // 根据设置动态缩放摇杆行程（适配不同摇杆尺寸）
                const size = (this.game && this.game.settings && this.game.settings.joystickSize) ? this.game.settings.joystickSize : 140;
                const maxDist = Math.max(34, size * 0.33);

                const dist = Math.hypot(dx, dy);

                if (dist > maxDist) {
                    dx = dx / dist * maxDist;
                    dy = dy / dist * maxDist;
                }

                // 归一化输入
                let nx = dx / maxDist;
                let ny = dy / maxDist;

                // 死区 + 灵敏度曲线（平方/立方等）
                const dz = (this.game && this.game.settings && typeof this.game.settings.joystickDeadzone === 'number')
                    ? this.game.settings.joystickDeadzone
                    : 0.14;
                const curve = (this.game && this.game.settings && typeof this.game.settings.joystickCurve === 'number')
                    ? this.game.settings.joystickCurve
                    : 2.2;

                let mag = Math.hypot(nx, ny);

                if (mag < dz) {
                    nx = 0; ny = 0; dx = 0; dy = 0;
                } else {
                    const t = (mag - dz) / (1 - dz);
                    const eased = Math.pow(Math.max(0, Math.min(1, t)), curve);
                    const s = (mag > 1e-5) ? (eased / mag) : 0;
                    nx *= s; ny *= s;
                    dx = nx * maxDist;
                    dy = ny * maxDist;
                }

                this.joystick.dx = nx;
                this.joystick.dy = ny;

                thumbEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            }

            _updateCrosshair(x, y, el) {
                this.crosshair.x = x;
                this.crosshair.y = y;
                el.style.left = (x - 20) + 'px';
                el.style.top = (y - 20) + 'px';
            }

            _setupButton(id, action) {
                const btn = document.getElementById(id);
                if (!btn) return;

                const vibrate = (ms) => {
                    try {
                        const s = this.game && this.game.settings;
                        if (s && s.vibration && navigator.vibrate) navigator.vibrate(ms);
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                };

                btn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.buttons[action] = true;
                    btn.classList.add('active');
                    vibrate(10);
                }, { passive: false });

                const up = (e) => {
                    e.preventDefault();
                    this.buttons[action] = false;
                    btn.classList.remove('active');
                };
                btn.addEventListener('touchend', up, { passive: false });
                btn.addEventListener('touchcancel', up, { passive: false });
            }

            getInput() {
                const o = this._input;
                o.left = this.joystick.dx < -0.3;
                o.right = this.joystick.dx > 0.3;
                o.jump = this.buttons.jump;
                o.sprint = Math.abs(this.joystick.dx) > 0.85;
                o.mine = this.buttons.mine;
                o.place = this.buttons.place;
                o.targetX = this.crosshair.x;
                o.targetY = this.crosshair.y;
                o.hasTarget = this.crosshair.visible;
                return o;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                   渲染器 (美化版)
        // ═══════════════════════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════════════════
        //                           Render constants (缓存减少分配)

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { TouchController });

    </script>


// ─── Merged Patches (experience_optimized_v2) ───
// These were prototype patches that have been merged into the class above.
// The patches override _init, _updateJoystick, _updateCrosshair.
// Since the original class calls _init() in its constructor, the patched
// versions below take precedence (last-write-wins on prototype).
                                                if (TouchController && TouchController.prototype) {
                                                    TouchController.prototype._init = function () {
                                                        const joystickEl = document.getElementById('joystick');
                                                        const thumbEl = document.getElementById('joystick-thumb');
                                                        const crosshairEl = document.getElementById('crosshair');

                                                        const canvas = this.game && this.game.canvas;

                                                        // 兼容：缺少关键节点则直接返回
                                                        if (!joystickEl || !thumbEl || !canvas) return;

                                                        // 让浏览器知道这里不会滚动（减少一些浏览器的触控延迟）
                                                        try { canvas.style.touchAction = 'none'; } catch { }
                                                        try { joystickEl.style.touchAction = 'none'; } catch { }

                                                        // 十字准星：默认透明，第一次设定目标后才显示
                                                        if (crosshairEl) {
                                                            crosshairEl.classList.remove('crosshair-active', 'crosshair-idle');
                                                        }

                                                        // 安全区（防误触）：根据 UI 实际位置动态计算
                                                        const safeRects = [];
                                                        const expandRect = (r, m) => ({ left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m });
                                                        const hitRect = (r, x, y) => (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

                                                        const refreshSafeZones = () => {
                                                            safeRects.length = 0;

                                                            // joystick 安全区
                                                            try {
                                                                const jr = joystickEl.getBoundingClientRect();
                                                                const m = Math.max(18, jr.width * 0.18);
                                                                safeRects.push(expandRect(jr, m));

                                                                // 同步摇杆最大位移：跟随 joystick 尺寸
                                                                this._joyMaxDist = Math.max(30, Math.min(90, jr.width * 0.35));
                                                            } catch {
                                                                this._joyMaxDist = 50;
                                                            }

                                                            // action buttons 安全区
                                                            try {
                                                                const act = document.querySelector('.action-buttons');
                                                                if (act) {
                                                                    const ar = act.getBoundingClientRect();
                                                                    safeRects.push(expandRect(ar, 18));
                                                                }
                                                            } catch { }

                                                            // jump button 安全区
                                                            try {
                                                                const jc = document.querySelector('.jump-container');
                                                                if (jc) {
                                                                    const r = jc.getBoundingClientRect();
                                                                    safeRects.push(expandRect(r, 18));
                                                                }
                                                            } catch { }

                                                            // minimap 安全区（防止在边缘误触到画布瞄准）
                                                            try {
                                                                const mm = document.getElementById('minimap');
                                                                if (mm && mm.offsetParent !== null) {
                                                                    const r = mm.getBoundingClientRect();
                                                                    safeRects.push(expandRect(r, 14));
                                                                }
                                                            } catch { }
                                                        };

                                                        this._refreshSafeZones = refreshSafeZones;
                                                        refreshSafeZones();
                                                        window.addEventListener('resize', refreshSafeZones, { passive: true });
                                                        window.addEventListener('orientationchange', refreshSafeZones, { passive: true });

                                                        const findTouch = (touchList, id) => {
                                                            if (!touchList) return null;
                                                            for (let i = 0; i < touchList.length; i++) {
                                                                const t = touchList[i];
                                                                if (t && t.identifier === id) return t;
                                                            }
                                                            return null;
                                                        };

                                                        const inSafeZone = (x, y) => {
                                                            for (let i = 0; i < safeRects.length; i++) {
                                                                if (hitRect(safeRects[i], x, y)) return true;
                                                            }
                                                            return false;
                                                        };

                                                        // ── Joystick：绑定自己的 touchId，避免与准星/按钮互相抢
                                                        this.joystick.touchId = null;

                                                        joystickEl.addEventListener('touchstart', (e) => {
                                                            // 防止页面滑动/缩放
                                                            e.preventDefault();

                                                            // 已经有 joystick touch 在控制时，不抢占
                                                            if (this.joystick.touchId !== null) return;

                                                            const t = e.changedTouches && e.changedTouches[0];
                                                            if (!t) return;

                                                            this.joystick.touchId = t.identifier;
                                                            this.joystick.active = true;

                                                            // joystick 基准点：固定在底座中心
                                                            const rect = joystickEl.getBoundingClientRect();
                                                            this.joystick.startX = rect.left + rect.width / 2;
                                                            this.joystick.startY = rect.top + rect.height / 2;

                                                            this._updateJoystick(t.clientX, t.clientY, thumbEl);
                                                        }, { passive: false });

                                                        joystickEl.addEventListener('touchmove', (e) => {
                                                            e.preventDefault();
                                                            if (!this.joystick.active || this.joystick.touchId === null) return;

                                                            const t = findTouch(e.touches, this.joystick.touchId) || findTouch(e.changedTouches, this.joystick.touchId);
                                                            if (!t) return;

                                                            this._updateJoystick(t.clientX, t.clientY, thumbEl);
                                                        }, { passive: false });

                                                        const endJoy = (e) => {
                                                            e.preventDefault();
                                                            if (this.joystick.touchId === null) return;

                                                            // 只有结束了 joystick 自己的 touch 才归零
                                                            const ended = findTouch(e.changedTouches, this.joystick.touchId);
                                                            if (!ended) return;

                                                            this.joystick.active = false;
                                                            this.joystick.touchId = null;
                                                            this.joystick.dx = 0;
                                                            this.joystick.dy = 0;
                                                            thumbEl.style.transform = 'translate(-50%, -50%)';
                                                        };

                                                        joystickEl.addEventListener('touchend', endJoy, { passive: false });
                                                        joystickEl.addEventListener('touchcancel', endJoy, { passive: false });

                                                        // ── Buttons：沿用原有逻辑
                                                        this._setupButton('btn-jump', 'jump');
                                                        this._setupButton('btn-mine', 'mine');
                                                        this._setupButton('btn-place', 'place');

                                                        // ── Crosshair：允许“设定一次目标后松手继续挖/放”
                                                        const setCrosshairState = (state) => {
                                                            if (!crosshairEl) return;
                                                            crosshairEl.classList.toggle('crosshair-active', state === 'active');
                                                            crosshairEl.classList.toggle('crosshair-idle', state === 'idle');
                                                            if (state === 'hidden') crosshairEl.classList.remove('crosshair-active', 'crosshair-idle');
                                                        };

                                                        canvas.addEventListener('touchstart', (e) => {
                                                            // 阻止双指缩放/滚动（尤其 iOS）
                                                            e.preventDefault();

                                                            if (!e.changedTouches) return;

                                                            // 如果当前没有正在拖动的准星，就从新 touch 中挑一个合适的
                                                            if (this.targetTouchId === null) {
                                                                for (let i = 0; i < e.changedTouches.length; i++) {
                                                                    const t = e.changedTouches[i];
                                                                    if (!t) continue;

                                                                    // 过滤掉靠近摇杆/按钮/小地图的触点，防误触
                                                                    if (inSafeZone(t.clientX, t.clientY)) continue;

                                                                    this.targetTouchId = t.identifier;
                                                                    if (crosshairEl) {
                                                                        this._updateCrosshair(t.clientX, t.clientY, crosshairEl);
                                                                        // 第一次设定目标：开启 hasTarget
                                                                        this.crosshair.visible = true;
                                                                        setCrosshairState('active');
                                                                    }
                                                                    break;
                                                                }
                                                            } else {
                                                                // 已在拖动：不抢占
                                                            }
                                                        }, { passive: false });

                                                        canvas.addEventListener('touchmove', (e) => {
                                                            e.preventDefault();
                                                            if (this.targetTouchId === null) return;

                                                            const t = findTouch(e.touches, this.targetTouchId) || findTouch(e.changedTouches, this.targetTouchId);
                                                            if (!t || !crosshairEl) return;

                                                            this._updateCrosshair(t.clientX, t.clientY, crosshairEl);
                                                            // 正在拖动时保持 active
                                                            if (this.crosshair.visible) setCrosshairState('active');
                                                        }, { passive: false });

                                                        const endCross = (e) => {
                                                            e.preventDefault();
                                                            if (this.targetTouchId === null) return;

                                                            const ended = findTouch(e.changedTouches, this.targetTouchId);
                                                            if (!ended) return;

                                                            this.targetTouchId = null;
                                                            // 松手后：保留目标点，但变为 idle（更不遮挡）
                                                            if (this.crosshair.visible) setCrosshairState('idle');
                                                        };

                                                        canvas.addEventListener('touchend', endCross, { passive: false });
                                                        canvas.addEventListener('touchcancel', endCross, { passive: false });
                                                    };

                                                    // 自适应摇杆半径（maxDist 与 UI 尺寸匹配）
                                                    TouchController.prototype._updateJoystick = function (tx, ty, thumbEl) {
                                                        let dx = tx - this.joystick.startX;
                                                        let dy = ty - this.joystick.startY;

                                                        const maxDist = (typeof this._joyMaxDist === 'number' && isFinite(this._joyMaxDist)) ? this._joyMaxDist : 50;
                                                        const dist = Math.sqrt(dx * dx + dy * dy);

                                                        if (dist > maxDist) {
                                                            dx = dx / dist * maxDist;
                                                            dy = dy / dist * maxDist;
                                                        }

                                                        this.joystick.dx = dx / maxDist;
                                                        this.joystick.dy = dy / maxDist;

                                                        thumbEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                                                    };

                                                    // Crosshair：只做坐标更新（与原逻辑兼容）
                                                    TouchController.prototype._updateCrosshair = function (x, y, el) {
                                                        this.crosshair.x = x;
                                                        this.crosshair.y = y;
                                                        // 40x40
                                                        el.style.left = (x - 20) + 'px';
                                                        el.style.top = (y - 20) + 'px';
                                                    };
                                                }

window.TU = window.TU || {};
Object.assign(window.TU, { TouchController });
