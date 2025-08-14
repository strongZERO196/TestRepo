// 進行の一部（ショーダウン処理）

export function doShowdown({ players, state, log, renderAll, best5Detailed, compareScore, decisiveUsedCards, computePots, winnersSet, winnersCount, showdownInfo, showGameOver }) {
  const active = players.filter(p => !p.folded && !p.out);
  state.street = 'showdown';
  // 役表示・ハイライトの残留を避けるため、まずクリア
  showdownInfo.clear();
  winnersSet.clear();
  // boardSoftHL/boardStrongHL は呼び元にて管理する想定
  // winnersCount も呼び元で提供
  winnersCount.clear();
  // 残り1人（プリフロップで全員フォールドなど）の場合は即時配当して終了
  if (active.length === 1) {
    active[0].chips += state.pot;
    log(`勝者: ${active[0].name}（全員フォールド） 獲得 ${state.pot}`);
    state.pot = 0;
    renderAll();
    return;
  }
  // 役を事前計算
  for (const p of active) {
    const res = best5Detailed([...p.hand, ...state.board]);
    showdownInfo.set(p.id, res);
  }
  renderAll();
  // サイドポットを計算して順に分配
  const pots = computePots(players);
  const scores = new Map();
  for (const p of players) {
    if (!p.folded && !p.out) scores.set(p.id, showdownInfo.get(p.id)?.score);
  }
  pots.forEach((pot, idx) => {
    const elig = pot.eligible.filter(id => !players[id].folded && !players[id].out);
    if (elig.length === 0 || pot.amount <= 0) return;
    const potName = idx === 0 ? 'メインポット' : `サイドポット${idx}`;
    if (elig.length === 1) {
      // 単独権利（未コール分など）は返還扱い
      players[elig[0]].chips += pot.amount;
      log(`${potName}: 返還 ${players[elig[0]].name} / ${pot.amount}`);
      return;
    }
    let best = null; let winners = [];
    for (const id of elig) {
      const sc = scores.get(id);
      if (!best || compareScore(sc, best) > 0) { best = sc; winners = [id]; }
      else if (compareScore(sc, best) === 0) winners.push(id);
    }
    // 勝者のIDを登録
    for (const wid of winners) {
      winnersSet.add(wid);
      winnersCount.set(wid, (winnersCount.get(wid) || 0) + 1);
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const id of winners) players[id].chips += share;
    if (remainder > 0) players[winners[0]].chips += remainder; // 余りは先頭へ（簡略）
    log(`${potName}: 勝者 ${winners.map(id=>players[id].name).join(', ')} / ${pot.amount}`);
  });
  state.pot = 0;
  // チップが尽きたプレイヤーは離脱（ユーザーならゲームオーバー表示）
  for (const p of players) {
    if (!p.out && p.chips <= 0) {
      p.out = true;
      p.folded = true;
      p.allIn = false;
      log(`${p.name}: チップが尽きたため離脱`);
      if (p.id === 0 && typeof showGameOver === 'function') showGameOver();
    }
  }
  // 残り人数チェック
  const alive = players.filter(p => !p.out);
  if (alive.length <= 1) {
    const champ = alive[0];
    if (champ) log(`ゲーム終了: 優勝 ${champ.name}`);
    else log('ゲーム終了: 参加者なし');
    const me = players[0];
    if ((me.out || me.chips <= 0) && typeof showGameOver === 'function') showGameOver();
  }
  renderAll();
}

