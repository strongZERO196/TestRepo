// ターン進行系のユーティリティ（純粋ロジック）

export function nextPlayer(players, state) {
  for (let i = 1; i <= players.length; i++) {
    const nid = (state.toAct + i) % players.length;
    const np = players[nid];
    if (!np.folded && !np.allIn && !np.out) { state.toAct = nid; return; }
  }
  state.toAct = 0; // fallback
}

export function allSettled(players, state) {
  const active = players.filter(p => !p.folded && !p.out);
  if (active.length <= 1) return true;
  for (const p of active) {
    if (!p.allIn && p.bet !== state.currentBet) return false;
  }
  return true;
}

export function allActedOrUnable(players, state) {
  const everyone = players.filter(p => !p.folded && !p.out);
  return everyone.every(p => p.allIn || state.acted.has(p.id));
}

export function updateOpenCardsFlag(players, state) {
  if (state.openCards) return; // 一度公開したらハンド終了まで維持
  const active = players.filter(p => !p.folded && !p.out);
  for (const a of active) {
    if (!a.allIn) continue;
    for (const b of active) {
      if (b.id === a.id) continue;
      if (b.bet >= a.bet) { state.openCards = true; return; }
    }
  }
}

export function everyoneAllInOrNoActionLeft(players, state) {
  const active = players.filter(p => !p.folded && !p.out);
  if (active.length <= 1) return true;
  if (active.every(p => p.allIn)) return true;
  if (state.openCards) {
    if (active.every(p => p.allIn || p.bet === state.currentBet)) return true;
  }
  return false;
}

