// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Noise Generator (Perlin + FBM)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class NoiseGenerator {
            constructor(seed = Math.random() * 10000) {
                this.seed = seed;
                this.p = this._initPermutation();
            }

            _initPermutation() {
                const p = Array.from({ length: 256 }, (_, i) => i);
                let s = this.seed;
                for (let i = 255; i > 0; i--) {
                    s = (s * 16807) % 2147483647;
                    const j = s % (i + 1);
                    [p[i], p[j]] = [p[j], p[i]];
                }
                return [...p, ...p];
            }

            _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
            _lerp(a, b, t) { return a + t * (b - a); }
            _grad(hash, x, y) {
                const h = hash & 3;
                const u = h < 2 ? x : y;
                const v = h < 2 ? y : x;
                return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
            }

            noise2D(x, y) {
                const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
                x -= Math.floor(x); y -= Math.floor(y);
                const u = this._fade(x), v = this._fade(y);
                const A = this.p[X] + Y, B = this.p[X + 1] + Y;
                return this._lerp(
                    this._lerp(this._grad(this.p[A], x, y), this._grad(this.p[B], x - 1, y), u),
                    this._lerp(this._grad(this.p[A + 1], x, y - 1), this._grad(this.p[B + 1], x - 1, y - 1), u), v
                );
            }

            fbm(x, y, octaves = 5, lac = 2, gain = 0.5) {
                let val = 0, amp = 1, freq = 1, max = 0;
                for (let i = 0; i < octaves; i++) {
                    val += amp * this.noise2D(x * freq, y * freq);
                    max += amp;
                    amp *= gain;
                    freq *= lac;
                }
                return val / max;
            }

            warpedNoise(x, y, strength = 0.5) {
                const wx = this.fbm(x + 100, y + 100, 3) * strength;
                const wy = this.fbm(x + 200, y + 200, 3) * strength;
                return this.fbm(x + wx, y + wy, 4);
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { NoiseGenerator });

window.TU = window.TU || {};
Object.assign(window.TU, { NoiseGenerator });
