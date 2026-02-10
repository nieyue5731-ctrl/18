// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Audio Manager (WebAudio synthesis)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class AudioManager {
            constructor(settings) {
                this.settings = settings;
                this.ctx = null;
                this._noiseBuf = null;
                this._armed = false;
            }
            arm() {
                if (this._armed) return;
                this._armed = true;
                const armNow = () => {
                    if (!this.ctx) {
                        const AC = window.AudioContext || window.webkitAudioContext;
                        if (!AC) return;
                        this.ctx = new AC();
                        this._noiseBuf = this._makeNoiseBuffer();
                    }
                    if (this.ctx && this.ctx.state === 'suspended') {
                        this.ctx.resume().catch(() => { });
                    }
                };
                window.addEventListener('pointerdown', armNow, { once: true, passive: true });
                window.addEventListener('touchstart', armNow, { once: true, passive: true });
                window.addEventListener('keydown', armNow, { once: true, passive: true });
            }
            setVolume(v01) { this.settings.sfxVolume = Math.max(0, Math.min(1, v01)); }
            _makeNoiseBuffer() {
                if (!this.ctx) return null;
                const sr = this.ctx.sampleRate;
                const len = Math.floor(sr * 0.12);
                const b = this.ctx.createBuffer(1, len, sr);
                const d = b.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
                return b;
            }
            _gain(v) {
                if (!this.ctx) return null;
                const g = this.ctx.createGain();
                g.gain.value = v;
                return g;
            }
            beep(freq = 440, dur = 0.06, type = 'sine', vol = 1) {
                if (!this.ctx) return;
                const v = (this.settings.sfxVolume || 0) * vol;
                if (v <= 0.0001) return;

                const o = this.ctx.createOscillator();
                o.type = type;
                o.frequency.value = freq;

                const g = this._gain(0);
                const now = this.ctx.currentTime;
                g.gain.setValueAtTime(0.0001, now);
                g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

                o.connect(g);
                g.connect(this.ctx.destination);
                o.start(now);
                o.stop(now + dur + 0.02);
            }
            noise(dur = 0.08, vol = 1) {
                if (!this.ctx || !this._noiseBuf) return;
                const v = (this.settings.sfxVolume || 0) * vol;
                if (v <= 0.0001) return;

                const src = this.ctx.createBufferSource();
                src.buffer = this._noiseBuf;

                const g = this._gain(0);
                const now = this.ctx.currentTime;
                g.gain.setValueAtTime(0.0001, now);
                g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

                src.connect(g);
                g.connect(this.ctx.destination);
                src.start(now);
                src.stop(now + dur + 0.02);
            }
            play(kind) {
                // 验证kind参数
                const validKinds = ['mine', 'place', 'pickup', 'ui', 'error'];
                if (!validKinds.includes(kind)) {
                    console.warn('[AudioManager] Invalid sound kind:', kind);
                    return;
                }
                
                try {
                    switch (kind) {
                        case 'mine': 
                            this.noise(0.06, 0.9); 
                            this.beep(220, 0.05, 'triangle', 0.35); 
                            break;
                        case 'place': 
                            this.beep(320, 0.05, 'square', 0.35); 
                            break;
                        case 'pickup': 
                            this.beep(660, 0.05, 'sine', 0.35); 
                            break;
                        case 'ui': 
                            this.beep(520, 0.04, 'sine', 0.25); 
                            break;
                        case 'error': 
                            this.beep(140, 0.08, 'sawtooth', 0.4); 
                            break;
                        default:
                            console.error('[AudioManager] Unreachable code in play()');
                    }
                } catch (e) {
                    console.error('[AudioManager] Play error:', e);
                }
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { AudioManager });


window.TU = window.TU || {};
Object.assign(window.TU, { AudioManager });
