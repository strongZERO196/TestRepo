// ハンドの開始とストリート遷移（UI依存はコンテキスト経由で注入）

export function newHand(ctx) {
  const { players, state, createDeck, log, renderAll, betForced, nextNonOutFrom, nextActiveFrom, raiseAmtEl, turnLoopIfBot } = ctx;
  state.deck = createDeck();
  state.board = [];
  state.pot = 0;
  state.street = 'preflop';
  state.currentBet = 0;
  state.minRaise = state.bb;
  state.lastAggressor = null;
  state.acted = new Set();
  state.blessingStrongFor = null;
  state.blessingResidualPid = null;
  state.blessingResidualCount = 0;
  state.usedClairvoyanceStreet = new Set();
  if (ctx.peekEl) ctx.peekEl.innerHTML = '';
  for (const p of players) {
    if (!p.out) {
      p.hand = []; p.folded = false; p.bet = 0; p.total = 0; p.allIn = false; p.lastAction = null; p.revealMask = 0;
    } else {
      p.hand = []; p.folded = true; p.bet = 0; p.total = 0; p.allIn = false; p.lastAction = null; p.revealMask = 0;
    }
  }
  // ボタン移動
  state.dealer = nextNonOutFrom((state.dealer + 1) % players.length);
  // ブラインド
  const sbPos = nextNonOutFrom((state.dealer + 1) % players.length);
  const bbPos = nextNonOutFrom((sbPos + 1) % players.length);
  betForced(sbPos, state.sb, 'SB');
  betForced(bbPos, state.bb, 'BB');
  state.currentBet = state.bb;
  state.acted = new Set();
  // 配札
  for (let i = 0; i < 2; i++) {
    for (let p = 0; p < players.length; p++) {
      const pid = (state.dealer + 1 + p) % players.length;
      if (!players[pid].out) players[pid].hand.push(state.deck.pop());
    }
  }
  // アクション開始はBBの次
  state.toAct = nextActiveFrom((bbPos + 1) % players.length);
  // レイズ入力のデフォルトをリセット
  if (raiseAmtEl) {
    const minTotal = state.currentBet + state.minRaise;
    raiseAmtEl.value = String(minTotal);
  }
  log(`--- 新しいハンド Dealer: ${players[state.dealer].name} ---`);
  renderAll();
  turnLoopIfBot && turnLoopIfBot();
}

export function goNextStreet(ctx) {
  const { players, state, renderAll, nextNonOutFrom, nextActiveFrom, applyBlessingBeforeDeal, turnLoopIfBot, showdown } = ctx;
  // ベットをリセット
  for (const p of players) p.bet = 0;
  state.currentBet = 0;
  state.minRaise = state.bb;
  state.lastAggressor = null;
  state.acted = new Set();
  // 直近アクションは次ストリートでクリア
  for (const p of players) { if (!p.folded && !p.out) p.lastAction = null; }
  // 透視の同一ラウンド制限を解除
  state.usedClairvoyanceStreet = new Set();

  if (players.filter(p => !p.folded && !p.out).length <= 1) {
    showdown();
    return;
  }

  if (state.street === 'preflop') {
    if (state.blessingStrongFor!=null) { applyBlessingBeforeDeal(state.blessingStrongFor, 3); state.blessingStrongFor=null; state.blessingResidualPid = players[0]?.id ?? 0; state.blessingResidualCount = 1; }
    else if (state.blessingResidualPid!=null && state.blessingResidualCount>0) { applyBlessingBeforeDeal({pid:state.blessingResidualPid, weak:true}, 3); state.blessingResidualCount--; if (state.blessingResidualCount<=0) { state.blessingResidualPid=null; } }
    state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    state.street = 'flop';
  } else if (state.street === 'flop') {
    if (state.blessingStrongFor!=null) { applyBlessingBeforeDeal(state.blessingStrongFor, 1); state.blessingStrongFor=null; state.blessingResidualPid = players[0]?.id ?? 0; state.blessingResidualCount = 1; }
    else if (state.blessingResidualPid!=null && state.blessingResidualCount>0) { applyBlessingBeforeDeal({pid:state.blessingResidualPid, weak:true}, 1); state.blessingResidualCount--; if (state.blessingResidualCount<=0) { state.blessingResidualPid=null; } }
    state.board.push(state.deck.pop());
    state.street = 'turn';
  } else if (state.street === 'turn') {
    if (state.blessingStrongFor!=null) { applyBlessingBeforeDeal(state.blessingStrongFor, 1); state.blessingStrongFor=null; state.blessingResidualPid = players[0]?.id ?? 0; state.blessingResidualCount = 1; }
    else if (state.blessingResidualPid!=null && state.blessingResidualCount>0) { applyBlessingBeforeDeal({pid:state.blessingResidualPid, weak:true}, 1); state.blessingResidualCount--; if (state.blessingResidualCount<=0) { state.blessingResidualPid=null; } }
    state.board.push(state.deck.pop());
    state.street = 'river';
  } else if (state.street === 'river') {
    showdown();
    return;
  }
  const sbPos = nextNonOutFrom((state.dealer + 1) % players.length);
  state.toAct = nextActiveFrom((sbPos + 1) % players.length);
  renderAll();
  if (!players.some(p => !p.folded && !p.allIn)) {
    setTimeout(() => goNextStreet(ctx), 600);
  } else {
    turnLoopIfBot && turnLoopIfBot();
  }
}

