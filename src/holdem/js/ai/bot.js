// Bot 行動ロジック（文脈注入で副作用を外部へ）

function revealedForViewer(ctx, viewerId){
  const map = ctx.seenBy.get(viewerId);
  if (!map) return [];
  const arr = [];
  for (const [tid, idx] of map.entries()) {
    const t = ctx.players[tid];
    if (!t || !t.hand || t.hand.length !== 2) continue;
    arr.push({ target: t, card: t.hand[idx] });
  }
  return arr;
}

function botThreatFromReveals(ctx, p){
  const reveals = revealedForViewer(ctx, p.id);
  if (!reveals.length) return 0;
  const ranksOnBoard = new Set(ctx.state.board.map(c=>c.r));
  const suitCounts = new Map();
  ctx.state.board.forEach(c=>suitCounts.set(c.s,(suitCounts.get(c.s)||0)+1));
  let maxSuitCount = 0; let flushSuit = null;
  for (const [s,n] of suitCounts){ if(n>maxSuitCount){maxSuitCount=n; flushSuit=s;} }
  let threat = 0;
  for (const {card} of reveals){
    if (ranksOnBoard.has(card.r)) threat += 0.7;
    if (maxSuitCount>=3 && card.s === flushSuit) threat += 0.4;
    if (card.r >= 13) threat += 0.2;
  }
  return Math.min(threat, 2.0);
}

function botAggressionFromForesight(ctx, p){
  const seq = ctx.foresightMem.get(p.id);
  if (!seq || !seq.length) return 0;
  const cur = ctx.bestScoreFrom([...p.hand, ...ctx.state.board]);
  const next = ctx.bestScoreFrom([...p.hand, ...ctx.state.board, seq[0]]);
  const diff = ctx.compareScore ? ctx.compareScore(next, cur) : (JSON.stringify(next)>JSON.stringify(cur)?1:0);
  if (diff > 0) return 0.6;
  return 0.0;
}

function botMaybeUseAbility(ctx, p) {
  if (!p.ability || p.ability.uses <= 0) return false;
  if (ctx.state.street === 'idle' || ctx.state.street === 'showdown') return false;
  const r = Math.random();
  if (p.ability.key === 'foresight') {
    if (ctx.state.board.length >= 5) return false;
    if (r < 0.25) {
      const cards = ctx.predictFutureBoardCards(3);
      ctx.foresightMem.set(p.id, cards);
      p.ability.uses -= 1;
      ctx.log(`${p.name}: 能力を発動（未来視）`);
      const overlay = document.getElementById('ability-overlay');
      if (overlay) { overlay.classList.add('show'); setTimeout(()=>overlay.classList.remove('show'), 820); }
      ctx.showCutIn('foresight', p.name, p.ability.name, p.avatar, p.pose);
      ctx.speak && ctx.speak(p.id, 'ability_foresight');
      p.aggrPulse = (p.aggrPulse||0) + 2;
      return true;
    }
  } else if (p.ability.key === 'clairvoyance') {
    const targets = ctx.players.filter(t => t.id !== p.id && !t.out && t.hand.length === 2);
    if (targets.length && r < 0.28) {
      const seen = ctx.seenBy.get(p.id) || new Map();
      const fresh = targets.filter(t => !seen.has(t.id));
      if (fresh.length === 0) return false;
      const cnt = Math.min(2, fresh.length);
      for (let i=0;i<cnt;i++) {
        const t = fresh[i];
        const idx = Math.random() < 0.5 ? 0 : 1;
        if (!ctx.seenBy.has(p.id)) ctx.seenBy.set(p.id, new Map());
        ctx.seenBy.get(p.id).set(t.id, idx);
      }
      p.ability.uses -= 1;
      ctx.log(`${p.name}: 能力を発動（透視）`);
      const overlay2 = document.getElementById('clairvoyance-overlay');
      if (overlay2) { overlay2.classList.add('show'); setTimeout(()=>overlay2.classList.remove('show'), 860); }
      ctx.showCutIn('clairvoyance', p.name, p.ability.name, p.avatar, p.pose);
      ctx.speak && ctx.speak(p.id, 'ability_clairvoyance');
      p.aggrPulse = (p.aggrPulse||0) + 1;
      return true;
    }
  } else if (p.ability.key === 'teleport') {
    if (p.hand.length === 2 && ctx.state.deck.length > 0 && r < 0.22) {
      const evalIdx = (idx) => {
        const other = p.hand[1-idx];
        const sc = ctx.bestScoreFrom([other, ...ctx.state.board]);
        return (sc && sc[0])||0;
      };
      const pickIdx = evalIdx(0) < evalIdx(1) ? 0 : 1;
      const other = p.hand[1-pickIdx];
      const holeRanks = new Set([other.r]);
      const biasSet = new Set([other.r-2, other.r-1, other.r, other.r+1, other.r+2]);
      const suitFav = (()=>{ const m=new Map(); [other,...ctx.state.board].forEach(c=>m.set(c.s,(m.get(c.s)||0)+1)); let bs=null,bn=0; for(const [s,n] of m){ if(n>bn){bn=n; bs=s;} } return bs; })();
      const candList = [];
      for (let di=0; di<ctx.state.deck.length; di++){
        const cand = ctx.state.deck[di];
        let val = 0;
        if (ctx.state.board.length >= 3) {
          const sc = ctx.bestScoreFrom([other, cand, ...ctx.state.board]);
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
      const chosen = ctx.state.deck.splice(chosenIdxInDeck,1)[0];
      const old = p.hand[pickIdx];
      p.hand[pickIdx] = chosen;
      const pos = Math.floor(Math.random()*(ctx.state.deck.length+1));
      ctx.state.deck.splice(pos,0,old);
      p.ability.uses -= 1;
      ctx.log(`${p.name}: 能力を発動（瞬間移動）`);
      ctx.showCutIn('teleport', p.name, p.ability.name, p.avatar, p.pose);
      ctx.speak && ctx.speak(p.id, 'ability_teleport');
      p.justTeleported = true;
      return true;
    }
  } else if (p.ability.key === 'blessing') {
    if (ctx.state.board.length < 5 && ctx.state.blessingStrongFor == null && r < 0.25) {
      ctx.state.blessingStrongFor = p.id;
      ctx.log(`${p.name}: 能力を発動（幸運の加護）`);
      ctx.showCutIn('blessing', p.name, p.ability.name, p.avatar, p.pose);
      ctx.speak && ctx.speak(p.id, 'ability_blessing');
      p.aggrPulse = (p.aggrPulse||0) + 2;
      return true;
    }
  }
  return false;
}

export function botAct(ctx, pid) {
  const p = ctx.players[pid];
  const need = ctx.state.currentBet - p.bet;
  const rnd = Math.random();
  botMaybeUseAbility(ctx, p);
  const threat = botThreatFromReveals(ctx, p);
  let aggr = botAggressionFromForesight(ctx, p);
  if (p.justTeleported) { aggr += 0.25; p.justTeleported = false; }
  if (ctx.state.blessingFor === p.id) aggr += 0.25;
  if (p.aggrPulse && p.aggrPulse > 0) aggr += 0.25;
  if (ctx.state.street === 'preflop') {
    const [a,b] = p.hand.map(c=>c.r).sort((x,y)=>y-x);
    const suited = p.hand[0].s === p.hand[1].s;
    const pair = a===b;
    let score = a + b + (pair?20:0) + (suited?3:0);
    const preStrength = Math.min(1, (a+b-4) / 24) + (pair?0.4:0) + (suited?0.1:0);
    if (need === 0) {
      const raiseProb = Math.max(0, Math.min(0.9, (score>=26?0.4:0.12) + preStrength*0.2 + aggr*0.4 - threat*0.2));
      if (rnd < raiseProb) return ctx.playerAction(pid, 'raise', ctx.state.currentBet + ctx.state.minRaise);
      return ctx.playerAction(pid, (p.bet === ctx.state.currentBet)?'check':'call');
    } else {
      const callProb = Math.max(0, Math.min(0.97, (score>=25?0.72:0.28) + preStrength*0.2 + aggr*0.3 - threat*0.25));
      if (rnd < callProb) return ctx.playerAction(pid, (p.bet === ctx.state.currentBet)?'check':'call');
      return ctx.playerAction(pid, 'fold');
    }
  } else {
    const made = ctx.bestScoreFrom([...p.hand, ...ctx.state.board]);
    const cat = made[0];
    const strength = ctx.scoreStrength01(made, ctx.state.board, p.hand);
    if (need === 0) {
      const baseRaise = (cat>=4?0.72:cat>=3?0.58:cat>=2?0.42:cat>=1?0.18:0.06);
      const raiseProb = Math.max(0, Math.min(0.92, baseRaise + strength*0.3 + aggr*0.4 - threat*0.22));
      if (rnd < raiseProb) return ctx.playerAction(pid, 'raise', ctx.state.currentBet + ctx.state.minRaise);
      if (cat >= 1 || rnd < (0.22 + strength*0.3 + aggr*0.25 - threat*0.18)) return ctx.playerAction(pid, (p.bet === ctx.state.currentBet)?'check':'call');
      return ctx.playerAction(pid, 'check');
    } else {
      const potOdds = need / Math.max(1, (ctx.state.pot + need));
      const equity = strength;
      const callBoost = Math.max(0, equity - potOdds);
      const callProb = Math.max(0, Math.min(0.97, (cat>=3?0.8:cat>=2?0.66:cat>=1?0.44:0.2) + callBoost*1.0 + aggr*0.3 - threat*0.25));
      if (rnd < callProb) return ctx.playerAction(pid, (p.bet === ctx.state.currentBet)?'check':'call');
      return ctx.playerAction(pid, 'fold');
    }
  }
}

export function turnLoopIfBot(ctx) {
  const p = ctx.players[ctx.state.toAct];
  if (!p) return;
  if (p.isUser || p.folded || p.out || p.allIn || ctx.state.street==='idle' || ctx.state.street==='showdown') return;
  setTimeout(() => botAct(ctx, p.id), 450 + Math.random()*400);
}

