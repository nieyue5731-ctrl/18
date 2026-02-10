// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Inventory System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class InventorySystem {
            /** @param {Game} game */
            constructor(game) {
                this.game = game;
            }

            /**
             * @param {string} blockId
             * @param {number} [count=1]
             * @returns {boolean}
             */
            add(blockId, count = 1) {
                const game = this.game;

                const blockData = BLOCK_DATA[blockId];
                if (!blockData) return false;

                const MAX_INVENTORY_SIZE = INVENTORY_LIMITS.MAX_SIZE; // 最大背包容量（保持原值 36）
                const MAX_STACK_SIZE = INVENTORY_LIMITS.MAX_STACK;    // 单个物品堆叠上限（保持原值 999）

                let remaining = count;

                const refreshHotbar = () => {
                    // 保持原有行为：每次发生可见变更时即时刷新（但要容错，避免 UI 尚未初始化时报错）
                    try {
                        if (game && game.ui && typeof game.ui.buildHotbar === 'function') game.ui.buildHotbar();
                    } catch { }
                };

                // 1) 优先堆叠到已有同类物品
                for (let item of game.player.inventory) {
                    if (item.id === blockId && item.count < MAX_STACK_SIZE) {
                        const canAdd = Math.min(remaining, MAX_STACK_SIZE - item.count);
                        item.count += canAdd;
                        remaining -= canAdd;

                        if (remaining <= 0) {
                            refreshHotbar();
                            return true;
                        }
                    }
                }

                // 2) 填充空槽位（count 为 0 的格子），保留原逻辑：不覆盖镐子槽
                for (let item of game.player.inventory) {
                    if (item.count === 0 && item.id !== 'pickaxe') {
                        const canAdd = Math.min(remaining, MAX_STACK_SIZE);
                        item.id = blockId;
                        item.name = blockData.name;
                        item.count = canAdd;
                        remaining -= canAdd;

                        if (remaining <= 0) {
                            refreshHotbar();
                            return true;
                        }
                    }
                }

                // 3) 如果没有空槽位，尝试背包扩展（push 新槽位）
                while (remaining > 0 && game.player.inventory.length < MAX_INVENTORY_SIZE) {
                    const canAdd = Math.min(remaining, MAX_STACK_SIZE);
                    game.player.inventory.push({
                        id: blockId,
                        name: blockData.name,
                        count: canAdd
                    });
                    remaining -= canAdd;
                }

                // 4) 更新 UI（保持原逻辑：即使未完全拾取也刷新已变化部分）
                refreshHotbar();

                if (remaining <= 0) return true;

                // 5) 背包满：返回 false，让物品留在地上（保持原输出）
                try { Toast.show(`🎒 背包已满：${blockData.name} 未能全部拾取`, 1600); } catch { }
                return false;

            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { InventorySystem });

    </script>

    <!-- ========================= SECTION: Game State & Loop ========================= -->

window.TU = window.TU || {};
Object.assign(window.TU, { InventorySystem });
