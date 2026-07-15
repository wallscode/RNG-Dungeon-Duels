// game.js — Top-level Game controller: turn loop, player input, sorcery
// dispatch table, scoring. Coordinates all other modules.

import { CARDS, RECRUIT_TOKEN } from './cards.js';
import { dealDeck } from './deckbuilder.js';
import { rollDice, rollFirstPlayer, rollPersonality, parseNotation } from './dice.js';
import { resolveCombat } from './combat.js';
import {
  applyOnEnterEffects, applyStartOfTurnEffects,
  queuePendingEffect, tickPendingEffects, clearPendingEffects,
} from './effects.js';
import { AI } from './ai.js';
import {
  initAudio, playSound, setAmbientMood, startAmbient, stopAmbient,
  setAllSound, setAmbientEnabled, setSfxEnabled, isSfxEnabled, isAmbientEnabled,
} from './audio.js';
import * as ui from './ui.js';

const HP_MAX = 25;
const MANA_CAP = 7;
const FOCUS_CAP = 5;
const BOARD_CAP = 6;
const HAND_CAP = 7;
const TARGET_TIMEOUT_MS = 15000;
const END_TURN_LOCK_MS = 2000;
const AI_HANG_MS = 120000;

const CANCELLED = Symbol('sorcery-cancelled');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let instanceCounter = 0;

function createCreatureInstance(cardDef) {
  const hasRush = cardDef.keywords.some((k) => k.name === 'Rush');
  instanceCounter += 1;
  return {
    ...cardDef,
    keywords: cardDef.keywords.map((k) => ({ ...k })),
    instanceId: `${cardDef.id}_${instanceCounter}`,
    currentHp: cardDef.hp,
    currentAtk: cardDef.atk,
    tempDamageBonus: 0,
    tempDamageMalus: 0,
    summoningSick: !hasRush,
    cantAttackThisTurn: false,
    usedLuckyThisTurn: false,
    frenzyTriggeredThisTurn: false,
    hasAttackedThisTurn: false,
    rallyBuffThisTurn: false,
    noAttackThisTurn: false,
  };
}

const TURN_FLAVOR = {
  Berserker: [
    'The Berserker snarls — it wants your blood.',
    'The Berserker charges in headlong.',
    'The Berserker ignores your creatures. It’s coming for YOU.',
  ],
  Tactician: [
    'The Tactician studies the board coldly.',
    'The Tactician calculates the perfect trade.',
    'The Tactician is playing the long game.',
  ],
  Gambler: [
    'The Gambler grins and shakes the dice.',
    'The Gambler bets it all on this turn.',
    'The Gambler laughs — luck is a strategy.',
  ],
};

const PERSONALITY_COPY = {
  Berserker: {
    emoji: '⚔️',
    tell: 'Bring the fight to your face.',
    summary: 'Rushes you down with cheap, hard-hitting cards. Ignores creature trades — it wants your HP, not your creatures.',
    tip: 'Tip: get a Guardian or high-HP blocker down early. Slow it before it overwhelms you.',
  },
  Tactician: {
    emoji: '🧠',
    tell: 'Trades you down to nothing.',
    summary: 'Methodical and patient. Plays keyword creatures, makes efficient trades, and wins by card advantage.',
    tip: 'Tip: go wide and aggressive. Don’t let it grind you out — end the game before it stabilises.',
  },
  Gambler: {
    emoji: '🎲',
    tell: 'Banks Focus for big swings.',
    summary: 'Unpredictable and chaotic. Hoards Focus to reroll, plays high-variance sorceries, and bets everything on big dice moments.',
    tip: 'Tip: stay healthy. Its big swings can backfire — outlast the chaos and punish the fumbles.',
  },
};

export class Game {
  constructor() {
    this.state = null;
    this.ai = null;
    this.selectedAttacker = null;
    this.endTurnLocked = false;
    this._targetRequest = null;
    this._handlersAttached = false;
    this._aiWatchdog = null;
    this._preloaded = false;
  }

  init() {
    instanceCounter = 0;
    clearPendingEffects();
    this.selectedAttacker = null;
    this.endTurnLocked = false;
    this._targetRequest = null;

    this.state = {
      player: {
        hp: HP_MAX, mana: 0, maxMana: 0, focus: 0,
        deck: [], hand: [], board: [], discard: [],
        fatigue: 0, _pendingDraw: 0,
      },
      opponent: {
        hp: HP_MAX, mana: 0, maxMana: 0, focus: 0,
        deck: [], hand: [], board: [], discard: [],
        fatigue: 0, _pendingDraw: 0,
        personality: null, personalityTell: '',
      },
      turnNumber: 0,
      _roundStarter: undefined,
      phase: 'setup',
      activePlayer: 'player',
      // Match stats for the game-over summary: damage to the opponent's
      // side counts as dealt, damage to the player's side as received.
      stats: { dealt: 0, taken: 0 },
      winner: null,
    };

    ui.buildBoard(document.getElementById('app'));
    if (!this._handlersAttached) {
      this._attachGlobalHandlers();
      this._handlersAttached = true;
    } else {
      // buildBoard recreated the DOM; per-element listeners rebind below.
    }
    this._bindBoardControls();
    this._preloadImages();
    ui.showIntro({ onBegin: () => this._begin() });
  }

  // ── Setup flow ─────────────────────────────────────────────────────────────

  async _begin() {
    initAudio(); // Begin Duel click is the bootstrap user gesture
    setAmbientMood('calm');
    startAmbient();

    const s = this.state;
    s.player.deck = dealDeck(CARDS);
    s.opponent.deck = dealDeck(CARDS);
    ui.render(this);

    const first = await rollFirstPlayer();
    this.log(first === 'player' ? 'You win the roll — you go first!' : 'Opponent wins the roll and goes first.');

    const personality = await rollPersonality();
    s.opponent.personality = personality;
    s.opponent.personalityTell = PERSONALITY_COPY[personality].tell;
    this.ai = new AI(personality);
    this.log(`Your opponent is the ${personality}.`);

    await ui.showPersonalityReveal(personality, PERSONALITY_COPY[personality]);

    // Opening hands: first player 5, second player 6.
    const second = first === 'player' ? 'opponent' : 'player';
    await this._drawCards(first, 5, { silent: true });
    await this._drawCards(second, 6, { silent: true });
    ui.render(this);

    await this._startTurn(first);
  }

  // ── Turn structure ─────────────────────────────────────────────────────────

  async _startTurn(who) {
    const s = this.state;
    if (s.phase === 'game-over') return;

    if (s._roundStarter === undefined) s._roundStarter = who;
    const isRoundStart = who === s._roundStarter;
    if (isRoundStart) s.turnNumber += 1;

    s.activePlayer = who;
    s.phase = who === 'player' ? 'player-turn' : 'ai-turn';

    setAmbientMood(s.turnNumber < 3 ? 'calm' : s.turnNumber < 5 ? 'tense' : 'collapse');

    if (isRoundStart && s.turnNumber >= 5) {
      await this._resolveCollapse();
      if (s.phase === 'game-over') return;
    }

    const hero = s[who];
    hero.maxMana = Math.min(MANA_CAP, hero.maxMana + 1);
    hero.mana = hero.maxMana;
    hero.focus = Math.min(FOCUS_CAP, hero.focus + 1);

    tickPendingEffects(who, s, this);

    for (const c of hero.board) c.summoningSick = false;

    await applyStartOfTurnEffects(who, s, this);
    if (s.phase === 'game-over') return;

    await this._drawCards(who, 1);
    while (hero._pendingDraw > 0) {
      hero._pendingDraw -= 1;
      await this._drawCards(who, 1);
    }
    if (s.phase === 'game-over') return; // fatigue can kill

    await this.sweepDead();

    if (who === 'player') {
      this.log('Your turn.');
      ui.banner('Your Turn', 'your-turn', 1000);
      this.endTurnLocked = true;
      setTimeout(() => { this.endTurnLocked = false; ui.render(this); }, END_TURN_LOCK_MS);
      ui.render(this);
    } else {
      const flavor = TURN_FLAVOR[s.opponent.personality];
      this.log(flavor[Math.floor(Math.random() * flavor.length)]);
      // Make the handoff unmistakable even when the AI has nothing to play:
      // banner + a minimum turn duration before control returns.
      ui.banner('Opponent’s Turn', 'opp-turn', 1400);
      await sleep(1500);
      this._aiWatchdog = setTimeout(() => {
        document.getElementById('recover-btn').hidden = false;
      }, AI_HANG_MS);
      try {
        await this.ai.takeTurn(this);
      } finally {
        clearTimeout(this._aiWatchdog);
        const btn = document.getElementById('recover-btn');
        if (btn) btn.hidden = true;
      }
      if (this.state.phase === 'game-over') return;
      this.log('Opponent ends its turn.');
      await sleep(700);
      this._endOfTurnCleanup('opponent');
      await this._startTurn('player');
    }
  }

  _endOfTurnCleanup(who) {
    for (const c of this.state[who].board) {
      c.hasAttackedThisTurn = false;
      c.usedLuckyThisTurn = false;
      c.frenzyTriggeredThisTurn = false;
      c.cantAttackThisTurn = false;
      c.noAttackThisTurn = false;
      c.tempDamageBonus = 0;
      c.tempDamageMalus = 0;
      c.canAttack = false;
    }
  }

  async _endPlayerTurn() {
    if (this.state.phase !== 'player-turn' || this.endTurnLocked) return;
    if (this._targetRequest) return; // finish or cancel targeting first
    this._clearAttackerSelection();
    this._endOfTurnCleanup('player');
    await this._startTurn('opponent');
  }

  // ── The Collapse ───────────────────────────────────────────────────────────

  async _resolveCollapse() {
    const s = this.state;
    const notation = s.turnNumber >= 9 ? '2d6' : '1d6';
    const roll = await rollDice({
      notation,
      label: '⚠ THE COLLAPSE ⚠',
      context: 'Damage to BOTH heroes',
      isCollapse: true,
      allowReroll: false,
    });
    playSound('collapse-rumble');
    ui.screenShake();
    ui.banner(`THE COLLAPSE — ${roll.total} to both!`, 'collapse', 1800);

    const playerBefore = s.player.hp;
    const oppBefore = s.opponent.hp;
    s.player.hp -= roll.total;
    s.opponent.hp -= roll.total;
    this.trackDamage('player', roll.total);
    this.trackDamage('opponent', roll.total);
    ui.floatHeroDamage('player', roll.total);
    ui.floatHeroDamage('opponent', roll.total);
    this.log(`The Collapse deals ${roll.total} to both heroes.`);
    ui.render(this);

    if (s.player.hp <= 0 && s.opponent.hp <= 0) {
      let winner;
      if (playerBefore > oppBefore) winner = 'player';
      else if (oppBefore > playerBefore) winner = 'opponent';
      else {
        const tie = await rollDice({
          notation: '1d20', label: 'Simultaneous death!', context: '11+: you survive',
          isCollapse: true, allowReroll: false,
        });
        winner = tie.total >= 11 ? 'player' : 'opponent';
      }
      this._endGame(winner);
    } else if (s.player.hp <= 0) {
      this._endGame('opponent');
    } else if (s.opponent.hp <= 0) {
      this._endGame('player');
    }
  }

  // ── Dice wrapper ───────────────────────────────────────────────────────────
  // Fills in AI/reroll wiring: AI rolls never prompt; player rolls offer Lucky
  // (opts.lucky = creature) then Focus rerolls. Handles crit presentation.

  async roll(who, opts) {
    const isAI = who === 'opponent';
    const luckyCreature = opts.lucky || null;
    let result = await rollDice({
      ...opts,
      isAI,
      reroll: isAI ? null : {
        luckyAvailable: !!luckyCreature,
        onLucky: () => { if (luckyCreature) luckyCreature.usedLuckyThisTurn = true; },
        getFocus: () => this.state.player.focus,
        spendFocus: () => {
          this.state.player.focus -= 1;
          this.log('You spend 1 Focus to reroll.');
          ui.render(this);
        },
      },
    });

    // AI Focus rerolls (damage rolls only — opts.aiRerollable). Each
    // personality's spending pattern is a deliberate, visible tell.
    if (isAI && opts.aiRerollable && this.ai && !result.isCrit
        && opts.allowReroll !== false && !opts.isCollapse) {
      const p = parseNotation(opts.notation);
      const maxPossible = p ? p.count * p.sides : 0;
      const hero = this.state.opponent;
      if (this.ai.shouldReroll(result.total, maxPossible, hero.focus)) {
        hero.focus -= 1;
        this.log(`The ${hero.personality} spends 1 Focus to reroll the ${result.total}!`);
        ui.render(this);
        result = await rollDice({ ...opts, isAI: true, reroll: null });
      }
    }
    return result;
  }

  critFanfare(side, message) {
    ui.banner(message, 'crit', 1400);
    ui.screenShake();
    ui.critBurst();
    if (side === 'player') playSound('crit-fanfare');
    this.log(message);
  }

  // ── Shared damage/heal helpers ─────────────────────────────────────────────

  sideName(who) { return who === 'player' ? 'your' : 'the opponent'; }

  trackDamage(receiverSide, dmg) {
    if (dmg <= 0) return;
    if (receiverSide === 'opponent') this.state.stats.dealt += dmg;
    else this.state.stats.taken += dmg;
  }

  dealToHero(side, dmg, { source = '' } = {}) {
    if (dmg <= 0) return;
    this.state[side].hp -= dmg;
    this.trackDamage(side, dmg);
    ui.floatHeroDamage(side, dmg);
    ui.render(this);
    this.checkGameOver();
  }

  // Direct (non-combat) creature damage: sorceries and effects bypass
  // Defender/Brittle — those trigger only when a creature is attacked.
  dealToCreature(creature, side, dmg, { source = '' } = {}) {
    if (dmg <= 0) return;
    creature.currentHp -= dmg;
    this.trackDamage(side, dmg);
    ui.floatCreatureDamage(creature.instanceId, dmg);
    ui.render(this);
  }

  // Damage-applied hook for combat.js (routes all UI through the game object).
  showCreatureDamage(creature, dmg, side) {
    if (side) this.trackDamage(side, dmg);
    ui.floatCreatureDamage(creature.instanceId, dmg);
  }

  // Arc from the pinned spell card to its target ('hero' resolves against
  // receiverSide). Colors follow the spell-school palette.
  spellArc(target, receiverSide, color = '#c050d0') {
    const from = document.querySelector('#active-card-pin .card');
    let to;
    if (target === 'hero') {
      to = receiverSide === 'opponent'
        ? document.getElementById('opp-portrait')
        : document.getElementById('player-hp-fill')?.parentElement;
    } else if (target?.instanceId) {
      to = document.querySelector(`[data-instance-id="${target.instanceId}"]`);
    }
    ui.drawAttackArc(from, to, color, 900);
  }

  healHero(side, amount, source = '') {
    const hero = this.state[side];
    const healed = Math.min(HP_MAX, hero.hp + amount) - hero.hp;
    if (healed <= 0) return;
    hero.hp += healed;
    this.log(`${side === 'player' ? 'You heal' : 'Opponent heals'} ${healed}${source ? ` (${source})` : ''}.`);
    ui.render(this);
  }

  queueFreeze(side, creature, sourceName) {
    queuePendingEffect({ type: 'cant_attack', side, instanceId: creature.instanceId, sourceName });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  async _drawCards(who, n, { silent = false } = {}) {
    const hero = this.state[who];
    for (let i = 0; i < n; i++) {
      if (hero.deck.length === 0) {
        hero.fatigue += 1;
        hero.hp -= hero.fatigue;
        this.trackDamage(who, hero.fatigue);
        ui.floatHeroDamage(who, hero.fatigue);
        this.log(`${who === 'player' ? 'Your deck is empty — you take' : 'Opponent’s deck is empty — it takes'} ${hero.fatigue} fatigue damage!`);
        ui.render(this);
        if (this.checkGameOver()) return;
        continue;
      }
      const card = hero.deck.pop();
      if (hero.hand.length >= HAND_CAP) {
        if (who === 'player' && this.state.phase !== 'game-over') {
          await this._chooseDiscard(card);
        } else {
          hero.discard.push(card);
          this.log('Opponent’s hand is full — a card is burned.');
        }
        continue;
      }
      if (!silent) {
        const handEl = document.getElementById(who === 'player' ? 'player-hand' : 'opp-hand');
        await ui.animateCardFlight(handEl);
      }
      card._justDrawn = Date.now();
      hero.hand.push(card);
      if (!silent && who === 'player') this.log(`You draw ${card.name}.`);
      if (!silent) ui.render(this);
    }
  }

  // Hand full on draw: the drawn card joins the hand temporarily and the
  // player picks which of the 8 to discard. Timeout/Escape discards the
  // freshly drawn card.
  async _chooseDiscard(drawnCard) {
    const hero = this.state.player;
    drawnCard._justDrawn = Date.now();
    hero.hand.push(drawnCard); // temporarily 8 cards
    ui.render(this);
    this.log(`You draw ${drawnCard.name} — but your hand is full!`);

    const pick = await this._requestTarget(
      'discard-hand',
      'Hand full — click a card to discard',
    );
    const discard = pick || drawnCard;
    hero.hand = hero.hand.filter((c) => c !== discard);
    hero.discard.push(discard);
    this.log(`You discard ${discard.name}.`);
    ui.render(this);
  }

  // ── Dead sweep + Volatile ──────────────────────────────────────────────────

  async sweepDead() {
    const s = this.state;
    for (;;) {
      let died = null;
      let side = null;
      for (const who of ['player', 'opponent']) {
        died = s[who].board.find((c) => c.currentHp <= 0);
        if (died) { side = who; break; }
      }
      if (!died) break;

      ui.animateDeath(died.instanceId); // while its element is still in the DOM
      s[side].board = s[side].board.filter((c) => c !== died);
      s[side].discard.push(died);
      this.log(`${died.name} is destroyed.`);
      await sleep(400); // let the death read before the board reflows

      if (died.keywords.some((k) => k.name === 'Volatile') && s.phase !== 'game-over') {
        const roll = await this.roll(side, {
          notation: '1d6', label: `${died.name} — Volatile!`,
          context: '5–6: deals that much to a random enemy', bestThreshold: 5,
        });
        if (roll.total >= 5) {
          const enemySide = side === 'player' ? 'opponent' : 'player';
          const pool = [...s[enemySide].board.filter((c) => c.currentHp > 0), 'hero'];
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick === 'hero') {
            this.dealToHero(enemySide, roll.total, {
              source: died.name,
            });
            this.log(`${died.name} explodes for ${roll.total} on the enemy hero!`);
          } else {
            this.dealToCreature(pick, enemySide, roll.total, { source: died.name });
            this.log(`${died.name} explodes for ${roll.total} on ${pick.name}!`);
          }
        }
      }
      if (s.phase === 'game-over') break;
    }
    ui.render(this);
  }

  // ── Playing cards ──────────────────────────────────────────────────────────

  async playCard(who, card) {
    const s = this.state;
    const hero = s[who];
    if (card.cost > hero.mana) {
      if (who === 'player') this.log('Not enough mana.');
      return;
    }

    if (card.type === 'creature') {
      hero.mana -= card.cost;
      hero.hand = hero.hand.filter((c) => c !== card);
      playSound('card-play');
      if (hero.board.filter((c) => c.currentHp > 0).length >= BOARD_CAP) {
        hero.discard.push(card);
        this.log(`Board full — ${card.name} is discarded.`);
        ui.render(this);
        return;
      }
      if (who === 'opponent') {
        // The card arcs in from the opponent's deck before landing.
        await ui.animateCardFlight(document.getElementById('opp-board'), { durationMs: 650 });
      }
      const instance = createCreatureInstance(card);
      instance._justPlayed = Date.now();
      hero.board.push(instance);
      this.log(`${who === 'player' ? 'You play' : 'Opponent plays'} ${card.name}.`);
      ui.render(this);
      await applyOnEnterEffects(this, instance, who);
      await this.sweepDead();
      ui.render(this);
      return;
    }

    await this._castSorcery(who, card);
  }

  async aiPlayCard(card) {
    await this.playCard('opponent', card);
  }

  async aiAttack(attacker, target) {
    const s = this.state;
    if (s.phase === 'game-over') return;
    // Guardian enforcement double-check.
    const guardians = s.player.board.filter(
      (c) => c.currentHp > 0 && c.keywords.some((k) => k.name === 'Guardian'),
    );
    if (guardians.length > 0 && (target === 'hero' || !guardians.includes(target))) {
      target = guardians[0];
    }
    attacker.hasAttackedThisTurn = true;
    const fromEl = document.querySelector(`[data-instance-id="${attacker.instanceId}"]`);
    const toEl = target === 'hero'
      ? document.getElementById('player-hp-fill')?.parentElement
      : document.querySelector(`[data-instance-id="${target.instanceId}"]`);
    ui.drawAttackArc(fromEl, toEl, '#e05020');
    await resolveCombat(this, { attackerSide: 'opponent', attacker, target });
    await this.sweepDead();
    ui.render(this);
  }

  // ── Sorcery system ─────────────────────────────────────────────────────────

  async _castSorcery(who, card) {
    const s = this.state;
    const hero = s[who];
    hero.mana -= card.cost;
    hero.hand = hero.hand.filter((c) => c !== card);
    playSound('card-play');
    this.log(`Cast: ${card.name}`);
    ui.setActiveCard(card, who === 'player' ? 'You Cast' : 'Opponent Casts', who);
    ui.render(this);

    let fizzled = false;
    try {
      const handler = SORCERY_HANDLERS[card.id];
      if (handler) await handler(this, who, card);
    } catch (err) {
      if (err === CANCELLED) {
        fizzled = true;
        this.log(`${card.name} fizzles!`); // mana stays spent
      } else {
        throw err;
      }
    } finally {
      hero.discard.push(card);
      // Let the spell's final impact read before the card fades away.
      await sleep(fizzled ? 350 : 1000);
      await ui.fadeOutActiveCard();
      ui.hideSorceryPrompt();
      ui.clearTargetHighlights();
    }
    await this.sweepDead();
    ui.render(this);
  }

  // ── Target selection ───────────────────────────────────────────────────────

  // kind: 'any' (enemy creature or hero) | 'friendly' | 'enemy-creature'
  //       | 'discard-hand' (pick one of your own hand cards)
  _requestTarget(kind, promptText) {
    const s = this.state;
    ui.showSorceryPrompt(promptText, TARGET_TIMEOUT_MS);

    const els = [];
    if (kind === 'any' || kind === 'enemy-creature') {
      for (const c of s.opponent.board.filter((x) => x.currentHp > 0)) {
        const e = document.querySelector(`#opp-board [data-instance-id="${c.instanceId}"]`);
        if (e) els.push(e);
      }
    }
    if (kind === 'any') {
      const p = document.getElementById('opp-portrait');
      if (p) els.push(p);
    }
    if (kind === 'friendly') {
      for (const c of s.player.board.filter((x) => x.currentHp > 0)) {
        const e = document.querySelector(`#player-board [data-instance-id="${c.instanceId}"]`);
        if (e) els.push(e);
      }
    }
    if (kind === 'discard-hand') {
      els.push(...document.querySelectorAll('#player-hand .card'));
    }
    ui.highlightTargets(els);

    return new Promise((resolve) => {
      const finish = (val) => {
        clearTimeout(timer);
        this._targetRequest = null;
        ui.clearTargetHighlights();
        ui.hideSorceryPrompt();
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), TARGET_TIMEOUT_MS);
      this._targetRequest = { kind, finish };
    });
  }

  async chooseTarget(who, promptText) {
    if (who === 'opponent') return this.ai.pickAnyTarget(this.state);
    const t = await this._requestTarget('any', promptText);
    if (t === null) throw CANCELLED;
    return t;
  }

  async chooseFriendlyCreature(who, promptText) {
    if (who === 'opponent') {
      const t = this.ai.pickFriendlyCreature(this.state);
      if (!t) throw CANCELLED;
      return t;
    }
    const t = await this._requestTarget('friendly', promptText);
    if (t === null) throw CANCELLED;
    return t;
  }

  async chooseEnemyCreature(who, promptText) {
    if (who === 'opponent') {
      const t = this.ai.pickEnemyCreature(this.state);
      if (!t) throw CANCELLED;
      return t;
    }
    const t = await this._requestTarget('enemy-creature', promptText);
    if (t === null) throw CANCELLED;
    return t;
  }

  // ── Player input ───────────────────────────────────────────────────────────

  _attachGlobalHandlers() {
    document.addEventListener('click', (ev) => this._onClick(ev));
    document.addEventListener('keydown', (ev) => this._onKey(ev));
  }

  _bindBoardControls() {
    document.getElementById('end-turn-btn').addEventListener('click', () => this._endPlayerTurn());
    document.getElementById('help-btn').addEventListener('click', () => {
      ui.showIntro({ helpMode: true, onBegin: () => {} });
    });
    document.getElementById('recover-btn').addEventListener('click', () => this._forceRecover());
    document.getElementById('snd-all-btn').addEventListener('click', () => {
      const on = !(isSfxEnabled() || isAmbientEnabled());
      setAllSound(on);
      this._updateSoundButtons();
    });
    document.getElementById('snd-music-btn').addEventListener('click', () => {
      setAmbientEnabled(!isAmbientEnabled());
      this._updateSoundButtons();
    });
    document.getElementById('snd-sfx-btn').addEventListener('click', () => {
      setSfxEnabled(!isSfxEnabled());
      this._updateSoundButtons();
    });
    this._updateSoundButtons();
  }

  _updateSoundButtons() {
    const anyOn = isSfxEnabled() || isAmbientEnabled();
    document.getElementById('snd-all-btn').textContent = anyOn ? '🔊' : '🔇';
    document.getElementById('snd-music-btn').style.opacity = isAmbientEnabled() ? '1' : '0.35';
    document.getElementById('snd-sfx-btn').style.opacity = isSfxEnabled() ? '1' : '0.35';
  }

  _forceRecover() {
    clearTimeout(this._aiWatchdog);
    document.getElementById('recover-btn').hidden = true;
    this.log('Recovered — returning to your turn.');
    this._endOfTurnCleanup('opponent');
    this._startTurn('player');
  }

  _onKey(ev) {
    if (document.getElementById('dice-stage')?.classList.contains('active')) return;
    if (document.getElementById('modal')?.classList.contains('visible')) return;
    if (ev.key === 'Enter') {
      this._endPlayerTurn();
    } else if (ev.key === 'Escape') {
      if (this._targetRequest) {
        this._targetRequest.finish(null);
      } else {
        this._clearAttackerSelection();
      }
    }
  }

  _onClick(ev) {
    const s = this.state;
    if (!s || s.phase === 'game-over') return;

    const cardEl = ev.target.closest?.('.card');
    const portrait = ev.target.closest?.('#opp-portrait');

    // Mid-sorcery target selection intercepts clicks.
    if (this._targetRequest) {
      const req = this._targetRequest;
      if (req.kind === 'discard-hand') {
        if (cardEl && cardEl.parentElement?.id === 'player-hand') {
          const card = s.player.hand[Number(cardEl.dataset.handIndex)];
          if (card) req.finish(card);
        }
        return;
      }
      if (portrait && req.kind === 'any') { req.finish('hero'); return; }
      if (cardEl?.dataset.instanceId) {
        const id = cardEl.dataset.instanceId;
        const oppC = s.opponent.board.find((c) => c.instanceId === id && c.currentHp > 0);
        const ownC = s.player.board.find((c) => c.instanceId === id && c.currentHp > 0);
        if ((req.kind === 'any' || req.kind === 'enemy-creature') && oppC) { req.finish(oppC); return; }
        if (req.kind === 'friendly' && ownC) { req.finish(ownC); return; }
      }
      return;
    }

    if (s.phase !== 'player-turn') return;

    // Hand card → play it.
    if (cardEl && cardEl.parentElement?.id === 'player-hand') {
      const idx = Number(cardEl.dataset.handIndex);
      const card = s.player.hand[idx];
      if (card) this.playCard('player', card);
      return;
    }

    // Own board creature → select/deselect attacker.
    if (cardEl && cardEl.parentElement?.id === 'player-board') {
      const id = cardEl.dataset.instanceId;
      const creature = s.player.board.find((c) => c.instanceId === id);
      if (!creature) return;
      if (this.selectedAttacker === id) { this._clearAttackerSelection(); return; }
      if (creature.summoningSick) { this.log(`${creature.name} has summoning sickness.`); return; }
      if (creature.cantAttackThisTurn) { this.log(`${creature.name} is frozen and can’t attack.`); return; }
      if (creature.hasAttackedThisTurn) { this.log(`${creature.name} has already attacked.`); return; }
      this.selectedAttacker = id;
      const guardians = s.opponent.board.filter(
        (c) => c.currentHp > 0 && c.keywords.some((k) => k.name === 'Guardian'),
      );
      ui.showAttackPrompt(guardians.length > 0
        ? `${creature.name}: you must attack a Guardian!`
        : `${creature.name}: choose a target — enemy creature or hero.`);
      ui.render(this);
      const els = guardians.length > 0
        ? guardians.map((g) => document.querySelector(`#opp-board [data-instance-id="${g.instanceId}"]`)).filter(Boolean)
        : [
          ...s.opponent.board.filter((c) => c.currentHp > 0)
            .map((c) => document.querySelector(`#opp-board [data-instance-id="${c.instanceId}"]`)).filter(Boolean),
          document.getElementById('opp-portrait'),
        ];
      ui.highlightTargets(els);
      return;
    }

    // Enemy creature or portrait → attack with selected attacker.
    if (this.selectedAttacker && (portrait || (cardEl && cardEl.parentElement?.id === 'opp-board'))) {
      const attacker = s.player.board.find((c) => c.instanceId === this.selectedAttacker);
      if (!attacker) { this._clearAttackerSelection(); return; }
      let target = 'hero';
      if (!portrait) {
        const id = cardEl.dataset.instanceId;
        target = s.opponent.board.find((c) => c.instanceId === id && c.currentHp > 0);
        if (!target) return;
      }
      const guardians = s.opponent.board.filter(
        (c) => c.currentHp > 0 && c.keywords.some((k) => k.name === 'Guardian'),
      );
      if (guardians.length > 0 && (target === 'hero' || !guardians.includes(target))) {
        this.log('You must attack a Guardian first!');
        return;
      }
      this._playerAttack(attacker, target);
    }
  }

  async _playerAttack(attacker, target) {
    const s = this.state;
    this._clearAttackerSelection();
    attacker.hasAttackedThisTurn = true;
    const fromEl = document.querySelector(`#player-board [data-instance-id="${attacker.instanceId}"]`);
    const toEl = target === 'hero'
      ? document.getElementById('opp-portrait')
      : document.querySelector(`#opp-board [data-instance-id="${target.instanceId}"]`);
    ui.drawAttackArc(fromEl, toEl, '#e07030');
    await resolveCombat(this, { attackerSide: 'player', attacker, target });
    await this.sweepDead();
    ui.render(this);
  }

  _clearAttackerSelection() {
    this.selectedAttacker = null;
    ui.hideAttackPrompt();
    ui.clearTargetHighlights();
    if (this.state) ui.render(this);
  }

  // ── Game over / scoring ────────────────────────────────────────────────────

  checkGameOver() {
    const s = this.state;
    if (s.phase === 'game-over') return true;
    const pDead = s.player.hp <= 0;
    const oDead = s.opponent.hp <= 0;
    if (!pDead && !oDead) return false;
    let winner;
    if (pDead && oDead) {
      winner = s.player.hp > s.opponent.hp ? 'player'
        : s.opponent.hp > s.player.hp ? 'opponent'
          : (Math.random() < 0.5 ? 'player' : 'opponent');
    } else {
      winner = pDead ? 'opponent' : 'player';
    }
    this._endGame(winner);
    return true;
  }

  _endGame(winner) {
    const s = this.state;
    if (s.phase === 'game-over') return;
    s.phase = 'game-over';
    s.winner = winner;
    const isWin = winner === 'player';

    stopAmbient();
    playSound(isWin ? 'victory' : 'defeat');
    ui.banner(isWin ? 'VICTORY!' : 'DEFEAT', isWin ? 'victory' : 'defeat', 2200);

    const body = document.createElement('div');
    body.className = 'gameover-body';
    const flavour = document.createElement('p');
    flavour.className = 'gameover-flavour';
    flavour.textContent = isWin
      ? 'The dungeon falls silent. The dice were on your side.'
      : 'The dice had other plans. The dungeon claims another duelist.';
    body.appendChild(flavour);
    const meta = document.createElement('div');
    meta.className = 'gameover-meta';
    meta.textContent =
      `${s.turnNumber} turns  |  ${s.stats.dealt} damage dealt  |  `
      + `${s.stats.taken} damage received  |  ${Math.max(0, s.player.hp)} HP remaining`;
    body.appendChild(meta);

    setTimeout(() => {
      ui.showModal({
        title: isWin ? '⚔ Victory!' : '💀 Defeat',
        bodyEl: body,
        buttonLabel: 'Play Again',
        onButton: () => this.init(),
        extraClass: isWin ? 'gameover-win' : 'gameover-loss',
      });
    }, 1200);
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  log(msg) { ui.log(msg); }

  _preloadImages() {
    if (this._preloaded) return;
    this._preloaded = true;
    const urls = [
      ...ui.ARENAS.map((a) => `assets/board/${a}.webp`),
      ...['berserker', 'tactician', 'gambler'].map((n) => `assets/opponents/${n}.webp`),
      ...CARDS.map((c) => `assets/cards/${c.art}.webp`),
      `assets/cards/${RECRUIT_TOKEN.art}.webp`,
      'assets/cards/sheep.webp', // Polymorph Gamble transform
    ];
    for (const url of urls) { const img = new Image(); img.src = url; }
  }
}

// ── Sorcery handlers ──────────────────────────────────────────────────────────
// Each resolves fully (dice, targeting, damage) before the cast flow sweeps.

function enemyOf(who) { return who === 'player' ? 'opponent' : 'player'; }

// Arc from the pinned card to the target, then pause so the hit reads.
async function spellImpact(game, target, receiverSide, color, pauseMs = 650) {
  game.spellArc(target, receiverSide, color);
  await sleep(pauseMs);
}

async function damageSorceryRoll(game, who, card, notation, context) {
  const roll = await game.roll(who, { notation, label: `${card.name}!`, context, aiRerollable: true });
  let dmg = roll.total;
  if (roll.isCrit) {
    dmg *= 2;
    game.critFanfare(who, `${card.name} CRITICAL!`);
  }
  return { dmg, roll };
}

async function dealSorceryDamage(game, who, card, target, dmg, color = '#ff6020') {
  const enemy = enemyOf(who);
  await spellImpact(game, target, enemy, color);
  if (target === 'hero') {
    game.dealToHero(enemy, dmg, { source: card.name});
    game.log(`${card.name} hits ${enemy === 'opponent' ? 'the enemy' : 'your'} hero for ${dmg}.`);
  } else {
    game.dealToCreature(target, enemy, dmg, { source: card.name});
    game.log(`${card.name} hits ${target.name} for ${dmg}.`);
  }
}

const SORCERY_HANDLERS = {
  // Spark — deal 1d6 to any target.
  S001: async (game, who, card) => {
    const target = await game.chooseTarget(who, 'Spark — choose any enemy target');
    const { dmg } = await damageSorceryRoll(game, who, card, '1d6', 'Deal to any target');
    await dealSorceryDamage(game, who, card, target, dmg);
  },

  // Focus Ritual — gain 2 Focus.
  S002: async (game, who) => {
    const hero = game.state[who];
    hero.focus = Math.min(FOCUS_CAP, hero.focus + 2);
    game.log(`${who === 'player' ? 'You gain' : 'Opponent gains'} 2 Focus.`);
  },

  // Coin Flip — 4+: draw 2; 1–3: draw 1 and take 1.
  S003: async (game, who, card) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Coin Flip!', context: '4+: draw 2 · 1–3: draw 1, take 1', bestThreshold: 4,
    });
    if (roll.total >= 4) {
      await game._drawCards(who, 2);
      game.log('Heads! Draw 2 cards.');
    } else {
      await game._drawCards(who, 1);
      game.dealToHero(who, 1, { source: card.name });
      game.log('Tails — draw 1, take 1 damage.');
    }
  },

  // Hex — Wild: a random enemy creature deals -2 on its next attack (min 1).
  S004: async (game, who, card) => {
    const enemy = enemyOf(who);
    const targets = game.state[enemy].board.filter((c) => c.currentHp > 0);
    if (targets.length === 0) { game.log(`${card.name} finds no target.`); return; }
    const t = targets[Math.floor(Math.random() * targets.length)];
    await spellImpact(game, t, enemy, '#a070e0');
    t.tempDamageMalus = 2;
    game.log(`${t.name} is hexed — -2 damage on its next attack.`);
  },

  // Firebolt — deal 1d8 to any target.
  S005: async (game, who, card) => {
    const target = await game.chooseTarget(who, 'Firebolt — choose any enemy target');
    const { dmg } = await damageSorceryRoll(game, who, card, '1d8', 'Deal to any target');
    await dealSorceryDamage(game, who, card, target, dmg);
  },

  // Healing Word — restore 2d4 HP to your hero.
  S006: async (game, who, card) => {
    const roll = await game.roll(who, { notation: '2d4', label: 'Healing Word', context: 'Restore HP to your hero' });
    await spellImpact(game, 'hero', who, '#40c060');
    game.healHero(who, roll.total, card.name);
  },

  // Lucky Draw — 1–2: 1 card · 3–4: 2 · 5–6: 3.
  S007: async (game, who) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Lucky Draw!', context: '1–2: draw 1 · 3–4: draw 2 · 5–6: draw 3', bestThreshold: 5,
    });
    const n = roll.total <= 2 ? 1 : roll.total <= 4 ? 2 : 3;
    await game._drawCards(who, n);
    game.log(`Lucky Draw: ${n} card${n > 1 ? 's' : ''}.`);
  },

  // Blessing — target friendly creature deals +2 on its next attack this turn.
  S008: async (game, who, card) => {
    const t = await game.chooseFriendlyCreature(who, 'Blessing — choose a friendly creature');
    await spellImpact(game, t, who, '#f0c040');
    t.tempDamageBonus += 2;
    game.log(`${t.name} is blessed: +2 damage on its next attack this turn.`);
  },

  // Chain Lightning — Wild: 2d6 split randomly among all enemy creatures.
  S009: async (game, who, card) => {
    const enemy = enemyOf(who);
    const targets = () => game.state[enemy].board.filter((c) => c.currentHp > 0);
    if (targets().length === 0) { game.log(`${card.name} arcs into nothing.`); return; }
    const { dmg } = await damageSorceryRoll(game, who, card, '2d6', 'Split randomly among enemy creatures');
    const hits = new Map(); // creature instance -> damage taken
    for (let i = 0; i < dmg; i++) {
      const live = targets();
      if (live.length === 0) break;
      const t = live[Math.floor(Math.random() * live.length)];
      t.currentHp -= 1;
      hits.set(t, (hits.get(t) || 0) + 1);
    }
    for (const [t, d] of hits) {
      game.spellArc(t, enemy, '#80d0ff');
      game.trackDamage(enemy, d);
      ui.floatCreatureDamage(t.instanceId, d);
    }
    await sleep(800);
    game.log(`Chain Lightning: ${[...hits].map(([t, d]) => `${t.name} takes ${d}`).join(', ')}.`);
    ui.render(game);
  },

  // Berserk Brew — friendly target: 4+ add 1d8 to next attack; 1–3 it takes 2.
  S010: async (game, who, card) => {
    const t = await game.chooseFriendlyCreature(who, 'Berserk Brew — choose a friendly creature');
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Berserk Brew!', context: `4+: +1d8 next attack · 1–3: ${t.name} takes 2`, bestThreshold: 4,
    });
    if (roll.total >= 4) {
      const bonus = await game.roll(who, { notation: '1d8', label: 'Brew surge!', context: `Bonus damage for ${t.name}` });
      await spellImpact(game, t, who, '#f0c040');
      t.tempDamageBonus += bonus.total;
      game.log(`${t.name} rages: +${bonus.total} on its next attack.`);
    } else {
      await spellImpact(game, t, who, '#ff4020');
      game.dealToCreature(t, who, 2, { source: card.name });
      game.log(`The brew backfires — ${t.name} takes 2.`);
    }
  },

  // Mend the Ranks — d6: all friendly creatures gain that much HP.
  S011: async (game, who) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Mend the Ranks', context: 'All friendly creatures gain that much HP', bestThreshold: 6,
    });
    const mended = game.state[who].board.filter((x) => x.currentHp > 0);
    for (const c of mended) game.spellArc(c, who, '#40c060');
    if (mended.length > 0) await sleep(700);
    for (const c of mended) c.currentHp += roll.total;
    game.log(`Friendly creatures mend ${roll.total} HP.`);
  },

  // Sap Strength — 5–6: enemy loses 2 mana next turn; 1–4: loses 1.
  S012: async (game, who) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Sap Strength', context: '5–6: -2 enemy mana · 1–4: -1', bestThreshold: 5,
    });
    const amount = roll.total >= 5 ? 2 : 1;
    await spellImpact(game, 'hero', enemyOf(who), '#a070e0');
    queuePendingEffect({ type: 'mana_loss', side: enemyOf(who), amount });
    game.log(`The enemy will lose ${amount} mana next turn.`);
  },

  // Fireball — deal 2d6 to any target.
  S013: async (game, who, card) => {
    const target = await game.chooseTarget(who, 'Fireball — choose any enemy target');
    const { dmg } = await damageSorceryRoll(game, who, card, '2d6', 'Deal to any target');
    await dealSorceryDamage(game, who, card, target, dmg);
  },

  // Frost Nova — 1d4 to all enemy creatures; each hit: 5–6 freezes it.
  S014: async (game, who, card) => {
    const enemy = enemyOf(who);
    const targets = game.state[enemy].board.filter((c) => c.currentHp > 0);
    if (targets.length === 0) { game.log(`${card.name} frosts an empty field.`); return; }
    const { dmg } = await damageSorceryRoll(game, who, card, '1d4', 'Deal to all enemy creatures');
    for (const t of targets) {
      await spellImpact(game, t, enemy, '#80d0ff', 350);
      game.dealToCreature(t, enemy, dmg, { source: card.name});
      if (t.currentHp > 0) {
        const freeze = await game.roll(who, {
          notation: '1d6', label: 'Freeze check', context: `5–6: ${t.name} can’t attack next turn`, allowReroll: false,
        });
        if (freeze.total >= 5) {
          game.queueFreeze(enemy, t, card.name);
          game.log(`${t.name} is frozen solid!`);
        }
      }
    }
  },

  // Polymorph Gamble — 1–2: your creature becomes a sheep; 3–6: an enemy does.
  S015: async (game, who, card) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Polymorph Gamble!', context: '1–2: your creature · 3–6: enemy creature becomes a 1/1 sheep', bestThreshold: 3,
    });
    const makeSheep = (c) => {
      c.name = 'Sheep';
      c.atk = '1';
      c.currentAtk = '1';
      c.hp = 1;
      c.currentHp = 1;
      c.keywords = [];
      c.text = 'Baa.';
      c.art = 'sheep';
      c.tempDamageBonus = 0;
      c.tempDamageMalus = 0;
    };
    if (roll.total <= 2) {
      const own = game.state[who].board.filter((c) => c.currentHp > 0);
      if (own.length === 0) { game.log('The polymorph fizzles — no creature to transform.'); return; }
      const t = own[Math.floor(Math.random() * own.length)];
      await spellImpact(game, t, who, '#a070e0');
      makeSheep(t);
      game.log(`Disaster! Your own ${t.name === 'Sheep' ? 'creature' : t.name} becomes a 1/1 Sheep.`);
    } else {
      const t = await game.chooseEnemyCreature(who, 'Polymorph — choose an enemy creature');
      const name = t.name;
      await spellImpact(game, t, enemyOf(who), '#a070e0');
      makeSheep(t);
      game.log(`${name} becomes a 1/1 Sheep!`);
    }
    ui.render(game);
  },

  // Second Wind — restore 2d6 HP and draw a card.
  S016: async (game, who, card) => {
    const roll = await game.roll(who, { notation: '2d6', label: 'Second Wind', context: 'Restore HP + draw a card' });
    await spellImpact(game, 'hero', who, '#40c060');
    game.healHero(who, roll.total, card.name);
    await game._drawCards(who, 1);
  },

  // Meteor — 3d6 to a target; overkill points can return HP (cap 5).
  S017: async (game, who, card) => {
    const target = await game.chooseTarget(who, 'Meteor — choose any enemy target');
    const { dmg } = await damageSorceryRoll(game, who, card, '3d6', 'Deal to any target');
    let overkill = 0;
    if (target !== 'hero') overkill = Math.max(0, dmg - target.currentHp);
    await dealSorceryDamage(game, who, card, target, dmg);
    if (overkill > 0) {
      const orbs = await game.roll(who, {
        notation: `${overkill}d6`, label: 'Meteor embers…',
        context: 'Each 5–6 returns 1 HP (cap 5)', allowReroll: false,
      });
      const heal = Math.min(5, orbs.rolls.filter((r) => r >= 5).length);
      if (heal > 0) game.healHero(who, heal, card.name);
    }
  },

  // Mass Disarray — Wild: each creature in play (both sides) rolls; a 1 means
  // it deals no damage next turn.
  S018: async (game, who, card) => {
    const all = [
      ...game.state.player.board.filter((c) => c.currentHp > 0),
      ...game.state.opponent.board.filter((c) => c.currentHp > 0),
    ];
    if (all.length === 0) { game.log(`${card.name} disturbs an empty battlefield.`); return; }
    const roll = await game.roll(who, {
      notation: `${all.length}d6`, label: 'Mass Disarray!',
      context: 'Each 1 silences a creature next turn', allowReroll: false,
    });
    const dazed = [];
    roll.rolls.forEach((r, i) => {
      if (r === 1) { all[i].noAttackThisTurn = true; dazed.push(all[i].name); }
    });
    game.log(dazed.length > 0
      ? `Disarray! ${dazed.join(', ')} deal${dazed.length === 1 ? 's' : ''} no damage next turn.`
      : 'The disarray passes — every creature holds formation.');
  },

  // Twin Fates — 2d6 to the enemy hero; doubles draw 2 instead; 6-6 does both, doubled.
  S019: async (game, who, card) => {
    const roll = await game.roll(who, { notation: '2d6', label: 'Twin Fates!', context: 'Total to enemy hero · doubles: draw 2 instead · 6-6: both, doubled' });
    const [a, b] = roll.rolls;
    if (a === 6 && b === 6) {
      game.critFanfare(who, 'Twin Fates CRITICAL!');
      await spellImpact(game, 'hero', enemyOf(who), '#c050d0');
      game.dealToHero(enemyOf(who), roll.total * 2, { source: card.name});
      await game._drawCards(who, 2);
      game.log(`Twin sixes! ${roll.total * 2} damage AND 2 cards.`);
    } else if (a === b) {
      await game._drawCards(who, 2);
      game.log(`Doubles (${a}s) — draw 2 cards instead of damage.`);
    } else {
      await spellImpact(game, 'hero', enemyOf(who), '#c050d0');
      game.dealToHero(enemyOf(who), roll.total, { source: card.name});
      game.log(`Twin Fates strikes the enemy hero for ${roll.total}.`);
    }
  },

  // Inferno — Wild: 4d6 split randomly among all enemies (creatures and hero).
  S020: async (game, who, card) => {
    const enemy = enemyOf(who);
    const { dmg } = await damageSorceryRoll(game, who, card, '4d6', 'Split randomly among all enemies');
    let heroHits = 0;
    const hits = new Map();
    for (let i = 0; i < dmg; i++) {
      const live = game.state[enemy].board.filter((c) => c.currentHp > 0);
      const pool = [...live, 'hero'];
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (t === 'hero') {
        heroHits += 1;
      } else {
        t.currentHp -= 1;
        hits.set(t, (hits.get(t) || 0) + 1);
      }
    }
    for (const [t, d] of hits) {
      game.spellArc(t, enemy, '#ff6020');
      game.trackDamage(enemy, d);
      ui.floatCreatureDamage(t.instanceId, d);
    }
    if (hits.size > 0) await sleep(700);
    if (heroHits > 0) {
      game.spellArc('hero', enemy, '#ff6020');
      await sleep(500);
    }
    if (heroHits > 0) {
      game.state[enemy].hp -= heroHits;
      game.trackDamage(enemy, heroHits);
      ui.floatHeroDamage(enemy, heroHits);
    }
    const parts = [...hits].map(([t, d]) => `${t.name} takes ${d}`);
    if (heroHits > 0) parts.push(`hero takes ${heroHits}`);
    game.log(`Inferno! ${parts.join(', ')}.`);
    ui.render(game);
    game.checkGameOver();
  },

  // Divine Wrath — 2d8 to a target enemy creature and 2d8 to the enemy hero.
  S021: async (game, who, card) => {
    const enemy = enemyOf(who);
    const hasCreatures = game.state[enemy].board.some((c) => c.currentHp > 0);
    if (hasCreatures) {
      const t = await game.chooseEnemyCreature(who, 'Divine Wrath — choose an enemy creature');
      const { dmg } = await damageSorceryRoll(game, who, card, '2d8', `Deal to ${t.name}`);
      await dealSorceryDamage(game, who, card, t, dmg);
    }
    const { dmg: heroDmg } = await damageSorceryRoll(game, who, card, '2d8', 'Deal to the enemy hero');
    await dealSorceryDamage(game, who, card, 'hero', heroDmg);
  },

  // Reinforcements — d6: summon that many 1/1 Recruit tokens.
  S022: async (game, who) => {
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Reinforcements!', context: 'Summon that many 1/1 Recruits', bestThreshold: 6,
    });
    const board = game.state[who].board;
    let summoned = 0;
    for (let i = 0; i < roll.total; i++) {
      if (board.filter((c) => c.currentHp > 0).length >= BOARD_CAP) break;
      const recruit = createCreatureInstance(RECRUIT_TOKEN);
      recruit._justPlayed = Date.now();
      board.push(recruit);
      summoned += 1;
    }
    game.log(`${summoned} Recruit${summoned === 1 ? '' : 's'} answer${summoned === 1 ? 's' : ''} the call${summoned < roll.total ? ' (board full)' : ''}.`);
    ui.render(game);
  },

  // Cataclysm — 3d8 to all enemy creatures and 2d6 to the enemy hero.
  S023: async (game, who, card) => {
    const enemy = enemyOf(who);
    const targets = game.state[enemy].board.filter((c) => c.currentHp > 0);
    if (targets.length > 0) {
      const { dmg } = await damageSorceryRoll(game, who, card, '3d8', 'Deal to ALL enemy creatures');
      for (const t of targets) game.spellArc(t, enemy, '#ff6020');
      await sleep(700);
      for (const t of targets) {
        game.dealToCreature(t, enemy, dmg, { source: card.name});
      }
      game.log(`Cataclysm crushes every enemy creature for ${dmg}.`);
    }
    const { dmg: heroDmg } = await damageSorceryRoll(game, who, card, '2d6', 'Deal to the enemy hero');
    await dealSorceryDamage(game, who, card, 'hero', heroDmg);
  },

  // Wheel of Fortune — both discard hands; d6: each draws that many; then
  // 5–6 on a second roll: you draw 1 extra.
  S024: async (game, who) => {
    const s = game.state;
    for (const side of ['player', 'opponent']) {
      s[side].discard.push(...s[side].hand);
      s[side].hand = [];
    }
    game.log('The Wheel spins — both players discard their hands!');
    ui.render(game);
    const roll = await game.roll(who, {
      notation: '1d6', label: 'Wheel of Fortune!', context: 'Each player draws that many', bestThreshold: 6,
    });
    await game._drawCards('player', roll.total);
    await game._drawCards('opponent', roll.total);
    const bonus = await game.roll(who, {
      notation: '1d6', label: 'The Wheel spins again…', context: '5–6: you draw 1 extra', allowReroll: false,
    });
    if (bonus.total >= 5) {
      await game._drawCards(who, 1);
      game.log('The Wheel favours the caster — 1 extra card.');
    }
    ui.render(game);
  },
};
