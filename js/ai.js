/* ============================================================
 * RED ALERT · WEB REMAKE —— 敌方 AI（苏联/盟军通用）
 * 打钱 → 造兵 → 编队进攻 → 扩张，受难度系数调制。
 * ============================================================ */
'use strict';

const AI = {
  diff: 1,            // 0 简单 1 普通 2 困难
  wave: 0,
  nextWaveT: 40,
  scoutT: 20,
  buildPlan: [],
  aggressive: 1,
};

function aiInit(diff) {
  AI.diff = diff;
  AI.wave = 0;
  AI.nextWaveT = 215 + diff * -15;
  /* 开局发展期：这段时间 AI 只守家、不主动前压（给玩家喘口气） */
  AI.firstPushAt = [270, 215, 165][diff];
  AI.aggressive = 1;
  AI.buildPlan = [];
}

function aiEco(dt) {
  const p = 1;
  const D = AI.diff;
  const incomeScale = [0.5, 0.85, 1.25][D];
  const has = t => hasBld(p, t);

  /* 上次放不下的建筑：冷却结束后重试 */
  if (AI._retry) {
    AI._retry.t -= dt;
    if (AI._retry.t <= 0) {
      const key = AI._retry.key;
      AI._retry = null;
      if (!G.buildOrder[p] && !has(key) && G.cash[p] >= BUILDINGS[key].cost) startBuilding(p, key);
    }
  }

  /* 给 AI 阶段性津贴（模拟它的采矿运营）。刻意低于玩家 2~3 辆矿车的实际收入，
     且随时间增长有上限——否则 AI 会滚雪球，玩家没有翻盘空间。 */
  AI._ecoT = (AI._ecoT || 0) + dt;
  if (AI._ecoT > 4) {
    AI._ecoT = 0;
    const ramp = Math.min(G.t, 240);
    const base = 90 * incomeScale + ramp * (D === 2 ? 0.42 : D === 1 ? 0.22 : 0.11);
    addCash(p, Math.round(base));
    G.stats[p].earned += Math.round(base);
  }

  /* 兜底：AI 卡在"没车没钱"死局时补车 / 补启动金 */
  AI._unblock = (AI._unblock || 0) + dt;
  if (AI._unblock > 25) {
    AI._unblock = 0;
    const harvs = G.units.filter(u => !u.dead && u.p === p && u.def.special === 'harvest').length;
    const ref = has('refinery');
    if (ref && harvs === 0) {
      if (G.cash[p] < UNITS.harvester.cost) addCash(p, UNITS.harvester.cost - G.cash[p] + 200);
      startUnit(p, 'harvester');
    } else if (G.cash[p] < 300) {
      addCash(p, 400);
    }
  }

  /* AI 永远把钱留在"够造下一栋"的水位上（避免全款押进单位导致建筑断粮） */
  const nextWant = (() => {
    const n = t => bldsOf(p).filter(b => b.type === t).length;
    if (!has('reactor')) return BUILDINGS.reactor.cost;
    if (!has('refinery')) return BUILDINGS.refinery.cost;
    if (!has('barracks')) return BUILDINGS.barracks.cost;
    if (!has('factory')) return BUILDINGS.factory.cost;
    if (!has('defense') && n('defense') < 2 + D) return BUILDINGS.defense.cost;
    return 0;
  })();
  if (nextWant && G.cash[p] < nextWant) addCash(p, nextWant - G.cash[p] + 200);

  /* —— 建筑扩张 —— */
  /* 1) 先把已完成的建筑落地（每拍累计 2 秒后再放弃） */
  if (G.aiPending && G.aiPending[p]) {
    const pend = G.aiPending[p];
    pend.t += dt;
    if (aiPlaceBuilding(p, pend.key)) {
      G.aiPending[p] = null;
      Sfx.place();
    } else if (pend.t > 6) {
      G.aiPending[p] = null;
      addCash(p, BUILDINGS[pend.key].cost);
      if (!AI._placeFails) AI._placeFails = 0;
      if (++AI._placeFails <= 3) console.error('AI-PLACE-FAIL: ' + pend.key + ' (give up)');
    }
    return;   /* 这一拍先不接新活 */
  }
  /* 2) 再开新建筑 */
  if (!G.buildOrder[p]) {
    const n = t => bldsOf(p).filter(b => b.type === t).length;
    let want = null;
    if (!has('reactor')) want = 'reactor';
    else if (!has('refinery')) want = 'refinery';
    else if (!has('barracks')) want = 'barracks';       /* 先出步兵（便宜、成军快） */
    else if (G.players[p].powerCap - G.players[p].powerUse < 40) want = n('reactor') < 3 ? 'reactor' : 'apower';
    else if (!has('factory')) want = 'factory';
    else if (!has('defense') && n('defense') < 2) want = 'defense';
    else if (n('refinery') < 2 && G.t > 90) want = 'refinery';
    else if (n('reactor') < 3 && G.players[p].powerUse > G.players[p].powerCap - 50) want = 'reactor';
    else if (!has(sideTower()) && G.t > 70) want = sideTower();
    else if (n('factory') < 2 && G.t > 150) want = 'factory';
    else if (n('defense') < 2 + D && G.t > 150) want = 'defense';

    if (want && BUILDINGS[want]) {
      const def = BUILDINGS[want];
      if (G.cash[p] >= def.cost && (!def.req || has(def.req))) {
        if (!def.solo || !has(want)) startBuilding(p, want);
      }
    }
  }

  /* —— 单位生产 —— */
  const q = G.unitOrder[p];
  const cap = [7, 10, 14][D];
  const army = G.units.filter(u => !u.dead && u.p === 1 && u.def.atk > 0 && u.def.special !== 'harvest');
  /* 钱先保建筑：只有高于建筑水位才拿来爆兵 */
  const reserve = Math.max(0, nextWant - G.cash[p]);
  void reserve;
  if (q.length < 3 && army.length + q.length < cap && G.cash[p] > nextWant + 400) {
    const side = G.enemySide;
    const choices = [];
    const hasRef = has('refinery');
    if (has('barracks')) {
      const inf = side === 'soviet' ? 'gi' : 'conscript';
      choices.push([inf, 3], ['rocket', 2]);
      if (D > 0) choices.push(['engineer', 1]);
    }
    if (has('factory') && hasRef) {
      const main = side === 'soviet' ? 'heavytank' : 'mastiff';
      const light = side === 'soviet' ? 'buggy' : 'lighttank';
      const sup = side === 'soviet' ? 'v2' : 'ifv';
      choices.push([main, 3], [light, 2], [sup, 1], ['arv', 1]);
      const harvs = G.units.filter(u => !u.dead && u.p === 1 && u.def.special === 'harvest').length;
      if (harvs < 2 && G.t > 60) choices.push(['harvester', 1]);
    }
    if (!choices.length && has('barracks')) choices.push(['gi', 1]);
    if (choices.length) {
      const totalW = choices.reduce((s, c) => s + c[1], 0);
      let r = Math.random() * totalW, pickKey = choices[0][0];
      for (const [k, w] of choices) { r -= w; if (r <= 0) { pickKey = k; break; } }
      const def = UNITS[pickKey];
      if (G.cash[p] >= def.cost) startUnit(p, pickKey);
    }
  }
  void dt;
}

function sideTower() { return G.enemySide === 'soviet' ? 'tesla' : 'prism'; }

/* AI 放置建筑（贴着自己基地成片找空位；AI 不受迷雾限制） */
function aiPlaceBuilding(p, key) {
  const def = BUILDINGS[key];
  const mine = bldsOf(p);
  if (!mine.length) return false;
  const cands = [];
  for (const b of mine) {
    const L = b.tx - def.w, R = b.tx + b.def.w, T = b.ty - def.h, B = b.ty + b.def.h;
    /* 上下两条边：横向铺开 */
    for (let x = L; x <= R; x++) {
      for (const y of [T, B]) {
        if (canPlaceAtEx(x, y, def.w, def.h, p, false)) cands.push({ x, y, near: Math.abs(x - b.tx) + Math.abs(y - b.ty) });
      }
    }
    /* 左右两条边：纵向铺开 */
    for (let y = T; y <= B; y++) {
      for (const x of [L, R]) {
        if (canPlaceAtEx(x, y, def.w, def.h, p, false)) cands.push({ x, y, near: Math.abs(x - b.tx) + Math.abs(y - b.ty) });
      }
    }
  }
  /* 兜底：全图扫空地（候选与贴边完全一致时才需要） */
  if (!cands.length) {
    for (let y = 1; y < MAP_H - def.h && !cands.length; y++) {
      for (let x = 1; x < MAP_W - def.w; x++) {
        if (canPlaceAtEx(x, y, def.w, def.h, p, false)) cands.push({ x, y, near: 50 });
      }
    }
  }
  if (!cands.length) return false;
  cands.sort((a, b) => a.near - b.near);
  const c = pick(cands.slice(0, Math.min(8, cands.length)));
  if (placeBuilding(p, key, c.x, c.y)) return true;
  /* 随机候选恰好被瞬时占用：全部候选逐个再试一遍 */
  for (const alt of cands) {
    if (placeBuilding(p, key, alt.x, alt.y)) return true;
  }
  return false;
}

/* AI 战术节拍 */
function aiTick(dt) {
  aiEco(dt);
  aiProduce(dt);
}

function aiProduce(dt) {
  const p = 1;
  AI.nextWaveT -= dt;

  /* 出征部队打完目标后如果没有新命令，会永远挂着 onMission 站桩——
     超时未交战就放回预备队，否则 AI 会卡成"冷战"不再进攻 */
  for (const u of G.units) {
    if (u.dead || u.p !== p || !u.onMission) continue;
    if (u.dest || (u.target && !u.target.dead)) { u.idleT = 0; continue; }
    u.idleT = (u.idleT || 0) + dt;
    if (u.idleT > 8) { u.onMission = false; u.idleT = 0; }
  }

  const army = G.units.filter(u => !u.dead && u.p === 1 && u.def.atk > 0 && u.def.special !== 'harvest' && !u.onMission);

  /* 组织进攻波 */
  if (AI.nextWaveT <= 0 && army.length >= [6, 9, 12][AI.diff]) {
    AI.wave++;
    const target = pickAttackTarget(p);
    if (target) {
      /* 只派 2/3 出征，留守部队守家（防止一波梭哈被反推） */
      const send = army.filter(() => Math.random() < 0.66);
      const order = [];
      for (const u of (send.length ? send : army)) {
        u.onMission = true;
        u.hold = false;
        u.attackMove = true;
        u.dest = { x: target.x + rand(-70, 70), y: target.y + rand(-70, 70) };
        u.target = null;
        u.lastHome = { x: u.x, y: u.y };
        order.push(u);
      }
      msg(`侦测到敌军部队调动（第 ${AI.wave} 波）`, 'warn');
      AI.nextWaveT = [140, 110, 80][AI.diff] - AI.wave * 1.5 + rand(0, 25);
    } else {
      AI.nextWaveT = 15;
    }
  }

  /* 空闲单位先在自家门口集结，攒够一波再压上；
     家门口 10 格内接敌的守军就地还击，不去前哨送死 */
  const idle = army.filter(u => {
    if (u.dest || u.target) return false;
    const dHome = dist(u.x, u.y, MAP.spawns[p].tx * TILE, MAP.spawns[p].ty * TILE);
    return dHome < 10 * TILE;
  });
  {
    /* 没有出征任务的单位在基地门口列阵待命（不主动前压——
       前压只由"进攻波"与 idleCheck 的 ready 判定触发） */
    const sp = MAP.spawns[p];
    const gx = sp.tx + (p === 1 ? -9 : 13), gy = sp.ty + (p === 1 ? -9 : 13);
    for (const u of idle) {
      if (u.def.special === 'harvest') continue;
      if (!u.dest && !u.target) {
        const jx = rand(-3, 3), jy = rand(-3, 3);
        if (Math.abs(u.tx - (gx + jx)) > 4 || Math.abs(u.ty - (gy + jy)) > 4) {
          u.dest = { x: (gx + jx) * TILE + 16, y: (gy + jy) * TILE + 16 };
          u.attackMove = false;
        }
      }
    }
  }

  /* 卡死兜底：到了集结点 / 长时间无目标的单位，别站桩，朝敌方前哨压进；
     但基地被袭时全军回防（否则守家部队会被逐个吃掉） */
  if ((AI._idleCheck = (AI._idleCheck || 0) + dt) > 6) {
    AI._idleCheck = 0;
    const sp = MAP.spawns[p];
    /* 1) 家里告急：全军回防（10 格内的守军就地接敌，别来回拉扯） */
    const homeThreat = G.units.find(u => !u.dead && u.p === 0 && u.def.atk > 0 && dist(u.x, u.y, sp.tx * TILE, sp.ty * TILE) < 20 * TILE);
    if (homeThreat) {
      const hx = homeThreat.x, hy = homeThreat.y;
      for (const u of army) {
        const dThreat = dist(u.x, u.y, hx, hy);
        if (u.onMission) {
          /* 出征部队还没走远就拉回来救火；已经压到敌境的继续打 */
          const d0 = u.lastHome ? dist(u.lastHome.x, u.lastHome.y, hx, hy) : 1e9;
          if (d0 > 14 * TILE && dist(u.x, u.y, hx, hy) > 20 * TILE) continue;
          u.onMission = false;
        }
        if (dThreat <= u.def.range + 70) { u.dest = null; u.path = null; continue; }  /* 就地开火 */
        u.dest = { x: hx + rand(-40, 40), y: hy + rand(-40, 40) };
        u.attackMove = true;
        u.guardT = 'atk';
      }
      return;
    }
    /* 2) 平时：只有度过了发展期、且兵力成型时才前压，
          否则就守在基地 8 格内（避免还没成型就被吃光） */
    const ready = G.t >= AI.firstPushAt && hasBld(p, 'barracks') && hasBld(p, 'factory') && army.length >= [6, 9, 12][AI.diff];
    for (const u of army) {
      if (u.onMission || u.target) continue;
      if (u.dest && dist(u.x, u.y, u.dest.x, u.dest.y) < 48) { u.dest = null; u.path = null; }
      if (!u.dest) {
        if (!ready) {
          /* 就地守家：基地 6~10 格环内游走 */
          const ang = rand(0, Math.PI * 2), r = rand(6, 10);
          u.dest = { x: (sp.tx + Math.cos(ang) * r) * TILE + 16, y: (sp.ty + Math.sin(ang) * r) * TILE + 16 };
          u.attackMove = false;
        } else {
          const ex = MAP.spawns[0].tx, ey = MAP.spawns[0].ty;
          const fwd = p === 1 ? 0.30 : 0.70;
          const px = sp.tx + (ex - sp.tx) * fwd + rand(-6, 6);
          const py = sp.ty + (ey - sp.ty) * fwd + rand(-6, 6);
          u.dest = { x: px * TILE + 16, y: py * TILE + 16 };
          u.attackMove = true;
        }
        u.guardT = ready ? 'patrol' : 'home';
      }
    }
  }
}

/* 攻击目标选择：优先玩家防御弱的建筑，其次矿车/兵，最后基地 */
function pickAttackTarget(p) {
  const mine = bldsOf(0);
  if (!mine.length) {
    const u = G.units.find(x => !x.dead && x.p === 0);
    return u ? { x: u.x, y: u.y } : null;
  }
  const threatNear = b => {
    let t = 0;
    for (const d of mine) if (d.type === 'defense' || d.type === 'tesla' || d.type === 'prism') {
      t += Math.max(0, 12 - dist(b.tx, b.ty, d.tx, d.ty) / 10);
    }
    return t;
  };
  let best = null, bs = Infinity;
  for (const b of mine) {
    let s = 0;
    if (b.type === 'refinery') s -= 6;
    if (b.type === 'hq') s -= 4;
    if (b.type === 'defense' || b.type === 'tesla' || b.type === 'prism') s += 5;
    s += threatNear(b) * 0.6;
    s += dist(MAP.spawns[p].tx, MAP.spawns[p].ty, b.tx, b.ty) / 20;
    if (s < bs) { bs = s; best = b; }
  }
  return best ? { x: best.cx, y: best.cy } : null;
}

/* 主循环里调用：给玩家采矿车自动补，给 AI 收尾 */
function simTick(dt) {
  /* 建造进度 */
  for (let p = 0; p < 2; p++) updateBuildOrder(p, dt);
  for (let p = 0; p < 2; p++) updateUnitQueue(p, dt);

  /* AI 运营（放最前：完成的建筑立刻进下一轮决策） */
  aiTick(dt);

  /* 特殊能力冷却 */
  if (G.nukeCd > 0) { G.nukeCd -= dt; if (G.nukeCd < 0) G.nukeCd = 0; }
  if (G.satCd > 0) { G.satCd -= dt; if (G.satCd < 0) G.satCd = 0; }
  if (G.satT > 0) { G.satT -= dt; if (G.satT <= 0) { G.satT = 0; if (G.radarUp) msg('间谍卫星效果结束', 'warn'); } }

  /* 单位 */
  for (const u of G.units) if (!u.dead) updateUnit(u, dt);
  for (const b of G.blds) if (!b.dead) updateBld(b, dt);

  /* 移除死亡 */
  if (G.units.some(u => u.dead)) G.units = G.units.filter(u => !u.dead);
  if (G.blds.some(b => b.dead)) { G.blds = G.blds.filter(b => !b.dead); refreshOcc(); recomputePower(); }

  separate(dt);
  updateShots(dt);
  updateParts(dt);
  updateFog();
}
