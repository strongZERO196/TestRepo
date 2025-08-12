// テトリス本体（日本語コメント）
// 盤面は 10x20、各マスは 30px。

(() => {
  'use strict';

  // 定数
  const COLS = 10;
  const ROWS = 20;
  const SIZE = 30; // 1マスのピクセル
  const DROP_START_MS = 800; // レベル1の落下間隔

  // キー設定
  const KEY = {
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    DOWN: 'ArrowDown',
    ROT_CW_1: 'ArrowUp',
    ROT_CW_2: 'x',
    ROT_CCW: 'z',
    HARD_DROP: ' ', // Space
    PAUSE: 'p',
    RESET: 'r',
  };

  // キャンバス
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * SIZE;
  canvas.height = ROWS * SIZE;

  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas.getContext('2d');

  // UI
  const scoreEl = document.getElementById('score');
  const linesEl = document.getElementById('lines');
  const levelEl = document.getElementById('level');

  // テトリミノ形状（回転0の形）
  // 1はブロック、0は空白。
  const SHAPES = {
    I: [
      [0,0,0,0],
      [1,1,1,1],
      [0,0,0,0],
      [0,0,0,0],
    ],
    J: [
      [1,0,0],
      [1,1,1],
      [0,0,0],
    ],
    L: [
      [0,0,1],
      [1,1,1],
      [0,0,0],
    ],
    O: [
      [1,1],
      [1,1],
    ],
    S: [
      [0,1,1],
      [1,1,0],
      [0,0,0],
    ],
    T: [
      [0,1,0],
      [1,1,1],
      [0,0,0],
    ],
    Z: [
      [1,1,0],
      [0,1,1],
      [0,0,0],
    ],
  };

  // 色設定（背景は0、1以降を色に対応）
  const COLORS = {
    0: '#0f141c',
    I: '#4ad5ff',
    J: '#4a6dff',
    L: '#ff9f40',
    O: '#ffd54a',
    S: '#42d77d',
    T: '#c77dff',
    Z: '#ff5f78',
    GHOST: 'rgba(200, 220, 255, 0.25)',
    GRID: '#1d2430',
    STROKE: '#0b0f14',
  };

  // 盤面
  function createMatrix(w, h, fill = 0) {
    const matrix = [];
    for (let r = 0; r < h; r++) matrix.push(new Array(w).fill(fill));
    return matrix;
  }

  // 回転（CW）
  function rotateCW(matrix) {
    const N = matrix.length;
    const res = createMatrix(N, N, 0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        res[c][N - 1 - r] = matrix[r][c];
      }
    }
    return res;
  }

  // 回転（CCW）
  function rotateCCW(matrix) {
    const N = matrix.length;
    const res = createMatrix(N, N, 0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        res[N - 1 - c][r] = matrix[r][c];
      }
    }
    return res;
  }

  // ピース生成
  const TYPES = ['I','J','L','O','S','T','Z'];

  function* bagGenerator() {
    // 7バッグ方式：7種をシャッフルして供給
    while (true) {
      const bag = TYPES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      for (const t of bag) yield t;
    }
  }

  class Piece {
    constructor(type) {
      this.type = type; // 'I' など
      this.matrix = SHAPES[type].map(row => row.slice());
      this.pos = { x: 3, y: 0 }; // 初期位置（おおよそ中央）
    }
  }

  // ゲーム状態
  const state = {
    board: createMatrix(COLS, ROWS, 0),
    piece: null,
    next: null,
    gen: bagGenerator(),
    score: 0,
    lines: 0,
    level: 1,
    dropInterval: DROP_START_MS,
    dropCounter: 0,
    lastTime: 0,
    paused: false,
    over: false,
  };

  function spawn() {
    const nextType = state.next ?? state.gen.next().value;
    const curType = nextType;
    state.next = state.gen.next().value;
    state.piece = new Piece(curType);
    // I ピースは初期xを調整
    if (curType === 'I') state.piece.pos.x = 3;
    if (collision(state.board, state.piece)) {
      state.over = true;
      state.paused = true;
    }
    drawNext(state.next);
  }

  // 当たり判定
  function collision(board, piece) {
    const m = piece.matrix;
    const o = piece.pos;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const px = o.x + x;
        const py = o.y + y;
        if (px < 0 || px >= COLS || py >= ROWS) return true;
        if (py >= 0 && board[py][px]) return true;
      }
    }
    return false;
  }

  // 固定（マージ）
  function merge(board, piece) {
    const m = piece.matrix;
    const o = piece.pos;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) {
          const px = o.x + x;
          const py = o.y + y;
          if (py >= 0) board[py][px] = piece.type; // タイプ名を格納
        }
      }
    }
  }

  // ライン消去
  function sweep() {
    let lines = 0;
    outer: for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) {
        if (!state.board[y][x]) {
          continue outer;
        }
      }
      // 一行埋まった
      const row = state.board.splice(y, 1)[0].fill(0);
      state.board.unshift(row);
      lines++;
      y++; // 同じyでもう一度チェック
    }
    if (lines > 0) {
      // スコア計算（一般的なテトリス準拠）
      const points = [0, 100, 300, 500, 800][lines] * state.level;
      state.score += points;
      state.lines += lines;
      // レベルアップ（10ラインごと）
      const newLevel = 1 + Math.floor(state.lines / 10);
      if (newLevel !== state.level) {
        state.level = newLevel;
        state.dropInterval = Math.max(80, DROP_START_MS - (state.level - 1) * 60);
      }
      updateUI();
    }
  }

  // 描画
  function drawCell(x, y, color, ctx2 = ctx) {
    ctx2.fillStyle = color;
    ctx2.fillRect(x * SIZE, y * SIZE, SIZE, SIZE);
    ctx2.strokeStyle = COLORS.STROKE;
    ctx2.lineWidth = 1;
    ctx2.strokeRect(x * SIZE + 0.5, y * SIZE + 0.5, SIZE - 1, SIZE - 1);
  }

  function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景
    ctx.fillStyle = COLORS[0];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 既存ブロック
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = state.board[y][x];
        if (v) drawCell(x, y, COLORS[v]);
      }
    }
    // グリッド
    ctx.strokeStyle = COLORS.GRID;
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      const gx = x * SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ROWS * SIZE);
      ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      const gy = y * SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(COLS * SIZE, gy);
      ctx.stroke();
    }
  }

  function drawPiece(piece, colorOverride = null) {
    const m = piece.matrix;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) {
          const color = colorOverride ?? COLORS[piece.type];
          drawCell(piece.pos.x + x, piece.pos.y + y, color);
        }
      }
    }
  }

  function getGhost(piece) {
    // ゴースト位置を算出（最下まで落とす）
    const ghost = new Piece(piece.type);
    ghost.matrix = piece.matrix.map(r => r.slice());
    ghost.pos = { x: piece.pos.x, y: piece.pos.y };
    while (!collision(state.board, ghost)) {
      ghost.pos.y++;
    }
    ghost.pos.y--; // 1つ戻す
    return ghost;
  }

  function draw() {
    drawBoard();
    if (state.piece) {
      const ghost = getGhost(state.piece);
      drawPiece(ghost, COLORS.GHOST);
      drawPiece(state.piece);
    }
    if (state.over) {
      drawOverlay('GAME OVER\nR: リセット');
    } else if (state.paused) {
      drawOverlay('一時停止中\nP: 再開');
    }
  }

  function drawOverlay(text) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8eef7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 28px system-ui, sans-serif';
    const lines = text.split('\n');
    lines.forEach((t, i) => {
      ctx.fillText(t, canvas.width / 2, canvas.height / 2 + i * 34);
    });
    ctx.restore();
  }

  function drawNext(type) {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.fillStyle = '#0f141c';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    const m = SHAPES[type];
    const size = 24;
    // センターリング用オフセット
    const w = m[0].length * size;
    const h = m.length * size;
    const ox = Math.floor((nextCanvas.width - w) / 2);
    const oy = Math.floor((nextCanvas.height - h) / 2);
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) {
          nextCtx.fillStyle = COLORS[type];
          nextCtx.fillRect(ox + x * size, oy + y * size, size, size);
          nextCtx.strokeStyle = '#0b0f14';
          nextCtx.strokeRect(ox + x * size + 0.5, oy + y * size + 0.5, size - 1, size - 1);
        }
      }
    }
  }

  // 入力
  window.addEventListener('keydown', (e) => {
    const key = e.key;
    // 既定動作（スクロール等）を抑止してカーソル/画面が動かないようにする
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const preventKeys = new Set([
      KEY.LEFT, KEY.RIGHT, KEY.DOWN, KEY.ROT_CW_1, KEY.HARD_DROP,
      'z', 'x', 'Z', 'X', KEY.PAUSE, KEY.RESET,
    ]);
    if (plain && (preventKeys.has(key) || preventKeys.has(key.toLowerCase?.() ?? ''))) {
      e.preventDefault();
    }
    if (key === KEY.PAUSE) {
      if (!state.over) state.paused = !state.paused;
      return;
    }
    if (key === KEY.RESET) {
      reset();
      return;
    }
    if (state.paused || state.over || !state.piece) return;

    if (key === KEY.LEFT) {
      state.piece.pos.x--;
      if (collision(state.board, state.piece)) state.piece.pos.x++;
    } else if (key === KEY.RIGHT) {
      state.piece.pos.x++;
      if (collision(state.board, state.piece)) state.piece.pos.x--;
    } else if (key === KEY.DOWN) {
      softDrop();
    } else if (key === KEY.ROT_CW_1 || key.toLowerCase() === KEY.ROT_CW_2) {
      rotatePiece(true);
    } else if (key.toLowerCase() === KEY.ROT_CCW) {
      rotatePiece(false);
    } else if (key === KEY.HARD_DROP) {
      hardDrop();
    }
    draw();
  });

  function rotatePiece(clockwise = true) {
    const before = state.piece.matrix;
    const rotated = clockwise ? rotateCW(before) : rotateCCW(before);
    const old = state.piece.matrix;
    state.piece.matrix = rotated;
    // 簡易壁蹴り：左右/上に少しずらして許容
    const kicks = [
      {x: 0, y: 0}, {x: 1, y: 0}, {x: -1, y: 0}, {x: 2, y: 0}, {x: -2, y: 0},
      {x: 0, y: -1}, {x: 1, y: -1}, {x: -1, y: -1}
    ];
    for (const k of kicks) {
      state.piece.pos.x += k.x;
      state.piece.pos.y += k.y;
      if (!collision(state.board, state.piece)) return; // 成功
      state.piece.pos.x -= k.x;
      state.piece.pos.y -= k.y;
    }
    // 失敗したら戻す
    state.piece.matrix = old;
  }

  function softDrop() {
    state.piece.pos.y++;
    if (collision(state.board, state.piece)) {
      state.piece.pos.y--;
      lockPiece();
    } else {
      state.score += 1; // ソフトドロップ加点
      updateUI();
    }
  }

  function hardDrop() {
    let dist = 0;
    while (!collision(state.board, state.piece)) {
      state.piece.pos.y++;
      dist++;
    }
    state.piece.pos.y--;
    dist--;
    state.score += Math.max(0, dist * 2); // ハードドロップ加点
    lockPiece();
  }

  function lockPiece() {
    merge(state.board, state.piece);
    sweep();
    spawn();
  }

  function updateUI() {
    scoreEl.textContent = String(state.score);
    linesEl.textContent = String(state.lines);
    levelEl.textContent = String(state.level);
  }

  function reset() {
    state.board = createMatrix(COLS, ROWS, 0);
    state.piece = null;
    state.gen = bagGenerator();
    state.next = null;
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.dropInterval = DROP_START_MS;
    state.dropCounter = 0;
    state.lastTime = 0;
    state.paused = false;
    state.over = false;
    updateUI();
    spawn();
    draw();
  }

  // メインループ
  function update(time = 0) {
    const delta = time - state.lastTime;
    state.lastTime = time;
    if (!state.paused && !state.over) {
      state.dropCounter += delta;
      if (state.dropCounter > state.dropInterval) {
        state.piece.pos.y++;
        if (collision(state.board, state.piece)) {
          state.piece.pos.y--;
          lockPiece();
        }
        state.dropCounter = 0;
      }
    }
    draw();
    requestAnimationFrame(update);
  }

  // 初期化
  reset();
  requestAnimationFrame(update);
})();
