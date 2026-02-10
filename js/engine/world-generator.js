// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - World Generator
// Includes: TextureGenerator, StructureLibrary, WorldGenerator
// Merged prototype patches: _weldStructuresFromLibrary, _carveConnectorTunnel
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// ─── Texture Generator ───
        class TextureGenerator {
            constructor() {
                this.cache = []; // Array cache: blockId -> canvas|null，比 Map 更快
                this.glowCache = []; // 发光贴图缓存：blockId -> canvas|null
                // 预定义调色板
                this.palette = {
                    dirt: ['#5d4037', '#4e342e', '#3e2723', '#795548'],
                    grass: ['#4caf50', '#388e3c', '#2e7d32', '#81c784'],
                    stone: ['#9e9e9e', '#757575', '#616161', '#424242'],
                    wood: ['#8d6e63', '#6d4c41', '#5d4037', '#4e342e'],
                    sand: ['#fff176', '#fdd835', '#fbc02d', '#f9a825']
                };
            }

            get(blockId) {
                // Array 索引比 Map.has/get 更快；用 undefined 作为“未缓存”哨兵
                const cached = this.cache[blockId];
                if (cached !== undefined) return cached;

                const data = BLOCK_DATA[blockId];
                if (!data?.color) {
                    this.cache[blockId] = null;
                    return null;
                }

                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = CONFIG.TILE_SIZE;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                // 禁用平滑以获得清脆的像素感
                ctx.imageSmoothingEnabled = false;

                this._drawPixelArt(ctx, blockId, data);
                this.cache[blockId] = canvas;
                return canvas;
            }

            getGlow(blockId) {
                // 仅对发光方块生成“预烘焙辉光贴图”，避免每格 ctx.save/shadowBlur 的高开销
                const cached = this.glowCache[blockId];
                if (cached !== undefined) return cached;

                const base = this.get(blockId);
                if (!base) {
                    this.glowCache[blockId] = null;
                    return null;
                }

                // BLOCK_LIGHT / BLOCK_COLOR 在后续常量区定义；方法执行时已就绪即可
                const bl = (typeof BLOCK_LIGHT !== 'undefined' && BLOCK_LIGHT[blockId]) ? BLOCK_LIGHT[blockId] : 0;
                if (bl <= 5) {
                    this.glowCache[blockId] = null;
                    return null;
                }

                const pad = Math.max(2, Math.min(24, Math.ceil(bl * 1.6)));
                const size = CONFIG.TILE_SIZE + pad * 2;

                const glow = document.createElement('canvas');
                glow.width = glow.height = size;
                const gctx = glow.getContext('2d', { alpha: true });
                gctx.imageSmoothingEnabled = false;

                gctx.clearRect(0, 0, size, size);
                gctx.save();
                gctx.shadowColor = (typeof BLOCK_COLOR !== 'undefined' && BLOCK_COLOR[blockId]) ? BLOCK_COLOR[blockId] : (BLOCK_DATA[blockId]?.color || '#ffffff');
                gctx.shadowBlur = bl * 2;
                gctx.drawImage(base, pad, pad);
                gctx.restore();

                // 给渲染端一个 pad 信息（用于绘制时回退偏移）
                glow.__pad = pad;

                this.glowCache[blockId] = glow;
                return glow;
            }

            _drawPixel(ctx, x, y, color) {
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 1, 1);
            }

            // 使用像素矩阵绘制
            _drawMatrix(ctx, matrix, colors) {
                for (let y = 0; y < 16; y++) {
                    for (let x = 0; x < 16; x++) {
                        const char = matrix[y] ? matrix[y][x] : '.';
                        if (colors[char]) {
                            this._drawPixel(ctx, x, y, colors[char]);
                        }
                    }
                }
            }

            _drawPixelArt(ctx, id, data) {
                const s = CONFIG.TILE_SIZE;
                const p = this.palette;

                // 基础底色填充
                const baseColor = data.color || '#F0F';

                // 生成随机像素纹理的辅助函数
                const fillNoise = (colors, density = 0.3) => {
                    for (let x = 0; x < s; x++) {
                        for (let y = 0; y < s; y++) {
                            if (Math.random() < density) {
                                const c = colors[Math.floor(Math.random() * colors.length)];
                                this._drawPixel(ctx, x, y, c);
                            }
                        }
                    }
                };

                switch (id) {
                    case BLOCK.DIRT:
                        // 土块：深浅不一的噪点
                        ctx.fillStyle = p.dirt[0]; ctx.fillRect(0, 0, s, s);
                        fillNoise(p.dirt, 0.5);
                        break;

                    case BLOCK.GRASS:
                    case BLOCK.SNOW_GRASS:
                    case BLOCK.JUNGLE_GRASS:
                        // 侧面草方块：顶部是草，下面是土
                        const isSnow = id === BLOCK.SNOW_GRASS;
                        const topColors = isSnow ? ['#fff', '#eee', '#ddd'] :
                            (id === BLOCK.JUNGLE_GRASS ? ['#66bb6a', '#43a047', '#2e7d32'] : p.grass);
                        const soilColors = id === BLOCK.JUNGLE_GRASS ? ['#5d4037', '#4e342e'] : p.dirt;

                        // 土壤部分
                        ctx.fillStyle = soilColors[0]; ctx.fillRect(0, 0, s, s);
                        fillNoise(soilColors, 0.4);

                        // 草顶 (3-5像素厚)
                        ctx.fillStyle = topColors[1];
                        ctx.fillRect(0, 0, s, 4);

                        // 草的边缘（垂下的像素）
                        for (let x = 0; x < s; x++) {
                            const drop = Math.floor(Math.random() * 3) + 1;
                            ctx.fillStyle = topColors[Math.floor(Math.random() * topColors.length)];
                            ctx.fillRect(x, 0, 1, 4 + drop);
                            // 偶尔的高光
                            if (Math.random() > 0.8) {
                                ctx.fillStyle = topColors[0];
                                ctx.fillRect(x, 1, 1, 1);
                            }
                        }
                        break;

                    case BLOCK.STONE:
                    case BLOCK.COBBLESTONE:
                    case BLOCK.MOSSY_STONE:
                    case BLOCK.GRANITE:
                    case BLOCK.MARBLE:
                        // 石头纹理：不规则的层状或块状
                        const stoneBase = id === BLOCK.GRANITE ? '#4e342e' : (id === BLOCK.MARBLE ? '#f5f5f5' : '#757575');
                        const stoneDark = id === BLOCK.GRANITE ? '#3e2723' : (id === BLOCK.MARBLE ? '#e0e0e0' : '#616161');

                        ctx.fillStyle = stoneBase; ctx.fillRect(0, 0, s, s);

                        if (id === BLOCK.COBBLESTONE) {
                            // 圆石：画几个圆圈轮廓
                            ctx.fillStyle = '#00000033'; // 阴影缝隙
                            ctx.fillRect(2, 1, 10, 1); ctx.fillRect(1, 2, 1, 4); ctx.fillRect(12, 2, 1, 4); ctx.fillRect(2, 6, 10, 1);
                            ctx.fillRect(0, 8, 6, 1); ctx.fillRect(5, 9, 1, 4); ctx.fillRect(0, 13, 6, 1);
                            ctx.fillRect(7, 8, 9, 1); ctx.fillRect(7, 9, 1, 5); ctx.fillRect(15, 9, 1, 5);
                        } else {
                            // 天然石：横向裂纹
                            for (let i = 0; i < 8; i++) {
                                const sx = Math.floor(Math.random() * s);
                                const sy = Math.floor(Math.random() * s);
                                const len = Math.floor(Math.random() * 5) + 2;
                                ctx.fillStyle = stoneDark;
                                ctx.fillRect(sx, sy, len, 1);
                            }
                            fillNoise([stoneBase, stoneDark], 0.2);
                        }

                        if (id === BLOCK.MOSSY_STONE) {
                            fillNoise(p.grass, 0.2); // 苔藓斑点
                        }
                        break;

                    case BLOCK.WOOD:
                    case BLOCK.LOG:
                        // 原木：树皮纹理（垂直）
                        ctx.fillStyle = '#5d4037'; ctx.fillRect(0, 0, s, s);
                        for (let x = 1; x < s; x += 2) {
                            ctx.fillStyle = Math.random() > 0.5 ? '#4e342e' : '#3e2723';
                            ctx.fillRect(x, 0, 1, s);
                            if (Math.random() > 0.7) ctx.fillRect(x + 1, Math.random() * s, 1, 2); // 树节
                        }
                        break;

                    case BLOCK.PLANKS:
                        // 木板：水平条纹
                        ctx.fillStyle = '#8d6e63'; ctx.fillRect(0, 0, s, s);
                        // 分隔线
                        ctx.fillStyle = '#4e342e';
                        ctx.fillRect(0, 4, s, 1);
                        ctx.fillRect(0, 9, s, 1);
                        ctx.fillRect(0, 14, s, 1);
                        // 随机噪点模拟木纹
                        fillNoise(['#795548', '#a1887f'], 0.1);
                        break;

                    case BLOCK.BRICK:
                        // 砖块：交错排列
                        ctx.fillStyle = '#8d6e63'; ctx.fillRect(0, 0, s, s); // 灰缝
                        const bCol = '#d32f2f';
                        const bLit = '#ef5350';
                        const bDrk = '#b71c1c';

                        const drawOneBrick = (x, y, w, h) => {
                            ctx.fillStyle = bCol; ctx.fillRect(x, y, w, h);
                            ctx.fillStyle = bLit; ctx.fillRect(x, y, w - 1, 1); ctx.fillRect(x, y, 1, h - 1);
                            ctx.fillStyle = bDrk; ctx.fillRect(x + w - 1, y, 1, h); ctx.fillRect(x, y + h - 1, w, 1);
                        };

                        drawOneBrick(0, 0, 7, 7);
                        drawOneBrick(8, 0, 8, 7);
                        drawOneBrick(0, 8, 3, 7);
                        drawOneBrick(4, 8, 8, 7);
                        drawOneBrick(13, 8, 3, 7);
                        break;

                    case BLOCK.LEAVES:
                        // 树叶：通透的像素点簇
                        // 不清除背景，让它透明
                        const leafColors = ['#2e7d32', '#388e3c', '#43a047'];
                        for (let x = 0; x < s; x += 2) {
                            for (let y = 0; y < s; y += 2) {
                                if (Math.random() > 0.3) {
                                    ctx.fillStyle = leafColors[Math.floor(Math.random() * leafColors.length)];
                                    ctx.fillRect(x, y, 2, 2);
                                    // 阴影
                                    if (Math.random() > 0.5) {
                                        ctx.fillStyle = '#1b5e20';
                                        ctx.fillRect(x + 1, y + 1, 1, 1);
                                    }
                                }
                            }
                        }
                        break;

                    case BLOCK.GLASS:
                        // 玻璃：边框 + 反光
                        ctx.fillStyle = 'rgba(225, 245, 254, 0.2)'; ctx.fillRect(1, 1, 14, 14);
                        ctx.strokeStyle = '#81d4fa'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 15, 15);
                        // 反光条
                        ctx.fillStyle = 'rgba(255,255,255,0.6)';
                        ctx.fillRect(3, 3, 2, 2);
                        ctx.fillRect(5, 5, 2, 2);
                        ctx.fillRect(10, 10, 3, 3);
                        break;

                    case BLOCK.ORE_COPPER:
                    case BLOCK.ORE_IRON:
                    case BLOCK.ORE_SILVER:
                    case BLOCK.ORE_GOLD:
                    case BLOCK.ORE_DIAMOND:
                    case BLOCK.COPPER_ORE: case BLOCK.IRON_ORE: case BLOCK.SILVER_ORE:
                    case BLOCK.GOLD_ORE: case BLOCK.DIAMOND_ORE:
                        // 矿石：石头背景 + 宝石镶嵌
                        this._drawPixelArt(ctx, BLOCK.STONE, BLOCK_DATA[BLOCK.STONE]);

                        let oreC = '#FFF';
                        if (id === BLOCK.COPPER_ORE) oreC = '#e67e22';
                        if (id === BLOCK.IRON_ORE) oreC = '#d7ccc8';
                        if (id === BLOCK.SILVER_ORE) oreC = '#e0e0e0';
                        if (id === BLOCK.GOLD_ORE) oreC = '#ffd700';
                        if (id === BLOCK.DIAMOND_ORE) oreC = '#29b6f6';
                        if (data.color) oreC = data.color;

                        for (let i = 0; i < 4; i++) {
                            const ox = Math.floor(Math.random() * 12) + 2;
                            const oy = Math.floor(Math.random() * 12) + 2;
                            // 矿石形状
                            ctx.fillStyle = oreC;
                            ctx.fillRect(ox, oy, 2, 2);
                            ctx.fillRect(ox - 1, oy, 1, 1);
                            ctx.fillRect(ox, oy - 1, 1, 1);
                            // 高光
                            ctx.fillStyle = '#ffffffaa';
                            ctx.fillRect(ox, oy, 1, 1);
                        }
                        break;

                    case BLOCK.TORCH:
                        // 火把
                        ctx.fillStyle = '#5d4037'; ctx.fillRect(7, 6, 2, 10); // 柄
                        // 火焰中心
                        ctx.fillStyle = '#ffeb3b'; ctx.fillRect(6, 4, 4, 4);
                        ctx.fillStyle = '#fff'; ctx.fillRect(7, 5, 2, 2);
                        // 外焰
                        ctx.fillStyle = '#ff5722';
                        ctx.fillRect(7, 2, 2, 2);
                        ctx.fillRect(6, 4, 1, 1); ctx.fillRect(9, 4, 1, 1);
                        break;

                    case BLOCK.SAND:
                        ctx.fillStyle = '#fff59d'; ctx.fillRect(0, 0, s, s);
                        // 波浪纹理
                        ctx.fillStyle = '#fdd835';
                        for (let y = 2; y < s; y += 4) {
                            for (let x = 0; x < s; x++) {
                                if ((x + y) % 4 === 0) ctx.fillRect(x, y, 1, 1);
                            }
                        }
                        fillNoise(['#fbc02d'], 0.1);
                        break;

                    case BLOCK.MUSHROOM:
                        // 蘑菇
                        ctx.fillStyle = '#fff'; ctx.fillRect(7, 10, 2, 6); // 茎
                        // 伞盖
                        ctx.fillStyle = '#e91e63';
                        ctx.fillRect(4, 7, 8, 3);
                        ctx.fillRect(5, 6, 6, 1);
                        // 斑点
                        ctx.fillStyle = '#f8bbd0';
                        ctx.fillRect(5, 8, 1, 1); ctx.fillRect(9, 7, 1, 1);
                        break;

                    case BLOCK.FLOWER_RED:
                    case BLOCK.FLOWER_YELLOW:
                    case BLOCK.PINK_FLOWER:
                    case BLOCK.BLUE_FLOWER:
                        const stemC = '#4caf50';
                        ctx.fillStyle = stemC; ctx.fillRect(7, 8, 2, 8); // 茎
                        // 叶
                        ctx.fillRect(5, 12, 2, 1); ctx.fillRect(9, 11, 2, 1);
                        // 花瓣
                        let petalC = '#f44336';
                        if (id === BLOCK.FLOWER_YELLOW) petalC = '#ffeb3b';
                        if (id === BLOCK.PINK_FLOWER) petalC = '#f48fb1';
                        if (id === BLOCK.BLUE_FLOWER) petalC = '#64b5f6';
                        ctx.fillStyle = petalC;
                        ctx.fillRect(6, 6, 4, 4);
                        ctx.fillRect(7, 5, 2, 6);
                        ctx.fillRect(5, 7, 6, 2);
                        // 花蕊
                        ctx.fillStyle = '#fff'; ctx.fillRect(7, 7, 2, 2);
                        break;

                    case BLOCK.SUNFLOWER:
                        ctx.fillStyle = '#4caf50'; ctx.fillRect(7, 6, 2, 10); // 茎
                        ctx.fillRect(5, 10, 2, 1); ctx.fillRect(9, 9, 2, 1);
                        // 花瓣 - 向日葵
                        ctx.fillStyle = '#ffeb3b';
                        for (let i = 0; i < 8; i++) {
                            const angle = (i / 8) * Math.PI * 2;
                            const px = 8 + Math.cos(angle) * 4;
                            const py = 4 + Math.sin(angle) * 4;
                            ctx.fillRect(Math.floor(px) - 1, Math.floor(py) - 1, 3, 3);
                        }
                        ctx.fillStyle = '#8d6e63'; ctx.fillRect(6, 2, 4, 4); // 中心
                        break;

                    case BLOCK.FERN:
                        ctx.fillStyle = '#2e7d32';
                        ctx.fillRect(7, 6, 2, 10);
                        // 蕨类叶片
                        for (let i = 0; i < 5; i++) {
                            const y = 6 + i * 2;
                            ctx.fillRect(4, y, 3, 1);
                            ctx.fillRect(9, y + 1, 3, 1);
                        }
                        break;

                    case BLOCK.VINE:
                        ctx.fillStyle = '#388e3c';
                        ctx.fillRect(7, 0, 2, 16);
                        ctx.fillRect(5, 3, 2, 1);
                        ctx.fillRect(9, 6, 2, 1);
                        ctx.fillRect(4, 10, 2, 1);
                        ctx.fillRect(10, 13, 2, 1);
                        break;

                    case BLOCK.BAMBOO:
                        ctx.fillStyle = '#7cb342'; ctx.fillRect(6, 0, 4, 16);
                        ctx.fillStyle = '#689f38';
                        ctx.fillRect(6, 3, 4, 1);
                        ctx.fillRect(6, 8, 4, 1);
                        ctx.fillRect(6, 13, 4, 1);
                        ctx.fillStyle = '#8bc34a';
                        ctx.fillRect(7, 0, 2, 16);
                        break;

                    case BLOCK.CHERRY_LEAVES:
                        const cherryColors = ['#f48fb1', '#f8bbd9', '#fce4ec', '#ec407a'];
                        for (let x = 0; x < s; x += 2) {
                            for (let y = 0; y < s; y += 2) {
                                if (Math.random() > 0.25) {
                                    ctx.fillStyle = cherryColors[Math.floor(Math.random() * cherryColors.length)];
                                    ctx.fillRect(x, y, 2, 2);
                                }
                            }
                        }
                        break;

                    case BLOCK.PINE_LEAVES:
                        const pineColors = ['#1b5e20', '#2e7d32', '#388e3c'];
                        for (let x = 0; x < s; x++) {
                            for (let y = 0; y < s; y++) {
                                if (Math.random() > 0.2) {
                                    ctx.fillStyle = pineColors[Math.floor(Math.random() * pineColors.length)];
                                    ctx.fillRect(x, y, 1, 1);
                                }
                            }
                        }
                        break;

                    case BLOCK.PALM_LEAVES:
                        const palmColors = ['#7cb342', '#8bc34a', '#9ccc65'];
                        for (let x = 0; x < s; x += 2) {
                            for (let y = 0; y < s; y += 2) {
                                if (Math.random() > 0.3) {
                                    ctx.fillStyle = palmColors[Math.floor(Math.random() * palmColors.length)];
                                    ctx.fillRect(x, y, 2, 2);
                                }
                            }
                        }
                        break;

                    case BLOCK.SANDSTONE:
                        ctx.fillStyle = '#d4a574'; ctx.fillRect(0, 0, s, s);
                        ctx.fillStyle = '#c9956c';
                        ctx.fillRect(0, 4, s, 1);
                        ctx.fillRect(0, 10, s, 1);
                        fillNoise(['#deb887', '#c9956c'], 0.2);
                        break;

                    case BLOCK.RED_SAND:
                        ctx.fillStyle = '#c75b39'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#b74a2a', '#d96c4a'], 0.4);
                        break;

                    case BLOCK.GRAVEL:
                        ctx.fillStyle = '#757575'; ctx.fillRect(0, 0, s, s);
                        for (let i = 0; i < 20; i++) {
                            const gx = Math.floor(Math.random() * 14) + 1;
                            const gy = Math.floor(Math.random() * 14) + 1;
                            ctx.fillStyle = Math.random() > 0.5 ? '#616161' : '#9e9e9e';
                            ctx.fillRect(gx, gy, 2, 2);
                        }
                        break;

                    case BLOCK.LIMESTONE:
                        ctx.fillStyle = '#e8dcc4'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#d7c9a8', '#f5f0e0'], 0.25);
                        break;

                    case BLOCK.SLATE:
                        ctx.fillStyle = '#546e7a'; ctx.fillRect(0, 0, s, s);
                        for (let y = 2; y < s; y += 3) {
                            ctx.fillStyle = '#455a64';
                            ctx.fillRect(0, y, s, 1);
                        }
                        break;

                    case BLOCK.BASALT:
                        ctx.fillStyle = '#37474f'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#263238', '#455a64'], 0.3);
                        break;

                    case BLOCK.FROZEN_STONE:
                        ctx.fillStyle = '#b3e5fc'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#81d4fa', '#e1f5fe'], 0.3);
                        // 冰晶效果
                        ctx.fillStyle = 'rgba(255,255,255,0.5)';
                        ctx.fillRect(3, 3, 2, 2);
                        ctx.fillRect(10, 8, 2, 2);
                        break;

                    case BLOCK.GLOWSTONE:
                        ctx.fillStyle = '#ffc107'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#ffeb3b', '#ff9800', '#fff176'], 0.5);
                        // 发光效果
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(4, 4, 2, 2);
                        ctx.fillRect(10, 10, 2, 2);
                        break;

                    case BLOCK.AMETHYST:
                        ctx.fillStyle = '#9c27b0'; ctx.fillRect(0, 0, s, s);
                        // 晶体纹理
                        ctx.fillStyle = '#ba68c8';
                        ctx.fillRect(3, 2, 2, 6);
                        ctx.fillRect(8, 4, 3, 8);
                        ctx.fillStyle = '#e1bee7';
                        ctx.fillRect(4, 3, 1, 4);
                        ctx.fillRect(9, 5, 1, 6);
                        break;

                    case BLOCK.MUSHROOM_GIANT:
                        ctx.fillStyle = '#8e24aa'; ctx.fillRect(0, 0, s, s);
                        fillNoise(['#7b1fa2', '#9c27b0', '#ab47bc'], 0.4);
                        // 斑点
                        ctx.fillStyle = '#e1bee7';
                        ctx.fillRect(3, 4, 2, 2);
                        ctx.fillRect(10, 8, 2, 2);
                        ctx.fillRect(6, 12, 2, 2);
                        break;

                    case BLOCK.UNDERGROUND_MUSHROOM:
                        ctx.fillStyle = '#7e57c2'; ctx.fillRect(7, 10, 2, 6);
                        ctx.fillStyle = '#5e35b1';
                        ctx.fillRect(4, 7, 8, 3);
                        ctx.fillRect(5, 6, 6, 1);
                        // 发光点
                        ctx.fillStyle = '#b39ddb';
                        ctx.fillRect(5, 8, 1, 1);
                        ctx.fillRect(9, 7, 1, 1);
                        break;

                    case BLOCK.GLOWING_MOSS:
                        ctx.fillStyle = '#00e676';
                        for (let x = 0; x < s; x += 2) {
                            for (let y = 0; y < s; y += 2) {
                                if (Math.random() > 0.4) {
                                    ctx.fillStyle = Math.random() > 0.5 ? '#00e676' : '#69f0ae';
                                    ctx.fillRect(x, y, 2, 2);
                                }
                            }
                        }
                        break;

                    case BLOCK.STALAGMITE:
                    case BLOCK.STALACTITE:
                        const isUp = id === BLOCK.STALACTITE;
                        ctx.fillStyle = '#8d6e63';
                        if (isUp) {
                            ctx.fillRect(6, 0, 4, 8);
                            ctx.fillRect(7, 8, 2, 6);
                            ctx.fillRect(7, 14, 2, 2);
                        } else {
                            ctx.fillRect(7, 0, 2, 2);
                            ctx.fillRect(7, 2, 2, 6);
                            ctx.fillRect(6, 8, 4, 8);
                        }
                        break;

                    case BLOCK.SPIDER_WEB:
                        ctx.strokeStyle = '#eeeeee';
                        ctx.lineWidth = 1;
                        // 放射线
                        for (let i = 0; i < 8; i++) {
                            const angle = (i / 8) * Math.PI * 2;
                            ctx.beginPath();
                            ctx.moveTo(8, 8);
                            ctx.lineTo(8 + Math.cos(angle) * 7, 8 + Math.sin(angle) * 7);
                            ctx.stroke();
                        }
                        // 同心环
                        for (let r = 2; r <= 6; r += 2) {
                            ctx.beginPath();
                            ctx.arc(8, 8, r, 0, Math.PI * 2);
                            ctx.stroke();
                        }
                        break;

                    case BLOCK.BONE:
                        ctx.fillStyle = '#efebe9'; ctx.fillRect(0, 0, s, s);
                        ctx.fillStyle = '#d7ccc8';
                        ctx.fillRect(2, 6, 12, 4);
                        ctx.fillRect(0, 5, 3, 6);
                        ctx.fillRect(13, 5, 3, 6);
                        break;

                    case BLOCK.TREASURE_CHEST:
                        ctx.fillStyle = '#8d6e63'; ctx.fillRect(2, 4, 12, 10);
                        ctx.fillStyle = '#5d4037';
                        ctx.fillRect(2, 4, 12, 2);
                        ctx.fillStyle = '#ffd700';
                        ctx.fillRect(6, 8, 4, 3);
                        ctx.fillRect(7, 7, 2, 1);
                        break;

                    case BLOCK.LANTERN:
                        ctx.fillStyle = '#5d4037'; ctx.fillRect(6, 0, 4, 2);
                        ctx.fillStyle = '#ff9800'; ctx.fillRect(5, 2, 6, 8);
                        ctx.fillStyle = '#ffeb3b'; ctx.fillRect(6, 3, 4, 6);
                        ctx.fillStyle = '#fff'; ctx.fillRect(7, 4, 2, 4);
                        ctx.fillStyle = '#5d4037';
                        ctx.fillRect(5, 10, 6, 2);
                        ctx.fillRect(6, 12, 4, 2);
                        break;

                    case BLOCK.MOSS:
                        for (let x = 0; x < s; x++) {
                            for (let y = 0; y < s; y++) {
                                if (Math.random() > 0.5) {
                                    ctx.fillStyle = Math.random() > 0.5 ? '#558b2f' : '#689f38';
                                    ctx.fillRect(x, y, 1, 1);
                                }
                            }
                        }
                        break;

                    default:
                        // 默认降级处理
                        ctx.fillStyle = baseColor;
                        ctx.fillRect(0, 0, s, s);
                        ctx.fillStyle = '#00000022';
                        ctx.strokeRect(0, 0, s, s);
                        fillNoise(['#ffffff33', '#00000033'], 0.2);
                }
            }
        }

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { TextureGenerator });

    </script>


// ─── Structures ───
    <!-- ========================= MODULE: render/structures_json ========================= -->
    <script id="tu-structures-json" type="application/json">
[
  {
    "id": "dungeon_room_basic",
    "tags": ["dungeon", "room"],
    "weight": 3,
    "depth": [0.62, 0.92],
    "anchor": [0.5, 0.5],
    "placement": { "mode": "underground", "minSolidRatio": 0.55, "defaultWall": 2 },
    "pattern": [
      "#############",
      "#...........#",
      "#..l.....l..#",
      "#...........#",
      "#.....C.....#",
      "#...........#",
      "#..l.....l..#",
      "#...........#",
      "#############"
    ],
    "legend": {
      "#": { "tile": "DUNGEON_BRICK", "replace": "any" },
      ".": { "tile": "AIR", "wall": 2, "replace": "any" },
      "l": { "tile": "LANTERN", "replace": "any" },
      "C": { "tile": "TREASURE_CHEST", "replace": "any" }
    },
    "connectors": [
      { "x": 0, "y": 4, "dir": "left", "len": 18, "carve": true, "wall": 2 },
      { "x": 12, "y": 4, "dir": "right", "len": 18, "carve": true, "wall": 2 }
    ]
  },
  {
    "id": "ruin_shrine",
    "tags": ["ruin", "room"],
    "weight": 2,
    "depth": [0.38, 0.74],
    "anchor": [0.5, 0.5],
    "placement": { "mode": "underground", "minSolidRatio": 0.45, "defaultWall": 1 },
    "pattern": [
      "  #######  ",
      " ##.....## ",
      "##..#.#..##",
      "#...#C#...#",
      "##..#.#..##",
      " ##.....## ",
      "  #######  "
    ],
    "legend": {
      "#": { "tile": "COBBLESTONE" },
      ".": { "tile": "AIR", "wall": 1 },
      "C": { "tile": "TREASURE_CHEST" }
    },
    "connectors": [
      { "x": 5, "y": 6, "dir": "down", "len": 10, "carve": true, "wall": 1 }
    ]
  },
  {
    "id": "ancient_tree",
    "tags": ["tree"],
    "weight": 2,
    "depth": [0.05, 0.35],
    "anchor": [0.5, 1.0],
    "placement": { "mode": "surface" },
    "pattern": [
      "   LLL   ",
      "  LLLLL  ",
      " LLLLLLL ",
      "  LLLLL  ",
      "   LLL   ",
      "    T    ",
      "    T    ",
      "    T    ",
      "    T    "
    ],
    "legend": {
      "L": { "tile": "LEAVES", "replace": "air" },
      "T": { "tile": "WOOD", "replace": "any" }
    }
  }
]
</script>


// ─── World Generator ───
    <!-- ========================= MODULE: world/world_generator ========================= -->
    <script>
        // ═══════════════════════════════════════════════════════════════════════════════
        //                                世界生成器 (超级增强版)
        // ═══════════════════════════════════════════════════════════════════════════════
        // ───────────────────────── StructureDescriptor System (JSON, v11-safe) ─────────────────────────
        (() => {
            const TU = window.TU = window.TU || {};
            const LS_KEY = 'TU_STRUCTURES_JSON';
            const LIMITS = Object.freeze({ MAX_W: 96, MAX_H: 96, MAX_CELLS: 4096, MAX_DESC: 256, MAX_CONN: 16 });

            const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
            const clamp01 = (n) => (n < 0 ? 0 : (n > 1 ? 1 : n));
            const clampI = (n, lo, hi) => (n < lo ? lo : (n > hi ? hi : n)) | 0;
            const asNum = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
            const asStr = (v, d = '') => (typeof v === 'string' ? v : d);

            function resolveBlockId(v) {
                if (typeof v === 'number' && Number.isFinite(v)) return clampI(v, 0, 255);
                if (typeof v === 'string') {
                    const k = v.trim();
                    if (!k || k === 'KEEP' || k === 'NULL' || k === 'null') return null;
                    if (typeof BLOCK === 'object' && k in BLOCK) return BLOCK[k];
                }
                return null;
            }
            function resolveWallId(v) {
                if (v === null || v === undefined) return null;
                if (typeof v === 'number' && Number.isFinite(v)) return clampI(v, 0, 255);
                if (typeof v === 'string') {
                    const s = v.trim();
                    if (!s) return null;
                    const n = Number(s);
                    if (Number.isFinite(n)) return clampI(n, 0, 255);
                }
                return null;
            }
            function dirVec(dir) {
                switch (dir) {
                    case 'left': return [-1, 0];
                    case 'right': return [1, 0];
                    case 'up': return [0, -1];
                    case 'down': return [0, 1];
                    default: return [0, 0];
                }
            }

            function normalizeDescriptor(raw, idx) {
                if (!isObj(raw)) return null;

                const id = asStr(raw.id, `desc_${idx}`).slice(0, 64);
                const tags = Array.isArray(raw.tags) ? raw.tags.map(t => asStr(t, '')).filter(Boolean).slice(0, 16) : [];
                const weight = Math.max(0.0001, asNum(raw.weight, 1));

                let depth = [0, 1];
                if (Array.isArray(raw.depth) && raw.depth.length >= 2) {
                    const a = clamp01(asNum(raw.depth[0], 0));
                    const b = clamp01(asNum(raw.depth[1], 1));
                    depth = a <= b ? [a, b] : [b, a];
                }

                const placement = isObj(raw.placement) ? raw.placement : {};
                const mode = placement.mode === 'surface' ? 'surface' : 'underground';
                const minSolidRatio = clamp01(asNum(placement.minSolidRatio, mode === 'underground' ? 0.5 : 0.0));
                const defaultWall = clampI(asNum(placement.defaultWall, 0), 0, 255);

                let anchor = [0.5, 0.5];
                if (Array.isArray(raw.anchor) && raw.anchor.length >= 2) {
                    anchor = [clamp01(asNum(raw.anchor[0], 0.5)), clamp01(asNum(raw.anchor[1], 0.5))];
                }

                const pat = Array.isArray(raw.pattern) ? raw.pattern.map(s => String(s).replace(/\r/g, '')) : [];
                if (!pat.length) return null;

                const h = pat.length;
                let w = 0;
                for (let i = 0; i < pat.length; i++) w = Math.max(w, pat[i].length);

                if (w <= 0 || h <= 0) return null;
                if (w > LIMITS.MAX_W || h > LIMITS.MAX_H) return null;
                if (w * h > LIMITS.MAX_CELLS) return null;

                const grid = pat.map(line => line.padEnd(w, ' '));

                const legendRaw = isObj(raw.legend) ? raw.legend : {};
                const legend = Object.create(null);
                for (const k in legendRaw) {
                    if (!k || k.length !== 1) continue;
                    const v = legendRaw[k];
                    if (!isObj(v)) continue;

                    const tile = resolveBlockId(v.tile);
                    const wall = resolveWallId(v.wall);
                    const replace = (v.replace === 'solid' || v.replace === 'air' || v.replace === 'any') ? v.replace : 'any';
                    const chance = clamp01(asNum(v.chance, 1));

                    // tile === null → KEEP（跳过写入 tile）
                    legend[k] = { tile, wall, replace, chance };
                }

                const connectors = [];
                if (Array.isArray(raw.connectors)) {
                    for (let i = 0; i < raw.connectors.length && connectors.length < LIMITS.MAX_CONN; i++) {
                        const c = raw.connectors[i];
                        if (!isObj(c)) continue;
                        const x = clampI(asNum(c.x, 0), 0, w - 1);
                        const y = clampI(asNum(c.y, 0), 0, h - 1);
                        const dir = asStr(c.dir, 'right');
                        const len = clampI(asNum(c.len, 10), 1, 64);
                        const carve = !!c.carve;
                        const wall = resolveWallId(c.wall);
                        connectors.push({ x, y, dir, len, carve, wall });
                    }
                }

                return { id, tags, weight, depth, placement: { mode, minSolidRatio, defaultWall }, anchor, w, h, grid, legend, connectors };
            }

            class StructureLibrary {
                constructor() {
                    this._descs = [];
                    this._loaded = false;
                    this._lastError = '';
                }
                count() { return this._descs.length; }
                lastError() { return this._lastError; }

                clear() {
                    this._descs.length = 0;
                    this._loaded = true;
                    this._lastError = '';
                }

                loadFromArray(arr, { replace = false } = {}) {
                    if (!Array.isArray(arr)) return { ok: false, added: 0, error: 'not_array' };
                    if (replace) this._descs.length = 0;

                    let added = 0;
                    for (let i = 0; i < arr.length && this._descs.length < LIMITS.MAX_DESC; i++) {
                        const desc = normalizeDescriptor(arr[i], i);
                        if (!desc) continue;
                        this._descs.push(desc);
                        added++;
                    }
                    this._loaded = true;
                    this._lastError = '';
                    return { ok: true, added };
                }

                loadFromJSON(json, { replace = false } = {}) {
                    try {
                        const arr = typeof json === 'string' ? JSON.parse(json) : json;
                        return this.loadFromArray(arr, { replace });
                    } catch (e) {
                        this._lastError = String(e && e.message ? e.message : e);
                        return { ok: false, added: 0, error: this._lastError };
                    }
                }

                ensureLoaded() {
                    if (this._loaded) return;

                    // 1) localStorage 覆盖
                    const ls = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
                    if (ls) {
                        const r = this.loadFromJSON(ls, { replace: true });
                        if (r.ok && this._descs.length) { this._loaded = true; return; }
                    }

                    // 2) 内嵌 JSON（默认库）
                    const el = document.getElementById('tu-structures-json');
                    if (el && el.textContent) {
                        const r = this.loadFromJSON(el.textContent, { replace: true });
                        if (r.ok) { this._loaded = true; return; }
                    }

                    // 3) 兜底：空库
                    this._loaded = true;
                }

                // tags: string | string[]
                pick(depthNorm, tags) {
                    this.ensureLoaded();
                    if (!this._descs.length) return null;

                    const dn = clamp01(asNum(depthNorm, 0.5));
                    const tagList = Array.isArray(tags) ? tags : (tags ? [tags] : []);
                    const filtered = [];

                    for (let i = 0; i < this._descs.length; i++) {
                        const d = this._descs[i];
                        if (dn < d.depth[0] || dn > d.depth[1]) continue;
                        if (tagList.length) {
                            let ok = false;
                            for (let t = 0; t < tagList.length; t++) {
                                if (d.tags.includes(tagList[t])) { ok = true; break; }
                            }
                            if (!ok) continue;
                        }
                        filtered.push(d);
                    }
                    if (!filtered.length) return null;

                    let total = 0;
                    for (let i = 0; i < filtered.length; i++) total += filtered[i].weight;

                    let r = Math.random() * total;
                    for (let i = 0; i < filtered.length; i++) {
                        r -= filtered[i].weight;
                        if (r <= 0) return filtered[i];
                    }
                    return filtered[filtered.length - 1];
                }

                exportJSON() {
                    // 仅导出可序列化的“原型信息”（pattern/grid 会被保留为数组）
                    this.ensureLoaded();
                    return JSON.stringify(this._descs.map(d => ({
                        id: d.id, tags: d.tags, weight: d.weight, depth: d.depth,
                        anchor: d.anchor, placement: d.placement,
                        pattern: d.grid, legend: d.legend, connectors: d.connectors
                    })), null, 2);
                }
            }

            TU.Structures = TU.Structures || new StructureLibrary();

            // 便捷 API：开发者可在控制台/自定义 UI 中调用
            TU.loadStructureJSON = (jsonString) => {
                try { localStorage.setItem(LS_KEY, jsonString); } catch { }
                const r = TU.Structures.loadFromJSON(jsonString, { replace: true });
                return r;
            };
            TU.clearStructureJSON = () => { try { localStorage.removeItem(LS_KEY); } catch { } TU.Structures.clear(); TU.Structures.ensureLoaded(); };

            // 提前加载一次（避免首次生成时 parse 卡顿）
            try { TU.Structures.ensureLoaded(); } catch { }
        })();

        class WorldGenerator {
            constructor(w, h, seed) {
                this.w = w;
                this.h = h;
                this.seed = seed;
                this.noise = new NoiseGenerator(seed);
                this.biomeNoise = new NoiseGenerator(seed + 1000);
                this.caveNoise = new NoiseGenerator(seed + 2000);
                this.oreNoise = new NoiseGenerator(seed + 3000);
                this.structureNoise = new NoiseGenerator(seed + 4000);
            }

            async generate(progress) {
                const tiles = Array.from({ length: this.w }, () => new Uint8Array(this.h));
                const walls = Array.from({ length: this.w }, () => new Uint8Array(this.h));
                const light = Array.from({ length: this.w }, () => new Uint8Array(this.h));

                const steps = [
                    ['✨ 编织地形...', () => this._terrain(tiles, walls)],
                    ['🏔️ 生成山脉峡谷...', () => this._specialTerrain(tiles, walls)],
                    ['🕳️ 雕刻洞穴...', () => this._caves(tiles, walls)],
                    ['🌊 创造湖泊...', () => this._lakes(tiles)],
                    ['💎 埋藏宝藏...', () => this._ores(tiles)],
                    ['🌿 种植生命...', () => this._vegetation(tiles)],
                    ['🍄 地下生态...', () => this._undergroundLife(tiles, walls)],
                    ['🏠 建造遗迹...', () => this._structures(tiles, walls)],
                    ['🏰 隐秘地牢...', () => this._dungeons(tiles, walls)],
                    ['💫 点亮世界...', () => this._lighting(tiles, light)]
                ];

                for (let i = 0; i < steps.length; i++) {
                    progress(steps[i][0], (i / steps.length) * 100);
                    steps[i][1]();
                    await new Promise(r => setTimeout(r, 30));
                }

                progress('🎮 准备就绪!', 100);
                return { tiles, walls, light, w: this.w, h: this.h };
            }

            _biome(x) {
                const v = this.biomeNoise.fbm(x * 0.003, 0, 4);
                const v2 = this.biomeNoise.fbm(x * 0.008 + 500, 100, 3);

                if (v < -0.35) return 'tundra';
                if (v < -0.15) return 'snow';
                if (v < 0.05) return 'forest';
                if (v < 0.2) return 'plains';
                if (v < 0.35) return v2 > 0 ? 'cherry' : 'bamboo';
                if (v < 0.55) return 'jungle';
                if (v < 0.7) return 'savanna';
                return v2 > 0.2 ? 'red_desert' : 'desert';
            }

            _subBiome(x, y) {
                const v = this.biomeNoise.fbm(x * 0.02, y * 0.02, 3);
                if (y > this.h * 0.5 && y < this.h * 0.7) {
                    if (v > 0.4) return 'mushroom_cave';
                    if (v < -0.4) return 'crystal_cave';
                }
                if (y > this.h * 0.65 && y < this.h * 0.85) {
                    if (v > 0.3) return 'lush_cave';
                    if (v < -0.3) return 'ice_cave';
                }
                return 'normal';
            }

            _terrain(tiles, walls) {
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);

                for (let x = 0; x < this.w; x++) {
                    const biome = this._biome(x);

                    // 更复杂的地形高度
                    let heightMod = this.noise.fbm(x * 0.008, 0, 6) * 25;
                    heightMod += this.noise.fbm(x * 0.02, 0, 4) * 8;
                    heightMod += this.noise.fbm(x * 0.05, 0, 2) * 3;

                    // 生物群系影响高度
                    if (biome === 'tundra' || biome === 'snow') heightMod += 10;
                    if (biome === 'plains') heightMod -= 5;
                    if (biome === 'jungle') heightMod += this.noise.fbm(x * 0.03, 50, 3) * 12;

                    const groundY = surfY + Math.floor(heightMod);

                    for (let y = 0; y < this.h; y++) {
                        if (y < groundY - 3) {
                            tiles[x][y] = BLOCK.AIR;
                        } else if (y === groundY) {
                            // 表面方块根据生物群系
                            tiles[x][y] = this._getSurfaceBlock(biome);
                        } else if (y < groundY + 4 + Math.floor(Math.random() * 4)) {
                            // 表土层
                            tiles[x][y] = this._getSubSurfaceBlock(biome);
                            walls[x][y] = 1;
                        } else if (y < this.h * CONFIG.UNDERGROUND_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'upper');
                            walls[x][y] = 1;
                        } else if (y < this.h * CONFIG.CAVERN_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'middle');
                            walls[x][y] = 2;
                        } else if (y < this.h * CONFIG.UNDERWORLD_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'deep');
                            walls[x][y] = 2;
                        } else if (y >= this.h - 4) {
                            tiles[x][y] = BLOCK.BEDROCK;
                            walls[x][y] = 3;
                        } else {
                            // 地狱层
                            const hellNoise = this.noise.fbm(x * 0.03, y * 0.03, 3);
                            if (hellNoise > 0.3) tiles[x][y] = BLOCK.HELLSTONE;
                            else if (hellNoise > 0) tiles[x][y] = BLOCK.ASH;
                            else if (hellNoise > -0.3) tiles[x][y] = BLOCK.OBSIDIAN;
                            else tiles[x][y] = BLOCK.BASALT;
                            walls[x][y] = 3;
                        }
                    }
                }
            }

            _getSurfaceBlock(biome) {
                switch (biome) {
                    case 'tundra': case 'snow': return BLOCK.SNOW_GRASS;
                    case 'desert': return BLOCK.SAND;
                    case 'red_desert': return BLOCK.RED_SAND;
                    case 'jungle': return BLOCK.JUNGLE_GRASS;
                    case 'bamboo': return BLOCK.JUNGLE_GRASS;
                    case 'cherry': return BLOCK.GRASS;
                    case 'savanna': return Math.random() > 0.3 ? BLOCK.GRASS : BLOCK.SAND;
                    default: return BLOCK.GRASS;
                }
            }

            _getSubSurfaceBlock(biome) {
                switch (biome) {
                    case 'tundra': case 'snow': return Math.random() > 0.8 ? BLOCK.ICE : BLOCK.SNOW;
                    case 'desert': return Math.random() > 0.7 ? BLOCK.SANDSTONE : BLOCK.SAND;
                    case 'red_desert': return Math.random() > 0.6 ? BLOCK.SANDSTONE : BLOCK.RED_SAND;
                    case 'jungle': case 'bamboo': return Math.random() > 0.5 ? BLOCK.MUD : BLOCK.CLAY;
                    default: return BLOCK.DIRT;
                }
            }

            _getUndergroundBlock(x, y, layer) {
                const n = this.noise.fbm(x * 0.04, y * 0.04, 3);
                const n2 = this.noise.fbm(x * 0.08 + 200, y * 0.08, 2);

                if (layer === 'upper') {
                    if (n > 0.5) return BLOCK.GRAVEL;
                    if (n > 0.35) return BLOCK.CLAY;
                    if (n < -0.4) return BLOCK.LIMESTONE;
                    return BLOCK.STONE;
                } else if (layer === 'middle') {
                    if (n > 0.45) return BLOCK.MOSSY_STONE;
                    if (n > 0.3 && n2 > 0.2) return BLOCK.SLATE;
                    if (n < -0.35) return BLOCK.MARBLE;
                    if (n < -0.5) return BLOCK.GRANITE;
                    return BLOCK.STONE;
                } else {
                    if (n > 0.4) return BLOCK.GRANITE;
                    if (n > 0.25 && n2 > 0.1) return BLOCK.BASALT;
                    if (n < -0.3) return BLOCK.OBSIDIAN;
                    if (n < -0.45) return BLOCK.SLATE;
                    return BLOCK.STONE;
                }
            }

            _specialTerrain(tiles, walls) {
                // 浮空岛屿
                for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
                    const ix = 80 + Math.floor(Math.random() * (this.w - 160));
                    const iy = 15 + Math.floor(Math.random() * 25);
                    const iw = 20 + Math.floor(Math.random() * 30);
                    const ih = 8 + Math.floor(Math.random() * 8);

                    this._createFloatingIsland(tiles, walls, ix, iy, iw, ih);
                }

                // 峡谷/裂缝
                for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
                    const cx = 50 + Math.floor(Math.random() * (this.w - 100));
                    this._createRavine(tiles, cx);
                }

                // 地表湖泊位置预留
                for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
                    const lx = 30 + Math.floor(Math.random() * (this.w - 60));
                    this._createSurfaceLake(tiles, lx);
                }
            }

            _createFloatingIsland(tiles, walls, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    const edgeDist = Math.min(dx + w / 2, w / 2 - dx) / (w / 2);
                    const height = Math.floor(h * edgeDist * (0.7 + Math.random() * 0.3));

                    for (let dy = 0; dy < height; dy++) {
                        const y = cy + dy;
                        if (y < 0 || y >= this.h) continue;

                        if (dy === 0) {
                            tiles[x][y] = BLOCK.GRASS;
                        } else if (dy < 3) {
                            tiles[x][y] = BLOCK.DIRT;
                        } else {
                            tiles[x][y] = BLOCK.STONE;
                        }
                        walls[x][y] = 1;
                    }
                }

                // 岛上放些好东西
                if (cx > 0 && cx < this.w && cy > 0) {
                    if (Math.random() > 0.5) tiles[cx][cy - 1] = BLOCK.TREASURE_CHEST;
                    else tiles[cx][cy - 1] = BLOCK.CRYSTAL;
                }
            }

            _createRavine(tiles, startX) {
                let x = startX;
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);

                // 找到地表
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }

                const depth = 30 + Math.floor(Math.random() * 40);
                const width = 3 + Math.floor(Math.random() * 4);

                for (let y = groundY; y < groundY + depth && y < this.h - 10; y++) {
                    const w = width + Math.floor(Math.sin(y * 0.1) * 2);
                    for (let dx = -w; dx <= w; dx++) {
                        const tx = x + dx + Math.floor(Math.sin(y * 0.15) * 3);
                        if (tx >= 0 && tx < this.w) {
                            tiles[tx][y] = BLOCK.AIR;
                        }
                    }
                }

                // 底部放水或熔岩
                for (let dx = -width - 2; dx <= width + 2; dx++) {
                    const tx = x + dx;
                    const ty = groundY + depth - 3;
                    if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                        if (tiles[tx][ty] === BLOCK.AIR) {
                            tiles[tx][ty] = Math.random() > 0.7 ? BLOCK.LAVA : BLOCK.WATER;
                        }
                    }
                }
            }

            _createSurfaceLake(tiles, startX) {
                const biome = this._biome(startX);
                if (biome === 'desert' || biome === 'red_desert') return; // 沙漠没有湖

                const width = 15 + Math.floor(Math.random() * 25);
                const depth = 4 + Math.floor(Math.random() * 6);

                // 找地表高度
                let minGroundY = this.h;
                for (let dx = 0; dx < width; dx++) {
                    const x = startX + dx;
                    if (x >= this.w) continue;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) {
                            minGroundY = Math.min(minGroundY, y);
                            break;
                        }
                    }
                }

                // 挖湖
                for (let dx = 0; dx < width; dx++) {
                    const x = startX + dx;
                    if (x >= this.w) continue;

                    const edgeDist = Math.min(dx, width - dx) / (width / 2);
                    const d = Math.floor(depth * edgeDist);

                    for (let dy = 0; dy < d; dy++) {
                        const y = minGroundY + dy;
                        if (y >= this.h) continue;
                        tiles[x][y] = biome === 'snow' || biome === 'tundra' ? BLOCK.ICE : BLOCK.WATER;
                    }
                }
            }

            _caves(tiles, walls) {
                const startY = Math.floor(this.h * CONFIG.SURFACE_LEVEL) + 8;

                // 多层洞穴系统
                for (let x = 0; x < this.w; x++) {
                    for (let y = startY; y < this.h - 4; y++) {
                        const subBiome = this._subBiome(x, y);

                        // 主洞穴网络
                        const c1 = this.caveNoise.warpedNoise(x * 0.032, y * 0.032);
                        const c2 = this.caveNoise.fbm(x * 0.05 + 500, y * 0.05, 4);
                        const c3 = this.caveNoise.fbm(x * 0.02 + 1000, y * 0.02, 3);

                        const depth = Math.min(1, (y - startY) / (this.h * 0.3));
                        const thresh = 0.35 + depth * 0.15;

                        // 主要洞穴
                        if (c1 > thresh || (c2 > 0.55 && Math.random() > 0.3)) {
                            tiles[x][y] = BLOCK.AIR;
                        }

                        // 大型洞室
                        if (y > this.h * CONFIG.CAVERN_LEVEL && c3 > 0.48) {
                            tiles[x][y] = BLOCK.AIR;
                        }

                        // 蠕虫状隧道
                        const worm = Math.sin(x * 0.05 + y * 0.1) * Math.sin(x * 0.02 - y * 0.03);
                        if (Math.abs(worm) < 0.08 && y > this.h * 0.35 && Math.random() > 0.3) {
                            tiles[x][y] = BLOCK.AIR;
                        }
                    }
                }

                // 地下水和熔岩池
                this._fillCaveLiquids(tiles);
            }

            _fillCaveLiquids(tiles) {
                for (let x = 0; x < this.w; x++) {
                    for (let y = Math.floor(this.h * 0.45); y < this.h - 4; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) continue;

                        // 检查是否是池底
                        if (y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            // 深层熔岩
                            if (y > this.h * CONFIG.UNDERWORLD_LEVEL && Math.random() > 0.5) {
                                this._fillPool(tiles, x, y, BLOCK.LAVA, 8);
                            }
                            // 中层水池
                            else if (y < this.h * CONFIG.UNDERWORLD_LEVEL && Math.random() > 0.88) {
                                this._fillPool(tiles, x, y, BLOCK.WATER, 12);
                            }
                        }
                    }
                }
            }

            _fillPool(tiles, sx, sy, liquid, maxSize) {
                // 性能：避免 queue.shift() 的 O(n) 开销 & 字符串 key 的频繁分配
                const queue = [{ x: sx, y: sy }];
                let head = 0;
                const filled = new Set();
                let count = 0;

                while (head < queue.length && count < maxSize) {
                    const { x, y } = queue[head++];

                    if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                    // 以 32-bit key 代替 `${x},${y}`，减少 GC 压力（假设世界尺寸 < 65536）
                    const key = (x << 16) | (y & 0xffff);
                    if (filled.has(key)) continue;
                    filled.add(key);

                    if (tiles[x][y] !== BLOCK.AIR) continue;

                    tiles[x][y] = liquid;
                    count++;

                    // 只向下和水平扩展
                    queue.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y + 1 });
                }
            }

            _lakes(tiles) {
                // 地下大型湖泊
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const lx = 50 + Math.floor(Math.random() * (this.w - 100));
                    const ly = Math.floor(this.h * (0.5 + Math.random() * 0.25));
                    const lw = 25 + Math.floor(Math.random() * 35);
                    const lh = 8 + Math.floor(Math.random() * 12);

                    this._createUndergroundLake(tiles, lx, ly, lw, lh);
                }

                // 熔岩湖
                for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
                    const lx = 40 + Math.floor(Math.random() * (this.w - 80));
                    const ly = Math.floor(this.h * (0.85 + Math.random() * 0.1));
                    const lw = 20 + Math.floor(Math.random() * 30);
                    const lh = 5 + Math.floor(Math.random() * 8);

                    this._createLavaLake(tiles, lx, ly, lw, lh);
                }
            }

            _createUndergroundLake(tiles, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 1 - Math.random() * 0.2) {
                            tiles[x][y] = BLOCK.WATER;
                        }
                    }
                }
            }

            _createLavaLake(tiles, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 0.9) {
                            tiles[x][y] = BLOCK.LAVA;
                        }
                    }
                }
                // 周围放萤石
                for (let i = 0; i < 8; i++) {
                    const gx = cx + Math.floor((Math.random() - 0.5) * w * 1.2);
                    const gy = cy + Math.floor((Math.random() - 0.5) * h * 1.5);
                    if (gx >= 0 && gx < this.w && gy >= 0 && gy < this.h) {
                        if (tiles[gx][gy] === BLOCK.STONE || tiles[gx][gy] === BLOCK.OBSIDIAN) {
                            tiles[gx][gy] = BLOCK.GLOWSTONE;
                        }
                    }
                }
            }

            _ores(tiles) {
                const ores = [
                    // 常见矿石
                    { id: BLOCK.COPPER_ORE, minY: 0.26, maxY: 0.55, chance: 0.008, size: 6 },
                    { id: BLOCK.IRON_ORE, minY: 0.35, maxY: 0.65, chance: 0.006, size: 5 },
                    { id: BLOCK.SILVER_ORE, minY: 0.45, maxY: 0.75, chance: 0.005, size: 4 },
                    { id: BLOCK.GOLD_ORE, minY: 0.52, maxY: 0.82, chance: 0.004, size: 4 },
                    // 稀有矿石
                    { id: BLOCK.DIAMOND_ORE, minY: 0.70, maxY: 0.88, chance: 0.0015, size: 3 },
                    { id: BLOCK.RUBY_ORE, minY: 0.60, maxY: 0.80, chance: 0.002, size: 3 },
                    { id: BLOCK.EMERALD_ORE, minY: 0.55, maxY: 0.75, chance: 0.002, size: 3 },
                    { id: BLOCK.SAPPHIRE_ORE, minY: 0.58, maxY: 0.78, chance: 0.002, size: 3 },
                    // 特殊矿石
                    { id: BLOCK.CRYSTAL, minY: 0.48, maxY: 0.72, chance: 0.003, size: 4 },
                    { id: BLOCK.AMETHYST, minY: 0.55, maxY: 0.80, chance: 0.0025, size: 4 },
                    { id: BLOCK.GLOWSTONE, minY: 0.60, maxY: 0.85, chance: 0.003, size: 3 },
                    // 地狱矿石
                    { id: BLOCK.HELLSTONE, minY: 0.88, maxY: 0.98, chance: 0.015, size: 5 }
                ];

                for (const ore of ores) {
                    const minY = Math.floor(this.h * ore.minY);
                    const maxY = Math.floor(this.h * ore.maxY);

                    for (let x = 0; x < this.w; x++) {
                        for (let y = minY; y < maxY; y++) {
                            // 使用噪声增加矿脉聚集性
                            const oreChance = ore.chance * (1 + this.oreNoise.fbm(x * 0.1, y * 0.1, 2));
                            if (Math.random() < oreChance) {
                                const block = tiles[x][y];
                                if (block === BLOCK.STONE || block === BLOCK.GRANITE ||
                                    block === BLOCK.SLATE || block === BLOCK.LIMESTONE) {
                                    this._placeVein(tiles, x, y, ore.id, ore.size + Math.floor(Math.random() * 3));
                                }
                            }
                        }
                    }
                }
            }

            _placeVein(tiles, sx, sy, id, size) {
                const placed = [{ x: sx, y: sy }];
                tiles[sx][sy] = id;
                let attempts = 0;

                while (placed.length < size && attempts < size * 3) {
                    attempts++;
                    const p = placed[Math.floor(Math.random() * placed.length)];
                    const nx = p.x + Math.floor(Math.random() * 3) - 1;
                    const ny = p.y + Math.floor(Math.random() * 3) - 1;

                    if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h) {
                        const block = tiles[nx][ny];
                        if (block === BLOCK.STONE || block === BLOCK.GRANITE ||
                            block === BLOCK.SLATE || block === BLOCK.LIMESTONE ||
                            block === BLOCK.MARBLE || block === BLOCK.BASALT) {
                            tiles[nx][ny] = id;
                            placed.push({ x: nx, y: ny });
                        }
                    }
                }
            }

            _vegetation(tiles) {
                for (let x = 5; x < this.w - 5; x++) {
                    const biome = this._biome(x);
                    let groundY = 0;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }
                    if (!groundY || groundY > this.h * 0.5) continue;

                    // 各种树木
                    this._placeTree(tiles, x, groundY, biome);

                    // 花草装饰
                    this._placeFlora(tiles, x, groundY, biome);
                }
            }

            _placeTree(tiles, x, groundY, biome) {
                const treeChance = {
                    'forest': 0.08, 'jungle': 0.12, 'plains': 0.03, 'cherry': 0.07,
                    'bamboo': 0.15, 'snow': 0.04, 'tundra': 0.02, 'savanna': 0.02,
                    'desert': 0, 'red_desert': 0
                };

                if (Math.random() > (treeChance[biome] || 0.05)) return;
                if (tiles[x][groundY - 1] !== BLOCK.AIR) return;

                let logType = BLOCK.LOG;
                let leafType = BLOCK.LEAVES;
                let height = 5 + Math.floor(Math.random() * 4);
                let canopyRadius = 2;

                switch (biome) {
                    case 'jungle':
                        height = 10 + Math.floor(Math.random() * 8);
                        canopyRadius = 3 + Math.floor(Math.random() * 2);
                        break;
                    case 'bamboo':
                        logType = BLOCK.BAMBOO;
                        height = 8 + Math.floor(Math.random() * 6);
                        // 竹子没有树冠
                        for (let i = 1; i <= height && groundY - i >= 0; i++) {
                            tiles[x][groundY - i] = logType;
                        }
                        return;
                    case 'cherry':
                        logType = BLOCK.CHERRY_LOG;
                        leafType = BLOCK.CHERRY_LEAVES;
                        height = 6 + Math.floor(Math.random() * 3);
                        canopyRadius = 3;
                        break;
                    case 'snow': case 'tundra':
                        logType = BLOCK.PINE_LOG;
                        leafType = BLOCK.PINE_LEAVES;
                        height = 8 + Math.floor(Math.random() * 5);
                        // 松树是三角形
                        for (let i = 1; i <= height && groundY - i >= 0; i++) {
                            tiles[x][groundY - i] = logType;
                        }
                        for (let layer = 0; layer < height - 2; layer++) {
                            const w = Math.max(1, Math.floor((height - layer) / 2));
                            const y = groundY - height + layer;
                            for (let dx = -w; dx <= w; dx++) {
                                const tx = x + dx;
                                if (tx >= 0 && tx < this.w && y >= 0 && tiles[tx][y] === BLOCK.AIR) {
                                    tiles[tx][y] = leafType;
                                }
                            }
                        }
                        return;
                    case 'savanna':
                        height = 4 + Math.floor(Math.random() * 2);
                        canopyRadius = 4;
                        break;
                    case 'desert': case 'red_desert':
                        // 仙人掌
                        if (Math.random() > 0.96) {
                            const h = 3 + Math.floor(Math.random() * 4);
                            for (let i = 1; i <= h && groundY - i >= 0; i++) {
                                tiles[x][groundY - i] = BLOCK.CACTUS;
                            }
                            // 仙人掌手臂
                            if (h > 3 && Math.random() > 0.5) {
                                const armY = groundY - Math.floor(h / 2);
                                const armDir = Math.random() > 0.5 ? 1 : -1;
                                if (x + armDir >= 0 && x + armDir < this.w) {
                                    if (armY >= 0 && armY < this.h && tiles[x + armDir][armY] === BLOCK.AIR) tiles[x + armDir][armY] = BLOCK.CACTUS;
                                    if (armY - 1 >= 0 && (armY - 1) < this.h && tiles[x + armDir][armY - 1] === BLOCK.AIR) tiles[x + armDir][armY - 1] = BLOCK.CACTUS;
                                }
                            }
                        }
                        return;
                }

                // 标准树干
                for (let i = 1; i <= height && groundY - i >= 0; i++) {
                    tiles[x][groundY - i] = logType;
                }

                // 树冠
                for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
                    for (let dy = -canopyRadius - 1; dy <= 1; dy++) {
                        const tx = x + dx, ty = groundY - height + dy;
                        if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist <= canopyRadius + 0.5 && tiles[tx][ty] === BLOCK.AIR && Math.random() > 0.15) {
                                tiles[tx][ty] = leafType;
                            }
                        }
                    }
                }
            }

            _placeFlora(tiles, x, groundY, biome) {
                if (tiles[x][groundY - 1] !== BLOCK.AIR) return;

                const floraChance = biome === 'jungle' ? 0.5 : biome === 'plains' ? 0.4 :
                    biome === 'forest' ? 0.35 : biome === 'cherry' ? 0.45 : 0.2;

                if (Math.random() > floraChance) return;

                const r = Math.random();
                let flora = BLOCK.TALL_GRASS;

                switch (biome) {
                    case 'plains':
                        if (r > 0.92) flora = BLOCK.SUNFLOWER;
                        else if (r > 0.85) flora = BLOCK.FLOWER_RED;
                        else if (r > 0.78) flora = BLOCK.FLOWER_YELLOW;
                        else if (r > 0.7) flora = BLOCK.PINK_FLOWER;
                        else if (r > 0.62) flora = BLOCK.BLUE_FLOWER;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'forest':
                        if (r > 0.9) flora = BLOCK.MUSHROOM;
                        else if (r > 0.8) flora = BLOCK.FERN;
                        else if (r > 0.7) flora = BLOCK.FLOWER_RED;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'jungle':
                        if (r > 0.85) flora = BLOCK.FERN;
                        else if (r > 0.75) flora = BLOCK.PINK_FLOWER;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'cherry':
                        if (r > 0.8) flora = BLOCK.PINK_FLOWER;
                        else if (r > 0.6) flora = BLOCK.FLOWER_RED;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'snow': case 'tundra':
                        if (r > 0.9) flora = BLOCK.BLUE_FLOWER;
                        break;
                    default:
                        if (r > 0.85) flora = BLOCK.FLOWER_YELLOW;
                        else if (r > 0.7) flora = BLOCK.TALL_GRASS;
                        else return;
                }

                tiles[x][groundY - 1] = flora;
            }

            _undergroundLife(tiles, walls) {
                const startY = Math.floor(this.h * CONFIG.UNDERGROUND_LEVEL);

                for (let x = 0; x < this.w; x++) {
                    for (let y = startY; y < this.h * CONFIG.UNDERWORLD_LEVEL; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) continue;

                        const subBiome = this._subBiome(x, y);

                        // 地下蘑菇
                        if (tiles[x][y + 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            if (Math.random() > 0.992) {
                                tiles[x][y] = subBiome === 'mushroom_cave' ? BLOCK.UNDERGROUND_MUSHROOM : BLOCK.MUSHROOM;
                            }
                            if (subBiome === 'mushroom_cave' && Math.random() > 0.97) {
                                // 巨型蘑菇
                                this._placeGiantMushroom(tiles, x, y);
                            }
                        }

                        // 天花板装饰
                        if (y > 0 && tiles[x][y - 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y - 1]]?.solid) {
                            if (Math.random() > 0.985) {
                                tiles[x][y] = BLOCK.STALACTITE;
                            }
                            if (subBiome === 'lush_cave' && Math.random() > 0.9) {
                                tiles[x][y] = BLOCK.VINE;
                            }
                        }

                        // 地面装饰
                        if (y + 1 < this.h && tiles[x][y + 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            if (Math.random() > 0.988) {
                                tiles[x][y] = BLOCK.STALAGMITE;
                            }
                            if (subBiome === 'lush_cave' && Math.random() > 0.93) {
                                tiles[x][y] = BLOCK.GLOWING_MOSS;
                            }
                            if (subBiome === 'crystal_cave' && Math.random() > 0.95) {
                                tiles[x][y] = Math.random() > 0.5 ? BLOCK.CRYSTAL : BLOCK.AMETHYST;
                            }
                        }

                        // 墙壁装饰
                        if (subBiome === 'lush_cave') {
                            if (x > 0 && tiles[x - 1][y] !== BLOCK.AIR && Math.random() > 0.92) {
                                tiles[x][y] = BLOCK.MOSS;
                            }
                            if (x + 1 < this.w && tiles[x + 1][y] !== BLOCK.AIR && Math.random() > 0.92) {
                                tiles[x][y] = BLOCK.MOSS;
                            }
                        }

                        // 冰洞穴
                        if (subBiome === 'ice_cave') {
                            if (Math.random() > 0.95) {
                                // 将周围石头变成冻石
                                for (let dx = -1; dx <= 1; dx++) {
                                    for (let dy = -1; dy <= 1; dy++) {
                                        const tx = x + dx, ty = y + dy;
                                        if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                                            if (tiles[tx][ty] === BLOCK.STONE) {
                                                tiles[tx][ty] = BLOCK.FROZEN_STONE;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            _placeGiantMushroom(tiles, x, groundY) {
                const height = 5 + Math.floor(Math.random() * 4);
                const capRadius = 2 + Math.floor(Math.random() * 2);

                // 茎
                for (let i = 1; i <= height && groundY - i >= 0; i++) {
                    tiles[x][groundY - i] = BLOCK.MUSHROOM_GIANT;
                }

                // 伞盖
                for (let dx = -capRadius; dx <= capRadius; dx++) {
                    const tx = x + dx;
                    const ty = groundY - height;
                    if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                        if (tiles[tx][ty] === BLOCK.AIR) {
                            tiles[tx][ty] = BLOCK.MUSHROOM_GIANT;
                        }
                        if (ty - 1 >= 0 && tiles[tx][ty - 1] === BLOCK.AIR && Math.abs(dx) < capRadius) {
                            tiles[tx][ty - 1] = BLOCK.MUSHROOM_GIANT;
                        }
                    }
                }
            }

            _structures(tiles, walls) {
                // 地表小屋
                for (let i = 0; i < 6 + Math.floor(Math.random() * 5); i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    this._placeHouse(tiles, walls, x);
                }

                // 地下遗迹小屋
                for (let i = 0; i < 8 + Math.floor(Math.random() * 6); i++) {
                    const x = 40 + Math.floor(Math.random() * (this.w - 80));
                    const y = Math.floor(this.h * (0.4 + Math.random() * 0.35));
                    this._placeUndergroundCabin(tiles, walls, x, y);
                }

                // 矿井入口
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const x = 60 + Math.floor(Math.random() * (this.w - 120));
                    this._placeMineEntrance(tiles, walls, x);
                }

                // 神殿
                if (Math.random() > 0.3) {
                    const x = 100 + Math.floor(Math.random() * (this.w - 200));
                    const y = Math.floor(this.h * (0.55 + Math.random() * 0.2));
                    this._placeTemple(tiles, walls, x, y);
                }
            }

            _placeHouse(tiles, walls, x) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY || groundY > this.h * 0.4) return;

                const w = 8 + Math.floor(Math.random() * 4);
                const h = 6 + Math.floor(Math.random() * 3);
                const biome = this._biome(x);

                let wallBlock = BLOCK.PLANKS;
                if (biome === 'desert' || biome === 'red_desert') wallBlock = BLOCK.SANDSTONE;
                if (biome === 'snow' || biome === 'tundra') wallBlock = Math.random() > 0.5 ? BLOCK.PLANKS : BLOCK.ICE;

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = groundY - h + dy;
                        if (tx >= this.w || ty < 0) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        const isDoor = dy === h - 1 && dx === Math.floor(w / 2);

                        if (isDoor) {
                            tiles[tx][ty] = BLOCK.AIR;
                        } else if (isWall) {
                            tiles[tx][ty] = wallBlock;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                            walls[tx][ty] = 1;
                        }
                    }
                }

                // 内部装饰
                const midX = x + Math.floor(w / 2);
                const floorY = groundY - 1;
                if (midX < this.w && floorY > 0) {
                    tiles[midX][groundY - h + 1] = BLOCK.LANTERN;
                    if (Math.random() > 0.5 && x + w - 2 < this.w) {
                        tiles[x + w - 2][floorY] = BLOCK.TREASURE_CHEST;
                    }
                }
            }

            _placeUndergroundCabin(tiles, walls, x, y) {
                const w = 7 + Math.floor(Math.random() * 5);
                const h = 5 + Math.floor(Math.random() * 3);

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = y + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        tiles[tx][ty] = isWall ? BLOCK.PLANKS : BLOCK.AIR;
                        if (!isWall) walls[tx][ty] = 1;
                    }
                }

                // 火把
                if (x + Math.floor(w / 2) < this.w && y + 1 < this.h) {
                    tiles[x + Math.floor(w / 2)][y + 1] = BLOCK.TORCH;
                }
                // 宝箱
                if (x + w - 2 < this.w && y + h - 2 < this.h && Math.random() > 0.3) {
                    tiles[x + w - 2][y + h - 2] = BLOCK.TREASURE_CHEST;
                }
            }

            _placeMineEntrance(tiles, walls, x) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY) return;

                // 矿井入口框架
                const entranceW = 4;
                const entranceH = 5;

                for (let dx = 0; dx < entranceW; dx++) {
                    for (let dy = 0; dy < entranceH; dy++) {
                        const tx = x + dx, ty = groundY + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        if (dx === 0 || dx === entranceW - 1) {
                            tiles[tx][ty] = BLOCK.PLANKS;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                        }
                    }
                }

                // 向下的竖井
                const shaftDepth = 20 + Math.floor(Math.random() * 30);
                for (let dy = entranceH; dy < shaftDepth; dy++) {
                    const ty = groundY + dy;
                    if (ty >= this.h - 10) break;

                    for (let dx = 1; dx < entranceW - 1; dx++) {
                        const tx = x + dx;
                        if (tx < this.w) tiles[tx][ty] = BLOCK.AIR;
                    }

                    // 周期性放置梯子平台
                    if (dy % 8 === 0) {
                        for (let dx = 0; dx < entranceW; dx++) {
                            const tx = x + dx;
                            if (tx < this.w) tiles[tx][ty] = BLOCK.PLANKS;
                        }
                    }

                    // 火把
                    if (dy % 6 === 0 && x < this.w) {
                        tiles[x][ty] = BLOCK.TORCH;
                    }
                }
            }

            _placeTemple(tiles, walls, x, y) {
                const w = 15 + Math.floor(Math.random() * 10);
                const h = 10 + Math.floor(Math.random() * 5);

                const wallBlock = Math.random() > 0.5 ? BLOCK.BRICK : BLOCK.COBBLESTONE;

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = y + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        const isPillar = (dx === 3 || dx === w - 4) && dy > 1 && dy < h - 1;

                        if (isWall || isPillar) {
                            tiles[tx][ty] = wallBlock;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                            walls[tx][ty] = 2;
                        }
                    }
                }

                // 中央宝藏
                const cx = x + Math.floor(w / 2);
                const cy = y + h - 2;
                if (cx < this.w && cy < this.h) {
                    tiles[cx][cy] = BLOCK.TREASURE_CHEST;
                    tiles[cx][y + 1] = BLOCK.LANTERN;

                    // 周围水晶
                    for (let i = 0; i < 4; i++) {
                        const crystalX = cx + (i % 2 === 0 ? -2 : 2);
                        const crystalY = cy - (i < 2 ? 0 : 1);
                        if (crystalX >= 0 && crystalX < this.w && crystalY >= 0 && crystalY < this.h) {
                            tiles[crystalX][crystalY] = Math.random() > 0.5 ? BLOCK.CRYSTAL : BLOCK.AMETHYST;
                        }
                    }
                }

                // 蜘蛛网装饰
                for (let i = 0; i < 5; i++) {
                    const wx = x + 1 + Math.floor(Math.random() * (w - 2));
                    const wy = y + 1 + Math.floor(Math.random() * 3);
                    if (wx < this.w && wy < this.h && tiles[wx][wy] === BLOCK.AIR) {
                        tiles[wx][wy] = BLOCK.SPIDER_WEB;
                    }
                }
            }

            _dungeons(tiles, walls) {
                const dungeonCount = 2 + Math.floor(Math.random() * 3);

                for (let d = 0; d < dungeonCount; d++) {
                    const startX = 80 + Math.floor(Math.random() * (this.w - 160));
                    const startY = Math.floor(this.h * (0.5 + Math.random() * 0.3));

                    this._createDungeon(tiles, walls, startX, startY);
                }

                // 额外添加特殊结构
                this._createSpecialFeatures(tiles, walls);

                // StructureDescriptor：从 JSON 结构库按深度抽取并焊接到地形中
                if (this._weldStructuresFromLibrary) this._weldStructuresFromLibrary(tiles, walls);
            }

            // 创建特殊地形特征
            _createSpecialFeatures(tiles, walls) {
                // 陨石坑
                for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
                    const mx = 100 + Math.floor(Math.random() * (this.w - 200));
                    this._createMeteoriteCrater(tiles, mx);
                }

                // 蜂巢
                for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
                    const hx = 60 + Math.floor(Math.random() * (this.w - 120));
                    const hy = Math.floor(this.h * (0.35 + Math.random() * 0.2));
                    this._createBeehive(tiles, walls, hx, hy);
                }

                // 蜘蛛巢穴
                for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
                    const sx = 50 + Math.floor(Math.random() * (this.w - 100));
                    const sy = Math.floor(this.h * (0.45 + Math.random() * 0.3));
                    this._createSpiderNest(tiles, walls, sx, sy);
                }

                // 生命树
                for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
                    const tx = 80 + Math.floor(Math.random() * (this.w - 160));
                    this._createLivingTree(tiles, walls, tx);
                }

                // 金字塔 (沙漠)
                this._createPyramids(tiles, walls);

                // 地下丛林神庙
                if (Math.random() > 0.4) {
                    const jx = Math.floor(this.w * 0.6 + Math.random() * this.w * 0.3);
                    const jy = Math.floor(this.h * (0.65 + Math.random() * 0.15));
                    this._createJungleTemple(tiles, walls, jx, jy);
                }

                // 天空岛链
                this._createSkyIslandChain(tiles, walls);

                // 地下蘑菇生态区
                this._createMushroomBiome(tiles, walls);

                // 腐化/猩红区域
                this._createEvilBiome(tiles, walls);

                // 神圣区域
                this._createHallowBiome(tiles, walls);

                // 海洋/沙滩
                this._createOceans(tiles, walls);

                // 药草分布
                this._distributeHerbs(tiles);

                // 生命水晶
                this._placeLifeCrystals(tiles);
            }

            _createMeteoriteCrater(tiles, cx) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[cx][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY) return;

                const craterRadius = 8 + Math.floor(Math.random() * 6);

                // 挖出陨石坑
                for (let dx = -craterRadius; dx <= craterRadius; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= this.w) continue;

                    const depth = Math.floor(Math.sqrt(craterRadius * craterRadius - dx * dx) * 0.7);
                    for (let dy = -2; dy < depth; dy++) {
                        const y = groundY + dy;
                        if (y >= 0 && y < this.h) {
                            tiles[x][y] = BLOCK.AIR;
                        }
                    }
                }

                // 填充陨石
                for (let dx = -craterRadius + 2; dx <= craterRadius - 2; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= this.w) continue;

                    const meteoriteHeight = Math.floor(Math.sqrt((craterRadius - 2) * (craterRadius - 2) - dx * dx) * 0.5);
                    for (let dy = 0; dy < meteoriteHeight; dy++) {
                        const y = groundY + Math.floor(craterRadius * 0.5) - dy;
                        if (y >= 0 && y < this.h && Math.random() > 0.15) {
                            tiles[x][y] = BLOCK.METEORITE;
                        }
                    }
                }
            }

            _createBeehive(tiles, walls, cx, cy) {
                const w = 12 + Math.floor(Math.random() * 8);
                const h = 8 + Math.floor(Math.random() * 6);

                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 0.85) {
                            if (dist > 0.7) {
                                tiles[x][y] = BLOCK.HIVE;
                            } else if (Math.random() > 0.6) {
                                tiles[x][y] = BLOCK.HONEY_BLOCK;
                            } else {
                                tiles[x][y] = BLOCK.AIR;
                            }
                            walls[x][y] = 1;
                        }
                    }
                }

                // 中心蜂窝
                if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                    tiles[cx][cy] = BLOCK.BEE_NEST;
                }
            }

            _createSpiderNest(tiles, walls, cx, cy) {
                const radius = 6 + Math.floor(Math.random() * 5);

                // 挖空区域
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < radius * 0.9) {
                            tiles[x][y] = BLOCK.AIR;
                            walls[x][y] = 2;
                        }
                    }
                }

                // 添加蜘蛛网
                for (let i = 0; i < radius * 3; i++) {
                    const wx = cx + Math.floor((Math.random() - 0.5) * radius * 1.5);
                    const wy = cy + Math.floor((Math.random() - 0.5) * radius * 1.5);
                    if (wx >= 0 && wx < this.w && wy >= 0 && wy < this.h) {
                        if (tiles[wx][wy] === BLOCK.AIR) {
                            tiles[wx][wy] = BLOCK.SPIDER_WEB;
                        }
                    }
                }

                // 中心蜘蛛巢
                if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                    tiles[cx][cy] = BLOCK.SPIDER_NEST;
                }
            }

            _createLivingTree(tiles, walls, cx) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[cx][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY || groundY > this.h * 0.4) return;

                const trunkWidth = 4 + Math.floor(Math.random() * 3);
                const trunkHeight = 25 + Math.floor(Math.random() * 20);
                const rootDepth = 15 + Math.floor(Math.random() * 10);

                // 树干
                for (let dx = -trunkWidth / 2; dx < trunkWidth / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    for (let dy = 1; dy <= trunkHeight; dy++) {
                        const y = groundY - dy;
                        if (y >= 0) {
                            tiles[x][y] = BLOCK.LIVING_WOOD;
                        }
                    }
                }

                // 树根 (向下延伸)
                for (let dx = -trunkWidth / 2; dx < trunkWidth / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    for (let dy = 0; dy < rootDepth; dy++) {
                        const y = groundY + dy;
                        if (y < this.h) {
                            tiles[x][y] = BLOCK.LIVING_WOOD;
                            walls[x][y] = 1;
                        }
                    }
                }

                // 地下房间
                const roomY = groundY + Math.floor(rootDepth / 2);
                const roomW = 6 + Math.floor(Math.random() * 4);
                const roomH = 5 + Math.floor(Math.random() * 3);

                for (let dx = -roomW / 2; dx < roomW / 2; dx++) {
                    for (let dy = -roomH / 2; dy < roomH / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(roomY + dy);
                        if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                            tiles[x][y] = BLOCK.AIR;
                            walls[x][y] = 1;
                        }
                    }
                }

                // 宝箱
                if (cx >= 0 && cx < this.w && roomY >= 0 && roomY < this.h) {
                    tiles[cx][Math.floor(roomY + roomH / 2 - 1)] = BLOCK.TREASURE_CHEST;
                    tiles[cx][Math.floor(roomY - roomH / 2 + 1)] = BLOCK.LANTERN;
                }

                // 树冠
                const canopyRadius = trunkWidth + 4 + Math.floor(Math.random() * 3);
                for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
                    for (let dy = -canopyRadius; dy <= 2; dy++) {
                        const x = cx + dx;
                        const y = groundY - trunkHeight + dy;
                        if (x < 0 || x >= this.w || y < 0) continue;

                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= canopyRadius && tiles[x][y] === BLOCK.AIR && Math.random() > 0.2) {
                            tiles[x][y] = BLOCK.LIVING_LEAF;
                        }
                    }
                }
            }

            _createPyramids(tiles, walls) {
                // 找沙漠区域
                for (let x = 50; x < this.w - 50; x += 80) {
                    const biome = this._biome(x);
                    if (biome !== 'desert' && biome !== 'red_desert') continue;
                    if (Math.random() > 0.4) continue;

                    let groundY = 0;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }
                    if (!groundY) continue;

                    const pyramidW = 30 + Math.floor(Math.random() * 20);
                    const pyramidH = Math.floor(pyramidW * 0.6);

                    // 金字塔外壳
                    for (let layer = 0; layer < pyramidH; layer++) {
                        const layerW = pyramidW - layer * 2;
                        const y = groundY - layer;
                        if (y < 0) break;

                        for (let dx = -layerW / 2; dx < layerW / 2; dx++) {
                            const px = Math.floor(x + dx);
                            if (px >= 0 && px < this.w) {
                                tiles[px][y] = BLOCK.SANDSTONE;
                            }
                        }
                    }

                    // 内部通道和房间
                    const corridorY = groundY - Math.floor(pyramidH / 3);
                    const roomY = groundY - Math.floor(pyramidH / 2);

                    // 入口通道
                    for (let dy = 0; dy < pyramidH / 2; dy++) {
                        const y = groundY - dy;
                        if (y >= 0 && tiles[x][y] !== BLOCK.AIR) {
                            tiles[x][y] = BLOCK.AIR;
                            if (x - 1 >= 0) tiles[x - 1][y] = BLOCK.AIR;
                        }
                    }

                    // 宝藏室
                    const treasureRoomW = 8;
                    const treasureRoomH = 6;
                    for (let dx = -treasureRoomW / 2; dx < treasureRoomW / 2; dx++) {
                        for (let dy = -treasureRoomH / 2; dy < treasureRoomH / 2; dy++) {
                            const px = Math.floor(x + dx);
                            const py = Math.floor(roomY + dy);
                            if (px >= 0 && px < this.w && py >= 0 && py < this.h) {
                                tiles[px][py] = BLOCK.AIR;
                                walls[px][py] = 1;
                            }
                        }
                    }

                    // 宝箱和装饰
                    if (x >= 0 && x < this.w && roomY >= 0 && roomY < this.h) {
                        tiles[x][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.TREASURE_CHEST;
                        tiles[x - 2][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.GOLD_BRICK;
                        tiles[x + 2][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.GOLD_BRICK;
                    }
                }
            }

            _createJungleTemple(tiles, walls, cx, cy) {
                const w = 40 + Math.floor(Math.random() * 20);
                const h = 30 + Math.floor(Math.random() * 15);

                const wallBlock = BLOCK.LIHZAHRD_BRICK;

                // 外墙
                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x >= this.w || y >= this.h) continue;

                        const isWall = dx < 3 || dx >= w - 3 || dy < 3 || dy >= h - 3;
                        tiles[x][y] = isWall ? wallBlock : BLOCK.AIR;
                        if (!isWall) walls[x][y] = 2;
                    }
                }

                // 内部隔墙
                for (let i = 0; i < 5; i++) {
                    const wx = cx + 5 + Math.floor(Math.random() * (w - 10));
                    const wy = cy + 5;
                    const wh = Math.floor(Math.random() * (h - 10));

                    for (let dy = 0; dy < wh; dy++) {
                        if (wx < this.w && wy + dy < this.h) {
                            tiles[wx][wy + dy] = wallBlock;
                        }
                    }
                }

                // 机关和宝藏
                const treasureX = cx + Math.floor(w / 2);
                const treasureY = cy + h - 5;
                if (treasureX < this.w && treasureY < this.h) {
                    tiles[treasureX][treasureY] = BLOCK.TREASURE_CHEST;
                    tiles[treasureX][cy + 4] = BLOCK.LANTERN;
                }

                // 祭坛
                const altarX = cx + Math.floor(w / 2);
                const altarY = cy + Math.floor(h / 2);
                if (altarX < this.w && altarY < this.h) {
                    tiles[altarX][altarY] = BLOCK.ALTAR;
                }
            }

            _createSkyIslandChain(tiles, walls) {
                const chainCount = 1 + Math.floor(Math.random() * 2);

                for (let c = 0; c < chainCount; c++) {
                    const startX = 100 + Math.floor(Math.random() * (this.w - 300));
                    const startY = 8 + Math.floor(Math.random() * 12);
                    const islandCount = 3 + Math.floor(Math.random() * 4);

                    let currentX = startX;
                    let currentY = startY;

                    for (let i = 0; i < islandCount; i++) {
                        const iw = 15 + Math.floor(Math.random() * 15);
                        const ih = 5 + Math.floor(Math.random() * 4);

                        // 云层基础
                        for (let dx = -iw / 2; dx < iw / 2; dx++) {
                            const x = Math.floor(currentX + dx);
                            if (x < 0 || x >= this.w) continue;

                            const edgeDist = Math.min(dx + iw / 2, iw / 2 - dx) / (iw / 2);
                            const height = Math.floor(ih * edgeDist);

                            for (let dy = 0; dy < height; dy++) {
                                const y = currentY + dy;
                                if (y >= 0 && y < this.h) {
                                    if (dy === 0) {
                                        tiles[x][y] = BLOCK.SUNPLATE;
                                    } else if (dy < 2) {
                                        tiles[x][y] = BLOCK.CLOUD;
                                    } else {
                                        tiles[x][y] = Math.random() > 0.5 ? BLOCK.CLOUD : BLOCK.RAIN_CLOUD;
                                    }
                                }
                            }
                        }

                        // 岛上建筑
                        if (Math.random() > 0.4) {
                            const houseX = Math.floor(currentX);
                            const houseY = currentY - 1;
                            if (houseX >= 0 && houseX < this.w && houseY >= 0) {
                                // 小房子
                                for (let hdx = -3; hdx <= 3; hdx++) {
                                    for (let hdy = 0; hdy < 4; hdy++) {
                                        const hx = houseX + hdx;
                                        const hy = houseY - hdy;
                                        if (hx >= 0 && hx < this.w && hy >= 0) {
                                            if (hdx === -3 || hdx === 3 || hdy === 0 || hdy === 3) {
                                                tiles[hx][hy] = BLOCK.SUNPLATE;
                                            } else {
                                                tiles[hx][hy] = BLOCK.AIR;
                                            }
                                        }
                                    }
                                }
                                tiles[houseX][houseY] = BLOCK.TREASURE_CHEST;
                            }
                        }

                        currentX += iw + 10 + Math.floor(Math.random() * 15);
                        currentY += Math.floor(Math.random() * 5) - 2;
                        currentY = Utils.clamp(currentY, 5, 25);
                    }
                }
            }

            _createMushroomBiome(tiles, walls) {
                const biomeCount = 1 + Math.floor(Math.random() * 2);

                for (let b = 0; b < biomeCount; b++) {
                    const cx = 100 + Math.floor(Math.random() * (this.w - 200));
                    const cy = Math.floor(this.h * (0.55 + Math.random() * 0.15));
                    const radius = 30 + Math.floor(Math.random() * 25);

                    // 转换区域为蘑菇生态
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dy = -radius; dy <= radius; dy++) {
                            const x = cx + dx;
                            const y = cy + dy;
                            if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist > radius) continue;

                            const block = tiles[x][y];

                            // 转换方块
                            if (block === BLOCK.STONE) {
                                tiles[x][y] = Math.random() > 0.3 ? BLOCK.MUSHROOM_GRASS : block;
                            } else if (block === BLOCK.DIRT) {
                                tiles[x][y] = BLOCK.MUD;
                            }

                            // 在空气中生成蘑菇
                            if (block === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                                if (Math.random() > 0.9) {
                                    tiles[x][y] = BLOCK.UNDERGROUND_MUSHROOM;
                                }
                            }
                        }
                    }

                    // 巨型蘑菇
                    for (let i = 0; i < 5 + Math.floor(Math.random() * 5); i++) {
                        const mx = cx + Math.floor((Math.random() - 0.5) * radius);
                        const my = cy + Math.floor((Math.random() - 0.5) * radius);
                        if (mx >= 0 && mx < this.w && my >= 0 && my < this.h) {
                            if (tiles[mx][my] === BLOCK.AIR && my + 1 < this.h && BLOCK_DATA[tiles[mx][my + 1]]?.solid) {
                                this._placeGiantMushroom(tiles, mx, my);
                            }
                        }
                    }
                }
            }

            _createEvilBiome(tiles, walls) {
                const isCrimson = Math.random() > 0.5;
                const stoneType = isCrimson ? BLOCK.CRIMSON_STONE : BLOCK.EBONSTONE;
                const altarType = isCrimson ? BLOCK.CRIMSON_ALTAR : BLOCK.DEMON_ALTAR;

                // 在世界一侧创建邪恶生态
                const side = Math.random() > 0.5 ? 'left' : 'right';
                const startX = side === 'left' ? 30 : this.w - 80;
                const endX = side === 'left' ? 80 : this.w - 30;

                for (let x = startX; x < endX; x++) {
                    for (let y = Math.floor(this.h * 0.25); y < this.h * 0.85; y++) {
                        if (x < 0 || x >= this.w) continue;

                        const block = tiles[x][y];

                        if (block === BLOCK.STONE || block === BLOCK.GRANITE || block === BLOCK.SLATE) {
                            if (Math.random() > 0.3) {
                                tiles[x][y] = stoneType;
                            }
                        } else if (block === BLOCK.GRASS) {
                            tiles[x][y] = isCrimson ? BLOCK.CRIMSON_STONE : BLOCK.CORRUPTION_STONE;
                        }
                    }
                }

                // 放置祭坛
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const ax = startX + Math.floor(Math.random() * (endX - startX));
                    const ay = Math.floor(this.h * (0.4 + Math.random() * 0.3));
                    if (ax >= 0 && ax < this.w && ay >= 0 && ay < this.h) {
                        if (tiles[ax][ay] === BLOCK.AIR || tiles[ax][ay] === stoneType) {
                            tiles[ax][ay] = altarType;
                        }
                    }
                }
            }

            _createHallowBiome(tiles, walls) {
                // 在世界另一侧创建神圣生态
                const cx = Math.floor(this.w * 0.7);
                const radius = 40 + Math.floor(Math.random() * 20);

                for (let dx = -radius; dx <= radius; dx++) {
                    for (let y = Math.floor(this.h * 0.25); y < this.h * 0.75; y++) {
                        const x = cx + dx;
                        if (x < 0 || x >= this.w) continue;

                        const dist = Math.abs(dx) / radius;
                        if (dist > 1 || Math.random() > (1 - dist * 0.5)) continue;

                        const block = tiles[x][y];

                        if (block === BLOCK.STONE) {
                            tiles[x][y] = Math.random() > 0.5 ? BLOCK.PEARLSTONE : BLOCK.HALLOW_STONE;
                        } else if (block === BLOCK.GRASS) {
                            tiles[x][y] = BLOCK.HALLOW_STONE;
                        } else if (block === BLOCK.SAND) {
                            tiles[x][y] = BLOCK.PEARLSTONE;
                        }
                    }
                }
            }

            _createOceans(tiles, walls) {
                // 左侧海洋
                this._createOcean(tiles, 0, 60, true);
                // 右侧海洋
                this._createOcean(tiles, this.w - 60, this.w, false);
            }

            _createOcean(tiles, startX, endX, isLeft) {
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);
                const oceanDepth = 20 + Math.floor(Math.random() * 15);

                for (let x = startX; x < endX; x++) {
                    if (x < 0 || x >= this.w) continue;

                    // 找地表
                    let groundY = surfY;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }

                    // 挖深并填水
                    const depth = oceanDepth * (isLeft ? (endX - x) / (endX - startX) : (x - startX) / (endX - startX));

                    for (let dy = 0; dy < depth; dy++) {
                        const y = groundY + dy;
                        if (y >= this.h) break;

                        tiles[x][y] = BLOCK.WATER;
                    }

                    // 海底沙子
                    for (let dy = Math.floor(depth); dy < Math.floor(depth) + 5; dy++) {
                        const y = groundY + dy;
                        if (y >= this.h) break;
                        tiles[x][y] = BLOCK.SAND;
                    }

                    // 海草和海带
                    if (Math.random() > 0.85) {
                        const seaY = groundY + Math.floor(depth) - 1;
                        if (seaY >= 0 && seaY < this.h && tiles[x][seaY] === BLOCK.WATER) {
                            tiles[x][seaY] = Math.random() > 0.5 ? BLOCK.SEAWEED : BLOCK.KELP;
                        }
                    }

                    // 珊瑚
                    if (Math.random() > 0.92) {
                        const coralY = groundY + Math.floor(depth);
                        if (coralY >= 0 && coralY < this.h) {
                            tiles[x][coralY] = BLOCK.CORAL;
                        }
                    }
                }
            }

            _distributeHerbs(tiles) {
                const herbs = [
                    { id: BLOCK.DAYBLOOM, biomes: ['plains', 'forest'], surface: true },
                    { id: BLOCK.MOONGLOW, biomes: ['jungle', 'bamboo'], underground: true },
                    { id: BLOCK.BLINKROOT, biomes: ['all'], underground: true },
                    { id: BLOCK.WATERLEAF, biomes: ['desert', 'red_desert'], surface: true },
                    { id: BLOCK.FIREBLOSSOM, biomes: ['all'], hell: true },
                    { id: BLOCK.SHIVERTHORN, biomes: ['snow', 'tundra'], surface: true },
                    { id: BLOCK.DEATHWEED, biomes: ['all'], underground: true }
                ];

                for (let x = 10; x < this.w - 10; x++) {
                    const biome = this._biome(x);

                    for (const herb of herbs) {
                        if (herb.biomes[0] !== 'all' && !herb.biomes.includes(biome)) continue;
                        if (Math.random() > 0.005) continue;

                        let startY, endY;
                        if (herb.surface) {
                            startY = 0;
                            endY = Math.floor(this.h * 0.35);
                        } else if (herb.underground) {
                            startY = Math.floor(this.h * 0.35);
                            endY = Math.floor(this.h * 0.85);
                        } else if (herb.hell) {
                            startY = Math.floor(this.h * 0.9);
                            endY = this.h - 5;
                        }

                        for (let y = startY; y < endY; y++) {
                            if (tiles[x][y] === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                                tiles[x][y] = herb.id;
                                break;
                            }
                        }
                    }
                }
            }

            _placeLifeCrystals(tiles) {
                const crystalCount = 15 + Math.floor(Math.random() * 10);

                for (let i = 0; i < crystalCount; i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    const y = Math.floor(this.h * (0.4 + Math.random() * 0.4));

                    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                        if (tiles[x][y] === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            tiles[x][y] = Math.random() > 0.7 ? BLOCK.HEART_CRYSTAL : BLOCK.LIFE_CRYSTAL;
                        }
                    }
                }

                // 魔力水晶
                const manaCount = 10 + Math.floor(Math.random() * 8);
                for (let i = 0; i < manaCount; i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    const y = Math.floor(this.h * (0.5 + Math.random() * 0.35));

                    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                        if (tiles[x][y] === BLOCK.AIR) {
                            tiles[x][y] = BLOCK.MANA_CRYSTAL;
                        }
                    }
                }
            }

            _createDungeon(tiles, walls, startX, startY) {
                const roomCount = 4 + Math.floor(Math.random() * 4);
                const rooms = [];

                // 生成房间
                let lastRoom = { x: startX, y: startY, w: 8, h: 6 };
                rooms.push(lastRoom);

                for (let i = 1; i < roomCount; i++) {
                    const dir = Math.floor(Math.random() * 4);
                    let nx = lastRoom.x, ny = lastRoom.y;
                    const nw = 6 + Math.floor(Math.random() * 5);
                    const nh = 5 + Math.floor(Math.random() * 4);

                    switch (dir) {
                        case 0: nx = lastRoom.x + lastRoom.w + 5 + Math.floor(Math.random() * 8); break;
                        case 1: nx = lastRoom.x - nw - 5 - Math.floor(Math.random() * 8); break;
                        case 2: ny = lastRoom.y + lastRoom.h + 3 + Math.floor(Math.random() * 5); break;
                        case 3: ny = lastRoom.y - nh - 3 - Math.floor(Math.random() * 5); break;
                    }

                    if (nx < 10 || nx + nw >= this.w - 10 || ny < this.h * 0.35 || ny + nh >= this.h - 10) continue;

                    const newRoom = { x: nx, y: ny, w: nw, h: nh };
                    rooms.push(newRoom);

                    // 连接走廊
                    this._createCorridor(tiles, walls, lastRoom, newRoom);
                    lastRoom = newRoom;
                }

                // 绘制房间
                const wallBlock = BLOCK.BRICK;
                for (const room of rooms) {
                    for (let dx = 0; dx < room.w; dx++) {
                        for (let dy = 0; dy < room.h; dy++) {
                            const tx = room.x + dx, ty = room.y + dy;
                            if (tx >= this.w || ty >= this.h || tx < 0 || ty < 0) continue;

                            const isWall = dx === 0 || dx === room.w - 1 || dy === 0 || dy === room.h - 1;
                            tiles[tx][ty] = isWall ? wallBlock : BLOCK.AIR;
                            if (!isWall) walls[tx][ty] = 2;
                        }
                    }

                    // 房间装饰
                    const midX = room.x + Math.floor(room.w / 2);
                    const floorY = room.y + room.h - 2;

                    if (midX < this.w && room.y + 1 < this.h) {
                        tiles[midX][room.y + 1] = BLOCK.LANTERN;
                    }

                    // 随机放置物品
                    if (Math.random() > 0.4) {
                        const itemX = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
                        if (itemX < this.w && floorY < this.h && tiles[itemX][floorY] === BLOCK.AIR) {
                            const r = Math.random();
                            if (r > 0.7) tiles[itemX][floorY] = BLOCK.TREASURE_CHEST;
                            else if (r > 0.4) tiles[itemX][floorY] = BLOCK.CRYSTAL;
                            else tiles[itemX][floorY] = BLOCK.BONE;
                        }
                    }

                    // 蜘蛛网
                    if (Math.random() > 0.5) {
                        for (let i = 0; i < 3; i++) {
                            const wx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
                            const wy = room.y + 1 + Math.floor(Math.random() * 2);
                            if (wx < this.w && wy < this.h && tiles[wx][wy] === BLOCK.AIR) {
                                tiles[wx][wy] = BLOCK.SPIDER_WEB;
                            }
                        }
                    }
                }
            }

            _createCorridor(tiles, walls, room1, room2) {
                const x1 = Math.floor(room1.x + room1.w / 2);
                const y1 = Math.floor(room1.y + room1.h / 2);
                const x2 = Math.floor(room2.x + room2.w / 2);
                const y2 = Math.floor(room2.y + room2.h / 2);

                let cx = x1, cy = y1;

                // 先水平后垂直
                while (cx !== x2) {
                    if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                        tiles[cx][cy] = BLOCK.AIR;
                        if (cy - 1 >= 0) tiles[cx][cy - 1] = BLOCK.AIR;
                        if (cy + 1 < this.h) tiles[cx][cy + 1] = BLOCK.AIR;
                        walls[cx][cy] = 2;
                    }
                    cx += cx < x2 ? 1 : -1;
                }

                while (cy !== y2) {
                    if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                        tiles[cx][cy] = BLOCK.AIR;
                        if (cx - 1 >= 0) tiles[cx - 1][cy] = BLOCK.AIR;
                        if (cx + 1 < this.w) tiles[cx + 1][cy] = BLOCK.AIR;
                        walls[cx][cy] = 2;
                    }
                    cy += cy < y2 ? 1 : -1;
                }
            }

            _lighting(tiles, light) {
                // 阳光（垂直直射）+ 收集光源
                const w = this.w, h = this.h;
                const srcX = [];
                const srcY = [];
                const srcL = [];

                for (let x = 0; x < w; x++) {
                    let sun = CONFIG.LIGHT_LEVELS;
                    const colTiles = tiles[x];
                    const colLight = light[x];

                    for (let y = 0; y < h; y++) {
                        const id = colTiles[y];

                        // SUN_DECAY: 0 / 1 / 3（与原规则一致）
                        const decay = SUN_DECAY[id];
                        if (decay) sun = sun > decay ? (sun - decay) : 0;

                        const bl = BLOCK_LIGHT[id];
                        const v = sun > bl ? sun : bl;
                        colLight[y] = v;

                        // 只扩散“方块光源”，不扩散太阳光（保持旧效果：太阳光只向下直射）
                        if (bl > 0) {
                            srcX.push(x);
                            srcY.push(y);
                            srcL.push(bl);
                        }
                    }
                }

                // 多光源一次性扩散（比逐个光源 BFS 更快，且无需 visited Set / queue.shift）
                if (srcX.length) this._spreadLights(tiles, light, srcX, srcY, srcL);
            }

            _spreadLights(tiles, light, srcX, srcY, srcL) {
                const w = this.w, h = this.h;

                // 复用数组队列（避免对象分配）
                const qx = [];
                const qy = [];
                const ql = [];
                let head = 0;

                for (let i = 0; i < srcX.length; i++) {
                    qx.push(srcX[i]);
                    qy.push(srcY[i]);
                    ql.push(srcL[i]);
                }

                while (head < qx.length) {
                    const x = qx[head];
                    const y = qy[head];
                    const l = ql[head];
                    head++;

                    if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;

                    const colLight = light[x];
                    if (l <= colLight[y]) continue; // 不会变亮就不传播，天然去重
                    colLight[y] = l;

                    const nl = l - (BLOCK_SOLID[tiles[x][y]] ? 2 : 1);
                    if (nl > 0) {
                        // push 顺序与旧实现一致：left, right, up, down
                        qx.push(x - 1, x + 1, x, x);
                        qy.push(y, y, y - 1, y + 1);
                        ql.push(nl, nl, nl, nl);
                    }
                }
            }

        }

        // ───────────────────────── WorldGen: weld StructureDescriptors into terrain ─────────────────────────
        WorldGenerator.prototype._weldStructuresFromLibrary = function (tiles, walls) {
            const TU = window.TU || {};
            const lib = TU.Structures;
            if (!lib) return;
            lib.ensureLoaded();
            if (!lib.count || !lib.count()) return;

            const w = this.w, h = this.h;

            const randInt = (a, b) => (a + Math.floor(Math.random() * (b - a + 1))) | 0;
            const clampI = (n, lo, hi) => (n < lo ? lo : (n > hi ? hi : n)) | 0;

            const groundYAt = (x) => {
                if (x < 0 || x >= w) return -1;
                const col = tiles[x];
                for (let y = 0; y < h; y++) {
                    if (col[y] !== BLOCK.AIR) return y;
                }
                return -1;
            };

            const tryPlace = (desc, anchorX, anchorY) => {
                if (!desc) return false;
                const tlx = (anchorX - Math.floor(desc.w * desc.anchor[0])) | 0;
                const tly = (anchorY - Math.floor(desc.h * desc.anchor[1])) | 0;

                // v11-safe bounds: keep a 1-tile margin to reduce edge-cases
                if (tlx < 1 || tly < 1 || tlx + desc.w >= w - 1 || tly + desc.h >= h - 1) return false;

                // 轻量采样碰撞检测：地下结构要求一定比例的“固体”
                const needSolid = desc.placement.mode !== 'surface';
                const minSolid = desc.placement.minSolidRatio || 0;
                if (needSolid && minSolid > 0) {
                    const samples = 36;
                    let solid = 0;
                    for (let i = 0; i < samples; i++) {
                        const sx = tlx + randInt(0, desc.w - 1);
                        const sy = tly + randInt(0, desc.h - 1);
                        const id = tiles[sx][sy];
                        if (BLOCK_SOLID[id]) solid++;
                    }
                    if (solid / samples < minSolid) return false;
                }

                // 写入结构（grid/legend）
                const defWall = (desc.placement.defaultWall | 0) & 255;

                for (let gy = 0; gy < desc.h; gy++) {
                    const row = desc.grid[gy];
                    const yy = tly + gy;
                    if (yy < 0 || yy >= h) continue;

                    for (let gx = 0; gx < desc.w; gx++) {
                        const xx = tlx + gx;
                        if (xx < 0 || xx >= w) continue;

                        const ch = row[gx];
                        if (ch === ' ') continue;

                        const rule = desc.legend[ch];
                        if (!rule) continue;
                        if (rule.chance < 1 && Math.random() > rule.chance) continue;

                        const cur = tiles[xx][yy];
                        if (rule.replace === 'air' && cur !== BLOCK.AIR) continue;
                        if (rule.replace === 'solid' && !BLOCK_SOLID[cur]) continue;

                        if (rule.tile !== null && rule.tile !== undefined) {
                            tiles[xx][yy] = rule.tile & 255;
                            if ((rule.tile & 255) === BLOCK.AIR && defWall) walls[xx][yy] = defWall;
                        }
                        if (rule.wall !== null && rule.wall !== undefined) {
                            walls[xx][yy] = rule.wall & 255;
                        }
                    }
                }

                // “焊接”：从连接点向外挖掘短通道，尽量连到已有空腔
                if (desc.connectors && desc.connectors.length) {
                    for (let i = 0; i < desc.connectors.length; i++) {
                        const c = desc.connectors[i];
                        const cx = tlx + c.x;
                        const cy = tly + c.y;
                        if (cx < 1 || cx >= w - 1 || cy < 1 || cy >= h - 1) continue;

                        if (c.carve) {
                            const wallId = (c.wall === null || c.wall === undefined) ? defWall : (c.wall & 255);
                            this._carveConnectorTunnel(tiles, walls, cx, cy, c.dir, c.len, wallId);
                        }
                    }
                }
                return true;
            };

            // 计划：按深度分布自动抽取结构
            const scale = Math.max(1, (w / 260));
            const plan = [
                { tag: 'tree', count: randInt(3, 6) * scale, depth: [0.08, 0.32] },
                { tag: 'ruin', count: randInt(6, 10) * scale, depth: [0.34, 0.72] },
                { tag: 'dungeon', count: randInt(8, 14) * scale, depth: [0.60, 0.92] }
            ];

            for (let p = 0; p < plan.length; p++) {
                const { tag, count, depth } = plan[p];
                const triesPer = 12;

                for (let i = 0; i < count; i++) {
                    const dn = depth[0] + Math.random() * (depth[1] - depth[0]);
                    const desc = lib.pick(dn, tag) || lib.pick(dn, [tag, 'room']);

                    let placed = false;
                    for (let t = 0; t < triesPer && !placed; t++) {
                        const x = randInt(20, w - 21);

                        let y;
                        if (desc && desc.placement.mode === 'surface') {
                            const gy = groundYAt(x);
                            if (gy < 0 || gy > h * 0.55) continue;
                            y = gy - 1;
                        } else {
                            y = clampI((dn * h) | 0, 10, h - 11);
                            y += randInt(-12, 12);
                            y = clampI(y, 10, h - 11);
                        }
                        placed = tryPlace(desc, x, y);
                    }
                }
            }
        };

        WorldGenerator.prototype._carveConnectorTunnel = function (tiles, walls, x, y, dir, len, wallId) {
            const w = this.w, h = this.h;
            let dx = 0, dy = 0;
            switch (dir) {
                case 'left': dx = -1; break;
                case 'right': dx = 1; break;
                case 'up': dy = -1; break;
                case 'down': dy = 1; break;
                default: return;
            }

            // 从连接点开始向外“找空腔”：最多 len 格；遇到连续空气（已有洞穴/通道）就停
            let ax = x, ay = y;
            let airStreak = 0;
            for (let i = 0; i < len; i++) {
                ax += dx; ay += dy;
                if (ax < 1 || ax >= w - 1 || ay < 1 || ay >= h - 1) break;

                const cur = tiles[ax][ay];
                if (cur === BLOCK.AIR) {
                    airStreak++;
                    if (i > 3 && airStreak >= 2) break;
                } else {
                    airStreak = 0;
                }

                tiles[ax][ay] = BLOCK.AIR;
                if (wallId) walls[ax][ay] = wallId & 255;

                // 做一点点宽度（避免 1 格通道太别扭）
                if (i > 1 && (dx !== 0)) {
                    if (ay - 1 > 0) { tiles[ax][ay - 1] = BLOCK.AIR; if (wallId) walls[ax][ay - 1] = wallId & 255; }
                    if (ay + 1 < h - 1) { tiles[ax][ay + 1] = BLOCK.AIR; if (wallId) walls[ax][ay + 1] = wallId & 255; }
                } else if (i > 1 && (dy !== 0)) {
                    if (ax - 1 > 0) { tiles[ax - 1][ay] = BLOCK.AIR; if (wallId) walls[ax - 1][ay] = wallId & 255; }
                    if (ax + 1 < w - 1) { tiles[ax + 1][ay] = BLOCK.AIR; if (wallId) walls[ax + 1][ay] = wallId & 255; }
                }
            }
        };

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { WorldGenerator });

    </script>

window.TU = window.TU || {};
Object.assign(window.TU, { TextureGenerator, WorldGenerator });
