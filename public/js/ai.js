// ai.js — AI opponent: three personality vectors, greedy EV card scoring,
// combat target selection. Stateless between turns.

import { parseNotation } from './dice.js';

export const PERSONALITIES = {
  Berserker: { aggression: 1.4, gambleBoldness: 1.2, focusThreshold: 1.5, facePriority: 2.2, noise: 0 },
  Tactician: { aggression: 0.9, gambleBoldness: 0.7, focusThreshold: 2.5, facePriority: 0.55, noise: 0 },
  Gambler:   { aggression: 1.1, gambleBoldness: 1.8, focusThreshold: 1.0, facePriority: 1.0, noise: 0.35 },
};

const PAUSE_BETWEEN_PLAYS_MS = 1600;
const PAUSE_BETWEEN_ATTACKS_MS = 1800;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function expectedDamage(notation) {
  if (notation === 'summon') return 3.5; // pre-roll Feral Gnoll
  const p = parseNotation(notation);
  if (!p) return Number(notation) || 0;
  return p.count * (p.sides + 1) / 2;
}

function hasKeyword(creature, name) {
  return creature.keywords?.some((k) => k.name === name) || false;
}

export class AI {
  constructor(personalityName) {
    this.name = personalityName;
    this.p = PERSONALITIES[personalityName];
  }

  async takeTurn(game) {
    await this._playPhase(game);
    if (game.state.phase === 'game-over') return;
    await this._combatPhase(game);
  }

  async _playPhase(game) {
    const state = game.state;
    for (;;) {
      if (state.phase === 'game-over') return;
      const me = state.opponent;
      const playable = me.hand.filter((c) => c.cost <= me.mana);
      if (playable.length === 0) return;

      let best = null;
      let bestScore = 0;
      for (const card of playable) {
        const score = this.scoreCard(card, state);
        if (score > bestScore) { best = card; bestScore = score; }
      }
      if (!best || bestScore <= 0) return;

      await game.aiPlayCard(best);
      await sleep(PAUSE_BETWEEN_PLAYS_MS);
    }
  }

  async _combatPhase(game) {
    const state = game.state;
    // Snapshot attacker IDs — the board can shrink mid-loop from retaliation deaths.
    const attackerIds = state.opponent.board
      .filter((c) => c.currentHp > 0 && !c.summoningSick && !c.cantAttackThisTurn && !c.hasAttackedThisTurn)
      .map((c) => c.instanceId);

    for (const id of attackerIds) {
      if (state.phase === 'game-over') return;
      const attacker = state.opponent.board.find((c) => c.instanceId === id);
      if (!attacker || attacker.currentHp <= 0 || attacker.hasAttackedThisTurn
          || attacker.cantAttackThisTurn || attacker.summoningSick) continue;
      const target = this._pickTarget(attacker, state);
      await game.aiAttack(attacker, target);
      await sleep(PAUSE_BETWEEN_ATTACKS_MS);
    }
  }

  // ── Card scoring ───────────────────────────────────────────────────────────

  scoreCard(card, state) {
    if (card.type === 'creature') {
      if (state.opponent.board.filter((c) => c.currentHp > 0).length >= 6) return 0;
      const ev = expectedDamage(card.atk);
      const survivalScore = card.hp / (card.hp + 3);
      let score = ev * survivalScore * this.p.aggression * (1 + Math.random() * this.p.noise);
      // Personality flavour: Berserker rushes out cheap threats; Tactician
      // values keyword toolbox creatures.
      if (this.name === 'Berserker') score *= 1 + Math.max(0, 7 - card.cost) * 0.06;
      if (this.name === 'Tactician') score *= 1 + card.keywords.length * 0.18;
      return score;
    }
    let score = this._scoreSorcery(card, state) ?? 1.0;
    if (this.p.noise > 0) score *= 1 + (Math.random() - 0.5) * this.p.noise;
    return score;
  }

  // Cards whose effect would be a no-op (or a guaranteed fizzle) score 0 so
  // the AI never wastes them — e.g. Hex with no enemy creatures on the field.
  _scoreSorcery(card, state) {
    const { aggression, gambleBoldness } = this.p;
    const me = state.opponent;
    const enemyBoard = state.player.board.filter((c) => c.currentHp > 0);
    const myBoard = me.board.filter((c) => c.currentHp > 0);

    switch (card.id) {
      case 'S001': return 1.5 * aggression;
      case 'S002': return me.focus >= 5 ? 0 : me.focus < 4 ? 2.0 : 0.5;
      case 'S003': return 1.2 * (gambleBoldness > 1 ? 1.3 : 1.0);
      case 'S004': return enemyBoard.length > 0 ? 1.5 : 0;
      case 'S005': return 2.0 * aggression;
      case 'S006': return me.hp >= 25 ? 0 : me.hp < 15 ? 2.5 : 0.8;
      case 'S007': return me.hand.length < 4 ? 2.0 : 0.5;
      case 'S008': return myBoard.length > 0 ? 1.5 * aggression : 0;
      case 'S009': return enemyBoard.length >= 2 ? 2.5 * aggression
        : enemyBoard.length === 1 ? 0.5 : 0;
      case 'S010': return myBoard.length > 0 ? gambleBoldness * 2 : 0;
      case 'S011': return myBoard.length > 1 ? 2.0 : myBoard.length === 1 ? 0.5 : 0;
      case 'S012': return 1.5;
      case 'S013': return 2.5 * aggression;
      case 'S014': return enemyBoard.length > 1 ? 2.5 * aggression
        : enemyBoard.length === 1 ? 0.8 : 0;
      case 'S015': return enemyBoard.length > 0 ? gambleBoldness * 1.5 : 0;
      case 'S016': return me.hp >= 25 ? 0.8 : me.hp < 15 ? 3.0 : 1.0; // still draws
      case 'S017': return 3.0 * aggression;
      case 'S018': return enemyBoard.length + myBoard.length > 0 ? gambleBoldness * 1.5 : 0;
      case 'S019': return gambleBoldness * 3.0;
      case 'S020': return enemyBoard.length >= 2 ? 4.0 * aggression : 1.5;
      case 'S021': return 3.5 * aggression;
      case 'S022': return myBoard.length >= 6 ? 0 : myBoard.length < 4 ? 2.0 : 0.5;
      case 'S023': return 4.0 * aggression;
      case 'S024': return gambleBoldness * 2.5;
      default: return null;
    }
  }

  // ── Combat target selection ────────────────────────────────────────────────

  _pickTarget(attacker, state) {
    const enemyBoard = state.player.board.filter((c) => c.currentHp > 0);

    // Guardian enforcement overrides everything else.
    const guardian = enemyBoard.find((c) => hasKeyword(c, 'Guardian'));
    if (guardian) return guardian;

    const ev = expectedDamage(attacker.currentAtk || attacker.atk);
    const options = [];

    // Hero option.
    const lethality = state.player.hp <= ev * 1.5 ? 2.0 : 1.0;
    options.push({ target: 'hero', score: ev * this.p.facePriority * lethality });

    // Creature trades. The Tactician prizes clean kills far more highly.
    const killWeight = this.name === 'Tactician' ? 0.55 : 0.3;
    for (const c of enemyBoard) {
      const retaliation = expectedDamage(c.currentAtk || c.atk);
      const tradePenalty = this.p.aggression < 1 ? 1.2 : 0.7;
      const tradeValue = ev - retaliation * tradePenalty;
      const killBonus = c.currentHp <= ev ? c.currentHp * killWeight : 0;
      options.push({ target: c, score: tradeValue + killBonus });
    }

    options.sort((a, b) => b.score - a.score);

    // Gambler wildcard: sometimes pick a random target from the top 3.
    if (this.p.noise > 0 && Math.random() < this.p.noise) {
      const top = options.slice(0, 3);
      return top[Math.floor(Math.random() * top.length)].target;
    }
    return options[0].target;
  }

  // ── Sorcery target helpers (called by sorcery handlers when caster is AI) ──

  pickAnyTarget(state) {
    const enemyBoard = state.player.board.filter((c) => c.currentHp > 0);
    if (enemyBoard.length === 0) return 'hero';
    return enemyBoard.reduce((a, b) => (b.currentHp > a.currentHp ? b : a));
  }

  pickFriendlyCreature(state) {
    const board = state.opponent.board.filter((c) => c.currentHp > 0);
    if (board.length === 0) return null;
    return board.reduce((a, b) => (
      expectedDamage(b.currentAtk || b.atk) > expectedDamage(a.currentAtk || a.atk) ? b : a
    ));
  }

  pickEnemyCreature(state) {
    const board = state.player.board.filter((c) => c.currentHp > 0);
    if (board.length === 0) return null;
    return board.reduce((a, b) => (
      expectedDamage(b.currentAtk || b.atk) > expectedDamage(a.currentAtk || a.atk) ? b : a
    ));
  }

  // Focus-reroll decision for damage rolls (wired via Game.roll). Each
  // personality spends Focus very differently — the most visible tell:
  //   Berserker — rerolls anything under ~2/3 of max the moment it can
  //   Tactician — hoards Focus; only rerolls truly awful rolls with 2+ banked
  //   Gambler   — rerolls almost any non-great roll on a whim
  shouldReroll(rollTotal, maxPossible, focus) {
    if (focus < 1 || maxPossible <= 0) return false;
    const quality = rollTotal / maxPossible;
    if (this.name === 'Tactician') return focus >= 2 && quality < 0.35;
    if (this.name === 'Gambler') return quality < 0.9 && Math.random() < 1 / this.p.focusThreshold;
    return quality < 1 / this.p.focusThreshold; // Berserker: < 0.67
  }
}
