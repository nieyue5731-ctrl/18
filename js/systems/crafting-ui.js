// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Crafting System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class CraftingSystem {
            constructor(game) {
                this.game = game;
                this.isOpen = false;
                this.selectedRecipe = null;

                this.overlay = document.getElementById('crafting-overlay');
                this.grid = document.getElementById('craft-grid');
                this.closeBtn = document.getElementById('craft-close');
                this.craftBtn = document.getElementById('craft-action-btn');
                this.toggleBtn = document.getElementById('btn-craft-toggle');

                this._init();
            }

            _init() {
                this.closeBtn.addEventListener('click', () => this.close());
                this.toggleBtn.addEventListener('click', () => this.toggle());
                this.craftBtn.addEventListener('click', () => this.craft());

                // 点击遮罩关闭
                this.overlay.addEventListener('click', (e) => {
                    if (e.target === this.overlay) this.close();
                });
            }

            toggle() {
                if (this.isOpen) this.close();
                else this.open();
            }

            open() {
                this.isOpen = true;
                if (Utils && Utils.resetGameInput) Utils.resetGameInput(this.game);
                this.overlay.classList.add('open');
                this.refresh();
                this.selectRecipe(this.selectedRecipe || RECIPES[0]);
            }

            close() {
                this.isOpen = false;
                this.overlay.classList.remove('open');
            }

            refresh() {
                this.grid.innerHTML = '';

                RECIPES.forEach(recipe => {
                    const canCraft = this._canCraft(recipe);
                    const slot = document.createElement('div');
                    slot.className = `craft-slot ${canCraft ? 'can-craft' : ''}`;
                    if (this.selectedRecipe === recipe) slot.classList.add('selected');

                    // 绘制图标
                    const tex = this.game.renderer.textures.get(recipe.out);
                    if (tex) {
                        const c = document.createElement('canvas');
                        c.width = 32; c.height = 32;
                        const ctx = c.getContext('2d', { willReadFrequently: true });
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(tex, 0, 0, 32, 32);
                        slot.appendChild(c);
                    }

                    slot.addEventListener('click', () => this.selectRecipe(recipe));
                    this.grid.appendChild(slot);
                });
            }

            selectRecipe(recipe) {
                this.selectedRecipe = recipe;

                // 更新网格选中状态
                const slots = this.grid.children;
                RECIPES.forEach((r, i) => {
                    if (slots[i]) slots[i].classList.toggle('selected', r === recipe);
                });

                // 更新详情
                const info = BLOCK_DATA[recipe.out];
                document.getElementById('craft-title').textContent = `${info.name} (x${recipe.count})`;
                document.getElementById('craft-desc').textContent = recipe.desc;

                // 预览图
                const preview = document.getElementById('craft-preview');
                preview.innerHTML = '';
                const tex = this.game.renderer.textures.get(recipe.out);
                if (tex) {
                    const c = document.createElement('canvas');
                    c.width = 48; c.height = 48;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(tex, 0, 0, 48, 48);
                    preview.appendChild(c);
                }

                // 原料列表
                const ingList = document.getElementById('craft-ingredients');
                ingList.innerHTML = '';
                let allHave = true;

                recipe.req.forEach(req => {
                    const have = this._countItem(req.id);
                    const needed = req.count;
                    const isEnough = have >= needed;
                    if (!isEnough) allHave = false;

                    const reqInfo = BLOCK_DATA[req.id];

                    const div = document.createElement('div');
                    div.className = `ingredient ${isEnough ? '' : 'missing'}`;
                    div.innerHTML = `
                <span class="ing-name">${reqInfo.name}</span>
                <span class="ing-count ${isEnough ? 'ok' : 'bad'}">${have}/${needed}</span>
            `;
                    ingList.appendChild(div);
                });

                // 按钮状态
                this.craftBtn.disabled = !allHave;
                this.craftBtn.textContent = allHave ? "制造" : "材料不足";
            }

            craft() {
                if (!this.selectedRecipe || !this._canCraft(this.selectedRecipe)) return;

                // 扣除材料
                this.selectedRecipe.req.forEach(req => {
                    this._consumeItem(req.id, req.count);
                });

                // 添加结果
                this.game._addToInventory(this.selectedRecipe.out, this.selectedRecipe.count);

                // 刷新界面
                this.refresh();
                this.selectRecipe(this.selectedRecipe);

                // 更新快捷栏
                this.game.ui.buildHotbar();
            }

            _canCraft(recipe) {
                return recipe.req.every(req => this._countItem(req.id) >= req.count);
            }

            _countItem(id) {
                let count = 0;
                for (const item of this.game.player.inventory) {
                    if (item.id === id) count += item.count;
                }
                return count;
            }

            _consumeItem(id, count) {
                let remaining = count;
                for (const item of this.game.player.inventory) {
                    if (item.id === id) {
                        const take = Math.min(item.count, remaining);
                        item.count -= take;
                        remaining -= take;
                        if (remaining <= 0) break;
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                   UI管理器 (美化版)

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { CraftingSystem });

    </script>

    <!-- ========================= MODULE: systems/ui_flush ========================= -->

window.TU = window.TU || {};
Object.assign(window.TU, { CraftingSystem });
