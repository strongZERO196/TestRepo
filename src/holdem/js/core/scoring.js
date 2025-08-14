// ポーカー役評価（純粋ロジック）

// 返却: [cat, ...kickers] 大きい方が強い。cat: 8=SF 7=4K 6=FH 5=F 4=S 3=3K 2=2P 1=1P 0=HC
export function score5(cards) {
  const ranks = cards.map(c => c.r).sort((a,b)=>b-a);
  const suits = cards.map(c => c.s);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r)||0)+1);
  const byCount = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
  const isFlush = suits.every(s => s === suits[0]);
  const uniq = [...new Set(ranks)];
  // ストレート（A-5対応）
  let isStraight = false, topStraight = 0;
  const rset = uniq;
  for (let i = 0; i <= rset.length - 5; i++) {
    const a=rset[i], b=rset[i+1], c=rset[i+2], d=rset[i+3], e=rset[i+4];
    if (a===b+1 && b===c+1 && c===d+1 && d===e+1) { isStraight=true; topStraight=a; break; }
  }
  if (!isStraight && rset.includes(14) && rset.includes(5) && rset.includes(4) && rset.includes(3) && rset.includes(2)) {
    isStraight = true; topStraight = 5;
  }
  if (isStraight && isFlush) return [8, topStraight];
  if (byCount[0][1] === 4) return [7, byCount[0][0], byCount.find(e=>e[1]===1)[0]];
  if (byCount[0][1] === 3 && byCount[1][1] === 2) return [6, byCount[0][0], byCount[1][0]];
  if (isFlush) return [5, ...ranks];
  if (isStraight) return [4, topStraight];
  if (byCount[0][1] === 3) {
    const kick = ranks.filter(r=>r!==byCount[0][0]);
    return [3, byCount[0][0], ...kick];
  }
  if (byCount[0][1] === 2 && byCount[1]?.[1] === 2) {
    const high = Math.max(byCount[0][0], byCount[1][0]);
    const low = Math.min(byCount[0][0], byCount[1][0]);
    const kick = ranks.filter(r=>r!==high && r!==low)[0];
    return [2, high, low, kick];
  }
  if (byCount[0][1] === 2) {
    const pair = byCount[0][0];
    const kick = ranks.filter(r=>r!==pair);
    return [1, pair, ...kick];
  }
  return [0, ...ranks];
}

export function compareScore(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const n = Math.max(a.length, b.length);
  for (let i=0;i<n;i++) {
    const av = a[i]||0, bv = b[i]||0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function bestScoreFrom(cards) {
  // 7枚以下のカードから最良5枚のスコアを返す
  let best = null;
  if (cards.length <= 5) return score5(cards);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i+1; j < cards.length; j++) {
      const five = cards.filter((_, idx) => idx!==i && idx!==j);
      const s = score5(five);
      if (!best || compareScore(s, best) > 0) best = s;
    }
  }
  return best;
}

export function best5Detailed(cards7) {
  let best = null; let bestCards = [];
  for (let i = 0; i < cards7.length; i++) {
    for (let j = i+1; j < cards7.length; j++) {
      const five = cards7.filter((_, idx) => idx!==i && idx!==j);
      const s = score5(five);
      if (!best || compareScore(s, best) > 0) { best = s; bestCards = five; }
    }
  }
  return { score: best, used: bestCards };
}

export function decisiveUsedCards(used, score) {
  // usedの中で役形成に寄与しているカードを返す（目安として）
  if (!Array.isArray(used) || !score) return [];
  const cat = score[0] || 0;
  const ranks = used.map(c => c.r);
  const counts = new Map();
  ranks.forEach(r => counts.set(r, (counts.get(r)||0)+1));
  if (cat === 8 || cat === 4) { // ストレート/ストフラは5枚すべて
    return used;
  }
  if (cat === 7) { // 4K
    const r4 = [...counts.entries()].find(e=>e[1]===4)?.[0];
    return used.filter(c=>c.r===r4);
  }
  if (cat === 6) { // フルハウス
    const r3 = [...counts.entries()].find(e=>e[1]===3)?.[0];
    const r2 = [...counts.entries()].find(e=>e[1]===2)?.[0];
    return used.filter(c=>c.r===r3 || c.r===r2);
  }
  if (cat === 5) { // フラッシュ
    const suit = used[0]?.s;
    return used.filter(c=>c.s===suit);
  }
  if (cat === 3) { // 3K
    const r3 = [...counts.entries()].find(e=>e[1]===3)?.[0];
    return used.filter(c=>c.r===r3);
  }
  if (cat === 2) { // 2P
    const pairs = [...counts.entries()].filter(e=>e[1]===2).map(e=>e[0]);
    return used.filter(c=>pairs.includes(c.r));
  }
  if (cat === 1) { // 1P
    const r2 = [...counts.entries()].find(e=>e[1]===2)?.[0];
    return used.filter(c=>c.r===r2);
  }
  // ハイカード
  return [used[0]];
}

