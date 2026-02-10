// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Vector Pool (O(1) release via _pooled tag)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 向量池优化 (防御性重构版) ═══════════════════
        const VecPool = {
            _pool: [],
            _maxSize: 200,
            _releasedCount: 0,
            _acquiredCount: 0,
            
            get(x = 0, y = 0) {
                // 验证坐标参数
                const safeX = Number.isFinite(x) ? x : 0;
                const safeY = Number.isFinite(y) ? y : 0;
                
                this._acquiredCount++;
                
                if (this._pool.length > 0) {
                    const v = this._pool.pop();
                    if (v && typeof v === 'object') {
                        v.x = safeX;
                        v.y = safeY;
                        v._pooled = false; // mark as acquired
                        return v;
                    }
                }
                return { x: safeX, y: safeY, _pooled: false };
            },
            
            release(v) {
                // 严格验证
                if (!v || typeof v !== 'object') return;
                
                // 防止重复释放：use tag instead of O(n) includes()
                if (v._pooled) return;
                
                this._releasedCount++;
                
                if (this._pool.length < this._maxSize) {
                    v.x = 0;
                    v.y = 0;
                    v._pooled = true;
                    this._pool.push(v);
                }
            },
            
            getStats() {
                return {
                    poolSize: this._pool.length,
                    maxSize: this._maxSize,
                    acquired: this._acquiredCount,
                    released: this._releasedCount
                };
            },
            
            clear() {
                this._pool = [];
                this._acquiredCount = 0;
                this._releasedCount = 0;
            }
        };
        window.VecPool = VecPool;

window.VecPool = VecPool;
