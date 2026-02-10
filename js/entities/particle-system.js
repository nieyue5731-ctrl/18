// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Particle System
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class ParticleSystem {
            constructor(max = 400) {
                this.particles = [];
                this.max = max;

                // 复用对象，降低 GC；head 用于 O(1) “丢弃最旧粒子”（替代 shift）
                this._pool = [];
                this._head = 0;
            }

            emit(x, y, opts = {}) {
                const count = opts.count || 5;
                const baseSpeed = opts.speed || 3;
                const baseLife = opts.life || 1;
                const baseSize = opts.size || 4;
                const color = opts.color || '#fff';
                const gravity = opts.gravity || 0.1;
                const glow = opts.glow || false;

                for (let i = 0; i < count; i++) {
                    // 保持“超过上限就移除最旧粒子”的原语义，但避免 O(n) 的 shift()
                    if ((this.particles.length - this._head) >= this.max) {
                        const old = this.particles[this._head++];
                        if (old) this._pool.push(old);
                    }

                    const angle = Math.random() * Math.PI * 2;
                    const speed = baseSpeed * (0.3 + Math.random() * 0.7);

                    const p = this._pool.pop() || {};
                    p.x = x;
                    p.y = y;
                    p.vx = Math.cos(angle) * speed;
                    p.vy = Math.sin(angle) * speed + (opts.up ? -speed : 0);
                    p.life = baseLife;
                    p.maxLife = baseLife;
                    p.color = color;
                    p.size = baseSize * (0.5 + Math.random() * 0.5);
                    p.gravity = gravity;
                    p.glow = glow;
                    p.rotation = Math.random() * Math.PI;
                    p.rotationSpeed = (Math.random() - 0.5) * 0.2;

                    this.particles.push(p);
                }
            }

            update(dtScale = 1) {
                // 稳定压缩（保持渲染顺序不变），同时把死亡粒子回收到 pool
                let write = 0;
                const arr = this.particles;

                for (let i = this._head; i < arr.length; i++) {
                    const p = arr[i];
                    if (!p) continue;

                    p.x += p.vx * dtScale;
                    p.y += p.vy * dtScale;
                    p.vy += p.gravity * dtScale;
                    p.vx *= Math.pow(0.98, dtScale);
                    p.life -= 0.02 * dtScale;
                    p.rotation += p.rotationSpeed * dtScale;

                    if (p.life > 0) {
                        arr[write++] = p;
                    } else {
                        this._pool.push(p);
                    }
                }

                arr.length = write;
                this._head = 0;
            }

            render(ctx, cam) {
                ctx.save();

                for (const p of this.particles) {
                    const px = p.x - cam.x;
                    const py = p.y - cam.y;

                    if (p.glow) {
                        ctx.shadowColor = p.color;
                        ctx.shadowBlur = 10;
                    }

                    ctx.globalAlpha = p.life * 0.8;
                    ctx.fillStyle = p.color;

                    ctx.save();
                    ctx.translate(px, py);
                    ctx.rotate(p.rotation);
                    const s = p.size * p.life;
                    ctx.fillRect(-s / 2, -s / 2, s, s);
                    ctx.restore();

                    ctx.shadowBlur = 0;
                }

                ctx.restore();
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                 掉落物系统

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { ParticleSystem });

    </script>

    <!-- ========================= SECTION: Entities ========================= -->

window.TU = window.TU || {};
Object.assign(window.TU, { ParticleSystem });
