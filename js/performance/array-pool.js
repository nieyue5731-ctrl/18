// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Array Pool (O(1) release via _pooled tag)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 数组池优化 (防御性重构版) ═══════════════════
        const ArrayPool = {
            _pools: new Map(),
            _typeCount: 0,
            MAX_TYPES: 10,
            MAX_POOL_SIZE: 50,
            
            get(size = 0) {
                // 验证size参数
                const safeSize = Number.isInteger(size) && size >= 0 ? size : 0;
                const key = safeSize <= 16 ? 16 : safeSize <= 64 ? 64 : safeSize <= 256 ? 256 : 1024;
                
                let pool = this._pools.get(key);
                if (!pool) {
                    if (this._typeCount >= this.MAX_TYPES) {
                        console.warn('[ArrayPool] Type quota exceeded');
                        return new Array(safeSize);
                    }
                    pool = [];
                    this._pools.set(key, pool);
                    this._typeCount++;
                }
                
                if (pool.length > 0) {
                    const arr = pool.pop();
                    if (Array.isArray(arr)) {
                        arr.length = 0;
                        arr._pooled = false; // mark as acquired
                        return arr;
                    }
                }
                return new Array(safeSize);
            },
            
            release(arr) {
                // 严格验证
                if (!Array.isArray(arr)) {
                    console.warn('[ArrayPool] Attempted to release non-array');
                    return;
                }
                
                // 防止重复释放
                const len = arr.length;
                const key = len <= 16 ? 16 : len <= 64 ? 64 : len <= 256 ? 256 : 1024;
                let pool = this._pools.get(key);
                
                if (!pool) {
                    if (this._typeCount >= this.MAX_TYPES) return;
                    pool = [];
                    this._pools.set(key, pool);
                    this._typeCount++;
                }
                
                if (pool.length < this.MAX_POOL_SIZE) {
                    // Tag-based double-release prevention (O(1) vs O(n) includes)
                    if (arr._pooled) return;
                    arr._pooled = true;
                    arr.length = 0;
                    pool.push(arr);
                }
            },
            
            getStats() {
                let totalArrays = 0;
                this._pools.forEach(pool => { totalArrays += pool.length; });
                return {
                    typeCount: this._typeCount,
                    totalArrays: totalArrays,
                    maxTypes: this.MAX_TYPES,
                    maxPoolSize: this.MAX_POOL_SIZE
                };
            },
            
            clear() {
                this._pools.clear();
                this._typeCount = 0;
            }
        };
        window.ArrayPool = ArrayPool;

window.ArrayPool = ArrayPool;
