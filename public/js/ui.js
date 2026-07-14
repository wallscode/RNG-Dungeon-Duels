// ui.js — DOM building (buildBoard), state rendering (render), banners, modals,
// SVG attack arcs, log/toast, active-card pin, target highlighting, intro screen.
// Placeholder art: every <img> falls back to a styled CSS placeholder when the
// .webp asset is missing, so the game is fully playable before art exists.

import { KEYWORD_TEXT, TIER1_KEYWORDS } from './keywords.js';

const HP_MAX = 25;
const MANA_MAX = 7;
const HP_DANGER = 8;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Board construction ───────────────────────────────────────────────────────

export function buildBoard(root) {
  root.innerHTML = '';

  const board = el('div', 'board');
  board.id = 'board';

  // Board background art with CSS fallback if missing.
  const bg = new Image();
  bg.onload = () => { board.style.backgroundImage = `url('assets/board/arena_duel.webp')`; };
  bg.src = 'assets/board/arena_duel.webp';

  // Opponent zone.
  const oppZone = el('div', 'zone zone-opponent');
  oppZone.appendChild(statCol('opp-hp', 'HP', 'hp'));
  const oppCenter = el('div', 'zone-center');
  const oppTop = el('div', 'opp-top-row');
  const oppPortrait = el('div', 'portrait');
  oppPortrait.id = 'opp-portrait';
  oppPortrait.dataset.target = 'opp-hero';
  oppTop.appendChild(oppPortrait);
  const oppHand = el('div', 'hand-row hand-facedown');
  oppHand.id = 'opp-hand';
  oppTop.appendChild(oppHand);
  oppCenter.appendChild(oppTop);
  const oppBoard = el('div', 'board-row');
  oppBoard.id = 'opp-board';
  oppCenter.appendChild(oppBoard);
  oppZone.appendChild(oppCenter);
  oppZone.appendChild(statCol('opp-mana', 'Mana', 'mana'));
  board.appendChild(oppZone);

  // Center strip (dice stage overlays this area).
  board.appendChild(el('div', 'zone zone-center-strip'));

  // Player zone.
  const playerZone = el('div', 'zone zone-player');
  playerZone.appendChild(statCol('player-hp', 'HP', 'hp'));
  const playerCenter = el('div', 'zone-center');
  const playerBoard = el('div', 'board-row');
  playerBoard.id = 'player-board';
  playerCenter.appendChild(playerBoard);
  const bottomRow = el('div', 'player-bottom-row');
  const hand = el('div', 'hand-row');
  hand.id = 'player-hand';
  bottomRow.appendChild(hand);
  const actions = el('div', '');
  actions.id = 'player-actions';
  const focus = el('div', 'focus-display');
  focus.id = 'focus-display';
  actions.appendChild(focus);
  const endTurn = el('button', 'end-turn-btn', 'End Turn');
  endTurn.id = 'end-turn-btn';
  actions.appendChild(endTurn);
  bottomRow.appendChild(actions);
  playerCenter.appendChild(bottomRow);
  playerZone.appendChild(playerCenter);
  playerZone.appendChild(statCol('player-mana', 'Mana', 'mana'));
  board.appendChild(playerZone);

  root.appendChild(board);

  // Keyword legend strip (Tier 1).
  const legend = el('div', '');
  legend.id = 'keyword-legend';
  for (const k of TIER1_KEYWORDS) {
    const chip = el('span', 'legend-chip', k);
    chip.title = KEYWORD_TEXT[k];
    legend.appendChild(chip);
  }
  root.appendChild(legend);

  // Fixed overlays.
  const collapseInd = el('div', '');
  collapseInd.id = 'collapse-indicator';
  root.appendChild(collapseInd);

  const phase = el('div', '');
  phase.id = 'phase-indicator';
  root.appendChild(phase);

  const attackPrompt = el('div', '');
  attackPrompt.id = 'attack-prompt';
  root.appendChild(attackPrompt);

  const sorceryPrompt = el('div', '');
  sorceryPrompt.id = 'sorcery-prompt';
  root.appendChild(sorceryPrompt);

  // Settings toolbar.
  const toolbar = el('div', '');
  toolbar.id = 'settings-toolbar';
  const turnCounter = el('span', 'toolbar-stat');
  turnCounter.id = 'turn-counter';
  const helpBtn = el('button', 'toolbar-btn', '?');
  helpBtn.id = 'help-btn';
  helpBtn.title = 'How to play';
  const recoverBtn = el('button', 'toolbar-btn recover-btn', '⚡ Resume');
  recoverBtn.id = 'recover-btn';
  recoverBtn.hidden = true;
  const sndAll = el('button', 'toolbar-btn', '🔊');
  sndAll.id = 'snd-all-btn';
  sndAll.title = 'Toggle all sound';
  const sndMusic = el('button', 'toolbar-btn', '🎵');
  sndMusic.id = 'snd-music-btn';
  sndMusic.title = 'Toggle ambient music';
  const sndSfx = el('button', 'toolbar-btn', '💥');
  sndSfx.id = 'snd-sfx-btn';
  sndSfx.title = 'Toggle sound effects';
  toolbar.append(turnCounter, helpBtn, recoverBtn, sndAll, sndMusic, sndSfx);
  root.appendChild(toolbar);

  // Logs.
  const logScroll = el('div', '');
  logScroll.id = 'log-scroll';
  root.appendChild(logScroll);
  const gameLog = el('div', '');
  gameLog.id = 'game-log';
  root.appendChild(gameLog);

  // Dice stage / banner / modal / card pin.
  const dice = el('div', '');
  dice.id = 'dice-stage';
  root.appendChild(dice);
  const banner = el('div', '');
  banner.id = 'banner';
  root.appendChild(banner);
  const modal = el('div', '');
  modal.id = 'modal';
  root.appendChild(modal);
  const pin = el('div', '');
  pin.id = 'active-card-pin';
  root.appendChild(pin);

  // SVG overlay for attack arcs.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'arc-svg';
  root.appendChild(svg);

  // Intro screen container.
  const intro = el('div', '');
  intro.id = 'intro-screen';
  intro.hidden = true;
  root.appendChild(intro);
}

function statCol(id, label, kind) {
  const col = el('div', 'stat-col');
  const track = el('div', `stat-bar-track stat-bar-track--${kind}`);
  const fill = el('div', 'stat-bar-fill');
  fill.id = `${id}-fill`;
  track.appendChild(fill);
  const value = el('div', 'stat-bar-value');
  value.id = `${id}-value`;
  col.append(track, value, el('div', 'stat-bar-label', label));
  return col;
}

// ── Card elements ────────────────────────────────────────────────────────────

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function buildCardEl(card, { zone, justDrawn = false } = {}) {
  const isCreature = card.type === 'creature';
  const div = el('div', `card rarity-${card.rarity} card-${card.type} zone-${zone}`);
  div.dataset.cardId = card.id;
  if (card.instanceId) div.dataset.instanceId = card.instanceId;
  if (justDrawn && card.rarity === 'legendary') div.classList.add('just-drawn');

  const cost = el('div', 'card-cost', String(card.cost));
  div.appendChild(cost);

  const art = el('div', 'card-art');
  const fallback = el('div', 'card-art-fallback');
  fallback.appendChild(el('span', 'card-art-initials', initials(card.name)));
  fallback.appendChild(el('span', 'card-art-icon', isCreature ? '⚔️' : '✨'));
  art.appendChild(fallback);
  const img = new Image();
  img.alt = card.name;
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  img.src = `assets/cards/${card.art}.webp`;
  art.appendChild(img);
  div.appendChild(art);

  div.appendChild(el('div', 'card-name', card.name));

  if (card.keywords.length > 0) {
    const chips = el('div', 'card-keywords');
    for (const k of card.keywords) {
      const chip = el('span', 'keyword-chip', k.value !== undefined ? `${k.name} (${k.value})` : k.name);
      chip.title = KEYWORD_TEXT[k.name] || '';
      chips.appendChild(chip);
    }
    div.appendChild(chips);
  }

  div.appendChild(el('div', 'card-text', card.text));

  if (isCreature) {
    const stats = el('div', 'card-stats');
    const atkVal = card.currentAtk || card.atk;
    stats.appendChild(el('span', 'card-atk', atkVal === 'summon' ? 'd6?' : String(atkVal)));
    const hpVal = card.currentHp !== undefined ? card.currentHp : card.hp;
    const hpEl = el('span', 'card-hp', String(hpVal));
    if (card.currentHp !== undefined && card.currentHp < card.hp) hpEl.classList.add('wounded');
    stats.appendChild(hpEl);
    div.appendChild(stats);
  }

  return div;
}

function buildCardBack() {
  const div = el('div', 'card card-back');
  div.appendChild(el('div', 'card-back-pattern', '🎲'));
  return div;
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function render(game) {
  const s = game.state;

  renderBar('player-hp', s.player.hp, HP_MAX, s.player.hp <= HP_DANGER);
  renderBar('opp-hp', s.opponent.hp, HP_MAX, s.opponent.hp <= HP_DANGER);
  renderBar('player-mana', s.player.mana, MANA_MAX, false, `${s.player.mana}/${s.player.maxMana}`);
  renderBar('opp-mana', s.opponent.mana, MANA_MAX, false, `${s.opponent.mana}/${s.opponent.maxMana}`);

  // Opponent portrait.
  const portrait = document.getElementById('opp-portrait');
  const pName = s.opponent.personality;
  if (pName && !portrait.dataset.rendered) {
    portrait.dataset.rendered = '1';
    portrait.innerHTML = '';
    const img = new Image();
    img.alt = pName;
    img.onerror = () => img.remove();
    img.src = `assets/opponents/${pName.toLowerCase()}.webp`;
    portrait.appendChild(img);
    portrait.appendChild(el('div', 'portrait-emoji', { Berserker: '⚔️', Tactician: '🧠', Gambler: '🎲' }[pName]));
    portrait.appendChild(el('div', 'portrait-name', pName));
  }

  // Opponent hand (face-down).
  const oppHand = document.getElementById('opp-hand');
  oppHand.innerHTML = '';
  for (let i = 0; i < s.opponent.hand.length; i++) oppHand.appendChild(buildCardBack());

  // Boards.
  renderBoardRow('opp-board', s.opponent.board, game, 'opponent');
  renderBoardRow('player-board', s.player.board, game, 'player');

  // Player hand.
  const hand = document.getElementById('player-hand');
  hand.innerHTML = '';
  s.player.hand.forEach((card, i) => {
    const cardEl = buildCardEl(card, { zone: 'hand', justDrawn: card._justDrawn });
    delete card._justDrawn;
    cardEl.dataset.handIndex = String(i);
    if (s.phase === 'player-turn') {
      cardEl.classList.add(card.cost <= s.player.mana ? 'playable' : 'unplayable');
    }
    hand.appendChild(cardEl);
  });

  // Focus + End Turn.
  const focus = document.getElementById('focus-display');
  focus.innerHTML = '';
  focus.appendChild(el('span', 'focus-label', 'Focus'));
  const pips = el('span', 'focus-pips');
  for (let i = 0; i < 5; i++) {
    pips.appendChild(el('span', `focus-pip${i < s.player.focus ? ' lit' : ''}`, '◆'));
  }
  focus.appendChild(pips);

  const endTurn = document.getElementById('end-turn-btn');
  endTurn.disabled = s.phase !== 'player-turn' || game.endTurnLocked;

  // Toolbar.
  document.getElementById('turn-counter').textContent = `Turn ${s.turnNumber}`;

  // Collapse indicator.
  const ci = document.getElementById('collapse-indicator');
  if (s.turnNumber >= 5) {
    ci.textContent = '⚠ COLLAPSE ACTIVE';
    ci.classList.add('active');
  } else {
    ci.textContent = `Collapse in ${5 - s.turnNumber} round${5 - s.turnNumber === 1 ? '' : 's'}`;
    ci.classList.remove('active');
  }

  // Phase indicator.
  const pi = document.getElementById('phase-indicator');
  pi.textContent = s.phase === 'player-turn' ? 'Your Turn'
    : s.phase === 'ai-turn' ? 'Opponent’s Turn' : '';
  pi.classList.toggle('player', s.phase === 'player-turn');
}

function renderBar(id, value, max, danger, label) {
  const fill = document.getElementById(`${id}-fill`);
  const val = document.getElementById(`${id}-value`);
  if (!fill) return;
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  fill.style.height = `${pct}%`;
  fill.classList.toggle('danger', danger);
  val.textContent = label !== undefined ? label : String(Math.max(0, value));
}

function renderBoardRow(id, boardArr, game, side) {
  const row = document.getElementById(id);
  row.innerHTML = '';
  const s = game.state;
  for (const creature of boardArr) {
    if (creature.currentHp <= 0) continue;
    const cardEl = buildCardEl(creature, { zone: 'board' });
    cardEl.dataset.side = side;
    // Renders happen in quick bursts (play → effects → sweep); keep the
    // play-in animation alive across rebuilds within its window.
    if (creature._justPlayed && Date.now() - creature._justPlayed < 600) {
      cardEl.classList.add('just-played');
    }
    if (side === 'player' && s.phase === 'player-turn'
        && !creature.summoningSick && !creature.cantAttackThisTurn && !creature.hasAttackedThisTurn) {
      cardEl.classList.add('can-attack');
    }
    if (creature.summoningSick) cardEl.classList.add('summoning-sick');
    if (creature.cantAttackThisTurn) cardEl.classList.add('frozen');
    if (creature.hasAttackedThisTurn) cardEl.classList.add('has-attacked');
    if (game.selectedAttacker === creature.instanceId) cardEl.classList.add('selected');
    row.appendChild(cardEl);
  }
}

// ── Log / toast ──────────────────────────────────────────────────────────────

let toastTimer = null;

export function log(msg) {
  const scroll = document.getElementById('log-scroll');
  if (scroll) {
    const line = el('div', 'log-line', msg);
    scroll.appendChild(line);
    while (scroll.children.length > 80) scroll.firstChild.remove();
    scroll.scrollTop = scroll.scrollHeight;
  }
  const toast = document.getElementById('game-log');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
  }
}

// ── Banner ───────────────────────────────────────────────────────────────────

let bannerTimer = null;

export function banner(text, cls = '', durationMs = 1400) {
  const b = document.getElementById('banner');
  b.textContent = text;
  b.className = `visible ${cls}`.trim();
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = ''; }, durationMs);
}

export function screenShake() {
  document.body.classList.remove('shake');
  void document.body.offsetWidth; // restart animation
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 450);
}

export function critBurst() {
  const burst = el('div', 'crit-burst');
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 650);
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function showModal({ title, bodyEl, buttonLabel = 'OK', onButton, extraClass = '' }) {
  const modal = document.getElementById('modal');
  modal.innerHTML = '';
  modal.className = `visible ${extraClass}`.trim();
  const panel = el('div', 'modal-panel');
  if (title) panel.appendChild(el('h2', 'modal-title', title));
  if (bodyEl) panel.appendChild(bodyEl);
  const btn = el('button', 'modal-btn', buttonLabel);
  btn.addEventListener('click', () => { hideModal(); onButton?.(); });
  panel.appendChild(btn);
  modal.appendChild(panel);

  const onKey = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      document.removeEventListener('keydown', onKey);
      hideModal();
      onButton?.();
    }
  };
  document.addEventListener('keydown', onKey);
  modal._keyHandler = onKey;
  return { panel, btn };
}

export function hideModal() {
  const modal = document.getElementById('modal');
  if (modal._keyHandler) {
    document.removeEventListener('keydown', modal._keyHandler);
    modal._keyHandler = null;
  }
  modal.className = '';
  modal.innerHTML = '';
}

// Personality reveal: portrait + tell + summary + tip; 24s auto-dismiss with
// countdown bar. Resolves when dismissed.
export function showPersonalityReveal(name, copy) {
  return new Promise((resolve) => {
    const body = el('div', 'reveal-body');
    const portraitWrap = el('div', 'reveal-portrait');
    const img = new Image();
    img.alt = name;
    img.onerror = () => img.remove();
    img.src = `assets/opponents/${name.toLowerCase()}.webp`;
    portraitWrap.appendChild(img);
    portraitWrap.appendChild(el('div', 'reveal-emoji', copy.emoji));
    body.appendChild(portraitWrap);
    body.appendChild(el('div', 'reveal-label', 'Your opponent is…'));
    body.appendChild(el('div', 'reveal-name', name));
    body.appendChild(el('div', 'reveal-tell', `“${copy.tell}”`));
    body.appendChild(el('div', 'reveal-summary', copy.summary));
    body.appendChild(el('div', 'reveal-tip', copy.tip));
    const bar = el('div', 'reveal-countdown');
    const inner = el('div', 'reveal-countdown-inner');
    bar.appendChild(inner);
    body.appendChild(bar);

    let timer = null;
    const done = () => { clearTimeout(timer); resolve(); };
    showModal({
      bodyEl: body,
      buttonLabel: 'Ready — Let’s Duel!',
      onButton: done,
      extraClass: 'reveal-modal',
    });
    inner.style.transitionDuration = '24000ms';
    requestAnimationFrame(() => { inner.style.transform = 'scaleX(0)'; });
    timer = setTimeout(() => { hideModal(); resolve(); }, 24000);
  });
}

// ── Active-card pin ──────────────────────────────────────────────────────────

// side 'opponent' hovers the card over the centre of the opponent's play
// space; 'player' (default) pins it to the left edge.
export function setActiveCard(card, label, side = 'player') {
  const pin = document.getElementById('active-card-pin');
  pin.innerHTML = '';
  pin.classList.toggle('opp-cast', side === 'opponent');
  pin.appendChild(el('div', 'pin-label', label));
  pin.appendChild(buildCardEl(card, { zone: 'pin' }));
  pin.classList.add('visible');
}

export function clearActiveCard() {
  const pin = document.getElementById('active-card-pin');
  pin.classList.remove('visible', 'opp-cast');
  pin.innerHTML = '';
}

// ── Attack arcs ──────────────────────────────────────────────────────────────

export function drawAttackArc(fromEl, toEl, color = '#e07030', durationMs = 600) {
  if (!fromEl || !toEl) return;
  const svg = document.getElementById('arc-svg');
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const x1 = a.left + a.width / 2;
  const y1 = a.top + a.height / 2;
  const x2 = b.left + b.width / 2;
  const y2 = b.top + b.height / 2;
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - 60;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  const len = path.getTotalLength?.() || 500;
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  svg.appendChild(path);
  path.style.transition = `stroke-dashoffset ${durationMs * 0.6}ms ease-out, opacity 200ms ease`;
  requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
  setTimeout(() => { path.style.opacity = '0'; }, durationMs * 0.7);
  setTimeout(() => path.remove(), durationMs + 250);
}

// ── Target highlighting / prompts ────────────────────────────────────────────

export function highlightTargets(els) {
  clearTargetHighlights();
  for (const e of els) e.classList.add('valid-target');
}

export function clearTargetHighlights() {
  document.querySelectorAll('.valid-target').forEach((e) => e.classList.remove('valid-target'));
}

export function showAttackPrompt(text) {
  const p = document.getElementById('attack-prompt');
  p.textContent = text;
  p.classList.add('visible');
}

export function hideAttackPrompt() {
  document.getElementById('attack-prompt').classList.remove('visible');
}

// Shows the sticky sorcery/target prompt. Pass durationMs for timed decisions
// — a countdown bar fills the prompt's bottom edge so the deadline is visible.
export function showSorceryPrompt(text, durationMs = null) {
  const p = document.getElementById('sorcery-prompt');
  p.innerHTML = '';
  p.appendChild(el('div', 'prompt-text', text));
  if (durationMs) {
    const bar = el('div', 'prompt-countdown');
    const inner = el('div', 'prompt-countdown-inner');
    bar.appendChild(inner);
    p.appendChild(bar);
    inner.style.transitionDuration = `${durationMs}ms`;
    requestAnimationFrame(() => { inner.style.transform = 'scaleX(0)'; });
  }
  p.classList.add('visible');
}

export function hideSorceryPrompt() {
  const p = document.getElementById('sorcery-prompt');
  p.classList.remove('visible');
  p.innerHTML = '';
}

// ── Intro screen ─────────────────────────────────────────────────────────────

const RULE_CARDS = [
  { icon: '🃏', heading: 'Play Cards', body: 'Click a card in your hand; creatures summon, sorceries fire.' },
  { icon: '⚔️', heading: 'Combat', body: 'Click attacker → click target. Auto-hit. Max on every die = crit (double damage). Survivors retaliate.' },
  { icon: '🎲', heading: 'Dice Decide', body: 'Every roll is live; spend 1 Focus to reroll; +1 Focus/turn (cap 5); Lucky creatures give a free reroll.' },
  { icon: '💎', heading: 'Mana Ramp', body: 'Start at 1, +1 per turn up to 7. Mana refills every turn.' },
  { icon: '⚠️', heading: 'The Collapse', body: 'Starts round 5: 1d6 to both heroes each round — 2d6 from round 9. Nobody is safe.' },
  { icon: '🏆', heading: 'Win', body: 'Reduce the enemy hero to 0 HP before The Collapse claims you both.' },
];

const QUICK_TIPS = [
  'Creatures can’t attack the turn they’re played (unless they have Rush).',
  'If the enemy has a Guardian, you must attack it first.',
  'A crit = max on every die — it doubles the damage.',
  'Press Enter to end your turn.',
];

export function showIntro({ onBegin, helpMode = false }) {
  const intro = document.getElementById('intro-screen');
  intro.innerHTML = '';
  intro.hidden = false;

  const inner = el('div', 'intro-inner');
  inner.appendChild(el('h1', 'intro-title', 'RNG Dungeon Duels'));
  inner.appendChild(el('p', 'intro-tagline', 'Deck vs deck. Dice decide the details.'));

  const grid = el('div', 'intro-rules-grid');
  for (const r of RULE_CARDS) {
    const card = el('div', 'intro-rule-card');
    card.appendChild(el('div', 'intro-rule-icon', r.icon));
    card.appendChild(el('div', 'intro-rule-heading', r.heading));
    card.appendChild(el('div', 'intro-rule-body', r.body));
    grid.appendChild(card);
  }
  inner.appendChild(grid);

  const tips = el('div', 'intro-tips');
  tips.appendChild(el('div', 'intro-tips-heading', 'Quick Tips'));
  for (const t of QUICK_TIPS) tips.appendChild(el('div', 'intro-tip', `• ${t}`));
  inner.appendChild(tips);

  const btn = el('button', 'begin-duel-btn', helpMode ? 'Close' : 'Begin Duel');
  btn.id = 'begin-duel-btn';
  btn.addEventListener('click', () => {
    intro.hidden = true;
    intro.innerHTML = '';
    onBegin?.();
  });
  inner.appendChild(btn);

  inner.appendChild(el('p', 'intro-footer',
    'Your opponent’s personality is rolled at match start — adapt your strategy!'));

  intro.appendChild(inner);
}

export function hideIntro() {
  const intro = document.getElementById('intro-screen');
  intro.hidden = true;
  intro.innerHTML = '';
}
