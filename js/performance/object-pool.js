// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Object Pool (Defensive, no property-clearing anti-pattern)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 对象池优化 (防御性重构版) ═══════════════════
        const ObjectPool = {
            _pools: new Map(),
            _typeCount: 0,
            MAX_TYPES: 100,
            MAX_POOL_SIZE: 500,
            
            get(type, factory) {
                // 验证类型参数
                if (typeof type !== 'string' || type.length === 0) {
                    console.warn('[ObjectPool] Invalid type parameter');
                    return factory();
                }
                
                let pool = this._pools.get(type);
                if (!pool) {
                    // 配额限制检查
                    if (this._typeCount >= this.MAX_TYPES) {
                        console.warn('[ObjectPool] Type quota exceeded');
                        return factory();
                    }
                    pool = [];
                    this._pools.set(type, pool);
                    this._typeCount++;
                }
                
                if (pool.length > 0) {
                    return pool.pop();
                }
                return factory();
            },
            
            release(type, obj) {
                // 验证参数
                if (!obj || typeof obj !== 'object') {
                    console.warn('[ObjectPool] Invalid object to release');
                    return;
                }
                
                if (typeof type !== 'string') {
                    console.warn('[ObjectPool] Invalid type for release');
                    return;
                }
                
                let pool = this._pools.get(type);
                if (!pool) {
                    if (this._typeCount >= this.MAX_TYPES) return;
                    pool = [];
                    this._pools.set(type, pool);
                    this._typeCount++;
                }
                
                if (pool.length < this.MAX_POOL_SIZE) {
                    pool.push(obj);
                }
            },
            
            clear(type) {
                if (type) {
                    if (this._pools.has(type)) {
                        this._pools.delete(type);
                        this._typeCount = Math.max(0, this._typeCount - 1);
                    }
                } else {
                    this._pools.clear();
                    this._typeCount = 0;
                }
            },
            
            getStats() {
                let totalObjects = 0;
                this._pools.forEach(pool => { totalObjects += pool.length; });
                return {
                    typeCount: this._typeCount,
                    totalObjects: totalObjects,
                    maxTypes: this.MAX_TYPES,
                    maxPoolSize: this.MAX_POOL_SIZE
                };
            }
        };

window.ObjectPool = ObjectPool;
