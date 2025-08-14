// プレイヤーのアクション処理（フォールド/チェック/コール/レイズ/オールイン）

export function playerAction(ctx, pid, action, amount = 0) {
  const { players, state, log, renderAll, speak,
          goNextStreet, nextPlayer, updateOpenCardsFlag,
          allSettled, allActedOrUnable, everyoneAllInOrNoActionLeft,
          setLastAction } = ctx;

  const p = players[pid];
  if (!p || p.folded || p.out || state.street === 'idle' || state.street === 'showdown') return;

  if (action === 'fold') {
    p.folded = true; state.acted.delete(pid); log(`${p.name}: フォールド`);
    setLastAction(p, 'fold');
    speak && speak(pid, 'fold');

  } else if (action === 'check') {
    if (p.bet !== state.currentBet) return;
    log(`${p.name}: チェック`);
    state.acted.add(pid);
    setLastAction(p, 'check');
    speak && speak(pid, 'check');
    updateOpenCardsFlag();

  } else if (action === 'call') {
    const need = state.currentBet - p.bet;
    if (need <= 0) { // チェック相当
      log(`${p.name}: チェック`);
      state.acted.add(pid);
      setLastAction(p, 'check');
      speak && speak(pid, 'check');
    } else if (p.chips <= 0) {
      // 何もしない
    } else if (p.chips < need) { // オールイン・コール（部分）
      const pay = p.chips;
      p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
      log(`${p.name}: オールイン（${pay}）`);
      state.acted.add(pid);
      setLastAction(p, 'allin', pay);
      speak && speak(pid, 'allin');
    } else {
      p.chips -= need; p.bet += need; p.total += need; state.pot += need;
      log(`${p.name}: コール ${need}`);
      state.acted.add(pid);
      setLastAction(p, 'call', need);
      speak && speak(pid, 'call');
    }
    updateOpenCardsFlag();

  } else if (action === 'raise') {
    const minTotal = state.currentBet + state.minRaise;
    if (amount < minTotal) amount = minTotal;
    const need = amount - p.bet;
    if (need <= 0) return;
    if (p.chips < need) {
      // レイズ最低額に満たない場合は、可能な範囲でのコール（オールイン）扱い。
      const pay = p.chips;
      if (pay > 0) {
        p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
        log(`${p.name}: オールイン（${pay}）`);
        state.acted.add(pid);
        setLastAction(p, 'allin', pay);
        speak && speak(pid, 'allin');
      }
    } else {
      p.chips -= need; p.bet += need; p.total += need; state.pot += need;
      state.minRaise = Math.max(state.minRaise, amount - state.currentBet);
      state.currentBet = amount;
      state.lastAggressor = pid;
      // レイズが入ったので「行動済み」情報をリセット（レイザーのみ行動済み扱い）
      state.acted = new Set([pid]);
      log(`${p.name}: レイズ ${need}（合計ベット ${amount}）`);
      setLastAction(p, 'raise', need);
      speak && speak(pid, 'raise');
    }
    updateOpenCardsFlag();

  } else if (action === 'allin') {
    if (p.chips <= 0) return;
    const prevBetLevel = state.currentBet;
    const pay = p.chips;
    p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
    log(`${p.name}: オールイン（${pay}）`);
    setLastAction(p, 'allin', pay);
    speak && speak(pid, 'allin');
    const newTotal = p.bet;
    if (newTotal > prevBetLevel) {
      const raiseSize = newTotal - prevBetLevel;
      if (raiseSize >= state.minRaise) {
        state.minRaise = Math.max(state.minRaise, raiseSize);
        state.currentBet = newTotal;
        state.lastAggressor = pid;
        state.acted = new Set([pid]);
      } else {
        // 最小レイズ未満のオールイン: ベットレベルは上がるがレイズ再オープンはしない
        state.currentBet = newTotal;
        state.acted.add(pid);
      }
    } else {
      // コール不足のオールイン（部分コール）
      state.acted.add(pid);
    }
    updateOpenCardsFlag();
  }

  // ラウンド終了判定（全アクティブが最新レイズ以降「行動済み」かつ整合）
  updateOpenCardsFlag();
  if (everyoneAllInOrNoActionLeft()) { renderAll(); setTimeout(goNextStreet, 500); return; }
  const active = players.filter(pp => !pp.folded && !pp.out);
  if (active.length <= 1) { return goNextStreet && goNextStreet(); }
  if (allSettled() && allActedOrUnable()) {
    goNextStreet && goNextStreet();
    return;
  }

  // 次の番へ
  nextPlayer();
  renderAll();
  ctx.turnLoopIfBot && ctx.turnLoopIfBot();
}

