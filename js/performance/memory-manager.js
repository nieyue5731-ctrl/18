// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Memory Manager
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 内存优化工具 (防御性重构版) ═══════════════════
        const MemoryManager = {
            _lastCleanup: 0,
            _cleanupInterval: 30000, // 30秒清理一次
            _cleanupCount: 0,
            _maxCleanups: 10000, // 防止无限清理
            
            tick(now) {
                // 验证时间戳
                if (!Number.isFinite(now)) {
                    console.warn('[MemoryManager] Invalid timestamp');
                    return;
                }
                
                // 防止清理次数过多
                if (this._cleanupCount >= this._maxCleanups) {
                    return;
                }
                
                if (now - this._lastCleanup > this._cleanupInterval) {
                    this._lastCleanup = now;
                    this._cleanupCount++;
                    this.cleanup();
                }
            },

            cleanup() {
                try {
                    // 清理对象池中过多的对象
                    if (window.ObjectPool && window.ObjectPool._pools) {
                        window.ObjectPool._pools.forEach((pool, type) => {
                            if (Array.isArray(pool) && pool.length > 100) {
                                // 清理多余对象的引用
                                for (let i = 100; i < pool.length; i++) {
                                    const obj = pool[i];
                                    if (obj && typeof obj === 'object') {
                                        Object.keys(obj).forEach(key => { obj[key] = null; });
                                    }
                                }
                                pool.length = 100;
                            }
                        });
                    }
                    
                    if (window.VecPool && Array.isArray(window.VecPool._pool) && window.VecPool._pool.length > 100) {
                        window.VecPool._pool.length = 100;
                    }
                    
                    if (window.ArrayPool && window.ArrayPool._pools) {
                        window.ArrayPool._pools.forEach((pool) => {
                            if (Array.isArray(pool) && pool.length > 20) {
                                pool.length = 20;
                            }
                        });
                    }
                } catch (e) {
                    console.error('[MemoryManager] Cleanup error:', e);
                }
            },

            getStats() {
                const stats = {
                    objectPools: 0,
                    vecPool: 0,
                    arrayPools: 0,
                    cleanupCount: this._cleanupCount
                };
                
                try {
                    if (window.VecPool && Array.isArray(window.VecPool._pool)) {
                        stats.vecPool = window.VecPool._pool.length;
                    }
                    if (window.ObjectPool && window.ObjectPool._pools) {
                        window.ObjectPool._pools.forEach(pool => {
                            if (Array.isArray(pool)) stats.objectPools += pool.length;
                        });
                    }
                    if (window.ArrayPool && window.ArrayPool._pools) {
                        window.ArrayPool._pools.forEach(pool => {
                            if (Array.isArray(pool)) stats.arrayPools += pool.length;
                        });
                    }
                } catch (e) {
                    console.error('[MemoryManager] Stats error:', e);
                }
                
                return stats;
            },
            
            reset() {
                this._cleanupCount = 0;
                this._lastCleanup = 0;
            }
        };
        window.MemoryManager = MemoryManager;

window.MemoryManager = MemoryManager;
