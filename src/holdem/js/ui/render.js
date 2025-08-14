// 軽量なUIヘルパ（ログ表示 / カットイン / アバター）

export function log(msg) {
  const logEl = document.getElementById('log');
  if (!logEl) return;
  const prevLatest = logEl.querySelector('.log-line.latest');
  if (prevLatest) prevLatest.classList.remove('latest');

  const line = document.createElement('div');
  line.className = 'log-line latest';
  line.textContent = msg;
  logEl.insertBefore(line, logEl.firstChild);

  logEl.scrollTop = 0;
  const overlay = document.getElementById('overlay');
  if (overlay) {
    const oline = document.createElement('div');
    oline.className = 'overlay-line';
    oline.textContent = msg;
    overlay.appendChild(oline);
    while (overlay.children.length > 8) overlay.firstChild.remove();
    oline.addEventListener('animationend', () => {
      oline.remove();
    });
  }
}

export function showCutIn(type, name, abilityName, avatarUrl, poseUrl) {
  const cutinEl = document.getElementById('cutin');
  const cutinPortrait = document.getElementById('cutin-portrait');
  const cutinName = document.getElementById('cutin-name');
  const cutinAbility = document.getElementById('cutin-ability');
  const cutinPose = document.getElementById('cutin-pose');
  if (!cutinEl) return;
  cutinEl.classList.remove('is-foresight','is-vision','is-teleport','show');
  if (type === 'foresight') cutinEl.classList.add('is-foresight');
  else if (type === 'clairvoyance') cutinEl.classList.add('is-vision');
  else if (type === 'teleport') cutinEl.classList.add('is-teleport');
  else if (type === 'blessing') cutinEl.classList.add('is-blessing');
  if (cutinPortrait && avatarUrl) {
    cutinPortrait.style.backgroundImage = `url('${avatarUrl}')`;
  }
  if (cutinPose) {
    const src = poseUrl || avatarUrl || '';
    cutinPose.style.backgroundImage = src ? `url('${src}')` : '';
  }
  if (cutinName) cutinName.textContent = name || '';
  if (cutinAbility) cutinAbility.textContent = abilityName || '';
  // reflow
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
  cutinEl.addEventListener('animationend', endFn);
  setTimeout(endFn, 1700);
}

export function loadAvatars(players) {
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

