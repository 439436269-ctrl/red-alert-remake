/* ============================================================
 * RED ALERT · WEB REMAKE —— UI：建造栏 / 弹窗 / 提示 / 小地图 / 选择框
 * ============================================================ */
'use strict';

const UI = {
  tab: 'struct',
  tipEl: null,
};

/* ---------------- 建造栏 ---------------- */
function buildBtnDefs() {
  const side = G.side;
  const list = [];
  if (UI.tab === 'struct') {
    for (const k of Object.keys(BUILDINGS)) list.push({ key: k, def: BUILDINGS[k], kind: 'bld' });
  } else if (UI.tab === 'inf') {
    for (const k of Object.keys(UNITS)) if (UNITS[k].tab === 'inf') list.push({ key: k, def: UNITS[k], kind: 'unit' });
  } else {
    for (const k of Object.keys(UNITS)) if (UNITS[k].tab === 'veh') list.push({ key: k, def: UNITS[k], kind: 'unit' });
  }
  return list.filter(o => {
    if (o.kind === 'bld') {
      if (o.def.side && o.def.side !== side) return false;
      if (o.key === 'hq') return true;
      return true;
    }
    if (o.def.side !== 'any' && o.def.side !== side) return false;
    return true;
  });
}

function refreshBuildBar() {
  const box = document.getElementById('bbItems');
  if (!box) return;
  const defs = buildBtnDefs();
  box.innerHTML = '';
  for (const o of defs) {
    const b = document.createElement('button');
    b.className = 'bbtn';
    b.dataset.key = o.key;

    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 56;
    drawIcon(cv, o.kind, o.key);
    b.appendChild(cv);

    const key = document.createElement('span');
    key.className = 'bb-key'; key.textContent = o.def.key || '';
    b.appendChild(key);

    const nm = document.createElement('span');
    nm.className = 'bb-name'; nm.textContent = o.def.cn || o.def.name;
    b.appendChild(nm);

    const cost = document.createElement('span');
    cost.className = 'bb-cost'; cost.textContent = '$' + o.def.cost;
    b.appendChild(cost);

    const scrim = document.createElement('i'); scrim.className = 'bb-scrim';
    const prog = document.createElement('i'); prog.className = 'bb-progress';
    b.appendChild(prog);
    b.appendChild(scrim);

    /* 状态 */
    const st = getBuildState(o);
    if (st.disabled) b.classList.add('disabled'); else scrim.style.display = 'none';
    if (st.overlay) {
      const ov = document.createElement('i');
      ov.className = st.overlayCls;
      ov.textContent = st.overlay;
      b.appendChild(ov);
    }
    if (st.needPower) b.classList.add('needpower');
    if (st.sel) b.classList.add('sel');
    if (st.progress != null) prog.style.height = (st.progress * 100) + '%';

    b.addEventListener('click', onBuildClick);
    b.addEventListener('mouseenter', e => showTip(e, o));
    b.addEventListener('mousemove', moveTip);
    b.addEventListener('mouseleave', hideTip);
    box.appendChild(b);
  }
}

function getBuildState(o) {
  const s = { disabled: false, progress: null, overlay: null, overlayCls: 'bb-req', needPower: false, sel: false };
  if (!o.def) return s;          /* 兜底：无定义不崩 */
  const p = G.players[0];
  s.needPower = p.offline;
  if (o.kind === 'bld') {
    const def = o.def;
    if (def.key === 'hq' || def.solo === undefined) { /* noop */ }
    if (def.req && !hasBld(0, def.req)) {
      s.overlay = '需要\n' + BUILDINGS[def.req].cn; s.disabled = true; s.overlay = '需要先建：' + BUILDINGS[def.req].cn;
    } else if (def.solo && hasBld(0, o.key)) {
      s.overlay = '已建造'; s.disabled = true;
    } else if (def.side && def.side !== G.side) {
      s.overlay = '他阵营'; s.disabled = true;
    } else if (G.cash[0] < def.cost && !G.buildOrder[0]) {
      s.overlay = '资金不足'; s.disabled = true;
    } else if (G.buildOrder[0]) {
      if (G.buildOrder[0].key === o.key) {
        s.progress = G.buildOrder[0].t / G.buildOrder[0].dur;
        s.sel = true;
        if (s.progress >= 1) { s.overlay = '待放置'; s.overlayCls = 'bb-ready'; }
        else s.overlay = null;
      } else { s.overlay = '队列中'; s.disabled = true; }
    } else if (G.pendingPlace === o.key) {
      s.overlay = '待放置'; s.overlayCls = 'bb-ready'; s.sel = true;
    }
  } else {
    const def = o.def;
    if (def.req && !hasBld(0, def.req)) {
      s.overlay = '需要先建：' + BUILDINGS[def.req].cn; s.disabled = true;
    } else if (def.side !== 'any' && def.side !== G.side) {
      s.overlay = '他阵营'; s.disabled = true;
    } else if (G.cash[0] < def.cost) {
      s.overlay = '资金不足'; s.disabled = true;
    }
    const q = G.unitOrder[0];
    const mine = q.filter(i => i.key === o.key);
    const all = q.length;
    const firstIdx = q.findIndex(i => i.key === o.key);
    if (all && firstIdx === 0) {
      s.progress = q[0].t / q[0].dur;
      s.sel = true;
      if (mine.length > 1) s.overlay = '×' + mine.length;
      else s.overlay = null;
    } else if (mine.length > 0) {
      s.overlay = '队列中 ×' + mine.length;
    }
    if (!all) s.progress = null;
  }
  return s;
}

function onBuildClick(e) {
  const key = e.currentTarget.dataset.key;
  const tab = UI.tab;
  if (tab === 'struct') {
    const def = BUILDINGS[key];
    if (G.pendingPlace === key) { startPlacing(key); Sfx.click(); return; }
    if (G.buildOrder[0]) { Sfx.deny(); return; }
    startBuilding(0, key);
  } else {
    startUnit(0, key);
  }
  refreshBuildBar();
}

/* ---------------- 图标绘制 ---------------- */
function drawIcon(cv, kind, key) {
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const side = G.side || 'soviet';
  const col = SIDE[side].color, colDk = SIDE[side].colorDk;
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#4a5c3a'); grad.addColorStop(1, '#2a3620');
  c.fillStyle = grad; c.fillRect(0, 0, W, H);

  c.save();
  c.translate(W / 2, H / 2);
  const s = (kind === 'bld') ? 1.15 : 1.25;
  c.scale(s, s);

  if (kind === 'bld') {
    /* 建筑顶视简笔 */
    c.fillStyle = '#5d6b52'; c.strokeStyle = '#101a0a'; c.lineWidth = 1.4;
    if (key === 'hq') {
      roundRect(c, -18, -16, 36, 32, 3); c.fill(); c.stroke();
      c.fillStyle = col; roundRect(c, -12, -10, 24, 14, 2); c.fill();
      c.fillStyle = '#2c3a24'; c.fillRect(-14, 7, 28, 7);
      c.fillStyle = '#ffd166'; c.fillRect(-3, -3, 6, 6);
    } else if (key === 'reactor' || key === 'apower') {
      c.fillStyle = '#4a5742'; roundRect(c, -14, -14, 28, 28, 3); c.fill(); c.stroke();
      const n = key === 'apower' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        c.fillStyle = '#ffe45e';
        c.beginPath(); c.arc(-9 + i * 9, 0, 5, 0, 7); c.fill();
        c.strokeStyle = '#7a5c10'; c.stroke();
      }
    } else if (key === 'refinery') {
      c.fillStyle = '#5d6b52'; roundRect(c, -16, -13, 32, 26, 3); c.fill(); c.stroke();
      c.fillStyle = '#3b2f18'; c.fillRect(-12, -9, 14, 18);
      c.fillStyle = '#ffb400'; c.fillRect(-11, -8, 12, 4);
      c.fillStyle = '#8a9a7c'; roundRect(c, 4, -8, 11, 16, 2); c.fill();
    } else if (key === 'factory') {
      c.fillStyle = '#57634c'; roundRect(c, -17, -14, 34, 28, 3); c.fill(); c.stroke();
      c.fillStyle = '#1c2616'; c.fillRect(-13, 2, 26, 11);
      c.strokeStyle = col; c.lineWidth = 2; c.strokeRect(-13, 2, 26, 11);
      c.fillStyle = '#8a9a7c'; c.fillRect(-13, -10, 26, 5);
    } else if (key === 'barracks') {
      c.fillStyle = '#54614a'; roundRect(c, -13, -15, 26, 30, 3); c.fill(); c.stroke();
      c.fillStyle = '#2c3a24'; c.fillRect(-9, -10, 18, 9);
      c.fillStyle = col; c.fillRect(-9, 3, 18, 4);
      c.fillStyle = '#1c2616'; c.fillRect(-4, 9, 8, 6);
    } else if (key === 'defense') {
      c.fillStyle = '#6b6b58'; roundRect(c, -14, -14, 28, 28, 4); c.fill(); c.stroke();
      c.fillStyle = '#2c2c22'; c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill();
      c.strokeStyle = '#101a0a'; c.stroke();
      c.fillStyle = '#8a8a70'; c.fillRect(-3, -18, 6, 14);
    } else if (key === 'tesla') {
      c.fillStyle = '#4a5742'; roundRect(c, -13, -13, 26, 26, 3); c.fill(); c.stroke();
      c.fillStyle = '#2b3526'; c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill();
      c.strokeStyle = '#7ee8ff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-6, 4); c.lineTo(0, -8); c.lineTo(5, 2); c.lineTo(9, -5); c.stroke();
      c.fillStyle = '#9fe8ff'; c.beginPath(); c.arc(0, -2, 3, 0, 7); c.fill();
    } else if (key === 'prism') {
      c.fillStyle = '#4a5742'; roundRect(c, -13, -13, 26, 26, 3); c.fill(); c.stroke();
      c.fillStyle = '#2b3526'; c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill();
      c.strokeStyle = '#9fd0ff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(0, 12); c.moveTo(-12, 0); c.lineTo(12, 0); c.stroke();
      c.fillStyle = '#dff0ff'; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill();
    } else {
      c.fillStyle = '#5d6b52'; roundRect(c, -13, -13, 26, 26, 3); c.fill(); c.stroke();
      c.fillStyle = '#2c3a24'; c.fillRect(-8, -8, 16, 16);
    }
  } else {
    const def = UNITS[key];
    const inf = def.tab === 'inf';
    c.fillStyle = col; c.strokeStyle = '#0d1408'; c.lineWidth = 1.3;
    if (inf) {
      /* 步兵：头 + 肩 + 枪 */
      c.fillStyle = '#c8c0a4';
      c.beginPath(); c.arc(0, -7, 5, 0, 7); c.fill(); c.stroke();
      c.fillStyle = col;
      roundRect(c, -7, -1, 14, 13, 3); c.fill(); c.stroke();
      c.strokeStyle = '#222'; c.lineWidth = 2.4;
      c.beginPath();
      if (key === 'rocket') { c.moveTo(-8, 4); c.lineTo(9, -5); c.lineWidth = 4; }
      else if (key === 'engineer') { c.moveTo(3, 2); c.lineTo(10, 9); c.lineWidth = 2.4; }
      else { c.moveTo(-1, 2); c.lineTo(11, 6); }
      c.stroke();
      if (key === 'engineer') { c.fillStyle = '#ffd166'; c.fillRect(-2, 4, 6, 6); }
    } else if (key === 'harvester') {
      c.fillStyle = '#7a7057'; roundRect(c, -16, -11, 32, 22, 4); c.fill(); c.stroke();
      c.fillStyle = '#ffb400'; roundRect(c, -13, -8, 12, 16, 2); c.fill();
      c.fillStyle = '#3b2f18'; c.fillRect(1, -7, 13, 14);
      c.fillStyle = '#ffd166'; c.fillRect(3, -5, 9, 4);
    } else {
      /* 坦克顶视：车体 + 炮塔 + 炮管 */
      const w = def.hp > 600 ? 19 : 16, h = def.hp > 600 ? 14 : 12;
      c.fillStyle = colDk; roundRect(c, -w, -h, w * 2, h * 2, 3); c.fill(); c.stroke();
      c.fillStyle = col; roundRect(c, -w + 2, -h + 2, w * 2 - 4, h * 2 - 4, 2); c.fill();
      /* 履带 */
      c.fillStyle = '#20261a';
      c.fillRect(-w, -h - 3, w * 2, 4); c.fillRect(-w, h - 1, w * 2, 4);
      /* 炮塔 */
      c.fillStyle = '#39432f'; c.beginPath(); c.arc(0, 0, def.artillery ? 7 : 6, 0, 7); c.fill(); c.stroke();
      c.strokeStyle = '#1a2012'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(def.artillery ? 17 : 14, 0); c.stroke();
      if (def.artillery) { c.fillStyle = '#1a2012'; c.fillRect(12, -3, 6, 6); }
      if (key === 'ifv') { c.fillStyle = '#dff0ff'; c.fillRect(-6, -3, 4, 6); }
    }
  }
  c.restore();

  /* 阵营色角标 */
  c.fillStyle = SIDE[side].color;
  c.fillRect(0, H - 3, W, 3);
  void colDk;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------------- Tooltip ---------------- */
function showTip(e, o) {
  const t = document.getElementById('tip');
  const d = o.def;
  const reqTxt = d.req ? `\n前置：${BUILDINGS[d.req].cn}` : '';
  const stat = o.kind === 'unit'
    ? `生命 ${d.hp} · 伤害 ${d.atk} · 射程 ${d.range}\n造价 $${d.cost} · 生产 ${d.build}s${reqTxt}`
    : `生命 ${d.hp} · 电力 ${d.power > 0 ? '+' : ''}${d.power}\n造价 $${d.cost} · 建造 ${d.build}s${reqTxt}`;
  t.innerHTML = `<b>${d.cn || d.name}</b><br><span class="t-cost">$${d.cost}</span><br>${d.desc}<br><span style="color:#7f9a72;font-family:var(--mono);font-size:11.5px;white-space:pre-line">${stat}</span>`;
  t.classList.remove('hidden');
  moveTip(e);
}
function moveTip(e) {
  const t = document.getElementById('tip');
  const x = Math.min(window.innerWidth - 320, e.clientX + 16);
  const y = Math.min(window.innerHeight - 160, e.clientY + 16);
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function hideTip() { document.getElementById('tip').classList.add('hidden'); }

/* ---------------- 顶部信息 ---------------- */
function updateTopbar() {
  if (!G.running) return;
  const m = document.getElementById('money');
  if (m) m.textContent = Math.floor(G.cash[0]);
  document.querySelector('.tb-money').classList.toggle('low', G.cash[0] < 300);
  const p = G.players[0];
  const use = p.powerUse, cap = p.powerCap;
  const useEl = document.getElementById('pwUse'), capEl = document.getElementById('pwCap');
  const ratio = cap > 0 ? use / cap : (use > 0 ? 1 : 0);
  if (useEl) useEl.style.width = Math.min(100, ratio * 100) + '%';
  if (capEl) { capEl.style.width = Math.min(100, (cap / Math.max(cap, use, 1)) * 100) + '%'; capEl.classList.toggle('warn', use > cap); }
  const num = document.getElementById('pwNum');
  if (num) num.textContent = `${use}/${cap}`;
  const clock = document.getElementById('clock');
  if (clock) {
    const s = Math.floor(G.t);
    clock.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  const side = document.getElementById('sideName');
  if (side) {
    side.textContent = SIDE[G.side].name + ' · ' + SIDE[G.side].cn;
    side.classList.toggle('allied', G.side === 'allied');
  }
  /* 雷达离线 */
  const off = document.getElementById('radarOff');
  if (off) off.classList.toggle('hidden', !p.offline && G.satT <= 999);
  /* 特殊能力 */
  const nb = document.getElementById('btnNuke'), sb = document.getElementById('btnSat');
  const spN = SPECIALS.nuke, spS = SPECIALS.sat;
  const pwrN = p.powerCap - p.powerUse;
  if (nb) {
    const ok = hasBld(0, 'hq') && pwrN >= spN.reqPower;
    nb.disabled = !ok || G.nukeCd > 0;
    document.getElementById('nukeCd').textContent = G.nukeCd > 0 ? Math.ceil(G.nukeCd) + 's' : '';
    nb.classList.toggle('ready', ok && G.nukeCd <= 0 && !G.nukeAim);
    nb.classList.toggle('aiming', G.nukeAim);
  }
  if (sb) {
    const ok = hasBld(0, 'hq') && pwrN >= spS.reqPower;
    sb.disabled = !ok || G.satCd > 0;
    document.getElementById('satCd').textContent = G.satCd > 0 ? Math.ceil(G.satCd) + 's' : '';
    sb.classList.toggle('ready', ok && G.satCd <= 0);
  }
}

/* ---------------- 选中信息框 ---------------- */
function updateSelBox() {
  const box = document.getElementById('selbox-info');
  const sel = G.sel.filter(e => !e.dead);
  G.sel = sel;
  if (!G.running) { box.classList.add('hidden'); return; }
  if (!sel.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const title = document.getElementById('selbox-title');
  const hpBar = document.getElementById('selbox-hp').firstElementChild;
  const sub = document.getElementById('selbox-sub');

  if (sel.length === 1) {
    const e = sel[0];
    const def = e.def;
    title.textContent = `${def.cn || def.name}${e.veteran ? ' ★'.repeat(e.veteran) : ''}`;
    const r = e.hp / e.maxhp;
    hpBar.style.width = (r * 100) + '%';
    hpBar.className = r < 0.3 ? 'low' : r < 0.65 ? 'mid' : '';
    let s = `HP ${Math.max(0, Math.ceil(e.hp))} / ${e.maxhp}`;
    if (e.kind === 'unit') {
      if (e.def.special === 'harvest') s += `\n载矿 ${Math.round(e.ore)}/${ORE_LOAD} 块`;
      else if (e.def.atk > 0) s += `\n伤害 ${Math.round(e.dmg)} · 射程 ${e.def.range} · 速度 ${e.def.speed}`;
      else if (e.def.special === 'cap') s += `\n进入敌方建筑实施占领`;
      if (e.dest) s += `\n状态：移动中`;
      else if (e.target) s += `\n状态：交战`;
      else if (e.def.special === 'harvest') s += `\n状态：${{idle:'待命', toOre:'采矿中', toRef:'返航卸矿'}[e.harvState] || '作业中'}`;
      else s += `\n状态：待命`;
    } else {
      if (e.producing) s += `\n生产中：${(e.producing.kind === 'bld' ? BUILDINGS[e.producing.key] : UNITS[e.producing.key]).cn}${e.producing.done ? '（待放置）' : ' ' + Math.round(e.producing.t / e.producing.dur * 100) + '%'}`;
      if (e.rally) s += `\n集结点已设置`;
      if (e.powOffline) s += `\n⚠ 电力不足，已停机`;
    }
    sub.textContent = s;
  } else {
    title.textContent = `已选中 ${sel.length} 个单位`;
    const totalHp = sel.reduce((s, e) => s + Math.max(0, e.hp), 0);
    const totalMax = sel.reduce((s, e) => s + e.maxhp, 0);
    const r = totalMax ? totalHp / totalMax : 0;
    hpBar.style.width = (r * 100) + '%';
    hpBar.className = r < 0.3 ? 'low' : r < 0.65 ? 'mid' : '';
    const counts = {};
    for (const e of sel) { const n = e.def.cn || e.def.name; counts[n] = (counts[n] || 0) + 1; }
    sub.textContent = Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join('　');
  }
}

/* ---------------- 模态框 ---------------- */
function showModal(html, actions) {
  const m = document.getElementById('modal');
  document.getElementById('modal-body').innerHTML = html;
  const ab = document.getElementById('modal-actions');
  ab.innerHTML = '';
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.className = 'mbtn' + (a.cls ? ' ' + a.cls : '');
    b.textContent = a.label;
    b.addEventListener('click', a.fn);
    ab.appendChild(b);
  }
  m.classList.remove('hidden');
}
function hideModal() { document.getElementById('modal').classList.add('hidden'); }

function showHelpModal() {
  const rows = [
    ['移动 / 攻击', '左键点地面移动，点敌军攻击，框选单位'],
    ['选中', '左键点单位/建筑；<kbd>Ctrl+1~9</kbd> 编组，<kbd>1~9</kbd> 选组'],
    ['多选', '<kbd>Shift</kbd>+点 追加；框选多个单位'],
    ['强制攻击', '<kbd>A</kbd> 后点地面（攻击移动）'],
    ['停止', '<kbd>S</kbd>'],
    ['编队集结', '选中兵营/战车工厂后右键设集结点'],
    ['建造', '底部栏点建筑 → 拖到战场 → 左键放置'],
    ['出售', '按住 <kbd>X</kbd> 点己方建筑（返还 50%）'],
    ['修理', '按住 <kbd>Z</kbd> 点己方建筑（消耗资金）'],
    ['特殊能力', '<kbd>N</kbd> 核弹瞄准 · <kbd>O</kbd> 间谍卫星'],
    ['视角', '边缘滚动 / <kbd>方向键</kbd> / 小地图点击 / <kbd>滚轮</kbd>'],
    ['暂停', '<kbd>Esc</kbd> 暂停菜单 · <kbd>P</kbd> 暂停'],
    ['音量', '<kbd>M</kbd> 静音 · <kbd>B</kbd> 音乐开关'],
  ];
  showModal(`
    <h1>作战手册</h1>
    <p class="lead">在限定战场上消灭敌方全部建筑与单位即可获胜。电力不足时生产与防御全部停摆。</p>
    <div class="twocol">
      <div>${rows.slice(0, Math.ceil(rows.length / 2)).map(r => `<div class="stat-row"><span>${r[0]}</span><b style="max-width:60%;text-align:right;font-weight:400">${r[1]}</b></div>`).join('')}</div>
      <div>${rows.slice(Math.ceil(rows.length / 2)).map(r => `<div class="stat-row"><span>${r[0]}</span><b style="max-width:60%;text-align:right;font-weight:400">${r[1]}</b></div>`).join('')}</div>
    </div>
    <h2>阵营特色</h2>
    <p><span style="color:#ff6a58">■ 苏联</span>：动员兵更便宜、犀牛坦克更硬、磁暴线圈对装甲杀伤高、V3 火箭车远程拆家。<br>
       <span style="color:#7fb6ff">■ 盟军</span>：大兵射程更长、灰熊坦克更快、光棱塔射程占优、多功能步兵车放风筝。</p>
    <p class="fine">本作为原创代码与美术的非官方致敬作品，不含任何原作资源，与 Electronic Arts / Westwood Studios 无关。</p>
  `, [{ label: '返回战场', cls: 'primary', fn: hideModal }]);
}

function showStartModal() {
  const h = location.hash.replace('#', '');
  const preset = ['soviet', 'allied'].includes(h) ? h : null;
  const body = `
    <h1>红色警戒 · 网页重制版</h1>
    <p class="lead" style="font-family:var(--mono);letter-spacing:.18em;color:#d9a441">RED ALERT · WEB REMAKE — UNOFFICIAL FAN WORK</p>
    <p>选择你的阵营，然后在 72×72 的战场上击溃对方。左上是你的基地，右上（敌方）会在数十秒后开始出兵——抓紧发展经济与防御。</p>
    <div class="twocol" style="margin-top:16px">
      <div class="side-card soviet" data-side="soviet">
        <h3>SOVIET · 苏联</h3>
        <div class="sc-sub">红色钢铁 · 正面碾压</div>
        <p>■ 动员兵 $200，爆兵更快</p>
        <p>■ 犀牛坦克 700 HP 装甲厚</p>
        <p>■ 磁暴线圈克装甲，V3 火箭远程拆家</p>
        <div class="sc-pick">▶ 点击选择</div>
      </div>
      <div class="side-card allied" data-side="allied">
        <h3>ALLIED · 盟军</h3>
        <div class="sc-sub">蓝色科技 · 机动控场</div>
        <p>■ 美国大兵射程更长</p>
        <p>■ 灰熊坦克速度 76，守护者射程占优</p>
        <p>■ 光棱塔射程远、多功能步兵车高射速</p>
        <div class="sc-pick">▶ 点击选择</div>
      </div>
    </div>
    <div style="margin-top:18px">
      <div class="stat-row"><span>难度</span><b id="diffPick">普通</b></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="mbtn" data-diff="0">简单</button>
        <button class="mbtn primary" data-diff="1">普通</button>
        <button class="mbtn" data-diff="2">困难</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="mbtn" id="btnHelp2">作战手册 (F1)</button>
      <button class="mbtn primary" id="btnStart">开始作战</button>
    </div>
    <p class="fine">原创引擎 · 原创美术 · 程序合成音效，零素材。本作品为粉丝致敬向非官方作品，与 EA / Westwood 无关；"红警/红色警戒"仅为描述性称呼。</p>
  `;
  showModal(body, []);
  let side = preset || 'soviet';
  let diff = 1;
  const mark = () => {
    document.querySelectorAll('.side-card').forEach(el => el.style.borderColor = el.dataset.side === side ? 'var(--amber)' : '');
    document.getElementById('diffPick').textContent = ['简单', '普通', '困难'][diff];
  };
  document.querySelectorAll('.side-card').forEach(el => el.addEventListener('click', () => { side = el.dataset.side; mark(); Sfx.select(); }));
  document.querySelectorAll('[data-diff]').forEach(el => el.addEventListener('click', () => {
    diff = +el.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('primary', +x.dataset.diff === diff));
    mark(); Sfx.click();
  }));
  document.getElementById('btnHelp2').addEventListener('click', showHelpModal);
  document.getElementById('btnStart').addEventListener('click', () => { hideModal(); startGame(side, diff); });
  mark();
}

function showEndModal(win) {
  const s0 = G.stats[0], s1 = G.stats[1];
  const mins = Math.floor(G.t / 60), secs = Math.floor(G.t % 60);
  showModal(`
    <h1 class="end-title ${win ? 'win' : 'lose'}">${win ? '任务完成 · MISSION ACCOMPLISHED' : '任务失败 · MISSION FAILED'}</h1>
    <p class="lead">${win ? '敌方残部已被肃清，战场归于寂静。' : '我方阵地已全面失守。'}</p>
    <div class="stat-row"><span>对局时长</span><b>${mins}分${String(secs).padStart(2, '0')}秒</b></div>
    <div class="stat-row"><span>我方生产单位</span><b>${s0.built}</b></div>
    <div class="stat-row"><span>我方损失</span><b>${s0.lost}</b></div>
    <div class="stat-row"><span>歼灭敌军</span><b>${s0.kills}</b></div>
    <div class="stat-row"><span>累计收入</span><b>$${s0.earned}</b></div>
    <div class="stat-row"><span>敌方歼灭数</span><b>${s1.kills}</b></div>
    <div class="modal-actions">
      <button class="mbtn" id="btnAgainS">再战 · 苏联</button>
      <button class="mbtn primary" id="btnAgain">重新开始</button>
    </div>
    <p class="fine">原创引擎致敬作品 · 与 EA / Westwood 无关。</p>
  `, []);
  document.getElementById('btnAgain').addEventListener('click', () => { hideModal(); startGame(G.side, AI.diff); });
  document.getElementById('btnAgainS').addEventListener('click', () => { hideModal(); startGame(G.side === 'soviet' ? 'allied' : 'soviet', AI.diff); });
}
