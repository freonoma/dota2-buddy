// Maps hero ID → positions the hero commonly plays at the Legend-Ancient
// bracket. Used by the recommendation engine to filter picks by role.
//
// Positions: 1 = Safe Lane Carry, 2 = Mid, 3 = Offlane,
//            4 = Soft Support / Roamer, 5 = Hard Support.
//
// When a hero plays multiple roles, the primary one comes first.

export const HERO_POSITIONS: Record<number, number[]> = {
  1: [1],              // Anti-Mage
  2: [3],              // Axe
  3: [4, 5],           // Bane
  4: [1, 3],           // Bloodseeker
  5: [5],              // Crystal Maiden
  6: [1],              // Drow Ranger
  7: [3, 4],           // Earthshaker
  8: [1],              // Juggernaut
  9: [4],              // Mirana
  10: [1],             // Morphling
  11: [2],             // Shadow Fiend
  12: [1],             // Phantom Lancer
  13: [2],             // Puck
  14: [4],             // Pudge
  15: [2, 3],          // Razor
  16: [3, 4],          // Sand King
  17: [2],             // Storm Spirit
  18: [1, 3],          // Sven
  19: [3, 4],          // Tiny
  20: [4, 5],          // Vengeful Spirit
  21: [2, 4],          // Windranger
  22: [2, 5],          // Zeus
  23: [2, 3],          // Kunkka
  25: [2, 5],          // Lina
  26: [5],             // Lion
  27: [4, 5],          // Shadow Shaman
  28: [3, 4],          // Slardar
  29: [3],             // Tidehunter
  30: [5],             // Witch Doctor
  31: [5],             // Lich
  32: [4],             // Riki
  33: [3],             // Enigma
  34: [2],             // Tinker
  35: [1],             // Sniper
  36: [2, 3],          // Necrophos
  37: [5],             // Warlock
  38: [3, 4],          // Beastmaster
  39: [2],             // Queen of Pain
  40: [3],             // Venomancer
  41: [1],             // Faceless Void
  42: [1, 3],          // Wraith King
  43: [2, 3],          // Death Prophet
  44: [1],             // Phantom Assassin
  45: [2, 5],          // Pugna
  46: [2],             // Templar Assassin
  47: [2, 3],          // Viper
  48: [1],             // Luna
  49: [2, 3],          // Dragon Knight
  50: [5],             // Dazzle
  51: [3, 4],          // Clockwerk
  52: [2],             // Leshrac
  53: [2, 3, 4],       // Nature's Prophet
  54: [1],             // Lifestealer
  55: [3],             // Dark Seer
  56: [1, 4],          // Clinkz
  57: [5],             // Omniknight
  58: [4, 5],          // Enchantress
  59: [1, 2],          // Huskar
  60: [3],             // Night Stalker
  61: [2, 3],          // Broodmother
  62: [4],             // Bounty Hunter
  63: [1, 4],          // Weaver
  64: [5],             // Jakiro
  65: [3, 4],          // Batrider
  66: [5],             // Chen
  67: [1],             // Spectre
  68: [5],             // Ancient Apparition
  69: [3],             // Doom
  70: [1],             // Ursa
  71: [4],             // Spirit Breaker
  72: [1, 4],          // Gyrocopter
  73: [1],             // Alchemist
  74: [2],             // Invoker
  75: [5],             // Silencer
  76: [2],             // Outworld Destroyer
  77: [1, 3],          // Lycan
  78: [3],             // Brewmaster
  79: [5],             // Shadow Demon
  80: [1],             // Lone Druid
  81: [1, 3],          // Chaos Knight
  82: [2],             // Meepo
  83: [5],             // Treant Protector
  84: [5],             // Ogre Magi
  85: [3, 5],          // Undying
  86: [4, 5],          // Rubick
  87: [5],             // Disruptor
  88: [4],             // Nyx Assassin
  89: [1],             // Naga Siren
  90: [5],             // Keeper of the Light
  91: [5],             // Io
  92: [3],             // Visage
  93: [1],             // Slark
  94: [1],             // Medusa
  95: [1],             // Troll Warlord
  96: [3],             // Centaur Warrunner
  97: [3],             // Magnus
  98: [3],             // Timbersaw
  99: [3],             // Bristleback
  100: [4],            // Tusk
  101: [5],            // Skywrath Mage
  102: [3, 5],         // Abaddon
  103: [4, 5],         // Elder Titan
  104: [3],            // Legion Commander
  105: [5],            // Techies
  106: [2],            // Ember Spirit
  107: [4],            // Earth Spirit
  108: [3],            // Underlord
  109: [1],            // Terrorblade
  110: [4, 5],         // Phoenix
  111: [5],            // Oracle
  112: [5],            // Winter Wyvern
  113: [1, 2],         // Arc Warden
  114: [1, 3],         // Monkey King
  119: [4],            // Dark Willow
  120: [3, 4],         // Pangolier
  121: [5],            // Grimstroke
  123: [4],            // Hoodwink
  126: [2],            // Void Spirit
  128: [4, 5],         // Snapfire
  129: [3],            // Mars
  131: [3],            // Ringmaster (new-ish)
  135: [3, 5],         // Dawnbreaker
  136: [4],            // Marci
  137: [3],            // Primal Beast
  138: [1, 2],         // Muerta
  145: [4, 5],         // Ringmaster
  149: [2],            // Kez
};
