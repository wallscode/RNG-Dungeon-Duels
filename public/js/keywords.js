// keywords.js — KEYWORD_TEXT tooltip copy + tier lists. Pure data.

export const KEYWORD_TEXT = {
  // Tier 1 — shown in the always-visible legend strip
  'Summon roll': 'Roll the dice shown when this creature enters play; the result sets a stat.',
  'Guardian': 'Enemies must attack this creature unless an effect lets them bypass it.',
  'Defender': 'A creature built to absorb hits; its effect triggers when it is attacked.',
  'Minimum roll': 'When rolling this creature’s damage, treat any die showing 1 as the listed value.',
  'Gamble': 'This card’s main effect can pay off big or backfire, decided by a roll.',
  'Wild': 'This card’s target or magnitude is random rather than chosen by you.',

  // Tier 2 — spelled out in rules text
  'Frenzy': 'After attacking, roll d6: on 5–6 this creature attacks once more this turn for the same damage as its first hit.',
  'Lucky': 'Once per turn, reroll this creature’s damage roll for free.',
  'Brittle': 'When this takes damage, roll d6: on 1 it takes 1 extra damage.',
  'Rally': 'On enter, roll d6: on 4+ another friendly creature’s ATK die steps up one size this turn (d4→d6→d8→d10→d12).',
  'Regenerate': 'At the start of your turn, roll d6: on 4+ this creature gains 2 HP.',
  'Volatile': 'When this dies, roll d6: on 5–6 deal that much to a random enemy.',
  'Rush': 'This creature can attack the turn it is played (no summoning sickness).',
};

export const TIER1_KEYWORDS = [
  'Summon roll',
  'Guardian',
  'Defender',
  'Minimum roll',
  'Gamble',
  'Wild',
];

export const TIER2_KEYWORDS = [
  'Frenzy',
  'Lucky',
  'Brittle',
  'Rally',
  'Regenerate',
  'Volatile',
  'Rush',
];
