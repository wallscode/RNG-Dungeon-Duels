// effects.js — On-enter / start-of-turn creature effects, the pending-effects
// queue (mana_loss, cant_attack), and die-step helpers.

// ── Die-step helpers ─────────────────────────────────────────────────────────

const DIE_STEPS = [4, 6, 8, 10, 12];

export function stepDieUp(notation) {
  const m = /^(\d+)d(\d+)$/.exec(String(notation));
  if (!m) return notation; // flat / 'summon' — nothing to step
  const sides = Number(m[2]);
  const idx = DIE_STEPS.indexOf(sides);
  if (idx === -1 || idx === DIE_STEPS.length - 1) return notation;
  return `${m[1]}d${DIE_STEPS[idx + 1]}`;
}

// ── Pending-effects queue ────────────────────────────────────────────────────
// Effects queued by sorceries/creatures that fire on a later _startTurn.

let pendingEffects = [];

export function queuePendingEffect(effect) {
  // { type: 'mana_loss', side, amount } | { type: 'cant_attack', side, instanceId, sourceName }
  pendingEffects.push(effect);
}

export function clearPendingEffects() {
  pendingEffects = [];
}

// Applies (and removes) all effects queued against `who`. Runs after mana ramp.
export function tickPendingEffects(who, state, game) {
  const mine = pendingEffects.filter((e) => e.side === who);
  pendingEffects = pendingEffects.filter((e) => e.side !== who);
  for (const e of mine) {
    if (e.type === 'mana_loss') {
      const hero = state[who];
      const before = hero.mana;
      hero.mana = Math.max(0, hero.mana - e.amount);
      game.log(`${game.sideName(who)} loses ${before - hero.mana} mana (Sap Strength).`);
    } else if (e.type === 'cant_attack') {
      const creature = state[who].board.find((c) => c.instanceId === e.instanceId);
      if (creature && creature.currentHp > 0) {
        creature.cantAttackThisTurn = true;
        game.log(`${creature.name} is frozen and can’t attack this turn (${e.sourceName}).`);
      }
    }
  }
}

// ── On-enter effects ─────────────────────────────────────────────────────────
// Runs after a creature instance lands on the board. May roll dice.

export async function applyOnEnterEffects(game, creature, owner) {
  const state = game.state;
  const enemy = owner === 'player' ? 'opponent' : 'player';
  const enemyBoard = () => state[enemy].board.filter((c) => c.currentHp > 0);

  // Summon roll — Feral Gnoll: ATK becomes the d6 result for the rest of the game.
  if (creature.id === 'C002') {
    const roll = await game.roll(owner, {
      notation: '1d6', label: `${creature.name} — Summon roll!`,
      context: 'ATK becomes the result', bestThreshold: 6,
    });
    creature.atk = String(roll.total);
    creature.currentAtk = String(roll.total);
    creature.baseAtk = String(roll.total);
    game.log(`${creature.name} sets its ATK to ${roll.total}.`);
  }

  // Torch Goblin: on 5–6, 1 damage to the enemy hero.
  if (creature.id === 'C008') {
    const roll = await game.roll(owner, {
      notation: '1d6', label: `${creature.name} hurls its torch!`,
      context: '5–6: 1 damage to enemy hero', bestThreshold: 5,
    });
    if (roll.total >= 5) {
      game.dealToHero(enemy, 1, { source: creature.name});
      game.log(`${creature.name} singes the enemy hero for 1!`);
    }
  }

  // Flame Adept: d6 damage split floor-evenly among enemy creatures.
  if (creature.id === 'C017') {
    const targets = enemyBoard();
    if (targets.length > 0) {
      const roll = await game.roll(owner, {
        notation: '1d6', label: `${creature.name} — flame burst!`,
        context: 'Split among enemy creatures', bestThreshold: 6,
      });
      const each = Math.floor(roll.total / targets.length);
      if (each > 0) {
        for (const t of targets) {
          game.dealToCreature(t, enemy, each, { source: creature.name});
        }
        game.log(`${creature.name} burns each enemy creature for ${each}.`);
      } else {
        game.log(`${creature.name}’s flames scatter harmlessly.`);
      }
    }
  }

  // Pyromancer: 1d6 to a random enemy creature.
  if (creature.id === 'C023') {
    const targets = enemyBoard();
    if (targets.length > 0) {
      const t = targets[Math.floor(Math.random() * targets.length)];
      const roll = await game.roll(owner, {
        notation: '1d6', label: `${creature.name} — fire blast!`, context: `vs ${t.name}`,
      });
      game.dealToCreature(t, enemy, roll.total, { source: creature.name});
      game.log(`${creature.name} blasts ${t.name} for ${roll.total}.`);
    }
  }

  // Stone Colossus: gain d6 HP; permanently raises its own HP cap.
  if (creature.id === 'C034') {
    const roll = await game.roll(owner, {
      notation: '1d6', label: `${creature.name} — stone surge!`,
      context: 'Gains that much HP', bestThreshold: 6,
    });
    creature.hp += roll.total;
    creature.currentHp += roll.total;
    game.log(`${creature.name} gains ${roll.total} HP.`);
  }

  // Ancient Dragon: breath weapon — 2d6 split floor-evenly among enemy
  // creatures; if none, the full 2d6 hits the enemy hero.
  if (creature.id === 'C036') {
    const targets = enemyBoard();
    const roll = await game.roll(owner, {
      notation: '2d6', label: `${creature.name} — breath weapon!`,
      context: targets.length ? 'Split among enemy creatures' : 'Hits the enemy hero',
    });
    if (targets.length > 0) {
      const each = Math.floor(roll.total / targets.length);
      if (each > 0) {
        for (const t of targets) {
          game.dealToCreature(t, enemy, each, { source: creature.name});
        }
        game.log(`${creature.name}’s breath sears each enemy creature for ${each}.`);
      }
    } else {
      game.dealToHero(enemy, roll.total, { source: creature.name});
      game.log(`${creature.name}’s breath scorches the enemy hero for ${roll.total}!`);
    }
  }

  // Rally — Pack Wolf, Warband Captain: on 4+, another friendly creature's
  // ATK die steps up one size this turn.
  if (creature.keywords.some((k) => k.name === 'Rally')) {
    const others = state[owner].board.filter(
      (c) => c.instanceId !== creature.instanceId && c.currentHp > 0,
    );
    if (others.length > 0) {
      const roll = await game.roll(owner, {
        notation: '1d6', label: `${creature.name} — Rally!`,
        context: '4+: a friendly creature’s ATK die steps up', bestThreshold: 4,
      });
      if (roll.total >= 4) {
        const buddy = others[Math.floor(Math.random() * others.length)];
        const before = buddy.currentAtk || buddy.atk;
        const after = stepDieUp(before);
        if (after !== before) {
          buddy._preRallyAtk = before;
          buddy.currentAtk = after;
          buddy.rallyBuffThisTurn = true;
          game.log(`${creature.name} rallies ${buddy.name}: ${before} → ${after} this turn.`);
        }
      } else {
        game.log(`${creature.name}’s rally falls flat.`);
      }
    }
  }
}

// ── Start-of-turn effects ────────────────────────────────────────────────────
// Regenerate, Acolyte of Luck Focus tick, and clearing last turn's rally buffs.

export async function applyStartOfTurnEffects(who, state, game) {
  for (const creature of [...state[who].board]) {
    if (creature.currentHp <= 0) continue;

    // Clear rally buffs granted on this player's previous turn.
    if (creature.rallyBuffThisTurn && creature._preRallyAtk) {
      creature.currentAtk = creature._preRallyAtk;
      delete creature._preRallyAtk;
      creature.rallyBuffThisTurn = false;
    }

    // Regenerate: on 4+ gain 2 HP (heals over nominal cap — no clamp).
    if (creature.keywords.some((k) => k.name === 'Regenerate')) {
      const roll = await game.roll(who, {
        notation: '1d6', label: `${creature.name} — Regenerate`,
        context: '4+: gains 2 HP', bestThreshold: 4,
      });
      if (roll.total >= 4) {
        creature.currentHp += 2;
        game.log(`${creature.name} regenerates 2 HP.`);
      }
    }

    // Acolyte of Luck: player-only Focus tick on 5–6.
    if (creature.id === 'C013' && who === 'player') {
      const roll = await game.roll(who, {
        notation: '1d6', label: `${creature.name} — lucky prayer`,
        context: '5–6: gain 1 Focus', bestThreshold: 5,
      });
      if (roll.total >= 5) {
        state.player.focus = Math.min(5, state.player.focus + 1);
        game.log(`${creature.name} grants you 1 Focus.`);
      }
    }
  }
}
