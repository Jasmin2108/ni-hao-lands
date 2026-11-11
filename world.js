// Ni Hao Lands — shared world data, map generator, pathfinding, items, skills.
// Unofficial fan project. Not financial advice.

const W = 128;
const H = 96;

const AVATARS = [
  { id: "classic-paw", file: "classic-paw.jpg", name: "Paw Wave" },
  { id: "classic-shocked", file: "classic-shocked.jpg", name: "Shocked" },
  { id: "classic-grumpy", file: "classic-grumpy.jpg", name: "Grumpy" },
  { id: "coat", file: "coat.jpg", name: "Winter Coat" },
  { id: "suit", file: "suit.jpg", name: "Business Suit" },
  { id: "astronaut", file: "astronaut.jpg", name: "Astronaut" },
  { id: "cape", file: "cape.jpg", name: "Cape" },
  { id: "knight", file: "knight.jpg", name: "Knight" },
  { id: "bonnet", file: "bonnet.jpg", name: "Bonnet" },
  { id: "laser-eyes", file: "laser-eyes.jpg", name: "Laser Eyes" },
];

const SKILLS = [
  { id: "fishing", name: "Fishing", verb: "fishing", icon: "🎣" },
  { id: "yarn", name: "Yarn-gathering", verb: "gathering yarn", icon: "🧶" },
  { id: "woodcutting", name: "Woodcutting", verb: "chopping", icon: "🪓" },
  { id: "mining", name: "Mining", verb: "mining", icon: "⛏" },
  { id: "smithing", name: "Smithing", verb: "smithing", icon: "🔨" },
  { id: "cooking", name: "Cooking", verb: "cooking", icon: "🍳" },
  { id: "combat", name: "Combat", verb: "fighting", icon: "⚔" },
];

const ITEMS = {
  // Fish — raw_fish / cooked_fish keep their old ids so existing inventories still work.
  raw_minnow: { id: "raw_minnow", name: "Raw Minnow", stack: true, desc: "A tiny harbor fry. Cook it.", sell: 2, cook: "cooked_minnow", cookLevel: 1, cookXp: 14, cookTime: 1400 },
  cooked_minnow: { id: "cooked_minnow", name: "Cooked Minnow", stack: true, desc: "A light snack. Eat to heal 4 HP.", sell: 4, heal: 4 },
  raw_fish: { id: "raw_fish", name: "Raw Carp", stack: true, desc: "A wriggling pond carp. Cook it in the village.", sell: 3, cook: "cooked_fish", cookLevel: 1, cookXp: 24, cookTime: 1800 },
  cooked_fish: { id: "cooked_fish", name: "Cooked Carp", stack: true, desc: "Smells like 好运. Eat to heal 8 HP.", sell: 8, heal: 8 },
  raw_koi: { id: "raw_koi", name: "Raw Koi", stack: true, desc: "A handsome harbor koi. Cook it.", sell: 8, cook: "cooked_koi", cookLevel: 20, cookXp: 50, cookTime: 2400 },
  cooked_koi: { id: "cooked_koi", name: "Cooked Koi", stack: true, desc: "A rich meal. Eat to heal 14 HP.", sell: 16, heal: 14 },
  raw_golden_koi: { id: "raw_golden_koi", name: "Raw Golden Koi", stack: true, desc: "A rare golden catch. Cook it carefully.", sell: 16, cook: "cooked_golden_koi", cookLevel: 40, cookXp: 80, cookTime: 3000 },
  cooked_golden_koi: { id: "cooked_golden_koi", name: "Cooked Golden Koi", stack: true, desc: "A feast. Eat to heal 22 HP.", sell: 28, heal: 22 },

  yarn: { id: "yarn", name: "Yarn", stack: true, desc: "Soft yarn pulled from a forest bush.", sell: 4 },
  bamboo: { id: "bamboo", name: "Bamboo", stack: true, desc: "A light, springy cane.", sell: 3 },
  pine_logs: { id: "pine_logs", name: "Pine Logs", stack: true, desc: "Fragrant pine logs.", sell: 6 },
  cherry_logs: { id: "cherry_logs", name: "Cherry Logs", stack: true, desc: "Pink-grained cherry wood.", sell: 10 },

  // ore keeps its old id as copper ore.
  ore: { id: "ore", name: "Copper Ore", stack: true, desc: "A lump of copper ore from the mine.", sell: 5 },
  tin_ore: { id: "tin_ore", name: "Tin Ore", stack: true, desc: "A lump of tin ore.", sell: 5 },
  iron_ore: { id: "iron_ore", name: "Iron Ore", stack: true, desc: "A heavy lump of iron ore.", sell: 8 },
  jade_ore: { id: "jade_ore", name: "Jade Ore", stack: true, desc: "A rare green stone from the quarry.", sell: 14 },

  copper_bar: { id: "copper_bar", name: "Copper Bar", stack: true, desc: "A smelted copper bar.", sell: 8 },
  bronze_bar: { id: "bronze_bar", name: "Bronze Bar", stack: true, desc: "Copper and tin, smelted together.", sell: 12 },
  iron_bar: { id: "iron_bar", name: "Iron Bar", stack: true, desc: "A sturdy iron bar.", sell: 18 },
  jade_bar: { id: "jade_bar", name: "Jade Bar", stack: true, desc: "A shimmering jade bar.", sell: 28 },

  bones: { id: "bones", name: "Dog Bones", stack: true, desc: "Dropped by rival dogs. The shop buys them.", sell: 6 },
  rat_tail: { id: "rat_tail", name: "Rat Tail", stack: true, desc: "A twitchy souvenir. The shop buys them.", sell: 3 },
  shrine_token: { id: "shrine_token", name: "Shrine Token", stack: true, desc: "A worn charm from the plains.", sell: 12 },

  lucky_bell: { id: "lucky_bell", name: "Lucky Bell", stack: false, cosmetic: true, slot: "neck", desc: "A tiny gold bell. Cosmetic.", sell: 20 },
  red_scarf: { id: "red_scarf", name: "Red Scarf", stack: false, cosmetic: true, slot: "body", desc: "A bright red scarf. Cosmetic.", sell: 25 },
  gold_collar: { id: "gold_collar", name: "Gold Collar", stack: false, cosmetic: true, slot: "neck", desc: "Shiny collar. Cosmetic.", sell: 40 },
  lantern_hat: { id: "lantern_hat", name: "Lantern Hat", stack: false, cosmetic: true, slot: "head", desc: "A paper-lantern hat. Cosmetic.", sell: 50 },
  maneki_ribbon: { id: "maneki_ribbon", name: "Maneki Ribbon", stack: false, cosmetic: true, slot: "neck", desc: "A red ribbon from Old Maneki. Cosmetic.", sell: 0 },

  bronze_pickaxe: { id: "bronze_pickaxe", name: "Bronze Pickaxe", stack: false, tool: "pickaxe", toolTier: 1, toolLevel: 1, toolSpeed: 1, slot: "pickaxe", desc: "A basic pickaxe. Mines copper and tin.", sell: 15 },
  iron_pickaxe: { id: "iron_pickaxe", name: "Iron Pickaxe", stack: false, tool: "pickaxe", toolTier: 2, toolLevel: 15, toolSpeed: 0.82, slot: "pickaxe", desc: "Mines copper, tin and iron faster.", sell: 40 },
  jade_pickaxe: { id: "jade_pickaxe", name: "Jade Pickaxe", stack: false, tool: "pickaxe", toolTier: 3, toolLevel: 30, toolSpeed: 0.68, slot: "pickaxe", desc: "Mines every ore, including jade.", sell: 90 },

  bronze_axe: { id: "bronze_axe", name: "Bronze Axe", stack: false, tool: "axe", toolTier: 1, toolLevel: 1, toolSpeed: 1, slot: "axe", desc: "A basic axe. Chops bamboo.", sell: 15 },
  iron_axe: { id: "iron_axe", name: "Iron Axe", stack: false, tool: "axe", toolTier: 2, toolLevel: 15, toolSpeed: 0.82, slot: "axe", desc: "Chops bamboo and pine faster.", sell: 40 },
  jade_axe: { id: "jade_axe", name: "Jade Axe", stack: false, tool: "axe", toolTier: 3, toolLevel: 30, toolSpeed: 0.68, slot: "axe", desc: "Chops every tree, including cherry.", sell: 90 },

  bronze_rod: { id: "bronze_rod", name: "Bronze Rod", stack: false, tool: "rod", toolTier: 1, toolLevel: 1, toolSpeed: 1, slot: "rod", desc: "A basic rod. Catches minnow and carp.", sell: 15 },
  iron_rod: { id: "iron_rod", name: "Iron Rod", stack: false, tool: "rod", toolTier: 2, toolLevel: 15, toolSpeed: 0.82, slot: "rod", desc: "Catches up to koi, a bit faster.", sell: 40 },
  jade_rod: { id: "jade_rod", name: "Jade Rod", stack: false, tool: "rod", toolTier: 3, toolLevel: 30, toolSpeed: 0.68, slot: "rod", desc: "Catches every fish, including golden koi.", sell: 90 },

  // $nihala holder perks (in-game only). Free to claim for wallet-verified holders; pause when the balance is 0.
  golden_cat_rod: { id: "golden_cat_rod", name: "Golden Cat Rod", stack: false, tool: "rod", toolTier: 2, toolLevel: 1, toolSpeed: 0.78, slot: "rod", holderOnly: true, desc: "A gold maneki rod for $nihala holders. Iron-tier catches, a little quicker. Works only while you hold $nihala.", sell: 0 },
  lucky_jade_axe: { id: "lucky_jade_axe", name: "Lucky Jade Axe", stack: false, tool: "axe", toolTier: 2, toolLevel: 1, toolSpeed: 0.78, slot: "axe", holderOnly: true, desc: "A jade-trimmed axe for $nihala holders. Iron-tier chopping, a little quicker. Works only while you hold $nihala.", sell: 0 },
  lucky_pickaxe: { id: "lucky_pickaxe", name: "Lucky Pickaxe", stack: false, tool: "pickaxe", toolTier: 2, toolLevel: 1, toolSpeed: 0.78, slot: "pickaxe", holderOnly: true, desc: "A lucky-cat pickaxe for $nihala holders. Iron-tier mining, a little quicker. Works only while you hold $nihala.", sell: 0 },
  raw_lucky_koi: { id: "raw_lucky_koi", name: "Raw Lucky Golden Koi", stack: true, holderDrop: true, desc: "An extra-large golden koi. A rare $nihala holder catch.", sell: 18, cook: "cooked_golden_koi", cookLevel: 1, cookXp: 60, cookTime: 3000 },
  lucky_cat_gem: { id: "lucky_cat_gem", name: "Lucky Cat Gem", stack: true, holderDrop: true, desc: "A little cat-shaped gem. A rare $nihala holder find.", sell: 15 },
  golden_bamboo: { id: "golden_bamboo", name: "Golden Bamboo", stack: true, holderDrop: true, desc: "A cane that shines like gold. A rare $nihala holder find.", sell: 8 },
  golden_yarn: { id: "golden_yarn", name: "Golden Yarn", stack: true, holderDrop: true, desc: "Glittering yarn. A rare $nihala holder find.", sell: 8 },

  bronze_sword: { id: "bronze_sword", name: "Bronze Sword", stack: false, slot: "weapon", atk: 3, desc: "A short bronze blade.", sell: 18 },
  iron_sword: { id: "iron_sword", name: "Iron Sword", stack: false, slot: "weapon", atk: 6, desc: "A sturdy iron blade.", sell: 45 },
  jade_sword: { id: "jade_sword", name: "Jade Sword", stack: false, slot: "weapon", atk: 10, desc: "A gleaming jade blade.", sell: 95 },

  bronze_helm: { id: "bronze_helm", name: "Bronze Helm", stack: false, slot: "head", def: 2, desc: "A simple bronze helm.", sell: 16 },
  iron_helm: { id: "iron_helm", name: "Iron Helm", stack: false, slot: "head", def: 4, desc: "A solid iron helm.", sell: 42 },
  jade_helm: { id: "jade_helm", name: "Jade Helm", stack: false, slot: "head", def: 7, desc: "A polished jade helm.", sell: 88 },

  bronze_mail: { id: "bronze_mail", name: "Bronze Mail", stack: false, slot: "body", def: 3, desc: "Bronze body armor.", sell: 20 },
  iron_mail: { id: "iron_mail", name: "Iron Mail", stack: false, slot: "body", def: 6, desc: "Iron body armor.", sell: 50 },
  jade_mail: { id: "jade_mail", name: "Jade Mail", stack: false, slot: "body", def: 10, desc: "Jade body armor.", sell: 100 },

  // Gathering finds (mini-game extras)
  raw_moon_koi: { id: "raw_moon_koi", name: "Raw Moon Koi", stack: true, rare: true, desc: "A pale, glowing koi. A rare catch from a perfect bite.", sell: 30, cook: "cooked_golden_koi", cookLevel: 1, cookXp: 70, cookTime: 2600 },
  old_boot: { id: "old_boot", name: "Old Boot", stack: true, junk: true, desc: "Someone's left boot. Still squelches. The shop takes it, barely.", sell: 1 },
  message_bottle: { id: "message_bottle", name: "Message in a Bottle", stack: true, treasure: true, desc: "The note inside says: \"meow meow, send snacks\". Worth a few coins.", sell: 25 },
  pearl: { id: "pearl", name: "River Pearl", stack: true, treasure: true, desc: "A smooth little pearl from the deep.", sell: 45 },
  sapphire: { id: "sapphire", name: "Sapphire", stack: true, gem: true, desc: "A deep blue gem from a lucky swing.", sell: 30 },
  ruby: { id: "ruby", name: "Ruby", stack: true, gem: true, desc: "A fiery red gem from a lucky swing.", sell: 40 },
  emerald: { id: "emerald", name: "Emerald", stack: true, gem: true, desc: "A green gem from a lucky swing.", sell: 35 },
  bird_nest: { id: "bird_nest", name: "Bird Nest", stack: true, desc: "Fell out of a tree. Empty, but cosy.", sell: 18 },
  tree_seed: { id: "tree_seed", name: "Tree Seed", stack: true, desc: "A seed that dropped while chopping. Someday a tree.", sell: 6 },
  rose_yarn: { id: "rose_yarn", name: "Rose Yarn", stack: true, rare: true, desc: "Rare pink yarn from a lucky bush.", sell: 16 },
  sky_yarn: { id: "sky_yarn", name: "Sky Yarn", stack: true, rare: true, desc: "Rare blue yarn from a lucky bush.", sell: 16 },
  rainbow_yarn: { id: "rainbow_yarn", name: "Rainbow Yarn", stack: true, rare: true, desc: "Very rare rainbow yarn. Old Maneki would love it.", sell: 40 },
  burnt_fish: { id: "burnt_fish", name: "Burnt Fish", stack: true, desc: "Oops. Charcoal with fins.", sell: 0 },
};

// Quality variants: fine / perfect results from the heat bar at the range or anvil.
const QUALITY = { fine: { label: "Fine", mult: 1.3 }, perfect: { label: "Perfect", mult: 1.6 } };

// Backward-compatible alias: old "hat" cosmetics count as head.
if (ITEMS.lantern_hat) ITEMS.lantern_hat.slot = "head";

const SHOP = [
  { itemId: "lucky_bell", price: 50 },
  { itemId: "red_scarf", price: 120 },
  { itemId: "gold_collar", price: 250 },
  { itemId: "lantern_hat", price: 400 },
  { itemId: "cooked_fish", price: 12 },
  { itemId: "bronze_pickaxe", price: 25 },
  { itemId: "bronze_axe", price: 25 },
  { itemId: "bronze_rod", price: 25 },
  { itemId: "bronze_sword", price: 30 },
];

const PREMIUM_SHOP = [
  { id: "gold_nametag", name: "Golden Nametag", priceToken: 50, desc: "Your name draws in gold for everyone. Planned $nihala holder cosmetic (not for sale)." },
  { id: "shrine_pet", name: "Shrine Pet (cosmetic)", priceToken: 150, desc: "A tiny maneki follower. Planned $nihala holder cosmetic (not for sale)." },
  { id: "premium_cape", name: "Premium Cape", priceToken: 100, desc: "A ceremonial cape. Planned $nihala holder cosmetic (not for sale)." },
];

const MIHAO_MINT = "4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump";
const MIHAO_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const DEXSCREENER = "https://dexscreener.com/solana/ho1asg6wgh1ffxdehrk2f4ggt1hoxo9s5jclmdqeyebz";

const RESOURCE_TIERS = {
  fish: [
    { id: "minnow", item: "raw_minnow", name: "Minnow spot", level: 1, toolTier: 0, xp: 18, time: 2000, respawn: 12000, charges: 2 },
    { id: "carp", item: "raw_fish", name: "Carp spot", level: 1, toolTier: 0, xp: 28, time: 2400, respawn: 14000, charges: 2 },
    { id: "koi", item: "raw_koi", name: "Koi spot", level: 20, toolTier: 2, xp: 55, time: 3000, respawn: 20000, charges: 1 },
    { id: "golden_koi", item: "raw_golden_koi", name: "Golden koi spot", level: 40, toolTier: 3, xp: 90, time: 3600, respawn: 28000, charges: 1 },
  ],
  ore: [
    { id: "copper", item: "ore", name: "Copper rock", level: 1, toolTier: 1, xp: 26, time: 2600, respawn: 18000, charges: 3, tile: "ore" },
    { id: "tin", item: "tin_ore", name: "Tin rock", level: 1, toolTier: 1, xp: 26, time: 2600, respawn: 18000, charges: 3, tile: "tinore" },
    { id: "iron", item: "iron_ore", name: "Iron rock", level: 15, toolTier: 2, xp: 48, time: 3000, respawn: 22000, charges: 3, tile: "ironore" },
    { id: "jade", item: "jade_ore", name: "Jade rock", level: 30, toolTier: 3, xp: 75, time: 3600, respawn: 28000, charges: 2, tile: "jadeore" },
  ],
  tree: [
    { id: "bamboo", item: "bamboo", name: "Bamboo", level: 1, toolTier: 1, xp: 25, time: 2400, respawn: 16000, charges: 4, tile: "bamboo" },
    { id: "pine", item: "pine_logs", name: "Pine tree", level: 15, toolTier: 2, xp: 50, time: 3000, respawn: 22000, charges: 4, tile: "pine" },
    { id: "cherry", item: "cherry_logs", name: "Cherry tree", level: 30, toolTier: 3, xp: 80, time: 3600, respawn: 28000, charges: 3, tile: "cherry" },
  ],
  yarn: [
    { id: "yarn", item: "yarn", name: "Yarn bush", level: 1, toolTier: 0, xp: 20, time: 2200, respawn: 16000, charges: 3 },
  ],
};

const SMELT_RECIPES = [
  { id: "bronze", product: "bronze_bar", inputs: { ore: 1, tin_ore: 1 }, level: 1, xp: 20, time: 2000, label: "Smelt bronze bar" },
  { id: "copper", product: "copper_bar", inputs: { ore: 1 }, level: 1, xp: 12, time: 1800, label: "Smelt copper bar" },
  { id: "iron", product: "iron_bar", inputs: { iron_ore: 1 }, level: 15, xp: 35, time: 2400, label: "Smelt iron bar" },
  { id: "jade", product: "jade_bar", inputs: { jade_ore: 1 }, level: 30, xp: 55, time: 3000, label: "Smelt jade bar" },
];

const SMITH_RECIPES = [
  { product: "bronze_pickaxe", inputs: { bronze_bar: 1 }, level: 1, xp: 25, time: 2200, label: "Smith bronze pickaxe" },
  { product: "bronze_axe", inputs: { bronze_bar: 1 }, level: 1, xp: 25, time: 2200, label: "Smith bronze axe" },
  { product: "bronze_rod", inputs: { bronze_bar: 1 }, level: 1, xp: 25, time: 2200, label: "Smith bronze rod" },
  { product: "bronze_sword", inputs: { bronze_bar: 1 }, level: 1, xp: 25, time: 2200, label: "Smith bronze sword" },
  { product: "bronze_helm", inputs: { bronze_bar: 1 }, level: 5, xp: 28, time: 2200, label: "Smith bronze helm" },
  { product: "bronze_mail", inputs: { bronze_bar: 2 }, level: 8, xp: 40, time: 2600, label: "Smith bronze mail" },
  { product: "iron_pickaxe", inputs: { iron_bar: 1 }, level: 15, xp: 45, time: 2600, label: "Smith iron pickaxe" },
  { product: "iron_axe", inputs: { iron_bar: 1 }, level: 15, xp: 45, time: 2600, label: "Smith iron axe" },
  { product: "iron_rod", inputs: { iron_bar: 1 }, level: 15, xp: 45, time: 2600, label: "Smith iron rod" },
  { product: "iron_sword", inputs: { iron_bar: 1 }, level: 15, xp: 45, time: 2600, label: "Smith iron sword" },
  { product: "iron_helm", inputs: { iron_bar: 1 }, level: 18, xp: 50, time: 2600, label: "Smith iron helm" },
  { product: "iron_mail", inputs: { iron_bar: 2 }, level: 22, xp: 70, time: 3000, label: "Smith iron mail" },
  { product: "jade_pickaxe", inputs: { jade_bar: 1 }, level: 30, xp: 75, time: 3200, label: "Smith jade pickaxe" },
  { product: "jade_axe", inputs: { jade_bar: 1 }, level: 30, xp: 75, time: 3200, label: "Smith jade axe" },
  { product: "jade_rod", inputs: { jade_bar: 1 }, level: 30, xp: 75, time: 3200, label: "Smith jade rod" },
  { product: "jade_sword", inputs: { jade_bar: 1 }, level: 30, xp: 75, time: 3200, label: "Smith jade sword" },
  { product: "jade_helm", inputs: { jade_bar: 1 }, level: 33, xp: 80, time: 3200, label: "Smith jade helm" },
  { product: "jade_mail", inputs: { jade_bar: 2 }, level: 36, xp: 110, time: 3600, label: "Smith jade mail" },
];

function addQualityVariants() {
  const foods = Object.values(ITEMS).filter((d) => d.heal && !d.base);
  for (const d of foods) {
    for (const [q, Q] of Object.entries(QUALITY)) {
      const heal = d.heal + (q === "fine" ? Math.max(2, Math.round(d.heal * 0.25)) : Math.max(4, Math.round(d.heal * 0.5)));
      ITEMS[d.id + "_" + q] = {
        ...d, id: d.id + "_" + q, name: Q.label + " " + d.name, base: d.id, quality: q, heal,
        desc: `${Q.label} cooking. Eat to heal ${heal} HP.`, sell: Math.round(d.sell * Q.mult),
      };
    }
  }
  for (const r of SMITH_RECIPES) {
    const d = ITEMS[r.product];
    if (!d || d.base) continue;
    for (const [q, Q] of Object.entries(QUALITY)) {
      const bonus = q === "fine" ? 1 : 2;
      const v = { ...d, id: d.id + "_" + q, name: Q.label + " " + d.name, base: d.id, quality: q, sell: Math.round(d.sell * Q.mult) };
      let extra = "";
      if (d.atk) { v.atk = d.atk + bonus; extra = ` +${bonus} attack.`; }
      if (d.def) { v.def = d.def + bonus; extra = ` +${bonus} defence.`; }
      if (d.tool) { v.toolSpeed = Math.round(d.toolSpeed * (q === "fine" ? 0.95 : 0.9) * 100) / 100; extra = ` ${q === "fine" ? 5 : 10}% faster.`; }
      v.desc = `${Q.label} smithing: ${d.desc}${extra}`;
      ITEMS[v.id] = v;
    }
  }
}
addQualityVariants();

const QUESTS = [
  {
    id: "maneki_yarn",
    name: "Old Maneki's Lost Yarn",
    giver: "npc-greeter",
    start: "I was winding yarn in the forest and dropped three balls. Please bring them back to me.",
    waiting: "I still need 3 yarn. You'll find bushes in Yarn Forest, east of the village.",
    finish: "You found them! 你好, friend. Wear this ribbon and go well.",
    steps: ["Talk to Old Maneki in the village shrine.", "Bring 3 yarn to Old Maneki."],
    need: { yarn: 3 },
    reward: { xp: { yarn: 150 }, gold: 25, item: "maneki_ribbon" },
  },
  {
    id: "chef_catch",
    name: "Chef Chou's Catch",
    giver: "npc-chef",
    start: "The range is hot and I am short two cooked carp. Catch, cook, and bring them here.",
    waiting: "I still need 2 cooked carp. Fish at the pond, then use this range.",
    finish: "Perfect timing. Take this koi — a cook should taste the next tier.",
    steps: ["Talk to Chef Chou in the kitchen.", "Bring 2 cooked carp to Chef Chou."],
    need: { cooked_fish: 2 },
    reward: { xp: { cooking: 120 }, gold: 20, item: "cooked_koi" },
  },
];

const ZONES = [
  { id: "quarry", name: "Jade Quarry", require: { skill: "mining", level: 15 } },
  { id: "mine", name: "The Mine" },
  { id: "harbor", name: "Lantern Harbor" },
  { id: "pond", name: "Fish Pond" },
  { id: "bamboo", name: "Bamboo Woods" },
  { id: "shrine-inner", name: "Cat Shrine", require: { skill: "combat", level: 10 } },
  { id: "shrine", name: "Cat Shrine Plains" },
  { id: "forest", name: "Yarn Forest" },
  { id: "village", name: "Ni Hao Village" },
  { id: "wilds", name: "The Wilds" },
];

function levelFromXp(xp) {
  let level = 1;
  let need = 40;
  let rem = Math.max(0, xp | 0);
  while (rem >= need && level < 99) {
    rem -= need;
    level++;
    need = Math.floor(need * 1.18 + 18);
  }
  return { level, into: rem, need };
}

function xpToNext(xp) {
  return levelFromXp(xp);
}

function emptySkills() {
  const s = {};
  for (const sk of SKILLS) s[sk.id] = 0;
  return s;
}

function emptyQuests() {
  const q = {};
  for (const quest of QUESTS) q[quest.id] = { step: 0, done: false };
  return q;
}

function normalizeQuests(raw) {
  const out = emptyQuests();
  if (!raw || typeof raw !== "object") return out;
  for (const quest of QUESTS) {
    const src = raw[quest.id];
    if (!src || typeof src !== "object") continue;
    out[quest.id] = {
      step: Math.max(0, src.step | 0),
      done: !!src.done,
    };
  }
  return out;
}

function rollFishKg(tier) {
  let min = 0.3, span = 4.7;
  if (tier === "minnow") { min = 0.1; span = 0.7; }
  else if (tier === "koi") { min = 0.8; span = 7.2; }
  else if (tier === "golden_koi") { min = 1.2; span = 10.8; }
  const kg = min + Math.pow(Math.random(), 1.7) * span;
  return Math.round(kg * 10) / 10;
}

function inBounds(x, y, tiles) {
  const h = tiles && tiles.length ? tiles.length : H;
  const w = tiles && tiles[0] ? tiles[0].length : W;
  return x >= 0 && y >= 0 && x < w && y < h;
}

const WALK = new Set(["grass", "path", "sand", "floor", "stone", "dock", "flower", "rug", "bridge", "shrine", "plank", "quarry"]);

function isWalkable(tiles, x, y) {
  if (!inBounds(x, y, tiles)) return false;
  return WALK.has(tiles[y][x]);
}

function adj(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)) <= 1;
}

function pathfind(tiles, x0, y0, x1, y1, maxSteps = 1200) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  if (!inBounds(x1, y1, tiles)) return [];
  if (!isWalkable(tiles, x1, y1)) {
    let best = null, bd = 99;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = x1 + dx, y = y1 + dy;
        if (isWalkable(tiles, x, y)) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
    }
    if (!best) return [];
    x1 = best.x; y1 = best.y;
  }
  if (x0 === x1 && y0 === y1) return [];
  const stride = Math.max(256, (tiles[0] && tiles[0].length) || W);
  const key = (x, y) => x + y * stride;
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const heur = (x, y) => Math.max(Math.abs(x - x1), Math.abs(y - y1));
  const gScore = new Map();
  const prev = new Map();
  const heap = [];
  const push = (k, x, y, g) => {
    const f = g + heur(x, y);
    heap.push({ k, x, y, g, f });
  };
  const pop = () => {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i].f < heap[bi].f) bi = i;
    return heap.splice(bi, 1)[0];
  };

  const startK = key(x0, y0);
  gScore.set(startK, 0);
  prev.set(startK, null);
  push(startK, x0, y0, 0);
  let found = false;
  let steps = 0;
  const visitLimit = Math.max(8000, maxSteps * 16);
  while (heap.length && steps++ < visitLimit) {
    const cur = pop();
    if (cur.g !== gScore.get(cur.k)) continue;
    if (cur.x === x1 && cur.y === y1) { found = true; break; }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isWalkable(tiles, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(tiles, cur.x + dx, cur.y) || !isWalkable(tiles, cur.x, cur.y + dy)) continue;
      }
      const nk = key(nx, ny);
      const g = cur.g + (dx !== 0 && dy !== 0 ? 1.4 : 1);
      if (gScore.has(nk) && g >= gScore.get(nk)) continue;
      gScore.set(nk, g);
      prev.set(nk, [cur.x, cur.y]);
      push(nk, nx, ny, g);
    }
  }
  if (!found || !prev.has(key(x1, y1))) return [];
  const path = [];
  let cur = [x1, y1];
  while (cur) {
    path.push({ x: cur[0], y: cur[1] });
    cur = prev.get(key(cur[0], cur[1]));
  }
  path.reverse();
  if (path.length && path[0].x === x0 && path[0].y === y0) path.shift();
  return path.slice(0, maxSteps);
}

function zoneAt(x, y) {
  x = Math.round(Number(x) || 0);
  y = Math.round(Number(y) || 0);
  if (x >= 64 && y <= 26) return { id: "quarry", name: "Jade Quarry", require: { skill: "mining", level: 15 } };
  if (y <= 15 && x >= 16 && x <= 50) return { id: "mine", name: "The Mine" };
  if (y < 16 && x < 64) return { id: "mine", name: "The Mine" };
  if (x <= 28 && y >= 48) return { id: "harbor", name: "Lantern Harbor" };
  if (x <= 16 && y >= 14 && y < 48) return { id: "pond", name: "Fish Pond" };
  if (x >= 20 && x <= 72 && y >= 50) return { id: "bamboo", name: "Bamboo Woods" };
  if (x >= 96 && y >= 38 && y <= 62) return { id: "shrine-inner", name: "Cat Shrine", require: { skill: "combat", level: 10 } };
  if (x >= 64 && y >= 27) return { id: "shrine", name: "Cat Shrine Plains" };
  if (x >= 47 && y >= 14 && y < 50 && x < 64) return { id: "forest", name: "Yarn Forest" };
  if (x >= 17 && x <= 46 && y >= 16 && y < 50) return { id: "village", name: "Ni Hao Village" };
  return { id: "wilds", name: "The Wilds" };
}

function zoneBlocked(zone, account) {
  if (!zone || !zone.require) return null;
  const have = levelFromXp((account && account.skills && account.skills[zone.require.skill]) || 0).level;
  if (have >= zone.require.level) return null;
  const sk = SKILLS.find((s) => s.id === zone.require.skill);
  return `${zone.name} requires ${sk ? sk.name : zone.require.skill} level ${zone.require.level} (you have ${have}).`;
}

function combatLevel(account) {
  return levelFromXp((account && account.skills && account.skills.combat) || 0).level;
}

function equipmentBonuses(account) {
  const eq = (account && account.equipped) || {};
  let atk = 0, def = 0;
  for (const slot of ["weapon", "head", "body"]) {
    const id = eq[slot];
    const defn = id && ITEMS[id];
    if (!defn) continue;
    atk += defn.atk || 0;
    def += defn.def || 0;
  }
  return { atk, def };
}

function fill(tiles, x0, y0, x1, y1, v) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inBounds(x, y, tiles)) tiles[y][x] = v;
    }
  }
}

function stampBuilding(tiles, x, y, w, h, doorSide) {
  fill(tiles, x, y, x + w - 1, y + h - 1, "wall");
  fill(tiles, x + 1, y + 1, x + w - 2, y + h - 2, "floor");
  const midX = x + Math.floor(w / 2);
  const midY = y + Math.floor(h / 2);
  if (doorSide === "s") tiles[y + h - 1][midX] = "floor";
  if (doorSide === "n") tiles[y][midX] = "floor";
  if (doorSide === "e") tiles[midY][x + w - 1] = "floor";
  if (doorSide === "w") tiles[midY][x] = "floor";
}

function buildWorld() {
  const tiles = Array.from({ length: H }, () => Array(W).fill("grass"));

  // --- Mine (north, original coordinates) ---
  fill(tiles, 16, 1, 50, 15, "stone");
  fill(tiles, 16, 1, 50, 1, "wall");
  fill(tiles, 16, 1, 16, 15, "wall");
  fill(tiles, 50, 1, 50, 15, "wall");
  fill(tiles, 16, 1, 24, 4, "wall");
  fill(tiles, 42, 1, 50, 4, "wall");
  for (const [x, y] of [[22, 6], [28, 9], [35, 6], [41, 10], [25, 12], [38, 13]]) {
    if (inBounds(x, y, tiles)) tiles[y][x] = "wall";
  }
  fill(tiles, 30, 15, 34, 18, "path");
  fill(tiles, 31, 15, 33, 15, "path");
  // tunnel east toward the jade quarry
  fill(tiles, 50, 8, 64, 10, "stone");
  fill(tiles, 50, 8, 50, 10, "stone");

  // --- Village plaza ---
  fill(tiles, 18, 17, 45, 38, "grass");
  fill(tiles, 24, 22, 40, 34, "path");
  fill(tiles, 30, 18, 34, 22, "path");
  fill(tiles, 16, 26, 24, 28, "path");
  fill(tiles, 40, 26, 48, 28, "path");
  fill(tiles, 30, 34, 34, 38, "path");

  stampBuilding(tiles, 19, 20, 7, 6, "e");
  tiles[23][24] = "rug";
  tiles[22][21] = "floor";

  stampBuilding(tiles, 38, 20, 7, 6, "w");
  tiles[23][39] = "rug";

  stampBuilding(tiles, 20, 31, 6, 5, "n");

  // Smithy, south-east of the plaza
  stampBuilding(tiles, 38, 31, 6, 5, "n");
  fill(tiles, 34, 33, 38, 34, "path");

  fill(tiles, 30, 25, 34, 29, "path");
  tiles[27][32] = "rug";

  for (const [x, y] of [[26, 21], [27, 21], [37, 21], [26, 35], [38, 35], [25, 30], [39, 30], [28, 19], [36, 19]]) {
    tiles[y][x] = "flower";
  }

  // --- Fish Pond (west) ---
  fill(tiles, 1, 16, 15, 42, "grass");
  for (let y = 18; y <= 40; y++) {
    for (let x = 1; x <= 13; x++) {
      const cx = 7, cy = 29;
      const dx = (x - cx) / 6.2, dy = (y - cy) / 10.5;
      if (dx * dx + dy * dy < 1) tiles[y][x] = "water";
    }
  }
  fill(tiles, 12, 25, 16, 28, "dock");
  fill(tiles, 11, 26, 12, 27, "dock");
  tiles[26][11] = "dock";
  tiles[27][11] = "dock";
  for (let y = 17; y <= 41; y++) {
    for (let x = 1; x <= 14; x++) {
      if (tiles[y][x] === "water") {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny, tiles) && tiles[ny][nx] === "grass") tiles[ny][nx] = "sand";
        }
      }
    }
  }
  fill(tiles, 13, 26, 18, 27, "path");

  // --- Yarn Forest (east) ---
  fill(tiles, 47, 16, 62, 46, "grass");
  fill(tiles, 45, 26, 63, 28, "path");
  const treeSpots = [];
  for (let y = 17; y <= 45; y++) {
    for (let x = 48; x <= 62; x++) {
      if ((x * 13 + y * 29) % 7 === 0 && tiles[y][x] === "grass") {
        tiles[y][x] = "tree";
        treeSpots.push({ x, y });
      }
    }
  }
  fill(tiles, 52, 28, 57, 33, "grass");
  tiles[30][54] = "flower";
  tiles[31][55] = "flower";

  fill(tiles, 18, 39, 46, 46, "grass");
  for (const [x, y] of [[22, 41], [28, 43], [36, 42], [40, 44], [18, 44]]) tiles[y][x] = "flower";

  // Roads out of the original map
  fill(tiles, 30, 38, 34, 52, "path"); // south to bamboo / harbor
  fill(tiles, 16, 50, 30, 52, "path"); // west spur to harbor
  fill(tiles, 34, 50, 48, 52, "path");
  fill(tiles, 62, 26, 65, 28, "path"); // leave the forest road short of the quarry wall
  fill(tiles, 62, 29, 96, 31, "path"); // east road to shrine plains, south of the quarry gate
  fill(tiles, 50, 8, 70, 10, "path");
  fill(tiles, 64, 8, 70, 10, "quarry");

  // --- Jade Quarry (northeast) ---
  fill(tiles, 66, 2, 126, 27, "stone");
  fill(tiles, 66, 2, 126, 2, "wall");
  fill(tiles, 126, 2, 126, 27, "wall");
  fill(tiles, 66, 2, 66, 7, "wall");
  fill(tiles, 66, 11, 66, 27, "wall");
  fill(tiles, 66, 27, 90, 27, "wall");
  for (const [x, y] of [[78, 8], [88, 14], [98, 7], [110, 12], [120, 9], [84, 20], [104, 22], [116, 18]]) {
    tiles[y][x] = "wall";
  }
  fill(tiles, 68, 8, 76, 10, "path");
  fill(tiles, 76, 10, 78, 16, "path");
  fill(tiles, 78, 16, 100, 18, "quarry");

  // --- Lantern Harbor (southwest) ---
  fill(tiles, 1, 48, 28, 94, "sand");
  fill(tiles, 2, 58, 22, 90, "water");
  fill(tiles, 6, 62, 18, 86, "deepwater");
  fill(tiles, 14, 50, 22, 58, "dock");
  fill(tiles, 16, 58, 20, 66, "plank");
  fill(tiles, 8, 56, 14, 58, "dock");
  for (const [x, y] of [[16, 52], [19, 54], [15, 60], [18, 64]]) tiles[y][x] = "lantern";
  // shore ring
  for (let y = 50; y <= 93; y++) {
    for (let x = 1; x <= 27; x++) {
      if (tiles[y][x] === "water" || tiles[y][x] === "deepwater") {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny, tiles) && tiles[ny][nx] === "sand") tiles[ny][nx] = "dock";
        }
      }
    }
  }
  fill(tiles, 16, 48, 22, 52, "path");

  // --- Bamboo Woods (south) ---
  fill(tiles, 24, 53, 72, 94, "grass");
  fill(tiles, 30, 52, 34, 70, "path");
  fill(tiles, 34, 68, 55, 70, "path");
  fill(tiles, 48, 70, 50, 88, "path");
  const bambooSpots = [];
  const pineSpots = [];
  const cherrySpots = [];
  for (let y = 54; y <= 93; y++) {
    for (let x = 24; x <= 71; x++) {
      if (tiles[y][x] !== "grass") continue;
      const h = (x * 17 + y * 31) % 11;
      if (x >= 52 && y >= 78 && h === 0) {
        tiles[y][x] = "cherry";
        cherrySpots.push({ x, y });
      } else if (x >= 40 && y >= 66 && h === 2) {
        tiles[y][x] = "pine";
        pineSpots.push({ x, y });
      } else if (h === 4 || h === 7) {
        tiles[y][x] = "bamboo";
        bambooSpots.push({ x, y });
      }
    }
  }
  fill(tiles, 47, 84, 54, 90, "grass");
  tiles[86][50] = "flower";
  tiles[87][51] = "flower";

  // --- Cat Shrine Plains (east) ---
  fill(tiles, 64, 29, 126, 94, "grass");
  fill(tiles, 62, 26, 100, 28, "path");
  fill(tiles, 98, 28, 100, 48, "path");
  fill(tiles, 96, 46, 116, 50, "path");
  // shrine courtyard
  fill(tiles, 100, 40, 118, 58, "shrine");
  fill(tiles, 104, 44, 114, 54, "path");
  tiles[49][109] = "rug";
  stampBuilding(tiles, 106, 46, 7, 6, "w");
  tiles[49][107] = "rug";
  for (let y = 32; y <= 90; y++) {
    for (let x = 66; x <= 124; x++) {
      if (tiles[y][x] !== "grass") continue;
      if ((x * 11 + y * 19) % 23 === 0) tiles[y][x] = "flower";
    }
  }
  // path south from shrine toward bamboo
  fill(tiles, 70, 70, 72, 94, "path");
  fill(tiles, 70, 70, 100, 72, "path");

  // Outer walls
  for (let x = 0; x < W; x++) {
    tiles[0][x] = "wall";
    tiles[H - 1][x] = "wall";
  }
  for (let y = 0; y < H; y++) {
    tiles[y][0] = "wall";
    tiles[y][W - 1] = "wall";
  }

  const nodes = [];
  let nid = 1;
  const addNode = (type, x, y, extra = {}) => {
    const charges = extra.charges || 1;
    nodes.push({
      id: "n" + nid++,
      type, x, y,
      depleted: false,
      respawnAt: 0,
      charges,
      maxCharges: charges,
      ...extra,
    });
  };

  function placeResourceNode(type, x, y, tier, skill, extras = {}) {
    if (!inBounds(x, y, tiles)) return false;
    if (nodes.some((n) => n.x === x && n.y === y)) return false;
    addNode(type, x, y, {
      skill,
      item: tier.item,
      xp: tier.xp,
      time: tier.time,
      respawn: tier.respawn,
      charges: tier.charges || 1,
      level: tier.level || 1,
      toolTier: tier.toolTier || 0,
      resource: tier.id,
      label: tier.name,
      ...extras,
    });
    return true;
  }

  function placeBeside(spots, type, skill, tiersOrTier, preferWalkable = true) {
    const list = Array.isArray(tiersOrTier) ? null : tiersOrTier;
    let count = 0;
    for (const t of spots) {
      const cand = [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]];
      for (const [x, y] of cand) {
        if (preferWalkable && !isWalkable(tiles, x, y)) continue;
        if (placeResourceNode(type, x, y, list || t.tier, skill, { rockX: t.x, rockY: t.y })) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  // Pond carp / minnow
  const pondCarp = [[11, 26], [11, 27], [12, 25], [10, 24], [8, 18], [5, 20]];
  const pondMinnow = [[4, 36], [9, 38], [12, 33]];
  for (const [x, y] of pondCarp) {
    if (isWalkable(tiles, x, y)) placeResourceNode("fish", x, y, RESOURCE_TIERS.fish[1], "fishing");
  }
  for (const [x, y] of pondMinnow) {
    if (isWalkable(tiles, x, y)) placeResourceNode("fish", x, y, RESOURCE_TIERS.fish[0], "fishing");
  }

  // Harbor fishing: minnow on near docks, koi mid, golden koi on deep piers
  const harborMinnow = [[16, 54], [18, 55], [14, 57], [12, 56], [8, 57]];
  const harborKoi = [[16, 60], [19, 62], [17, 64], [15, 66]];
  const harborGold = [[18, 68], [16, 70], [19, 72]];
  for (const [x, y] of harborMinnow) if (isWalkable(tiles, x, y)) placeResourceNode("fish", x, y, RESOURCE_TIERS.fish[0], "fishing");
  for (const [x, y] of harborKoi) if (isWalkable(tiles, x, y)) placeResourceNode("fish", x, y, RESOURCE_TIERS.fish[2], "fishing");
  for (const [x, y] of harborGold) if (isWalkable(tiles, x, y)) placeResourceNode("fish", x, y, RESOURCE_TIERS.fish[3], "fishing");

  // Yarn bushes in forest
  let yarnCount = 0;
  for (const t of treeSpots) {
    if (yarnCount >= 14) break;
    const cand = [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]];
    for (const [x, y] of cand) {
      if (isWalkable(tiles, x, y) && placeResourceNode("yarn", x, y, RESOURCE_TIERS.yarn[0], "yarn")) {
        yarnCount++;
        break;
      }
    }
  }
  for (const [x, y] of [[52, 29], [56, 29], [52, 32], [56, 32], [54, 27], [55, 34]]) {
    if (isWalkable(tiles, x, y)) {
      tiles[y][x] = "flower";
      placeResourceNode("yarn", x, y, RESOURCE_TIERS.yarn[0], "yarn");
    }
  }

  function placeRocks(coords, tier) {
    for (const [x, y] of coords) {
      if (!inBounds(x, y, tiles)) continue;
      tiles[y][x] = tier.tile || "ore";
      let placed = false;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (isWalkable(tiles, nx, ny) && placeResourceNode("ore", nx, ny, tier, "mining", { rockX: x, rockY: y })) {
          placed = true;
          break;
        }
      }
      if (!placed && isWalkable(tiles, x, y)) placeResourceNode("ore", x, y, tier, "mining");
    }
  }

  placeRocks([[20, 7], [24, 8], [27, 5], [33, 5], [21, 11], [18, 9]], RESOURCE_TIERS.ore[0]);
  placeRocks([[37, 8], [43, 7], [29, 11], [36, 11], [44, 12], [40, 5]], RESOURCE_TIERS.ore[1]);
  // Iron deeper in the original mine and the tunnel
  placeRocks([[48, 9], [46, 12], [52, 9], [56, 8], [60, 10]], RESOURCE_TIERS.ore[2]);
  // Jade in the quarry
  placeRocks([[80, 12], [86, 16], [94, 10], [102, 14], [112, 11], [118, 16], [90, 22], [108, 20], [122, 12], [84, 8]], RESOURCE_TIERS.ore[3]);
  // A couple of iron rocks in the quarry entrance
  placeRocks([[72, 12], [74, 18], [78, 14]], RESOURCE_TIERS.ore[2]);

  function placeTrees(spots, tier, limit) {
    let n = 0;
    for (const t of spots) {
      if (n >= limit) break;
      const cand = [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]];
      for (const [x, y] of cand) {
        if (isWalkable(tiles, x, y) && placeResourceNode("tree", x, y, tier, "woodcutting", { rockX: t.x, rockY: t.y })) {
          n++;
          break;
        }
      }
    }
    return n;
  }
  placeTrees(bambooSpots, RESOURCE_TIERS.tree[0], 22);
  placeTrees(pineSpots, RESOURCE_TIERS.tree[1], 12);
  placeTrees(cherrySpots, RESOURCE_TIERS.tree[2], 8);
  // guaranteed starter bamboo near the south path
  for (const [tx, ty, nx, ny] of [[28, 56, 29, 56], [32, 58, 33, 58], [36, 57, 36, 58]]) {
    if (inBounds(tx, ty, tiles)) tiles[ty][tx] = "bamboo";
    if (isWalkable(tiles, nx, ny)) placeResourceNode("tree", nx, ny, RESOURCE_TIERS.tree[0], "woodcutting", { rockX: tx, rockY: ty });
  }

  addNode("range", 22, 33, { skill: "cooking", xp: 24, time: 1800, respawn: 0, label: "Cooking range", action: "Cook" });
  tiles[33][22] = "floor";
  addNode("furnace", 39, 33, { skill: "smithing", time: 2000, respawn: 0, label: "Furnace", action: "Smelt" });
  addNode("anvil", 41, 33, { skill: "smithing", time: 2200, respawn: 0, label: "Anvil", action: "Smith" });
  addNode("board", 35, 26, { skill: null, time: 0, respawn: 0, label: "Daily tasks board", action: "Read" });
  tiles[33][39] = "floor";
  tiles[33][41] = "floor";

  const npcs = [
    { id: "npc-banker", name: "Banker Bao", role: "bank", x: 21, y: 22, avatar: "suit", examine: "Banker Bao keeps everyone's yarn safe." },
    { id: "npc-merchant", name: "Merchant Mao", role: "shop", x: 42, y: 22, avatar: "coat", examine: "Merchant Mao sells cosmetics, food, and starter tools for in-game gold." },
    { id: "npc-chef", name: "Chef Chou", role: "cook", x: 23, y: 33, avatar: "bonnet", examine: "Chef Chou minds the village range. Click the range to cook fish." },
    { id: "npc-greeter", name: "Old Maneki", role: "greet", x: 32, y: 26, avatar: "classic-paw", examine: "你好，朋友. Welcome to Ni Hao Village." },
    { id: "npc-smith", name: "Smith Lin", role: "smith", x: 40, y: 32, avatar: "knight", examine: "Smith Lin minds the furnace and anvil. Smelt ore, then smith bars into tools." },
    { id: "npc-harbor", name: "Harbor Hao", role: "greet", x: 17, y: 53, avatar: "coat", examine: "Deeper water holds koi. Bring a better rod, and mind the waves." },
    { id: "npc-shrine", name: "Shrine Mei", role: "greet", x: 108, y: 49, avatar: "bonnet", examine: "The inner shrine is for seasoned fighters. Train first, then enter." },
  ];

  const mobs = [
    { id: "dog-1", name: "Rival Dog", kind: "dog", level: 3, x: 53, y: 36, hp: 12, maxHp: 12, wander: true, xp: 30, gold: [5, 15], drop: "bones" },
    { id: "dog-2", name: "Rival Dog", kind: "dog", level: 3, x: 58, y: 24, hp: 12, maxHp: 12, wander: true, xp: 30, gold: [5, 15], drop: "bones" },
    { id: "dog-3", name: "Rival Dog", kind: "dog", level: 4, x: 50, y: 42, hp: 14, maxHp: 14, wander: true, xp: 36, gold: [6, 16], drop: "bones" },
    { id: "rat-1", name: "Temple Rat", kind: "rat", level: 1, x: 74, y: 36, hp: 8, maxHp: 8, wander: true, xp: 16, gold: [2, 6], drop: "rat_tail" },
    { id: "rat-2", name: "Temple Rat", kind: "rat", level: 1, x: 82, y: 44, hp: 8, maxHp: 8, wander: true, xp: 16, gold: [2, 6], drop: "rat_tail" },
    { id: "rat-3", name: "Temple Rat", kind: "rat", level: 2, x: 70, y: 58, hp: 10, maxHp: 10, wander: true, xp: 20, gold: [3, 8], drop: "rat_tail" },
    { id: "rat-4", name: "Temple Rat", kind: "rat", level: 2, x: 88, y: 64, hp: 10, maxHp: 10, wander: true, xp: 20, gold: [3, 8], drop: "rat_tail" },
    { id: "hound-1", name: "Shrine Hound", kind: "hound", level: 12, x: 102, y: 42, hp: 28, maxHp: 28, wander: true, xp: 70, gold: [12, 24], drop: "shrine_token" },
    { id: "hound-2", name: "Shrine Hound", kind: "hound", level: 12, x: 116, y: 54, hp: 28, maxHp: 28, wander: true, xp: 70, gold: [12, 24], drop: "shrine_token" },
    { id: "hound-3", name: "Shrine Hound", kind: "hound", level: 15, x: 110, y: 48, hp: 34, maxHp: 34, wander: true, xp: 90, gold: [16, 30], drop: "shrine_token" },
  ];

  const spawn = { x: 32, y: 28 };

  return { tiles, nodes, npcs, mobs, spawn, W, H, zones: ZONES };
}

module.exports = {
  W, H, AVATARS, SKILLS, ITEMS, SHOP, PREMIUM_SHOP, QUESTS, ZONES,
  RESOURCE_TIERS, SMELT_RECIPES, SMITH_RECIPES,
  MIHAO_MINT, MIHAO_TOKEN_PROGRAM, DEXSCREENER,
  levelFromXp, xpToNext, emptySkills, emptyQuests, normalizeQuests, rollFishKg,
  inBounds, isWalkable, pathfind, zoneAt, zoneBlocked, adj, buildWorld, WALK,
  combatLevel, equipmentBonuses,
};
