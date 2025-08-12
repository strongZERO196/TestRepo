// テキサスホールデム（簡易版・日本語コメント）
// - 4人（あなた + Bot×3）
// - ノーリミット風だが簡略化（サイドポットなし／オールイン回避のため所持未満はフォールド）
// - プリフロップ/フロップ/ターン/リバー + ショーダウン

(() => {
  'use strict';

  // DOM 参照
  const boardEl = document.getElementById('board');
  const potEl = document.getElementById('pot');
  const logEl = document.getElementById('log');
  const streetEl = document.getElementById('street');
  const turnEl = document.getElementById('turn');
  const potsEl = document.getElementById('pots');
  const showdownInfo = new Map(); // プレイヤーID -> { score, used: Card[] }
  const winnersSet = new Set(); // 勝者のプレイヤーID集合（メイン/サイド含む）
  const boardSoftHL = new Set(); // 全員の使用コミュニティカード（淡色）
  const boardStrongHL = new Set(); // 勝者の使用コミュニティカード（濃色）
  const winnersCount = new Map(); // プレイヤーID -> 勝利ポット数

  const btnNew = document.getElementById('btn-new');
  const btnFold = document.getElementById('btn-fold');
  const btnCheck = document.getElementById('btn-check');
  const btnCall = document.getElementById('btn-call');
  const btnRaise = document.getElementById('btn-raise');
  const btnAllin = document.getElementById('btn-allin');
  const raiseAmt = document.getElementById('raise-amt');

  function $(id) { return document.getElementById(id); }

  // カード表現
  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // 11:J 12:Q 13:K 14:A
  function createDeck() {
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
  function rankLabel(r) {
    if (r <= 10) return String(r);
    return {11:'J',12:'Q',13:'K',14:'A'}[r];
  }

  // UI - カード描画
  function cardEl(card, faceUp = true) {
    const div = document.createElement('div');
    div.className = 'card' + (faceUp && (card.s === '♥' || card.s === '♦') ? ' red' : '');
    if (!faceUp) div.className += ' back';
    div.textContent = faceUp ? `${rankLabel(card.r)}${card.s}` : '';
    return div;
  }

  // プレイヤー
  const players = [
    { id: 0, name: 'あなた', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: true },
    { id: 1, name: 'Bot A', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false },
    { id: 2, name: 'Bot B', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false },
    { id: 3, name: 'Bot C', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false },
  ];

  // ゲーム状態
  const state = {
    deck: [],
    board: [],
    pot: 0,
    dealer: 0, // ボタン位置
    sb: 10,
    bb: 20,
    street: 'idle', // idle, preflop, flop, turn, river, showdown
    toAct: 0, // 行動者のプレイヤーID
    currentBet: 0,
    minRaise: 20,
    lastAggressor: null,
    acted: new Set(), // 直近のレイズ以降でベット状況を満たしたプレイヤー
  };

  // 指定した座席から、次のアクティブ（未フォールド・未オールイン・未離脱）プレイヤーIDを返す
  function nextActiveFrom(startIdx) {
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const pid = (startIdx + i) % n;
      if (!players[pid].folded && !players[pid].allIn && !players[pid].out) return pid;
    }
    return startIdx; // フォールバック（理論上到達しない）
  }

  // 指定した座席から、次の参加可能（未離脱）プレイヤーIDを返す
  function nextNonOutFrom(startIdx) {
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const pid = (startIdx + i) % n;
      if (!players[pid].out) return pid;
    }
    return startIdx;
  }

  function alivePlayersCount() {
    return players.filter(p => !p.out).length;
  }

  // ログ
  function log(msg) {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  // 表示更新
  function renderAll() {
    potEl.textContent = String(state.pot);
    streetEl.textContent = `ステージ: ${state.street}`;
    turnEl.textContent = state.street === 'idle' ? '' : `次の行動: ${players[state.toAct]?.name ?? ''}`;
    // ボード
    boardEl.innerHTML = '';
    state.board.forEach(c => {
      const el = cardEl(c, true);
      if (state.street === 'showdown') {
        if (boardStrongHL.has(c)) el.classList.add('hl-strong');
        else if (boardSoftHL.has(c)) el.classList.add('hl-soft');
      }
      el.classList.add('board-card');
      boardEl.appendChild(el);
    });
    // 各席
    for (const p of players) {
      $('chips-' + p.id).textContent = String(p.chips);
      $('bet-' + p.id).textContent = String(p.bet);
      const cardsBox = $('cards-' + p.id);
      cardsBox.innerHTML = '';
      const faceUp = (p.isUser || state.street === 'showdown') && !p.out;
      if (p.hand.length && !p.out) {
        const c0 = cardEl(p.hand[0], faceUp);
        const c1 = cardEl(p.hand[1], faceUp);
        if (state.street === 'showdown' && showdownInfo.has(p.id)) {
          const used = new Set(showdownInfo.get(p.id).used);
          const cls = winnersSet.has(p.id) ? 'hl-strong' : 'hl-soft';
          if (used.has(p.hand[0])) c0.classList.add(cls);
          if (used.has(p.hand[1])) c1.classList.add(cls);
        }
        cardsBox.appendChild(c0);
        cardsBox.appendChild(c1);
      }
      const st = $('state-' + p.id);
      if (state.street === 'showdown' && showdownInfo.has(p.id)) {
        st.textContent = handName(showdownInfo.get(p.id).score);
      } else {
        st.textContent = p.out ? '離脱' : (p.folded ? 'フォールド' : (p.allIn ? 'オールイン' : (state.toAct === p.id ? '行動中' : '')));
      }
      if (state.street === 'idle') st.textContent = '';
      // 勝者バッジを名前の右に表示
      const nameEl = $('name-' + p.id);
      if (state.street === 'showdown' && winnersCount.get(p.id) > 0) {
        nameEl.innerHTML = `${p.name}<span class="badge">勝者×${winnersCount.get(p.id)}</span>`;
      } else {
        nameEl.textContent = p.name;
      }
    }
    // ポット内訳表示（メイン/サイド）
    if (potsEl) {
      potsEl.innerHTML = '';
      if (state.street !== 'idle' && state.pot > 0) {
        const pots = computePots();
        pots.forEach((pot, idx) => {
          const div = document.createElement('div');
          const label = idx === 0 ? 'メイン' : `サイド${idx}`;
          const names = pot.eligible.map(id => players[id].name).join(', ');
          div.textContent = `${label}:${pot.amount}（参加: ${names}）`;
          div.style.background = 'rgba(0,0,0,0.25)';
          div.style.padding = '2px 6px';
          div.style.borderRadius = '8px';
          potsEl.appendChild(div);
        });
      }
    }
    updateControls();
  }

  function updateControls() {
    const me = players[0];
    const isMyTurn = state.toAct === 0 && !me.folded && !me.allIn && !me.out && state.street !== 'idle' && state.street !== 'showdown';
    btnFold.disabled = !isMyTurn;
    btnCheck.disabled = !isMyTurn || !(me.bet === state.currentBet);
    const callAmt = state.currentBet - me.bet;
    if (me.bet === state.currentBet) {
      btnCall.textContent = 'チェック';
    } else if (me.chips < callAmt) {
      btnCall.textContent = `オールイン(${Math.max(0, me.chips)})`;
    } else {
      btnCall.textContent = `コール(${callAmt})`;
    }
    btnCall.disabled = !isMyTurn || (me.bet !== state.currentBet && me.chips <= 0);
    btnCheck.style.display = me.bet === state.currentBet ? 'inline-block' : 'none';
    btnCall.style.display = me.bet === state.currentBet ? 'none' : 'inline-block';
    const minRaiseTotal = state.currentBet + state.minRaise;
    raiseAmt.min = String(minRaiseTotal);
    raiseAmt.step = String(state.bb);
    if (Number(raiseAmt.value) < minRaiseTotal) raiseAmt.value = String(minRaiseTotal);
    btnRaise.disabled = !isMyTurn || me.chips < (minRaiseTotal - me.bet);
    btnAllin.disabled = !isMyTurn || me.chips <= 0;
    if (!btnAllin.disabled) btnAllin.textContent = `オールイン(${me.chips})`;
  }

  // 新しいハンド
  function newHand() {
    // ゲーム続行可能か判定（参加者が2人未満なら終了）
    if (alivePlayersCount() < 2) {
      state.street = 'idle';
      log('ゲーム終了：残り参加者が1人以下です');
      renderAll();
      return;
    }

    state.deck = createDeck();
    state.board = [];
    state.pot = 0;
    state.street = 'preflop';
    state.currentBet = 0;
    state.minRaise = state.bb;
    state.lastAggressor = null;
    state.acted = new Set();
    for (const p of players) { if (!p.out) { p.hand = []; p.folded = false; p.bet = 0; p.total = 0; p.allIn = false; } else { p.hand = []; p.folded = true; p.bet = 0; p.total = 0; p.allIn = false; } }
    // ボタン移動
    state.dealer = nextNonOutFrom((state.dealer + 1) % players.length);
    // ブラインド
    const sbPos = nextNonOutFrom((state.dealer + 1) % players.length);
    const bbPos = nextNonOutFrom((sbPos + 1) % players.length);
    betForced(sbPos, state.sb, 'SB');
    betForced(bbPos, state.bb, 'BB');
    state.currentBet = state.bb;
    state.acted = new Set(); // プリフロップ開始時点で全員未アクション
    // 配札
    for (let i = 0; i < 2; i++) {
      for (let p = 0; p < players.length; p++) {
        const pid = (state.dealer + 1 + p) % players.length;
        if (!players[pid].out) players[pid].hand.push(state.deck.pop());
      }
    }
    // アクション開始はBBの次（フォールド席はスキップ）
    state.toAct = nextActiveFrom((bbPos + 1) % players.length);
    log(`--- 新しいハンド Dealer: ${players[state.dealer].name} ---`);
    renderAll();
    turnLoopIfBot();
  }

  function betForced(pid, amt, label) {
    const p = players[pid];
    if (p.out) return;
    const pay = Math.min(amt, p.chips);
    if (pay <= 0) return;
    p.chips -= pay; p.bet += pay; p.total += pay; state.pot += pay;
    if (p.chips === 0) p.allIn = true;
    log(`${p.name}: ${label} ${pay}${p.allIn ? '（オールイン）' : ''}`);
  }

  // アクション進行
  function nextPlayer() {
    for (let i = 1; i <= players.length; i++) {
      const nid = (state.toAct + i) % players.length;
      const np = players[nid];
      if (!np.folded && !np.allIn && !np.out) { state.toAct = nid; return; }
    }
    state.toAct = 0; // fallback
  }

  // 全員のベットが整っているか（フォールド or オールイン or 現在額一致）
  function allSettled() {
    const active = players.filter(p => !p.folded && !p.out);
    if (active.length <= 1) return true;
    for (const p of active) {
      if (!p.allIn && p.bet !== state.currentBet) return false;
    }
    return true;
  }

  function allActedOrUnable() {
    const everyone = players.filter(p => !p.folded);
    return everyone.every(p => p.allIn || state.acted.has(p.id));
  }

  function goNextStreet() {
    // ベットをリセット
    for (const p of players) p.bet = 0;
    state.currentBet = 0;
    state.minRaise = state.bb;
    state.lastAggressor = null;
    state.acted = new Set();

    if (players.filter(p => !p.folded && !p.out).length <= 1) {
      showdown();
      return;
    }

    if (state.street === 'preflop') {
      // フロップ 3枚
      state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      state.street = 'flop';
    } else if (state.street === 'flop') {
      state.board.push(state.deck.pop());
      state.street = 'turn';
    } else if (state.street === 'turn') {
      state.board.push(state.deck.pop());
      state.street = 'river';
    } else if (state.street === 'river') {
      showdown();
      return;
    }
    // 次はSBの次（フロップ以降）
    const sbPos = nextNonOutFrom((state.dealer + 1) % players.length);
    state.toAct = nextActiveFrom((sbPos + 1) % players.length);
    renderAll();
    if (!players.some(p => !p.folded && !p.allIn)) {
      // 全員オールインなら自動で次ストリートへ
      setTimeout(goNextStreet, 600);
    } else {
      turnLoopIfBot();
    }
  }

  function playerAction(pid, action, amount = 0) {
    const p = players[pid];
    if (p.folded || p.out || state.street === 'idle' || state.street === 'showdown') return;
    if (action === 'fold') {
      p.folded = true; state.acted.delete(pid); log(`${p.name}: フォールド`);
    } else if (action === 'check') {
      if (p.bet !== state.currentBet) return;
      log(`${p.name}: チェック`);
      state.acted.add(pid);
    } else if (action === 'call') {
      const need = state.currentBet - p.bet;
      if (need <= 0) { /* チェック相当 */ log(`${p.name}: チェック`); state.acted.add(pid); }
      else if (p.chips <= 0) { /* 何もしない */ }
      else if (p.chips < need) { // オールイン・コール（部分）
        const pay = p.chips;
        p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
        log(`${p.name}: オールイン（${pay}）`);
        state.acted.add(pid);
      } else {
        p.chips -= need; p.bet += need; p.total += need; state.pot += need;
        log(`${p.name}: コール ${need}`);
        state.acted.add(pid);
      }
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
        }
      } else {
        p.chips -= need; p.bet += need; p.total += need; state.pot += need;
        state.minRaise = Math.max(state.minRaise, amount - state.currentBet);
        state.currentBet = amount;
        state.lastAggressor = pid;
        // レイズが入ったので「行動済み」情報をリセット（レイザーのみ行動済み扱い）
        state.acted = new Set([pid]);
        log(`${p.name}: レイズ ${need}（合計ベット ${amount}）`);
      }
    } else if (action === 'allin') {
      if (p.chips <= 0) return;
      const prevBetLevel = state.currentBet;
      const prevPBet = p.bet;
      const pay = p.chips;
      p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
      log(`${p.name}: オールイン（${pay}）`);
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
    }

    // ラウンド終了判定（全アクティブが最新レイズ以降「行動済み」かつ整合）
    const active = players.filter(pp => !pp.folded && !pp.out);
    if (active.length <= 1) { showdown(); return; }
    if (allSettled() && allActedOrUnable()) {
      goNextStreet();
      return;
    }

    // 次の番へ
    nextPlayer();
    renderAll();
    turnLoopIfBot();
  }

  // ショーダウン
  function showdown() {
    state.street = 'showdown';
    const active = players.filter(p => !p.folded && !p.out);
    // 役を事前計算
    showdownInfo.clear();
    winnersSet.clear();
    boardSoftHL.clear();
    boardStrongHL.clear();
    winnersCount.clear();
    for (const p of active) {
      const res = best5Detailed([...p.hand, ...state.board]);
      showdownInfo.set(p.id, res);
      // ボード側の淡色ハイライト候補
      for (const card of res.used) if (state.board.includes(card)) boardSoftHL.add(card);
    }
    renderAll();
    if (active.length === 1) {
      active[0].chips += state.pot;
      log(`勝者: ${active[0].name}（全員フォールド） 獲得 ${state.pot}`);
      state.pot = 0; renderAll(); return;
    }
    // サイドポットを計算して順に分配
    const pots = computePots();
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
      // 勝者のIDを登録し、勝因のコミュニティカードを強調対象へ
      for (const wid of winners) {
        winnersSet.add(wid);
        winnersCount.set(wid, (winnersCount.get(wid) || 0) + 1);
        const used = showdownInfo.get(wid)?.used || [];
        for (const card of used) if (state.board.includes(card)) boardStrongHL.add(card);
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const id of winners) players[id].chips += share;
      if (remainder > 0) players[winners[0]].chips += remainder; // 余りは先頭へ（簡略）
      log(`${potName}: 勝者 ${winners.map(id=>players[id].name).join(', ')} / ${pot.amount}`);
    });
    state.pot = 0;
    // チップが尽きたプレイヤーは離脱
    for (const p of players) {
      if (!p.out && p.chips <= 0) {
        p.out = true;
        p.folded = true;
        p.allIn = false;
        log(`${p.name}: チップが尽きたため離脱`);
      }
    }
    // 残り人数チェック
    const alive = players.filter(p => !p.out);
    if (alive.length <= 1) {
      const champ = alive[0];
      if (champ) log(`ゲーム終了: 優勝 ${champ.name}`);
      else log('ゲーム終了: 参加者なし');
      state.street = 'idle';
    }
    renderAll();
  }

  // ホットキー（F/C/R/A）
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    const key = e.key;
    const me = players[0];
    const isMyTurn = state.toAct === 0 && !me.folded && !me.allIn && !me.out && state.street !== 'idle' && state.street !== 'showdown';
    if (!isMyTurn || typing) return;
    if (['f','F','c','C','r','R','a','A'].includes(key)) e.preventDefault();
    if (key === 'f' || key === 'F') return playerAction(0,'fold');
    if (key === 'c' || key === 'C') return (me.bet === state.currentBet) ? playerAction(0,'check') : playerAction(0,'call');
    if (key === 'a' || key === 'A') return playerAction(0,'allin');
    if (key === 'r' || key === 'R') { raiseAmt.focus(); raiseAmt.select(); }
  });

  // レイズプリセット
  const rsMin = document.getElementById('rs-min');
  const rsHP = document.getElementById('rs-hp');
  const rsPot = document.getElementById('rs-pot');
  const rs2P = document.getElementById('rs-2p');

  function setRaiseTo(total) {
    const me = players[0];
    const minTotal = state.currentBet + state.minRaise;
    const maxTotal = me.bet + me.chips; // オールイン上限
    const clamped = Math.max(minTotal, Math.min(total, maxTotal));
    raiseAmt.value = String(clamped);
    updateControls();
  }

  function potBasedAmount(mult) {
    // ざっくりのポット基準（現在 pot を利用）
    const base = Math.floor(state.pot * mult);
    return state.currentBet + Math.max(state.minRaise, base);
  }

  rsMin && rsMin.addEventListener('click', () => setRaiseTo(state.currentBet + state.minRaise));
  rsHP && rsHP.addEventListener('click', () => setRaiseTo(potBasedAmount(0.5)));
  rsPot && rsPot.addEventListener('click', () => setRaiseTo(potBasedAmount(1)));
  rs2P && rs2P.addEventListener('click', () => setRaiseTo(potBasedAmount(2)));

  // サイドポット計算
  function computePots() {
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

  // スコアリング（5枚）
  // 返却: [cat, ...kickers] 大きい方が強い。cat: 8=SF 7=4K 6=FH 5=F 4=S 3=3K 2=2P 1=1P 0=HC
  function score5(cards) {
    const ranks = cards.map(c => c.r).sort((a,b)=>b-a);
    const suits = cards.map(c => c.s);
    const counts = new Map();
    for (const r of ranks) counts.set(r, (counts.get(r)||0)+1);
    const byCount = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
    const isFlush = suits.every(s => s === suits[0]);
    const uniq = [...new Set(ranks)];
    // ストレート（A-5対応）
    let isStraight = false, topStraight = 0;
    const seq = [...ranks];
    // 重複除去して高→低で確認
    const rset = uniq;
    for (let i = 0; i <= rset.length - 5; i++) {
      const a=rset[i], b=rset[i+1], c=rset[i+2], d=rset[i+3], e=rset[i+4];
      if (a===b+1 && b===c+1 && c===d+1 && d===e+1) { isStraight=true; topStraight=a; break; }
    }
    // A-5（A=14, 5=5）
    if (!isStraight && rset.includes(14) && rset.includes(5) && rset.includes(4) && rset.includes(3) && rset.includes(2)) {
      isStraight = true; topStraight = 5;
    }
    if (isStraight && isFlush) return [8, topStraight]; // ストフラ
    if (byCount[0][1] === 4) return [7, byCount[0][0], byCount.find(e=>e[1]===1)[0]]; // 4K
    if (byCount[0][1] === 3 && byCount[1][1] === 2) return [6, byCount[0][0], byCount[1][0]]; // フルハウス
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

  function best5Score(cards7) {
    // 7枚から5枚を全探索（21通り）
    let best = null;
    for (let i=0;i<cards7.length;i++){
      for (let j=i+1;j<cards7.length;j++){
        const five = cards7.filter((_,idx)=>idx!==i && idx!==j);
        const s = score5(five);
        if (!best || compareScore(s, best) > 0) best = s;
      }
    }
    return best;
  }

  function best5Detailed(cards7) {
    let best = null;
    let bestCards = null;
    for (let i=0;i<cards7.length;i++){
      for (let j=i+1;j<cards7.length;j++){
        const five = cards7.filter((_,idx)=>idx!==i && idx!==j);
        const s = score5(five);
        if (!best || compareScore(s, best) > 0) { best = s; bestCards = five; }
      }
    }
    return { score: best, used: bestCards };
  }

  function compareScore(a, b) {
    for (let i=0;i<Math.max(a.length,b.length);i++){
      const av=a[i]??0, bv=b[i]??0;
      if (av!==bv) return av>bv?1:-1;
    }
    return 0;
  }

  // 役名（日本語）
  function handName(score) {
    if (!score) return '';
    const cat = score[0];
    const r = (v)=>rankLabel(v);
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

  // 簡易Botロジック
  function botAct(pid) {
    const p = players[pid];
    const need = state.currentBet - p.bet;
    const rnd = Math.random();
    if (state.street === 'preflop') {
      // ざっくりプリフロップ強さ
      const [a,b] = p.hand.map(c=>c.r).sort((x,y)=>y-x);
      const suited = p.hand[0].s === p.hand[1].s;
      const pair = a===b;
      let score = a + b + (pair?20:0) + (suited?3:0);
      if (need === 0) {
        if (score >= 26 && rnd < 0.35) return doRaise(pid, state.currentBet + state.minRaise);
        return doCheckOrCall(pid);
      } else {
        if (score >= 25 || rnd < 0.25) return doCheckOrCall(pid);
        return doFold(pid);
      }
    } else {
      // ポストフロップ：役評価
      const made = best5Score([...p.hand, ...state.board]);
      const cat = made[0];
      if (need === 0) {
        if (cat >= 2 && rnd < 0.5) return doRaise(pid, state.currentBet + state.minRaise);
        if (cat >= 1) return doCheckOrCall(pid);
        return doCheck(pid);
      } else {
        if (cat >= 2 || rnd < 0.3) return doCheckOrCall(pid);
        return doFold(pid);
      }
    }
  }

  function doFold(pid){ playerAction(pid, 'fold'); }
  function doCheck(pid){ playerAction(pid, 'check'); }
  function doCheckOrCall(pid){
    const p = players[pid];
    if (p.bet === state.currentBet) playerAction(pid, 'check'); else playerAction(pid, 'call');
  }
  function doRaise(pid, total){ playerAction(pid, 'raise', total); }

  function turnLoopIfBot() {
    const p = players[state.toAct];
    if (!p) return;
    if (p.isUser || p.folded || p.out || p.allIn || state.street==='idle' || state.street==='showdown') return;
    // 少し待ってから行動
    setTimeout(() => botAct(p.id), 450 + Math.random()*400);
  }

  // ユーザー操作
  btnNew.addEventListener('click', () => { logEl.textContent=''; newHand(); });
  btnFold.addEventListener('click', () => playerAction(0,'fold'));
  btnCheck.addEventListener('click', () => playerAction(0,'check'));
  btnCall.addEventListener('click', () => playerAction(0,'call'));
  btnRaise.addEventListener('click', () => playerAction(0,'raise', Number(raiseAmt.value)));
  btnAllin.addEventListener('click', () => playerAction(0,'allin'));

  // 初期表示
  renderAll();
})();
