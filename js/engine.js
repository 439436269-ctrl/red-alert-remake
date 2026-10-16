/* ============================================================
 * RED ALERT · WEB REMAKE —— 核心引擎
 * 地图/战争迷雾/寻路/单位寻路/战斗/粒子/渲染/输入
 * ============================================================ */
'use strict';

const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- 实体 ---------------- */
let UID = 1;

class Ent {
  constructor(o) {
    Object.assign(this, o);
    this.uid = UID++;
    this.dead = false;
    this.vx = 0; this.vy = 0;
    this.target = null;          // 敌对目标
    this.dest = null;            // {x,y} 移动目的地
    this.cool = 0;               // 攻击冷却
    this.hold = false;           // 原地驻守
    this.flash = 0;              // 受击闪白
    this.rally = null;           // 集结点
  }
}

class Bld extends Ent {          // 建筑
  constructor(o) {
    super(o);
    this.kind = 'bld';
    this.r = Math.max(o.def.w, o.def.h) * TILE / 2;
    this.maxhp = o.def.hp; this.hp = o.def.hp;
    this.prog = 0;               // 生产进度 0..1
    this.done = false;           // 生产完成待放置
    this.weapon = DEF_WEAPON[o.type] || null;
    this.anim = 0;
    this.barrel = -Math.PI / 2;
    this.builtT = 0.6;           // 建造落地动画
    this.powOffline = false;
  }
  get cx() { return this.x + this.def.w * TILE / 2; }
  get cy() { return this.y + this.def.h * TILE / 2; }
}

class Unit extends Ent {         // 单位
  constructor(o) {
    super(o);
    this.kind = 'unit';
    this.r = o.def.tab === 'inf' ? 7 : 11;
    this.maxhp = o.def.hp; this.hp = o.def.hp;
    this._tx = Math.floor(o.x / TILE); this._ty = Math.floor(o.y / TILE);
    this.angle = rand(0, Math.PI * 2);
    this.turret = this.angle;
    this.veteran = 0;            // 0..2 击杀升级
    /* 采矿状态 */
    this.ore = 0;                // 载矿量
    this.harvState = 'idle';     // idle->toOre->toRef->idle
    this.capT = 0;               // 工程师占领计时
    this.stuckT = 0;
    this.walk = 0;
  }
  get tx() { return this._tx; }
  get ty() { return this._ty; }
  get dmg() {
    let d = this.def.atk * (1 + this.veteran * 0.35);
    return d;
  }
}

/* ---------------- 游戏状态 ---------------- */
const G = {
  running: false, over: false,
  side: 'soviet', enemySide: 'allied',
  t: 0,                       // 对局时间
  cash: [0, 0],               // 0=玩家 1=AI
  units: [], blds: [], shots: [], parts: [], decals: [], floats: [],
  ores: new Map(),            // key "x,y" -> blocks
  players: [{}, {}],          // power, radar, tech, queue...
  cam: { x: 0, y: 0 },
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, drag: false, sx: 0, sy: 0, downBtn: 0 },
  sel: [],
  placing: null,              // {defKey} 拖动放置
  fog: null, satT: 0,
  nukeCd: 0, satCd: 0,
  nukeAim: false, nukeMark: null,
  shake: 0,
  speed: 1,
  stats: [{ built: 0, lost: 0, kills: 0, earned: 0 }, { built: 0, lost: 0, kills: 0, earned: 0 }],
  buildOrder: { 0: null, 1: null },   // 当前建造项目 {key, t, dur}
  unitOrder: { 0: [], 1: [] },        // 单位生产队列
  radarUp: true,
};

/* ---------------- 地图 ---------------- */
const MAP = { tiles: null, walk: null, occ: null, w: MAP_W, h: MAP_H, spawns: [] };

function tileIdx(x, y) { return y * MAP_W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
function walkAt(x, y) { return inMap(x, y) && MAP.walk[tileIdx(x, y)]; }

function genMap() {
  const W = MAP_W, H = MAP_H;
  const tiles = new Uint8Array(W * H);   // 0草 1土 2深土 3岩 4水
  const walk = new Uint8Array(W * H);

  // 底噪：草地/土
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = Math.sin(x * 0.31) * Math.cos(y * 0.27) + Math.sin((x + y) * 0.13);
    tiles[tileIdx(x, y)] = n > 0.55 ? 2 : (n < -0.6 ? 1 : 0);
  }
  // 岩石斑块（不可走）
  const blob = (cx, cy, r, tile) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inMap(x, y)) continue;
      const d = dist(x, y, cx, cy);
      if (d <= r + rand(-0.6, 0.6)) {
        tiles[tileIdx(x, y)] = tile;
        if (tile === 3) walk[tileIdx(x, y)] = 0;
      }
    }
  };
  for (let i = 0; i < 26; i++) blob(randi(4, W - 5), randi(4, H - 5), randi(1, 3), 3);
  // 水塘
  for (let i = 0; i < 5; i++) {
    const cx = randi(10, W - 11), cy = randi(10, H - 11), r = randi(3, 5);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inMap(x, y)) continue;
      if (dist(x, y, cx, cy) <= r + rand(-0.8, 0.8)) { tiles[tileIdx(x, y)] = 4; walk[tileIdx(x, y)] = 0; }
    }
  }

  MAP.tiles = tiles; MAP.walk = walk;
  MAP.occ = new Int16Array(W * H).fill(-1);   // 建筑占用 -> uid 或 -1

  // 两处出生点（左上 / 右下），周围清空
  const s1 = { tx: 9, ty: 9 }, s2 = { tx: W - 13, ty: H - 13 };
  MAP.spawns = [s1, s2];
  const clear = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inMap(x, y)) continue;
      if (tiles[tileIdx(x, y)] >= 3) tiles[tileIdx(x, y)] = 0;
      walk[tileIdx(x, y)] = 1;
    }
  };
  clear(s1.tx + 2, s1.ty + 2, 7); clear(s2.tx + 2, s2.ty + 2, 7);
  // 中路打通（防全图被岩封死）
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (Math.abs((y - 0) - (x - 0) * (H / W)) < 2.2) walk[tileIdx(x, y)] = 1;
  }

  // 矿脉：出生点附近 + 中部
  const oreFields = [
    { x: s1.tx + 8, y: s1.ty + 1, n: 26 },
    { x: s1.tx + 1, y: s1.ty + 8, n: 26 },
    { x: s2.tx - 4, y: s2.ty + 3, n: 26 },
    { x: s2.tx + 3, y: s2.ty - 4, n: 26 },
    { x: W / 2 - 3, y: H / 2 - 3, n: 40 },
    { x: W / 2 + 4, y: H / 2 + 4, n: 40 },
  ];
  for (const f of oreFields) {
    let placed = 0, guard = 0;
    while (placed < f.n && guard++ < 400) {
      const x = Math.round(f.x + rand(-4, 4)), y = Math.round(f.y + rand(-4, 4));
      if (!inMap(x, y) || !walk[tileIdx(x, y)]) continue;
      if (tiles[tileIdx(x, y)] === 4) continue;
      const k = x + ',' + y;
      if (G.ores.has(k)) continue;
      G.ores.set(k, { x, y, amount: ORE_VALUE * randi(3, 6), max: 0 });
      G.ores.get(k).max = G.ores.get(k).amount;
      walk[tileIdx(x, y)] = 1;
      placed++;
    }
  }
}

function nearestOre(tx, ty, maxR = 60) {
  let best = null, bd = Infinity;
  for (const o of G.ores.values()) {
    if (o.amount <= 0) continue;
    const d = Math.abs(o.x - tx) + Math.abs(o.y - ty);
    if (d < bd && d < maxR) { bd = d; best = o; }
  }
  return best;
}

/* ---------------- 迷雾 ---------------- */
function initFog() {
  G.fog = new Uint8Array(MAP_W * MAP_H);   // 0 未探, 1 已探未见, 2 可见
}
function revealAround(tx, ty, r) {
  const r2 = r * r;
  for (let y = Math.max(0, ty - r); y <= Math.min(MAP_H - 1, ty + r); y++)
    for (let x = Math.max(0, tx - r); x <= Math.min(MAP_W - 1, tx + r); x++) {
      const dx = x - tx, dy = y - ty;
      if (dx * dx + dy * dy <= r2) {
        const i = tileIdx(x, y);
        if (G.fog[i] < 2) G.fog[i] = 2;
      }
    }
}
function updateFog() {
  const f = G.fog;
  for (let i = 0; i < f.length; i++) if (f[i] === 2) f[i] = 1;
  if (G.satT > 0) { for (let i = 0; i < f.length; i++) f[i] = 2; return; }
  const pv = SIDE_VIS[0];
  for (const u of G.units) if (u.p === 0) revealAround(u.tx, u.ty, u.def.tab === 'inf' ? 8 : 9);
  for (const b of G.blds) if (b.p === 0) revealAround(b.tx, b.ty, Math.ceil((b.def.w + b.def.h) / 2) + 6);
  void pv;
}
const SIDE_VIS = [0];
function fogAt(tx, ty) { return inMap(tx, ty) ? G.fog[tileIdx(tx, ty)] : 0; }
function canSee(tx, ty) { return fogAt(tx, ty) === 2 || G.satT > 0; }

/* ---------------- 占用网格 ---------------- */
function refreshOcc() {
  MAP.occ.fill(-1);
  for (const b of G.blds) {
    if (b.dead) continue;
    for (let y = b.ty; y < b.ty + b.def.h; y++)
      for (let x = b.tx; x < b.tx + b.def.w; x++)
        if (inMap(x, y)) MAP.occ[tileIdx(x, y)] = b.uid;
  }
}
function canPlaceAt(tx, ty, w, h, player) { return canPlaceAtEx(tx, ty, w, h, player, true); }
function canPlaceAtEx(tx, ty, w, h, player, needFog) {
  if (!inMap(tx, ty) || !inMap(tx + w - 1, ty + h - 1)) return false;
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
    const i = tileIdx(x, y);
    if (!MAP.walk[i]) return false;
    if (MAP.occ[i] !== -1) return false;
    if (needFog && fogAt(x, y) === 0 && G.satT <= 0 && player === 0) return false;   /* 玩家只能在已探明区放置 */
  }
  // 不能贴敌太近（AI 领地内不设限——它自会保持阵型）
  if (player === 1) return true;
  for (const b of G.blds) if (b.p !== player && dist(tx + w / 2, ty + h / 2, b.tx + b.def.w / 2, b.ty + b.def.h / 2) * TILE < 5 * TILE) return false;
  return true;
}

/* ---------------- A* 寻路 ---------------- */
const PFD = { w: 0, h: 0, g: null, open: null, stamp: 0, came: null, cost: null };
function initPath() {
  const n = MAP_W * MAP_H;
  PFD.w = MAP_W; PFD.h = MAP_H;
  PFD.g = new Float32Array(n);
  PFD.came = new Int32Array(n);
  PFD.cost = new Float32Array(n);
  PFD.open = new Int32Array(n);
  PFD.stamp = new Int32Array(n).fill(0);
  PFD.tick = 0;
}
let PASSABLE = null;   // (i) => bool，由寻路调用方传入（考虑建筑与他方单位）

function findPath(sx, sy, tx, ty, passFn, allowTarget) {
  if (!inMap(sx, sy)) return null;
  if (!inMap(tx, ty)) return null;
  const W = MAP_W, H = MAP_H, N = W * H;
  const si = tileIdx(sx, sy), ti = tileIdx(tx, ty);
  if (si === ti) return [];
  PFD.tick++;
  const tick = PFD.tick;
  const g = PFD.g, came = PFD.came, stamp = PFD.stamp;
  const open = PFD.open;
  let openN = 0;
  const push = (idx, pri) => {
    // 简单二叉堆式插入（数组 + 线性上浮，规模小够用）
    let i = openN++;
    open[i] = idx; g[idx] = pri;
    // 用 cost 数组存 pri 便于比较
    PFD.cost[idx] = pri;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (PFD.cost[open[p]] <= PFD.cost[open[i]]) break;
      const t = open[p]; open[p] = open[i]; open[i] = t; i = p;
    }
  };
  const pop = () => {
    const top = open[0];
    openN--;
    if (openN > 0) {
      open[0] = open[openN];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < openN && PFD.cost[open[l]] < PFD.cost[open[m]]) m = l;
        if (r < openN && PFD.cost[open[r]] < PFD.cost[open[m]]) m = r;
        if (m === i) break;
        const t = open[m]; open[m] = open[i]; open[i] = t; i = m;
      }
    }
    return top;
  };

  const hFn = i => {
    const x = i % W, y = (i / W) | 0;
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  stamp[si] = tick; g[si] = 0; came[si] = -1;
  push(si, hFn(si));
  let iter = 0;
  while (openN > 0 && iter++ < 12000) {
    const cur = pop();
    if (cur === ti) break;
    if (stamp[cur] === tick && g[cur] > 0 && cur !== si) {
      // 已经弹出过更优版本则跳过重复
    }
    const cx = cur % W, cy = (cur / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!inMap(nx, ny)) continue;
      const ni = ny * W + nx;
      const isTarget = ni === ti;
      if (!isTarget && !passFn(ni)) continue;
      if (isTarget && !allowTarget && !passFn(ni)) {
        // 目标不可走：允许作为终点（走到边缘）
      }
      const diag = dx && dy;
      if (diag) {
        if (!passFn(cy * W + nx) || !passFn(ny * W + cx)) continue;
      }
      const step = diag ? 1.4142 : 1;
      const terr = MAP.walk[ni] ? 1 : 2.2;
      const ng = g[cur] + step * terr;
      if (stamp[ni] !== tick || ng < g[ni]) {
        stamp[ni] = tick; g[ni] = ng; came[ni] = cur;
        push(ni, ng + hFn(ni) * 1.05);
      }
    }
  }
  if (stamp[ti] !== tick) {
    // 无路：返回到目标最近的已探点
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (stamp[i] !== tick) continue;
      const x = i % W, y = (i / W) | 0;
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    return buildPath(best, si, came, tick);
  }
  return buildPath(ti, si, came, tick);
}
function buildPath(end, start, came, tick) {
  const path = [];
  let cur = end, guard = 0;
  while (cur !== start && guard++ < 4000) {
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    path.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
    cur = came[cur];
    if (cur < 0) break;
  }
  path.reverse();
  void tick;
  if (!path.length) return [];
  // 简单拉直：去掉中间共线点
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) out.push(b);
  }
  if (path.length > 1) out.push(path[path.length - 1]);
  return out;
}

/* 单位通行判定：默认不可穿过敌方/己方建筑与其他单位（己方单位软碰撞） */
function makePassFn(unit) {
  return (i) => {
    if (!MAP.walk[i]) return false;
    const occ = MAP.occ[i];
    if (occ !== -1) {
      const b = G.bldByUid ? G.bldByUid(occ) : null;
      if (b && !b.dead) return false;
    }
    return true;
  };
}

/* ---------------- 单位移动 ---------------- */
function reqPath(unit, tx, ty) {
  const pass = makePassFn(unit);
  // 目标格若被占，找附近可走格
  let gx = tx, gy = ty;
  if (!walkAt(gx, gy) || MAP.occ[tileIdx(gx, gy)] !== -1) {
    let found = false;
    for (let r = 1; r <= 4 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
        const nx = tx + dx, ny = ty + dy;
        if (walkAt(nx, ny) && MAP.occ[tileIdx(nx, ny)] === -1) { gx = nx; gy = ny; found = true; }
      }
    }
    if (!found) return false;
  }
  const p = findPath(unit.tx, unit.ty, gx, gy, pass, false);
  if (!p) { unit.path = null; return false; }
  unit.path = p;
  unit.pathI = 0;
  return true;
}

function moveTowards(u, dt, spd) {
  if (!u.path || u.pathI >= u.path.length) return true;
  const wp = u.path[u.pathI];
  const d = dist(u.x, u.y, wp.x, wp.y);
  if (d < 3.5) {
    u.pathI++;
    return u.pathI >= u.path.length;
  }
  const a = Math.atan2(wp.y - u.y, wp.x - u.x);
  const na = lerpAngle(u.angle, a, Math.min(1, dt * 8));
  u.angle = na;
  const step = spd * dt;
  const nx = u.x + Math.cos(na) * step, ny = u.y + Math.sin(na) * step;
  if (walkAt(Math.floor(nx / TILE), Math.floor(u.y / TILE))) u.x = nx;
  if (walkAt(Math.floor(u.x / TILE), Math.floor(ny / TILE))) u.y = ny;
  u._tx = Math.floor(u.x / TILE); u._ty = Math.floor(u.y / TILE);
  u.walk += step;
  return false;
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* 软分离：己方单位不叠罗汉 */
function separate(dt) {
  const grid = new Map();
  const key = (x, y) => (x >> 5) + ',' + (y >> 5);
  for (const u of G.units) {
    if (u.dead) continue;
    const k = key(u.x, u.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(u);
  }
  for (const u of G.units) {
    if (u.dead) continue;
    const gx = u.x >> 5, gy = u.y >> 5;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const arr = grid.get((gx + dx) + ',' + (gy + dy));
      if (!arr) continue;
      for (const v of arr) {
        if (v === u || v.dead) continue;
        const d = dist(u.x, u.y, v.x, v.y);
        const min = u.r + v.r;
        if (d > 0.001 && d < min) {
          const push = (min - d) * 0.5;
          const ax = (u.x - v.x) / d, ay = (u.y - v.y) / d;
          u.x += ax * push * Math.min(1, dt * 10);
          u.y += ay * push * Math.min(1, dt * 10);
          v.x -= ax * push * Math.min(1, dt * 10);
          v.y -= ay * push * Math.min(1, dt * 10);
          u._tx = Math.floor(u.x / TILE); u._ty = Math.floor(u.y / TILE);
          v._tx = Math.floor(v.x / TILE); v._ty = Math.floor(v.y / TILE);
        }
      }
    }
  }
}

/* ---------------- 战斗 ---------------- */
function dealDamage(src, tgt, amount, vsArmor, type) {
  if (tgt.dead) return;
  let amt = amount;
  if (tgt.kind === 'unit' && tgt.def.tab !== 'inf') amt *= vsArmor;
  else if (tgt.kind === 'unit') amt *= Math.min(1, vsArmor * 1.2);
  tgt.hp -= amt;
  tgt.flash = 0.12;
  if (tgt.p === 0 && tgt.kind === 'bld') triggerAlarm();
  if (tgt.hp <= 0) killEnt(tgt, src);
}

function killEnt(e, by) {
  if (e.dead) return;
  e.dead = true;
  G.stats[e.p].lost++;
  if (by && !by.dead && by.p !== undefined) G.stats[by.p].kills++;
  if (G.statsHook) { try { G.statsHook('kill', e, by); } catch (_) {} }

  if (e.kind === 'unit') {
    if (e.def.tab === 'inf') {
      spawnBurst(e.x, e.y, 6, '#c9c1a8', 1.4);
      Sfx.gun();
    } else {
      spawnBurst(e.x, e.y, 20, '#ff9c3a', 2.2);
      spawnDecal(e.x, e.y, 16, 'scorch');
      Sfx.explode(1.2);
      G.shake = Math.max(G.shake, 4);
    }
    if (e.def.special === 'harvest') {
      msg(e.p === 0 ? '超时空采矿车被摧毁！' : '敌方采矿车已摧毁', e.p === 0 ? 'warn' : 'good');
      if (e.p === 0) setTimeout(() => autoQueue(e.p, 'harvester'), 1500);
    }
  } else {
    spawnBurst(e.cx, e.cy, 34, '#ffb04a', 2.6);
    spawnDecal(e.cx, e.cy, e.def.w * 18, 'scorch');
    Sfx.explode(1.6);
    G.shake = Math.max(G.shake, 8);
    if (e.p === 0) { msg(`建筑被摧毁：${e.def.cn}`, 'warn'); }
    if (e.def.solo) { /* 需要手动补 */ }
    refreshOcc();
    recomputePower();
    // 建造场没了
    if (e.type === 'hq' && e.p === 0 && !hasBld(e.p, 'hq')) msg(TIPS.needHQ, 'warn');
  }
  checkVictory();
}

function triggerAlarm() {
  if (G.t - (G._lastAlarm || -9) < 8) return;
  G._lastAlarm = G.t;
  Sfx.alarm();
  msg(TIPS.baseAttacked, 'warn');
}

function spawnBurst(x, y, n, color, size) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(20, 130) * (size || 1);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.9), t: 0, color, size: rand(2, 5) * (size || 1), g: 60 });
  }
  if (size > 1.8) {
    for (let i = 0; i < n / 2; i++) G.parts.push({ x, y, vx: rand(-25, 25), vy: rand(-35, -6), life: rand(0.7, 1.6), t: 0, color: '#3a3a34', size: rand(6, 14), g: -8, smoke: true });
  }
}
function spawnFloat(x, y, text, color) {
  G.floats.push({ x, y, text, color: color || '#ffe9b0', t: 0, life: 1.1 });
}
function spawnDecal(x, y, r, kind) {
  G.decals.push({ x, y, r, kind, t: 0, life: 40 });
  if (G.decals.length > 90) G.decals.shift();
}

/* 寻找目标 */
function findTarget(e, range) {
  let best = null, bd = Infinity;
  const scanR = range;
  for (const u of G.units) {
    if (u.dead || u.p === e.p) continue;
    const d = dist(e.x ?? e.cx, e.y ?? e.cy, u.x, u.y);
    if (d <= scanR && d < bd) { bd = d; best = u; }
  }
  if (best) return best;
  for (const b of G.blds) {
    if (b.dead || b.p === e.p) continue;
    const d = dist(e.x ?? e.cx, e.y ?? e.cy, b.cx, b.cy) - b.r;
    if (d <= scanR && d < bd) { bd = d; best = b; }
  }
  return best;
}

function fireWeapon(e, tgt) {
  const isBld = e.kind === 'bld';
  const ex = isBld ? e.cx : e.x, ey = isBld ? e.cy : e.y;
  const tx = tgt.kind === 'bld' ? tgt.cx : tgt.x, ty = tgt.kind === 'bld' ? tgt.cy : tgt.y;
  const w = isBld ? e.weapon : { atk: e.dmg, range: e.def.range, cool: e.def.cool, vsArmor: e.def.vsArmor, type: e.def.artillery ? 'shell' : (e.def.tab === 'inf' ? 'bullet' : 'shell') };
  e.cool = w.cool;
  const ang = Math.atan2(ty - ey, tx - ex);
  if (!isBld) { e.turret = ang; e.angle = lerpAngle(e.angle, ang, 0.35); }

  const type = w.type || 'bullet';
  if (type === 'tesla') {
    G.shots.push({ kind: 'tesla', x1: ex, y1: ey - 14, x2: tx, y2: ty, life: 0.28, t: 0, seed: Math.random() * 99 });
    Sfx.tesla();
    dealDamage(e, tgt, w.atk, w.vsArmor, type);
  } else if (type === 'beam') {
    G.shots.push({ kind: 'beam', x1: ex, y1: ey - 16, x2: tx, y2: ty, life: 0.22, t: 0 });
    Sfx.laser();
    dealDamage(e, tgt, w.atk, w.vsArmor, type);
  } else if (type === 'shell') {
    G.shots.push({ kind: 'proj', x: ex, y: ey - 8, sx: ex, sy: ey - 8, tx, ty, t: 0, dur: dist(ex, ey, tx, ty) / 420 + 0.12, src: e, dmg: w.atk, vsArmor: w.vsArmor, splash: e.def?.splash || 22, type: 'shell' });
    if (e.def && e.def.artillery) Sfx.rocket(); else Sfx.gun();
  } else {
    G.shots.push({ kind: 'tracer', x1: ex, y1: ey - 6, x2: tx, y2: ty, life: 0.1, t: 0 });
    Sfx.gun();
    dealDamage(e, tgt, w.atk, w.vsArmor, type);
  }
}

function splashDamage(src, x, y, r, amount) {
  for (const u of G.units) {
    if (u.dead) continue;
    const d = dist(x, y, u.x, u.y);
    if (d < r) dealDamage(src, u, amount * (1 - d / r * 0.6), 1.0, 'splash');
  }
  for (const b of G.blds) {
    if (b.dead) continue;
    const d = dist(x, y, b.cx, b.cy) - b.r;
    if (d < r) dealDamage(src, b, amount * (1 - Math.max(0, d) / r * 0.6), 1.0, 'splash');
  }
}

/* ---------------- 单位 AI ---------------- */
function updateUnit(u, dt) {
  if (u.dead) return;
  const def = u.def;

  /* 工程师占领 */
  if (u.special === 'cap' && u.capTarget && !u.capTarget.dead) {
    const b = u.capTarget;
    const d = dist(u.x, u.y, b.cx, b.cy);
    if (d < Math.max(b.def.w, b.def.h) * TILE / 2 + 12) {
      u.capT += dt;
      if (u.capT >= 1.0) {
        if (b.p !== u.p) {
          const old = b.p;
          b.p = u.p;
          b.hp = b.maxhp * 0.6;
          u.dead = true; u.hp = 0;
          refreshOcc(); recomputePower(); checkVictory();
          Sfx.cap();
          msg(u.p === 0 ? `占领敌方${b.def.cn}！` : `我方${b.def.cn}被敌方工程师占领！`, u.p === 0 ? 'good' : 'warn');
          void old;
        } else {
          b.hp = b.maxhp;
          u.dead = true; u.hp = 0;
          Sfx.buildOk();
          msg(`${b.def.cn}已修复`, 'good');
        }
        return;
      }
    } else {
      u.dest = { x: b.cx, y: b.cy };
    }
  }

  /* 采矿车逻辑 */
  if (def.special === 'harvest') { harvestLogic(u, dt); }

  /* 索敌 / 开火（哪怕在赶路也允许开火：否则走位时白挨打） */
  if (u.cool > 0) u.cool -= dt;
  const hasWp = def.atk > 0;
  if (hasWp && u.special !== 'cap') {
    if (u.target && (u.target.dead || dist(u.x, u.y, u.target.kind === 'bld' ? u.target.cx : u.target.x, u.target.kind === 'bld' ? u.target.cy : u.target.y) > def.range * 1.7)) u.target = null;
    if (!u.target) u.target = findTarget(u, def.range + (u.dest ? 60 : 40));
    if (u.target) {
      const tg = u.target;
      const d = dist(u.x, u.y, tg.kind === 'bld' ? tg.cx : tg.x, tg.kind === 'bld' ? tg.cy : tg.y) - (tg.kind === 'bld' ? tg.r * 0.5 : 0);
      if (d <= def.range) {
        u.path = null; u.dest = null;      /* 进入射程就停下开火 */
        const ang = Math.atan2((tg.kind === 'bld' ? tg.cy : tg.y) - u.y, (tg.kind === 'bld' ? tg.cx : tg.x) - u.x);
        u.turret = lerpAngle(u.turret, ang, Math.min(1, dt * 9));
        if (u.cool <= 0) fireWeapon(u, tg);
      } else if (!u.hold && !def.artillery) {
        /* 追击已在移动分支处理；炮兵靠移动分支逼近 */
      }
    }
  }

  /* 攻击移动：沿途见敌就打，抵达后解除 */
  if (u.attackMove && !u.target) {
    u.target = findTarget(u, def.range + 90);
    if (u.target) {
      const tg = u.target;
      u.dest = { x: tg.kind === 'bld' ? tg.cx : tg.x, y: tg.kind === 'bld' ? tg.cy : tg.y };
      u.repathT = 0;
    }
  }

  /* 移动 */
  if (u.dest) {
    const d = dist(u.x, u.y, u.dest.x, u.dest.y);
    const arriveR = def.tab === 'inf' ? 8 : 12;
    if (d < arriveR) {
      u.dest = null; u.path = null;
      u.stuckT = 0;
      if (u.attackMove) u.attackMove = false;
      if (u.onArrive) { const f = u.onArrive; u.onArrive = null; f(); }
    } else {
      if (!u.path || !u.path.length || (u.repathT && G.t - u.repathT > 1.6)) {
        u.repathT = G.t;
        const ok = reqPath(u, Math.floor(u.dest.x / TILE), Math.floor(u.dest.y / TILE));
        if (!ok) { u.dest = null; u.path = null; }
      }
      const before = { x: u.x, y: u.y };
      const arrived = moveTowards(u, dt, def.speed * (u.def.tab === 'inf' ? 1 : 1));
      if (arrived) { u.dest = null; u.path = null; if (u.onArrive) { const f = u.onArrive; u.onArrive = null; f(); } }
      const moved = dist(before.x, before.y, u.x, u.y);
      if (moved < def.speed * dt * 0.25) {
        u.stuckT += dt;
        if (u.stuckT > 1.0) {
          u.stuckT = 0;
          if (!u.dest) { u.path = null; }
          // 卡住：重新寻路或小范围挪动
          else if (!u.retryN || u.retryN < 3) {
            u.retryN = (u.retryN || 0) + 1;
            u.repathT = 0;
            reqPath(u, Math.floor(u.dest.x / TILE), Math.floor(u.dest.y / TILE));
          } else {
            u.retryN = 0; u.dest = null; u.path = null;
          }
        }
      } else u.stuckT = 0;

      /* 追击：到了射程内就停步（不覆盖玩家手动移动命令——dest 带 fromPlayer 标记时只在交战中生效） */
      if (u.target && !u.target.dead && !u.path) {
        const tg = u.target;
        const d2 = dist(u.x, u.y, tg.kind === 'bld' ? tg.cx : tg.x, tg.kind === 'bld' ? tg.cy : tg.y) - (tg.kind === 'bld' ? tg.r * 0.5 : 0);
        if (d2 <= def.range * 0.94) {
          u.dest = null; u.stuckT = 0;
        }
      }
    }
  } else if (u.target && !u.target.dead && def.atk > 0) {
    // 追击（有目标无目的地）
    const tg = u.target;
    const d = dist(u.x, u.y, tg.kind === 'bld' ? tg.cx : tg.x, tg.kind === 'bld' ? tg.cy : tg.y);
    if (d > def.range && !u.hold) {
      if (!u.chaseT || G.t - u.chaseT > 0.6) {
        u.chaseT = G.t;
        u.dest = { x: tg.kind === 'bld' ? tg.cx : tg.x, y: tg.kind === 'bld' ? tg.cy : tg.y };
      }
    }
  }

  /* 转塔跟随 */
  if (u.target || u.dest) u.turret = lerpAngle(u.turret, u.angle, Math.min(1, dt * 3));
  if (u.flash > 0) u.flash -= dt;
}

/* 采矿车 */
function harvestLogic(u, dt) {
  const p = G.players[u.p];
  if (u.harvState === 'idle') {
    if (u.ore >= ORE_LOAD) u.harvState = 'toRef';
    else {
      /* 就近优先：扫描半径按距离递增，避免绕远 */
      let ore = null;
      for (const r of [6, 14, 30, 999]) {
        ore = nearestOre(u.tx, u.ty, r);
        if (ore) break;
      }
      if (ore) {
        u.oreTarget = ore;
        u.harvState = 'toOre';
        u.dest = { x: ore.x * TILE + 16, y: ore.y * TILE + 16 };
        u.path = null; u.onArrive = null;
      } else if (u.ore > 0) u.harvState = 'toRef';
    }
    return;
  }
  if (u.harvState === 'toOre') {
    const ore = u.oreTarget;
    if (!ore || ore.amount <= 0) { u.harvState = 'idle'; u.dest = null; return; }
    const d = dist(u.x, u.y, ore.x * TILE + 16, ore.y * TILE + 16);
    if (d < 24) {
      u.path = null; u.dest = null;
      u.mineT = (u.mineT || 0) + dt;
      if (u.mineT > 0.25) {
        u.mineT = 0;
        const take = Math.min(ore.amount, ORE_VALUE);
        ore.amount -= take; u.ore += take / ORE_VALUE;
        if (ore.amount <= 0.01) G.ores.delete(ore.x + ',' + ore.y);
        if (u.ore >= ORE_LOAD) { u.ore = ORE_LOAD; u.harvState = 'toRef'; }
      }
    } else if (!u.dest) {
      u.dest = { x: ore.x * TILE + 16, y: ore.y * TILE + 16 };
    }
    return;
  }
  if (u.harvState === 'toRef') {
    const ref = nearestBld(u.p, 'refinery', u.x, u.y);
    if (!ref) { u.harvState = 'idle'; u.dest = null; u.refSpot = null; return; }
    /* 卸矿判定：贴到建筑外圈即可（建筑是对角矩形，得按半对角线算，
       否则矿车永远停在外围、判定不通过，会在原地来回抖） */
    const refR = Math.hypot(ref.def.w, ref.def.h) * TILE / 2;   // 3x3 → 68px
    /* 外圈相邻格（含对角）到中心的距离最大约 90px，再加 12px 到位容差 */
    const dropR = refR + 44;
    const d = dist(u.x, u.y, ref.cx, ref.cy);
    if (d < dropR) {
      u.path = null; u.dest = null;
      u.dumpT = (u.dumpT || 0) + dt;
      if (u.dumpT > 1.1) {
        u.dumpT = 0;
        const val = Math.round(u.ore * ORE_VALUE);
        addCash(u.p, val);
        G.stats[u.p].earned += val;
        u.ore = 0;
        spawnFloat(ref.cx, ref.cy - 20, `+$${val}`, '#8bff9c');
        if (u.p === 0) Sfx.cash();
        u.harvState = 'idle';
        u.refSpot = null;
      }
    } else {
      /* 目标点：精炼厂外圈最近的一块空地（一次性算好，别每帧重算导致来回抖） */
      if (!u.refSpot || u.refSpot.uid !== ref.uid) {
        let best = null, bd = Infinity;
        for (let y = ref.ty - 1; y <= ref.ty + ref.def.h; y++) {
          for (let x = ref.tx - 1; x <= ref.tx + ref.def.w; x++) {
            if (!walkAt(x, y) || MAP.occ[tileIdx(x, y)] !== -1) continue;
            const px = x * TILE + 16, py = y * TILE + 16;
            if (G.ores.has(x + ',' + y)) continue;
            const dd = dist(px, py, u.x, u.y);
            if (dd < bd) { bd = dd; best = { x: px, y: py, uid: ref.uid }; }
          }
        }
        u.refSpot = best || { x: ref.cx, y: ref.cy + ref.def.h * TILE / 2 + 20, uid: ref.uid };
        u.dest = { x: u.refSpot.x, y: u.refSpot.y };
        u.path = null;
        return;
      }
      if (!u.dest) { u.dest = { x: u.refSpot.x, y: u.refSpot.y }; u.path = null; }
    }
    return;
  }
}

/* ---------------- 建筑更新 ---------------- */
function updateBld(b, dt) {
  if (b.dead) return;
  if (b.builtT > 0) b.builtT -= dt;
  if (b.flash > 0) b.flash -= dt;
  if (b.anim > 0) b.anim -= dt;

  /* 防御武器 */
  if (b.weapon && !b.powOffline && !G.players[b.p].offline) {
    if (b.cool > 0) b.cool -= dt;
    if (!b.target || b.target.dead || dist(b.cx, b.cy, b.target.x ?? b.target.cx, b.target.y ?? b.target.cy) > b.weapon.range * 1.3) {
      b.target = findTarget(b, b.weapon.range + 30);
    }
    if (b.target) {
      const tg = b.target;
      const d = dist(b.cx, b.cy, tg.kind === 'bld' ? tg.cx : tg.x, tg.kind === 'bld' ? tg.cy : tg.y);
      if (d <= b.weapon.range) {
        const ang = Math.atan2((tg.kind === 'bld' ? tg.cy : tg.y) - b.cy, (tg.kind === 'bld' ? tg.cx : tg.x) - b.cx);
        b.barrel = ang;
        if (b.cool <= 0) fireWeapon(b, tg);
      }
    }
  }

  /* 生产：建筑（玩家/AI 通用） */
  const p = G.players[b.p];
  if (b.producing && b.producing.kind === 'bld') {
    const off = p.offline || (G.players[b.p].powerUse > G.players[b.p].powerCap && b.p === 0);
    if (!off) {
      b.producing.t += dt;
      if (b.producing.t >= b.producing.dur) {
        b.producing.done = true;
        if (b.p === 0) { msg(`${BUILDINGS[b.producing.key].cn} 建造完成——点击地图放置`, 'good'); Sfx.ready(); }
      }
    }
  }
}

function nearestBld(p, type, x, y) {
  let best = null, bd = Infinity;
  for (const b of G.blds) {
    if (b.dead || b.p !== p || b.type !== type) continue;
    const d = dist(x, y, b.cx, b.cy);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) return best;
  /* 兜底：没有对应生产建筑时退回建造场（初始单位出生用） */
  if (type !== 'hq') return nearestBld(p, 'hq', x, y);
  return null;
}
function hasBld(p, type) { return G.blds.some(b => !b.dead && b.p === p && b.type === type); }
function bldsOf(p) { return G.blds.filter(b => !b.dead && b.p === p); }

/* ---------------- 经济 / 电力 ---------------- */
function addCash(p, v) {
  G.cash[p] = clamp(G.cash[p] + v, 0, CASH_MAX);
}
function recomputePower() {
  for (let p = 0; p < 2; p++) {
    let cap = 0, use = 0;
    for (const b of G.blds) {
      if (b.dead || b.p !== p) continue;
      if (b.def.power > 0) cap += b.def.power;
      else use -= b.def.power;
    }
    G.players[p].powerCap = cap;
    G.players[p].powerUse = use;
    G.players[p].offline = use > cap;
    // 建筑断电标记（离线时防御武器停摆）
    for (const b of G.blds) {
      if (b.dead || b.p !== p) continue;
      b.powOffline = use > cap;
    }
  }
}

/* ---------------- 生产队列（单位） ---------------- */
function unitReqMet(p, def) {
  if (def.req && !hasBld(p, def.req)) return false;
  if (def.side !== 'any' && def.side !== G.side) {
    // AI 阵营判断：def.side 是该单位归属阵营，any 通用
    return false;
  }
  return true;
}
function unitReqOkForPlayer(p, def) {
  if (def.req && !hasBld(p, def.req)) return false;
  if (def.side !== 'any') {
    const mySide = p === 0 ? G.side : G.enemySide;
    if (def.side !== mySide) return false;
  }
  return true;
}

function startUnit(p, key) {
  const def = UNITS[key];
  if (!unitReqOkForPlayer(p, def)) return false;
  if (G.cash[p] < def.cost) { if (p === 0) { msg(TIPS.noCash, 'warn'); Sfx.deny(); } return false; }
  G.cash[p] -= def.cost;
  G.unitOrder[p].push({ key, t: 0, dur: def.build });
  if (p === 0) { Sfx.click(); refreshBuildBar(); }
  return true;
}
function autoQueue(p, key) { startUnit(p, key); }

function updateUnitQueue(p, dt) {
  const q = G.unitOrder[p];
  if (!q.length) return;
  const item = q[0];
  const def = UNITS[item.key];
  const producer = def.tab === 'inf' ? 'barracks' : 'factory';
  const b = nearestBld(p, producer, MAP.spawns[p].tx * TILE, MAP.spawns[p].ty * TILE);
  if (!b) return;
  const off = G.players[p].offline || (p === 0 && G.players[p].powerUse > G.players[p].powerCap);
  if (off) return;
  item.t += dt;
  if (item.t >= item.dur) {
    q.shift();
    spawnUnit(p, item.key, b);
    if (p === 0) { Sfx.buildOk(); refreshBuildBar(); }
  }
}

function spawnUnit(p, key, near, quiet) {
  const def = UNITS[key];
  const side = p === 0 ? G.side : G.enemySide;
  /* 出生点兜底：没有生产建筑时用建造场 / 出生点 */
  const src = near || nearestBld(p, 'hq', MAP.spawns[p].tx * TILE, MAP.spawns[p].ty * TILE) || G.blds.find(b => !b.dead && b.p === p);
  let sx, sy;
  if (src) { sx = src.cx; sy = src.cy + src.def.h * TILE / 2 + 20; }
  else { sx = MAP.spawns[p].tx * TILE + 48; sy = MAP.spawns[p].ty * TILE + 48; }
  if (src) {
    for (let tries = 0; tries < 24; tries++) {
      const a = rand(0, Math.PI * 2), r = rand(30, 78);
      const nx = src.cx + Math.cos(a) * r, ny = src.cy + Math.sin(a) * r;
      const ttx = Math.floor(nx / TILE), tty = Math.floor(ny / TILE);
      if (walkAt(ttx, tty) && !G.ores.has(ttx + ',' + tty) && MAP.occ[tileIdx(ttx, tty)] === -1) { sx = nx; sy = ny; break; }
    }
  }
  const u = new Unit({
    p, def, key, x: sx, y: sy,
    side,
  });
  G.units.push(u);
  G.stats[p].built++;
  u._tx = Math.floor(u.x / TILE); u._ty = Math.floor(u.y / TILE);
  const rally = src ? src.rally : null;
  if (p === 0 && !quiet) msg(`${def.cn} 就绪`, 'good');
  if (def.special !== 'harvest') {
    if (rally) {
      u.dest = { x: rally.x, y: rally.y };
    } else if (def.special === 'cap') {
      u.dest = null; u.hold = true;           /* 工程师待命，等玩家指目标 */
    } else {
      /* 默认集结：基地前方 6 格（朝地图中心那一侧），不是敌方基地——
         否则新兵会自己跑去送死 */
      const sp = MAP.spawns[p];
      const dx = Math.sign(MAP_W / 2 - sp.tx) || 1;
      const dy = Math.sign(MAP_H / 2 - sp.ty) || 1;
      for (let t = 0; t < 20; t++) {
        const rx = sp.tx + dx * (6 + t % 3);
        const ry = sp.ty + dy * (6 + ((t / 3) | 0));
        if (walkAt(rx, ry) && MAP.occ[tileIdx(rx, ry)] === -1 && !G.ores.has(rx + ',' + ry)) {
          u.dest = { x: rx * TILE + 16, y: ry * TILE + 16 };
          break;
        }
      }
      u.hold = false;
    }
  }
  if (def.special === 'harvest') { u.dest = null; u.harvState = 'idle'; }
  refreshBuildBar();
  return u;
}

/* ---------------- 放置建筑 ---------------- */
function placeBuilding(p, key, tx, ty) {
  const def = BUILDINGS[key];
  if (!canPlaceAt(tx, ty, def.w, def.h, p)) return false;
  return doPlaceBuilding(p, key, tx, ty);
}
/* 绕过迷雾校验的内部部署（开局布景用） */
function doPlaceBuilding(p, key, tx, ty, quiet) {
  const def = BUILDINGS[key];
  const b = new Bld({ p, def, type: key, tx, ty, x: tx * TILE, y: ty * TILE });
  b.builtT = 0;
  G.blds.push(b);
  /* 建筑地基推掉矿石（矿是可再生资源，被占就没了） */
  for (let yy = ty; yy < ty + def.h; yy++) for (let xx = tx; xx < tx + def.w; xx++) {
    if (inMap(xx, yy)) {
      const k = xx + ',' + yy;
      if (G.ores.has(k)) { G.ores.delete(k); oreDirty = true; }
    }
  }
  refreshOcc();
  recomputePower();
  if (!quiet && p === 0) { msg(`${def.cn} 部署完毕`, 'good'); }
  // 新矿场自动派车
  if (key === 'refinery') {
    if (!G.blds.some(u => !u.dead && u.p === p && u.def.special === 'harvest')) spawnUnit(p, 'harvester', b, quiet);
  }
  checkVictory();
  return true;
}

/* ---------------- 建造（建筑） ---------------- */
function startBuilding(p, key) {
  const def = BUILDINGS[key];
  const mySide = p === 0 ? G.side : G.enemySide;
  if (G.buildOrder[p]) { if (p === 0) { msg('已有建筑在建造队列中', 'warn'); Sfx.deny(); } return false; }
  if (G.aiPending && G.aiPending[p]) { return false; }   /* 上一栋还没落地 */
  if (def.side && def.side !== mySide) { if (p === 0) { msg('该建筑属于另一阵营', 'warn'); Sfx.deny(); } return false; }
  if (def.req && !hasBld(p, def.req)) {
    if (p === 0) {
      const rq = BUILDINGS[def.req];
      msg(`需要先建造：${rq.cn}`, 'warn'); Sfx.deny();
    }
    return false;
  }
  if (def.solo && hasBld(p, key)) { if (p === 0) { msg('同类建筑已有（唯一建筑）', 'warn'); Sfx.deny(); } return false; }
  if (G.cash[p] < def.cost) { if (p === 0) { msg(TIPS.noCash, 'warn'); Sfx.deny(); } return false; }
  G.cash[p] -= def.cost;
  G.buildOrder[p] = { key, t: 0, dur: def.build };
  if (p === 0) { Sfx.click(); refreshBuildBar(); }
  return true;
}
function updateBuildOrder(p, dt) {
  const o = G.buildOrder[p];
  if (!o) return;
  const p0 = G.players[p];
  if (p0.offline) return;
  o.t += dt;
  if (o.t >= o.dur) {
    // 完成：进入"可放置"状态（仅玩家直接挂到建造场提示；AI 自动放置）
    if (p === 0) {
      G.buildOrder[p] = null;
      G.pendingPlace = o.key;
      msg(`${BUILDINGS[o.key].cn} 建造完成——点击战场放置`, 'good');
      Sfx.ready();
      refreshBuildBar();
    } else {
      /* AI：存成"待放置"，由 aiTick 尝试放置 */
      G.aiPending[p] = { key: o.key, t: 0 };
      G.buildOrder[p] = null;
    }
  }
}

/* ---------------- 事件 / 消息 ---------------- */
function msg(text, cls) {
  const el = document.getElementById('msglog');
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'msg' + (cls ? ' ' + cls : '');
  d.textContent = text;
  el.appendChild(d);
  setTimeout(() => d.classList.add('out'), 3600);
  setTimeout(() => d.remove(), 4200);
  while (el.children.length > 5) el.firstChild.remove();
}

/* ---------------- 胜负 ---------------- */
function checkVictory() {
  if (G.over || !G.running || G._setup) return;
  const p0any = bldsOf(0).length > 0 || G.units.some(u => !u.dead && u.p === 0);
  const p1any = bldsOf(1).length > 0 || G.units.some(u => !u.dead && u.p === 1);
  if (!p1any) endGame(true);
  else if (!p0any) endGame(false);
}
function endGame(win) {
  G.over = true; G.running = false;
  Sfx.stopBgm();
  if (win) Sfx.win(); else Sfx.lose();
  showEndModal(win);
}
