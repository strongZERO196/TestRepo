// セリフ吹き出し（UI専用）
let playersRef = null;
const speechTimers = new Map(); // pid -> timeoutId

export function setPlayersRef(players) {
  playersRef = players;
}

function seatElByPid(pid) {
  return document.querySelector('.seat-' + pid);
}

function showSpeech(pid, text, duration = 2200) {
  const seat = seatElByPid(pid);
  if (!seat) return;
  let bubble = seat.querySelector('.speech-bubble');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.style.left = '50%';
    bubble.style.top = '0px';
    seat.appendChild(bubble);
  }
  bubble.textContent = text;
  bubble.classList.remove('show');
  // reflow
  // eslint-disable-next-line no-unused-expressions
  bubble.offsetWidth;
  bubble.classList.add('show');
  if (speechTimers.has(pid)) clearTimeout(speechTimers.get(pid));
  const tid = setTimeout(() => { if (bubble && bubble.parentNode) bubble.remove(); speechTimers.delete(pid); }, duration);
  speechTimers.set(pid, tid);
}

export function speak(pid, key) {
  if (!playersRef) return;
  const p = playersRef[pid];
  const ls = (p && p.lines) || {};
  const choose = (arr) => Array.isArray(arr) && arr.length ? arr[(Math.random() * arr.length) | 0] : null;
  let text = null;
  if (typeof key === 'string' && key.startsWith('ability_')) {
    text = choose(ls[key]) || choose(ls.ability);
  } else {
    text = choose(ls[key]) || null;
  }
  if (!text) return;
  showSpeech(pid, text);
}

