// ハンド開始や強制ブラインド（UI依存を引数で注入）

export function betForced(players, state, pid, amt, label, log, setLastAction) {
  const p = players[pid];
  if (p.out) return;
  const pay = Math.min(amt, p.chips);
  if (pay <= 0) return;
  p.chips -= pay; p.bet += pay; p.total += pay; state.pot += pay;
  if (p.chips === 0) p.allIn = true;
  log(`${p.name}: ${label} ${pay}${p.chips===0 ? '（オールイン）' : ''}`);
  setLastAction(p, 'blind', pay, label);
}

