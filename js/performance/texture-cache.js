// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Texture Cache (Map-based LRU, O(1))
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 纹理缓存优化 (防御性重构版) ═══════════════════
        // TextureCache: O(1) LRU using Map iteration order (delete+re-insert)
        const TextureCache = {
            _cache: new Map(),  // Map preserves insertion order; delete+set = move to end
            _maxSize: 200,
            _hitCount: 0,
            _missCount: 0,

            get(key) {
                if (key === undefined || key === null) return null;
                
                const val = this._cache.get(key);
                if (val !== undefined) {
                    this._hitCount++;
                    // O(1) LRU update: delete and re-insert moves key to end
                    this._cache.delete(key);
                    this._cache.set(key, val);
                    return val;
                }
                
                this._missCount++;
                return null;
            },

            set(key, value) {
                if (key === undefined || key === null) return;
                
                // Update existing: delete first to refresh insertion order
                if (this._cache.has(key)) {
                    this._cache.delete(key);
                    this._cache.set(key, value);
                    return;
                }

                // LRU eviction: Map.keys().next() gives oldest entry in O(1)
                while (this._cache.size >= this._maxSize) {
                    const oldest = this._cache.keys().next().value;
                    const cached = this._cache.get(oldest);
                    if (cached && cached.src) cached.src = '';
                    this._cache.delete(oldest);
                }

                this._cache.set(key, value);
            },
            
            getStats() {
                const total = this._hitCount + this._missCount;
                return {
                    size: this._cache.size,
                    maxSize: this._maxSize,
                    hits: this._hitCount,
                    misses: this._missCount,
                    hitRate: total > 0 ? (this._hitCount / total * 100).toFixed(2) + '%' : 'N/A'
                };
            },

            clear() {
                this._cache.forEach(texture => {
                    if (texture && texture.src) texture.src = '';
                });
                this._cache.clear();
                this._hitCount = 0;
                this._missCount = 0;
            }
        };
        window.TextureCache = TextureCache;

window.TextureCache = TextureCache;
