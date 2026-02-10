// ═══════════════════════════════════════════════════════════════════════════════
// Terraria Ultra - Game Constants & Block System
// Consolidated from core/game_constants module
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

    <script>
        // ═══════════════════════════════════════════════════════════════════════════════
        //                                  配置常量
        // ═══════════════════════════════════════════════════════════════════════════════
        const CONFIG = Object.freeze({
            TILE_SIZE: 16,
            WORLD_WIDTH: 600,
            WORLD_HEIGHT: 300,
            GRAVITY: 0.42,
            MAX_FALL_SPEED: 14,
            PLAYER_SPEED: 3.2,
            SPRINT_MULT: 1.5,
            // Sprint feel
            // - Hold A/D to sprint after this delay (ms)
            SPRINT_HOLD_MS: 180,
            // - Short burst of extra acceleration when sprint starts (ms)
            SPRINT_BOOST_MS: 220,
            // - Acceleration multiplier during the boost window
            SPRINT_BOOST_ACCEL_MULT: 1.65,
            // - Small initial velocity kick when sprint starts (px/frame-ish)
            SPRINT_KICK: 1.6,
            // - Visual FX "speed feel" duration after sprint start (ms)
            SPRINT_VFX_MS: 280,
            // Sprint ↔ Air polish
            // - Landing "perfect timing" window: within this time after landing, holding a direction can instantly resume sprint (ms)
            PERFECT_LAND_MS: 100,
            // - In air keep a bit of ground-sprint inertia (no extra accel), but cap it lower than full sprint
            AIR_INERTIA_MULT: 1.18,
            // - Sprint start lean animation
            SPRINT_LEAN_MS: 160,
            SPRINT_LEAN_ANGLE: 0.20,
            // - Sprint landing feedback
            LAND_DUST_COUNT: 12,
            LAND_SHAKE_AMP: 1.8,
            LAND_SHAKE_MS: 110,
            JUMP_FORCE: 9.0,
            AIR_CONTROL: 0.65,
            FRICTION: 0.83,
            REACH_DISTANCE: 5,
            LIGHT_LEVELS: 16,
            DAY_LENGTH: 120000,
            SURFACE_LEVEL: 0.25,
            UNDERGROUND_LEVEL: 0.38,
            CAVERN_LEVEL: 0.58,
            UNDERWORLD_LEVEL: 0.90
        });

        // ═══════════════════════════════════════════════════════════════════════════════
        // 配置别名兼容（某些补丁使用 CFG 而非 CONFIG）
        // ═══════════════════════════════════════════════════════════════════════════════
        const CFG = CONFIG;

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                  方块系统
        // ═══════════════════════════════════════════════════════════════════════════════
        const BLOCK = Object.freeze({
            AIR: 0, DIRT: 1, GRASS: 2, STONE: 3, WOOD: 4, LEAVES: 5,
            SAND: 6, SNOW: 7, ICE: 8, MUD: 9, CLAY: 10, LOG: 11,
            COPPER_ORE: 12, IRON_ORE: 13, SILVER_ORE: 14, GOLD_ORE: 15,
            DIAMOND_ORE: 16, HELLSTONE: 17, OBSIDIAN: 18,
            COBBLESTONE: 19, MOSSY_STONE: 20, GRANITE: 21, MARBLE: 22,
            PLANKS: 23, BRICK: 24, GLASS: 25, TORCH: 26,
            WATER: 27, LAVA: 28, ASH: 29, BEDROCK: 30,
            MUSHROOM: 31, FLOWER_RED: 32, FLOWER_YELLOW: 33, TALL_GRASS: 34,
            CACTUS: 35, SNOW_GRASS: 36, JUNGLE_GRASS: 37, CRYSTAL: 38,
            // 新增方块类型
            AMETHYST: 39, RUBY_ORE: 40, EMERALD_ORE: 41, SAPPHIRE_ORE: 42,
            GLOWSTONE: 43, MUSHROOM_GIANT: 44, VINE: 45, CORAL: 46,
            SANDSTONE: 47, RED_SAND: 48, GRAVEL: 49, LIMESTONE: 50,
            SLATE: 51, BASALT: 52, FROZEN_STONE: 53, MOSS: 54,
            SPIDER_WEB: 55, BONE: 56, TREASURE_CHEST: 57, LANTERN: 58,
            PINK_FLOWER: 59, BLUE_FLOWER: 60, SUNFLOWER: 61, FERN: 62,
            BAMBOO: 63, PALM_LOG: 64, PALM_LEAVES: 65, CHERRY_LOG: 66,
            CHERRY_LEAVES: 67, PINE_LOG: 68, PINE_LEAVES: 69, STALAGMITE: 70,
            STALACTITE: 71, UNDERGROUND_MUSHROOM: 72, GLOWING_MOSS: 73,
            // 更多新增方块 - 超级丰富版
            METEORITE: 74, TITANIUM_ORE: 75, COBALT_ORE: 76, MYTHRIL_ORE: 77,
            ORICHALCUM_ORE: 78, ADAMANTITE_ORE: 79, CHLOROPHYTE_ORE: 80,
            LUMINITE_ORE: 81, CRIMSON_STONE: 82, CORRUPTION_STONE: 83,
            HALLOW_STONE: 84, PEARLSTONE: 85, EBONSTONE: 86,
            JUNGLE_TEMPLE_BRICK: 87, LIHZAHRD_BRICK: 88, DUNGEON_BRICK: 89,
            CLOUD: 90, RAIN_CLOUD: 91, SNOW_CLOUD: 92,
            LIVING_WOOD: 93, LIVING_LEAF: 94, MAHOGANY_LOG: 95, MAHOGANY_LEAVES: 96,
            BOREAL_LOG: 97, SHADEWOOD_LOG: 98, PEARLWOOD_LOG: 99,
            HONEY_BLOCK: 100, HIVE: 101, BEE_NEST: 102,
            SPIDER_NEST: 103, COBALT_BRICK: 104, MYTHRIL_BRICK: 105,
            GOLD_BRICK: 106, SILVER_BRICK: 107, COPPER_BRICK: 108,
            PLATINUM_ORE: 109, TUNGSTEN_ORE: 110, LEAD_ORE: 111, TIN_ORE: 112,
            METEORITE_BRICK: 113, HELLSTONE_BRICK: 114,
            LIFE_CRYSTAL: 115, MANA_CRYSTAL: 116, HEART_CRYSTAL: 117,
            ALTAR: 118, DEMON_ALTAR: 119, CRIMSON_ALTAR: 120,
            SUNPLATE: 121, MOONPLATE: 122, STARFALL: 123,
            ROSE: 124, TULIP: 125, ORCHID: 126, LILY: 127,
            SEAWEED: 128, KELP: 129, SEA_OATS: 130,
            PALM_TREE_TOP: 131, GIANT_TREE_LOG: 132,
            HONEY_DRIP: 133, SLIME_BLOCK: 134, GEL_BLOCK: 135,
            RAINBOW_BRICK: 136, CONFETTI_BLOCK: 137, PARTY_BLOCK: 138,
            PUMPKIN: 139, HAY: 140, SCARECROW: 141,
            GRAVESTONE: 142, CROSS: 143, SKULL_BLOCK: 144,
            ROPE: 145, CHAIN: 146, WEB_ROPE: 147,
            PLATFORMS_WOOD: 148, PLATFORMS_STONE: 149, PLATFORMS_METAL: 150,
            MUSHROOM_GRASS: 151, JUNGLE_SPORE: 152, NATURE_SHRINE: 153,
            FIRE_BLOSSOM: 154, MOONGLOW: 155, DAYBLOOM: 156, WATERLEAF: 157,
            DEATHWEED: 158, BLINKROOT: 159, SHIVERTHORN: 160, FIREBLOSSOM: 161
        });

        const Constants = Object.freeze({ CONFIG, BLOCK });
        window.Constants = Constants;

        const BLOCK_DATA = {
            [BLOCK.AIR]: { name: '空气', solid: false, transparent: true, light: 0, hardness: 0 },
            [BLOCK.DIRT]: { name: '土块', solid: true, transparent: false, light: 0, hardness: 1, color: '#8B6914' },
            [BLOCK.GRASS]: { name: '草地', solid: true, transparent: false, light: 0, hardness: 1, color: '#4CAF50' },
            [BLOCK.STONE]: { name: '石块', solid: true, transparent: false, light: 0, hardness: 3, color: '#78909C' },
            [BLOCK.WOOD]: { name: '木材', solid: true, transparent: false, light: 0, hardness: 2, color: '#A1887F' },
            [BLOCK.LEAVES]: { name: '树叶', solid: false, transparent: true, light: 0, hardness: 0.5, color: '#66BB6A' },
            [BLOCK.SAND]: { name: '沙子', solid: true, transparent: false, light: 0, hardness: 0.8, color: '#FFE082' },
            [BLOCK.SNOW]: { name: '雪块', solid: true, transparent: false, light: 0, hardness: 0.5, color: '#ECEFF1' },
            [BLOCK.ICE]: { name: '冰块', solid: true, transparent: true, light: 0, hardness: 1.5, color: '#81D4FA' },
            [BLOCK.MUD]: { name: '泥巴', solid: true, transparent: false, light: 0, hardness: 0.8, color: '#6D4C41' },
            [BLOCK.CLAY]: { name: '粘土', solid: true, transparent: false, light: 0, hardness: 1.2, color: '#BCAAA4' },
            [BLOCK.LOG]: { name: '原木', solid: true, transparent: false, light: 0, hardness: 2, color: '#5D4037' },
            [BLOCK.COPPER_ORE]: { name: '铜矿', solid: true, transparent: false, light: 0, hardness: 4, color: '#FF7043' },
            [BLOCK.IRON_ORE]: { name: '铁矿', solid: true, transparent: false, light: 0, hardness: 5, color: '#90A4AE' },
            [BLOCK.SILVER_ORE]: { name: '银矿', solid: true, transparent: false, light: 1, hardness: 5.5, color: '#CFD8DC' },
            [BLOCK.GOLD_ORE]: { name: '金矿', solid: true, transparent: false, light: 2, hardness: 6, color: '#FFD54F' },
            [BLOCK.DIAMOND_ORE]: { name: '钻石矿', solid: true, transparent: false, light: 4, hardness: 8, color: '#4DD0E1' },
            [BLOCK.HELLSTONE]: { name: '狱岩', solid: true, transparent: false, light: 6, hardness: 10, color: '#FF5722' },
            [BLOCK.OBSIDIAN]: { name: '黑曜石', solid: true, transparent: false, light: 0, hardness: 15, color: '#37474F' },
            [BLOCK.COBBLESTONE]: { name: '圆石', solid: true, transparent: false, light: 0, hardness: 3, color: '#78909C' },
            [BLOCK.MOSSY_STONE]: { name: '苔石', solid: true, transparent: false, light: 0, hardness: 3, color: '#689F38' },
            [BLOCK.GRANITE]: { name: '花岗岩', solid: true, transparent: false, light: 0, hardness: 4, color: '#A1887F' },
            [BLOCK.MARBLE]: { name: '大理石', solid: true, transparent: false, light: 1, hardness: 4, color: '#FAFAFA' },
            [BLOCK.PLANKS]: { name: '木板', solid: true, transparent: false, light: 0, hardness: 2, color: '#BCAAA4' },
            [BLOCK.BRICK]: { name: '砖块', solid: true, transparent: false, light: 0, hardness: 4, color: '#E57373' },
            [BLOCK.GLASS]: { name: '玻璃', solid: true, transparent: true, light: 0, hardness: 0.3, color: '#E1F5FE' },
            [BLOCK.TORCH]: { name: '火把', solid: false, transparent: true, light: 14, hardness: 0.1, color: '#FFEB3B' },
            [BLOCK.WATER]: { name: '水', solid: false, transparent: true, light: 0, hardness: 0, liquid: true, color: '#42A5F5' },
            [BLOCK.LAVA]: { name: '熔岩', solid: false, transparent: true, light: 15, hardness: 0, liquid: true, color: '#FF6D00' },
            [BLOCK.ASH]: { name: '灰烬', solid: true, transparent: false, light: 0, hardness: 0.8, color: '#455A64' },
            [BLOCK.BEDROCK]: { name: '基岩', solid: true, transparent: false, light: 0, hardness: Infinity, color: '#263238' },
            [BLOCK.MUSHROOM]: { name: '蘑菇', solid: false, transparent: true, light: 2, hardness: 0, color: '#EC407A' },
            [BLOCK.FLOWER_RED]: { name: '红花', solid: false, transparent: true, light: 0, hardness: 0, color: '#EF5350' },
            [BLOCK.FLOWER_YELLOW]: { name: '黄花', solid: false, transparent: true, light: 0, hardness: 0, color: '#FFEE58' },
            [BLOCK.TALL_GRASS]: { name: '高草', solid: false, transparent: true, light: 0, hardness: 0, color: '#9CCC65' },
            [BLOCK.CACTUS]: { name: '仙人掌', solid: true, transparent: false, light: 0, hardness: 1, color: '#7CB342' },
            [BLOCK.SNOW_GRASS]: { name: '雪草', solid: true, transparent: false, light: 0, hardness: 1, color: '#ECEFF1' },
            [BLOCK.JUNGLE_GRASS]: { name: '丛林草', solid: true, transparent: false, light: 0, hardness: 1, color: '#43A047' },
            [BLOCK.CRYSTAL]: { name: '水晶', solid: true, transparent: true, light: 8, hardness: 5, color: '#CE93D8' },
            // 新增方块数据
            [BLOCK.AMETHYST]: { name: '紫水晶', solid: true, transparent: true, light: 6, hardness: 6, color: '#9C27B0' },
            [BLOCK.RUBY_ORE]: { name: '红宝石矿', solid: true, transparent: false, light: 3, hardness: 7, color: '#E91E63' },
            [BLOCK.EMERALD_ORE]: { name: '祖母绿矿', solid: true, transparent: false, light: 3, hardness: 7, color: '#4CAF50' },
            [BLOCK.SAPPHIRE_ORE]: { name: '蓝宝石矿', solid: true, transparent: false, light: 3, hardness: 7, color: '#2196F3' },
            [BLOCK.GLOWSTONE]: { name: '萤石', solid: true, transparent: true, light: 12, hardness: 2, color: '#FFC107' },
            [BLOCK.MUSHROOM_GIANT]: { name: '巨型蘑菇', solid: true, transparent: false, light: 3, hardness: 1, color: '#8E24AA' },
            [BLOCK.VINE]: { name: '藤蔓', solid: false, transparent: true, light: 0, hardness: 0.1, color: '#2E7D32' },
            [BLOCK.CORAL]: { name: '珊瑚', solid: true, transparent: false, light: 2, hardness: 1, color: '#FF7043' },
            [BLOCK.SANDSTONE]: { name: '砂岩', solid: true, transparent: false, light: 0, hardness: 2.5, color: '#D4A574' },
            [BLOCK.RED_SAND]: { name: '红沙', solid: true, transparent: false, light: 0, hardness: 0.8, color: '#C75B39' },
            [BLOCK.GRAVEL]: { name: '砾石', solid: true, transparent: false, light: 0, hardness: 1, color: '#757575' },
            [BLOCK.LIMESTONE]: { name: '石灰 ite', solid: true, transparent: false, light: 0, hardness: 2, color: '#E8DCC4' },
            [BLOCK.SLATE]: { name: '板岩', solid: true, transparent: false, light: 0, hardness: 3, color: '#546E7A' },
            [BLOCK.BASALT]: { name: '玄武岩', solid: true, transparent: false, light: 0, hardness: 4, color: '#37474F' },
            [BLOCK.FROZEN_STONE]: { name: '冻石', solid: true, transparent: true, light: 1, hardness: 3, color: '#B3E5FC' },
            [BLOCK.MOSS]: { name: '苔藓', solid: false, transparent: true, light: 0, hardness: 0.1, color: '#558B2F' },
            [BLOCK.SPIDER_WEB]: { name: '蜘蛛网', solid: false, transparent: true, light: 0, hardness: 0.1, color: '#EEEEEE' },
            [BLOCK.BONE]: { name: '骨头', solid: true, transparent: false, light: 0, hardness: 2, color: '#EFEBE9' },
            [BLOCK.TREASURE_CHEST]: { name: '宝箱', solid: true, transparent: false, light: 4, hardness: 3, color: '#8D6E63' },
            [BLOCK.LANTERN]: { name: '灯笼', solid: false, transparent: true, light: 14, hardness: 0.5, color: '#FF9800' },
            [BLOCK.PINK_FLOWER]: { name: '粉花', solid: false, transparent: true, light: 0, hardness: 0, color: '#F48FB1' },
            [BLOCK.BLUE_FLOWER]: { name: '蓝花', solid: false, transparent: true, light: 0, hardness: 0, color: '#64B5F6' },
            [BLOCK.SUNFLOWER]: { name: '向日葵', solid: false, transparent: true, light: 1, hardness: 0, color: '#FFEB3B' },
            [BLOCK.FERN]: { name: '蕨类', solid: false, transparent: true, light: 0, hardness: 0, color: '#66BB6A' },
            [BLOCK.BAMBOO]: { name: '竹子', solid: true, transparent: false, light: 0, hardness: 1, color: '#7CB342' },
            [BLOCK.PALM_LOG]: { name: '棕榈木', solid: true, transparent: false, light: 0, hardness: 2, color: '#A1887F' },
            [BLOCK.PALM_LEAVES]: { name: '棕榈叶', solid: false, transparent: true, light: 0, hardness: 0.3, color: '#8BC34A' },
            [BLOCK.CHERRY_LOG]: { name: '樱花木', solid: true, transparent: false, light: 0, hardness: 2, color: '#795548' },
            [BLOCK.CHERRY_LEAVES]: { name: '樱花叶', solid: false, transparent: true, light: 1, hardness: 0.3, color: '#F8BBD9' },
            [BLOCK.PINE_LOG]: { name: '松木', solid: true, transparent: false, light: 0, hardness: 2, color: '#4E342E' },
            [BLOCK.PINE_LEAVES]: { name: '松针', solid: false, transparent: true, light: 0, hardness: 0.3, color: '#1B5E20' },
            [BLOCK.STALAGMITE]: { name: '石笋', solid: true, transparent: false, light: 0, hardness: 2, color: '#8D6E63' },
            [BLOCK.STALACTITE]: { name: '钟乳石', solid: true, transparent: false, light: 0, hardness: 2, color: '#A1887F' },
            [BLOCK.UNDERGROUND_MUSHROOM]: { name: '地下蘑菇', solid: false, transparent: true, light: 5, hardness: 0, color: '#7E57C2' },
            [BLOCK.GLOWING_MOSS]: { name: '发光苔藓', solid: false, transparent: true, light: 8, hardness: 0.1, color: '#00E676' },
            // 超级丰富版新增方块数据
            [BLOCK.METEORITE]: { name: '陨石', solid: true, transparent: false, light: 4, hardness: 12, color: '#8B4513' },
            [BLOCK.TITANIUM_ORE]: { name: '钛矿', solid: true, transparent: false, light: 2, hardness: 9, color: '#4A6670' },
            [BLOCK.COBALT_ORE]: { name: '钴矿', solid: true, transparent: false, light: 2, hardness: 8, color: '#2E86AB' },
            [BLOCK.MYTHRIL_ORE]: { name: '秘银矿', solid: true, transparent: false, light: 3, hardness: 9, color: '#66BB6A' },
            [BLOCK.ORICHALCUM_ORE]: { name: '山铜矿', solid: true, transparent: false, light: 3, hardness: 9, color: '#FF69B4' },
            [BLOCK.ADAMANTITE_ORE]: { name: '精金矿', solid: true, transparent: false, light: 4, hardness: 10, color: '#DC143C' },
            [BLOCK.CHLOROPHYTE_ORE]: { name: '叶绿矿', solid: true, transparent: false, light: 5, hardness: 11, color: '#32CD32' },
            [BLOCK.LUMINITE_ORE]: { name: '夜明矿', solid: true, transparent: false, light: 10, hardness: 15, color: '#00FFFF' },
            [BLOCK.CRIMSON_STONE]: { name: '猩红石', solid: true, transparent: false, light: 1, hardness: 4, color: '#8B0000' },
            [BLOCK.CORRUPTION_STONE]: { name: '腐化石', solid: true, transparent: false, light: 1, hardness: 4, color: '#4B0082' },
            [BLOCK.HALLOW_STONE]: { name: '神圣石', solid: true, transparent: false, light: 3, hardness: 4, color: '#FFD700' },
            [BLOCK.PEARLSTONE]: { name: '珍珠石', solid: true, transparent: false, light: 2, hardness: 4, color: '#FFF0F5' },
            [BLOCK.EBONSTONE]: { name: '黑檀石', solid: true, transparent: false, light: 0, hardness: 5, color: '#2F1B41' },
            [BLOCK.JUNGLE_TEMPLE_BRICK]: { name: '丛林神庙砖', solid: true, transparent: false, light: 0, hardness: 8, color: '#4A7023' },
            [BLOCK.LIHZAHRD_BRICK]: { name: '丛林蜥蜴砖', solid: true, transparent: false, light: 1, hardness: 10, color: '#8B7355' },
            [BLOCK.DUNGEON_BRICK]: { name: '地牢砖', solid: true, transparent: false, light: 0, hardness: 6, color: '#4169E1' },
            [BLOCK.CLOUD]: { name: '云', solid: true, transparent: true, light: 0, hardness: 0.2, color: '#F5F5F5' },
            [BLOCK.RAIN_CLOUD]: { name: '雨云', solid: true, transparent: true, light: 0, hardness: 0.2, color: '#708090' },
            [BLOCK.SNOW_CLOUD]: { name: '雪云', solid: true, transparent: true, light: 0, hardness: 0.2, color: '#E0FFFF' },
            [BLOCK.LIVING_WOOD]: { name: '生命木', solid: true, transparent: false, light: 1, hardness: 3, color: '#8B4513' },
            [BLOCK.LIVING_LEAF]: { name: '生命叶', solid: false, transparent: true, light: 2, hardness: 0.3, color: '#228B22' },
            [BLOCK.MAHOGANY_LOG]: { name: '红木', solid: true, transparent: false, light: 0, hardness: 2.5, color: '#C04000' },
            [BLOCK.MAHOGANY_LEAVES]: { name: '红木叶', solid: false, transparent: true, light: 0, hardness: 0.3, color: '#006400' },
            [BLOCK.BOREAL_LOG]: { name: '北方木', solid: true, transparent: false, light: 0, hardness: 2, color: '#D2B48C' },
            [BLOCK.SHADEWOOD_LOG]: { name: '暗影木', solid: true, transparent: false, light: 0, hardness: 2, color: '#4A3B5C' },
            [BLOCK.PEARLWOOD_LOG]: { name: '珍珠木', solid: true, transparent: false, light: 1, hardness: 2, color: '#FFDEAD' },
            [BLOCK.HONEY_BLOCK]: { name: '蜂蜜块', solid: true, transparent: true, light: 2, hardness: 0.5, color: '#FFB347' },
            [BLOCK.HIVE]: { name: '蜂巢', solid: true, transparent: false, light: 1, hardness: 2, color: '#DAA520' },
            [BLOCK.BEE_NEST]: { name: '蜂窝', solid: true, transparent: false, light: 2, hardness: 1.5, color: '#F0E68C' },
            [BLOCK.SPIDER_NEST]: { name: '蜘蛛巢', solid: true, transparent: false, light: 0, hardness: 2, color: '#2F2F2F' },
            [BLOCK.COBALT_BRICK]: { name: '钴砖', solid: true, transparent: false, light: 1, hardness: 5, color: '#1E90FF' },
            [BLOCK.MYTHRIL_BRICK]: { name: '秘银砖', solid: true, transparent: false, light: 1, hardness: 5, color: '#3CB371' },
            [BLOCK.GOLD_BRICK]: { name: '金砖', solid: true, transparent: false, light: 2, hardness: 5, color: '#FFD700' },
            [BLOCK.SILVER_BRICK]: { name: '银砖', solid: true, transparent: false, light: 1, hardness: 5, color: '#C0C0C0' },
            [BLOCK.COPPER_BRICK]: { name: '铜砖', solid: true, transparent: false, light: 0, hardness: 4, color: '#B87333' },
            [BLOCK.PLATINUM_ORE]: { name: '铂金矿', solid: true, transparent: false, light: 2, hardness: 7, color: '#E5E4E2' },
            [BLOCK.TUNGSTEN_ORE]: { name: '钨矿', solid: true, transparent: false, light: 1, hardness: 6, color: '#5C5C5C' },
            [BLOCK.LEAD_ORE]: { name: '铅矿', solid: true, transparent: false, light: 0, hardness: 5, color: '#3D3D3D' },
            [BLOCK.TIN_ORE]: { name: '锡矿', solid: true, transparent: false, light: 0, hardness: 4, color: '#D3D3D3' },
            [BLOCK.METEORITE_BRICK]: { name: '陨石砖', solid: true, transparent: false, light: 3, hardness: 6, color: '#CD5C5C' },
            [BLOCK.HELLSTONE_BRICK]: { name: '狱岩砖', solid: true, transparent: false, light: 5, hardness: 7, color: '#FF4500' },
            [BLOCK.LIFE_CRYSTAL]: { name: '生命水晶', solid: true, transparent: true, light: 10, hardness: 3, color: '#FF1493' },
            [BLOCK.MANA_CRYSTAL]: { name: '魔力水晶', solid: true, transparent: true, light: 10, hardness: 3, color: '#00BFFF' },
            [BLOCK.HEART_CRYSTAL]: { name: '心之水晶', solid: true, transparent: true, light: 12, hardness: 4, color: '#FF69B4' },
            [BLOCK.ALTAR]: { name: '祭坛', solid: true, transparent: false, light: 5, hardness: 8, color: '#4B0082' },
            [BLOCK.DEMON_ALTAR]: { name: '恶魔祭坛', solid: true, transparent: false, light: 6, hardness: 10, color: '#8B008B' },
            [BLOCK.CRIMSON_ALTAR]: { name: '猩红祭坛', solid: true, transparent: false, light: 6, hardness: 10, color: '#DC143C' },
            [BLOCK.SUNPLATE]: { name: '日盘', solid: true, transparent: false, light: 8, hardness: 4, color: '#FFD700' },
            [BLOCK.MOONPLATE]: { name: '月盘', solid: true, transparent: false, light: 6, hardness: 4, color: '#C0C0C0' },
            [BLOCK.STARFALL]: { name: '星落', solid: false, transparent: true, light: 10, hardness: 0, color: '#FFFF00' },
            [BLOCK.ROSE]: { name: '玫瑰', solid: false, transparent: true, light: 0, hardness: 0, color: '#FF007F' },
            [BLOCK.TULIP]: { name: '郁金香', solid: false, transparent: true, light: 0, hardness: 0, color: '#FF6347' },
            [BLOCK.ORCHID]: { name: '兰花', solid: false, transparent: true, light: 1, hardness: 0, color: '#DA70D6' },
            [BLOCK.LILY]: { name: '百合', solid: false, transparent: true, light: 0, hardness: 0, color: '#FFFAF0' },
            [BLOCK.SEAWEED]: { name: '海草', solid: false, transparent: true, light: 0, hardness: 0, color: '#2E8B57' },
            [BLOCK.KELP]: { name: '海带', solid: false, transparent: true, light: 0, hardness: 0, color: '#556B2F' },
            [BLOCK.SEA_OATS]: { name: '海燕麦', solid: false, transparent: true, light: 0, hardness: 0, color: '#F4A460' },
            [BLOCK.PALM_TREE_TOP]: { name: '棕榈树顶', solid: false, transparent: true, light: 0, hardness: 0.3, color: '#32CD32' },
            [BLOCK.GIANT_TREE_LOG]: { name: '巨树原木', solid: true, transparent: false, light: 0, hardness: 4, color: '#5D4037' },
            [BLOCK.HONEY_DRIP]: { name: '蜂蜜滴', solid: false, transparent: true, light: 2, hardness: 0, color: '#FFB90F' },
            [BLOCK.SLIME_BLOCK]: { name: '史莱姆块', solid: true, transparent: true, light: 2, hardness: 1, color: '#00FF7F' },
            [BLOCK.GEL_BLOCK]: { name: '凝胶块', solid: true, transparent: true, light: 1, hardness: 0.5, color: '#7FFFD4' },
            [BLOCK.RAINBOW_BRICK]: { name: '彩虹砖', solid: true, transparent: false, light: 6, hardness: 4, color: '#FF69B4' },
            [BLOCK.CONFETTI_BLOCK]: { name: '五彩纸屑', solid: false, transparent: true, light: 0, hardness: 0, color: '#FFD700' },
            [BLOCK.PARTY_BLOCK]: { name: '派对块', solid: true, transparent: false, light: 4, hardness: 2, color: '#FF1493' },
            [BLOCK.PUMPKIN]: { name: '南瓜', solid: true, transparent: false, light: 2, hardness: 1, color: '#FF7F00' },
            [BLOCK.HAY]: { name: '干草', solid: true, transparent: false, light: 0, hardness: 0.5, color: '#DAA520' },
            [BLOCK.SCARECROW]: { name: '稻草人', solid: true, transparent: false, light: 0, hardness: 1, color: '#8B4513' },
            [BLOCK.GRAVESTONE]: { name: '墓碑', solid: true, transparent: false, light: 0, hardness: 3, color: '#696969' },
            [BLOCK.CROSS]: { name: '十字架', solid: true, transparent: false, light: 0, hardness: 2, color: '#808080' },
            [BLOCK.SKULL_BLOCK]: { name: '头骨块', solid: true, transparent: false, light: 0, hardness: 2, color: '#FFFAF0' },
            [BLOCK.ROPE]: { name: '绳索', solid: false, transparent: true, light: 0, hardness: 0.1, color: '#DEB887' },
            [BLOCK.CHAIN]: { name: '锁链', solid: false, transparent: true, light: 0, hardness: 1, color: '#A9A9A9' },
            [BLOCK.WEB_ROPE]: { name: '蛛丝绳', solid: false, transparent: true, light: 0, hardness: 0.1, color: '#F5F5F5' },
            [BLOCK.PLATFORMS_WOOD]: { name: '木平台', solid: false, transparent: true, light: 0, hardness: 0.5, color: '#DEB887' },
            [BLOCK.PLATFORMS_STONE]: { name: '石平台', solid: false, transparent: true, light: 0, hardness: 1, color: '#808080' },
            [BLOCK.PLATFORMS_METAL]: { name: '金属平台', solid: false, transparent: true, light: 0, hardness: 1.5, color: '#C0C0C0' },
            [BLOCK.MUSHROOM_GRASS]: { name: '蘑菇草', solid: true, transparent: false, light: 3, hardness: 1, color: '#4169E1' },
            [BLOCK.JUNGLE_SPORE]: { name: '丛林孢子', solid: false, transparent: true, light: 4, hardness: 0, color: '#00FF00' },
            [BLOCK.NATURE_SHRINE]: { name: '自然神龛', solid: true, transparent: false, light: 8, hardness: 5, color: '#228B22' },
            [BLOCK.FIRE_BLOSSOM]: { name: '火焰花', solid: false, transparent: true, light: 6, hardness: 0, color: '#FF4500' },
            [BLOCK.MOONGLOW]: { name: '月光草', solid: false, transparent: true, light: 5, hardness: 0, color: '#87CEEB' },
            [BLOCK.DAYBLOOM]: { name: '太阳花', solid: false, transparent: true, light: 3, hardness: 0, color: '#FFFF00' },
            [BLOCK.WATERLEAF]: { name: '水叶草', solid: false, transparent: true, light: 2, hardness: 0, color: '#00CED1' },
            [BLOCK.DEATHWEED]: { name: '死亡草', solid: false, transparent: true, light: 1, hardness: 0, color: '#2F4F4F' },
            [BLOCK.BLINKROOT]: { name: '闪烁根', solid: false, transparent: true, light: 4, hardness: 0, color: '#ADFF2F' },
            [BLOCK.SHIVERTHORN]: { name: '寒颤荆棘', solid: false, transparent: true, light: 2, hardness: 0, color: '#E0FFFF' },
            [BLOCK.FIREBLOSSOM]: { name: '烈焰花', solid: false, transparent: true, light: 8, hardness: 0, color: '#FF6347' }
        };

        // ═══════════════════════════════════════════════════════════════════════
        //                       Block lookup tables (性能优化)
        // ═══════════════════════════════════════════════════════════════════════
        // 说明：把 BLOCK_DATA 中高频访问的属性映射到定长数组，减少对象查找/可选链开销。
        // 不改变任何数值与画面逻辑，只是把读取路径变快。

        const BLOCK_MAX_ID = 256; // tiles/light 使用 Uint8Array，ID 范围天然在 0~255
        const BLOCK_SOLID = new Uint8Array(BLOCK_MAX_ID);
        const BLOCK_TRANSPARENT = new Uint8Array(BLOCK_MAX_ID);
        const BLOCK_LIQUID = new Uint8Array(BLOCK_MAX_ID);
        const BLOCK_LIGHT = new Uint8Array(BLOCK_MAX_ID);
        const BLOCK_HARDNESS = new Float32Array(BLOCK_MAX_ID);
        const BLOCK_COLOR = new Array(BLOCK_MAX_ID);

        // 太阳光柱向下衰减（与原 Game._updateLight 规则保持一致）：0 / 1 / 3
        const SUN_DECAY = new Uint8Array(BLOCK_MAX_ID);

        // 迷你地图用：把颜色预先打包成 0xRRGGBB，避免每像素 hexToRgb + 对象分配
        const BLOCK_COLOR_PACKED = new Uint32Array(BLOCK_MAX_ID);
        const BLOCK_WALKABLE = new Uint8Array(BLOCK_MAX_ID);

        (function buildBlockTables() {
            // fallback 与原 Minimap 里 '#F0F' + hexToRgb 的“实际结果”一致：
            // r = parseInt('F0',16)=240, g=parseInt('F',16)=15, b=parseInt('',16)=NaN -> 写入 Uint8ClampedArray 时会变 0
            const FALLBACK_PACKED = (240 << 16) | (15 << 8) | 0;

            for (const k in BLOCK_DATA) {
                const id = Number(k);
                if (!Number.isFinite(id) || id < 0 || id >= BLOCK_MAX_ID) continue;

                const d = BLOCK_DATA[id];
                if (!d) continue;

                BLOCK_SOLID[id] = d.solid ? 1 : 0;
                BLOCK_TRANSPARENT[id] = d.transparent ? 1 : 0;
                BLOCK_LIQUID[id] = d.liquid ? 1 : 0;
                BLOCK_LIGHT[id] = d.light ? d.light : 0;
                BLOCK_HARDNESS[id] = d.hardness ? d.hardness : 0;
                BLOCK_COLOR[id] = d.color;

                if (d.solid && !d.transparent) SUN_DECAY[id] = 3;
                else if (d.transparent && id !== BLOCK.AIR) SUN_DECAY[id] = 1;
                else SUN_DECAY[id] = 0;

                if (typeof d.color === 'string' && d.color.length === 7) {
                    const r = parseInt(d.color.slice(1, 3), 16);
                    const g = parseInt(d.color.slice(3, 5), 16);
                    const b = parseInt(d.color.slice(5, 7), 16);
                    BLOCK_COLOR_PACKED[id] = (r << 16) | (g << 8) | b;
                } else {
                    BLOCK_COLOR_PACKED[id] = FALLBACK_PACKED;
                }
            }
        })();

        (function buildWalkableTable() {
            for (let i = 0; i < BLOCK_MAX_ID; i++) {
                BLOCK_WALKABLE[i] = BLOCK_SOLID[i] ? 0 : 1;
            }
        })();

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { CONFIG, BLOCK, BLOCK_DATA, BLOCK_SOLID, BLOCK_LIQUID, BLOCK_TRANSPARENT, BLOCK_WALKABLE, BLOCK_MAX_ID, BLOCK_COLOR_PACKED, SUN_DECAY });


// ───────────────────────── Module Exports ─────────────────────────
window.TU = window.TU || {};
Object.assign(window.TU, {
  CONFIG, CFG, BLOCK, BLOCK_DATA, BLOCK_SOLID, BLOCK_LIQUID, BLOCK_TRANSPARENT,
  BLOCK_WALKABLE, BLOCK_MAX_ID, BLOCK_COLOR_PACKED, BLOCK_LIGHT, BLOCK_HARDNESS,
  BLOCK_COLOR, SUN_DECAY, Constants
});
