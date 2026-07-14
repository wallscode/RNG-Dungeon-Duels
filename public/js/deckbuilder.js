// deckbuilder.js — dealDeck(CARDS): 30-card weighted-curve deck, Fisher-Yates shuffled.

const CURVE = { 1: 6, 2: 7, 3: 6, 4: 5, 5: 3, 6: 2, 7: 1 }; // total 30

function weightedPick(candidates) {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

function fisherYatesShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function dealDeck(cards) {
  const deck = [];
  const counts = new Map(); // card id -> copies in this deck

  const eligible = (card) => card.weight > 0 && (counts.get(card.id) || 0) < card.maxPerDeck;
  const addCard = (card) => {
    deck.push(card);
    counts.set(card.id, (counts.get(card.id) || 0) + 1);
  };

  // Track how many slots each cost bucket still owes; spill unfillable slots
  // to the nearest lower cost bucket.
  const need = { ...CURVE };
  const costs = Object.keys(CURVE).map(Number).sort((a, b) => a - b);

  for (const cost of costs) {
    while (need[cost] > 0) {
      const candidates = cards.filter((c) => c.cost === cost && eligible(c));
      if (candidates.length === 0) break;
      addCard(weightedPick(candidates));
      need[cost]--;
    }
    if (need[cost] > 0) {
      // Spill remaining slots to the nearest lower cost bucket.
      const lower = costs.filter((c) => c < cost).pop();
      if (lower !== undefined) {
        need[lower] += need[cost];
        need[cost] = 0;
      }
    }
  }

  // Final fill-from-any-eligible pass: spilled slots may have landed in
  // already-processed buckets; top the deck up to 30 from anywhere eligible.
  while (deck.length < 30) {
    const candidates = cards.filter(eligible);
    if (candidates.length === 0) break; // pool exhausted — as close to 30 as it allows
    addCard(weightedPick(candidates));
  }

  return fisherYatesShuffle(deck);
}
