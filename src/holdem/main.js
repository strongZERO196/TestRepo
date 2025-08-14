// テキサスホールデム（簡易版・日本語コメント）
// - 4人（あなた + Bot×3）
// - ノーリミット風だが簡略化（サイドポットなし／オールイン回避のため所持未満はフォールド）
// - プリフロップ/フロップ/ターン/リバー + ショーダウン

import { createDeck, rankLabel, removeCardFrom, cloneDeck } from './js/core/cards.js';
import { bestScoreFrom, compareScore, best5Detailed, decisiveUsedCards, score5 } from './js/core/scoring.js';
import { speak, setPlayersRef } from './js/ui/speech.js';
import { loadCharactersFromJson as loadCharacters } from './js/data/characters.js';

(() => {
  'use strict';

  // DOM 参照
  const boardEl = document.getElementById('board');
  const potEl = document.getElementById('pot');
  const logEl = document.getElementById('log');
  const streetEl = document.getElementById('street');
  const turnEl = document.getElementById('turn');
  const potsEl = document.getElementById('pots');
  const blindsEl = document.getElementById('blinds');
  const abilityUsesEl = document.getElementById('ability-uses');
  const tableEl = document.getElementById('table');
  const peekEl = document.getElementById('peek');
  const gameoverEl = document.getElementById('gameover');
  const showdownInfo = new Map(); // プレイヤーID -> { score, used: Card[] }
  const winnersSet = new Set(); // 勝者のプレイヤーID集合（メイン/サイド含む）
  const boardSoftHL = new Set(); // 全員の使用コミュニティカード（淡色）
  const boardStrongHL = new Set(); // 勝者の使用コミュニティカード（濃色）
  const winnersCount = new Map(); // プレイヤーID -> 勝利ポット数
  // 能力関連の個別知識（公開しない情報は各自の記憶にのみ保存）
  const seenBy = new Map();      // viewerId -> Map(targetId -> revealIndex)
  const foresightMem = new Map(); // viewerId -> Card[] 予測した次のカード

  const btnNew = document.getElementById('btn-new');
  const btnFold = document.getElementById('btn-fold');
  const btnCheck = document.getElementById('btn-check');
  const btnCall = document.getElementById('btn-call');
  const btnRaise = document.getElementById('btn-raise');
  const btnAllin = document.getElementById('btn-allin');
  const raiseAmt = document.getElementById('raise-amt');
  const equityEl = document.getElementById('equity');
  const btnEquity = document.getElementById('btn-equity');
  const cutinEl = document.getElementById('cutin');
  const cutinPortrait = document.getElementById('cutin-portrait');
  const cutinName = document.getElementById('cutin-name');
  const cutinAbility = document.getElementById('cutin-ability');
  const cutinPose = document.getElementById('cutin-pose');

  function $(id) { return document.getElementById(id); }

  // カード表現（cards.jsへ分離済み）

  // Monte Carlo による勝率（ユーザー vs アクティブ他家）
  function estimateEquity(trials = 1200) {
    const me = players[0];
    const contenders = players.filter(p => !p.out && !p.folded && p.hand.length === 2);
    if (!me || me.folded || me.out) return { win: 0, trials: 0 };
    if (contenders.length <= 1) return { win: 1, trials: 0 };

    // 既知情報を固定：自分の2枚、ボード、（公開されている相手のカード）
    const knownBoard = [...state.board];
    const knownOpps = new Map(); // id -> { known: Card[], need: number }
    for (const p of players) {
      if (p.out || p.folded || p.id === 0 || p.hand.length !== 2) continue;
      const arr = [];
      if (state.openCards && p.allIn) { arr.push(p.hand[0], p.hand[1]); }
      else if ((p.revealMask||0) !== 0) {
        if (p.revealMask & 1) arr.push(p.hand[0]);
        if (p.revealMask & 2) arr.push(p.hand[1]);
      }
      knownOpps.set(p.id, { known: arr, need: 2 - arr.length });
    }

    // 残りデッキを構築（値比較で除外）
    const baseDeck = cloneDeck();
    // 除外: 自分の手札 + ボード + 既知の相手カード
    removeCardFrom(baseDeck, me.hand[0]);
    removeCardFrom(baseDeck, me.hand[1]);
    for (const c of knownBoard) removeCardFrom(baseDeck, c);
    for (const { known } of knownOpps.values()) for (const c of known) removeCardFrom(baseDeck, c);

    let acc = 0; // 勝ち=1、引き分けは1/nで加算
    const needBoard = Math.max(0, 5 - knownBoard.length);

    for (let t = 0; t < trials; t++) {
      // 取り出し用のシャローコピーをシャッフル（Fisher-Yates）
      const deck = baseDeck.slice();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0; [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      let di = 0;
      // 対戦相手の仮ハンド
      const trialHands = new Map();
      for (const p of players) {
        if (p.out || p.folded || p.id === 0 || p.hand.length !== 2) continue;
        const { known, need } = knownOpps.get(p.id) || { known: [], need: 2 };
        const cards = [...known];
        for (let k = 0; k < need; k++) cards.push(deck[di++]);
        trialHands.set(p.id, cards);
      }
      // 盤面の不足を補完
      const trialBoard = [...knownBoard];
      for (let k = 0; k < needBoard; k++) trialBoard.push(deck[di++]);

      // スコア評価
      const scores = new Map();
      const actives = players.filter(p => !p.out && !p.folded && p.hand.length === 2);
      for (const p of actives) {
        const hole = (p.id === 0) ? me.hand : (trialHands.get(p.id) || []);
        scores.set(p.id, bestScoreFrom([...hole, ...trialBoard]));
      }
      // 勝者
      let best = null; let winners = [];
      for (const p of actives) {
        const sc = scores.get(p.id);
        if (!best || compareScore(sc, best) > 0) { best = sc; winners = [p.id]; }
        else if (compareScore(sc, best) === 0) winners.push(p.id);
      }
      if (winners.includes(0)) acc += 1 / winners.length; // 引き分けは等分
    }
    return { win: acc / trials, trials };
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
    { id: 0, name: 'あなた', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: true,  avatar: "../../assets/avatars/player-0.png" },
    { id: 1, name: 'Bot A', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-1.png" },
    { id: 2, name: 'Bot B', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-2.png" },
    { id: 3, name: 'Bot C', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-3.png" },
  ];
  // セリフモジュールへプレイヤー参照を渡す
  setPlayersRef(players);

  // ゲーム状態
  const state = {
    deck: [],
    board: [],
    pot: 0,
    dealer: 0, // ボタン位置
    sb: 100,
    bb: 200,
    street: 'idle', // idle, preflop, flop, turn, river, showdown
    toAct: 0, // 行動者のプレイヤーID
    currentBet: 0,
    minRaise: 20,
    lastAggressor: null,
    acted: new Set(), // 直近のレイズ以降でベット状況を満たしたプレイヤー
    // ブラインドアップ関連
    blindStartMs: null,
    blindLevelIdx: 0,
    // オールイン公開（コール成立後にtrue）
    openCards: false,
    // キャラ選択
    charSelected: false,
    // 幸運の加護（強効果: 次の配布で発動する対象／残滓: 以降1ストリートだけ弱効果）
    blessingStrongFor: null,
    blessingResidualPid: null,
    blessingResidualCount: 0,
    // 勝率自動計算用
    equityLastAt: 0,
    equityBusy: false,
    // 透視（clairvoyance）同一ラウンド内の使用制限（プレイヤーIDを記録）
    usedClairvoyanceStreet: new Set(),
  };

  // ブラインドレベル（短め・合計約5分想定）
  // 各レベル50秒 × 6 = 300秒（5分）
  const BLIND_LEVELS = [
    { sb: 100,  bb: 200,  dur: 50 },
    { sb: 200,  bb: 400,  dur: 50 },
    { sb: 300,  bb: 600,  dur: 50 },
    { sb: 500,  bb: 1000, dur: 50 },
    { sb: 750,  bb: 1500, dur: 50 },
    { sb: 1000, bb: 2000, dur: 50 },
  ];
  const BLIND_THRESHOLDS = (() => {
    let acc = 0; const arr = [];
    for (const lv of BLIND_LEVELS) { acc += lv.dur; arr.push(acc); }
    return arr; // 累積秒
  })();

  function formatMMSS(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function desiredBlindLevelIdx(nowMs) {
    if (!state.blindStartMs) return 0;
    const elapsed = (nowMs - state.blindStartMs) / 1000;
    let idx = 0;
    for (let i = 0; i < BLIND_THRESHOLDS.length; i++) {
      if (elapsed >= BLIND_THRESHOLDS[i]) idx = i + 1; else break;
    }
    return Math.min(idx, BLIND_LEVELS.length - 1);
  }

  // 次のレベルまでの残り秒（スケジュール終端ならnull）
  function timeToNextLevel(nowMs) {
    if (!state.blindStartMs) return null;
    const elapsed = (nowMs - state.blindStartMs) / 1000;
    for (let i = 0; i < BLIND_THRESHOLDS.length; i++) {
      if (elapsed < BLIND_THRESHOLDS[i]) return BLIND_THRESHOLDS[i] - elapsed;
    }
    return null;
  }

  // ハンド開始時に必要ならブラインドを上げる（現在のハンドには影響しない）
  function maybeUpgradeBlindsAtNewHand() {
    const now = Date.now();
    if (!state.blindStartMs) state.blindStartMs = now; // 初回開始時刻
    const want = desiredBlindLevelIdx(now);
    if (want > state.blindLevelIdx) {
      const prev = BLIND_LEVELS[state.blindLevelIdx];
      const next = BLIND_LEVELS[want];
      state.blindLevelIdx = want;
      state.sb = next.sb;
      state.bb = next.bb;
      state.minRaise = state.bb; // レベルに合わせて更新
      log(`ブラインドアップ: ${prev.sb}/${prev.bb} → ${next.sb}/${next.bb}`);
    }
  }

  // プレイヤーの直近アクション表示用（チェック/コール/レイズ/オールイン/フォールド/ブラインド）
  function setLastAction(p, type, amount = null, label = null) {
    p.lastAction = { type, amount, label };
  }

  // セリフ（吹き出し）は ui/speech.js へ分離

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
    // 既存ログパネル（最新を上に表示）
    // 旧仕様のテキスト追記から行要素管理に切り替え
    const prevLatest = logEl.querySelector('.log-line.latest');
    if (prevLatest) prevLatest.classList.remove('latest');

    const line = document.createElement('div');
    line.className = 'log-line latest';
    line.textContent = msg;
    logEl.insertBefore(line, logEl.firstChild);

    // 先頭行が最新のためスクロール位置は上
    logEl.scrollTop = 0;
    // biim風オーバーレイ
    const overlay = document.getElementById('overlay');
    if (overlay) {
      const line = document.createElement('div');
      line.className = 'overlay-line';
      line.textContent = msg;
      overlay.appendChild(line);
      // 上限行数を維持
      while (overlay.children.length > 8) overlay.firstChild.remove();
      line.addEventListener('animationend', () => {
        line.remove();
      });
    }
  }

  // アバター読み込み（assets/avatars/player-{id}.png を自動適用）
  function loadAvatars() {
    for (const p of players) {
      const el = document.getElementById('avatar-' + p.id);
      if (!el) continue;
      const src = p.avatar;
      if (src) {
        el.style.backgroundImage = `url('${src}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
    }
  }

  // キャラクター定義（JSONから読み込み）は data/characters.js へ分離
  let CHARACTERS = [];
  let charactersLoadedPromise = null;

  // キャラクター個別ストーリー
  const CHAR_STORIES = {
    souma: {
      title: '朝霧 湊真 — 冷静沈着・無表情／未来視',
      paras: [
        '湊真は、感情を表に出すことがほとんどない。クラスで笑いが起きても、沈黙が流れても、その表情は水面のように静かだ。',
        'しかし放課後の部室でカードを手にするときだけ、瞳がわずかに揺れる。そこには、ほんの数秒先の情景が映る',
        '——まだ配られていないカード、相手が出す手、わずかな仕草。',
        '顧問が失踪したあの日、湊真は未来の断片を見た。机から滑り落ちるジョーカー、その先に広がるポーカーテーブル。',
        '未来は変えられるのか、それとも定められているのか。',
        '答えを確かめるために、湊真は静かに席を立つ。',
        '——こうして彼は、学園の代表として勝負の場に向かう決意をした。'
      ]
    },
    yusei: {
      title: '霧坂 悠聖 — おとなしい／瞬間移動',
      paras: [
        '悠聖は、常に物静かで、気配すら薄い。「あれ、さっきまでいなかったよな？」と驚かれることも珍しくない。',
        '彼の力は瞬間移動。幼い頃は遊び半分で使っていたが、人を助けるために使うようになったのは最近のことだった。',
        '顧問が消えた日、悠聖はふと職員室を通りかかった。',
        '机の上に置かれたトランプと招待状——次の瞬間、それは自分の手の中にあった。無意識に“飛んで”しまったのだ。',
        '偶然か、それとも導かれたのか。',
        '悠聖は静かに息を整えると、仲間の視線を受け止めた。',
        '——こうして彼は、学園の代表としてカードを握ることを選んだ。'
      ]
    },
    yuri: {
      title: '桜庭 柚凛 — 強気・挑発的／透視',
      paras: [
        '柚凛は負けず嫌いで、口喧嘩なら相手が誰であろうと退かない。挑発も容赦ないが、それは彼女の自信の表れでもある。',
        '片目に浮かぶ赤いスコープは、相手の隠し事を暴く透視の力。小さな秘密も、彼女の視線からは逃れられない。',
        '顧問が姿を消した翌日、柚凛は部室のロッカーに隠されていた写真を見つけた。そこには、見知らぬ街のポーカーテーブルで笑う顧問の姿があった。',
        '「アンタの隠してることも、先生の居場所も、全部暴いてやる」',
        '赤い視界に燃えるような光が宿る。',
        '——こうして彼女は、学園の代表として勝負の席に着くことを決めた。'
      ]
    },
    satsuki: {
      title: '水瀬 紗月 — おしとやか・運命の引き／幸運の加護',
      paras: [
        '紗月は柔らかな物腰の少女だが、その周囲では不思議と良い偶然が重なる。失くした物がすぐ見つかる、',
        '偶然の出会いが助けになる——まるで運命が味方しているかのように。',
        'それは彼女の“幸運の加護”と呼ばれる力。意識せずとも、引くべきカードを引き寄せてしまう。',
        '顧問が失踪した夜、紗月は夢を見た。暗い会場で配られるカード、勝利を告げる役、その後ろに立つ顧問の姿。',
        'それがただの夢か、それとも未来の兆しか——紗月は迷わなかった。',
        '——こうして彼女は、学園の代表としてその幸運を賭ける道を選んだ。'
      ]
    }
  };

  function setupCharacterSelection() {
    const layer = document.getElementById('char-select');
    if (!layer) return;
    const cards = layer.querySelectorAll('.char-card');
    cards.forEach(btn => {
      const choose = async (ev) => {
        // ストーリーボタンは選択を阻害
        if (ev.target && ev.target.closest && ev.target.closest('.btn-char-story')) return;
        if (!CHARACTERS.length) {
          try { await (charactersLoadedPromise || (charactersLoadedPromise = loadCharacters().then(res=>{ CHARACTERS = res; return res; }))); } catch(_) {}
        }
        const key = btn.getAttribute('data-char');
        const chosen = CHARACTERS.find(c => c.key === key);
        if (!chosen) return;
        // プレイヤーに選択キャラを割当
        players[0].name = chosen.name;
        players[0].avatar = chosen.avatar;
        players[0].pose = chosen.pose || chosen.avatar;
        players[0].ability = chosen.ability ? { ...chosen.ability, uses: chosen.ability.maxUses } : null;
        players[0].lines = chosen.lines || {};
        // 残りをBotへ割当（先頭3つ）
        const rest = CHARACTERS.filter(c => c.key !== key);
        [1,2,3].forEach((pid, idx) => {
          players[pid].name = rest[idx].name;
          players[pid].avatar = rest[idx].avatar;
          players[pid].pose = rest[idx].pose || rest[idx].avatar;
          players[pid].ability = rest[idx].ability ? { ...rest[idx].ability, uses: rest[idx].ability.maxUses } : null;
          players[pid].lines = rest[idx].lines || {};
        });
        state.charSelected = true;
        loadAvatars();
        renderAll();
        layer.style.display = 'none';
      };
      btn.addEventListener('click', choose);
      btn.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); choose(e);} });
    });
    // クリック委譲の保険
    layer.addEventListener('click', async (e) => {
      // ストーリーボタン
      const storyBtn = e.target.closest('.btn-char-story');
      if (storyBtn && layer.contains(storyBtn)) {
        const key = storyBtn.getAttribute('data-char');
        const data = CHAR_STORIES[key];
        if (!CHARACTERS.length) {
          try { await (charactersLoadedPromise || (charactersLoadedPromise = loadCharacters().then(res=>{ CHARACTERS = res; return res; }))); } catch(_) {}
        }
        const modal = document.getElementById('story-modal');
        const char = CHARACTERS.find(c => c.key === key);
        if (modal) {
          const h2 = modal.querySelector('h2');
          const body = modal.querySelector('.story-body');
          if (h2) h2.textContent = (data && data.title) ? data.title : (char ? char.name : '詳細');
          if (body) {
            body.innerHTML = '';
            // ストーリー
            if (data && Array.isArray(data.paras)) {
              const storySec = document.createElement('div');
              storySec.className = 'story-section';
              const h3 = document.createElement('h3'); h3.textContent = 'ストーリー'; storySec.appendChild(h3);
              data.paras.forEach(t => { const p = document.createElement('p'); p.textContent = t; storySec.appendChild(p); });
              body.appendChild(storySec);
            }
            // 能力詳細
            const abilitySec = document.createElement('div');
            abilitySec.className = 'story-section';
            const h3b = document.createElement('h3'); h3b.textContent = '能力の詳細'; abilitySec.appendChild(h3b);
            const ab = char && char.ability;
            const notesByKey = {
              foresight: ['ボード未完成時のみ使用可', '次に公開されるカードを最大3枚まで確認', '可視化は使用者のみ（相手には非公開）'],
              clairvoyance: ['相手全員の手札から各1枚を可視化', '1人につき1枚のみ（同ハンド中保持）', '可視化は使用者のみ有利な情報'],
              teleport: ['自分の手札1枚のみすり替え可能', 'リバーのボードは対象外', '山札から有利になりやすいカードを選定'],
              blessing: ['このハンド中持続（同一ハンドで連続発動不可）', '次の配布カードが有利になりやすい']
            };
            if (ab) {
              const p1 = document.createElement('p'); p1.innerHTML = `<strong>能力:</strong> ${ab.name}`; abilitySec.appendChild(p1);
              const p2 = document.createElement('p'); p2.innerHTML = `<strong>効果:</strong> ${ab.desc}`; abilitySec.appendChild(p2);
              const p3 = document.createElement('p'); p3.innerHTML = `<strong>使用回数:</strong> ${ab.maxUses} 回`; abilitySec.appendChild(p3);
              const extra = notesByKey[ab.key] || [];
              if (extra.length) {
                extra.forEach(t => { const p = document.createElement('p'); p.textContent = `・${t}`; abilitySec.appendChild(p); });
              }
            } else {
              const p0 = document.createElement('p'); p0.textContent = '能力情報を読み込み中、または見つかりませんでした。'; abilitySec.appendChild(p0);
            }
            body.appendChild(abilitySec);
          }
          modal.style.display = 'grid';
          modal.setAttribute('aria-hidden','false');
        }
        return; // キャラ選択はしない
      }
      const card = e.target.closest('.char-card');
      if (!card || !layer.contains(card)) return;
      const key = card.getAttribute('data-char');
      const chosen = CHARACTERS.find(c => c.key === key);
      if (!chosen) return;
      players[0].name = chosen.name;
      players[0].avatar = chosen.avatar;
      players[0].pose = chosen.pose || chosen.avatar;
      players[0].ability = chosen.ability ? { ...chosen.ability, uses: chosen.ability.maxUses } : null;
      players[0].lines = chosen.lines || {};
      const rest = CHARACTERS.filter(c => c.key !== key);
      [1,2,3].forEach((pid, idx) => {
        players[pid].name = rest[idx].name;
        players[pid].avatar = rest[idx].avatar;
        players[pid].pose = rest[idx].pose || rest[idx].avatar;
        players[pid].ability = rest[idx].ability ? { ...rest[idx].ability, uses: rest[idx].ability.maxUses } : null;
        players[pid].lines = rest[idx].lines || {};
      });
      state.charSelected = true;
      loadAvatars();
      renderAll();
      layer.style.display = 'none';
    });
  }

  function setupTitleScreen() {
    const title = document.getElementById('title-screen');
    const charSel = document.getElementById('char-select');
    const story = document.getElementById('story-modal');
    const btnStart = document.getElementById('btn-start');
    const btnStory = document.getElementById('btn-story');
    const btnStoryClose = document.getElementById('btn-story-close');
    if (!title || !charSel) return;
    const start = () => {
      title.style.display = 'none';
      charSel.style.display = 'grid';
    };
    // 画面クリックでも開始（既存挙動を維持）
    title.addEventListener('click', (e) => {
      // ボタンのクリックはここで扱わない
      const onButton = e.target.closest('button');
      if (onButton) return;
      start();
    });
    if (btnStart) btnStart.addEventListener('click', (e) => { e.stopPropagation(); start(); });
    if (btnStory) btnStory.addEventListener('click', (e) => { e.stopPropagation(); if (story) { story.style.display = 'grid'; story.setAttribute('aria-hidden','false'); } });
    if (btnStoryClose) btnStoryClose.addEventListener('click', () => { if (story) { story.style.display = 'none'; story.setAttribute('aria-hidden','true'); } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') start(); }, { once: true });
  }

  function showGameOver() {
    if (gameoverEl) {
      gameoverEl.style.display = 'grid';
      gameoverEl.setAttribute('aria-hidden','false');
    }
  }

  // カットイン表示
  function showCutIn(type, name, abilityName, avatarUrl, poseUrl) {
    if (!cutinEl) return;
    cutinEl.classList.remove('is-foresight','is-vision','show');
    if (type === 'foresight') cutinEl.classList.add('is-foresight');
    else if (type === 'clairvoyance') cutinEl.classList.add('is-vision');
    else if (type === 'teleport') cutinEl.classList.add('is-teleport');
    if (cutinPortrait && avatarUrl) {
      cutinPortrait.style.backgroundImage = `url('${avatarUrl}')`;
    }
    if (cutinPose) {
      const src = poseUrl || avatarUrl || '';
      cutinPose.style.backgroundImage = src ? `url('${src}')` : '';
    }
    if (cutinName) cutinName.textContent = name || '';
    if (cutinAbility) cutinAbility.textContent = abilityName || '';
    // 再生
    // reflow to restart
    // eslint-disable-next-line no-unused-expressions
    cutinEl.offsetWidth;
    cutinEl.style.display = 'block';
    cutinEl.setAttribute('aria-hidden','false');
    cutinEl.classList.add('show');
    const endFn = () => {
      cutinEl.classList.remove('show');
      cutinEl.style.display = 'none';
      cutinEl.setAttribute('aria-hidden','true');
      cutinEl.removeEventListener('animationend', endFn);
    };
    // 念のため両方で終了処理
    cutinEl.addEventListener('animationend', endFn);
    setTimeout(endFn, 1700);
  }

  // 透視対象の選択管理
  state.abilityTargeting = false; // 対象選択モード
  let abilitySeatClickHandler = null; // ワンショットハンドラ
  let abilityCardClickHandler = null; // テレポート用クリックハンドラ

  function eligibleClairvoyanceTargets() {
    return players.filter(p => !p.isUser && !p.out && !p.folded && p.hand.length === 2 && ((p.revealMask||0) !== 3));
  }

  function startClairvoyanceTargeting() {
    const me = players[0];
    if (!me.ability || me.ability.key !== 'clairvoyance' || me.ability.uses <= 0) return;
    const targets = eligibleClairvoyanceTargets();
    if (targets.length === 0) { log('透視可能な相手がいません'); return; }
    state.abilityTargeting = true;
    document.body.classList.add('targeting');
    // ターゲット可能座席に目印クラス
    targets.forEach(p => {
      const s = document.querySelector('.seat-' + p.id);
      s && s.classList.add('targetable');
    });
    log('透視: 対象の相手をクリックしてください（Escでキャンセル）');

    const finish = () => {
      state.abilityTargeting = false;
      document.body.classList.remove('targeting');
      players.forEach(pp => {
        const s = document.querySelector('.seat-' + pp.id);
        s && s.classList.remove('targetable');
      });
      if (abilitySeatClickHandler && tableEl) tableEl.removeEventListener('click', abilitySeatClickHandler);
      window.removeEventListener('keydown', onEscCancel);
      abilitySeatClickHandler = null;
    };

    function onEscCancel(e){ if (e.key === 'Escape') { log('透視をキャンセルしました'); finish(); } }
    window.addEventListener('keydown', onEscCancel);

    abilitySeatClickHandler = (e) => {
      const seat = e.target.closest('.seat');
      if (!seat) return;
      const pidStr = seat.getAttribute('data-seat');
      const pid = Number(pidStr);
      const target = players[pid];
      if (!target || target.isUser || target.out || target.folded || ((target.revealMask||0)===3)) return;
      // 発動
      me.ability.uses -= 1;
      // 2枚のうち1枚だけを公開（同一相手への再発動は不可）
      const idx = Math.random() < 0.5 ? 0 : 1;
      target.revealMask = (target.revealMask||0) | (idx===0?1:2);
      // 演出
      const overlay2 = document.getElementById('clairvoyance-overlay');
      if (overlay2) {
        overlay2.classList.add('show');
        setTimeout(() => overlay2.classList.remove('show'), 860);
      }
      // カットイン（透視）
      showCutIn('clairvoyance', me.name, me.ability?.name || '透視', me.avatar, me.pose);
      speak(me.id, 'ability_clairvoyance');
      const abilityRow = document.querySelector('.controls .row.row-ability');
      if (abilityRow) {
        abilityRow.classList.remove('flash');
        // reflow
        abilityRow.offsetWidth;
        abilityRow.classList.add('flash');
        const onEnd = () => { abilityRow.classList.remove('flash'); abilityRow.removeEventListener('animationend', onEnd); };
        abilityRow.addEventListener('animationend', onEnd);
      }
      const rc = target.hand[idx];
      const label = `${rankLabel(rc.r)}${rc.s}`;
      log(`透視: ${target.name} の手札の一部 → ${label}`);
      renderAll();
      // 透視で公開されたカードを一瞬ハイライト
      const cardsBox = document.getElementById('cards-' + pid);
      if (cardsBox) {
        const cels = cardsBox.querySelectorAll('.card');
        const el = cels && cels[target.revealIndex];
        if (el) {
          el.classList.add('vision-flash');
          el.addEventListener('animationend', () => el.classList.remove('vision-flash'), { once: true });
        }
      }
      finish();
    };
    if (tableEl) tableEl.addEventListener('click', abilitySeatClickHandler);
  }

  // テレポート対象選択（自分の手札2枚 or 盤面の公開カード）
  function startTeleportTargeting() {
    const me = players[0];
    if (!me.ability || me.ability.key !== 'teleport' || me.ability.uses <= 0) return;
    if (state.street === 'idle' || state.street === 'showdown') return;
    const hasTargets = (players[0].hand.length === 2);
    if (!hasTargets) return;

    state.abilityTargeting = true;
    document.body.classList.add('targeting');
    // 手札の対象にクラス付与（ボードは不可）
    const myCardsEl = document.getElementById('cards-0');
    myCardsEl && myCardsEl.querySelectorAll('.card').forEach(el => el.classList.add('targetable-card'));
    log('テレポート: 自分の手札からすり替えるカードをクリック（Escでキャンセル）');

    const finish = () => {
      state.abilityTargeting = false;
      document.body.classList.remove('targeting');
      myCardsEl && myCardsEl.querySelectorAll('.card').forEach(el => el.classList.remove('targetable-card'));
      // ボードへの付与はしていないため何もしない
      if (abilityCardClickHandler && tableEl) tableEl.removeEventListener('click', abilityCardClickHandler);
      window.removeEventListener('keydown', onEscCancel2);
      abilityCardClickHandler = null;
    };

    function onEscCancel2(e){ if (e.key === 'Escape') { log('テレポートをキャンセルしました'); finish(); } }
    window.addEventListener('keydown', onEscCancel2);

    abilityCardClickHandler = (e) => {
      const cardElDiv = e.target.closest('.card');
      if (!cardElDiv) return;
      const inMy = !!e.target.closest('#cards-0');
      const inBoard = !!e.target.closest('#board');
      if (!inMy && !inBoard) return;
      if (state.deck.length === 0) { log('デッキ切れのため実行できません'); finish(); return; }
      // 交換先の新カード
      const newCard = state.deck.pop();
      if (inMy) {
        // 自分の手札の何枚目か特定
        const cards = Array.from(document.querySelectorAll('#cards-0 .card'));
        const idx = cards.indexOf(cardElDiv);
        if (idx < 0 || idx > 1) return;
        const old = players[0].hand[idx];

        // なるべく強くなる候補をデッキ全体から探索
        function scoreValue(sc){
          if (!sc) return 0;
          let v = 0; for (let i=0;i<sc.length;i++) v = v*100 + (sc[i]||0); return v;
        }
        const other = players[0].hand[1-idx];
        const holeRanks = new Set([other.r]);
        function straightBiasRanks(base){ const s=new Set(); for(let d=-2; d<=2; d++) s.add(base+d); return s; }
        const biasSet = straightBiasRanks(other.r);
        function targetSuit(){
          const counts=new Map();
          [other, ...state.board].forEach(c=>counts.set(c.s,(counts.get(c.s)||0)+1));
          let bestS=null,bestN=0; for(const [s,n] of counts){ if(n>bestN){bestN=n;bestS=s;} }
          return bestS;
        }
        const suitFav = targetSuit();

        // 候補のスコア一覧を作成
        const candList = [];
        for (let di = 0; di < state.deck.length; di++) {
          const cand = state.deck[di];
          let val = 0;
          if (state.board.length >= 3) {
            const sc = bestScoreFrom([other, cand, ...state.board]);
            val += scoreValue(sc);
            const cat = sc[0] || 0; val += cat * 3000; // 後半は役カテゴリを強く優遇
          } else {
            // プリ/ポスト直後はヒューリスティクスで強化
            if (holeRanks.has(cand.r)) val += 3500;               // ペア形成
            if (cand.s === suitFav) val += 1400;                  // スート一致
            if (biasSet.has(cand.r)) val += 900;                  // 連結性
            if (cand.r >= 13) val += 250;                         // 高カード微加点
          }
          candList.push({ di, val });
        }
        candList.sort((a,b)=> b.val - a.val);
        // 少しランダム性を持たせて上位から重み付き抽選
        const topK = Math.min(8, candList.length);
        const base = 0.72; // 減衰率（小さいほどランダム性UP）
        let sumW = 0;
        const weights = [];
        for (let i=0;i<topK;i++) { const w = Math.pow(base, i); weights.push(w); sumW += w; }
        let r = Math.random() * sumW;
        let pickIdx = 0;
        for (let i=0;i<topK;i++) { r -= weights[i]; if (r <= 0) { pickIdx = i; break; } }
        const chosenIdxInDeck = candList[pickIdx].di;
        const chosen = state.deck.splice(chosenIdxInDeck, 1)[0];
        players[0].hand[idx] = chosen;
        // 古いカードは山札のランダム位置へ戻す
        const pos = Math.floor(Math.random() * (state.deck.length + 1));
        state.deck.splice(pos, 0, old);
        const label = `${rankLabel(chosen.r)}${chosen.s}`;
        log(`テレポート: 自分の手札${idx===0?'1':'2'}枚目を ${label} にすり替え`);
        // 演出フラッシュ
        if (cards[idx]) {
          cards[idx].classList.add('teleport-flash');
          cards[idx].addEventListener('animationend', () => cards[idx].classList.remove('teleport-flash'), { once: true });
        }
      } else if (inBoard) {
        log('テレポート: ボードのカードはすり替え不可');
        return;
      }
      me.ability.uses -= 1;
      // カットイン（テレポート）
      showCutIn('teleport', me.name, me.ability.name, me.avatar, me.pose);
      speak(me.id, 'ability_teleport');
      renderAll();
      finish();
    };
    if (tableEl) tableEl.addEventListener('click', abilityCardClickHandler);
  }

  // 次にボードに乗る予定のカードを最大3枚まで取得（現在のデッキ末尾から）
  function predictFutureBoardCards(max = 3) {
    if (state.board.length >= 5) return [];
    if (!state.deck || state.deck.length === 0) return [];
    const remaining = Math.max(0, 5 - state.board.length);
    const count = Math.min(max, remaining, state.deck.length);
    const seq = [];
    for (let i = 1; i <= count; i++) {
      seq.push(state.deck[state.deck.length - i]);
    }
    // seq は次に出る順（先に出るカードが先頭）
    return seq;
  }

  function useAbility() {
    const me = players[0];
    if (!me.ability || me.ability.uses <= 0) return;
    if (state.street === 'idle' || state.street === 'showdown') return;
    if (me.ability.key === 'foresight') {
      if (state.board.length >= 5) return;
      const cards = predictFutureBoardCards(3);
      if (!cards.length) return;
      me.ability.uses -= 1;
      // 発動オーバーレイ
      const overlay = document.getElementById('ability-overlay');
      if (overlay) {
        overlay.classList.add('show');
        setTimeout(() => overlay.classList.remove('show'), 820);
      }
      // カットイン（未来視）
      showCutIn('foresight', me.name, me.ability.name, me.avatar, me.pose);
      speak(me.id, 'ability_foresight');
      // 能力行のハイライト
      const abilityRow = document.querySelector('.controls .row.row-ability');
      if (abilityRow) {
        abilityRow.classList.remove('flash');
        abilityRow.offsetWidth; // reflow
        abilityRow.classList.add('flash');
        const onEnd = () => { abilityRow.classList.remove('flash'); abilityRow.removeEventListener('animationend', onEnd); };
        abilityRow.addEventListener('animationend', onEnd);
      }
      if (peekEl) {
        peekEl.innerHTML = '';
        cards.forEach((c, idx) => {
          const el = cardEl(c, true);
          peekEl.appendChild(el);
          setTimeout(() => el.classList.add('reveal'), 80 * idx);
        });
      }
      const label = cards.map(c => `${rankLabel(c.r)}${c.s}`).join(', ');
      log(`未来視: 予定のカード → ${label}`);
      updateControls();
      return;
    }
    if (me.ability.key === 'clairvoyance') {
      // 同一ラウンド中は1回まで
      if (state.usedClairvoyanceStreet.has(0)) { log('透視: このラウンドでは既に使用しました'); return; }
      // 全プレイヤー（相手）を対象に各1枚可視化
      const eligible = players.filter(p => !p.isUser && !p.out && p.hand.length === 2 && ((p.revealMask||0) !== 3));
      if (eligible.length === 0) { log('透視: 新たに可視化できる相手がいません'); return; }
      const chosenTargets = eligible; // 全員対象
      me.ability.uses -= 1;
      state.usedClairvoyanceStreet.add(0);
      // エフェクト
      const overlay2 = document.getElementById('clairvoyance-overlay');
      if (overlay2) { overlay2.classList.add('show'); setTimeout(() => overlay2.classList.remove('show'), 860); }
      showCutIn('clairvoyance', me.name, me.ability?.name || '透視', me.avatar, me.pose);
      // 可視化処理
      const changed = [];
      const revealPairs = [];
      chosenTargets.forEach(t => {
        let mask = t.revealMask||0;
        // 点数差による2枚化バイアス（通常は50%で2枚、劣勢時は上方修正）
        let wantTwo = false;
        try {
          const eq = estimateEquity(200).win; // 軽量
          const probTwo = eq < 0.5 ? 0.8 : 0.5; // 劣勢時は2枚の確率を上げる
          wantTwo = Math.random() < probTwo;
        } catch(_) { wantTwo = Math.random() < 0.5; }
        if (mask===0) {
          if (wantTwo) { mask = 3; changed.push({pid:t.id, idx:0}); changed.push({pid:t.id, idx:1}); }
          else { const idx = (Math.random()<0.5?0:1); mask = (idx===0?1:2); changed.push({pid:t.id, idx}); }
        } else if (mask===1 || mask===2) {
          const missing = (mask===1?2:1);
          if (wantTwo) { mask = 3; changed.push({pid:t.id, idx: (missing===1?0:1)}); }
          // 既に1枚は見えているので必ず1枚以上は新規開示される
        }
        t.revealMask = mask;
        // ログ用: 現在見えているカードを列挙
        const names = [];
        if (mask&1) names.push(`${rankLabel(t.hand[0].r)}${t.hand[0].s}`);
        if (mask&2) names.push(`${rankLabel(t.hand[1].r)}${t.hand[1].s}`);
        revealPairs.push(`${t.name}:${names.join('&')}`);
      });
      log(`透視: ${revealPairs.join(' / ')}`);
      renderAll();
      // フラッシュ演出
      changed.forEach(({pid, idx}) => {
        const box = document.getElementById('cards-' + pid);
        if (!box) return;
        const cards = box.querySelectorAll('.card');
        const el = cards && cards[idx];
        if (el) {
          el.classList.add('vision-flash');
          el.addEventListener('animationend', () => el.classList.remove('vision-flash'), { once: true });
        }
      });
      updateControls();
      return;
    }
    if (me.ability.key === 'teleport') {
      startTeleportTargeting();
      updateControls();
      return;
    }
    if (me.ability.key === 'blessing') {
      if (state.board.length >= 5) return;
      // このハンドでは強効果が未使用のときのみ
      if (state.blessingStrongFor != null) return;
      me.ability.uses -= 1;
      state.blessingStrongFor = 0; // 次の配布で強効果
      // 残滓は goNextStreet で自動設定（1ストリート分の弱効果）
      log('幸運の加護: 次のカードが味方する…');
      showCutIn('blessing', me.name, me.ability.name, me.avatar, me.pose);
      speak(me.id, 'ability_blessing');
      // 能力行のハイライト
      const abilityRow = document.querySelector('.controls .row.row-ability');
      if (abilityRow) {
        abilityRow.classList.remove('flash');
        abilityRow.offsetWidth; // reflow
        abilityRow.classList.add('flash');
        const onEnd = () => { abilityRow.classList.remove('flash'); abilityRow.removeEventListener('animationend', onEnd); };
        abilityRow.addEventListener('animationend', onEnd);
      }
      updateControls();
      return;
    }
  }

  // 表示更新
  function renderAll() {
    potEl.textContent = String(state.pot);
    streetEl.textContent = `ステージ: ${state.street}`;
    turnEl.textContent = state.street === 'idle' ? '' : `次の行動: ${players[state.toAct]?.name ?? ''}`;
    // ゲーム未開始（idle）かつキャラ未選択のときは座席UIを非表示
    const seatsWrap = document.querySelector('.seats');
    if (seatsWrap) seatsWrap.style.display = (state.charSelected || state.street !== 'idle') ? 'block' : 'none';
    // ブラインド表示（次レベルまでの残り時間も表示）
    if (blindsEl) {
      const now = Date.now();
      const cur = BLIND_LEVELS[state.blindLevelIdx] || {sb: state.sb, bb: state.bb};
      const remain = timeToNextLevel(now);
      const nextIdx = Math.min(state.blindLevelIdx + 1, BLIND_LEVELS.length - 1);
      const next = BLIND_LEVELS[nextIdx];
      if (remain == null || nextIdx === state.blindLevelIdx) {
        blindsEl.textContent = `ブラインド: ${cur.sb}/${cur.bb}`;
      } else {
        blindsEl.textContent = `ブラインド: ${cur.sb}/${cur.bb}（次 ${next.sb}/${next.bb} まで ${formatMMSS(remain)}）`;
      }
    }
    // ボード
    boardEl.innerHTML = '';
    if (state.board.length === 0) {
      boardEl.style.display = 'none';
    } else {
      boardEl.style.display = 'flex';
      state.board.forEach((c, i) => {
        const el = cardEl(c, true);
        if (state.street === 'showdown') {
          if (boardStrongHL.has(c)) el.classList.add('hl-strong');
          // 敗者の使用カードは強調しない（hl-softは使用しない）
        }
        el.dataset.boardIndex = String(i);
        el.classList.add('board-card');
        boardEl.appendChild(el);
      });
    }
    // 各席
    for (const p of players) {
      const seatEl = document.querySelector('.seat-' + p.id);
      if (seatEl) {
        const isMyTurn = (state.toAct === p.id && !p.folded && !p.allIn && !p.out && state.street !== 'idle' && state.street !== 'showdown');
        seatEl.classList.toggle('folded', !!p.folded);
        seatEl.classList.toggle('is-turn', isMyTurn);
      }
      $('chips-' + p.id).textContent = String(p.chips);
      $('bet-' + p.id).textContent = String(p.bet);
      const cardsBox = $('cards-' + p.id);
      cardsBox.innerHTML = '';
      // ショーダウン参加者はstreetがidleに遷移しても表示を継続
      const participated = showdownInfo.has(p.id);
      const showSeat = (!p.out) || participated; // ショーダウン参加者は離脱後も表示
      // 公開条件: ユーザー or ショーダウン or （オールイン公開フラグON かつ 当該プレイヤーがオールイン）
      const showBoth = (p.isUser || showdownInfo.has(p.id) || (state.street !== 'idle' && state.openCards && p.allIn)) && showSeat;
      const rmask = p.revealMask || 0;
      const face0 = showSeat && (showBoth || (rmask & 1));
      const face1 = showSeat && (showBoth || (rmask & 2));
      if (p.hand.length && showSeat) {
        const c0 = cardEl(p.hand[0], face0);
        const c1 = cardEl(p.hand[1], face1);
        // 勝者の勝因カードのみ強調（キッカーは除外）
        if (state.street === 'showdown' && winnersSet.has(p.id) && showdownInfo.has(p.id)) {
          const info = showdownInfo.get(p.id);
          const decisive = new Set(decisiveUsedCards(info.used, info.score));
          if (decisive.has(p.hand[0])) c0.classList.add('hl-strong');
          if (decisive.has(p.hand[1])) c1.classList.add('hl-strong');
        }
        cardsBox.appendChild(c0);
        cardsBox.appendChild(c1);
      }
      const st = $('state-' + p.id);
      if (state.street === 'showdown' && showdownInfo.has(p.id)) {
        st.textContent = handName(showdownInfo.get(p.id).score);
      } else if (state.street === 'idle') {
        st.textContent = '';
      } else if (p.out) {
        st.textContent = '離脱';
      } else if (p.folded) {
        st.innerHTML = '<span class="badge-action is-fold">フォールド</span>';
      } else if (p.allIn) {
        st.innerHTML = '<span class="badge-action is-allin">オールイン</span>';
      } else if (p.lastAction && p.lastAction.type) {
        const la = p.lastAction;
        const span = document.createElement('span');
        let cls = '';
        let text = '';
        switch (la.type) {
          case 'check': cls = 'is-check'; text = 'チェック'; break;
          case 'call': cls = 'is-call'; text = 'コール' + (la.amount!=null ? `(${la.amount})` : ''); break;
          case 'raise': cls = 'is-raise'; text = 'レイズ' + (la.amount!=null ? `(+${la.amount})` : ''); break;
          case 'blind': cls = 'is-raise'; text = (la.label || '') + (la.amount!=null ? `(${la.amount})` : ''); break;
          case 'allin': cls = 'is-allin'; text = 'オールイン'; break;
          case 'fold': cls = 'is-fold'; text = 'フォールド'; break;
          default: text = ''; break;
        }
        span.className = 'badge-action ' + cls;
        span.textContent = text;
        st.innerHTML = '';
        st.appendChild(span);
      } else if (state.toAct === p.id) {
        st.textContent = '行動中';
      } else {
        st.textContent = '';
      }
      // 勝者バッジを名前の右に表示
      const nameEl = $('name-' + p.id);
      if ((state.street === 'showdown') && winnersCount.get(p.id) > 0) {
        nameEl.innerHTML = `${p.name}<span class="badge">勝者×${winnersCount.get(p.id)}</span>`;
      } else {
        nameEl.textContent = p.name;
      }
      // 透視中バッジ（相手に対して付与）
      const st2 = $('state-' + p.id);
      if ((p.revealMask||0) > 0 && state.street !== 'showdown') {
        const span = document.createElement('span');
        span.className = 'badge-action is-raise';
        span.textContent = (rmask===3) ? '透視中(2枚)' : '透視中(1枚)';
        st2.appendChild(span);
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
    // 新しいハンドボタンは、キャラ選択済み かつ ハンドが未進行（idleまたはshowdown）のときのみ有効
    if (btnNew) btnNew.disabled = (!state.charSelected) || (state.street !== 'idle' && state.street !== 'showdown');

    // 勝率の自動計算（軽量試行・スロットリング）
    if (equityEl) {
      if (state.street === 'idle') {
        equityEl.textContent = '--';
      } else {
        const now = Date.now();
        if (!state.equityBusy && now - state.equityLastAt > 600) {
          state.equityBusy = true;
          setTimeout(() => {
            try {
              const { win, trials } = estimateEquity(250);
              const pct = Math.round(win * 1000) / 10;
              equityEl.textContent = `${pct}%（${trials}回）`;
            } catch (e) {
              equityEl.textContent = '--';
            } finally {
              state.equityBusy = false;
              state.equityLastAt = Date.now();
            }
          }, 0);
        }
      }
    }
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

    // 能力ボタン
    const btnAbility = document.getElementById('btn-ability');
    if (btnAbility) {
      let canUse = false;
      if (me.ability) {
        const hasUses = me.ability.uses > 0;
        if (me.ability.key === 'foresight') {
          const stageOK = state.street !== 'idle' && state.street !== 'showdown' && state.board.length < 5;
          canUse = hasUses && stageOK;
        } else if (me.ability.key === 'clairvoyance') {
          const stageOK = state.street !== 'idle' && state.street !== 'showdown';
          const hasTarget = eligibleClairvoyanceTargets().length > 0;
          canUse = hasUses && stageOK && hasTarget && !state.abilityTargeting;
        } else if (me.ability.key === 'teleport') {
          const stageOK = state.street !== 'idle' && state.street !== 'showdown';
          const hasTarget = (players[0].hand.length === 2);
          canUse = hasUses && stageOK && hasTarget && !state.abilityTargeting;
        } else if (me.ability.key === 'blessing') {
          const stageOK = state.street !== 'idle' && state.street !== 'showdown' && state.board.length < 5;
          const notActive = (state.blessingStrongFor == null); // このハンドで未発動のときのみ
          canUse = hasUses && stageOK && notActive && !state.abilityTargeting;
        }
        if (abilityUsesEl) abilityUsesEl.textContent = hasUses ? `残り ${me.ability.uses} 回` : '残り 0 回';
        btnAbility.textContent = `能力: ${me.ability.name}`;
      } else {
        if (abilityUsesEl) abilityUsesEl.textContent = '';
        btnAbility.textContent = '能力';
      }
      btnAbility.disabled = !canUse;
    }

    // 未来視の表示欄（peek行）は、能力が未来視のときのみ表示
    const peekRow = document.getElementById('row-peek') || (peekEl && peekEl.closest('.row'));
    if (peekRow) {
      const showPeek = !!(me.ability && me.ability.key === 'foresight');
      peekRow.style.display = showPeek ? 'flex' : 'none';
      if (!showPeek && peekEl) peekEl.innerHTML = '';
    }
  }

  // 新しいハンド
  function newHand() {
    // 進行中のハンド中は新規開始を禁止（多重開始防止）
    if (state.street !== 'idle' && state.street !== 'showdown') {
      log('現在のハンドが進行中です。ハンド終了後に開始してください');
      return;
    }
    // ゲーム続行可能か判定（参加者が2人未満なら終了）
    if (alivePlayersCount() < 2) {
      state.street = 'idle';
      log('ゲーム終了：残り参加者が1人以下です');
      const me = players[0];
      if (me.out || me.chips <= 0) showGameOver();
      renderAll();
      return;
    }

    // 前ハンドのショーダウン情報/ハイライトは毎ハンド冒頭でクリア
    showdownInfo.clear();
    winnersSet.clear();
    boardSoftHL.clear();
    boardStrongHL.clear();
    winnersCount.clear();

    state.openCards = false;
    maybeUpgradeBlindsAtNewHand();
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
    if (peekEl) peekEl.innerHTML = '';
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
    // レイズ入力のデフォルトをリセット（前ハンド値の持ち越しを防ぐ）
    if (raiseAmt) {
      const minTotal = state.currentBet + state.minRaise;
      raiseAmt.value = String(minTotal);
    }
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
    setLastAction(p, 'blind', pay, label);
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
    // フォールド・離脱を除く全員が「行動済み」または行動不能（オールイン）
    const everyone = players.filter(p => !p.folded && !p.out);
    return everyone.every(p => p.allIn || state.acted.has(p.id));
  }

  function updateOpenCardsFlag() {
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

  function everyoneAllInOrNoActionLeft() {
    const active = players.filter(p => !p.folded && !p.out);
    if (active.length <= 1) return true;
    if (active.every(p => p.allIn)) return true;
    if (state.openCards) {
      // 全員が現在額に揃っているなら、チェックを待たずに先へ
      if (active.every(p => p.allIn || p.bet === state.currentBet)) return true;
    }
    return false;
  }

  function goNextStreet() {
    // ベットをリセット
    for (const p of players) p.bet = 0;
    state.currentBet = 0;
    state.minRaise = state.bb;
    state.lastAggressor = null;
    state.acted = new Set();
    // 直近アクションは次ストリートでクリア
    for (const p of players) { if (!p.folded && !p.out) p.lastAction = null; }
    // ストリートが進んだら 透視の同一ラウンド制限を解除
    state.usedClairvoyanceStreet = new Set();

    if (players.filter(p => !p.folded && !p.out).length <= 1) {
      showdown();
      return;
    }

    if (state.street === 'preflop') {
      // 幸運の加護（強→残滓）
      if (state.blessingStrongFor!=null) { applyBlessingBeforeDeal(state.blessingStrongFor, 3); state.blessingStrongFor=null; state.blessingResidualPid = players[0]?.id ?? 0; state.blessingResidualCount = 1; }
      else if (state.blessingResidualPid!=null && state.blessingResidualCount>0) { applyBlessingBeforeDeal({pid:state.blessingResidualPid, weak:true}, 3); state.blessingResidualCount--; if (state.blessingResidualCount<=0) { state.blessingResidualPid=null; } }
      // フロップ 3枚
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
    // 幸運の加護はこのハンド中ずっと有効（解除しない）
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
      setLastAction(p, 'fold');
      speak(pid, 'fold');
    } else if (action === 'check') {
      if (p.bet !== state.currentBet) return;
      log(`${p.name}: チェック`);
      state.acted.add(pid);
      setLastAction(p, 'check');
      speak(pid, 'check');
      updateOpenCardsFlag();
    } else if (action === 'call') {
      const need = state.currentBet - p.bet;
      if (need <= 0) { /* チェック相当 */ log(`${p.name}: チェック`); state.acted.add(pid); setLastAction(p, 'check'); speak(pid,'check'); }
      else if (p.chips <= 0) { /* 何もしない */ }
      else if (p.chips < need) { // オールイン・コール（部分）
        const pay = p.chips;
        p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
        log(`${p.name}: オールイン（${pay}）`);
        state.acted.add(pid);
        setLastAction(p, 'allin', pay);
        speak(pid, 'allin');
      } else {
        p.chips -= need; p.bet += need; p.total += need; state.pot += need;
        log(`${p.name}: コール ${need}`);
        state.acted.add(pid);
        setLastAction(p, 'call', need);
        speak(pid, 'call');
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
        speak(pid, 'raise');
      }
      updateOpenCardsFlag();
    } else if (action === 'allin') {
      if (p.chips <= 0) return;
      const prevBetLevel = state.currentBet;
      const prevPBet = p.bet;
      const pay = p.chips;
      p.chips = 0; p.allIn = true; p.bet += pay; p.total += pay; state.pot += pay;
      log(`${p.name}: オールイン（${pay}）`);
      setLastAction(p, 'allin', pay);
      speak(pid, 'allin');
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
    const active = players.filter(p => !p.folded && !p.out);
    state.street = 'showdown';
    // 役表示・ハイライトの残留を避けるため、まずクリア
    showdownInfo.clear();
    winnersSet.clear();
    boardSoftHL.clear();
    boardStrongHL.clear();
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
      // 勝者のIDを登録し、勝因のコミュニティカードのみ強調対象へ
      for (const wid of winners) {
        winnersSet.add(wid);
        winnersCount.set(wid, (winnersCount.get(wid) || 0) + 1);
        const info = showdownInfo.get(wid);
        const decisive = decisiveUsedCards(info?.used || [], info?.score);
        for (const card of decisive) if (state.board.includes(card)) boardStrongHL.add(card);
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const id of winners) players[id].chips += share;
      if (remainder > 0) players[winners[0]].chips += remainder; // 余りは先頭へ（簡略）
      log(`${potName}: 勝者 ${winners.map(id=>players[id].name).join(', ')} / ${pot.amount}`);
    });
    // セリフ（勝ち/負け）
    try {
      for (const p of players) {
        if (p.out) continue;
        if (winnersSet.has(p.id)) speak(p.id, 'win');
        else if (!p.folded) speak(p.id, 'lose');
      }
    } catch(_) {}
    state.pot = 0;
    // チップが尽きたプレイヤーは離脱（ユーザーならゲームオーバー表示）
    for (const p of players) {
      if (!p.out && p.chips <= 0) {
        p.out = true;
        p.folded = true;
        p.allIn = false;
        log(`${p.name}: チップが尽きたため離脱`);
        if (p.id === 0) showGameOver();
      }
    }
    // 残り人数チェック
    const alive = players.filter(p => !p.out);
    if (alive.length <= 1) {
      const champ = alive[0];
      if (champ) log(`ゲーム終了: 優勝 ${champ.name}`);
      else log('ゲーム終了: 参加者なし');
      // 直後はショーダウン表示を維持して手札を公開したままにする
      // 次のハンド開始時（newHand）で状態をクリアする
      // プレイヤーが破産していたらゲームオーバー表示
      const me = players[0];
      if (me.out || me.chips <= 0) showGameOver();
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

  // 役評価ロジックは core/scoring.js へ分離

  // 幸運の加護: 次に配るカードk枚を、有利になるようデッキ末尾付近から強く選ぶ
  function applyBlessingBeforeDeal(forPid, k) {
    let weak = false;
    if (typeof forPid === 'object' && forPid) { weak = !!forPid.weak; forPid = forPid.pid; }
    const me = players[forPid];
    if (!me || me.folded || me.out) return;
    if (k <= 0) return;

    // 評価値に変換（役比較を数値化）
    function scoreValue(sc){
      if (!sc) return 0;
      let v = 0;
      for (let i=0;i<sc.length;i++) v = v*100 + (sc[i]||0);
      return v;
    }

    // 直近のスート傾向（フラッシュ狙いのボーナス）
    function targetSuit(board){
      const counts = new Map();
      [...me.hand, ...board].forEach(c=>counts.set(c.s,(counts.get(c.s)||0)+1));
      let bestS = null, bestN = 0;
      for (const [s,n] of counts) if (n>bestN){ bestN=n; bestS=s; }
      return bestS;
    }

    const holeRanks = new Set(me.hand.map(c=>c.r));

    function straightBiasRanks(){
      // 積極的につながりやすいレンジを作る（±2以内を優遇）
      const rs = [...holeRanks];
      const bias = new Set();
      for (const r of rs){
        for (let d=-2; d<=2; d++) bias.add(r+d);
      }
      return bias;
    }
    const biasSet = straightBiasRanks();

    function pickOne(tempBoard) {
      if (state.deck.length === 0) return;
      const last = state.deck.length - 1;
      const winSize = weak ? Math.min(12, state.deck.length) : state.deck.length; // 残滓は控えめに
      const suitFav = targetSuit(tempBoard);
      let bestIdx = last;
      let bestVal = -1;
      for (let i = 0; i < winSize; i++) {
        const idx = last - i;
        const cand = state.deck[idx];
        let val = 0;
        if (tempBoard.length >= 3) {
          const sc = bestScoreFrom([...me.hand, ...tempBoard, cand]);
          val += scoreValue(sc);
          // 成立役カテゴリに応じてさらに加点
          const cat = sc[0] || 0;
          val += cat * (weak ? 800 : 2000);
        } else {
          // 事前（フロップ前など）はヒューリスティクス重視
          // ペア/スート/連結性を強く優遇
          if (holeRanks.has(cand.r)) val += weak ? 1200 : 3000;          // ペア形成
          if (cand.s === suitFav) val += weak ? 500 : 1200;             // 同スート強化
          if (biasSet.has(cand.r)) val += weak ? 300 : 800;             // つながり強化
          // A/K/Q など高カードのわずかな加点
          if (cand.r >= 13) val += weak ? 80 : 200;
        }
        // 総合
        bestIdx = (val > bestVal) ? idx : bestIdx;
        bestVal = Math.max(bestVal, val);
      }
      // 選んだカードを末尾へ（次に配る）
      [state.deck[bestIdx], state.deck[last]] = [state.deck[last], state.deck[bestIdx]];
    }

    const temp = [...state.board];
    for (let t = 0; t < k; t++) {
      pickOne(temp);
      // 次に出るカード（末尾）を仮にボードに追加して、次の選定の下地にする
      temp.push(state.deck[state.deck.length - 1]);
    }
  }

  // best5Detailed / decisiveUsedCards は core/scoring.js を利用

  function compareScore(a, b) {
    for (let i=0;i<Math.max(a.length,b.length);i++){
      const av=a[i]??0, bv=b[i]??0;
      if (av!==bv) return av>bv?1:-1;
    }
    return 0;
  }

  // スコアを0..1の概略強さへマップ
  function scoreStrength01(score, board, hand) {
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
  function revealedForViewer(viewerId){
    const map = seenBy.get(viewerId);
    if (!map) return [];
    const arr = [];
    for (const [tid, idx] of map.entries()) {
      const t = players[tid];
      if (!t || !t.hand || t.hand.length !== 2) continue;
      arr.push({ target: t, card: t.hand[idx] });
    }
    return arr;
  }

  function botThreatFromReveals(p){
    const reveals = revealedForViewer(p.id);
    if (!reveals.length) return 0;
    const ranksOnBoard = new Set(state.board.map(c=>c.r));
    const suitCounts = new Map();
    state.board.forEach(c=>suitCounts.set(c.s,(suitCounts.get(c.s)||0)+1));
    let maxSuitCount = 0; let flushSuit = null;
    for (const [s,n] of suitCounts){ if(n>maxSuitCount){maxSuitCount=n; flushSuit=s;} }
    let threat = 0;
    for (const {card} of reveals){
      if (ranksOnBoard.has(card.r)) threat += 0.7;       // 相手がボードとペア
      if (maxSuitCount>=3 && card.s === flushSuit) threat += 0.4; // フラッシュ目
      if (card.r >= 13) threat += 0.2;                   // 高カード
    }
    return Math.min(threat, 2.0);
  }

  function botAggressionFromForesight(p){
    const seq = foresightMem.get(p.id);
    if (!seq || !seq.length) return 0;
    const cur = bestScoreFrom([...p.hand, ...state.board]);
    const next = bestScoreFrom([...p.hand, ...state.board, seq[0]]);
    const diff = compareScore(next, cur);
    if (diff > 0) return 0.6;
    return 0.0;
  }
  function botMaybeUseAbility(p) {
    if (!p.ability || p.ability.uses <= 0) return false;
    if (state.street === 'idle' || state.street === 'showdown') return false;
    const r = Math.random();
    // 基本的な使用確率
    if (p.ability.key === 'foresight') {
      if (state.board.length >= 5) return false;
      if (r < 0.25) {
        const cards = predictFutureBoardCards(3);
        foresightMem.set(p.id, cards);
        p.ability.uses -= 1;
        log(`${p.name}: 能力を発動（未来視）`);
        const overlay = document.getElementById('ability-overlay');
        if (overlay) { overlay.classList.add('show'); setTimeout(()=>overlay.classList.remove('show'), 820); }
        showCutIn('foresight', p.name, p.ability.name, p.avatar, p.pose);
        speak(p.id, 'ability_foresight');
        p.aggrPulse = (p.aggrPulse||0) + 2;
        return true;
      }
    } else if (p.ability.key === 'clairvoyance') {
      // 未公開のターゲットがいるとき発動（自分視点の記憶のみ）
      const targets = players.filter(t => t.id !== p.id && !t.out && t.hand.length === 2);
      if (targets.length && r < 0.28) {
        const seen = seenBy.get(p.id) || new Map();
        const fresh = targets.filter(t => !seen.has(t.id));
        if (fresh.length === 0) return false;
        // ユーザー版は一括公開だが、Botは1〜全員の中から2人までを見る（ランダム）
        const cnt = Math.min(2, fresh.length);
        for (let i=0;i<cnt;i++) {
          const t = fresh[i];
          const idx = Math.random() < 0.5 ? 0 : 1;
          if (!seenBy.has(p.id)) seenBy.set(p.id, new Map());
          seenBy.get(p.id).set(t.id, idx);
        }
        p.ability.uses -= 1;
        log(`${p.name}: 能力を発動（透視）`);
        const overlay2 = document.getElementById('clairvoyance-overlay');
        if (overlay2) { overlay2.classList.add('show'); setTimeout(()=>overlay2.classList.remove('show'), 860); }
        showCutIn('clairvoyance', p.name, p.ability.name, p.avatar, p.pose);
        speak(p.id, 'ability_clairvoyance');
        p.aggrPulse = (p.aggrPulse||0) + 1;
        return true;
      }
    } else if (p.ability.key === 'teleport') {
      // 自分の手札1枚を強化置換
      if (p.hand.length === 2 && state.deck.length > 0 && r < 0.22) {
        // どちらのカードを置換すると良いかざっくり比較
        const evalIdx = (idx) => {
          const other = p.hand[1-idx];
          const sc = bestScoreFrom([other, ...state.board]);
          return (sc && sc[0])||0;
        };
        const pickIdx = evalIdx(0) < evalIdx(1) ? 0 : 1;
        // 置換先の選定（ユーザーと同様の重み抽選）
        const other = p.hand[1-pickIdx];
        const holeRanks = new Set([other.r]);
        const biasSet = new Set([other.r-2, other.r-1, other.r, other.r+1, other.r+2]);
        const suitFav = (()=>{ const m=new Map(); [other,...state.board].forEach(c=>m.set(c.s,(m.get(c.s)||0)+1)); let bs=null,bn=0; for(const [s,n] of m){ if(n>bn){bn=n; bs=s;} } return bs; })();
        const candList = [];
        for (let di=0; di<state.deck.length; di++){
          const cand = state.deck[di];
          let val = 0;
          if (state.board.length >= 3) {
            const sc = bestScoreFrom([other, cand, ...state.board]);
            val += ((sc&&sc.reduce((a,v)=>a*100+(v||0),0))||0);
            const cat = sc?.[0]||0; val += cat*2500;
          } else {
            if (holeRanks.has(cand.r)) val += 3200;
            if (cand.s === suitFav) val += 1200;
            if (biasSet.has(cand.r)) val += 800;
            if (cand.r >= 13) val += 200;
          }
          candList.push({di, val});
        }
        candList.sort((a,b)=>b.val-a.val);
        const topK = Math.min(8, candList.length);
        const base = 0.72; let sum=0; const ws=[]; for(let i=0;i<topK;i++){ const w=Math.pow(base,i); ws.push(w); sum+=w; }
        let rr = Math.random()*sum; let pick=0; for(let i=0;i<topK;i++){ rr-=ws[i]; if(rr<=0){ pick=i; break; } }
        const chosenIdxInDeck = candList[pick].di;
        const chosen = state.deck.splice(chosenIdxInDeck,1)[0];
        const old = p.hand[pickIdx];
        p.hand[pickIdx] = chosen;
        const pos = Math.floor(Math.random()*(state.deck.length+1));
        state.deck.splice(pos,0,old);
        p.ability.uses -= 1;
        log(`${p.name}: 能力を発動（瞬間移動）`);
        showCutIn('teleport', p.name, p.ability.name, p.avatar, p.pose);
        speak(p.id, 'ability_teleport');
        p.justTeleported = true;
        return true;
      }
    } else if (p.ability.key === 'blessing') {
      if (state.board.length < 5 && state.blessingStrongFor == null && r < 0.25) {
        p.ability.uses -= 1;
        state.blessingStrongFor = p.id;
        log(`${p.name}: 能力を発動（幸運の加護）`);
        showCutIn('blessing', p.name, p.ability.name, p.avatar, p.pose);
        speak(p.id, 'ability_blessing');
        p.aggrPulse = (p.aggrPulse||0) + 2;
        return true;
      }
    }
    return false;
  }

  function botAct(pid) {
    const p = players[pid];
    const need = state.currentBet - p.bet;
    const rnd = Math.random();
    // ときどき能力を使用
    botMaybeUseAbility(p);
    const threat = botThreatFromReveals(p);
    let aggr = botAggressionFromForesight(p);
    if (p.justTeleported) { aggr += 0.25; p.justTeleported = false; }
    if (state.blessingFor === p.id) aggr += 0.25; // 加護中は前向き
    if (p.aggrPulse && p.aggrPulse > 0) aggr += 0.25;
    if (state.street === 'preflop') {
      // ざっくりプリフロップ強さ
      const [a,b] = p.hand.map(c=>c.r).sort((x,y)=>y-x);
      const suited = p.hand[0].s === p.hand[1].s;
      const pair = a===b;
      let score = a + b + (pair?20:0) + (suited?3:0);
      const preStrength = Math.min(1, (a+b-4) / 24) + (pair?0.4:0) + (suited?0.1:0);
      if (need === 0) {
        const raiseProb = Math.max(0, Math.min(0.9, (score>=26?0.4:0.12) + preStrength*0.2 + aggr*0.4 - threat*0.2));
        if (rnd < raiseProb) return doRaise(pid, state.currentBet + state.minRaise);
        return doCheckOrCall(pid);
      } else {
        const callProb = Math.max(0, Math.min(0.97, (score>=25?0.72:0.28) + preStrength*0.2 + aggr*0.3 - threat*0.25));
        if (rnd < callProb) return doCheckOrCall(pid);
        return doFold(pid);
      }
    } else {
      // ポストフロップ：役評価
      const made = bestScoreFrom([...p.hand, ...state.board]);
      const cat = made[0];
      const strength = scoreStrength01(made, state.board, p.hand); // 0..1
      if (need === 0) {
        const baseRaise = (cat>=4?0.72:cat>=3?0.58:cat>=2?0.42:cat>=1?0.18:0.06);
        const raiseProb = Math.max(0, Math.min(0.92, baseRaise + strength*0.3 + aggr*0.4 - threat*0.22));
        if (rnd < raiseProb) return doRaise(pid, state.currentBet + state.minRaise);
        if (cat >= 1 || rnd < (0.22 + strength*0.3 + aggr*0.25 - threat*0.18)) return doCheckOrCall(pid);
        return doCheck(pid);
      } else {
        const potOdds = need / Math.max(1, (state.pot + need));
        const equity = strength; // ざっくり強さをエクイティとして扱う
        const callBoost = Math.max(0, equity - potOdds); // 有利なら上積み
        const callProb = Math.max(0, Math.min(0.97, (cat>=3?0.8:cat>=2?0.66:cat>=1?0.44:0.2) + callBoost*1.0 + aggr*0.3 - threat*0.25));
        if (rnd < callProb) return doCheckOrCall(pid);
        return doFold(pid);
      }
    }
    // 一時的攻撃性の減衰
    if (p.aggrPulse && p.aggrPulse > 0) p.aggrPulse -= 1;
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
  // キャラクターをJSONから事前読み込み（以降のハンドラでawait可能に）
  charactersLoadedPromise = loadCharacters().then((res) => {
    CHARACTERS = Array.isArray(res) ? res : [];
    try { console.log('CHARACTERS loaded:', CHARACTERS.map(c=>c.key).join(',')); } catch(_) {}
  });
  setupTitleScreen();
  setupCharacterSelection();
  // タイトルに戻る
  (function(){ const btn = document.getElementById('btn-title'); if (btn) btn.addEventListener('click', ()=> window.location.reload()); })();
  loadAvatars();
  renderAll();
  // 能力ボタンハンドラ
  const btnAbility = document.getElementById('btn-ability');
  btnAbility && btnAbility.addEventListener('click', () => useAbility());
  // 勝率は自動計算するためボタンは無効化
  if (btnEquity) { btnEquity.disabled = true; btnEquity.textContent = '自動計算中'; }
})();
