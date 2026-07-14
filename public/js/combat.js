// combat.js — resolveCombat(): damage roll, crit, Minimum roll, Defender,
// Brittle, post-hit triggers, retaliation, Frenzy, Chaos Beast redirect.
// Combat is auto-hit; all randomness is in the damage roll.

import { parseNotation } from './dice.js';

function hasKeyword(creature, name) {
  return creature.keywords?.some((k) => k.name === name) || false;
}

function keywordValue(creature, name, fallback) {
  const k = creature.keywords?.find((k2) => k2.name === name);
  return k && k.value !== undefined ? k.value : fallback;
}

function minFloorTotal(rolls, floor) {
  return rolls.reduce((sum, r) => sum + Math.max(r, floor), 0);
}

// Brittle then Defender, then subtract HP. Used for the primary hit and retaliation.
async function resolveDamageToCreature(game, target, targetSide, damage, sourceName) {
  // Brittle: on a 1, take 1 extra.
  if (hasKeyword(target, 'Brittle') && damage > 0) {
    const roll = await game.roll(targetSide, {
      notation: '1d6', label: `${target.name} — Brittle check`,
      context: 'On 1: takes 1 extra damage', allowReroll: false,
    });
    if (roll.total === 1) {
      damage += 1;
      game.log(`${target.name} is Brittle — takes 1 extra!`);
    }
  }

  // Defender: per-card d6 damage reduction.
  if (hasKeyword(target, 'Defender') && damage > 0) {
    damage = await applyDefenderReduction(game, target, targetSide, damage);
  }

  target.currentHp -= damage;
  game.log(`${sourceName} hits ${target.name} for ${damage}.`);
  return damage;
}

// Per-card Defender triggers: Shield Dwarf 4+ takes 2 less; Temple Guard 4+
// takes half (round up); Dwarven Defender 3+ takes 2 less.
async function applyDefenderReduction(game, target, targetSide, damage) {
  const specs = {
    C003: { threshold: 4, apply: (d) => Math.max(0, d - 2), text: '4+: takes 2 less' },
    C018: { threshold: 4, apply: (d) => Math.ceil(d / 2), text: '4+: takes half (round up)' },
    C024: { threshold: 3, apply: (d) => Math.max(0, d - 2), text: '3+: takes 2 less' },
  };
  const spec = specs[target.id];
  if (!spec) return damage;
  const roll = await game.roll(targetSide, {
    notation: '1d6', label: `${target.name} — Defender!`,
    context: spec.text, allowReroll: false,
  });
  if (roll.total >= spec.threshold) {
    const reduced = spec.apply(damage);
    game.log(`${target.name} braces — damage ${damage} → ${reduced}.`);
    return reduced;
  }
  return damage;
}

// ── resolveCombat ────────────────────────────────────────────────────────────
//
// opts:
//   attackerSide     'player' | 'opponent'
//   attacker         creature instance
//   target           creature instance or 'hero'
//   preRolledDamage  Frenzy second hit — reuse first hit's damage, no roll/crit
//   isRetaliation    suppresses temp bonuses, Frenzy, post-hit triggers chaining
//   isFrenzyHit      second Frenzy swing — no Frenzy chain

export async function resolveCombat(game, opts) {
  const {
    attackerSide, attacker, preRolledDamage = null,
    isRetaliation = false, isFrenzyHit = false,
  } = opts;
  let { target } = opts;
  const state = game.state;
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player';

  // Chaos Beast: pre-attack chaos roll — on 1, redirect to a uniformly random target.
  if (attacker.id === 'C032' && !isRetaliation && !isFrenzyHit && preRolledDamage === null) {
    const chaosRoll = await game.roll(attackerSide, {
      notation: '1d6', label: `${attacker.name} — chaos surge!`,
      context: 'On 1: attacks a random target instead', bestThreshold: 2,
    });
    if (chaosRoll.total === 1) {
      const pool = [
        ...state[defenderSide].board.filter((c) => c.currentHp > 0),
        ...state[attackerSide].board.filter((c) => c.currentHp > 0 && c.instanceId !== attacker.instanceId),
        'hero',
      ];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === 'hero') {
        // Pure chaos: either hero can catch the redirected blow.
        const heroSide = Math.random() < 0.5 ? defenderSide : attackerSide;
        target = 'hero';
        opts = { ...opts, heroSide };
        game.log(`${attacker.name} goes berserk — it attacks ${game.sideName(heroSide)}’s hero!`);
        return resolveRedirected(game, { ...opts, target: 'hero', heroSide, attacker, attackerSide });
      }
      game.log(`${attacker.name} goes berserk — it attacks ${pick.name} instead!`);
      const pickSide = state[defenderSide].board.includes(pick) ? defenderSide : attackerSide;
      return resolveRedirected(game, { ...opts, target: pick, targetSide: pickSide, attacker, attackerSide });
    }
  }

  return resolveSwing(game, {
    ...opts,
    target,
    targetSide: target === 'hero' ? defenderSide : (opts.targetSide || defenderSide),
    heroSide: opts.heroSide || defenderSide,
  });
}

// A chaos-redirected attack skips the chaos roll but otherwise resolves normally.
function resolveRedirected(game, opts) {
  return resolveSwing(game, {
    ...opts,
    targetSide: opts.targetSide || opts.heroSide,
  });
}

async function resolveSwing(game, opts) {
  const {
    attackerSide, attacker, target, targetSide, heroSide,
    preRolledDamage = null, isRetaliation = false, isFrenzyHit = false,
  } = opts;
  const state = game.state;

  // 1. Damage notation + Minimum roll floor.
  const notation = attacker.currentAtk || attacker.atk;
  const minFloor = hasKeyword(attacker, 'Minimum roll') ? keywordValue(attacker, 'Minimum roll', 2) : 1;

  let damage;
  let isCrit = false;

  if (preRolledDamage !== null) {
    damage = preRolledDamage; // Frenzy second hit: no roll, no crit
  } else {
    const p = parseNotation(notation);
    const targetName = target === 'hero' ? `${game.sideName(heroSide)}’s hero` : target.name;

    // 2–3. Roll damage. Lucky offers a free reroll before the Focus prompt.
    const luckyAvailable = hasKeyword(attacker, 'Lucky') && !attacker.usedLuckyThisTurn && !isRetaliation;
    const roll = await game.roll(attackerSide, {
      notation,
      label: isRetaliation ? `${attacker.name} retaliates!` : `${attacker.name} attacks!`,
      context: `vs ${targetName}`,
      allowReroll: !isRetaliation,
      lucky: luckyAvailable ? attacker : null,
    });

    if (!p) {
      damage = roll.total; // flat ATK ("3", Sheep, post-summon-roll Gnoll)
    } else {
      // 4. Crit = every die max. Min-roll floor applies, then crit doubles.
      isCrit = roll.isCrit;
      damage = minFloorTotal(roll.rolls, minFloor);
      if (isCrit) {
        damage *= 2;
        game.critFanfare(attackerSide, `${attacker.name} CRITICAL HIT!`);
      }
    }

    // 5–6. Temp bonuses/maluses (attacks only, consumed on use).
    if (!isRetaliation) {
      if (attacker.tempDamageBonus > 0) {
        damage += attacker.tempDamageBonus;
        game.log(`${attacker.name} strikes ${attacker.tempDamageBonus} harder!`);
        attacker.tempDamageBonus = 0;
      }
      if (attacker.tempDamageMalus > 0) {
        damage = Math.max(1, damage - attacker.tempDamageMalus);
        attacker.tempDamageMalus = 0;
      }
      if (attacker.noAttackThisTurn) {
        damage = 0;
        game.log(`${attacker.name} flails in disarray — no damage!`);
      }
    }
  }

  // 7–8. Deal the damage.
  if (target === 'hero') {
    game.dealToHero(heroSide, damage, {
      source: attacker.name,
      countsForScore: attackerSide === 'player' && heroSide !== 'player',
    });
    game.log(`${attacker.name} hits ${game.sideName(heroSide)}’s hero for ${damage}.`);
  } else {
    damage = await resolveDamageToCreature(game, target, targetSide, damage, attacker.name);
    if (attackerSide === 'player' && targetSide === 'opponent') {
      state.score.damageDealt += damage;
    }
  }

  if (game.checkGameOver()) return damage;

  // 9. Post-hit triggers (attack swings only).
  if (!isRetaliation && preRolledDamage === null) {
    await runPostHitTriggers(game, { attackerSide, attacker, target, targetSide, isCrit, damage });
    if (game.checkGameOver()) return damage;
  }

  // 10. Retaliation: a surviving creature target strikes back. Never chains.
  if (target !== 'hero' && !isRetaliation && target.currentHp > 0 && attacker.currentHp > 0) {
    await resolveSwing(game, {
      attackerSide: targetSide,
      attacker: target,
      target: attacker,
      targetSide: attackerSide,
      heroSide: attackerSide,
      isRetaliation: true,
    });
    if (game.checkGameOver()) return damage;
  }

  // Frenzy: once per turn, on 5–6 swing again for the same damage.
  if (!isRetaliation && !isFrenzyHit && attacker.currentHp > 0
      && hasKeyword(attacker, 'Frenzy') && !attacker.frenzyTriggeredThisTurn) {
    await tryFrenzy(game, { attackerSide, attacker, originalTarget: target, targetSide, damage });
  }

  return damage;
}

async function runPostHitTriggers(game, { attackerSide, attacker, target, targetSide, isCrit, damage }) {
  const state = game.state;
  const enemySide = attackerSide === 'player' ? 'opponent' : 'player';

  // Shadow Assassin: on crit, draw a card (queued to the pending-draw carryover).
  if (attacker.id === 'C022' && isCrit) {
    state[attackerSide]._pendingDraw += 1;
    game.log(`${attacker.name} melts into shadow — bonus card queued!`);
  }

  // Frost Elemental: on creature hit, 5–6 freezes the target next turn.
  if (attacker.id === 'C029' && target !== 'hero' && target.currentHp > 0) {
    const roll = await game.roll(attackerSide, {
      notation: '1d6', label: `${attacker.name} — freeze check`,
      context: `5–6: ${target.name} can’t attack next turn`, bestThreshold: 5,
    });
    if (roll.total >= 5) {
      game.queueFreeze(targetSide, target, attacker.name);
      game.log(`${target.name} is frosted over!`);
    }
  }

  // Vampire Lord: on damage dealt, 4+ heals attacker's hero by the rolled amount.
  if (attacker.id === 'C031' && damage > 0) {
    const roll = await game.roll(attackerSide, {
      notation: '1d6', label: `${attacker.name} — blood drain`,
      context: '4+: heal your hero that much', bestThreshold: 6,
    });
    if (roll.total >= 4) {
      game.healHero(attackerSide, roll.total, attacker.name);
    }
  }

  // Storm Caller: on attack, 5–6 rolls 1d4 bonus damage to the enemy hero.
  if (attacker.id === 'C025') {
    const roll = await game.roll(attackerSide, {
      notation: '1d6', label: `${attacker.name} — storm check`,
      context: '5–6: 1d4 to the enemy hero', bestThreshold: 5,
    });
    if (roll.total >= 5) {
      const bolt = await game.roll(attackerSide, {
        notation: '1d4', label: `${attacker.name} — lightning!`,
        context: 'Bonus damage to enemy hero',
      });
      game.dealToHero(enemySide, bolt.total, {
        source: attacker.name, countsForScore: attackerSide === 'player',
      });
      game.log(`${attacker.name} calls lightning for ${bolt.total}!`);
    }
  }

  // Ghoul Pack: on attack, 5–6 deals 2 to the enemy hero.
  if (attacker.id === 'C027') {
    const roll = await game.roll(attackerSide, {
      notation: '1d6', label: `${attacker.name} — hunger check`,
      context: '5–6: 2 damage to the enemy hero', bestThreshold: 5,
    });
    if (roll.total >= 5) {
      game.dealToHero(enemySide, 2, {
        source: attacker.name, countsForScore: attackerSide === 'player',
      });
      game.log(`${attacker.name} swarms the enemy hero for 2!`);
    }
  }
}

// Frenzy second hit: fresh Guardian intercepts (unless the original target was
// that Guardian); else the original target if still alive; else the enemy hero.
async function tryFrenzy(game, { attackerSide, attacker, originalTarget, targetSide, damage }) {
  const state = game.state;
  const enemySide = attackerSide === 'player' ? 'opponent' : 'player';

  const roll = await game.roll(attackerSide, {
    notation: '1d6', label: `${attacker.name} — Frenzy!`,
    context: '5–6: attacks again for the same damage', bestThreshold: 5,
  });
  if (roll.total < 5) return;

  attacker.frenzyTriggeredThisTurn = true;

  const guardians = state[enemySide].board.filter(
    (c) => c.currentHp > 0 && hasKeyword(c, 'Guardian'),
  );
  let second = null;
  let secondSide = enemySide;
  const fresh = guardians.find((g) => g !== originalTarget);
  if (fresh) {
    second = fresh;
  } else if (originalTarget !== 'hero' && originalTarget.currentHp > 0) {
    second = originalTarget;
    secondSide = targetSide;
  } else {
    second = 'hero';
  }

  game.log(`${attacker.name} frenzies — it attacks again!`);
  await resolveCombat(game, {
    attackerSide, attacker,
    target: second, targetSide: secondSide,
    preRolledDamage: damage,
    isFrenzyHit: true,
  });
}
