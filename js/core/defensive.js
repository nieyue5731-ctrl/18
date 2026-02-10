// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Defensive Infrastructure (Consolidated)
// Merged from TU_Defensive IIFE
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

(function(global) {
    'use strict';

    // =============================================================================
    // 1. 常量定义
    // =============================================================================

    const WorkerState = Object.freeze({
        IDLE: 'idle',
        INITIALIZING: 'initializing',
        READY: 'ready',
        GENERATING: 'generating',
        RENDERING: 'rendering',
        ERROR: 'error',
        TERMINATED: 'terminated'
    });

    const ErrorSeverity = Object.freeze({
        DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', FATAL: 'fatal'
    });

    const EventTypes = Object.freeze({
        TILE_CHANGED: 'tile:changed',
        LIGHT_UPDATED: 'light:updated',
        PLAYER_MOVED: 'player:moved',
        WEATHER_CHANGED: 'weather:changed',
        WORLD_LOADED: 'world:loaded',
        WORKER_ERROR: 'worker:error',
        RENDER_FRAME: 'render:frame'
    });

    // =============================================================================
    // 2. 全局错误计数与熔断
    // =============================================================================

    global.__TU_ERROR_COUNT__ = 0;
    global.__TU_MAX_ERRORS__ = 100;
    global.__TU_FATAL_ERROR__ = false;

    global.onerror = function(msg, url, line, col, error) {
        global.__TU_ERROR_COUNT__++;
        console.error(`[Global Error #${global.__TU_ERROR_COUNT__}]`, { msg, url, line, col, error });
        if (global.__TU_ERROR_COUNT__ > global.__TU_MAX_ERRORS__) {
            global.__TU_FATAL_ERROR__ = true;
            console.error('[CRITICAL] 错误数量超过阈值，系统进入安全模式');
            if (global.game && typeof global.game.pause === 'function') {
                global.game.pause();
            }
        }
        return false;
    };

    global.addEventListener('unhandledrejection', function(event) {
        global.__TU_ERROR_COUNT__++;
        console.error(`[Unhandled Rejection #${global.__TU_ERROR_COUNT__}]`, event.reason);
        event.preventDefault();
    });

    // =============================================================================
    // 3. 类型守卫系统 (TypeGuards)
    // =============================================================================

    const TypeGuards = {
        isValidNumber(val) { return typeof val === 'number' && !isNaN(val) && isFinite(val); },
        isValidInteger(val) { return Number.isInteger(val); },
        isValidPositiveInteger(val) { return Number.isInteger(val) && val >= 0; },
        isValidString(val, maxLength = 10000) { return typeof val === 'string' && val.length <= maxLength; },
        isValidArray(val) { return Array.isArray(val); },
        isValidNonEmptyArray(val) { return Array.isArray(val) && val.length > 0; },
        isValidFunction(val) { return typeof val === 'function'; },
        isValidObject(val) { return val !== null && typeof val === 'object' && !Array.isArray(val); },
        isValidCanvas(canvas) { return canvas && typeof canvas.getContext === 'function'; },
        isValidContext(ctx) { return ctx && typeof ctx.drawImage === 'function'; },
        isValidCoordinate(x, y, w, h) {
            return this.isValidInteger(x) && this.isValidInteger(y) &&
                   this.isValidInteger(w) && this.isValidInteger(h) &&
                   x >= 0 && x < w && y >= 0 && y < h;
        },
        isValidIndex(index, arr) {
            return this.isValidInteger(index) && this.isValidArray(arr) && index >= 0 && index < arr.length;
        },
        isValidTileId(id, maxId = 256) { return this.isValidInteger(id) && id >= 0 && id < maxId; },
        isGameInstance(g) {
            return g && typeof g === 'object' && typeof g.loop === 'function';
        }
    };

    // =============================================================================
    // 4. 断言系统 (Assert)
    // =============================================================================

    const Assert = {
        enabled: true,
        fail(message, context = {}) {
            if (this.enabled) {
                console.error('[ASSERT FAILED]', message, context);
                global.__TU_ERROR_COUNT__++;
            }
        },
        ok(condition, message) { if (!condition) this.fail(message); return condition; },
        isTrue(condition, message) { return this.ok(condition, message); },
        isNumber(val, name = 'value') { return this.ok(TypeGuards.isValidNumber(val), name + ' must be a valid number'); },
        isInteger(val, name = 'value') { return this.ok(TypeGuards.isValidInteger(val), name + ' must be an integer'); },
        inRange(val, min, max, name = 'value') {
            return this.ok(TypeGuards.isValidNumber(val) && val >= min && val <= max,
                `${name} must be in range [${min}, ${max}], got ${val}`);
        },
        isValidIndex(index, arr, name = 'index') {
            return this.ok(TypeGuards.isValidIndex(index, arr),
                `${name} out of bounds: ${index}, length=${arr ? arr.length : 'null'}`);
        }
    };

    // =============================================================================
    // 5. 安全数学运算 (SafeMath)
    // =============================================================================

    const SafeMath = {
        clamp(val, min, max) {
            if (!TypeGuards.isValidNumber(val)) return min;
            return val < min ? min : val > max ? max : val;
        },
        clampInt(val, min, max) {
            if (!TypeGuards.isValidInteger(val)) return min;
            return val < min ? min : val > max ? max : val;
        },
        divFloor(n, d) { return d === 0 ? 0 : Math.floor(n / d); },
        toIndex(x, y, width) { return y * width + x; },
        toChunkCoord(coord, chunkSize) {
            return coord < 0 ? Math.floor(coord / chunkSize) : (coord / chunkSize) | 0;
        },
        toInt32(val) {
            const n = Number(val);
            return Number.isFinite(n) ? n | 0 : 0;
        }
    };

    // =============================================================================
    // 6. 边界检查 (BoundaryChecks)
    // =============================================================================

    const BoundaryChecks = {
        clamp(val, min, max) { return SafeMath.clamp(val, min, max); },
        clampInt(val, min, max) { return SafeMath.clampInt(val, min, max); },
        safeArrayAccess(arr, index, defaultValue = undefined) {
            if (!TypeGuards.isValidArray(arr)) return defaultValue;
            if (!TypeGuards.isValidInteger(index) || index < 0 || index >= arr.length) return defaultValue;
            return arr[index];
        },
        safe2DArrayAccess(arr, x, y, defaultValue = undefined) {
            if (!TypeGuards.isValidArray(arr)) return defaultValue;
            const col = arr[x];
            if (!col || !TypeGuards.isValidArray(col)) return defaultValue;
            if (!TypeGuards.isValidInteger(y) || y < 0 || y >= col.length) return defaultValue;
            return col[y];
        },
        safeDivide(a, b, defaultValue = 0) {
            if (!TypeGuards.isValidNumber(b) || b === 0) return defaultValue;
            return a / b;
        },
        safeModulo(a, b, defaultValue = 0) {
            if (!TypeGuards.isValidNumber(b) || b === 0) return defaultValue;
            return a % b;
        }
    };

    // =============================================================================
    // 7. 输入验证 (InputValidator)
    // =============================================================================

    const InputValidator = {
        validateCoordinate(x, y, w, h) {
            if (!TypeGuards.isValidCoordinate(x, y, w, h)) {
                return { valid: false, x: SafeMath.clampInt(x | 0, 0, w - 1), y: SafeMath.clampInt(y | 0, 0, h - 1) };
            }
            return { valid: true, x, y };
        },
        sanitizeString(str) {
            if (!TypeGuards.isValidString(str)) return '';
            return str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
        },
        sanitizeNumber(num, defaultVal = 0) {
            if (!TypeGuards.isValidNumber(num)) return defaultVal;
            return num;
        },
        validateTileId(id, maxId = 256) {
            if (!TypeGuards.isValidTileId(id, maxId)) return { valid: false, id: SafeMath.clampInt(id | 0, 0, maxId - 1) };
            return { valid: true, id };
        },
        validateLightLevel(val) {
            if (!TypeGuards.isValidNumber(val) || val < 0 || val > 1) return { valid: false, val: SafeMath.clamp(val || 0, 0, 1) };
            return { valid: true, val };
        }
    };

    // =============================================================================
    // 8. 错误报告 (ErrorReporter) - 含速率限制
    // =============================================================================

    const ErrorReporter = {
        _errors: [],
        _maxErrors: 50,
        _lastReport: 0,
        _minInterval: 100,

        report(error, context = {}) {
            const now = Date.now();
            if (now - this._lastReport < this._minInterval) return;
            if (this._errors.length >= this._maxErrors) return;
            this._lastReport = now;
            const entry = {
                message: error?.message || String(error),
                stack: error?.stack,
                context,
                timestamp: now
            };
            this._errors.push(entry);
            console.error('[ErrorReporter]', entry.message, context);
        },
        getErrors() { return [...this._errors]; },
        clear() { this._errors.length = 0; }
    };

    // =============================================================================
    // 9. 资源管理 (ResourceManager)
    // =============================================================================

    const ResourceManager = {
        _intervals: [],
        _timeouts: [],
        _rafs: [],

        registerInterval(id) { this._intervals.push(id); return id; },
        registerTimeout(id) { this._timeouts.push(id); return id; },
        registerRAF(id) { this._rafs.push(id); return id; },
        disposeAll() {
            this._intervals.forEach(id => clearInterval(id));
            this._timeouts.forEach(id => clearTimeout(id));
            this._rafs.forEach(id => cancelAnimationFrame(id));
            this._intervals.length = 0;
            this._timeouts.length = 0;
            this._rafs.length = 0;
        }
    };

    // =============================================================================
    // 10. 安全 JSON (SafeJSON)
    // =============================================================================

    const SafeJSON = {
        parse(str, defaultValue = null) {
            try { return JSON.parse(str); } catch (e) { return defaultValue; }
        },
        stringify(obj, defaultValue = '{}') {
            try { return JSON.stringify(obj); } catch (e) { return defaultValue; }
        }
    };

    // =============================================================================
    // 11. 世界访问 (WorldAccess)
    // =============================================================================

    const WorldAccess = {
        getTile(world, x, y, defaultValue = 0) {
            if (!world || !world.tiles) return defaultValue;
            x = x | 0; y = y | 0;
            if (x < 0 || x >= world.w || y < 0 || y >= world.h) return defaultValue;
            const col = world.tiles[x];
            return col ? (col[y] !== undefined ? col[y] : defaultValue) : defaultValue;
        },
        setTile(world, x, y, value) {
            if (!world || !world.tiles) return false;
            x = x | 0; y = y | 0;
            if (x < 0 || x >= world.w || y < 0 || y >= world.h) return false;
            const col = world.tiles[x];
            if (!col) return false;
            col[y] = value;
            return true;
        },
        getLight(world, x, y, defaultValue = 0) {
            if (!world || !world.light) return defaultValue;
            x = x | 0; y = y | 0;
            if (x < 0 || x >= world.w || y < 0 || y >= world.h) return defaultValue;
            const col = world.light[x];
            return col ? (col[y] !== undefined ? col[y] : defaultValue) : defaultValue;
        },
        setLight(world, x, y, value) {
            if (!world || !world.light) return false;
            x = x | 0; y = y | 0;
            if (x < 0 || x >= world.w || y < 0 || y >= world.h) return false;
            const col = world.light[x];
            if (!col) return false;
            col[y] = value;
            return true;
        }
    };

    // =============================================================================
    // 12. 安全访问包装器 (SafeAccess)
    // =============================================================================

    const SafeAccess = {
        get(obj, path, defaultValue = null) {
            if (!obj || typeof obj !== 'object') return defaultValue;
            const keys = path.split('.');
            let current = obj;
            for (const key of keys) {
                if (current === null || current === undefined) return defaultValue;
                current = current[key];
            }
            return current !== undefined ? current : defaultValue;
        },
        set(obj, path, value) {
            if (!obj || typeof obj !== 'object') return false;
            const keys = path.split('.');
            let current = obj;
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                if (!(key in current) || typeof current[key] !== 'object') current[key] = {};
                current = current[key];
            }
            current[keys[keys.length - 1]] = value;
            return true;
        }
    };

    // =============================================================================
    // 13. 空对象模式 (NullObjects)
    // =============================================================================

    const NullObjects = Object.freeze({
        item: Object.freeze({ id: 0, name: '', count: 0, durability: 0, maxDurability: 0, isEmpty: true }),
        world: Object.freeze({ w: 0, h: 0, tiles: [], light: [], biomes: [] }),
        player: Object.freeze({ x: 0, y: 0, vx: 0, vy: 0, health: 100, mana: 50, inventory: [] })
    });

    // =============================================================================
    // 14. 导出到全局
    // =============================================================================

    const TU_Defensive = {
        WorkerState, ErrorSeverity, EventTypes,
        TypeGuards, Assert, SafeMath, BoundaryChecks,
        InputValidator, ErrorReporter, ResourceManager,
        SafeJSON, WorldAccess, SafeAccess, NullObjects
    };

    global.TU_Defensive = TU_Defensive;
    global.TU_DEFENSIVE = TU_Defensive;

    // 全局便捷函数（保持向后兼容）
    if (!global.safeGet) global.safeGet = function(arr, idx, def) { return BoundaryChecks.safeArrayAccess(arr, idx, def); };
    if (!global.safeSet) global.safeSet = function(arr, idx, val) { if (arr && idx >= 0 && idx < arr.length) arr[idx] = val; };
    if (!global.safe2DArrayAccess) global.safe2DArrayAccess = BoundaryChecks.safe2DArrayAccess;
    if (!global.safeDivide) global.safeDivide = BoundaryChecks.safeDivide;
    if (!global.safeModulo) global.safeModulo = BoundaryChecks.safeModulo;
    if (!global.safeJSONParse) global.safeJSONParse = SafeJSON.parse;
    if (!global.safeJSONStringify) global.safeJSONStringify = SafeJSON.stringify;
    if (!global.safeGetProp) global.safeGetProp = function(obj, prop, def) { return (obj && typeof obj === 'object') ? (obj[prop] !== undefined ? obj[prop] : def) : def; };
    if (!global.clamp) global.clamp = function(v, min, max) { return Math.max(min, Math.min(max, v)); };
    if (!global.lerp) global.lerp = function(a, b, t) { return a + (b - a) * t; };
    if (!global.worldGetTile) global.worldGetTile = function(w, x, y, d) { return WorldAccess.getTile(w, x, y, d); };
    if (!global.worldSetTile) global.worldSetTile = function(w, x, y, v) { return WorldAccess.setTile(w, x, y, v); };
    if (!global.worldGetLight) global.worldGetLight = function(w, x, y, d) { return WorldAccess.getLight(w, x, y, d); };
    if (!global.worldSetLight) global.worldSetLight = function(w, x, y, v) { return WorldAccess.setLight(w, x, y, v); };

    // TU_SAFE 兼容 (供启动代码使用)
    global.TU_SAFE = {
        reportError(error, context) { ErrorReporter.report(error, context); }
    };

    console.log('[TU_Defensive] 统一防御性模块已加载 v2.0 (consolidated)');

})(typeof window !== 'undefined' ? window : globalThis);

// 加载界面卡死保护
(function() {
    'use strict';
    const LOADING_TIMEOUT = 30000;
    const LOADING_CHECK_INTERVAL = 1000;
    let loadingStartTime = Date.now();
    let lastProgress = 0;
    let stuckCount = 0;

    const checkLoading = () => {
        const loadingEl = document.getElementById('loading');
        if (!loadingEl || loadingEl.style.display === 'none') return;
        const progressEl = document.getElementById('load-progress');
        const currentProgress = progressEl ? parseInt(progressEl.style.width || '0') : 0;
        if (currentProgress === lastProgress) { stuckCount++; }
        else { stuckCount = 0; lastProgress = currentProgress; }
        const elapsed = Date.now() - loadingStartTime;
        if (elapsed > LOADING_TIMEOUT || stuckCount > 10) {
            console.error('[Loading] Timeout or stuck detected');
            const statusEl = document.getElementById('load-status');
            if (statusEl) statusEl.textContent = '加载遇到问题，请刷新页面重试';
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '重试';
            retryBtn.style.cssText = 'margin-top: 20px; padding: 10px 20px; font-size: 16px; cursor: pointer;';
            retryBtn.onclick = () => window.location.reload();
            const content = document.querySelector('.loading-content');
            if (content && !document.getElementById('loading-retry-btn')) {
                retryBtn.id = 'loading-retry-btn';
                content.appendChild(retryBtn);
            }
        } else {
            setTimeout(checkLoading, LOADING_CHECK_INTERVAL);
        }
    };
    setTimeout(checkLoading, LOADING_CHECK_INTERVAL);
})();
