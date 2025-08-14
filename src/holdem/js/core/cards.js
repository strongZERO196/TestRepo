// カードユーティリティ（純粋ロジック）
export const SUITS = ['♠','♥','♦','♣'];
export const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // 11:J 12:Q 13:K 14:A

export function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ r, s });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function rankLabel(r) {
  if (r <= 10) return String(r);
  return {11:'J',12:'Q',13:'K',14:'A'}[r];
}

export function sameCard(a, b) { return a && b && a.r === b.r && a.s === b.s; }

export function removeCardFrom(arr, card) {
  const idx = arr.findIndex(c => sameCard(c, card));
  if (idx >= 0) arr.splice(idx, 1);
}

export function cloneDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({r,s});
  return d;
}

