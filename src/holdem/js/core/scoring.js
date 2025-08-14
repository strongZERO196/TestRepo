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

// スコアを0..1の概略強さへマップ
export function scoreStrength01(score, board, hand) {
  if (!score) return 0;
  const cat = score[0] || 0;
  let base = cat / 8; // 0..1
  // 役ごとの微調整
  const rTop = (v)=> (v||0)/14;
  if (cat === 4 || cat === 8) base += 0.08 * rTop(score[1]); // ストレート(フラッシュ)のトップ
  else if (cat === 7) base += 0.04 * rTop(score[1]); // 4Kのランク
  else if (cat === 6) base += 0.03 * rTop(score[1]); // フルハウス
  else if (cat === 5) base += 0.05 * rTop(score[1]); // フラッシュのハイカード
  else if (cat === 3 || cat === 2 || cat === 1) base += 0.03 * rTop(score[1]);

  // ドロー補正（ざっくり）
  const cards = [...(hand||[]), ...(board||[])];
  const suits = new Map();
  cards.forEach(c=>suits.set(c.s,(suits.get(c.s)||0)+1));
  let maxSuit = 0; let favSuit=null; for (const [s,n] of suits){ if(n>maxSuit){ maxSuit=n; favSuit=s; } }
  if (maxSuit === 4 && (hand||[]).some(c=>c.s===favSuit)) base += 0.12; // フラッシュドロー
  // ストレートドロー簡易
  const ranks = [...new Set(cards.map(c=>c.r))].sort((a,b)=>b-a);
  for (let i=0;i<=ranks.length-4;i++){
    const a=ranks[i],b=ranks[i+1],c=ranks[i+2],d=ranks[i+3];
    if (a===b+1 && b===c+1 && (c===d+1 || c-1===d)) { base += 0.1; break; }
  }
  // オーバーカード（ハイカード時のみ少し）
  if ((cat===0) && board && hand) {
    const maxBoard = Math.max(0,...board.map(c=>c.r));
    hand.forEach(h=>{ if (h.r>maxBoard) base += 0.02; });
  }
  return Math.max(0, Math.min(1, base));
}

// 役名（日本語）
export function handName(score) {
  if (!score) return '';
  const cat = score[0];
  const r = (v)=> String(v<=10? v : ({11:'J',12:'Q',13:'K',14:'A'}[v]));
  switch (cat) {
    case 8: return `ストレートフラッシュ（${r(score[1])}ハイ）`;
    case 7: return `フォーカード（${r(score[1])}）`;
    case 6: return `フルハウス（${r(score[1])} フル ${r(score[2])}）`;
    case 5: return `フラッシュ`;
    case 4: return `ストレート（${r(score[1])}ハイ）`;
    case 3: return `スリーカード（${r(score[1])}）`;
    case 2: return `ツーペア（${r(score[1])} と ${r(score[2])}）`;
    case 1: return `ワンペア（${r(score[1])}）`;
    default: return `ハイカード（${r(score[1])}）`;
  }
}
