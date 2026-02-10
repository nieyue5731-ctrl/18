// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Inventory UI
// Merged: drag-drop patches from weather_inventory_enhanced
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class InventoryUI {
            /** @param {Game} game */
            constructor(game) {
                this.game = game;

                this.isOpen = false;
                this.MAX_SIZE = (window.INVENTORY_LIMITS && INVENTORY_LIMITS.MAX_SIZE) ? INVENTORY_LIMITS.MAX_SIZE : 36;
                this.MAX_STACK = (window.INVENTORY_LIMITS && INVENTORY_LIMITS.MAX_STACK) ? INVENTORY_LIMITS.MAX_STACK : 999;
                this.EMPTY_ID = '__empty__';

                this.overlay = document.getElementById('inventory-overlay');
                this.panel = document.getElementById('inventory-panel');

                this.hotbarGrid = document.getElementById('inv-hotbar-grid');
                this.backpackGrid = document.getElementById('inv-backpack-grid');

                this.closeBtn = document.getElementById('inv-close');
                this.capacityText = document.getElementById('inv-capacity-text');
                this.capacityFill = document.getElementById('inv-capacity-fill');

                this.previewBox = document.getElementById('inv-preview');
                this.nameEl = document.getElementById('inv-item-name');
                this.metaEl = document.getElementById('inv-item-meta');
                this.descEl = document.getElementById('inv-item-desc');

                this.btnSort = document.getElementById('inv-sort');
                this.btnToHotbar = document.getElementById('inv-to-hotbar');
                this.btnPutBack = document.getElementById('inv-put-back');
                this.btnDrop = document.getElementById('inv-drop');

                this.btnTop = document.getElementById('btn-inventory');
                this.btnFloat = document.getElementById('btn-bag-toggle');

                this.heldEl = document.getElementById('inv-held');

                this._slotEls = new Array(this.MAX_SIZE);
                this._slotCanvases = new Array(this.MAX_SIZE);
                this._slotCtx = new Array(this.MAX_SIZE);
                this._slotCountEls = new Array(this.MAX_SIZE);
                this._slotEmojiEls = new Array(this.MAX_SIZE);
                this._lastId = new Array(this.MAX_SIZE).fill(null);
                this._lastCount = new Array(this.MAX_SIZE).fill(-1);

                this._selectedIdx = 0;
                this._cursorItem = null;
                this._cursorFrom = -1;

                this._previewCanvas = document.createElement('canvas');
                this._previewCanvas.width = this._previewCanvas.height = 56;
                this._previewCtx = this._previewCanvas.getContext('2d', { willReadFrequently: true });
                this._previewCtx.imageSmoothingEnabled = false;

                this._previewEmoji = document.createElement('span');
                this._previewEmoji.className = 'item-icon';
                this._previewEmoji.style.display = 'none';

                this.previewBox.innerHTML = '';
                this.previewBox.appendChild(this._previewEmoji);
                this.previewBox.appendChild(this._previewCanvas);
                this._previewCanvas.style.display = 'none';

                this._heldCanvas = document.createElement('canvas');
                this._heldCanvas.width = this._heldCanvas.height = 34;
                this._heldCtx = this._heldCanvas.getContext('2d', { willReadFrequently: true });
                this._heldCtx.imageSmoothingEnabled = false;

                this._heldEmoji = document.createElement('span');
                this._heldEmoji.className = 'item-icon';
                this._heldEmoji.style.display = 'none';

                this._heldCount = document.createElement('span');
                this._heldCount.className = 'count';

                this.heldEl.innerHTML = '';
                this.heldEl.appendChild(this._heldEmoji);
                this.heldEl.appendChild(this._heldCanvas);
                this.heldEl.appendChild(this._heldCount);

                this._buildSlots();
                this._bind();
                this.ensureCapacity();
                this.refresh(true);

                // hotbar/buildHotbar 会发出事件，背包打开时跟随更新
                document.addEventListener('tu:inventoryChanged', () => {
                    if (this.isOpen) this.refresh(false);
                });
            }

            ensureCapacity() {
                const inv = this.game.player.inventory;
                for (let i = 0; i < this.MAX_SIZE; i++) {
                    if (!inv[i]) inv[i] = { id: this.EMPTY_ID, name: '', count: 0 };
                    if (inv[i].count == null) inv[i].count = 0;
                    if (!('id' in inv[i])) inv[i].id = this.EMPTY_ID;
                    if (!('name' in inv[i])) inv[i].name = '';
                }
            }

            toggle() { this.isOpen ? this.close() : this.open(); }

            open() {
                if (this.game.crafting && this.game.crafting.isOpen) this.game.crafting.close();
                this.ensureCapacity();
                this.isOpen = true;
                if (Utils && Utils.resetGameInput) Utils.resetGameInput(this.game);
                this.overlay.classList.add('open');
                this.overlay.setAttribute('aria-hidden', 'false');
                this._selectedIdx = (this.game.player && Number.isFinite(this.game.player.selectedSlot)) ? this.game.player.selectedSlot : 0;
                this.refresh(true);
                this._updateDetails();
            }

            close() {
                this._returnCursorItem();
                this.isOpen = false;
                this.overlay.classList.remove('open');
                this.overlay.setAttribute('aria-hidden', 'true');
                this._hideHeld();
            }

            /** @returns {boolean} */
            isBlockingInput() { return this.isOpen; }

            refresh(force = false) {
                this.ensureCapacity();

                const inv = this.game.player.inventory;
                const player = this.game.player;

                // 容量
                let used = 0;
                for (let i = 0; i < this.MAX_SIZE; i++) {
                    const it = inv[i];
                    if (it && it.count > 0) used++;
                }
                if (this.capacityText) this.capacityText.textContent = `${used}/${this.MAX_SIZE}`;
                if (this.capacityFill) this.capacityFill.style.width = `${Math.min(100, (used / this.MAX_SIZE) * 100)}%`;

                // slots
                for (let i = 0; i < this.MAX_SIZE; i++) {
                    const it = inv[i];
                    const empty = (!it || (it.count === 0 && it.id !== 'pickaxe'));
                    const slot = this._slotEls[i];

                    slot.classList.toggle('empty', empty);
                    slot.classList.toggle('active', (i < 9) && (i === player.selectedSlot));
                    slot.classList.toggle('selected', i === this._selectedIdx);

                    const idKey = empty ? null : it.id;
                    const countKey = empty ? 0 : it.count;

                    if (!force && this._lastId[i] === idKey && this._lastCount[i] === countKey) continue;
                    this._lastId[i] = idKey;
                    this._lastCount[i] = countKey;

                    const canvas = this._slotCanvases[i];
                    const cx = this._slotCtx[i];
                    const emoji = this._slotEmojiEls[i];
                    const countEl = this._slotCountEls[i];

                    // reset
                    canvas.style.display = 'none';
                    emoji.style.display = 'none';
                    countEl.style.display = 'none';

                    if (empty) continue;

                    if (it.id === 'pickaxe') {
                        emoji.textContent = it.icon || '⛏️';
                        emoji.style.display = '';
                    } else {
                        canvas.style.display = '';
                        cx.clearRect(0, 0, 34, 34);
                        const tex = (this.game.ui && this.game.ui.textures) ? this.game.ui.textures.get(it.id) : (this.game.renderer && this.game.renderer.textures ? this.game.renderer.textures.get(it.id) : null);
                        if (tex) cx.drawImage(tex, 0, 0, 34, 34);
                    }

                    if (it.id !== 'pickaxe' && it.count > 1) {
                        countEl.textContent = String(it.count);
                        countEl.style.display = '';
                    }
                }

                // 按钮状态
                const sel = this._getSelectedItem();
                const selMovable = !!(sel && sel.count > 0);
                if (this.btnToHotbar) this.btnToHotbar.disabled = !selMovable;
                if (this.btnDrop) this.btnDrop.disabled = !(sel && typeof sel.id === 'number' && sel.count > 0);
                if (this.btnPutBack) this.btnPutBack.disabled = !this._cursorItem;

                this._updateDetails();
            }

            _buildSlots() {
                // 清空容器（只构建一次）
                this.hotbarGrid.innerHTML = '';
                this.backpackGrid.innerHTML = '';

                for (let i = 0; i < this.MAX_SIZE; i++) {
                    const slot = document.createElement('div');
                    slot.className = 'inv-slot';
                    slot.dataset.idx = String(i);

                    if (i < 9 && !this.game.isMobile) {
                        const key = document.createElement('span');
                        key.className = 'key';
                        key.textContent = String(i + 1);
                        slot.appendChild(key);
                    }

                    const emoji = document.createElement('span');
                    emoji.className = 'item-icon';
                    emoji.style.display = 'none';
                    slot.appendChild(emoji);

                    const c = document.createElement('canvas');
                    c.width = c.height = 34;
                    c.style.display = 'none';
                    const cx = c.getContext('2d', { willReadFrequently: true });
                    cx.imageSmoothingEnabled = false;
                    slot.appendChild(c);

                    const count = document.createElement('span');
                    count.className = 'count';
                    count.style.display = 'none';
                    slot.appendChild(count);

                    slot.addEventListener('pointerdown', (e) => this._onSlotPointerDown(e));
                    slot.addEventListener('contextmenu', (e) => e.preventDefault());

                    if (i < 9) this.hotbarGrid.appendChild(slot);
                    else this.backpackGrid.appendChild(slot);

                    this._slotEls[i] = slot;
                    this._slotCanvases[i] = c;
                    this._slotCtx[i] = cx;
                    this._slotCountEls[i] = count;
                    this._slotEmojiEls[i] = emoji;
                }
            }

            _bind() {
                // 点击遮罩关闭
                this.overlay.addEventListener('click', (e) => {
                    if (e.target === this.overlay) this.close();
                });

                // close
                if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());

                // 移动端：滑动关闭（下滑优先，辅以右滑）
                try {
                    const isMobile = document.documentElement.classList.contains('is-mobile') ||
                        (window.matchMedia && (matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches));
                    if (isMobile && this.panel) {
                        let dragging = false;
                        let pid = null;
                        let sx = 0, sy = 0;
                        let lastDx = 0, lastDy = 0;

                        const canStart = (e) => {
                            // 不抢占格子拖拽/按钮点击
                            if (e.target && e.target.closest) {
                                if (e.target.closest('.inv-slot, .inv-btn, button, a, input, select, textarea')) return false;
                            }
                            // 允许从顶部区域/详情区域滑动
                            return true;
                        };

                        const onDown = (e) => {
                            if (!this.isOpen) return;
                            try { e.preventDefault(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                            if (e.pointerType !== 'touch') return;
                            if (!canStart(e)) return;
                            dragging = true;
                            pid = e.pointerId;
                            sx = e.clientX; sy = e.clientY;
                            lastDx = 0; lastDy = 0;
                            this.panel.classList.add('dragging');
                            try { this.panel.setPointerCapture(pid); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                        };

                        const onMove = (e) => {
                            if (!dragging || e.pointerId !== pid) return;
                            try { e.preventDefault(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                            lastDx = e.clientX - sx;
                            lastDy = e.clientY - sy;

                            // 以“下滑关闭”为主；横向轻微容错
                            const dy = Math.max(0, lastDy);
                            const dx = Math.max(0, lastDx);

                            const useDy = dy > dx * 0.8;
                            const offset = useDy ? Math.min(260, dy) : Math.min(220, dx * 0.75);
                            this.panel.style.setProperty('--inv-drag-y', offset.toFixed(0) + 'px');
                        };

                        const endDrag = () => {
                            if (!dragging) return;
                            dragging = false;
                            this.panel.classList.remove('dragging');

                            const dy = Math.max(0, lastDy);
                            const dx = Math.max(0, lastDx);
                            const shouldClose = (dy > 160 && dy > dx) || (dx > 200 && dx > dy);

                            if (shouldClose) {
                                this.panel.style.setProperty('--inv-drag-y', '0px');
                                this.close();
                            } else {
                                // 回弹
                                this.panel.style.setProperty('--inv-drag-y', '0px');
                            }

                            try { if (pid != null) this.panel.releasePointerCapture(pid); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                            pid = null;
                        };

                        this.panel.addEventListener('pointerdown', onDown, { passive: false });
                        this.panel.addEventListener('pointermove', onMove, { passive: false });
                        this.panel.addEventListener('pointerup', endDrag, { passive: true });
                        this.panel.addEventListener('pointercancel', endDrag, { passive: true });
                    }
                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                // 按钮
                if (this.btnTop) this.btnTop.addEventListener('click', () => this.toggle());
                if (this.btnFloat) this.btnFloat.addEventListener('click', () => this.toggle());

                if (this.btnSort) this.btnSort.addEventListener('click', () => { this._sortBackpack(); this._changed(); });
                if (this.btnToHotbar) this.btnToHotbar.addEventListener('click', () => { this._moveSelectedToHotbar(); this._changed(); });
                if (this.btnPutBack) this.btnPutBack.addEventListener('click', () => { this._returnCursorItem(); this._changed(); });
                if (this.btnDrop) this.btnDrop.addEventListener('click', () => { this._dropSelected(); this._changed(); });

                // 跟随鼠标/触摸显示拿起的物品
                this.overlay.addEventListener('pointermove', (e) => {
                    if (!this._cursorItem) return;
                    this._showHeldAt(e.clientX, e.clientY);
                }, { passive: true });

                this.overlay.addEventListener('pointerleave', () => {
                    // 留在屏幕边缘时保持显示（不隐藏）
                });
            }

            _onSlotPointerDown(e) {
                e.preventDefault();

                const idx = parseInt(e.currentTarget.dataset.idx, 10);
                this._selectedIdx = idx;
                if (idx < 9 && this.game && this.game.player) this.game.player.selectedSlot = idx;

                // Shift+点击：快速移动（桌面）
                if (e.shiftKey && !this._cursorItem) {
                    this._quickMove(idx);
                    this._changed();
                    return;
                }

                // 右键：拆分/放1个
                const isRight = (e.button === 2);
                if (isRight) {
                    this._rightClick(idx);
                    this._changed();
                    return;
                }

                // 左键：拿起/放下/交换
                this._leftClick(idx);
                this._changed();
            }

            _cloneItem(it) {
                if (!it) return null;
                const out = {};
                for (const k in it) out[k] = it[k];
                return out;
            }

            _isEmptySlot(i) {
                const it = this.game.player.inventory[i];
                return !it || (it.count === 0 && it.id !== 'pickaxe');
            }

            _clearSlot(i) {
                const it = this.game.player.inventory[i];
                if (!it) {
                    this.game.player.inventory[i] = { id: this.EMPTY_ID, name: '', count: 0 };
                    return;
                }
                it.id = this.EMPTY_ID;
                it.name = '';
                it.count = 0;
                // 清理镐子属性等
                delete it.power; delete it.speed; delete it.icon;
            }

            _setSlot(i, item) {
                const inv = this.game.player.inventory;
                if (!inv[i]) inv[i] = { id: this.EMPTY_ID, name: '', count: 0 };

                if (!item || item.count <= 0) {
                    this._clearSlot(i);
                    return;
                }

                // 直接覆盖字段（保持引用不变，避免其它地方持有 inv[i] 时失效）
                const s = inv[i];
                for (const k in s) delete s[k];
                for (const k in item) s[k] = item[k];
                if (!('name' in s)) s.name = '';
            }

            _getSelectedItem() {
                const it = this.game.player.inventory[this._selectedIdx];
                if (!it) return null;
                if (it.count === 0 && it.id !== 'pickaxe') return null;
                return it;
            }

            _leftClick(idx) {
                const inv = this.game.player.inventory;
                const it = inv[idx];

                const empty = (!it || (it.count === 0 && it.id !== 'pickaxe'));
                if (!this._cursorItem) {
                    if (empty) { this._hideHeld(); return; }
                    this._cursorItem = this._cloneItem(it);
                    this._cursorFrom = idx;
                    this._clearSlot(idx);
                    this._renderHeld();
                    return;
                }

                // 已拿起：放下/交换
                if (empty) {
                    this._setSlot(idx, this._cursorItem);
                    this._cursorItem = null;
                    this._cursorFrom = -1;
                    this._hideHeld();
                } else {
                    const tmp = this._cloneItem(it);
                    this._setSlot(idx, this._cursorItem);
                    this._cursorItem = tmp;
                    this._cursorFrom = idx;
                    this._renderHeld();
                }
            }

            _rightClick(idx) {
                const inv = this.game.player.inventory;
                const it = inv[idx];
                const empty = (!it || (it.count === 0 && it.id !== 'pickaxe'));

                // 没拿东西：拆半
                if (!this._cursorItem) {
                    if (empty) return;
                    if (it.id === 'pickaxe') return;
                    if (it.count <= 1) return;

                    const take = Math.ceil(it.count / 2);
                    const remain = it.count - take;

                    this._cursorItem = this._cloneItem(it);
                    this._cursorItem.count = take;
                    this._cursorFrom = -1;

                    it.count = remain;
                    if (it.count <= 0) this._clearSlot(idx);

                    this._renderHeld();
                    return;
                }

                // 拿着东西：往目标放 1 个（同类叠加/空位新建）
                if (this._cursorItem.id === 'pickaxe') return;
                if (this._cursorItem.count <= 0) { this._cursorItem = null; this._hideHeld(); return; }

                if (empty) {
                    const one = this._cloneItem(this._cursorItem);
                    one.count = 1;
                    this._setSlot(idx, one);
                    this._cursorItem.count -= 1;
                } else {
                    if (it.id !== this._cursorItem.id) return;
                    if (it.count >= this.MAX_STACK) return;
                    it.count += 1;
                    this._cursorItem.count -= 1;
                }

                if (this._cursorItem.count <= 0) {
                    this._cursorItem = null;
                    this._cursorFrom = -1;
                    this._hideHeld();
                } else {
                    this._renderHeld();
                }
            }

            _quickMove(idx) {
                const inv = this.game.player.inventory;
                const it = inv[idx];
                if (!it || (it.count === 0 && it.id !== 'pickaxe')) return;
                if (it.id === 'pickaxe') return; // 简化：镐子不参与快速移动

                const fromHotbar = idx < 9;
                const range = fromHotbar ? [9, this.MAX_SIZE - 1] : [0, 8];

                let remaining = it.count;

                // 1) 先叠加到同类堆
                for (let i = range[0]; i <= range[1] && remaining > 0; i++) {
                    const t = inv[i];
                    if (!t || t.count === 0) continue;
                    if (t.id !== it.id) continue;
                    const canAdd = Math.min(remaining, this.MAX_STACK - t.count);
                    if (canAdd <= 0) continue;
                    t.count += canAdd;
                    remaining -= canAdd;
                }

                // 2) 再放到空格
                for (let i = range[0]; i <= range[1] && remaining > 0; i++) {
                    const t = inv[i];
                    if (!t || (t.count === 0 && t.id !== 'pickaxe')) {
                        const piece = this._cloneItem(it);
                        piece.count = Math.min(remaining, this.MAX_STACK);
                        this._setSlot(i, piece);
                        remaining -= piece.count;
                    }
                }

                // 原格子扣除
                if (remaining <= 0) {
                    this._clearSlot(idx);
                } else {
                    it.count = remaining;
                }
            }

            _sortBackpack() {
                const inv = this.game.player.inventory;
                const start = 9;

                // collect
                const items = [];
                for (let i = start; i < this.MAX_SIZE; i++) {
                    const it = inv[i];
                    if (!it || (it.count === 0 && it.id !== 'pickaxe')) continue;
                    if (it.id === 'pickaxe') continue;
                    items.push(this._cloneItem(it));
                }

                // merge by id
                const map = new Map();
                for (const it of items) {
                    const key = it.id;
                    const prev = map.get(key) || 0;
                    map.set(key, prev + (it.count || 0));
                }

                const merged = [];
                for (const [id, total] of map.entries()) {
                    let left = total;
                    while (left > 0) {
                        const take = Math.min(left, this.MAX_STACK);
                        const bd = (typeof id === 'number') ? BLOCK_DATA[id] : null;
                        merged.push({ id, name: bd ? bd.name : ('' + id), count: take });
                        left -= take;
                    }
                }

                // sort (by name)
                merged.sort((a, b) => (String(a.name)).localeCompare(String(b.name), 'zh-Hans-CN-u-co-pinyin'));

                // clear backpack slots
                for (let i = start; i < this.MAX_SIZE; i++) this._clearSlot(i);

                // refill
                let ptr = start;
                for (const it of merged) {
                    if (ptr >= this.MAX_SIZE) break;
                    this._setSlot(ptr, it);
                    ptr++;
                }
            }

            _moveSelectedToHotbar() {
                const inv = this.game.player.inventory;
                const idx = this._selectedIdx;
                const it = this._getSelectedItem();
                if (!it) return;

                if (idx < 9) return;

                // 找空位，否则用当前选中栏位
                let target = -1;
                for (let i = 0; i < 9; i++) {
                    if (this._isEmptySlot(i)) { target = i; break; }
                }
                if (target < 0) target = this.game.player.selectedSlot || 0;

                const tmp = this._cloneItem(inv[target]);
                this._setSlot(target, this._cloneItem(it));
                if (tmp && !(tmp.count === 0 && tmp.id !== 'pickaxe')) {
                    this._setSlot(idx, tmp);
                } else {
                    this._clearSlot(idx);
                }

                this._selectedIdx = target;
            }

            _dropSelected() {
                const game = this.game;

                // 优先丢弃“手上拿起的物品”
                if (this._cursorItem) {
                    if (typeof this._cursorItem.id !== 'number') return;
                    const px = game.player.cx ? game.player.cx() : (game.player.x + game.player.w / 2);
                    const py = game.player.cy ? game.player.cy() : (game.player.y + game.player.h / 2);
                    game.droppedItems && game.droppedItems.spawn(px, py, this._cursorItem.id, this._cursorItem.count);
                    this._cursorItem = null;
                    this._cursorFrom = -1;
                    this._hideHeld();
                    return;
                }

                const idx = this._selectedIdx;
                const it = this._getSelectedItem();
                if (!it) return;
                if (typeof it.id !== 'number') return;

                const px = game.player.cx ? game.player.cx() : (game.player.x + game.player.w / 2);
                const py = game.player.cy ? game.player.cy() : (game.player.y + game.player.h / 2);

                game.droppedItems && game.droppedItems.spawn(px, py, it.id, it.count);
                this._clearSlot(idx);
            }

            _returnCursorItem() {
                if (!this._cursorItem) return;
                const inv = this.game.player.inventory;

                // 1) 尝试叠回同类（全背包范围）
                if (this._cursorItem.id !== 'pickaxe') {
                    let remaining = this._cursorItem.count;
                    for (let i = 0; i < this.MAX_SIZE && remaining > 0; i++) {
                        const t = inv[i];
                        if (!t || t.count === 0) continue;
                        if (t.id !== this._cursorItem.id) continue;
                        const canAdd = Math.min(remaining, this.MAX_STACK - t.count);
                        if (canAdd <= 0) continue;
                        t.count += canAdd;
                        remaining -= canAdd;
                    }
                    this._cursorItem.count = remaining;
                    if (this._cursorItem.count <= 0) {
                        this._cursorItem = null;
                        this._cursorFrom = -1;
                        this._hideHeld();
                        return;
                    }
                }

                // 2) 优先放回来源格（如果空）
                if (this._cursorFrom >= 0 && this._isEmptySlot(this._cursorFrom)) {
                    this._setSlot(this._cursorFrom, this._cursorItem);
                    this._cursorItem = null;
                    this._cursorFrom = -1;
                    this._hideHeld();
                    return;
                }

                // 3) 找任意空位
                for (let i = 0; i < this.MAX_SIZE; i++) {
                    if (this._isEmptySlot(i)) {
                        this._setSlot(i, this._cursorItem);
                        this._cursorItem = null;
                        this._cursorFrom = -1;
                        this._hideHeld();
                        return;
                    }
                }

                // 4) 没空位：放不回，保持拿起状态（不丢失）
                this._renderHeld();
            }

            _changed() {
                // 同步快捷栏 & 触发背包刷新（buildHotbar 内会派发 inventoryChanged 事件）
                if (this.game.ui) this.game.ui.buildHotbar();
                else this.refresh(false);
            }

            _updateDetails() {
                const it = this._getSelectedItem();

                // 预览
                this._previewCtx.clearRect(0, 0, 56, 56);
                this._previewCanvas.style.display = 'none';
                this._previewEmoji.style.display = 'none';

                if (!it) {
                    this.nameEl.textContent = '未选择';
                    this.metaEl.textContent = '';
                    this.descEl.textContent = this._cursorItem ? '已拿起物品：可点击格子放下，或点“放回”。' : '点击格子查看，或拖拽/点击交换。';
                    return;
                }

                this.nameEl.textContent = it.name || (it.id === 'pickaxe' ? '镐子' : '物品');
                const meta = [];
                if (it.id === 'pickaxe') meta.push('工具');
                else meta.push('方块');
                if (it.count != null && it.id !== 'pickaxe') meta.push(`数量 x${it.count}`);
                this.metaEl.textContent = meta.join(' · ');

                // 描述：使用 BLOCK_DATA
                if (typeof it.id === 'number' && window.BLOCK_DATA && BLOCK_DATA[it.id] && BLOCK_DATA[it.id].desc) {
                    this.descEl.textContent = BLOCK_DATA[it.id].desc;
                } else if (it.id === 'pickaxe') {
                    this.descEl.textContent = '用于挖掘方块。打开背包时可整理与移动物品。';
                } else {
                    this.descEl.textContent = '—';
                }

                if (it.id === 'pickaxe') {
                    this._previewEmoji.textContent = it.icon || '⛏️';
                    this._previewEmoji.style.display = '';
                } else {
                    const tex = (this.game.ui && this.game.ui.textures) ? this.game.ui.textures.get(it.id) : (this.game.renderer && this.game.renderer.textures ? this.game.renderer.textures.get(it.id) : null);
                    if (tex) {
                        this._previewCanvas.style.display = '';
                        this._previewCtx.drawImage(tex, 0, 0, 56, 56);
                    }
                }

                // 按钮状态
                if (this.btnToHotbar) this.btnToHotbar.disabled = !(it && it.count > 0 && this._selectedIdx >= 9);
                if (this.btnDrop) this.btnDrop.disabled = !(it && typeof it.id === 'number' && it.count > 0);
            }

            _renderHeld() {
                if (!this._cursorItem) { this._hideHeld(); return; }

                this._heldCtx.clearRect(0, 0, 34, 34);
                this._heldCanvas.style.display = 'none';
                this._heldEmoji.style.display = 'none';

                if (this._cursorItem.id === 'pickaxe') {
                    this._heldEmoji.textContent = this._cursorItem.icon || '⛏️';
                    this._heldEmoji.style.display = '';
                    this._heldCount.textContent = '';
                } else {
                    const tex = (this.game.ui && this.game.ui.textures) ? this.game.ui.textures.get(this._cursorItem.id) : (this.game.renderer && this.game.renderer.textures ? this.game.renderer.textures.get(this._cursorItem.id) : null);
                    if (tex) {
                        this._heldCanvas.style.display = '';
                        this._heldCtx.drawImage(tex, 0, 0, 34, 34);
                    }
                    this._heldCount.textContent = (this._cursorItem.count > 1) ? String(this._cursorItem.count) : '';
                }

                this.heldEl.style.display = 'flex';
            }

            _showHeldAt(x, y) {
                this.heldEl.style.left = x + 'px';
                this.heldEl.style.top = y + 'px';
            }

            _hideHeld() {
                this.heldEl.style.display = 'none';
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { InventoryUI });

    </script>

    <!-- ========================= SECTION: Input ========================= -->

window.TU = window.TU || {};
Object.assign(window.TU, { InventoryUI });
