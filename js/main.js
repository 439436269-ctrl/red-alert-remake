/* ============================================================
 * RED ALERT · WEB REMAKE —— 主循环：渲染 / 输入 / 调度
 * ============================================================ */
'use strict';

const VIEW = { cv: null, ctx: null, w: 0, h: 0, dpr: 1 };
const MM = { cv: null, ctx: null, size: 180 };
let lastFrame = 0;
let paused = false;
let forceAtk = false;
let holdX = false, holdZ = false;

/* 地形缓存画布 */
const TERRAIN = { cv: null, ctx: null, ready: false };
const FOGCV = { cv: null, ctx: null, dirty: true };
let oreDirty = true;

/* ================================================================
 * BOOT
 * ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  /* 全局兜底：把未捕获异常的栈记进 console（便于自动化抓栈） */
  window.addEventListener('error', ev => {
    if (ev.error && ev.error.stack) console.error('UNCAUGHT: ' + ev.error.stack);
  });
  VIEW.cv = document.getElementById('view');
  VIEW.ctx = VIEW.cv.getContext('2d');
  MM.cv = document.getElementById('minimap');
  MM.ctx = MM.cv.getContext('2d');
  resize();
  window.addEventListener('resize', resize);

  /* boot → 菜单 */
  const boot = document.getElementById('boot');
  const enter = () => {
    Sfx.resume();
    boot.style.transition = 'opacity .5s';
    boot.style.opacity = '0';
    setTimeout(() => { boot.style.display = 'none'; }, 520);
    document.getElementById('app').hidden = false;
    showStartModal();
    window.removeEventListener('keydown', enter);
    boot.removeEventListener('click', enter);
  };
  boot.addEventListener('click', enter);
  window.addEventListener('keydown', enter, { once: false });

  bindInput();
  lastFrame = performance.now();
  requestAnimationFrame(loop);
});

function resize() {
  VIEW.dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = VIEW.cv.getBoundingClientRect();
  VIEW.w = r.width; VIEW.h = r.height;
  VIEW.cv.width = Math.round(r.width * VIEW.dpr);
  VIEW.cv.height = Math.round(r.height * VIEW.dpr);
}

/* ================================================================
 * 开局
 * ================================================================ */
function startGame(side, diff) {
  /* 全量重置 */
  UID = 1;
  G.running = true; G.over = false;
  G.side = side; G.enemySide = side === 'soviet' ? 'allied' : 'soviet';
  G.t = 0; G.cash = [START_CASH, START_CASH];
  G.units = []; G.blds = []; G.shots = []; G.parts = []; G.decals = []; G.floats = [];
  G.ores = new Map();
  G.players = [{ powerCap: 0, powerUse: 0, offline: false }, { powerCap: 0, powerUse: 0, offline: false }];
  G.sel = []; G.placing = null; G.pendingPlace = null;
  G.nukeCd = 0; G.satCd = 0; G.satT = 0; G.nukeAim = false; G.nukeMark = null;
  G.buildOrder = { 0: null, 1: null };
  G.aiPending = { 0: null, 1: null };
  G.pendingPlace = null;
  G.unitOrder = { 0: [], 1: [] };
  G.stats = [{ built: 0, lost: 0, kills: 0, earned: 0 }, { built: 0, lost: 0, kills: 0, earned: 0 }];
  G.shake = 0;
  paused = false;

  /* 基地 + 初始单位（map 先跑完，否则出生点是空的） */
  genMap();
  initFog();
  initPath();
  buildTerrainCache();
  /* 布景阶段挂起胜负判定（建筑是一栋一栋落的） */
  G._setup = true;

  for (let p = 0; p < 2; p++) {
    const sp = MAP.spawns[p];
    const force = (key, tx, ty) => {
      if (!inMap(tx, ty)) return null;
      /* 冲突时向外找最近空位（不查迷雾——开局出生点需先落地） */
      let px = tx, py = ty;
      if (!canPlaceAtEx(px, py, BUILDINGS[key].w, BUILDINGS[key].h, p, false)) {
        let found = false;
        for (let r = 1; r <= 8 && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = tx + dx, ny = ty + dy;
            if (canPlaceAtEx(nx, ny, BUILDINGS[key].w, BUILDINGS[key].h, p, false)) { px = nx; py = ny; found = true; }
          }
        }
        if (!found) return null;
      }
      return doPlaceBuilding(p, key, px, py, true);
    };
    force('hq', sp.tx, sp.ty);
    force('reactor', sp.tx + 5, sp.ty + 1);
    force('refinery', sp.tx + 1, sp.ty + 5);
    spawnUnit(p, 'harvester', nearestBld(p, 'refinery', sp.tx * TILE, sp.ty * TILE), true);
    const infKey = p === 0 ? (side === 'soviet' ? 'gi' : 'conscript') : (G.enemySide === 'soviet' ? 'gi' : 'conscript');
    spawnUnit(p, infKey, nearestBld(p, 'barracks', sp.tx * TILE, sp.ty * TILE), true);
    spawnUnit(p, infKey, nearestBld(p, 'hq', sp.tx * TILE, sp.ty * TILE), true);
    addCash(p, START_CASH - G.cash[p]);
  }
  refreshOcc();
  recomputePower();
  updateFog();
  G._setup = false;
  checkVictory();
  /* 开局清掉布景阶段的消息，别把"作战开始"顶掉 */
  { const el = document.getElementById('msglog'); if (el) el.innerHTML = ''; }

  /* 相机对准基地 */
  const sp0 = MAP.spawns[0];
  G.cam.x = clamp((sp0.tx + 2) * TILE - VIEW.w / 2, 0, MAP_W * TILE - VIEW.w);
  G.cam.y = clamp((sp0.ty + 2) * TILE - VIEW.h / 2, 0, MAP_H * TILE - VIEW.h);
  if (MAP_W * TILE < VIEW.w) G.cam.x = (MAP_W * TILE - VIEW.w) / 2;
  if (MAP_H * TILE < VIEW.h) G.cam.y = (MAP_H * TILE - VIEW.h) / 2;

  aiInit(diff);
  refreshBuildBar();
  updateTopbar();
  updateSelBox();

  msg(`作战开始——${SIDE[side].cn}阵营，${['简单', '普通', '困难'][diff]}难度`, 'good');
  msg('提示：F1 查看作战手册', '');
  Sfx.startBgm();
}

/* ================================================================
 * 地形预渲染
 * ================================================================ */
function buildTerrainCache() {
  const W = MAP_W * TILE, H = MAP_H * TILE;
  TERRAIN.cv = document.createElement('canvas');
  TERRAIN.cv.width = W; TERRAIN.cv.height = H;
  const c = TERRAIN.cv.getContext('2d');
  const PALS = [
    ['#3c5a2e', '#426334', '#385428'],   // 0 草
    ['#6b5a3a', '#756242', '#615133'],   // 1 土
    ['#54492f', '#5c5035', '#4b4129'],   // 2 深土
    ['#4a4a48', '#565654', '#3e3e3c'],   // 3 岩
    ['#1e3a52', '#23425e', '#183147'],   // 4 水
  ];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = MAP.tiles[tileIdx(x, y)];
    const pal = PALS[t];
    const px = x * TILE, py = y * TILE;
    c.fillStyle = pal[(x * 7 + y * 13) % 3];
    c.fillRect(px, py, TILE, TILE);
    /* 噪点纹理 */
    for (let i = 0; i < 7; i++) {
      const nx = px + ((x * 31 + i * 17) % TILE), ny = py + ((y * 23 + i * 29) % TILE);
      c.fillStyle = pal[(i + x + y) % 3];
      c.globalAlpha = 0.55;
      c.fillRect(nx, ny, 3, 3);
      c.globalAlpha = 1;
    }
    if (t === 3) { /* 岩石阴影 */
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.fillRect(px, py + TILE - 4, TILE, 4);
      c.fillStyle = 'rgba(255,255,255,.06)';
      c.fillRect(px, py, TILE, 3);
    }
    if (t === 4) { /* 水波纹 */
      c.strokeStyle = 'rgba(255,255,255,.10)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px + 4, py + ((y * 9) % 20) + 6);
      c.lineTo(px + TILE - 6, py + ((y * 9) % 20) + 6);
      c.stroke();
    }
  }
  /* 网格线（很淡） */
  c.strokeStyle = 'rgba(0,0,0,.10)'; c.lineWidth = 1;
  for (let x = 0; x <= MAP_W; x++) { c.beginPath(); c.moveTo(x * TILE + .5, 0); c.lineTo(x * TILE + .5, H); c.stroke(); }
  for (let y = 0; y <= MAP_H; y++) { c.beginPath(); c.moveTo(0, y * TILE + .5); c.lineTo(W, y * TILE + .5); c.stroke(); }

  /* 矿石（动态重绘，单独层） */
  redrawOreLayer();
  TERRAIN.ready = true;
}

let ORECV = null, ORECTX = null;
function redrawOreLayer() {
  const W = MAP_W * TILE, H = MAP_H * TILE;
  if (!ORECV) { ORECV = document.createElement('canvas'); ORECV.width = W; ORECV.height = H; ORECTX = ORECV.getContext('2d'); }
  const c = ORECTX;
  c.clearRect(0, 0, W, H);
  const gold = G.side === 'soviet' ? '#e8b93a' : '#6fd8e8';
  for (const o of G.ores.values()) {
    const px = o.x * TILE, py = o.y * TILE;
    const ratio = o.amount / o.max;
    const n = Math.max(1, Math.round(9 * ratio));
    for (let i = 0; i < n; i++) {
      const gx = px + ((i * 37) % 26) + 3, gy = py + ((i * 53) % 26) + 3;
      const s = 3 + ((i * 7) % 4);
      c.fillStyle = i % 3 === 0 ? '#fff3c0' : gold;
      c.fillRect(gx, gy, s, s);
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.fillRect(gx, gy + s, s, 1);
    }
  }
  oreDirty = false;
}

/* ================================================================
 * 输入
 * ================================================================ */
function bindInput() {
  const cv = VIEW.cv;

  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('mousedown', e => {
    if (!G.running || paused) return;
    Sfx.resume();
    const m = G.mouse;
    m.down = true; m.downBtn = e.button;
    m.sx = e.clientX; m.sy = e.clientY;
    m.x = e.clientX; m.y = e.clientY;
    if (e.button === 2) {
      rightClick();
      m.down = false;
      return;
    }
    if (e.button === 1) { e.preventDefault(); m.down = false; return; }
  });

  window.addEventListener('mousemove', e => {
    const m = G.mouse;
    const rect = cv.getBoundingClientRect();
    m.x = e.clientX - rect.left; m.y = e.clientY - rect.top;
    m.wx = m.x + G.cam.x; m.wy = m.y + G.cam.y;
    if (m.down && m.downBtn === 0 && (Math.abs(e.clientX - m.sx) > 5 || Math.abs(e.clientY - m.sy) > 5)) m.drag = true;
  });

  window.addEventListener('mouseup', e => {
    const m = G.mouse;
    if (!m.down) return;
    m.down = false;
    if (e.button !== 0) return;
    if (!G.running || paused) { m.drag = false; return; }
    if (m.drag) { boxSelect(e.shiftKey); m.drag = false; return; }
    m.drag = false;
    leftClick(e);
  });

  /* 滚轮：滚屏 / 放置时旋转（暂不旋转） */
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    G.cam.x = clamp(G.cam.x + e.deltaX, camMinX(), camMaxX());
    G.cam.y = clamp(G.cam.y + e.deltaY, camMinY(), camMaxY());
  }, { passive: false });

  /* 键盘 */
  window.addEventListener('keydown', e => {
    if (e.key === 'F1') { e.preventDefault(); if (G.running) { paused = true; showHelpModal(); } return; }
    if (!G.running) return;
    const k = e.key.toLowerCase();

    if (k === 'escape') {
      if (!document.getElementById('modal').classList.contains('hidden')) { hideModal(); paused = false; return; }
      paused = !paused;
      if (paused) showPauseModal(); else hideModal();
      return;
    }
    if (k === 'p') { paused = !paused; if (paused) showPauseModal(); else hideModal(); return; }
    if (paused) return;

    if (k === 'm') { Sfx.enabled = !Sfx.enabled; msg(Sfx.enabled ? '音效开' : '音效关'); }
    if (k === 'b') { Sfx.bgmOn ? Sfx.stopBgm() : Sfx.startBgm(); msg(Sfx.bgmOn ? '音乐开' : '音乐关'); }

    if (k === 'x') holdX = true;
    if (k === 'z') holdZ = true;

    if (k === 'a' && !e.ctrlKey) { forceAtk = true; msg('攻击模式：点击目标或地面', ''); VIEW.cv.style.cursor = 'crosshair'; }
    if (k === 's') { stopSelected(); forceAtk = false; VIEW.cv.style.cursor = ''; }
    if (k === 'n') tryNuke();
    if (k === 'o') trySat();

    /* 编组 */
    if (e.ctrlKey && k >= '1' && k <= '9') { e.preventDefault(); assignGroup(+k); return; }
    if (k >= '1' && k <= '9' && !e.ctrlKey && !e.altKey) { selectGroup(+k); return; }

    /* 快捷建造：数字/字母键 = 图标 key */
    const tabKey = { 'f2': 'struct', 'f3': 'inf', 'f4': 'veh' }[k];
    if (tabKey) { setTab(tabKey); return; }
    tryHotkey(k);
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'x') holdX = false;
    if (k === 'z') holdZ = false;
    if (k === 'a' && forceAtk && !G.mouse.down) { /* 保持到点击 */ }
  });

  /* 建造栏 tab */
  document.querySelectorAll('.bb-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.getElementById('btnHelp').addEventListener('click', () => { if (G.running) { paused = true; showHelpModal(); } });
  document.getElementById('btnNuke').addEventListener('click', tryNuke);
  document.getElementById('btnSat').addEventListener('click', trySat);
  MM.cv.addEventListener('mousedown', e => {
    const r = MM.cv.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const wx = fx * MAP_W * TILE, wy = fy * MAP_H * TILE;
    if (e.button === 2) { G.cam.x = wx - VIEW.w / 2; G.cam.y = wy - VIEW.h / 2; }
    else {
      const before = { x: G.cam.x, y: G.cam.y };
      G.cam.x = wx - VIEW.w / 2; G.cam.y = wy - VIEW.h / 2;
      G.cam.x = clamp(G.cam.x, camMinX(), camMaxX());
      G.cam.y = clamp(G.cam.y, camMinY(), camMaxY());
      void before;
    }
  });
}

function setTab(tab) {
  UI.tab = tab;
  document.querySelectorAll('.bb-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  refreshBuildBar();
  Sfx.click();
}

function tryHotkey(k) {
  const defs = buildBtnDefs();
  const hit = defs.find(d => (d.def.key || '').toLowerCase() === k);
  if (!hit) return;
  if (UI.tab !== hit.def.tab) setTab(hit.def.tab);
  if (hit.def.tab === 'struct') {
    if (G.pendingPlace === hit.key) { startPlacing(hit.key); return; }
    startBuilding(0, hit.key);
  } else startUnit(0, hit.key);
  refreshBuildBar();
}

/* ---------------- 点击语义 ---------------- */
function worldPick(mx, my) {
  const wx = mx + G.cam.x, wy = my + G.cam.y;
  /* 单位（可见） */
  let best = null, bd = Infinity;
  for (const u of G.units) {
    if (u.dead) continue;
    if (u.p !== 0 && !canSee(u.tx, u.ty)) continue;
    const d = dist(wx, wy, u.x, u.y);
    if (d < Math.max(14, u.r + 6) && d < bd) { bd = d; best = u; }
  }
  if (best) return best;
  for (const b of G.blds) {
    if (b.dead) continue;
    if (b.p !== 0 && !canSee(b.tx, b.ty)) continue;
    if (wx >= b.x && wx <= b.x + b.def.w * TILE && wy >= b.y && wy <= b.y + b.def.h * TILE) return b;
  }
  /* 矿 */
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  const ore = G.ores.get(tx + ',' + ty);
  if (ore) return { kind: 'ore', ore, x: wx, y: wy };
  return null;
}

function leftClick(e) {
  Sfx.resume();
  const m = G.mouse;

  /* 核弹瞄准 */
  if (G.nukeAim) {
    if (canSee(Math.floor(m.wx / TILE), Math.floor(m.wy / TILE))) {
      launchNuke(m.wx, m.wy);
    } else { msg('该区域在迷雾中', 'warn'); Sfx.deny(); }
    G.nukeAim = false;
    VIEW.cv.style.cursor = '';
    return;
  }

  /* 放置建筑 */
  if (G.pendingPlace) {
    const key = G.pendingPlace;
    const def = BUILDINGS[key];
    const tx = Math.floor(m.wx / TILE), ty = Math.floor(m.wy / TILE);
    /* 吸附：靠近已有建筑时对齐 */
    const snapped = snapPlace(tx, ty, def);
    if (placeBuilding(0, key, snapped.x, snapped.y)) {
      G.pendingPlace = null;
      G.placing = null;
      refreshBuildBar();
      checkVictory();
    } else { Sfx.deny(); msg('无法在此处放置（红区）', 'warn'); }
    return;
  }

  const hit = worldPick(m.x, m.y);

  /* 修理/出售模式 */
  if (holdZ || holdX) {
    if (hit && hit.kind === 'bld' && hit.p === 0) {
      if (holdX) sellBld(hit);
      else repairBld(hit);
      return;
    }
  }

  /* 强制攻击 / 攻击移动 */
  if (forceAtk) {
    const tgt = hit && hit.kind !== 'ore' ? hit : null;
    const units = G.sel.filter(x => x.kind === 'unit' && !x.dead && x.p === 0);
    if (tgt && tgt.p !== 0 && units.length) {
      for (const u of units) {
        u.target = tgt; u.dest = null; u.path = null; u.hold = true; u.attackMove = false;
        if (u.def.special === 'cap' && tgt.kind === 'bld') { u.capTarget = tgt; u.dest = { x: tgt.cx, y: tgt.cy }; u.hold = false; }
      }
      Sfx.unitAck();
      spawnFloat(tgt.cx ?? tgt.x, (tgt.cy ?? tgt.y) - 10, '攻击!', '#ff6a58');
    } else if (units.length) {
      attackMoveTo(units, m.wx, m.wy);
    }
    forceAtk = false; VIEW.cv.style.cursor = '';
    return;
  }

  /* 选中 */
  if (hit && hit.kind !== 'ore') {
    if (e && e.shiftKey && hit.p === 0) {
      if (G.sel.includes(hit)) G.sel = G.sel.filter(x => x !== hit);
      else G.sel.push(hit);
    } else {
      G.sel = [hit];
    }
    Sfx.select();
    /* 集结点：选中生产建筑后点地面 */
    return;
  }

  /* 命令（有单位选中时） */
  const units = G.sel.filter(x => x.kind === 'unit' && !x.dead && x.p === 0);
  if (units.length) {
    issueCommand(units, hit, m.wx, m.wy, e && e.shiftKey);
    return;
  }

  if (!e || !e.shiftKey) G.sel = [];
}

/* A 攻击移动：目标点插旗，沿途交战 */
function attackMoveTo(units, wx, wy) {
  const spread = formationMove(units, wx, wy);
  units.forEach((u, i) => {
    if (u.def.special === 'harvest') return;
    u.dest = spread[i];
    u.target = null; u.hold = false; u.repathT = 0; u.stuckT = 0; u.retryN = 0;
    u.attackMove = true;
  });
  spawnMarker(wx, wy);
  Sfx.moveAck();
}

function rightClick() {
  const m = G.mouse;
  if (G.nukeAim) { G.nukeAim = false; VIEW.cv.style.cursor = ''; return; }
  if (G.pendingPlace) { G.pendingPlace = null; G.placing = null; refreshBuildBar(); Sfx.click(); return; }

  const hit = worldPick(m.x, m.y);
  const selB = G.sel.filter(x => x.kind === 'bld' && x.p === 0);
  const units = G.sel.filter(x => x.kind === 'unit' && !x.dead && x.p === 0);

  /* 生产建筑右键 = 集结点 */
  if (selB.length && (!hit || hit.p !== 0)) {
    for (const b of selB) {
      if (b.type === 'barracks' || b.type === 'factory' || b.type === 'refinery' || b.type === 'hq') {
        b.rally = { x: m.wx, y: m.wy };
        spawnFloat(m.wx, m.wy, '集结点', '#ffd166');
        Sfx.select();
      }
    }
    return;
  }

  if (!units.length) return;

  /* 攻击敌方 */
  if (hit && hit.kind !== 'ore' && hit.p !== undefined && hit.p !== 0) {
    for (const u of units) {
      u.target = hit; u.dest = null; u.path = null; u.hold = false;
      if (u.def.special === 'cap' && hit.kind === 'bld') { u.capTarget = hit; u.dest = { x: hit.cx, y: hit.cy }; }
    }
    Sfx.unitAck();
    spawnFloat(m.wx, m.wy, '攻击!', '#ff6a58');
    return;
  }
  /* 进矿 / 修理 */
  if (hit && hit.kind === 'ore') {
    for (const u of units) {
      if (u.def.special === 'harvest') {
        u.oreTarget = hit.ore; u.harvState = 'toOre';
        u.dest = { x: hit.ore.x * TILE + 16, y: hit.ore.y * TILE + 16 };
      } else {
        u.dest = { x: m.wx, y: m.wy };
      }
    }
    Sfx.moveAck();
    return;
  }
  /* 己方建筑：工程师修复 */
  if (hit && hit.kind === 'bld' && hit.p === 0) {
    let any = false;
    for (const u of units) {
      if (u.def.special === 'cap') { u.capTarget = hit; u.dest = { x: hit.cx, y: hit.cy }; u.capT = 0; any = true; }
    }
    if (any) { Sfx.moveAck(); return; }
  }

  /* 移动（攻击移动：路线上遇敌自动打） */
  const spread = formationMove(units, m.wx, m.wy);
  units.forEach((u, i) => {
    if (u.def.special === 'harvest') return;
    u.dest = spread[i];
    u.target = null; u.hold = false; u.repathT = 0; u.stuckT = 0;
  });
  spawnMarker(m.wx, m.wy);
  Sfx.moveAck();
}

function formationMove(units, wx, wy) {
  const out = [];
  const cols = Math.ceil(Math.sqrt(units.length));
  const gap = 26;
  units.forEach((u, i) => {
    const cx = (i % cols - (cols - 1) / 2) * gap;
    const cy = ((i / cols | 0) - (cols - 1) / 2) * gap;
    out.push({ x: wx + cx, y: wy + cy });
  });
  return out;
}

let marker = null;
function spawnMarker(x, y) { marker = { x, y, t: 0 }; }

function boxSelect(add) {
  const m = G.mouse;
  const x1 = Math.min(m.sx - 0, m.x) + G.cam.x, y1 = Math.min(m.sy, m.y) + G.cam.y;
  const x2 = Math.max(m.sx, m.x) + G.cam.x, y2 = Math.max(m.sy, m.y) + G.cam.y;
  const found = [];
  for (const u of G.units) {
    if (u.dead || u.p !== 0) continue;
    if (u.x >= x1 && u.x <= x2 && u.y >= y1 && u.y <= y2) found.push(u);
  }
  if (found.length) {
    if (add) G.sel = [...new Set([...G.sel, ...found])];
    else G.sel = found;
    Sfx.select();
  } else {
    /* 框到建筑也算 */
    const b = G.blds.find(b => !b.dead && b.p === 0 && b.cx >= x1 && b.cx <= x2 && b.cy >= y1 && b.cy <= y2);
    if (b) { G.sel = [b]; Sfx.select(); }
    else if (!add) G.sel = [];
  }
  updateSelBox();
}

function stopSelected() {
  for (const u of G.sel) {
    if (u.kind !== 'unit' || u.dead) continue;
    u.dest = null; u.path = null; u.target = null; u.hold = true; u.capTarget = null;
    u.attackMove = false;
    if (u.def.special === 'harvest') u.harvState = u.ore >= ORE_LOAD ? 'toRef' : 'idle';
  }
  Sfx.click();
}

function issueCommand(units, hit, wx, wy, add) {
  void add;
  const spread = formationMove(units, wx, wy);
  units.forEach((u, i) => {
    if (u.def.special === 'harvest') return;
    u.dest = spread[i];
    u.target = null; u.hold = false; u.repathT = 0; u.stuckT = 0; u.capTarget = null;
    u.retryN = 0;
    u.attackMove = false;
  });
  spawnMarker(wx, wy);
  Sfx.moveAck();
}

/* 编组 */
const GROUPS = {};
function assignGroup(n) {
  const sel = G.sel.filter(e => e.kind === 'unit' && !e.dead && e.p === 0);
  if (!sel.length) { msg('先选中单位再编组', 'warn'); return; }
  GROUPS[n] = sel.map(e => e.uid);
  msg(`已编入 ${n} 队（${sel.length} 个单位）`, 'good');
  Sfx.click();
}
function selectGroup(n) {
  const ids = GROUPS[n];
  if (!ids) return;
  const sel = G.units.filter(u => ids.includes(u.uid) && !u.dead);
  if (!sel.length) { msg(`${n} 队已全灭`, 'warn'); return; }
  G.sel = sel;
  /* 双击同类 → 跳视角 */
  const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length;
  const cy = sel.reduce((s, u) => s + u.y, 0) / sel.length;
  G.cam.x = clamp(cx - VIEW.w / 2, camMinX(), camMaxX());
  G.cam.y = clamp(cy - VIEW.h / 2, camMinY(), camMaxY());
  Sfx.select();
}

/* 放置吸附 */
function snapPlace(tx, ty, def) {
  if (!inMap(tx, ty)) return { x: tx, y: ty };
  const base = { x: tx, y: ty };
  const tryAt = (x, y) => canPlaceAtEx(x, y, def.w, def.h, 0, true);
  /* 1) 原位可放 → 直接用 */
  if (tryAt(tx, ty)) return base;
  /* 2) 优先贴靠既有建筑（美观成片） */
  for (const b of G.blds) {
    if (b.dead || b.p !== 0) continue;
    const right = b.tx + b.def.w;
    const bottom = b.ty + b.def.h;
    if (Math.abs(tx - right) <= 2 && ty >= b.ty - 1 && ty <= bottom - def.h + 1) {
      const nx = tx < right ? right : tx;
      if (tryAt(nx, ty)) return { x: nx, y: ty };
    }
    if (Math.abs((tx + def.w) - b.tx) <= 2 && ty >= b.ty - 1 && ty <= bottom - def.h + 1) {
      const nx = b.tx - def.w;
      if (tryAt(nx, ty)) return { x: nx, y: ty };
    }
    if (Math.abs(ty - bottom) <= 2 && tx >= b.tx - 1 && tx <= right - def.w + 1) {
      const ny = ty < bottom ? bottom : ty;
      if (tryAt(tx, ny)) return { x: tx, y: ny };
    }
    if (Math.abs((ty + def.h) - b.ty) <= 2 && tx >= b.tx - 1 && tx <= right - def.w + 1) {
      const ny = b.ty - def.h;
      if (tryAt(tx, ny)) return { x: tx, y: ny };
    }
  }
  /* 3) 兜底：就近找可放点（否则"造完没地方放"会卡死） */
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = tx + dx, ny = ty + dy;
      if (tryAt(nx, ny)) return { x: nx, y: ny };
    }
  }
  return base;
}

function startPlacing(key) {
  G.placing = key;
  msg('拖动 / 点击战场放置建筑（右键取消）', '');
}

/* 修理 / 出售 */
function repairBld(b) {
  if (b.hp >= b.maxhp) { msg('无需修理'); return; }
  const cost = Math.ceil((b.maxhp - b.hp) * 0.4);
  if (G.cash[0] < cost) { msg('修理资金不足', 'warn'); Sfx.deny(); return; }
  G.cash[0] -= cost;
  b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.15);
  spawnFloat(b.cx, b.cy, '修理 -$' + cost, '#7fb6ff');
  Sfx.buildOk();
}
function sellBld(b) {
  if (b.type === 'hq') { msg('建造场不可出售', 'warn'); Sfx.deny(); return; }
  const back = Math.floor(b.def.cost * 0.5);
  addCash(0, back);
  b.dead = true;
  refreshOcc(); recomputePower();
  spawnBurst(b.cx, b.cy, 16, '#ffd166', 1.6);
  Sfx.place();
  msg(`${b.def.cn} 已出售 +$${back}`, 'good');
  refreshBuildBar();
}

/* 特殊能力 */
function tryNuke() {
  if (!G.running || paused) return;
  if (G.nukeCd > 0) { msg(`核弹充能中 ${Math.ceil(G.nukeCd)}s`, 'warn'); Sfx.deny(); return; }
  const p = G.players[0];
  if (p.powerCap - p.powerUse < SPECIALS.nuke.reqPower) { msg('核弹需要 120 电力盈余', 'warn'); Sfx.deny(); return; }
  if (!hasBld(0, 'hq')) { msg('需要建造场', 'warn'); Sfx.deny(); return; }
  G.nukeAim = !G.nukeAim;
  VIEW.cv.style.cursor = G.nukeAim ? 'crosshair' : '';
  if (G.nukeAim) msg('核弹瞄准：左键投放，右键取消', 'warn');
  Sfx.click();
}
function launchNuke(wx, wy) {
  G.nukeCd = SPECIALS.nuke.cd;
  G.nukeAim = false;
  VIEW.cv.style.cursor = '';
  msg('警告：核弹发射！', 'warn');
  Sfx.alarm();
  const target = { x: wx, y: wy };
  /* 导弹飞行 */
  G.shots.push({ kind: 'nuke', x: target.x, y: target.y - 1400, tx: target.x, ty: target.y, t: 0, dur: 4.0, sx: target.x, sy: target.y - 1400 });
  const fly = G.shots[G.shots.length - 1];
  fly.srcEnt = { p: 0 };
  void fly;
}
function nukeImpact(x, y) {
  Sfx.nuke();
  G.shake = 26;
  splashDamage({ p: 0, dead: false }, x, y, 190, 600);
  spawnBurst(x, y, 60, '#ffe45e', 3.2);
  for (let i = 0; i < 40; i++) {
    const a = rand(0, 7), s = rand(60, 320);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 2.2), t: 0, color: pick(['#fff3c0', '#ffb04a', '#ff6a3a', '#ffe45e']), size: rand(4, 11), g: 30 });
  }
  for (let i = 0; i < 24; i++)
    G.parts.push({ x, y, vx: rand(-60, 60), vy: rand(-90, -10), life: rand(1.4, 3), t: 0, color: '#5a544a', size: rand(12, 28), g: -14, smoke: true });
  spawnDecal(x, y, 150, 'nuke');
  msg('核爆命中', 'good');
}
function trySat() {
  if (!G.running || paused) return;
  if (G.satCd > 0) { msg(`卫星充能中 ${Math.ceil(G.satCd)}s`, 'warn'); Sfx.deny(); return; }
  const p = G.players[0];
  if (p.powerCap - p.powerUse < SPECIALS.sat.reqPower) { msg('间谍卫星需要 80 电力盈余', 'warn'); Sfx.deny(); return; }
  if (!hasBld(0, 'hq')) { msg('需要建造场', 'warn'); Sfx.deny(); return; }
  G.satCd = SPECIALS.sat.cd;
  G.satT = 45;
  Sfx.sat();
  msg('间谍卫星上线：全图视野 45 秒', 'good');
}

/* ================================================================
 * 主循环
 * ================================================================ */
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.1) dt = 0.1;

  if (G.running && !paused) {
    const steps = 1;
    for (let i = 0; i < steps; i++) {
      G.t += dt;
      simTick(dt);
    }
    cameraScroll(dt);
    if (oreDirty) redrawOreLayer();
  }

  render(dt);
  if (G.running) {
    updateTopbar();
    updateSelBox();
    refreshBuildBarThrottle();
  }
}

let _bbT = 0;
function refreshBuildBarThrottle() {
  _bbT += 1;
  if (!G.running) return;
  if (_bbT % 12 === 0) refreshBuildBar();
}

function camMinX() { return Math.min(0, VIEW.w - MAP_W * TILE); }
function camMaxX() { return Math.max(0, MAP_W * TILE - VIEW.w); }
function camMinY() { return Math.min(0, VIEW.h - MAP_H * TILE); }
function camMaxY() { return Math.max(0, MAP_H * TILE - VIEW.h); }

function cameraScroll(dt) {
  const m = G.mouse;
  const edge = 26;
  const sp = 620 * dt;
  const inWin = m.x >= 0 && m.y >= 0 && m.x <= VIEW.w && m.y <= VIEW.h;
  if (inWin && !m.drag && !G.pendingPlace) {
    if (m.x < edge) G.cam.x -= sp;
    if (m.x > VIEW.w - edge) G.cam.x += sp;
    if (m.y < edge) G.cam.y -= sp;
    if (m.y > VIEW.h - edge) G.cam.y += sp;
  }
  /* 键盘 */
  const k = keysDown;
  if (k.has('arrowleft') || k.has('arrowup')) { }
  if (k.has('arrowleft')) G.cam.x -= sp * 1.2;
  if (k.has('arrowright')) G.cam.x += sp * 1.2;
  if (k.has('arrowup')) G.cam.y -= sp * 1.2;
  if (k.has('arrowdown')) G.cam.y += sp * 1.2;
  G.cam.x = clamp(G.cam.x, camMinX(), camMaxX());
  G.cam.y = clamp(G.cam.y, camMinY(), camMaxY());
}
const keysDown = new Set();
window.addEventListener('keydown', e => keysDown.add(e.key.toLowerCase()));
window.addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));

/* ================================================================
 * 渲染
 * ================================================================ */
function render(dt) {
  const c = VIEW.ctx;
  if (!c) return;
  c.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  c.fillStyle = '#0b1108';
  c.fillRect(0, 0, VIEW.w, VIEW.h);
  if (!TERRAIN.ready) return;

  /* 相机震动 */
  let ox = G.cam.x, oy = G.cam.y;
  if (G.shake > 0) {
    ox += rand(-G.shake, G.shake); oy += rand(-G.shake, G.shake);
    G.shake = Math.max(0, G.shake - dt * 40);
  }
  c.save();
  c.translate(-ox, -oy);

  /* 地形 */
  const vx0 = clamp(Math.floor(ox / TILE) - 1, 0, MAP_W);
  const vy0 = clamp(Math.floor(oy / TILE) - 1, 0, MAP_H);
  const vx1 = clamp(Math.ceil((ox + VIEW.w) / TILE) + 1, 0, MAP_W);
  const vy1 = clamp(Math.ceil((oy + VIEW.h) / TILE) + 1, 0, MAP_H);
  c.drawImage(TERRAIN.cv, 0, 0);
  void vx0; void vy0; void vx1; void vy1;

  /* 矿石 */
  if (ORECV) c.drawImage(ORECV, 0, 0);

  /* 残骸 */
  for (const d of G.decals) {
    const a = clamp(d.life / 40, 0, 1) * 0.5;
    c.globalAlpha = a;
    c.fillStyle = '#0a0806';
    c.beginPath();
    if (d.kind === 'nuke') { c.arc(d.x, d.y, d.r, 0, 7); }
    else { c.ellipse(d.x, d.y, d.r, d.r * 0.7, 0, 0, 7); }
    c.fill();
    c.globalAlpha = 1;
  }

  /* 建筑 */
  for (const b of G.blds) {
    if (b.dead) continue;
    if (b.p !== 0 && !canSee(b.tx, b.ty)) continue;
    drawBld(c, b);
  }

  /* 单位 */
  for (const u of G.units) {
    if (u.dead) continue;
    if (u.p !== 0 && !canSee(u.tx, u.ty)) continue;
    drawUnit(c, u);
  }

  /* 射线 / 投射物 */
  drawShots(c, dt);

  /* 粒子 */
  for (const p of G.parts) {
    const k = p.t / p.life;
    c.globalAlpha = clamp(1 - k, 0, 1) * (p.smoke ? 0.5 : 1);
    c.fillStyle = p.color;
    const sz = p.smoke ? p.size * (1 + k * 1.6) : p.size * (1 - k * 0.5);
    c.beginPath(); c.arc(p.x, p.y, Math.max(0.5, sz), 0, 7); c.fill();
  }
  c.globalAlpha = 1;

  /* 漂浮文字 */
  c.font = 'bold 14px Consolas, monospace';
  c.textAlign = 'center';
  for (const f of G.floats) {
    const k = f.t / f.life;
    c.globalAlpha = clamp(1 - k, 0, 1);
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fillText(f.text, f.x + 1, f.y + 1 - k * 26);
    c.fillStyle = f.color;
    c.fillText(f.text, f.x, f.y - k * 26);
  }
  c.globalAlpha = 1;

  /* 选中圈 */
  for (const e of G.sel) {
    if (e.dead) continue;
    c.strokeStyle = '#3ddc84';
    c.lineWidth = 1.6;
    if (e.kind === 'bld') {
      c.setLineDash([6, 5]);
      c.strokeRect(e.x + 2, e.y + 2, e.def.w * TILE - 4, e.def.h * TILE - 4);
      c.setLineDash([]);
      if (e.rally) {
        c.strokeStyle = 'rgba(255,210,102,.75)';
        c.setLineDash([5, 6]);
        c.beginPath(); c.moveTo(e.cx, e.cy); c.lineTo(e.rally.x, e.rally.y); c.stroke();
        c.setLineDash([]);
        c.beginPath(); c.arc(e.rally.x, e.rally.y, 9, 0, 7); c.stroke();
      }
    } else {
      const rx = e.r + 5;
      c.beginPath(); c.ellipse(e.x, e.y + (e.def.tab === 'inf' ? 6 : 4), rx, rx * 0.55, 0, 0, 7); c.stroke();
      if (e.veteran > 0) {
        c.fillStyle = '#ffd166';
        c.font = '11px Consolas';
        for (let i = 0; i < e.veteran; i++) c.fillText('★', e.x - 6 + i * 8, e.y - 14);
      }
    }
  }

  /* 血条 */
  drawHPBars(c);

  /* 放置幽灵 */
  if (G.pendingPlace) drawPlaceGhost(c);
  /* 核弹瞄准 */
  if (G.nukeAim) drawNukeAim(c);

  /* 命令标记 */
  if (marker) {
    const k = marker.t / 0.6;
    if (k < 1) {
      c.strokeStyle = `rgba(87,215,100,${1 - k})`;
      c.lineWidth = 2;
      const r = 6 + k * 22;
      c.beginPath(); c.arc(marker.x, marker.y, r, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(marker.x - 8, marker.y); c.lineTo(marker.x + 8, marker.y);
      c.moveTo(marker.x, marker.y - 8); c.lineTo(marker.x, marker.y + 8); c.stroke();
    } else marker = null;
  }

  c.restore();

  /* 战争迷雾（屏幕空间） */
  drawFog(c, ox, oy);

  /* 框选矩形 */
  const m = G.mouse;
  if (m.drag && m.down && m.downBtn === 0) {
    c.strokeStyle = '#3ddc84';
    c.lineWidth = 1.5;
    c.fillStyle = 'rgba(61,220,132,.10)';
    const x = Math.min(m.sx, m.x), y = Math.min(m.sy, m.y);
    const w = Math.abs(m.x - m.sx), h = Math.abs(m.y - m.sy);
    c.fillRect(x, y, w, h);
    c.strokeRect(x + .5, y + .5, w, h);
  }

  renderMinimap();
  void dt;
}

function drawBld(c, b) {
  const def = b.def;
  const x = b.x, y = b.y, w = def.w * TILE, h = def.h * TILE;
  const side = SIDE[b.p === 0 ? G.side : G.enemySide];
  const t = b.builtT > 0 ? 1 - b.builtT / 0.6 : 1;

  c.save();
  if (b.builtT > 0) {
    c.globalAlpha = 0.4 + t * 0.6;
    c.translate(b.cx, b.cy);
    c.scale(1.3 - t * 0.3, 1.3 - t * 0.3);
    c.translate(-b.cx, -b.cy);
  }

  /* 阴影 */
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.fillRect(x + 4, y + h - 2, w, 6);

  /* 底座 */
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#6a7460'); g.addColorStop(1, '#454e3c');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.strokeStyle = '#232a1c'; c.lineWidth = 2;
  c.strokeRect(x + 1, y + 1, w - 2, h - 2);

  /* 阵营色边 */
  c.fillStyle = side.color;
  c.fillRect(x, y, w, 4);
  c.fillRect(x, y + h - 4, w, 4);

  /* 特征细节 */
  const cx = b.cx, cy = b.cy;
  c.fillStyle = '#2e362a';
  if (b.type === 'hq') {
    c.fillRect(x + 8, y + 10, w - 16, h * 0.42);
    c.fillStyle = side.color;
    c.fillRect(x + w / 2 - 12, y + h * 0.55, 24, 16);
    /* 天线 */
    c.strokeStyle = '#c8c8b8'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + w - 10, y + 8); c.lineTo(x + w - 6, y - 12); c.stroke();
    c.fillStyle = '#ff4433';
    c.beginPath(); c.arc(x + w - 6, y - 14, 3 + Math.sin(G.t * 4) * 1.2, 0, 7); c.fill();
    c.fillStyle = '#ffd166'; c.fillRect(cx - 5, cy - 5, 10, 10);
  } else if (b.type === 'reactor' || b.type === 'apower') {
    const n = b.type === 'apower' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const px = x + w * (i + 1) / (n + 1);
      c.fillStyle = b.powOffline ? '#5a4a20' : '#ffe45e';
      c.beginPath(); c.arc(px, cy, 7, 0, 7); c.fill();
      c.strokeStyle = '#7a5c10'; c.lineWidth = 2; c.stroke();
      if (!b.powOffline) {
        c.globalAlpha = 0.3 + Math.sin(G.t * 6 + i) * 0.15;
        c.fillStyle = '#fff3c0';
        c.beginPath(); c.arc(px, cy, 10, 0, 7); c.fill();
        c.globalAlpha = 1;
      }
    }
  } else if (b.type === 'refinery') {
    c.fillStyle = '#3b2f18';
    c.fillRect(x + 6, y + 8, w * 0.45, h - 16);
    c.fillStyle = '#ffb400';
    c.fillRect(x + 8, y + 10, w * 0.45 - 4, 8);
    c.fillStyle = '#8a9a7c';
    c.fillRect(x + w * 0.58, y + 8, w * 0.34, h - 16);
    /* 传送带动画 */
    c.fillStyle = '#221a0c';
    c.fillRect(x + 6, y + h - 12, w - 12, 6);
    c.fillStyle = '#ffd166';
    const off = (G.t * 40) % 14;
    for (let i = 0; i < 5; i++) c.fillRect(x + 6 + i * 14 + off, y + h - 12, 5, 6);
  } else if (b.type === 'factory') {
    c.fillStyle = '#1c2616';
    c.fillRect(x + 6, y + h * 0.5, w - 12, h * 0.42);
    c.strokeStyle = side.color; c.lineWidth = 2;
    c.strokeRect(x + 6, y + h * 0.5, w - 12, h * 0.42);
    c.fillStyle = '#8a9a7c'; c.fillRect(x + 6, y + 6, w - 12, 10);
    /* 门开合 */
    if (b.producing) {
      c.fillStyle = '#0d1308';
      c.fillRect(x + 9, y + h * 0.53, w - 18, h * 0.3);
    }
  } else if (b.type === 'barracks') {
    c.fillStyle = '#2c3a24'; c.fillRect(x + 5, y + 6, w - 10, h * 0.35);
    c.fillStyle = side.color; c.fillRect(x + 5, y + h * 0.5, w - 10, 6);
    c.fillStyle = '#1c2616'; c.fillRect(cx - 7, y + h - 16, 14, 12);
    /* 训练中：小兵剪影 */
    if (b.producing) {
      c.fillStyle = '#c8c0a4';
      c.beginPath(); c.arc(cx + Math.sin(G.t * 3) * 8, y + h * 0.78, 4, 0, 7); c.fill();
    }
  } else if (b.type === 'defense') {
    c.fillStyle = '#6b6b58'; c.fillRect(x + 3, y + 3, w - 6, h - 6);
    c.fillStyle = '#2c2c22';
    c.beginPath(); c.arc(cx, cy, 11, 0, 7); c.fill();
    c.strokeStyle = '#101a0a'; c.lineWidth = 2; c.stroke();
    c.strokeStyle = '#8a8a70'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(b.barrel) * 20, cy + Math.sin(b.barrel) * 20); c.stroke();
  } else if (b.type === 'tesla') {
    c.fillStyle = '#2b3526'; c.beginPath(); c.arc(cx, cy, 12, 0, 7); c.fill();
    c.strokeStyle = '#101a0a'; c.lineWidth = 2; c.stroke();
    /* 线圈杆 */
    c.fillStyle = '#4a5742'; c.fillRect(cx - 3, cy - 26, 6, 26);
    if (!b.powOffline) {
      const gl = 0.5 + Math.sin(G.t * 8) * 0.3;
      c.strokeStyle = `rgba(126,232,255,${gl})`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - 8, cy - 6);
      c.lineTo(cx + rand(-4, 4), cy - 20);
      c.lineTo(cx + rand(-6, 6), cy - 30);
      c.stroke();
      c.fillStyle = `rgba(180,244,255,${gl + 0.2})`;
      c.beginPath(); c.arc(cx, cy - 30, 4, 0, 7); c.fill();
    }
  } else if (b.type === 'prism') {
    c.fillStyle = '#2b3526'; c.beginPath(); c.arc(cx, cy, 12, 0, 7); c.fill();
    c.strokeStyle = '#101a0a'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#4a5742'; c.fillRect(cx - 3, cy - 26, 6, 26);
    if (!b.powOffline) {
      const gl = 0.6 + Math.sin(G.t * 5) * 0.3;
      c.fillStyle = `rgba(200,235,255,${gl})`;
      c.beginPath();
      c.moveTo(cx, cy - 34); c.lineTo(cx + 8, cy - 22); c.lineTo(cx, cy - 16); c.lineTo(cx - 8, cy - 22);
      c.closePath(); c.fill();
      c.strokeStyle = `rgba(159,208,255,${gl})`; c.lineWidth = 1.5; c.stroke();
    }
  } else {
    c.fillStyle = '#2c3a24'; c.fillRect(x + 8, y + 8, w - 16, h - 16);
    c.strokeStyle = side.color; c.lineWidth = 2; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
  }

  /* 断电 / 生产进度 */
  if (b.powOffline && b.def.power < 0) {
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#ff5544';
    c.font = 'bold 10px Consolas';
    c.textAlign = 'center';
    c.fillText('NO POWER', cx, y + h + 11);
  }
  if (b.producing && b.producing.kind === 'bld' && b.producing.done) {
    c.fillStyle = 'rgba(120,255,140,.9)';
    c.font = 'bold 10px Consolas';
    c.textAlign = 'center';
    c.fillText('READY', cx, y - 5);
  }
  if (b.flash > 0) {
    c.fillStyle = `rgba(255,255,255,${b.flash * 4})`;
    c.fillRect(x, y, w, h);
  }
  c.restore();
}

function drawUnit(c, u) {
  const def = u.def;
  const side = SIDE[u.p === 0 ? G.side : G.enemySide];
  const inf = def.tab === 'inf';

  c.save();
  c.translate(u.x, u.y);

  /* 影子 */
  c.fillStyle = 'rgba(0,0,0,.32)';
  if (inf) { c.beginPath(); c.ellipse(2, 5, 7, 4, 0, 0, 7); c.fill(); }
  else { c.save(); c.rotate(u.angle); c.fillRect(-12 + 2, -9 + 3, 24, 18); c.restore(); }

  c.rotate(u.angle);

  if (inf) {
    /* 步兵：身体 */
    const walk = Math.sin(u.walk * 0.35) * 2;
    c.fillStyle = side.color;
    c.strokeStyle = '#0d1408'; c.lineWidth = 1.2;
    roundRect(c, -5, -4, 10, 9, 2.5); c.fill(); c.stroke();
    /* 头 */
    c.fillStyle = '#d8c9a8';
    c.beginPath(); c.arc(1, -1, 3.4, 0, 7); c.fill(); c.stroke();
    /* 枪 */
    c.strokeStyle = '#1a1a16'; c.lineWidth = 2;
    c.beginPath();
    if (def.special === 'rocket') { c.moveTo(-4, 2); c.lineTo(7, -3); c.lineWidth = 3.4; }
    else if (def.special === 'cap') { c.moveTo(3, 3); c.lineTo(8, 6); c.lineWidth = 2; }
    else { c.moveTo(2, 1); c.lineTo(9, 3); }
    c.stroke();
    if (def.special === 'cap') { c.fillStyle = '#ffd166'; c.fillRect(-3, 1, 5, 4); }
    /* 腿 */
    c.strokeStyle = side.colorDk; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-2, 5); c.lineTo(-2 + walk, 8); c.moveTo(2, 5); c.lineTo(2 - walk, 8); c.stroke();
  } else {
    /* 载具车体 */
    const w = def.hp > 600 ? 15 : 13, h = def.hp > 600 ? 11 : 9.5;
    if (def.special === 'harvest') {
      c.fillStyle = '#7a7057';
      roundRect(c, -w - 3, -h, (w + 3) * 2, h * 2, 3); c.fill();
      c.strokeStyle = '#0d1408'; c.lineWidth = 1.4; c.stroke();
      /* 矿仓发光 */
      const f = u.ore / ORE_LOAD;
      c.fillStyle = '#3b2f18'; c.fillRect(-w, -h + 3, 10, h * 2 - 6);
      c.fillStyle = G.side === 'soviet' ? '#e8b93a' : '#6fd8e8';
      c.fillRect(-w + 1, -h + 4, 8 * f, h * 2 - 8);
      c.fillStyle = '#4a4436'; c.fillRect(2, -h + 2, w - 4, h * 2 - 4);
    } else {
      c.fillStyle = side.colorDk;
      roundRect(c, -w, -h, w * 2, h * 2, 3); c.fill();
      c.strokeStyle = '#0d1408'; c.lineWidth = 1.4; c.stroke();
      /* 履带 */
      c.fillStyle = '#20261a';
      const roll = (u.walk * 0.6) % 4;
      c.fillRect(-w, -h - 3, w * 2, 3.5);
      c.fillRect(-w, h - 0.5, w * 2, 3.5);
      c.fillStyle = '#39432f';
      for (let i = -w + roll; i < w; i += 4) {
        c.fillRect(i, -h - 3, 2, 3.5);
        c.fillRect(i, h - 0.5, 2, 3.5);
      }
      /* 车体高光 */
      c.fillStyle = side.color;
      roundRect(c, -w + 2, -h + 2, w * 2 - 4, h * 2 - 4, 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.14)';
      c.fillRect(-w + 3, -h + 3, w * 2 - 6, 3);
    }
  }
  c.restore();

  /* 炮塔（独立旋转） */
  if (!inf && def.atk > 0) {
    c.save();
    c.translate(u.x, u.y);
    c.rotate(u.turret);
    c.fillStyle = '#39432f';
    c.strokeStyle = '#0d1408'; c.lineWidth = 1.3;
    c.beginPath(); c.arc(0, 0, def.artillery ? 6.5 : 5.5, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = '#232a1c'; c.lineWidth = def.artillery ? 4 : 3;
    const bl = def.artillery ? 16 : 13;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(bl, 0); c.stroke();
    if (def.artillery) { c.fillStyle = '#232a1c'; c.fillRect(bl - 4, -3.5, 6, 7); }
    if (u.veteran > 0) {
      c.fillStyle = '#ffd166';
      c.beginPath(); c.arc(-3, -4, 1.6 + u.veteran * 0.5, 0, 7); c.fill();
    }
    c.restore();
  }

  /* 受击闪白 */
  if (u.flash > 0) {
    c.globalAlpha = u.flash * 5;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(u.x, u.y, u.r + 4, 0, 7); c.fill();
    c.globalAlpha = 1;
  }
  /* 开火烟 */
  if (u.cool > (def.cool || 1) - 0.06 && u.def.atk > 0 && !inf) {
    c.fillStyle = 'rgba(255,230,150,.8)';
    const mx = u.x + Math.cos(u.turret) * (u.r + 7);
    const my = u.y + Math.sin(u.turret) * (u.r + 7);
    c.beginPath(); c.arc(mx, my, 4, 0, 7); c.fill();
  }
}

function drawHPBars(c) {
  const list = [...G.units, ...G.blds].filter(e => !e.dead);
  for (const e of list) {
    if (e.p !== 0 && !canSee(e.tx, e.ty)) continue;
    const r = e.hp / e.maxhp;
    if (r >= 0.999 && e.p === 0 && G.sel.includes(e) === false) continue;
    let x, y, w;
    if (e.kind === 'bld') { x = e.x + 2; y = e.y - 7; w = e.def.w * TILE - 4; }
    else { x = e.x - 12; y = e.y - e.r - 10; w = 24; }
    if (e.kind === 'bld' && r >= 0.999 && e.p === 0 && !G.sel.includes(e)) continue;
    c.fillStyle = 'rgba(0,0,0,.72)';
    c.fillRect(x - 1, y - 1, w + 2, 5);
    c.fillStyle = r < 0.3 ? '#ff4433' : r < 0.65 ? '#ffb400' : '#57d764';
    c.fillRect(x, y, w * clamp(r, 0, 1), 3);
  }
}

function drawShots(c, dt) {
  void dt;
  for (const s of G.shots) {
    if (s.kind === 'tracer') {
      const k = s.t / s.life;
      c.strokeStyle = `rgba(255,236,150,${1 - k})`;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    } else if (s.kind === 'beam') {
      const k = s.t / s.life;
      c.strokeStyle = `rgba(180,230,255,${1 - k})`;
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
      c.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.9})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    } else if (s.kind === 'tesla') {
      const k = s.t / s.life;
      c.strokeStyle = `rgba(126,232,255,${1 - k})`;
      c.lineWidth = 3;
      c.beginPath();
      const seg = 7;
      c.moveTo(s.x1, s.y1);
      for (let i = 1; i < seg; i++) {
        const t = i / seg;
        const px = s.x1 + (s.x2 - s.x1) * t + rand(-14, 14);
        const py = s.y1 + (s.y2 - s.y1) * t + rand(-14, 14);
        c.lineTo(px, py);
      }
      c.lineTo(s.x2, s.y2);
      c.stroke();
      c.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.8})`;
      c.lineWidth = 1;
      c.stroke();
    } else if (s.kind === 'proj') {
      const t = clamp(s.t / s.dur, 0, 1);
      const x = s.sx + (s.tx - s.sx) * t;
      const y = s.sy + (s.ty - s.sy) * t - Math.sin(t * Math.PI) * 34;
      c.fillStyle = '#ffd166';
      c.beginPath(); c.arc(x, y, 3.4, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,160,60,.6)';
      c.beginPath(); c.arc(x - (s.tx - s.sx) * 0.02, y - (s.ty - s.sy) * 0.02, 2.4, 0, 7); c.fill();
    } else if (s.kind === 'nuke') {
      const t = clamp(s.t / s.dur, 0, 1);
      const y = s.sy + (s.ty - s.sy) * t;
      c.save();
      c.fillStyle = '#c8c8c0';
      c.fillRect(s.sx - 4, y - 14, 8, 28);
      c.fillStyle = '#ff4433';
      c.fillRect(s.sx - 4, y + 8, 8, 6);
      c.fillStyle = `rgba(255,200,120,${0.7})`;
      c.beginPath(); c.arc(s.sx, y + 18, 7, 0, 7); c.fill();
      c.restore();
    }
  }
}

function drawFog(c, ox, oy) {
  const TS = TILE;
  for (let ty = Math.floor(oy / TS); ty <= Math.ceil((oy + VIEW.h) / TS); ty++) {
    if (ty < 0 || ty >= MAP_H) continue;
    for (let tx = Math.floor(ox / TS); tx <= Math.ceil((ox + VIEW.w) / TS); tx++) {
      if (tx < 0 || tx >= MAP_W) continue;
      const f = G.fog[tileIdx(tx, ty)];
      if (f === 2) continue;
      c.fillStyle = f === 0 ? 'rgba(3,6,3,.94)' : 'rgba(3,6,3,.5)';
      c.fillRect(tx * TS - ox, ty * TS - oy, TS + 1, TS + 1);
    }
  }
  /* 软边：可见格周边加深一档（廉价近似） */
}

function drawPlaceGhost(c) {
  const key = G.pendingPlace;
  const def = BUILDINGS[key];
  const m = G.mouse;
  const tx = Math.floor(m.wx / TILE), ty = Math.floor(m.wy / TILE);
  const snapped = snapPlace(tx, ty, def);
  const ok = canPlaceAt(snapped.x, snapped.y, def.w, def.h, 0);
  const x = snapped.x * TILE, y = snapped.y * TILE, w = def.w * TILE, h = def.h * TILE;
  c.fillStyle = ok ? 'rgba(87,215,100,.30)' : 'rgba(255,68,51,.32)';
  c.fillRect(x, y, w, h);
  c.strokeStyle = ok ? '#57d764' : '#ff4433';
  c.lineWidth = 2;
  c.strokeRect(x + 1, y + 1, w - 2, h - 2);
  /* 覆盖格高亮 */
  c.fillStyle = ok ? 'rgba(87,215,100,.18)' : 'rgba(255,68,51,.18)';
  for (let gy = snapped.y; gy < snapped.y + def.h; gy++)
    for (let gx = snapped.x; gx < snapped.x + def.w; gx++) {
      if (!inMap(gx, gy)) continue;
      if (!MAP.walk[tileIdx(gx, gy)] || MAP.occ[tileIdx(gx, gy)] !== -1) {
        c.fillStyle = 'rgba(255,68,51,.35)';
        c.fillRect(gx * TILE, gy * TILE, TILE, TILE);
      }
    }
}

function drawNukeAim(c) {
  const m = G.mouse;
  c.strokeStyle = '#ff4433';
  c.lineWidth = 1.5;
  c.beginPath(); c.arc(m.wx, m.wy, 190, 0, 7); c.stroke();
  c.setLineDash([8, 8]);
  c.beginPath(); c.moveTo(m.wx - 220, m.wy); c.lineTo(m.wx + 220, m.wy);
  c.moveTo(m.wx, m.wy - 220); c.lineTo(m.wx, m.wy + 220); c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(255,68,51,.10)';
  c.beginPath(); c.arc(m.wx, m.wy, 190, 0, 7); c.fill();
  c.fillStyle = '#ff6a58';
  c.font = 'bold 13px Consolas';
  c.textAlign = 'center';
  c.fillText('NUCLEAR STRIKE', m.wx, m.wy - 200);
}

/* ---------------- 小地图 ---------------- */
function renderMinimap() {
  const c = MM.ctx;
  if (!c) return;
  const S = MM.size;
  c.clearRect(0, 0, S, S);
  const sx = S / MAP_W, sy = S / MAP_H;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = tileIdx(x, y);
    const f = G.fog[i];
    if (f === 0) { c.fillStyle = '#04070a'; }
    else {
      const t = MAP.tiles[i];
      c.fillStyle = t === 4 ? '#16344a' : t === 3 ? '#333' : t >= 1 ? '#4c452e' : '#2c4423';
      if (f === 1) c.fillStyle = '#131a14';
    }
    c.fillRect(x * sx, y * sy, sx + .6, sy + .6);
  }
  /* 矿 */
  if (G.satT > 0 || true) {
    c.fillStyle = G.side === 'soviet' ? '#e8b93a' : '#6fd8e8';
    for (const o of G.ores.values()) {
      if (G.fog[tileIdx(o.x, o.y)] === 0) continue;
      c.fillRect(o.x * sx, o.y * sy, Math.max(1.5, sx), Math.max(1.5, sy));
    }
  }
  /* 建筑与单位 */
  for (const b of G.blds) {
    if (b.dead) continue;
    if (b.p !== 0 && G.fog[tileIdx(b.tx, b.ty)] !== 2 && G.satT <= 0) continue;
    c.fillStyle = b.p === 0 ? '#57d764' : '#ff4433';
    c.fillRect(b.tx * sx, b.ty * sy, Math.max(3, b.def.w * sx), Math.max(3, b.def.h * sy));
  }
  for (const u of G.units) {
    if (u.dead) continue;
    if (u.p !== 0 && G.fog[tileIdx(u.tx, u.ty)] !== 2 && G.satT <= 0) continue;
    c.fillStyle = u.p === 0 ? '#8bff9c' : '#ff8a7a';
    c.fillRect(u.tx * sx - 1, u.ty * sy - 1, 2.5, 2.5);
  }
  /* 视口 */
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = 1;
  c.strokeRect(G.cam.x / TILE * sx, G.cam.y / TILE * sy, VIEW.w / TILE * sx, VIEW.h / TILE * sy);
  /* 核弹标记 */
  if (G.nukeMark) {
    c.strokeStyle = '#ff4433';
    c.beginPath(); c.arc(G.nukeMark.x * sx, G.nukeMark.y * sy, 5, 0, 7); c.stroke();
  }
}

/* ================================================================
 * 特效推进
 * ================================================================ */
function updateShots(dt) {
  for (const s of G.shots) {
    s.t += dt;
    if (s.kind === 'proj' && s.t >= s.dur) {
      splashDamage(s.src || { p: 1, dead: false }, s.tx, s.ty, s.splash || 22, s.dmg);
      spawnBurst(s.tx, s.ty, 10, '#ffb04a', 1.4);
      Sfx.explode(0.7);
      s.done = true;
    }
    if (s.kind === 'nuke' && s.t >= s.dur) {
      nukeImpact(s.tx, s.ty);
      s.done = true;
    }
    if (s.life && s.t >= s.life) s.done = true;
  }
  G.shots = G.shots.filter(s => !s.done);
}
function updateParts(dt) {
  for (const p of G.parts) {
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.g || 0) * dt;
    p.vx *= 1 - dt * 1.4; p.vy *= 1 - dt * 0.6;
  }
  G.parts = G.parts.filter(p => p.t < p.life);
  for (const f of G.floats) f.t += dt;
  G.floats = G.floats.filter(f => f.t < f.life);
  for (const d of G.decals) d.life -= dt;
  G.decals = G.decals.filter(d => d.life > 0);
}

/* 击杀升级 */
(function veteranHook() {
  const origKill = killEnt;
  window.killEnt = function (e, by) {
    if (by && !by.dead && by.kind === 'unit' && e.p !== by.p) {
      by.kills = (by.kills || 0) + 1;
      if (by.kills >= 3 && by.veteran < 2) { by.veteran = 1; if (by.p === 0) spawnFloat(by.x, by.y, '★ 老兵', '#ffd166'); }
      if (by.kills >= 7 && by.veteran < 2) { by.veteran = 2; if (by.p === 0) spawnFloat(by.x, by.y, '★★ 精英', '#ffd166'); }
    }
    origKill(e, by);
  };
})();

/* 暂停菜单 */
function showPauseModal() {
  showModal(`
    <h1>暂停 · PAUSED</h1>
    <p class="lead">战场时间已冻结。</p>
    <div class="modal-actions">
      <button class="mbtn" id="pResume">继续作战</button>
      <button class="mbtn" id="pHelp">作战手册</button>
      <button class="mbtn danger" id="pQuit">放弃对局</button>
    </div>
  `, []);
  document.getElementById('pResume').onclick = () => { hideModal(); paused = false; };
  document.getElementById('pHelp').onclick = showHelpModal;
  document.getElementById('pQuit').onclick = () => { hideModal(); paused = false; G.running = false; Sfx.stopBgm(); showStartModal(); };
}
