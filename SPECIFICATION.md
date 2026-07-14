# RNG Dungeon Duels — Specification

A complete, self-contained specification for **RNG Dungeon Duels**: a single-player,
browser-based card-duel game built as a pure static site. This document is the
canonical source of truth for game mechanics, content, AI, audio, visual
design, and architecture. Everything required to rebuild the game from scratch
lives here.

---

## Overview

**RNG Dungeon Duels** is a fast, 3–5 minute card duel between the player and a
single AI opponent. Both sides draw from a 30-card deck of creatures and
sorceries, summon to a shared board, and attack until one hero's HP hits zero.

The game's identity is **dice-driven combat**. Every attack and every spell
rolls dice live on screen. A "max on every die" result is a critical for double
damage. Players bank **Focus** points (1 per turn, up to 5) to reroll any
unfavourable result.

A timer of sorts called **The Collapse** starts at round 5 and deals dice
damage to both heroes each round — escalating from `1d6` to `2d6` from round 9
onward — so matches stay short and the late game is dangerous for everyone.

The AI opponent has one of three rolled personalities (Berserker, Tactician,
Gambler) revealed at match start, each with distinct play patterns the player
can adapt to.

**Target session**: 3–5 minutes per match. Play Again restarts cleanly from
the intro screen.

---

## How to Run

The game is a pure static site. Serve `public/` over any static HTTP server:

```bash
cd public
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static server works (`npx serve`, `caddy file-server`, etc.). No build
step. No transpilation. No package install. Modern browsers with ES module
support are required.

---

## Architecture

**Pure static site.** No backend, no database, no API calls, no persistence.
Everything runs in the browser. The server's only job is to serve files.

### File Structure

```
public/
├── index.html              # Single HTML page, mounts #app
├── favicon.svg
├── css/
│   └── styles.css          # All visual styling, design tokens, animations
├── js/
│   ├── main.js             # Entry point — creates Game and calls init()
│   ├── game.js             # Top-level controller: turns, scoring, sorcery handlers
│   ├── ai.js               # AI opponent: personalities, scoring, target picks
│   ├── cards.js            # Master CARDS array + RECRUIT_TOKEN
│   ├── keywords.js         # KEYWORD_TEXT + TIER1/TIER2 lists
│   ├── combat.js           # Attack resolution, crit, retaliation, Defender, Brittle
│   ├── dice.js             # rollDice, rollFirstPlayer, rollPersonality, reroll prompt
│   ├── effects.js          # On-enter / start-of-turn effects, pending-effects queue
│   ├── deckbuilder.js      # 30-card weighted-curve deck dealer
│   ├── audio.js            # Web Audio synthesis: 8 SFX + 3 ambient music moods
│   └── ui.js               # DOM rendering, banners, modals, attack arcs
└── assets/
    ├── board/arena_duel.webp
    ├── cards/<name>.webp    # 60 card art images + recruit token
    └── opponents/{berserker,tactician,gambler}.webp
```

### Module Responsibilities

| Module | Responsibility |
|--------|----------------|
| `main.js` | Entry: `new Game().init()` |
| `game.js` | Game class. Turn loop, player input, sorcery dispatch table, scoring. Coordinates all other modules. |
| `ai.js` | `AI` class. Three personality vectors; card-scoring formula; combat target selection. Stateless between turns. |
| `cards.js` | Exports `CARDS` (60 cards) and `RECRUIT_TOKEN`. Pure data. |
| `keywords.js` | Exports `KEYWORD_TEXT`, `TIER1_KEYWORDS`, `TIER2_KEYWORDS`. Pure data. |
| `combat.js` | `resolveCombat()` — runs the damage roll, applies Defender/Brittle, deals damage, fires post-hit triggers, runs retaliation. |
| `dice.js` | Dice presentation: `rollDice` (with reroll prompt), `rollFirstPlayer`, `rollPersonality`. |
| `effects.js` | `applyOnEnterEffects`, `applyStartOfTurnEffects`, the pending-effects queue (`mana_loss`, `cant_attack`), and die-step helpers. |
| `deckbuilder.js` | `dealDeck(CARDS)` — Fisher-Yates shuffled 30-card weighted-curve deck. |
| `audio.js` | `initAudio`, `playSound`, `setAmbientMood`, `startAmbient`, `stopAmbient`, settings. |
| `ui.js` | DOM building (`buildBoard`), state rendering (`render`), banners, modals, SVG attack arcs, log/toast, active-card pin. |

ES modules. No bundler. Browsers fetch and parse each file directly via
`<script type="module">`.

---

## Game Flow

1. **Page load** → `main.js` instantiates `Game` and calls `init()`.
2. **Intro screen** — title, tagline, 6 rule cards, quick tips, "Begin Duel" button.
3. **Initialise audio** — the Begin Duel click is the user gesture that bootstraps the `AudioContext`.
4. **Build state**: both players at HP 25, mana 0, focus 0. Deal two 30-card decks.
5. **Roll for first player** — `rollFirstPlayer()`: 1d6 each, re-roll on ties; winner goes first.
6. **Roll personality** — `rollPersonality()`: shows all three opponent tiles, rolls 1d6 (1–2 Berserker, 3–4 Tactician, 5–6 Gambler), highlights the winner, dims the others.
7. **Personality reveal modal** — full portrait + tell + summary + tip; 24-second auto-dismiss with countdown bar (Enter or click to dismiss early).
8. **Deal opening hands** — 5 cards to the first player, 6 to the second.
9. **First turn begins**. Players alternate turns until one hero reaches 0 HP, or a Collapse roll kills one or both simultaneously.
10. **Game-over modal** — VICTORY or DEFEAT banner; score breakdown; Play Again button.
11. **Play Again** → calls `init()` again. State, instance counter, pending-effects queue are all reset.

---

## Game State

The `state` object on `Game`:

```js
{
  player: {
    hp: 25, mana: 0, maxMana: 0, focus: 0,
    deck: [], hand: [], board: [], discard: [],
    fatigue: 0, _pendingDraw: 0,
  },
  opponent: {
    hp: 25, mana: 0, maxMana: 0, focus: 0,
    deck: [], hand: [], board: [], discard: [],
    fatigue: 0, _pendingDraw: 0,
    personality: null, personalityTell: '',
  },
  turnNumber: 0,
  _roundStarter: undefined,  // 'player' | 'opponent' — set on first _startTurn
  phase: 'setup',            // 'setup' | 'player-turn' | 'ai-turn' | 'game-over'
  activePlayer: 'player',
  score: { damageDealt: 0 },
  winner: null,
}
```

### Constants

- **HP max**: 25 (used for HP fill clamping and Healing Word/Second Wind cap).
- **HP "danger"** threshold for the red HP pulse: ≤ 8.
- **Mana cap**: 7 (max ramp; refills to `maxMana` at start of own turn).
- **Focus cap**: 5.
- **Board cap**: 6 creatures per side. Excess creatures discard on play.
- **Hand cap**: 7 cards. Drawn cards above 7 are burned (sent to discard, logged).

### Creature Instance Shape

Built by `createCreatureInstance(cardDef)`:

```js
{
  ...cardDef,
  instanceId: `${cardDef.id}_${counter}`,
  currentHp: cardDef.hp,
  currentAtk: cardDef.atk,
  tempDamageBonus: 0,           // Blessing / Berserk Brew
  tempDamageMalus: 0,           // Hex
  summoningSick: !hasRush,
  cantAttackThisTurn: false,    // Frost effects — can't attack at all
  usedLuckyThisTurn: false,
  frenzyTriggeredThisTurn: false,
  hasAttackedThisTurn: false,
  rallyBuffThisTurn: false,
  noAttackThisTurn: false,      // Mass Disarray — deals no damage
}
```

---

## Turn Structure

A **round** = both players take one turn. **`turnNumber`** counts rounds, not
half-turns — it only ticks when the **round-starter** begins a turn. The
round-starter is locked on the first call to `_startTurn` and never changes
during the match.

### `_startTurn(who)` — happens at the start of every half-turn

1. If `_roundStarter` is undefined, set it to `who`.
2. If `who === _roundStarter`, increment `turnNumber`.
3. Set `activePlayer = who`, `phase = '<who>-turn'`.
4. Sync ambient music mood: `calm` if turn < 3, `tense` if 3–4, `collapse` if ≥ 5.
5. If `isRoundStart && turnNumber >= 5`, resolve **The Collapse** (see below).
6. **Mana ramp**: `maxMana = min(7, maxMana + 1); mana = maxMana`.
7. **Focus regen**: `focus = min(5, focus + 1)`.
8. **Pending effects**: `tickPendingEffects(who, state)` — applies `mana_loss` and `cant_attack` queued from sorceries.
9. Clear summoning sickness on all of this player's creatures (`summoningSick = false`).
10. **Start-of-turn creature effects**: `applyStartOfTurnEffects(who, state)` — Regenerate, Acolyte of Luck Focus tick, clear rally buffs from previous turn.
11. Draw a card. Process any `_pendingDraw` carryover (Shadow Assassin crit, etc.).
12. Sweep dead creatures.
13. Render. If player turn, attach handlers. If AI turn, run AI.

### Player Turn (free-form main phase)

- Click hand to play cards (creatures or sorceries).
- Click your creature, then click an enemy target to attack.
- Press Enter or click End Turn to end. End Turn is locked for 2 seconds at turn start to prevent misclicks.

### `_endOfTurnCleanup(who)`

Resets per-creature turn flags for **the player whose turn just ended**:
- `hasAttackedThisTurn = false`
- `usedLuckyThisTurn = false`
- `frenzyTriggeredThisTurn = false`
- `cantAttackThisTurn = false`
- `noAttackThisTurn = false`
- `tempDamageBonus = 0`, `tempDamageMalus = 0` (unused buffs fizzle)
- `canAttack = false`

Then `_startTurn(other)` runs.

---

## Resources

### Mana (`mana`, `maxMana`)
- Start at 0; both `mana` and `maxMana` ramp by 1 per own turn, capped at 7.
- `mana` refills to `maxMana` at the start of every own turn.
- Spent by playing cards. Cancelled sorceries do **not** refund mana.

### Focus (`focus`)
- Starts at 0; +1 per own turn, capped at 5.
- Spent **1 per reroll**. After any dice roll (except crits, Collapse rolls, and rolls that already hit their "best" threshold), the player gets a 9-second prompt to spend 1 Focus to reroll.
- The AI does not consume Focus to reroll. The `AI.shouldReroll` method exists but is **not currently wired into `dice.js`** — AI rolls always pass `allowReroll: false`.

### HP (`hp`)
- Both start at 25. Reaches 0 → that player loses.
- Heals clamp at 25 (Healing Word, Second Wind, Vampire Lord, Meteor overkill, Stone Colossus).
- Stone Colossus permanently raises its own HP cap on enter.

---

## Combat System

Combat is **auto-hit**: every attack lands. The randomness is in the damage
roll itself. Implemented in `combat.js`.

### Damage Notation

`atk` is `"XdY"` (e.g. `"1d4"`, `"2d6"`, `"3d6"`) or a flat number string (e.g.
`"3"` for Sheep/Recruit-token-after-summon-roll cases). Flat values skip the
dice roll entirely.

### Crit

**Crit = every die in the damage roll shows its maximum face.** Crit doubles
the rolled damage. Single d4 rolling 4 → crit. `2d6` rolling 6+6 → crit. `1d8`
rolling 8 → crit.

### Attack Resolution Order (`resolveCombat`)

1. Build attacker damage notation (`currentAtk || atk`). Apply `Minimum roll` floor (1s treated as the listed value, default 2) if the keyword is present.
2. **Lucky check**: if attacker has `Lucky` and hasn't used it this turn, offer a free reroll before the Focus prompt.
3. Roll damage via `rollDice()` (which handles its own UI, banners, reroll prompts).
4. Detect crit. Apply min-roll floor by summing `max(roll, minFloor)`. Double damage on crit.
5. Apply `tempDamageBonus` (Blessing / Berserk Brew) — consumed.
6. Apply `tempDamageMalus` (Hex) — consumed, floor at 1 damage.
7. **If target is hero**: subtract damage from enemy hero HP. If attacker is player, increment `state.score.damageDealt`.
8. **If target is creature**:
   - **Brittle**: if target has Brittle, roll 1d6 — on 1, damage += 1.
   - **Defender**: apply `_applyDefenderReduction` (per-card d6 trigger; see Keywords).
   - Subtract damage from `target.currentHp`.
9. **Post-hit triggers** (in this order):
   - Shadow Assassin (C022) on crit → `_pendingDraw += 1`.
   - Frost Elemental (C029) on creature hit → 1d6, 5–6 freezes target next turn.
   - Vampire Lord (C031) on damage dealt → 1d6, 4+ heals attacker's hero by the rolled amount (cap 25).
   - Storm Caller (C025) on attack → 1d6, 5–6 rolls 1d4 bonus damage to enemy hero.
   - Ghoul Pack (C027) on attack → 1d6, 5–6 deals 2 to enemy hero.
10. **Retaliation**: if target was a creature and survived, it rolls its own damage (same crit/min-floor logic) against the attacker, applying Defender on the attacker as appropriate.

### Frenzy (post-resolve)

After the primary attack resolves, `_tryFrenzy` checks if the attacker has
Frenzy and hasn't triggered it this turn:
1. Roll 1d6. On 5–6, Frenzy triggers.
2. Pick second-hit target: a fresh Guardian intercepts (unless the original target was the Guardian); else original target if still alive; else fall back to enemy hero.
3. Re-call `resolveCombat` with `preRolledDamage` = first hit's damage — no second roll, no crit, no Frenzy chain.

### Chaos Beast (C032) — Pre-attack Chaos Roll

Before resolving the attack, Chaos Beast rolls a 1d6. On a 1, the attack
redirects to a **uniformly random** target from `[...enemyBoard, ...own
board (excluding self), 'hero']`. The redirect can hit the attacker's own
allies or even the player's own hero — pure chaos.

### Other Combat Rules

- **Summoning sickness**: creatures cannot attack the turn they're played. Cleared at the start of the owner's next turn. `Rush` bypasses (set to `false` at creation).
- **Guardian rule**: if the enemy board has any creature with `Guardian` (live `currentHp > 0`), all attacks must target a Guardian. Attacks on hero or non-Guardian creatures are illegal and logged.
- **Board cap**: 6. If your board has 6 creatures and you play another, the card is discarded with a "Board full" log (mana still spent).
- **Hand cap**: 7. Drawing a card with 7 in hand burns the drawn card to discard.
- **Fatigue**: when the deck is empty and a draw is requested, take incrementing damage (1, then 2, then 3, …). `hero.fatigue += 1; hp -= fatigue`.

---

## The Collapse

The Collapse runs **at the start of the round-starter's turn**, starting from
**round 5**. It fires once per round so both heroes take it exactly once per
full round.

### Damage

- **Turns 5–8**: `1d6` damage to both heroes.
- **Turn 9+**: `2d6` damage to both heroes.

### Rules

- `allowReroll: false` — Collapse rolls **cannot** be rerolled, by player or AI.
- `isCollapse: true` — uses the red dice tint, plays `collapse-rumble` SFX, shows the "THE COLLAPSE — X to both!" banner instead of the generic CRITICAL banner.
- Both heroes lose `roll.total` HP simultaneously.

### Simultaneous Death Tiebreaker

If the Collapse drops both heroes to 0 in the same roll:
1. Whoever had **higher HP before** the Collapse wins.
2. If exact tie, roll **1d20** — `>= 11` → player wins, else → opponent wins.

Otherwise, if only one hero hits 0, the other wins.

### Music Sync

`setAmbientMood` is called at the start of every turn:
- Turn < 3 → `calm`
- Turn 3–4 → `tense`
- Turn ≥ 5 → `collapse`

The ambient bed transitions at the next loop boundary, not mid-phrase.

---

## Sorcery System

Sorceries are non-creature cards. They resolve immediately on play, deduct
mana, then go to discard. Cancellation does **not** refund mana — players can't
cherry-pick rolls.

### Cast Flow (`_castSorcery`)

1. Deduct mana, remove from hand, log "Cast: <name>".
2. Pin the card to the side of the screen via `ui.setActiveCard(card, 'You Cast' | 'Opponent Casts')` so the player can read its rules text while dice/target selection resolve.
3. Look up handler in `SORCERY_HANDLERS[card.id]` and invoke.
4. The handler runs its dice rolls and any target-selection helpers.
5. If the player cancels (Escape, timeout, or null target), the handler throws the module-level `CANCELLED` symbol. The outer catch logs "<name> fizzles!" — mana stays spent.
6. Unpin the card.
7. Sweep dead creatures.

### Target Selection

- `chooseTarget()` — any enemy creature or enemy hero. UI highlights all legal targets and arms the click handler. AI auto-picks via `AI.pickAnyTarget` (highest-HP enemy creature, fallback to hero).
- `chooseFriendlyCreature()` — any of your own creatures. UI highlights your board. AI picks via `AI.pickFriendlyCreature` (highest-ATK).
- `chooseEnemyCreature()` — any enemy creature. AI picks via `AI.pickEnemyCreature` (highest-ATK enemy creature).
- **15-second timeout** on every target-selection promise. Times out → resolves null → handler throws `CANCELLED` → sorcery fizzles.
- **Escape** during target selection cancels and resolves null.

### Sorcery Crits

Each damage sorcery rolls its dice via `rollDice`. After the roll,
`_isCritRoll(notation, result)` checks whether every die shows its max face.
If so, `dmg = total * 2` and a "<spell> CRITICAL!" log entry fires.

### Pending Effects

The `pendingEffects` queue in `effects.js` carries effects across turn
boundaries:

| Type | Source | Trigger |
|------|--------|---------|
| `mana_loss` | Sap Strength (S012) | On the target player's next `_startTurn`, deducts mana after the ramp. |
| `cant_attack` | Frost Elemental (C029), Frost Nova (S014) | On the target's next `_startTurn`, sets `cantAttackThisTurn = true` on the named creature. |

Queue is cleared on `init()` so a new match starts fresh.

---

## Scoring

The final score is computed in `_endGame`:

```js
const damageScore = damageDealt * 10;
const speedBonus  = Math.max(0, (8 - turns)) * 90;
const hpBonus     = hpRemaining * 20;
const winBonus    = isWin ? 500 : 0;
const finalScore  = damageScore + speedBonus + hpBonus + winBonus;
```

### Components

| Component | Formula | Notes |
|-----------|---------|-------|
| Damage score | `damageDealt × 10` | Every point of damage the player dealt this match. Tracked in `state.score.damageDealt`. |
| Speed bonus | `max(0, 8 - turns) × 90` | Strong incentive to finish quickly. Zero from turn 8 onward. |
| HP bonus | `hpRemaining × 20` | Player's surviving HP. |
| Victory bonus | `500 if win else 0` | Flat reward for winning. |

### Live Score (in-game display)

The top-right "Score X" indicator uses the same formula **excluding** the
victory bonus (which is only awarded on win):
```
liveScore = damageScore + speedBonus + hpBonus
```

### Damage Tracked Toward `damageDealt`

The player's `state.score.damageDealt` increments on:
- Combat damage dealt by player creatures to enemy hero or enemy creature.
- Storm Caller bonus damage to hero.
- Ghoul Pack bonus damage to hero.
- Volatile death-blast damage to enemy hero.
- All sorcery damage (Spark, Firebolt, Chain Lightning, Fireball, Frost Nova, Meteor, Twin Fates hero damage, Inferno, Divine Wrath, Cataclysm).

---

## Deck Building

Both decks have **30 cards**, built fresh at the start of each match by
`dealDeck(CARDS)` in `deckbuilder.js`.

### Curve

```js
const CURVE = { 1: 6, 2: 7, 3: 6, 4: 5, 5: 3, 6: 2, 7: 1 };
// Total: 6+7+6+5+3+2+1 = 30
```

### Rarity → Weight / MaxPerDeck

| Rarity | Weight | maxPerDeck |
|--------|--------|------------|
| common | 4 | 3 |
| uncommon | 3 | 2 |
| rare | 2 | 2 |
| legendary | 1 | 1 |

Weights are stored on each card and used by `weightedPick(candidates)` — a
card with weight 4 is 4× more likely to be drafted than one with weight 1.

### Algorithm

For each cost bucket (processed lowest first):
1. Build candidate list = cards of that cost not yet at `maxPerDeck` in this deck.
2. Weighted-pick one. Add it. Increment count.
3. Repeat until bucket is filled.

If a cost bucket can't be filled (not enough variety at that cost), the
remaining slots spill to the **nearest lower cost bucket**. A final
fill-from-any-eligible pass handles edge cases where spilled slots land in
already-processed buckets, ensuring the deck always reaches 30 (or as close as
the pool allows).

The completed deck is **Fisher-Yates shuffled** before being returned.

### Opening Hand

- Whoever goes first draws **5**.
- Whoever goes second draws **6**.
- Both draw an additional card at the start of each of their turns.

---

## Reroll Mechanic

After every player-facing dice roll, the dice stage may prompt the player to
reroll. The prompt sequence is:

1. **Lucky reroll** (free, once per turn per Lucky creature): if the attacker has the `Lucky` keyword and hasn't used it this turn, prompt first.
2. **Focus reroll** (costs 1 Focus): prompt if the player has `focus >= 1` and didn't just decline a Lucky reroll on the same roll.

### Prompt Skipped When

- `isAI: true` — AI rolls never prompt.
- `isCollapse: true` — Collapse rolls cannot be rerolled.
- The roll was already a max-on-every-die crit (no reason to reroll).
- The roll already hit its `bestThreshold` (e.g. a Regenerate 4+ that rolled 5 — already best).
- `allowReroll: false` (set explicitly by retaliation, Brittle, Defender, opponent rolls, Frost Nova freeze checks, Meteor overkill orbs, Wheel of Fortune bonus draw).
- The player has 0 Focus (Focus prompt only).

### Prompt UI

- 9-second countdown bar.
- Two buttons: "Yes (Free)" / "Yes (−1 Focus)" or "No".
- Enter key triggers Yes.
- After timeout, the prompt resolves as a decline.

After a reroll, the dice are re-tumbled in place (same elements), the new
result replaces the original, and the banner/crit-effects re-evaluate against
the new dice. **Crits triggered by a Focus or Lucky reroll still count.**

---

## AI System

The AI is a greedy, EV-driven decision engine with personality-flavoured
modifiers. Implemented in `ai.js`.

### Personalities

```js
const PERSONALITIES = {
  Berserker: { aggression: 1.4, gambleBoldness: 1.2, focusThreshold: 1.5, facePriority: 1.5, noise: 0    },
  Tactician: { aggression: 0.9, gambleBoldness: 0.7, focusThreshold: 2.5, facePriority: 0.8, noise: 0    },
  Gambler:   { aggression: 1.1, gambleBoldness: 1.8, focusThreshold: 1.0, facePriority: 1.0, noise: 0.25 },
};
```

| Knob | Meaning |
|------|---------|
| `aggression` | Multiplier on creature card score and `facePriority`. Higher = plays bigger creatures faster, attacks face more. Also influences trade math: `< 1` penalises bad trades more heavily (Tactician). |
| `gambleBoldness` | Multiplier on Gamble-keyword sorcery scores (S003, S010, S015, S018, S019, S024). Higher = plays risky sorceries even at marginal EV. |
| `focusThreshold` | Threshold for spending Focus to reroll. Lower = rerolls more aggressively. Berserker rerolls misses readily; Tactician only on `stakes === 'critical'`; Gambler rolls against `1 / focusThreshold`. (Note: `shouldReroll` is defined but the dice pipeline currently never calls it — AI rolls always pass `allowReroll: false`.) |
| `facePriority` | Weight bias toward attacking the enemy hero vs trading with creatures. Higher = hero-focused. |
| `noise` | Random jitter added to EV scores. Only Gambler is nonzero; produces the "weirdest target" picks via `1 + random() * noise` jitter and 25% chance of a random top-3 target. |

### Selection

Personality is rolled live via `rollPersonality()`: 1d6, where 1–2 → Berserker,
3–4 → Tactician, 5–6 → Gambler. All three are shown side-by-side as tiles
before the roll so the player sees what they could have faced.

### Turn Structure (`AI.takeTurn`)

1. **Play phase** (`_playPhase`): repeatedly find the highest-scoring playable card and play it via `game.aiPlayCard`. Skips creatures when board is full. 600ms pause between plays.
2. **Combat phase** (`_combatPhase`): snapshot attacker instance IDs at start (board may shrink mid-loop from retaliation deaths). For each, re-fetch from live board, validate liveness, pick target, attack. 800ms pause between attacks.

### Card Scoring

**Creature**:
```
score = expectedDmg × survivalScore × aggression × (1 + random() * noise)
where survivalScore = hp / (hp + 3)
```
Returns 0 if the board is already at 6.

**Sorcery**: lookup in the table below; null-coalesces to 1.0 if missing;
multiplied by `(1 + (random() - 0.5) * noise)` when noise > 0.

### Sorcery Scoring Table

| Card | Base | Condition / Personality Modifier |
|------|------|----------------------------------|
| S001 Spark | `1.5 × aggression` | Always playable; aggression boost |
| S002 Focus Ritual | `2.0` if `focus < 4` else `0.5` | Self-Focus refill |
| S003 Coin Flip | `1.2 × (1.3 if gambleBoldness > 1 else 1.0)` | Gamble-friendly bias |
| S004 Hex | `1.5` if enemyBoard has creatures else `0.2` | Needs targets |
| S005 Firebolt | `2.0 × aggression` | Cheap damage |
| S006 Healing Word | `2.5` if `hp < 15` else `0.8` | Heal when low |
| S007 Lucky Draw | `2.0` if `hand < 4` else `0.5` | Refill empty hand |
| S008 Blessing | `1.5 × aggression` if own board > 0 else `0.2` | Needs a friendly target |
| S009 Chain Lightning | `2.5 × aggression` if enemyBoard ≥ 2 else `0.5` | Best on wide boards |
| S010 Berserk Brew | `gambleBoldness × 2` if own board > 0 else `0.2` | Gamble + needs target |
| S011 Mend the Ranks | `2.0` if own board > 1 else `0.5` | AoE heal |
| S012 Sap Strength | `1.5` | Flat |
| S013 Fireball | `2.5 × aggression` | Mid-cost burst |
| S014 Frost Nova | `2.5 × aggression` if enemyBoard > 1 else `0.8` | AoE clear |
| S015 Polymorph Gamble | `gambleBoldness × 1.5` | Gamble |
| S016 Second Wind | `3.0` if `hp < 15` else `1.0` | Heal + draw |
| S017 Meteor | `3.0 × aggression` | Big single-target |
| S018 Mass Disarray | `gambleBoldness × 1.5` | Wild board lock |
| S019 Twin Fates | `gambleBoldness × 3.0` | High-variance face damage |
| S020 Inferno | `4.0 × aggression` if enemyBoard ≥ 2 else `1.5` | Wild AoE |
| S021 Divine Wrath | `3.5 × aggression` | Reliable big hit |
| S022 Reinforcements | `2.0` if own board < 4 else `0.5` | Refill board |
| S023 Cataclysm | `4.0 × aggression` | Big AoE finisher |
| S024 Wheel of Fortune | `gambleBoldness × 2.5` | Hand reset |

### Target Selection (`_pickTarget`)

1. **Guardian enforcement**: if any enemy Guardian is alive, return the first one — overrides everything else.
2. Build options list:
   - **Hero option**: `score = expectedDmg(attacker) × facePriority × lethality` where `lethality = 2.0` if `enemyHero.hp <= heroEV * 1.5` else `1.0`.
   - **Creature options**: for each live enemy creature, `tradeValue = ev - retaliation × (1.2 if aggression < 1 else 0.7)`; `killBonus = target.hp × 0.3` if the attacker can kill it on this hit; `score = tradeValue + killBonus`.
3. Sort options descending by score.
4. **Gambler wildcard**: if `noise > 0` and `random() < noise`, pick a random target from the top 3. Otherwise pick the top.

### Sorcery Target Helpers (called by sorcery handlers when caster is AI)

- `pickAnyTarget(state)` — highest-HP enemy creature, or hero if board empty.
- `pickFriendlyCreature(state)` — highest-ATK own creature, or null.
- `pickEnemyCreature(state)` — highest-ATK enemy creature, or null.

---

## Card Schema

Every card in `CARDS` has the following shape:

```js
{
  id:         'C001' | 'S001' | ...   // C### for creatures, S### for sorceries
  name:       string,
  type:       'creature' | 'sorcery',
  cost:       number,                  // 1–7
  atk?:       string,                  // creatures only: "XdY" or "summon" or numeric
  hp?:        number,                  // creatures only
  keywords:   [{ name, tier, value }], // empty array if none
  text:       string,                  // human-readable rules text
  rarity:     'common' | 'uncommon' | 'rare' | 'legendary',
  weight:     number,                  // deckbuilder weight (4/3/2/1 by rarity)
  maxPerDeck: number,                  // 3/2/2/1 by rarity
  art:        string,                  // filename basename (no extension)
}
```

The `art` field maps to `/assets/cards/${art}.webp`.

A separate `RECRUIT_TOKEN` constant (not in `CARDS`) defines the 1/1 Recruit
token summoned by Reinforcements. It has `weight: 0, maxPerDeck: 0` so the
deckbuilder skips it.

---

## Keywords

Two tiers. **Tier 1** keywords are listed in the always-visible legend strip
and appear as hover chips on cards. **Tier 2** keywords are spelled out in card
rules text and also appear as hover chips. `KEYWORD_TEXT` from `keywords.js`
holds the tooltip copy.

### Tier 1 (6)

| Keyword | Tooltip Text | Mechanical Effect |
|---------|--------------|-------------------|
| **Summon roll** | Roll the dice shown when this creature enters play; the result sets a stat. | Used by Feral Gnoll (`atk: 'summon'`). On enter, roll 1d6 and set the creature's `atk`/`currentAtk`/`baseAtk` to the rolled number for the rest of the game. |
| **Guardian** | Enemies must attack this creature unless an effect lets them bypass it. | While at least one Guardian on a side has `currentHp > 0`, all attacks against that side must target a Guardian. Enforced for player clicks, AI target picks, and Frenzy redirects. |
| **Defender** | A creature built to absorb hits; its effect triggers when it is attacked. | On incoming damage (initial hit or retaliation), roll 1d6. Per-card reduction (see card text): Shield Dwarf 4+ takes 2 less; Temple Guard 4+ takes half (round up); Dwarven Defender 3+ takes 2 less. |
| **Minimum roll** | When rolling this creature's damage, treat any die showing 1 as the listed value. | Applies in both attacks and retaliation. Floor is `value` (default 2). Sum is `Σ max(roll, floor)`. |
| **Gamble** | This card's main effect can pay off big or backfire, decided by a roll. | Tag only — actual mechanic is the sorcery's d6. Used by AI scoring (`gambleBoldness`). |
| **Wild** | This card's target or magnitude is random rather than chosen by you. | Tag only — describes spells that pick targets randomly or split damage. |

### Tier 2 (7)

| Keyword | Tooltip Text | Mechanical Effect |
|---------|--------------|-------------------|
| **Frenzy** | After attacking, roll d6: on 5–6 this creature attacks once more this turn for the same damage as its first hit. | Triggered in `_tryFrenzy` after each Frenzy creature's attack. Once per turn (`frenzyTriggeredThisTurn` gate). Re-target rules: Guardian intercepts; else original target if alive; else fall back to enemy hero. Damage is the original hit's `damage` (no new roll, no crit). |
| **Lucky** | Once per turn, reroll this creature's damage roll for free. | Offered as the first reroll prompt during the attacker's damage roll (before the Focus prompt). Consumes `usedLuckyThisTurn`. |
| **Brittle** | When this takes damage, roll d6: on 1 it takes 1 extra damage. | Rolled inside `_resolveDamage` before Defender reduction; on 1, `damage += 1`. |
| **Rally** | On enter, roll d6: on 4+ another friendly creature's ATK die steps up one size this turn (d4→d6→d8→d10→d12). | Triggered in `applyOnEnterEffects` (Pack Wolf, Warband Captain). Picks a random other friendly creature and calls `stepDieUp`. The buff reverts at the start of the *owner's next turn* via the `rallyBuffThisTurn` flag in `applyStartOfTurnEffects`. |
| **Regenerate** | At the start of your turn, roll d6: on 4+ this creature gains 2 HP. | Triggered in `applyStartOfTurnEffects`. Heals over the creature's nominal `hp` cap (no clamp). |
| **Volatile** | When this dies, roll d6: on 5–6 deal that much to a random enemy. | Triggered in `_sweepDead`. Random enemy = uniform pick from `[...enemyBoard, { isHero: true }]`. Damage = the rolled total. |
| **Rush** | This creature can attack the turn it is played (no summoning sickness). | At instance creation, `summoningSick = false` if `Rush` is present. |

---

## Full Card Catalog

60 cards total: **36 creatures** + **24 sorceries**. Plus the **Recruit token**.

Notes:
- IDs `C001`–`C036` are creatures. IDs `S001`–`S024` are sorceries.
- The set was authored in mixed ID order; this catalog lists creatures by cost asc, then sorceries by cost asc.
- "Keywords" lists keyword names only; non-default values are noted parenthetically.

### Creatures (36)

| ID | Name | Cost | ATK | HP | Keywords | Rarity | W | Max | Art | Rules Text |
|----|------|------|-----|----|----------|--------|---|-----|-----|------------|
| C001 | Kobold Scout | 1 | 1d4 | 2 | — | common | 4 | 3 | kobold_scout | A nimble scout that gets the first jab in. |
| C002 | Feral Gnoll | 1 | summon | 3 | Summon roll | uncommon | 3 | 2 | feral_gnoll | Summon roll (d6): ATK becomes the result for the rest of the game. |
| C006 | Sprite Trickster | 1 | 1d4 | 3 | — | uncommon | 3 | 2 | sprite_trickster | A nimble pixie — small but resilient. |
| C007 | Rabid Bat | 1 | 1d4 | 2 | Volatile | common | 4 | 3 | rabid_bat | Volatile: when this dies, roll d6; on 5–6 deal that much to a random enemy. |
| C008 | Torch Goblin | 1 | 1d4 | 2 | — | common | 4 | 3 | torch_goblin | When this enters play, roll d6: on 5–6, deal 1 damage to the enemy hero. |
| C009 | Stray Hound | 1 | 1d4 | 2 | Lucky | uncommon | 3 | 2 | stray_hound | Lucky: once per turn, you may reroll this creature's damage roll for free. |
| C003 | Shield Dwarf | 2 | 1d4 | 5 | Defender | common | 4 | 3 | shield_dwarf | Defender. When this is attacked, roll d6: on 4+, it takes 2 less damage from that attack. |
| C004 | Dire Wolf | 2 | 1d6 | 4 | Frenzy | uncommon | 3 | 2 | dire_wolf | Frenzy: after attacking, roll d6. On 5–6 it attacks once more for the same damage. |
| C010 | Goblin Archer | 2 | 1d6 | 4 | — | uncommon | 3 | 2 | goblin_archer | A sharpshooter — every shot finds its mark. |
| C011 | Thorn Sprite | 2 | 1d4 | 4 | — | common | 4 | 3 | thorn_sprite | When this is attacked, roll d6: on 4+, deal 2 damage back to the attacker. *(Flavour — standard retaliation already covers this in code; no dedicated handler exists for the d6-2 retaliation bonus.)* |
| C012 | Bog Lurker | 2 | 1d8 | 3 | Brittle | common | 4 | 3 | bog_lurker | Brittle: when this takes damage, roll d6; on a 1 it takes 1 extra. |
| C013 | Acolyte of Luck | 2 | 1d4 | 4 | — | uncommon | 3 | 2 | acolyte_of_luck | At the start of your turn, roll d6: on 5–6, gain 1 Focus. *(Player-only — the Focus tick is gated to `owner === 'player'`.)* |
| C014 | Wandering Knight | 2 | 1d6 | 4 | — | common | 4 | 3 | wandering_knight | A reliable body; its only randomness is its 1d6 damage. |
| C015 | Pack Wolf | 2 | 1d6 | 4 | Rally | uncommon | 3 | 2 | pack_wolf | Rally: on enter, roll d6; on 4+ another friendly creature gets +1 ATK die step this turn. |
| C005 | Stone Golem | 3 | 2d4 | 6 | Minimum roll (2) | uncommon | 3 | 2 | stone_golem | Minimum roll (treat 1s as 2s). |
| C016 | Ironhide Boar | 3 | 1d6 | 6 | Guardian | uncommon | 3 | 2 | ironhide_boar | Guardian: enemies must attack this unless they bypass it. |
| C017 | Flame Adept | 3 | 1d6 | 4 | — | rare | 2 | 2 | flame_adept | When this enters play, roll d6: deal that much damage split among enemy creatures as you choose. *(Implementation: damage is divided floor-evenly across all enemy creatures; "as you choose" is not a player target picker.)* |
| C018 | Temple Guard | 3 | 1d4 | 6 | Defender | common | 4 | 3 | temple_guard | Defender. When this is attacked, roll d6: on 4+, take half the damage (round up). |
| C019 | Berserker | 3 | 2d4 | 5 | Minimum roll (2) | uncommon | 3 | 2 | berserker | Minimum roll (treat 1s as 2s). A relentless attacker. |
| C020 | Trollkin Brute | 3 | 1d6 | 5 | Regenerate | uncommon | 3 | 2 | trollkin_brute | Regenerate: at the start of your turn, roll d6; on 4+ this creature gains 2 HP. |
| C021 | Cursed Marauder | 4 | 2d6 | 3 | Volatile, Brittle, Rush | rare | 2 | 2 | cursed_marauder | Rush. Volatile. Brittle. |
| C022 | Shadow Assassin | 4 | 2d6 | 2 | Rush | rare | 2 | 2 | shadow_assassin | Rush. When this creature critically hits (rolls max on every damage die), draw a card. |
| C023 | Pyromancer | 4 | 1d6 | 5 | — | uncommon | 3 | 2 | pyromancer | When this enters play, deal 1d6 damage to a random enemy creature. |
| C024 | Dwarven Defender | 4 | 1d6 | 8 | Guardian, Defender | rare | 2 | 2 | dwarven_defender | Guardian. Defender. When this is attacked, roll d6: on 3+, take 2 less damage. |
| C025 | Storm Caller | 4 | 2d4 | 5 | — | uncommon | 3 | 2 | storm_caller | When this attacks, roll d6: on 5–6, also deal 1d4 to the enemy hero. |
| C026 | Warband Captain | 4 | 1d6 | 6 | Rally, Frenzy | rare | 2 | 2 | warband_captain | Rally. Frenzy. |
| C027 | Ghoul Pack | 4 | 2d4 | 6 | Volatile | uncommon | 3 | 2 | ghoul_pack | Volatile. When this attacks, roll d6: on 5–6 it also deals 2 to the enemy hero. |
| C028 | Crystal Guardian | 4 | 1d6 | 9 | Minimum roll (2), Regenerate | rare | 2 | 2 | crystal_guardian | Minimum roll (treat 1s as 2s). Regenerate. |
| C029 | Frost Elemental | 5 | 2d4 | 7 | — | uncommon | 3 | 2 | frost_elemental | When this hits a creature, roll d6: on 5–6, that creature can't attack next turn. |
| C030 | Hill Giant | 5 | 2d6 | 8 | Minimum roll (2) | uncommon | 3 | 2 | hill_giant | Minimum roll (treat 1s as 2s). |
| C031 | Vampire Lord | 5 | 2d4 | 6 | — | rare | 2 | 2 | vampire_lord | When this deals combat damage, roll d6: on 4+, heal your hero that much. |
| C032 | Chaos Beast | 5 | 3d6 | 4 | Brittle, Volatile | legendary | 1 | 1 | chaos_beast | Brittle. Volatile. When this attacks, roll d6: on a 1 it attacks a random target instead. |
| C033 | War Troll | 6 | 2d6 | 9 | Regenerate, Minimum roll (2) | legendary | 1 | 1 | war_troll | Regenerate. Minimum roll (treat 1s as 2s). |
| C034 | Stone Colossus | 6 | 2d6 | 11 | Guardian | legendary | 1 | 1 | stone_colossus | Guardian. When this enters play, roll d6: gain that much HP. |
| C035 | Hydra | 6 | 2d4 | 8 | Frenzy | legendary | 1 | 1 | hydra | Frenzy. After attacking, roll d6: on 5–6 attack again for the same damage. |
| C036 | Ancient Dragon | 7 | 3d6 | 10 | Frenzy | legendary | 1 | 1 | ancient_dragon | On enter, breath weapon: deal 2d6 split among enemies as you choose. Frenzy. *(Implementation: 2d6 split floor-even among enemy creatures; if no creatures, the full 2d6 hits the enemy hero.)* |

### Sorceries (24)

| ID | Name | Cost | Keywords | Rarity | W | Max | Art | Rules Text |
|----|------|------|----------|--------|---|-----|-----|------------|
| S001 | Spark | 1 | — | common | 4 | 3 | spark | Deal 1d6 to any target. |
| S002 | Focus Ritual | 1 | — | common | 4 | 3 | focus_ritual | Gain 2 Focus. |
| S003 | Coin Flip | 1 | Gamble | uncommon | 3 | 2 | coin_flip | Gamble. Roll d6: on 4+ draw 2 cards; on 1–3 draw 1 card and take 1 damage. |
| S004 | Hex | 1 | Wild | common | 4 | 3 | hex | Wild. A random enemy creature deals -2 damage on its next attack (minimum 1). |
| S005 | Firebolt | 2 | — | common | 4 | 3 | firebolt | Deal 1d8 to any target. |
| S006 | Healing Word | 2 | — | common | 4 | 3 | healing_word | Restore 2d4 HP to your hero. |
| S007 | Lucky Draw | 2 | — | uncommon | 3 | 2 | lucky_draw | Roll d6: on 1–2 draw 1 card; on 3–4 draw 2; on 5–6 draw 3 (then discard down to 7). |
| S008 | Blessing | 2 | — | uncommon | 3 | 2 | blessing | Target friendly creature deals +2 damage on its next attack this turn. |
| S009 | Chain Lightning | 3 | Wild | uncommon | 3 | 2 | chain_lightning | Wild. Deal 2d6 damage split randomly among all enemy creatures. |
| S010 | Berserk Brew | 3 | Gamble | rare | 2 | 2 | berserk_brew | Gamble. Target friendly creature: roll d6. On 4+ roll 1d8 and add that to its next attack damage; on 1–3 it takes 2 damage. |
| S011 | Mend the Ranks | 3 | — | uncommon | 3 | 2 | mend_the_ranks | Roll d6: add that much HP to all friendly creatures. |
| S012 | Sap Strength | 3 | — | rare | 2 | 2 | sap_strength | Roll d6: on 5–6 the opponent loses 2 mana on their next turn; on 1–4 they lose 1. (Minimum 0.) |
| S013 | Fireball | 4 | — | uncommon | 3 | 2 | fireball | Deal 2d6 to any target. |
| S014 | Frost Nova | 4 | — | rare | 2 | 2 | frost_nova | Deal 1d4 to all enemy creatures; for each one hit, roll d6: on 5–6 it can't attack next turn. |
| S015 | Polymorph Gamble | 4 | Gamble | legendary | 1 | 1 | polymorph_gamble | Gamble. Roll d6: 1–2 your creature becomes a 1/1 sheep; 3–6 turn an enemy creature into a 1/1 sheep. |
| S016 | Second Wind | 4 | — | uncommon | 3 | 2 | second_wind | Restore 2d6 HP to your hero and draw a card. |
| S017 | Meteor | 5 | — | legendary | 1 | 1 | meteor | Deal 3d6 to a target; for each point of overkill, roll d6, on 5–6 return 1 HP to your hero (cap 5). |
| S018 | Mass Disarray | 5 | Wild | rare | 2 | 2 | mass_disarray | Wild. Roll d6 for each creature in play (both sides): on a 1 it deals no damage next turn. |
| S019 | Twin Fates | 5 | Gamble | legendary | 1 | 1 | twin_fates | Gamble. Roll 2d6 and deal the total to the enemy hero. If doubles, draw 2 cards instead. On a critical (6-6), deal double damage AND draw 2 cards. |
| S020 | Inferno | 6 | Wild | legendary | 1 | 1 | inferno | Wild. Deal 4d6 split randomly among all enemies (creatures and hero). |
| S021 | Divine Wrath | 6 | — | legendary | 1 | 1 | divine_wrath | Deal 2d8 to target enemy creature and 2d8 to the enemy hero. |
| S022 | Reinforcements | 6 | — | rare | 2 | 2 | reinforcements | Roll d6: summon that many 1/1 Recruit tokens. |
| S023 | Cataclysm | 7 | — | legendary | 1 | 1 | cataclysm | Deal 3d8 to all enemy creatures and 2d6 to the enemy hero. |
| S024 | Wheel of Fortune | 7 | Gamble | legendary | 1 | 1 | wheel_of_fortune | Gamble. Both players discard their hands; roll d6, each draws that many. Then roll again: on 5–6 you draw 1 extra. |

### Recruit Token

| ID | Name | Cost | ATK | HP | Keywords | Rarity | W | Max | Art | Notes |
|----|------|------|-----|----|----------|--------|---|-----|-----|-------|
| TOKEN_RECRUIT | Recruit | 0 | 1d4 | 1 | — | common | 0 | 0 | recruit | Summoned only by Reinforcements (S022). `weight: 0, maxPerDeck: 0` excludes it from `dealDeck`. Text: "1/1 creature token." |

---

## AI Opponent Reveal

After `rollPersonality()` resolves, a full-screen modal called the **personality
reveal panel** appears via `Game._showPersonalityReveal(name, pers)`:

- **Portrait** — `/assets/opponents/<name lowercased>.webp`.
- **Label** — "Your opponent is..."
- **Name** — Berserker / Tactician / Gambler.
- **Tell** — single-sentence behavioural cue (in quotes).
- **Summary** — 2-sentence playstyle description.
- **Tip** — counter-strategy hint.
- **Countdown bar** — 24-second visual countdown.
- **"Ready — Let's Duel!" button** — dismisses immediately. Enter key also dismisses.

If the player ignores the modal, it auto-dismisses at 24 seconds.

### Personality Copy

```js
Berserker: {
  emoji:   '⚔️',
  tell:    'Bring the fight to your face.',
  summary: 'Rushes you down with cheap, hard-hitting cards. Ignores creature trades — it wants your HP, not your creatures.',
  tip:     'Tip: get a Guardian or high-HP blocker down early. Slow it before it overwhelms you.',
},
Tactician: {
  emoji:   '🧠',
  tell:    'Trades you down to nothing.',
  summary: 'Methodical and patient. Plays keyword creatures, makes efficient trades, and wins by card advantage.',
  tip:     "Tip: go wide and aggressive. Don't let it grind you out — end the game before it stabilises.",
},
Gambler: {
  emoji:   '🎲',
  tell:    'Banks Focus for big swings.',
  summary: 'Unpredictable and chaotic. Hoards Focus to reroll, plays high-variance sorceries, and bets everything on big dice moments.',
  tip:     'Tip: stay healthy. Its big swings can backfire — outlast the chaos and punish the fumbles.',
},
```

The `rollPersonality` tile UI uses a shorter copy (range + one-line tip):
- Berserker: "Rolls 1–2 · Rushes face aggressively"
- Tactician: "Rolls 3–4 · Trades creatures efficiently"
- Gambler: "Rolls 5–6 · Big swings, high variance"

---

## UI / Screens

### Intro Screen (`#intro-screen`)

Mounted first; replaces the loading message. Shown before every match (initial
and Play Again).

- **Title** — "RNG Dungeon Duels" (`.intro-title`).
- **Tagline** — "Deck vs deck. Dice decide the details." (`.intro-tagline`).
- **How to Play grid** (`.intro-rules-grid`) — six rule cards (icon + heading + body):
  1. **🃏 Play Cards** — click a card in your hand; creatures summon, sorceries fire.
  2. **⚔️ Combat** — click attacker → click target. Auto-hit. Max-on-every-die = crit (double damage). Survivors retaliate.
  3. **🎲 Dice Decide** — every roll is live; spend 1 Focus to reroll; +1 Focus/turn (cap 5); Lucky creatures give a free reroll.
  4. **💎 Mana Ramp** — start at 1 (effectively turn-1 max), +1/turn up to 7.
  5. **⚠️ The Collapse** — starts round 5 (1d6); escalates to 2d6 from round 9.
  6. **🏆 Win & Score** — 0 HP loses; score = damage × 10 + speed bonus + HP × 20 + 500 win bonus.
- **Quick Tips** (`.intro-tips`) — summoning sickness, Guardian rule, crit rule, Enter to end turn.
- **Begin Duel button** (`#begin-duel-btn`).
- **Footer** — "Your opponent's personality is rolled at match start — adapt your strategy!"

The `?` help button (`#help-btn`) in the top-right re-shows this screen at any
time with the button relabelled to "Close".

### Game Screen — Board Layout

Three-row CSS grid (`.board`): opponent zone / center strip / player zone.

- **Opponent Zone (top)**:
  - Left HP bar (vertical `.stat-bar-track--hp`).
  - Center: opponent portrait + face-down hand cards row + opponent board (`#opp-board`).
  - Right Mana bar.
- **Center Strip** (the dice stage zone, 80px tall).
- **Player Zone (bottom)**:
  - Left HP bar.
  - Center: player board (`#player-board`), hand row (`#player-hand`) + actions column (`#player-actions`) with focus display and End Turn button.
  - Right Mana bar.

### Fixed Overlays

- **`#dice-stage`** — overlays the center when a dice roll is active. Holds the label, dice container, result text, context text, banner/buttons.
- **`#banner`** — outcome banner (CRITICAL HIT! / VICTORY! / COLLAPSE…).
- **`#modal`** — fullscreen modal (game-over panel, intro screen overlay).
- **`#game-log`** — bottom-left floating toast, shows the latest log line briefly then fades.
- **`#log-scroll`** — persistent scrolling log, top-right.
- **`#settings-toolbar`** — top-right cluster: turn counter, score, `?` help button, recover button (hidden by default; appears after a 2-minute AI hang), sound controls (🔊 / 🎵 / 💥).
- **`#collapse-indicator`** — top center: "Collapse in N rounds" → "⚠ COLLAPSE ACTIVE" from round 5.
- **`#attack-prompt`** — appears when an attacker is selected, instructs which targets are legal.
- **`#sorcery-prompt`** — sticky banner during target selection (e.g. "Spark — 5 damage").
- **`#phase-indicator`** — "Your Turn" / "Opponent's Turn".

### Modals

- **Personality reveal modal** — see *AI Opponent Reveal*.
- **Game-over modal** — `_endGame` calls `ui.showModal(...)` with:
  - "⚔ Victory!" or "💀 Defeat" heading.
  - Flavour sentence.
  - "Final Score: NNNN".
  - Score breakdown: "X dmg × 10 = ... + Speed bonus ... + HP bonus ... + Victory bonus ...".
  - Metadata line: turns | damage dealt | HP remaining.
  - "Play Again" button.

### Attack Targeting

`ui.drawAttackArc(fromEl, toEl, color, durationMs)` draws an SVG arc from the
attacker to the target card/portrait. Used for both player attacks (`#e07030`
default — orange) and opponent attacks (`#e05020`). Spell arcs use
`#c050d0` (purple), `#80d0ff` (frost), `#40c060` (heal/blessing), `#ff6020` /
`#ff4020` (fire), `#a070e0` (hex/polymorph), `#f0c040` (rally buffs).

---

## Visual Design

### Color Palette (CSS Custom Properties)

```css
:root {
  --color-bg:           #1a0f05;   /* dark sepia background */
  --color-board:        #2b1d0e;   /* board surface (slightly lighter) */
  --color-card-face:    #f5f0e8;   /* card face / cream */
  --color-text:         #f5f0e8;   /* primary text */
  --color-text-muted:   #a89880;   /* muted text */
  --color-mana:         #3a7bd5;   /* blue mana */
  --color-focus:        #e8a830;   /* gold focus */
  --color-hp:           #c0392b;   /* red HP */
  --color-accent:       #d4763a;   /* warm orange accent */
  --color-crit:         #ffd700;   /* crit gold */
  --color-collapse:     #1a0000;   /* deep red Collapse tint */
  --color-surface:      #3d2b1a;   /* raised surface */
  --color-border:       #ffffff18; /* hairline white border */

  --radius-card:        8px;
  --radius-die:         12px;
  --radius-modal:       12px;

  --card-w:             clamp(120px, 14vw, 250px);
  --card-h:             clamp(168px, 19.6vw, 350px);

  --z-modal:            900;
  --z-dice-stage:       1000;
  --z-banner:           1100;

  --transition-fast:    150ms ease;
  --transition-std:     250ms ease;
}
```

### Typography

- **Body**: `'Segoe UI', system-ui, sans-serif`.
- **Log / monospace**: `'SF Mono', 'Menlo', 'Consolas', monospace`.
- **Base size**: 16px, line-height 1.4.

### Rarity Visuals

- **Common** — grey border (`#7a7570`), flat box shadow, dark base.
- **Uncommon** — silver-blue border (`#9aa0a8`), subtle blue tint background, soft glow.
- **Rare** — gold border (`#d4b03a`), `rareGlow` 3s ease-in-out pulse animation (box-shadow bloom).
- **Legendary** — animated gradient shimmer (`legendaryShimmer`) + 2px vertical float (`legendaryFloat`). `justDrawn` legendary cards play a one-shot `legendaryReveal` animation.

### Responsive Layout

The entire game UI must fit on screen without any scrolling — horizontal or
vertical — down to a **13-inch laptop at 1280 × 800 viewport** (the practical
minimum). The layout must also remain usable on larger displays without looking
stretched or sparse.

#### Scaling Strategy

Use CSS `clamp()` and viewport-relative units throughout. The `--card-w` and
`--card-h` custom properties drive card size and must scale with the viewport:

```css
--card-w: clamp(120px, 14vw, 250px);
--card-h: clamp(168px, 19.6vw, 350px);   /* preserves 5:7 aspect ratio */
```

All font sizes on cards, stat bars, and the center strip should use
`clamp()`-based values so they compress gracefully rather than overflow.

The three-row board grid must use `vh`-based row heights (or `fr` units with a
fixed total `100dvh`) so the full board — opponent zone, center strip, player
zone — always fits within the visible viewport at any supported resolution.

#### Hover-to-Read

At small viewport sizes card text becomes difficult to read. The hover
interaction compensates:

- **All cards** (hand and board, both player and opponent) scale up on hover to
  a **fixed legible size** (`250px × 350px` minimum, or `scale` to that
  equivalent) regardless of the current responsive card size.
- `transform-origin: bottom center` for hand cards (grows upward, away from the
  edge); `transform-origin: top center` for board cards (grows downward, into
  free space).
- The hover scale is computed dynamically: `max(1.25, 250 / currentCardWidth)`
  so the card always reaches at minimum its full design size.
- The enlarged card overlays neighboring cards and the board chrome — it must
  be at a high enough `z-index` to appear on top.
- The transition is `150ms ease` to feel snappy, not sluggish.

This ensures that even on a 13-inch screen where cards render at ~120 × 168px,
a player can hover any card to read its full rules text at a comfortable size.

### Card

- Base size driven by `--card-w` / `--card-h` CSS custom properties (responsive,
  see Responsive Layout above). Design baseline: 250px × 350px.
- Border-radius: 8px.
- Hover: scales up to at least 250 × 350px equivalent (`transform-origin: bottom center`
  for hand cards, `top center` for board cards), `transition: 150ms ease`.
- Active (click): `scale(1.05)`.

### Animations (Keyframes)

| Name | Use |
|------|-----|
| `rareGlow` | Rare card box-shadow pulse. |
| `legendaryShimmer` | Legendary card background gradient sweep. |
| `legendaryFloat` | Legendary card vertical bob. |
| `legendaryReveal` | One-shot reveal for newly drawn legendaries. |
| `dieRoll` | Die tumble — 720° rotation, scale wobble, duration set via `--roll-duration`. |
| `dieSettle` | Die landing — scale 1.3 → 0.92 → 1.08 → 1 over 300ms. |
| `screenShake` | Body shake (400ms) — for crits, Collapse rumble, fumbles. |
| `critBurst` | Gold radial overlay, scale 1→3, fade out (600ms). |
| `hpPulse` | Low-HP red pulse on HP bar. |
| `canAttackPulse` | Soft glow on creatures eligible to attack. |
| `validTargetPulse` | Highlight on legal attack targets and sorcery targets. |
| `sorceryPromptPulse` | Sticky sorcery prompt attention pulse. |

### Collapse Atmosphere

- Round 5+: red-tinted dice border (`rgba(200,30,0,0.5)`), darkened inset shadow on the dice stage, escalating screen-shake.
- Body shake + collapse rumble sound when the Collapse roll resolves.
- Ambient music switches to the `collapse` mood.

### Board Recession During Dice Rolls

When `#dice-stage.active` is set, `#board.dice-active` applies
`filter: blur(1px) brightness(0.6)` and `pointer-events: none` so the board
"recedes" behind the dice stage and remains uninteractable.

---

## Audio

Pure Web Audio synthesis — no audio files. Implemented in `audio.js`.
`AudioContext` is created on the first user gesture (the Begin Duel click) via
`initAudio()`. Settings are kept in module-level booleans (`_sfxEnabled`,
`_ambientEnabled`); both default to `true`.

User controls (top-right toolbar):
- **🔊 / 🔇** — toggle all sound (both SFX and ambient).
- **🎵** — toggle ambient music only.
- **💥** — toggle SFX only.

### Sound Effects (8)

Each is a one-shot synthesized through Web Audio nodes.

| Sound | Trigger | Recipe |
|-------|---------|--------|
| **dice-clatter** | `rollDice` start; reroll restart; `rollFirstPlayer` / `rollPersonality` roll. | 5–8 rapid white-noise bursts. Each burst: 40–80 ms; bandpass filter, frequency randomised 800–3200 Hz, Q=1.5. Gain envelope: 0 → 0.25 over 5ms attack, exponential decay to 0.001 over `duration`. Staggered every `0.07 + random*0.03` seconds. |
| **dice-settle** | After dice land. | Two simultaneous voices. **Thud**: sine, freq 80→30 Hz exponential ramp over 200ms; gain 0 → 0.5 over 8ms, exp decay to 0.001 over 200ms. **Tick**: sine, 800 Hz, 50ms; gain 0 → 0.15 over 3ms, exp decay over 50ms. |
| **crit-fanfare** | Player crits (`isMaxRoll && !isAI && !isCollapse`). | Square-wave arpeggio: C5 → E5 → G5 → C6 (523.25, 659.25, 783.99, 1046.5 Hz). Each note 100ms duration, 80ms gap. Gain envelope per note: 0 → 0.12 over 5ms, exp decay over 100ms. Then a **shimmer**: sine sweep 1000→2000 Hz over 300ms; gain 0 → 0.08 over 20ms, exp decay over 300ms. |
| **fumble-doom** | Defined in audio.js but **not currently dispatched** by `playSound` calls in the codebase. Synthesis is wired and ready for future use. | Two detuned sines (base + 3 Hz). Each: frequency 200→60 Hz exponential ramp over 500ms; gain 0 → 0.2 over 20ms, exp decay over 500ms. |
| **collapse-rumble** | Collapse roll (`isCollapse && !isAI && isMaxRoll`). | **Sub-bass**: sine, 50 Hz, gain 0 → 0.4 over 50ms, hold to 600ms, exp decay over 200ms (total ~800ms). **Mid pulses**: three square waves at 80 Hz, 200ms apart. Each pulse: gain 0 → 0.15 over 10ms, exp decay over 120ms. |
| **card-play** | Every card played (player or AI). | **Whoosh**: white noise, highpass filter sweeping 3000→400 Hz over 150ms; gain 0 → 0.2 over 10ms, exp decay over 150ms. **Tone**: sine, 440 Hz, 80ms; gain 0 → 0.1 over 5ms, exp decay over 80ms. |
| **victory** | Game over, player wins. | Square-wave 5-note arpeggio: C4 → E4 → G4 → C5 → E5 (261.63, 329.63, 392.00, 523.25, 659.25 Hz). 120ms note duration, 100ms gap. Last note: hold 120ms then 600ms exponential fade (reverb tail). Per-note gain envelope 0 → 0.15 over 8ms, exp decay over note duration. |
| **defeat** | Game over, player loses. | Sine 3-note descent: A3 → F3 → D3 (220, 174.61, 146.83 Hz). 200ms note duration, 180ms gap. Per-note gain 0 → 0.2 over 20ms, exp decay over 200ms. **Shared lowpass filter** Q=0.8, cutoff 600 Hz applied across all notes. **Master gain** 1.0 → 0.001 exponential ramp over 1 second after last note. |

### Ambient Music (3 Moods)

A continuous chiptune-style loop. The current mood is set via `setAmbientMood`
and transitions take effect at the **next loop boundary** so phrases never cut
mid-note. Each mood has a melody (square wave) and bass (triangle wave).

#### `calm` — rounds 1–2

A-minor pentatonic feel; contemplative dungeon exploration.

- `masterGain: 0.08`, `bassGain: 0.06`.
- **Melody** (24 notes; `[freq Hz, dur s]`):
  ```
  [220,0.25] [261,0.25] [329,0.25] [440,0.5]
  [392,0.25] [349,0.25] [329,0.5]
  [293,0.25] [349,0.25] [440,0.25] [587,0.5]
  [523,0.25] [493,0.25] [440,0.75]
  [392,0.25] [440,0.25] [493,0.25] [523,0.5]
  [440,0.25] [392,0.25] [349,0.5]
  [329,0.25] [392,0.25] [523,0.25] [493,0.5]
  [220,1.0]
  ```
- **Bass**: `[110,1] [82,1] [110,1] [98,1] [87,2] [82,2]`.

#### `tense` — rounds 3–4

A harmonic minor (raised 7th, A4 G#5 F E etc.); dread building, faster tempo.

- `masterGain: 0.09`, `bassGain: 0.08`.
- **Melody**:
  ```
  [220,0.2] [261,0.2] [329,0.2] [415,0.4]    // A4 C5 E5 G#5
  [440,0.2] [349,0.2] [329,0.4]              // A5 F5 E5
  [293,0.2] [261,0.2] [220,0.2] [196,0.4]    // D5 C5 A4 G4
  [220,0.15] [261,0.15] [329,0.15] [415,0.15]
  [440,0.3] [415,0.3]
  [349,0.2] [329,0.2] [293,0.4]
  [220,0.8]
  ```
- **Bass** (heartbeat dotted figure): `[82,0.5] [82,0.5] [73,0.5] [73,0.5] [110,0.4] [110,0.4] [98,0.4] [98,0.4] [82,1.0] [73,1.0]`.

#### `collapse` — round 5+

Tritone-laced (A + Eb), low octave, driving pulse.

- `masterGain: 0.10`, `bassGain: 0.10`.
- **Melody**:
  ```
  [220,0.15] [311,0.15] [349,0.15] [440,0.3]    // A C# F A — tritone
  [349,0.2] [311,0.2] [220,0.4]
  [261,0.15] [311,0.15] [349,0.15] [415,0.3]
  [440,0.2] [415,0.2] [349,0.4]
  [220,0.15] [349,0.15] [220,0.15] [349,0.3]
  [196,0.6]
  [220,0.8]
  ```
- **Bass** (earthquake throb): `[65,0.35] [65,0.35] [65,0.35] [65,0.35] [73,0.35] [73,0.35] [73,0.35] [73,0.35] [55,0.7] [49,0.7]`.

### Voice Routing

Per melody note: square oscillator → per-note gain (linear ramp 0→0.12 in 10ms,
hold at 0.10, linear ramp to 0 over last 20ms) → master gain → destination.

Per bass note: triangle oscillator → per-note gain (linear from `bassGain` to
`bassGain*0.5` then to 0 over last 20ms) → master gain → destination.

The loop reschedules itself 500ms before its current cycle ends so the next
mood can be picked up cleanly.

---

## Asset Inventory

All assets live under `public/assets/`. Filenames are lowercased with
underscores; the `art` field on each card matches the filename basename.

### `public/assets/board/`

- `arena_duel.webp` — main board background. Wired in `ui.js` (`buildBoard`) with an `onload` handler so it falls back to the CSS background if missing.

### `public/assets/opponents/`

- `berserker.webp`
- `tactician.webp`
- `gambler.webp`

Used by the personality tile row (`rollPersonality`) and the personality
reveal modal (`_showPersonalityReveal`).

### `public/assets/cards/` (61 files)

All `art` references in `cards.js` mapped to `<art>.webp`. 60 cards + 1 token.

```
acolyte_of_luck.webp   ancient_dragon.webp    berserk_brew.webp      berserker.webp
blessing.webp          bog_lurker.webp        cataclysm.webp         chain_lightning.webp
chaos_beast.webp       coin_flip.webp         crystal_guardian.webp  cursed_marauder.webp
dire_wolf.webp         divine_wrath.webp      dwarven_defender.webp  feral_gnoll.webp
fireball.webp          firebolt.webp          flame_adept.webp       focus_ritual.webp
frost_elemental.webp   frost_nova.webp        ghoul_pack.webp        goblin_archer.webp
healing_word.webp      hex.webp               hill_giant.webp        hydra.webp
inferno.webp           ironhide_boar.webp     kobold_scout.webp      lucky_draw.webp
mass_disarray.webp     mend_the_ranks.webp    meteor.webp            pack_wolf.webp
polymorph_gamble.webp  pyromancer.webp        rabid_bat.webp         recruit.webp
reinforcements.webp    sap_strength.webp      second_wind.webp       shadow_assassin.webp
shield_dwarf.webp      spark.webp             sprite_trickster.webp  stone_colossus.webp
stone_golem.webp       storm_caller.webp      stray_hound.webp       temple_guard.webp
thorn_sprite.webp      torch_goblin.webp      trollkin_brute.webp    twin_fates.webp
vampire_lord.webp      wandering_knight.webp  war_troll.webp         warband_captain.webp
wheel_of_fortune.webp
```

All 60 card `art` fields in `cards.js` map 1-to-1 to a file in this directory.
The Recruit token's `art: 'recruit'` maps to `recruit.webp`.

### Preloading

`Game._preloadImages()` fires-and-forgets `new Image()` requests for every URL
above while the intro screen is up, so when the player clicks Begin Duel the
images are already in the HTTP cache.

---

## Controls

| Input | Action |
|-------|--------|
| **Click card in hand** | Play the card (deduct mana, summon creature or fire sorcery). |
| **Click own creature** | Select as attacker. Click again to deselect. |
| **Click enemy creature** | If an attacker is selected: attack it. If a sorcery is mid-target: target it. |
| **Click opponent portrait** | Attack the enemy hero (only if no Guardian is alive on the enemy board). |
| **Click own creature during sorcery target** | Pick as the friendly target. |
| **Enter** | End turn (when player's turn is active and not locked). Also confirms reroll prompts and dismisses pause buttons. |
| **Escape** | Cancel attacker selection. During sorcery target selection, cancel the spell (mana stays spent). |
| **Click End Turn button** | End turn. Locked for 2 seconds at the start of each player turn. |
| **Click `?` button** | Re-open the intro / how-to-play screen. |
| **Click 🔊 / 🎵 / 💥** | Toggle all sound / ambient / SFX respectively. |
| **Click "⚡ Resume"** | Appears after 2 minutes of AI hang; manually forces back to player turn. |
| **Click reroll prompt buttons** | Yes/No on Lucky and Focus reroll prompts. |
| **Click Play Again** | Restart the match from the intro screen. |

---

## No Backend

RNG Dungeon Duels is a **pure static site**. There is:

- **No server** beyond the static file host. No Node, no Express, no API routes.
- **No database**. No persistence.
- **No accounts, no auth, no sessions, no cookies**.
- **No score persistence, no remote ranking**. The final score is shown on the game-over modal and discarded when the player closes the tab or clicks Play Again. Nothing is sent over the network.
- **No analytics, no telemetry, no third-party requests**. All assets are served from the same origin as the page.
- **No build step**. ES modules are served and executed directly by the browser.
- **No external runtime dependencies**. No npm install, no node_modules — the game uses only browser APIs (DOM, Web Audio, SVG).
- **No environment variables, no secrets, no config files**.

Everything happens in the browser tab: dice rolls, AI decisions, deck shuffles,
audio synthesis. Refresh the page and you get a brand-new match with freshly
shuffled decks and a freshly rolled opponent personality.

---

## Art Generation

All assets are painterly digital fantasy illustrations generated via AI (Gemini
or equivalent). When regenerating assets, **prepend the global preamble to
every prompt** before submitting.

### Global Preamble

> Painterly digital fantasy illustration, rich saturated colors, dramatic
> lighting, dungeons-and-dragons tabletop aesthetic, clean readable silhouette,
> slight vignette. CRITICAL: Standalone full-bleed background and character
> artwork only. DO NOT generate card borders. DO NOT generate frames. DO NOT
> leave blank boxes for text, titles, or numbers. DO NOT include nameplates,
> banners, labels, headers, or any user interface elements. No text, no
> watermarks, no layout panels. The subject must seamlessly blend into a
> continuous background environment. A tall vertical poster composition.

Aspect ratio for all card images: **2:3 or 5:7 (portrait)**.
Save all generated card images to `public/assets/cards/` as `.webp`.

### Creature Card Art (`public/assets/cards/`)

| Filename | Prompt |
|----------|--------|
| `kobold_scout.webp` | A small nimble kobold scout with a short bow, alert pose, scanning a dim rocky cavern, dynamic low-angle composition. |
| `feral_gnoll.webp` | A savage hyena-like gnoll warrior baring razor-sharp teeth, holding a crude iron battle axe, blood-red moonlit wilderness background. |
| `sprite_trickster.webp` | A mischievous glowing blue pixie sprite laughing and juggling floating spheres of dim starlight, dark enchanted forest setting. |
| `rabid_bat.webp` | A massive, frenzied monstrous bat screeching with bared fangs, tattered wings, diving down through a foggy gothic graveyard. |
| `torch_goblin.webp` | A crazed goblin cackling wildly while running with a sputtering, blazing tar torch, scattering orange embers in a dark cellar. |
| `stray_hound.webp` | A lean, battle-scarred stray hound with alert glowing golden eyes, standing defensively on a rain-slicked medieval city street. |
| `shield_dwarf.webp` | A stout dwarf warrior braced completely behind a massive, battered iron-rimmed round shield, determined expression, stone corridor behind him. |
| `dire_wolf.webp` | A massive snarling dire wolf with shaggy grey fur, icy blue glowing eyes, lunging forward through deep snow under a pine canopy. |
| `goblin_archer.webp` | A sly goblin archer drawing back a crooked, notched wooden bow, one eye closed tightly in concentration, lurking on a rocky ridge. |
| `thorn_sprite.webp` | A defensive nature sprite made of jagged wood and sharp green briar thorns, defiant posture, blooming glowing flora background. |
| `bog_lurker.webp` | A murky, half-submerged swamp monster made of moss and rotted logs, white glowing eyes peeking out from dark misty water. |
| `acolyte_of_luck.webp` | A young smiling monk acolyte in jade robes, rolling three glowing golden runic dice across a polished wooden monastery floor. |
| `wandering_knight.webp` | A stalwart traveling knight in polished steel plate armor, holding a gleaming longsword upright, windswept grassy field backdrop. |
| `pack_wolf.webp` | A hunting grey timber wolf howling at a pale moon, dynamic composition with shadows of other wolves fading into the misty woods behind it. |
| `stone_golem.webp` | A hulking monolith golem constructed of ancient mossy carved stones, bright cyan runic cracks glowing across its body, standing guard. |
| `ironhide_boar.webp` | A massive, aggressive wild boar with metallic grey skin and thick iron-like hide, charging headlong through dense underbrush. |
| `flame_adept.webp` | A fierce mage apprentice manifesting multiple spinning fireballs in orbit around their outstretched hands, casting a strong orange glow. |
| `temple_guard.webp` | A solemn sentinel armored in heavy marble plate armor, holding a gold halberd, standing at the grand entrance of a sun-drenched temple. |
| `berserker.webp` | A furious bare-chested northern barbarian mid-roar, swinging a massive double-bitted great axe, motion blur accentuating raw strength. |
| `trollkin_brute.webp` | A muscular troll kin brawler with green warty skin, heavily bandaged fists, smiling aggressively in a muddy combat pit. |
| `cursed_marauder.webp` | A spectral, gaunt skeletal raider clad in rotted leather armor, holding a cracked, glowing purple broadsword that bleeds dark smoke. |
| `shadow_assassin.webp` | A hooded rogue completely wreathed in whisps of living black smoke, wielding twin curved obsidian daggers, crouching in a dark alleyway. |
| `pyromancer.webp` | An elite robed sorcerer conjuring a massive, swirling orb of raging white-hot fire, amber embers floating in the dark background. |
| `dwarven_defender.webp` | A heavily armored dwarf knight planting a massive tower shield firmly into the cracked stone floor, glowing gold sigils etched on the metal. |
| `storm_caller.webp` | A wild-haired shaman holding a wooden staff skyward as branching fork lightning arcs across a stormy, cloud-filled dark sky. |
| `warband_captain.webp` | A scarred orc warlord in spiked iron plate armor, pointing a broadsword forward aggressively, tattered war banners waving in the wind. |
| `ghoul_pack.webp` | A ravenous pack of glowing-eyed ghouls clambering over ancient stone tombs in a desolate, foggy, moonlit churchyard. |
| `crystal_guardian.webp` | An elegant crystalline construct formed from translucent sapphire gems, refracting beams of bright light from an inner magical core. |
| `frost_elemental.webp` | A towering, humanoid elemental made of jagged blue glacier ice and swirling blizzard mist, its cold hands freezing the air. |
| `hill_giant.webp` | A lumbering hill giant carrying a massive uprooted oak tree trunk as a club, wandering through a rocky highland valley. |
| `vampire_lord.webp` | An aristocratic vampire count in a velvet crimson cape, holding a silver chalice filling with glowing red energy, dark castle interior. |
| `chaos_beast.webp` | A horrific, shifting monstrosity made of tentacles, eyes, and iridescent color-changing plasma, floating in a warped planar void. |
| `war_troll.webp` | A massive brutish war troll with iron armor plates bolted directly to its thick grey skin, wielding a heavy metal-spiked club. |
| `stone_colossus.webp` | A mountain-sized titan carved from bedrock, its chest emitting a brilliant golden core radiance, towering over small pine trees. |
| `hydra.webp` | A terrifying multi-headed marsh serpent, three heads snapping forward with venomous green fangs bare, dark swamp setting. |
| `ancient_dragon.webp` | An imposing ancient red dragon with iridescent scales and sprawling bat wings, breathing a cone of fire downward from a high mountain peak. |
| `recruit.webp` | A young, determined human foot soldier holding a simple steel shortsword and wooden buckler shield, wearing a clean leather jerkin. |

### Sorcery Card Art (`public/assets/cards/`)

| Filename | Prompt |
|----------|--------|
| `spark.webp` | A small but blindingly bright crackle of electrical static electricity bursting violently from the tip of a pointer finger. |
| `focus_ritual.webp` | Glowing arcane symbols and geometric magic circles hovering over a meditating wizard's open upturned hands, serene teal magical light. |
| `coin_flip.webp` | A gold coin spinning mid-air in slow motion, splitting into bright light on one half and casting a dark heavy shadow on the other half. |
| `hex.webp` | Sinister, toxic green smoke wisps curling into the shape of a screaming skull, wrapping around an invisible cursed target. |
| `firebolt.webp` | A single concentrated projectile bolt of roaring fire streaking diagonally through dark air, leaving a bright heat motion trail. |
| `healing_word.webp` | A warm, comforting cascade of shimmering golden stardust floating gently downward from a holy rift in a dark ceiling. |
| `lucky_draw.webp` | Three blank magical cards bursting out from a glowing cascade of kaleidoscopic luck energy, sparkling trail accents. |
| `blessing.webp` | A brilliant beam of divine sunlight piercing through dark clouds, bathing the area in a protective celestial golden aura. |
| `chain_lightning.webp` | A massive branch of volatile blue lightning striking a single point and splitting off into three smaller arcs running outwards. |
| `berserk_brew.webp` | A bubbling glass vial filled with a violent, glowing neon-crimson potion, boiling over and spitting angry red sparks. |
| `mend_the_ranks.webp` | An expansive ring of pulsing emerald-green restorative light expanding outward along a cracked battlefield floor. |
| `sap_strength.webp` | Ghostly spectral vines of dull purple energy reaching up out of the floor, draining the vital color and light away from a center point. |
| `fireball.webp` | A massive exploding sphere of churning red and orange flame expanding outward violently, generating a blinding white heat core. |
| `frost_nova.webp` | A freezing shockwave of sharp ice shards and white frost mist blasting outward horizontally across a frozen ground plane. |
| `polymorph_gamble.webp` | A whimsical, unpredictable swirl of pink and purple transmutation magic with a funny, startled white sheep silhouette materializing inside. |
| `second_wind.webp` | A swirling vortex of refreshing bright blue wind and golden holy light rushing upward, symbolizing a sudden burst of vital energy. |
| `meteor.webp` | A colossal blazing meteor enveloped in a thick layer of fire crashing violently into the earth, creating a shockwave of molten rock. |
| `mass_disarray.webp` | A chaotic field of warped mirrors and twisting psychological energy patterns, fracturing light and breaking spatial reality. |
| `twin_fates.webp` | Two massive ethereal scales hanging in balance, one filled with brilliant golden light, the other filled with heavy, dark violet plasma. |
| `inferno.webp` | A literal sea of fire consuming everything, waves of pure rolling molten lava and towering pillars of black soot and flame. |
| `divine_wrath.webp` | A massive vertical column of pure blinding holy light smashing down from the heavens, blasting away shadow with solar radiance. |
| `reinforcements.webp` | A luminous, ghostly glowing ethereal army of knights holding swords, charging forward out of a massive magical gateway portal. |
| `cataclysm.webp` | The earth violently tearing open, jagged stone pillars shifting upward while deep volcanic red lava geysers burst from ground cracks. |
| `wheel_of_fortune.webp` | A colossal, floating ancient stone wheel carved with glowing red, blue, and green runes, spinning rapidly in a starry cosmic void. |

### Board Art (`public/assets/board/`)

Aspect ratio: **16:9 landscape**.

| Filename | Prompt |
|----------|--------|
| `arena_duel.webp` | A wide atmospheric fantasy duel arena, a colossal stone battlefield split cleanly into two facing lanes, illuminated by low burning iron wall torches. The background is dark, moody, and shrouded in shadows so foreground cards pop. The center is flat and clean to host dice animations. |

### Opponent Portraits (`public/assets/opponents/`)

Use the global preamble. Aspect ratio: **1:1 or 2:3 (portrait)**.

| Filename | Prompt |
|----------|--------|
| `berserker.webp` | A furious bare-chested northern barbarian warlord, wild red hair, battle scars, roaring with absolute rage, dramatic torchlit dungeon background. |
| `tactician.webp` | A composed, calculating elven strategist in dark leather tactical armor, cold analytical eyes studying an invisible battlefield, candlelit war room. |
| `gambler.webp` | A roguish, grinning half-elf with a wide-brimmed hat, shuffling glowing runic cards between nimble fingers, dimly lit tavern background. |
