// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Performance Monitor
// Fixed: Math.max(...array) replaced with loop to prevent stack overflow
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        // ═══════════════════ 性能监控 (防御性重构版) ═══════════════════
        const PerfMonitor = {
            _samples: [],
            _maxSamples: 60,
            _lastFrame: 0,
            _frameCount: 0,
            _maxFrameCount: 1000000, // 防止溢出
            _errorCount: 0,
            _maxErrors: 100,

            frame(timestamp) {
                // 验证时间戳
                if (!Number.isFinite(timestamp)) {
                    this._errorCount++;
                    if (this._errorCount <= this._maxErrors) {
                        console.warn('[PerfMonitor] Invalid timestamp');
                    }
                    return;
                }
                
                // 防止溢出
                if (this._frameCount >= this._maxFrameCount) {
                    this.reset();
                }
                this._frameCount++;
                
                if (this._lastFrame) {
                    const delta = timestamp - this._lastFrame;
                    // 验证delta
                    if (delta > 0 && delta < 10000) { // 合理的帧时间范围
                        this._samples.push(delta);
                        if (this._samples.length > this._maxSamples) {
                            this._samples.shift();
                        }
                    }
                }
                this._lastFrame = timestamp;
            },
            
            reset() {
                this._samples = [];
                this._lastFrame = 0;
                this._frameCount = 0;
            },

            getAverageFPS() {
                if (!Array.isArray(this._samples) || this._samples.length === 0) return 60;
                
                try {
                    // 过滤异常值
                    const validSamples = this._samples.filter(s => s > 0 && s < 1000);
                    if (validSamples.length === 0) return 60;
                    
                    const avg = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;
                    return Math.max(1, Math.min(999, Math.round(1000 / avg)));
                } catch (e) {
                    console.error('[PerfMonitor] getAverageFPS error:', e);
                    return 60;
                }
            },

            getMinFPS() {
                if (!Array.isArray(this._samples) || this._samples.length === 0) return 60;
                
                try {
                    const validSamples = this._samples.filter(s => s > 0 && s < 1000);
                    if (validSamples.length === 0) return 60;
                    
                    const max = Math.max(...validSamples);
                    return Math.max(1, Math.min(999, Math.round(1000 / max)));
                } catch (e) {
                    console.error('[PerfMonitor] getMinFPS error:', e);
                    return 60;
                }
            },

            getFrameTimeStats() {
                if (!Array.isArray(this._samples) || this._samples.length === 0) {
                    return { avg: '16.67', min: '16.67', max: '16.67' };
                }
                
                try {
                    const validSamples = this._samples.filter(s => s > 0 && s < 1000);
                    if (validSamples.length === 0) return { avg: '16.67', min: '16.67', max: '16.67' };
                    
                    const avg = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;
                    return {
                        avg: avg.toFixed(2),
                        min: Math.min(...validSamples).toFixed(2),
                        max: Math.max(...validSamples).toFixed(2)
                    };
                } catch (e) {
                    console.error('[PerfMonitor] getFrameTimeStats error:', e);
                    return { avg: '16.67', min: '16.67', max: '16.67' };
                }
            }
        };
        window.PerfMonitor = PerfMonitor;

// PERF_MONITOR delegate (removed dead code; single implementation)
window.PERF_MONITOR = {
  record(ft) { if (window.PerfMonitor) window.PerfMonitor.frame(performance.now()); },
  getAverageFPS() { return window.PerfMonitor ? window.PerfMonitor.getAverageFPS() : 60; }
};

window.TU = window.TU || {};
Object.assign(window.TU, { PerfMonitor });
