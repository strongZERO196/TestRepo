// サイドポット計算（プレイヤーの total を利用）
export function computePots(players) {
  const remaining = players.map(p => Math.max(0, p.total));
  const pots = [];
  while (true) {
    const positive = remaining.map((v,i)=>({v,i})).filter(o=>o.v>0);
    if (positive.length === 0) break;
    const min = Math.min(...positive.map(o=>o.v));
    const participants = positive.map(o=>o.i);
    const amount = min * participants.length;
    participants.forEach(i => remaining[i] -= min);
    pots.push({ amount, eligible: participants, chunk: min });
  }
  return pots;
}

