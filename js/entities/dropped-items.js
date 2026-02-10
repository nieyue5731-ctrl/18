// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Dropped Item System
// Merged: pickup animation patches (startPickup, canPickup, update, render)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

    <!-- ========================= MODULE: entities/dropped_items ========================= -->
    <script>
        // ═══════════════════════════════════════════════════════════════════════════════
        class DroppedItem {
            constructor(x, y, blockId, count = 1) {
                this.x = x;
                this.y = y;
                this.w = 12;
                this.h = 12;
                this.vx = (Math.random() - 0.5) * 4; // 随机水平速度
                this.vy = -3 - Math.random() * 2; // 向上弹出
                this.blockId = blockId;
                this.count = count;
                this.age = 0;
                this.maxAge = 60000; // 60秒后消失
                this.bobOffset = Math.random() * Math.PI * 2; // 浮动动画偏移
                this.rotation = 0;
                this.grounded = false;
                this.pickupDelay = 500; // 500ms后才能拾取，防止刚挖掘就捡起
                this.magnetRange = 48; // 磁吸范围（像素）
                this.pickupRange = 20; // 拾取范围（像素）
                // 拾取动画状态（对象池复用时必须清理）
                this._pickup = null;
                this._pickupAlpha = 1;
                this._pickupScale = 1;
            }

            // 对象池复用：避免频繁 new/GC（掉落物密集时明显提升流畅度）
            reset(x, y, blockId, count = 1) {
                this.x = x;
                this.y = y;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -3 - Math.random() * 2;
                this.blockId = blockId;
                this.count = count;
                this.age = 0;
                // maxAge / w / h 保持不变
                this.bobOffset = Math.random() * Math.PI * 2;
                this.rotation = 0;
                this.grounded = false;
                this.pickupDelay = 500;
                this.magnetRange = 48;
                this.pickupRange = 20;
                // 清理拾取动画残留状态（避免对象池复用导致后续掉落物瞬间消失/无法拾取）
                this._pickup = null;
                this._pickupAlpha = 1;
                this._pickupScale = 1;
                return this;
            }

            update(world, player, dt) {
                this.age += dt;

                // 超时消失
                if (this.age >= this.maxAge) {
                    return false; // 返回false表示应该移除
                }

                // 重力
                this.vy += CONFIG.GRAVITY * 0.5;
                this.vy = Math.min(this.vy, CONFIG.MAX_FALL_SPEED * 0.5);

                // 摩擦力
                if (this.grounded) {
                    this.vx *= 0.85;
                } else {
                    this.vx *= 0.98;
                }

                // 移动和碰撞
                this._moveCollide(world, this.vx, 0);
                this.grounded = false;
                this._moveCollide(world, 0, this.vy);

                // 旋转（只在空中旋转）
                if (!this.grounded) {
                    this.rotation += this.vx * 0.05;
                }

                // 磁吸效果：当玩家靠近时，掉落物被吸引
                if (this.age > this.pickupDelay) {
                    const dx = player.cx() - (this.x + this.w / 2);
                    const dy = player.cy() - (this.y + this.h / 2);
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // dist 可能为 0（玩家与掉落物中心重合），避免除以 0 导致 NaN 速度
                    if (dist > 1e-6 && dist < this.magnetRange) {
                        // 越近吸引力越强
                        const force = (1 - dist / this.magnetRange) * 0.5;
                        const inv = 1 / dist;
                        this.vx += dx * inv * force * 3;
                        this.vy += dy * inv * force * 3;
                        this.grounded = false; // 被吸引时可以飞起来
                    }
                }

                return true; // 返回true表示继续存在
            }

            _moveCollide(world, dx, dy) {
                const ts = CONFIG.TILE_SIZE;

                // 水平移动
                if (dx !== 0) {
                    this.x += dx;
                    if (this._collides(world)) {
                        this.x -= dx;
                        this.vx = -this.vx * 0.3; // 反弹
                    }
                }

                // 垂直移动
                if (dy !== 0) {
                    this.y += dy;
                    if (this._collides(world)) {
                        this.y -= dy;
                        if (dy > 0) {
                            this.grounded = true;
                            this.vy = 0;
                        } else {
                            this.vy = 0;
                        }
                    }
                }

                // 防止掉出世界边界
                this.x = Utils.clamp(this.x, 0, world.w * ts - this.w);
                this.y = Utils.clamp(this.y, 0, world.h * ts - this.h);
            }

            _collides(world) {
                const ts = CONFIG.TILE_SIZE;
                const l = Math.floor(this.x / ts);
                const r = Math.floor((this.x + this.w - 0.001) / ts);
                const t = Math.floor(this.y / ts);
                const b = Math.floor((this.y + this.h - 0.001) / ts);

                for (let tx = l; tx <= r; tx++) {
                    if (tx < 0 || tx >= world.w) continue;
                    const col = world.tiles[tx];
                    for (let ty = t; ty <= b; ty++) {
                        if (ty < 0 || ty >= world.h) continue;
                        if (BLOCK_SOLID[col[ty]]) return true;
                    }
                }
                return false;
            }

            canPickup(player) {
                if (this.age < this.pickupDelay) return false;

                const dx = player.cx() - (this.x + this.w / 2);
                const dy = player.cy() - (this.y + this.h / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);

                return dist < this.pickupRange;
            }

            cx() { return this.x + this.w / 2; }
            cy() { return this.y + this.h / 2; }
        }

        class DroppedItemManager {
            constructor() {
                // 使用“头指针 + 空洞”来避免 shift/splice 的高频 O(n) 开销
                this.items = [];
                this.maxItems = 200; // 最大掉落物数量
                this._start = 0;
                this._holes = 0;

                // 对象池：减少密集掉落时的 GC 抖动
                this._pool = [];
                this._poolCap = 256;

                // Spatial hash (no allocations per-frame)
                this._shBucketCount = 1024; // power-of-two
                this._shMask = this._shBucketCount - 1;
                this._shHead = new Int32Array(this._shBucketCount);
                this._shNext = new Int32Array(this.maxItems);
                this._shCellSize = CONFIG.TILE_SIZE * 6; // px
                this._shLastCap = this.maxItems;
            }

            _acquire(x, y, blockId, count) {
                const it = this._pool.pop();
                if (it) return it.reset(x, y, blockId, count);
                return new DroppedItem(x, y, blockId, count);
            }

            _release(it) {
                if (!it) return;
                // 清理拾取动画残留（与对象池复用配合，避免下一次 spawn 直接“秒消失”）
                it._pickup = null;
                it._pickupAlpha = 1;
                it._pickupScale = 1;
                if (this._pool.length < this._poolCap) this._pool.push(it);
            }

            _maybeCompact(force = false) {
                if (!force) {
                    // 空洞很多 or 头指针推进太多时才压缩，避免每帧分配新数组
                    if (this._holes < 96 && (this._start < 256 || this._start <= (this.items.length >> 1))) return;
                }
                const next = [];
                for (let i = this._start; i < this.items.length; i++) {
                    const it = this.items[i];
                    if (it) next.push(it);
                }
                this.items = next;
                this._start = 0;
                this._holes = 0;
            }

            spawn(x, y, blockId, count = 1) {
                if (count <= 0) return;

                // 如果掉落物太多，淘汰最老的（O(1) 摊还）
                while ((this.items.length - this._start) >= this.maxItems) {
                    const old = this.items[this._start];
                    if (old) this._release(old);
                    this.items[this._start] = null;
                    this._start++;
                    this._holes++;
                }

                this.items.push(this._acquire(x, y, blockId, count));

                // 防止 items 无限增长：定期压缩
                if (this._start > 128 && this._start > (this.items.length >> 1)) {
                    this._maybeCompact(true);
                }
            }

            update(world, player, dt, addToInventoryCallback) {
                // Rebuild spatial hash each frame (O(N), but bucketed query reduces pickup cost)
                // IMPORTANT: no allocations here.
                const head = this._shHead;
                head.fill(-1);

                // IMPORTANT: items 数组会因“头指针+空洞”策略而出现 length > maxItems 的情况，
                // 这会导致使用 items 索引写入/读取 _shNext 越界，从而在哈希链遍历时出现 undefined -> 死循环。
                // 这里确保 _shNext 的容量始终覆盖 items.length。
                let next = this._shNext;
                const need = this.items.length;
                if (!next || next.length < need) {
                    let cap = (next && next.length) ? next.length : 16;
                    while (cap < need) cap <<= 1;
                    next = this._shNext = new Int32Array(cap);
                    this._shLastCap = cap;
                }

                const cs = this._shCellSize;
                const mask = this._shMask;

                // Update physics for all items + build hash for alive items
                for (let i = this.items.length - 1; i >= this._start; i--) {
                    const item = this.items[i];
                    if (!item) continue;

                    const alive = item.update(world, player, dt);
                    if (!alive) {
                        this._release(item);
                        this.items[i] = null;
                        this._holes++;
                        continue;
                    }

                    // Hash insert (bucket-only, collisions tolerated; distance check later)
                    const cx = (item.x / cs) | 0;
                    const cy = (item.y / cs) | 0;
                    const h = (((cx * 73856093) ^ (cy * 19349663)) >>> 0) & mask;
                    next[i] = head[h];
                    head[h] = i;
                }

                // Fast pickup query: only cells near player
                const px = player.cx ? player.cx() : (player.x || 0);
                const py = player.cy ? player.cy() : (player.y || 0);
                const pr = CONFIG.TILE_SIZE * 3; // pickup reach approx
                const minCx = ((px - pr) / cs) | 0, maxCx = ((px + pr) / cs) | 0;
                const minCy = ((py - pr) / cs) | 0, maxCy = ((py + pr) / cs) | 0;

                for (let cy = minCy; cy <= maxCy; cy++) {
                    for (let cx = minCx; cx <= maxCx; cx++) {
                        const h = (((cx * 73856093) ^ (cy * 19349663)) >>> 0) & mask;
                        let idx = head[h];
                        while (idx !== -1) {
                            const it = this.items[idx];
                            const nxt = next[idx];
                            if (it) {
                                // precise check
                                if (it.canPickup(player)) {
                                    const picked = addToInventoryCallback(it.blockId, it.count);
                                    if (picked) {
                                        this._release(it);
                                        this.items[idx] = null;
                                        this._holes++;
                                    }
                                }
                            }
                            idx = nxt;
                        }
                    }
                }

                // Advance head pointer (skip holes)
                while (this._start < this.items.length && !this.items[this._start]) {
                    this._start++;
                    this._holes = Math.max(0, this._holes - 1);
                }

                this._maybeCompact(false);
            }

            render(ctx, cam, textures, timeOfDay) {
                const ts = CONFIG.TILE_SIZE;
                const now = performance.now();
                const blinkPhase = Math.floor(now / 200) % 2;

                for (let i = this._start; i < this.items.length; i++) {
                    const item = this.items[i];
                    if (!item) continue;
                    const sx = item.x - cam.x;
                    const sy = item.y - cam.y;

                    // 浮动效果
                    const bob = Math.sin(now * 0.005 + item.bobOffset) * 3;

                    // 闪烁效果（快消失时）
                    const timeLeft = item.maxAge - item.age;
                    if (timeLeft < 5000 && blinkPhase === 0) {
                        continue; // 跳过渲染实现闪烁
                    }

                    ctx.save();
                    ctx.translate(sx + item.w / 2, sy + item.h / 2 + bob);
                    ctx.rotate(item.rotation);

                    // 发光效果（用查表避免每帧对象查找）
                    const lightLv = BLOCK_LIGHT[item.blockId];
                    if (lightLv > 0) {
                        ctx.shadowColor = BLOCK_COLOR[item.blockId] || '#fff';
                        ctx.shadowBlur = 15;
                    } else {
                        // 普通物品也有轻微发光
                        ctx.shadowColor = '#ffeaa7';
                        ctx.shadowBlur = 8;
                    }

                    // 绘制物品
                    const tex = textures.get(item.blockId);
                    if (tex) {
                        ctx.drawImage(tex, -item.w / 2, -item.h / 2, item.w, item.h);
                    } else {
                        // 后备渲染 (fixed: bd was undefined, use BLOCK_COLOR lookup)
                        ctx.fillStyle = BLOCK_COLOR[item.blockId] || '#fff';
                        ctx.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
                    }

                    ctx.shadowBlur = 0;

                    // 显示数量（如果大于1）
                    if (item.count > 1) {
                        ctx.fillStyle = '#ffeaa7';
                        ctx.font = 'bold 8px Arial';
                        ctx.textAlign = 'right';
                        ctx.fillText(item.count.toString(), item.w / 2, item.h / 2);
                    }

                    ctx.restore();
                }
            }

            clear() {
                for (let i = this._start; i < this.items.length; i++) {
                    const it = this.items[i];
                    if (it) this._release(it);
                }
                this.items = [];
                this._start = 0;
                this._holes = 0;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                 环境粒子系统

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { DroppedItem, DroppedItemManager });

    </script>


window.TU = window.TU || {};
Object.assign(window.TU, { DroppedItem, DroppedItemManager });
