// ゲーム状態・プレイヤー・ブラインド定義（副作用なし）

export const players = [
  { id: 0, name: 'あなた', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: true,  avatar: "../../assets/avatars/player-0.png" },
  { id: 1, name: 'Bot A', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-1.png" },
  { id: 2, name: 'Bot B', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-2.png" },
  { id: 3, name: 'Bot C', chips: 2000, hand: [], folded: false, bet: 0, total: 0, allIn: false, out: false, isUser: false, avatar: "../../assets/avatars/player-3.png" },
];

export const state = {
  deck: [],
  board: [],
  pot: 0,
  dealer: 0,
  sb: 100,
  bb: 200,
  street: 'idle',
  toAct: 0,
  currentBet: 0,
  minRaise: 20,
  lastAggressor: null,
  acted: new Set(),
  blindStartMs: null,
  blindLevelIdx: 0,
  openCards: false,
  charSelected: false,
  blessingStrongFor: null,
  blessingResidualPid: null,
  blessingResidualCount: 0,
  equityLastAt: 0,
  equityBusy: false,
  usedClairvoyanceStreet: new Set(),
};

export const BLIND_LEVELS = [
  { sb: 100,  bb: 200,  dur: 50 },
  { sb: 200,  bb: 400,  dur: 50 },
  { sb: 300,  bb: 600,  dur: 50 },
  { sb: 500,  bb: 1000, dur: 50 },
  { sb: 750,  bb: 1500, dur: 50 },
  { sb: 1000, bb: 2000, dur: 50 },
];

export const BLIND_THRESHOLDS = (() => {
  let acc = 0; const arr = [];
  for (const lv of BLIND_LEVELS) { acc += lv.dur; arr.push(acc); }
  return arr; // 累積秒
})();

export function desiredBlindLevelIdx(nowMs) {
  if (!state.blindStartMs) return 0;
  const elapsed = (nowMs - state.blindStartMs) / 1000;
  let idx = 0;
  for (let i = 0; i < BLIND_THRESHOLDS.length; i++) {
    if (elapsed >= BLIND_THRESHOLDS[i]) idx = i + 1; else break;
  }
  return Math.min(idx, BLIND_LEVELS.length - 1);
}

export function timeToNextLevel(nowMs) {
  if (!state.blindStartMs) return null;
  const elapsed = (nowMs - state.blindStartMs) / 1000;
  for (let i = 0; i < BLIND_THRESHOLDS.length; i++) {
    if (elapsed < BLIND_THRESHOLDS[i]) return BLIND_THRESHOLDS[i] - elapsed;
  }
  return null;
}

export function nextActiveFrom(startIdx) {
  const n = players.length;
  for (let i = 0; i < n; i++) {
    const pid = (startIdx + i) % n;
    if (!players[pid].folded && !players[pid].allIn && !players[pid].out) return pid;
  }
  return startIdx;
}

export function nextNonOutFrom(startIdx) {
  const n = players.length;
  for (let i = 0; i < n; i++) {
    const pid = (startIdx + i) % n;
    if (!players[pid].out) return pid;
  }
  return startIdx;
}

