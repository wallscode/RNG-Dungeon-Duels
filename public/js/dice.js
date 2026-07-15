// dice.js — Dice presentation: rollDice (with reroll prompts), rollFirstPlayer, rollPersonality.
// Owns the #dice-stage overlay. All rolls are Promises that resolve when the stage clears.

import { playSound } from './audio.js';

const REROLL_PROMPT_MS = 9000;
const TUMBLE_MS = 700;
const SETTLE_PAUSE_MS = 650;

export function parseNotation(notation) {
  const m = /^(\d+)d(\d+)$/.exec(String(notation).trim());
  if (!m) return null; // flat number ("3") or 'summon'
  return { count: Number(m[1]), sides: Number(m[2]) };
}

export function isCritRoll(notation, rolls) {
  const p = parseNotation(notation);
  if (!p || !rolls || rolls.length === 0) return false;
  return rolls.every((r) => r === p.sides);
}

function rollRaw(notation) {
  const p = parseNotation(notation);
  if (!p) {
    const flat = Number(notation);
    return { rolls: [], total: Number.isFinite(flat) ? flat : 0, flat: true };
  }
  const rolls = [];
  for (let i = 0; i < p.count; i++) rolls.push(1 + Math.floor(Math.random() * p.sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0), flat: false };
}

// ── Stage DOM helpers ────────────────────────────────────────────────────────

function stage() { return document.getElementById('dice-stage'); }
function board() { return document.getElementById('board'); }

function openStage({ isCollapse = false } = {}) {
  const s = stage();
  s.innerHTML = '';
  s.classList.add('active');
  s.classList.toggle('collapse-roll', isCollapse);
  board()?.classList.add('dice-active');
  return s;
}

export function closeStage() {
  const s = stage();
  s.classList.remove('active', 'collapse-roll');
  s.innerHTML = '';
  board()?.classList.remove('dice-active');
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeDie(sides) {
  const d = el('div', `die die-d${sides}`, '?');
  d.style.setProperty('--roll-duration', `${TUMBLE_MS + Math.floor(Math.random() * 200)}ms`);
  return d;
}

async function tumbleDice(diceEls, rolls, sides) {
  playSound('dice-clatter');
  diceEls.forEach((d) => {
    d.classList.remove('settled');
    d.classList.add('rolling');
  });
  const interval = setInterval(() => {
    diceEls.forEach((d) => { d.textContent = 1 + Math.floor(Math.random() * sides); });
  }, 80);
  await sleep(TUMBLE_MS);
  clearInterval(interval);
  diceEls.forEach((d, i) => {
    d.classList.remove('rolling');
    d.classList.add('settled');
    d.textContent = rolls[i];
  });
  playSound('dice-settle');
  await sleep(300); // dieSettle animation length
}

function showResultLine(s, text, cls = '') {
  let line = s.querySelector('.dice-result');
  if (!line) { line = el('div', 'dice-result'); s.appendChild(line); }
  line.textContent = text;
  line.className = `dice-result ${cls}`.trim();
}

// Countdown prompt inside the stage. Resolves true (yes) / false (no or timeout).
function promptYesNo(s, yesLabel) {
  return new Promise((resolve) => {
    const wrap = el('div', 'dice-prompt');
    const bar = el('div', 'dice-prompt-countdown');
    const inner = el('div', 'dice-prompt-countdown-inner');
    bar.appendChild(inner);
    const btnYes = el('button', 'dice-btn dice-btn-yes', yesLabel);
    const btnNo = el('button', 'dice-btn dice-btn-no', 'No');
    wrap.append(btnYes, btnNo, bar);
    s.appendChild(wrap);

    inner.style.transitionDuration = `${REROLL_PROMPT_MS}ms`;
    requestAnimationFrame(() => { inner.style.transform = 'scaleX(0)'; });

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(val);
    };
    const timer = setTimeout(() => finish(false), REROLL_PROMPT_MS);
    const onKey = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } };
    document.addEventListener('keydown', onKey);
    btnYes.addEventListener('click', () => finish(true));
    btnNo.addEventListener('click', () => finish(false));
  });
}

// ── rollDice ─────────────────────────────────────────────────────────────────
//
// opts:
//   notation       'XdY' or flat number string
//   label          headline above the dice ("Dire Wolf attacks!")
//   context        secondary line ("vs Shield Dwarf")
//   isAI           AI-owned roll: never prompts
//   isCollapse     Collapse roll: red tint, no reroll, collapse banner handled by caller
//   allowReroll    default true; false suppresses all prompts
//   bestThreshold  if roll.total >= this, the roll already "hit best" — no prompt
//   reroll         { luckyAvailable, onLucky(), getFocus(), spendFocus() } | null
//   onCrit(result) optional callback fired when the final result is a crit
//
// Resolves { rolls, total, isCrit, notation, rerolled, usedLucky, usedFocus }.

export async function rollDice(opts) {
  const {
    notation, label = 'Rolling…', context = '',
    isAI = false, isCollapse = false, allowReroll = true,
    bestThreshold = null, reroll = null,
  } = opts;

  const p = parseNotation(notation);

  // Flat damage — no dice, no stage.
  if (!p) {
    const flat = rollRaw(notation);
    return { rolls: [], total: flat.total, isCrit: false, notation, rerolled: false, usedLucky: false, usedFocus: false };
  }

  const s = openStage({ isCollapse });
  s.appendChild(el('div', 'dice-label', label));
  if (context) s.appendChild(el('div', 'dice-context', context));
  const diceRow = el('div', 'dice-row');
  const diceEls = [];
  for (let i = 0; i < p.count; i++) {
    const d = makeDie(p.sides);
    diceEls.push(d);
    diceRow.appendChild(d);
  }
  s.appendChild(diceRow);

  let result = rollRaw(notation);
  let rerolled = false;
  let usedLucky = false;
  let usedFocus = false;

  const canPromptAtAll = !isAI && !isCollapse && allowReroll && reroll;

  for (;;) {
    await tumbleDice(diceEls, result.rolls, p.sides);
    const crit = isCritRoll(notation, result.rolls);
    showResultLine(s, `Total: ${result.total}`, crit ? 'crit' : '');
    if (crit) diceEls.forEach((d) => d.classList.add('crit'));
    else diceEls.forEach((d) => d.classList.remove('crit'));

    if (crit) break; // max on every die — no reason to reroll
    if (bestThreshold !== null && result.total >= bestThreshold) break;
    if (!canPromptAtAll) break;

    if (reroll.luckyAvailable && !usedLucky) {
      const yes = await promptYesNo(s, 'Reroll — Yes (Free)');
      if (!yes) break; // declining Lucky skips the Focus prompt on this roll
      usedLucky = true;
      rerolled = true;
      reroll.onLucky?.();
      result = rollRaw(notation);
      continue;
    }

    if (reroll.getFocus && reroll.getFocus() >= 1) {
      const yes = await promptYesNo(s, 'Reroll — Yes (−1 Focus)');
      if (!yes) break;
      usedFocus = true;
      rerolled = true;
      reroll.spendFocus();
      result = rollRaw(notation);
      continue;
    }

    break;
  }

  const isCrit = isCritRoll(notation, result.rolls);
  if (isCrit && opts.onCrit) opts.onCrit(result);
  // AI rolls linger longer so the player can absorb what just happened.
  await sleep(isAI ? 1300 : SETTLE_PAUSE_MS);
  closeStage();
  return { rolls: result.rolls.slice(), total: result.total, isCrit, notation, rerolled, usedLucky, usedFocus };
}

// ── rollFirstPlayer ──────────────────────────────────────────────────────────
// 1d6 each, re-roll ties. Resolves 'player' | 'opponent'.

export async function rollFirstPlayer() {
  const s = openStage();
  s.appendChild(el('div', 'dice-label', 'Roll for first player!'));
  const row = el('div', 'dice-row dice-row-versus');
  const youCol = el('div', 'dice-col');
  youCol.appendChild(el('div', 'dice-col-label', 'You'));
  const youDie = makeDie(6);
  youCol.appendChild(youDie);
  const oppCol = el('div', 'dice-col');
  oppCol.appendChild(el('div', 'dice-col-label', 'Opponent'));
  const oppDie = makeDie(6);
  oppCol.appendChild(oppDie);
  row.append(youCol, oppCol);
  s.appendChild(row);

  let winner = null;
  for (;;) {
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    await Promise.all([tumbleDice([youDie], [a], 6), tumbleDice([oppDie], [b], 6)]);
    if (a > b) { winner = 'player'; showResultLine(s, `You roll ${a} — opponent rolls ${b}. You go first!`); break; }
    if (b > a) { winner = 'opponent'; showResultLine(s, `You roll ${a} — opponent rolls ${b}. Opponent goes first.`); break; }
    showResultLine(s, `Tie at ${a} — rolling again…`);
    await sleep(700);
  }
  await sleep(1300);
  closeStage();
  return winner;
}

// ── rollPersonality ──────────────────────────────────────────────────────────
// Shows all three opponent tiles, rolls 1d6 (1–2 Berserker, 3–4 Tactician,
// 5–6 Gambler), highlights the winner, dims the others. Resolves the name.

const PERSONALITY_TILES = [
  { name: 'Berserker', range: 'Rolls 1–2 · Rushes face aggressively', emoji: '⚔️' },
  { name: 'Tactician', range: 'Rolls 3–4 · Trades creatures efficiently', emoji: '🧠' },
  { name: 'Gambler', range: 'Rolls 5–6 · Big swings, high variance', emoji: '🎲' },
];

export async function rollPersonality() {
  const s = openStage();
  s.appendChild(el('div', 'dice-label', 'Rolling your opponent…'));
  const tiles = el('div', 'personality-tiles');
  const tileEls = PERSONALITY_TILES.map((t) => {
    const tile = el('div', 'personality-tile');
    const img = document.createElement('img');
    img.src = `assets/opponents/${t.name.toLowerCase()}.webp`;
    img.alt = t.name;
    img.onerror = () => { img.remove(); };
    const fallback = el('div', 'personality-tile-emoji', t.emoji);
    tile.append(img, fallback, el('div', 'personality-tile-name', t.name), el('div', 'personality-tile-range', t.range));
    tiles.appendChild(tile);
    return tile;
  });
  s.appendChild(tiles);

  const die = makeDie(6);
  const row = el('div', 'dice-row');
  row.appendChild(die);
  s.appendChild(row);

  const roll = 1 + Math.floor(Math.random() * 6);
  await tumbleDice([die], [roll], 6);

  const idx = roll <= 2 ? 0 : roll <= 4 ? 1 : 2;
  tileEls.forEach((t, i) => t.classList.add(i === idx ? 'chosen' : 'dimmed'));
  const name = PERSONALITY_TILES[idx].name;
  showResultLine(s, `Rolled ${roll} — ${name}!`);
  await sleep(1800);
  closeStage();
  return name;
}
