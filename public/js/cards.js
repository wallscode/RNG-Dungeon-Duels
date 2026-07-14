// cards.js — Master CARDS array (60 cards: 36 creatures + 24 sorceries) + RECRUIT_TOKEN.
// Pure data. weight / maxPerDeck follow rarity: common 4/3, uncommon 3/2, rare 2/2, legendary 1/1.

const kw = (name, tier, value) => (value === undefined ? { name, tier } : { name, tier, value });

export const CARDS = [
  // ── Creatures ──────────────────────────────────────────────────────────────
  {
    id: 'C001', name: 'Kobold Scout', type: 'creature', cost: 1, atk: '1d4', hp: 2,
    keywords: [], text: 'A nimble scout that gets the first jab in.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'kobold_scout',
  },
  {
    id: 'C002', name: 'Feral Gnoll', type: 'creature', cost: 1, atk: 'summon', hp: 3,
    keywords: [kw('Summon roll', 1)],
    text: 'Summon roll (d6): ATK becomes the result for the rest of the game.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'feral_gnoll',
  },
  {
    id: 'C003', name: 'Shield Dwarf', type: 'creature', cost: 2, atk: '1d4', hp: 5,
    keywords: [kw('Defender', 1)],
    text: 'Defender. When this is attacked, roll d6: on 4+, it takes 2 less damage from that attack.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'shield_dwarf',
  },
  {
    id: 'C004', name: 'Dire Wolf', type: 'creature', cost: 2, atk: '1d6', hp: 4,
    keywords: [kw('Frenzy', 2)],
    text: 'Frenzy: after attacking, roll d6. On 5–6 it attacks once more for the same damage.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'dire_wolf',
  },
  {
    id: 'C005', name: 'Stone Golem', type: 'creature', cost: 3, atk: '2d4', hp: 6,
    keywords: [kw('Minimum roll', 1, 2)],
    text: 'Minimum roll (treat 1s as 2s).',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'stone_golem',
  },
  {
    id: 'C006', name: 'Sprite Trickster', type: 'creature', cost: 1, atk: '1d4', hp: 3,
    keywords: [], text: 'A nimble pixie — small but resilient.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'sprite_trickster',
  },
  {
    id: 'C007', name: 'Rabid Bat', type: 'creature', cost: 1, atk: '1d4', hp: 2,
    keywords: [kw('Volatile', 2)],
    text: 'Volatile: when this dies, roll d6; on 5–6 deal that much to a random enemy.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'rabid_bat',
  },
  {
    id: 'C008', name: 'Torch Goblin', type: 'creature', cost: 1, atk: '1d4', hp: 2,
    keywords: [],
    text: 'When this enters play, roll d6: on 5–6, deal 1 damage to the enemy hero.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'torch_goblin',
  },
  {
    id: 'C009', name: 'Stray Hound', type: 'creature', cost: 1, atk: '1d4', hp: 2,
    keywords: [kw('Lucky', 2)],
    text: 'Lucky: once per turn, you may reroll this creature’s damage roll for free.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'stray_hound',
  },
  {
    id: 'C010', name: 'Goblin Archer', type: 'creature', cost: 2, atk: '1d6', hp: 4,
    keywords: [], text: 'A sharpshooter — every shot finds its mark.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'goblin_archer',
  },
  {
    id: 'C011', name: 'Thorn Sprite', type: 'creature', cost: 2, atk: '1d4', hp: 4,
    keywords: [],
    text: 'When this is attacked, roll d6: on 4+, deal 2 damage back to the attacker.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'thorn_sprite',
  },
  {
    id: 'C012', name: 'Bog Lurker', type: 'creature', cost: 2, atk: '1d8', hp: 3,
    keywords: [kw('Brittle', 2)],
    text: 'Brittle: when this takes damage, roll d6; on a 1 it takes 1 extra.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'bog_lurker',
  },
  {
    id: 'C013', name: 'Acolyte of Luck', type: 'creature', cost: 2, atk: '1d4', hp: 4,
    keywords: [],
    text: 'At the start of your turn, roll d6: on 5–6, gain 1 Focus.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'acolyte_of_luck',
  },
  {
    id: 'C014', name: 'Wandering Knight', type: 'creature', cost: 2, atk: '1d6', hp: 4,
    keywords: [], text: 'A reliable body; its only randomness is its 1d6 damage.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'wandering_knight',
  },
  {
    id: 'C015', name: 'Pack Wolf', type: 'creature', cost: 2, atk: '1d6', hp: 4,
    keywords: [kw('Rally', 2)],
    text: 'Rally: on enter, roll d6; on 4+ another friendly creature gets +1 ATK die step this turn.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'pack_wolf',
  },
  {
    id: 'C016', name: 'Ironhide Boar', type: 'creature', cost: 3, atk: '1d6', hp: 6,
    keywords: [kw('Guardian', 1)],
    text: 'Guardian: enemies must attack this unless they bypass it.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'ironhide_boar',
  },
  {
    id: 'C017', name: 'Flame Adept', type: 'creature', cost: 3, atk: '1d6', hp: 4,
    keywords: [],
    text: 'When this enters play, roll d6: deal that much damage split among enemy creatures.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'flame_adept',
  },
  {
    id: 'C018', name: 'Temple Guard', type: 'creature', cost: 3, atk: '1d4', hp: 6,
    keywords: [kw('Defender', 1)],
    text: 'Defender. When this is attacked, roll d6: on 4+, take half the damage (round up).',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'temple_guard',
  },
  {
    id: 'C019', name: 'Berserker', type: 'creature', cost: 3, atk: '2d4', hp: 5,
    keywords: [kw('Minimum roll', 1, 2)],
    text: 'Minimum roll (treat 1s as 2s). A relentless attacker.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'berserker',
  },
  {
    id: 'C020', name: 'Trollkin Brute', type: 'creature', cost: 3, atk: '1d6', hp: 5,
    keywords: [kw('Regenerate', 2)],
    text: 'Regenerate: at the start of your turn, roll d6; on 4+ this creature gains 2 HP.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'trollkin_brute',
  },
  {
    id: 'C021', name: 'Cursed Marauder', type: 'creature', cost: 4, atk: '2d6', hp: 3,
    keywords: [kw('Volatile', 2), kw('Brittle', 2), kw('Rush', 2)],
    text: 'Rush. Volatile. Brittle.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'cursed_marauder',
  },
  {
    id: 'C022', name: 'Shadow Assassin', type: 'creature', cost: 4, atk: '2d6', hp: 2,
    keywords: [kw('Rush', 2)],
    text: 'Rush. When this creature critically hits (rolls max on every damage die), draw a card.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'shadow_assassin',
  },
  {
    id: 'C023', name: 'Pyromancer', type: 'creature', cost: 4, atk: '1d6', hp: 5,
    keywords: [],
    text: 'When this enters play, deal 1d6 damage to a random enemy creature.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'pyromancer',
  },
  {
    id: 'C024', name: 'Dwarven Defender', type: 'creature', cost: 4, atk: '1d6', hp: 8,
    keywords: [kw('Guardian', 1), kw('Defender', 1)],
    text: 'Guardian. Defender. When this is attacked, roll d6: on 3+, take 2 less damage.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'dwarven_defender',
  },
  {
    id: 'C025', name: 'Storm Caller', type: 'creature', cost: 4, atk: '2d4', hp: 5,
    keywords: [],
    text: 'When this attacks, roll d6: on 5–6, also deal 1d4 to the enemy hero.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'storm_caller',
  },
  {
    id: 'C026', name: 'Warband Captain', type: 'creature', cost: 4, atk: '1d6', hp: 6,
    keywords: [kw('Rally', 2), kw('Frenzy', 2)],
    text: 'Rally. Frenzy.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'warband_captain',
  },
  {
    id: 'C027', name: 'Ghoul Pack', type: 'creature', cost: 4, atk: '2d4', hp: 6,
    keywords: [kw('Volatile', 2)],
    text: 'Volatile. When this attacks, roll d6: on 5–6 it also deals 2 to the enemy hero.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'ghoul_pack',
  },
  {
    id: 'C028', name: 'Crystal Guardian', type: 'creature', cost: 4, atk: '1d6', hp: 9,
    keywords: [kw('Minimum roll', 1, 2), kw('Regenerate', 2)],
    text: 'Minimum roll (treat 1s as 2s). Regenerate.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'crystal_guardian',
  },
  {
    id: 'C029', name: 'Frost Elemental', type: 'creature', cost: 5, atk: '2d4', hp: 7,
    keywords: [],
    text: 'When this hits a creature, roll d6: on 5–6, that creature can’t attack next turn.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'frost_elemental',
  },
  {
    id: 'C030', name: 'Hill Giant', type: 'creature', cost: 5, atk: '2d6', hp: 8,
    keywords: [kw('Minimum roll', 1, 2)],
    text: 'Minimum roll (treat 1s as 2s).',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'hill_giant',
  },
  {
    id: 'C031', name: 'Vampire Lord', type: 'creature', cost: 5, atk: '2d4', hp: 6,
    keywords: [],
    text: 'When this deals combat damage, roll d6: on 4+, heal your hero that much.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'vampire_lord',
  },
  {
    id: 'C032', name: 'Chaos Beast', type: 'creature', cost: 5, atk: '3d6', hp: 4,
    keywords: [kw('Brittle', 2), kw('Volatile', 2)],
    text: 'Brittle. Volatile. When this attacks, roll d6: on a 1 it attacks a random target instead.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'chaos_beast',
  },
  {
    id: 'C033', name: 'War Troll', type: 'creature', cost: 6, atk: '2d6', hp: 9,
    keywords: [kw('Regenerate', 2), kw('Minimum roll', 1, 2)],
    text: 'Regenerate. Minimum roll (treat 1s as 2s).',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'war_troll',
  },
  {
    id: 'C034', name: 'Stone Colossus', type: 'creature', cost: 6, atk: '2d6', hp: 11,
    keywords: [kw('Guardian', 1)],
    text: 'Guardian. When this enters play, roll d6: gain that much HP.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'stone_colossus',
  },
  {
    id: 'C035', name: 'Hydra', type: 'creature', cost: 6, atk: '2d4', hp: 8,
    keywords: [kw('Frenzy', 2)],
    text: 'Frenzy. After attacking, roll d6: on 5–6 attack again for the same damage.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'hydra',
  },
  {
    id: 'C036', name: 'Ancient Dragon', type: 'creature', cost: 7, atk: '3d6', hp: 10,
    keywords: [kw('Frenzy', 2)],
    text: 'On enter, breath weapon: deal 2d6 split among enemies. Frenzy.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'ancient_dragon',
  },

  // ── Sorceries ──────────────────────────────────────────────────────────────
  {
    id: 'S001', name: 'Spark', type: 'sorcery', cost: 1,
    keywords: [], text: 'Deal 1d6 to any target.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'spark',
  },
  {
    id: 'S002', name: 'Focus Ritual', type: 'sorcery', cost: 1,
    keywords: [], text: 'Gain 2 Focus.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'focus_ritual',
  },
  {
    id: 'S003', name: 'Coin Flip', type: 'sorcery', cost: 1,
    keywords: [kw('Gamble', 1)],
    text: 'Gamble. Roll d6: on 4+ draw 2 cards; on 1–3 draw 1 card and take 1 damage.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'coin_flip',
  },
  {
    id: 'S004', name: 'Hex', type: 'sorcery', cost: 1,
    keywords: [kw('Wild', 1)],
    text: 'Wild. A random enemy creature deals -2 damage on its next attack (minimum 1).',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'hex',
  },
  {
    id: 'S005', name: 'Firebolt', type: 'sorcery', cost: 2,
    keywords: [], text: 'Deal 1d8 to any target.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'firebolt',
  },
  {
    id: 'S006', name: 'Healing Word', type: 'sorcery', cost: 2,
    keywords: [], text: 'Restore 2d4 HP to your hero.',
    rarity: 'common', weight: 4, maxPerDeck: 3, art: 'healing_word',
  },
  {
    id: 'S007', name: 'Lucky Draw', type: 'sorcery', cost: 2,
    keywords: [],
    text: 'Roll d6: on 1–2 draw 1 card; on 3–4 draw 2; on 5–6 draw 3 (then discard down to 7).',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'lucky_draw',
  },
  {
    id: 'S008', name: 'Blessing', type: 'sorcery', cost: 2,
    keywords: [],
    text: 'Target friendly creature deals +2 damage on its next attack this turn.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'blessing',
  },
  {
    id: 'S009', name: 'Chain Lightning', type: 'sorcery', cost: 3,
    keywords: [kw('Wild', 1)],
    text: 'Wild. Deal 2d6 damage split randomly among all enemy creatures.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'chain_lightning',
  },
  {
    id: 'S010', name: 'Berserk Brew', type: 'sorcery', cost: 3,
    keywords: [kw('Gamble', 1)],
    text: 'Gamble. Target friendly creature: roll d6. On 4+ roll 1d8 and add that to its next attack damage; on 1–3 it takes 2 damage.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'berserk_brew',
  },
  {
    id: 'S011', name: 'Mend the Ranks', type: 'sorcery', cost: 3,
    keywords: [], text: 'Roll d6: add that much HP to all friendly creatures.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'mend_the_ranks',
  },
  {
    id: 'S012', name: 'Sap Strength', type: 'sorcery', cost: 3,
    keywords: [],
    text: 'Roll d6: on 5–6 the opponent loses 2 mana on their next turn; on 1–4 they lose 1. (Minimum 0.)',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'sap_strength',
  },
  {
    id: 'S013', name: 'Fireball', type: 'sorcery', cost: 4,
    keywords: [], text: 'Deal 2d6 to any target.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'fireball',
  },
  {
    id: 'S014', name: 'Frost Nova', type: 'sorcery', cost: 4,
    keywords: [],
    text: 'Deal 1d4 to all enemy creatures; for each one hit, roll d6: on 5–6 it can’t attack next turn.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'frost_nova',
  },
  {
    id: 'S015', name: 'Polymorph Gamble', type: 'sorcery', cost: 4,
    keywords: [kw('Gamble', 1)],
    text: 'Gamble. Roll d6: 1–2 your creature becomes a 1/1 sheep; 3–6 turn an enemy creature into a 1/1 sheep.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'polymorph_gamble',
  },
  {
    id: 'S016', name: 'Second Wind', type: 'sorcery', cost: 4,
    keywords: [], text: 'Restore 2d6 HP to your hero and draw a card.',
    rarity: 'uncommon', weight: 3, maxPerDeck: 2, art: 'second_wind',
  },
  {
    id: 'S017', name: 'Meteor', type: 'sorcery', cost: 5,
    keywords: [],
    text: 'Deal 3d6 to a target; for each point of overkill, roll d6, on 5–6 return 1 HP to your hero (cap 5).',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'meteor',
  },
  {
    id: 'S018', name: 'Mass Disarray', type: 'sorcery', cost: 5,
    keywords: [kw('Wild', 1)],
    text: 'Wild. Roll d6 for each creature in play (both sides): on a 1 it deals no damage next turn.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'mass_disarray',
  },
  {
    id: 'S019', name: 'Twin Fates', type: 'sorcery', cost: 5,
    keywords: [kw('Gamble', 1)],
    text: 'Gamble. Roll 2d6 and deal the total to the enemy hero. If doubles, draw 2 cards instead. On a critical (6-6), deal double damage AND draw 2 cards.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'twin_fates',
  },
  {
    id: 'S020', name: 'Inferno', type: 'sorcery', cost: 6,
    keywords: [kw('Wild', 1)],
    text: 'Wild. Deal 4d6 split randomly among all enemies (creatures and hero).',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'inferno',
  },
  {
    id: 'S021', name: 'Divine Wrath', type: 'sorcery', cost: 6,
    keywords: [],
    text: 'Deal 2d8 to target enemy creature and 2d8 to the enemy hero.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'divine_wrath',
  },
  {
    id: 'S022', name: 'Reinforcements', type: 'sorcery', cost: 6,
    keywords: [], text: 'Roll d6: summon that many 1/1 Recruit tokens.',
    rarity: 'rare', weight: 2, maxPerDeck: 2, art: 'reinforcements',
  },
  {
    id: 'S023', name: 'Cataclysm', type: 'sorcery', cost: 7,
    keywords: [],
    text: 'Deal 3d8 to all enemy creatures and 2d6 to the enemy hero.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'cataclysm',
  },
  {
    id: 'S024', name: 'Wheel of Fortune', type: 'sorcery', cost: 7,
    keywords: [kw('Gamble', 1)],
    text: 'Gamble. Both players discard their hands; roll d6, each draws that many. Then roll again: on 5–6 you draw 1 extra.',
    rarity: 'legendary', weight: 1, maxPerDeck: 1, art: 'wheel_of_fortune',
  },
];

// 1/1 token summoned by Reinforcements (S022). weight/maxPerDeck 0 excludes it from dealDeck.
export const RECRUIT_TOKEN = {
  id: 'TOKEN_RECRUIT', name: 'Recruit', type: 'creature', cost: 0, atk: '1d4', hp: 1,
  keywords: [], text: '1/1 creature token.',
  rarity: 'common', weight: 0, maxPerDeck: 0, art: 'recruit',
};
