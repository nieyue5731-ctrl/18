// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Toast Notifications
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

        class Toast {
            static el() { return document.getElementById('toast-container'); }
            static show(msg, ms = 1600) {
                const host = Toast.el();
                if (!host) return;
                const t = document.createElement('div');
                t.className = 'toast';
                t.textContent = msg;
                host.appendChild(t);
                requestAnimationFrame(() => t.classList.add('show'));
                setTimeout(() => {
                    t.classList.remove('show');
                    setTimeout(() => t.remove(), 220);
                }, ms);
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { Toast });


window.TU = window.TU || {};
Object.assign(window.TU, { Toast });
