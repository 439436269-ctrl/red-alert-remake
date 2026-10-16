import json, sys, time, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
OUT = pathlib.Path(r"D:\codes\red-alert-remake\_verify")
OUT.mkdir(exist_ok=True)

errors = []
logs = []

def run():
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
        except Exception as e1:
            logs.append("bundled chromium failed: " + repr(e1))
            try:
                browser = pw.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                                             args=["--autoplay-policy=no-user-gesture-required"])
            except Exception as e2:
                logs.append("chrome path failed: " + repr(e2))
                browser = pw.chromium.launch(headless=True, channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: (logs.append(f"{m.type}: {m.text}"), errors.append(m.text) if m.type == "error" else None))
        page.on("pageerror", lambda e: (errors.append(f"PAGEERROR: {e}"), logs.append("ERR-CTX: " + str(page.evaluate("() => (window.__errs && window.__errs[window.__errs.length-1]) || 'none'") if page else 'nopage'))))

        page.goto(URL, wait_until="load")
        page.evaluate("() => { window.addEventListener('error', ev => { window.__errs = window.__errs || []; window.__errs.push(String(ev.error && ev.error.stack || ev.message)); }); }")
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "01-boot.png"))

        # 任意键进入菜单
        page.keyboard.press("Space")
        page.wait_for_timeout(900)
        boot_state = page.evaluate("() => ({running: G.running, over: G.over, blds: G.blds.length, appHidden: document.getElementById('app').hidden, modal: !document.getElementById('modal').classList.contains('hidden')})")
        logs.append("BOOT: " + json.dumps(boot_state))
        page.screenshot(path=str(OUT / "02-menu.png"))

        # 选苏联 + 普通难度开始
        page.click('.side-card[data-side="soviet"]')
        page.click('#btnStart')
        page.wait_for_timeout(1500)
        st0 = page.evaluate("() => ({running: G.running, blds: G.blds.map(b=>b.type), units: G.units.length, pow: G.players[0], cash: G.cash[0], over: G.over, modal: document.getElementById('modal-body').innerHTML.slice(0,220)})")
        logs.append("AFTER-START: " + json.dumps(st0, ensure_ascii=False))
        page.screenshot(path=str(OUT / "03-game.png"))

        # 框选基地附近单位
        page.mouse.move(300, 300)
        page.mouse.down()
        page.mouse.move(900, 650, steps=8)
        page.mouse.up()
        page.wait_for_timeout(300)

        # 右键下命令到地图中部
        page.mouse.click(760, 430, button="right")
        page.wait_for_timeout(500)

        # 切到载具页点一个单位
        page.click('.bb-tab[data-tab="veh"]')
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "04-buildbar.png"))

        # 造一个建筑：回建筑页点反应堆
        page.click('.bb-tab[data-tab="struct"]')
        page.wait_for_timeout(200)
        page.click('.bbtn[data-key="reactor"]')
        page.wait_for_timeout(500)
        state = page.evaluate("() => ({order: G.buildOrder[0], cash: G.cash[0], units: G.units.length, blds: G.blds.length, t: G.t})")
        logs.append("STATE-A: " + json.dumps(state))

        # 等建造完成（6s）然后放置
        page.wait_for_timeout(7000)
        pend = page.evaluate("() => G.pendingPlace")
        logs.append("PENDING: " + str(pend))
        if pend:
            # 移动到基地右侧空地放置（多点几个候选位直到成功）
            placed = False
            for (px, py) in [(700, 300), (820, 340), (640, 520), (880, 520), (700, 620), (950, 640), (560, 640), (1000, 400)]:
                page.mouse.click(px, py)
                page.wait_for_timeout(350)
                if not page.evaluate("() => !!G.pendingPlace"):
                    placed = True
                    break
            logs.append("PLACED: " + str(placed))
        page.screenshot(path=str(OUT / "05-placed.png"))

        # 真实帧推进 20s（验证 rAF 主循环在跑），期间观察 AI 是否开工
        page.evaluate("() => { window.__probe = {samples: []}; }")
        t0 = page.evaluate("() => G.t")
        page.wait_for_timeout(10000)
        t1 = page.evaluate("() => G.t")
        logs.append(f"G.T ADVANCE 10s wall: {t1 - t0:.2f}")
        page.wait_for_timeout(10000)
        t2 = page.evaluate("() => G.t")
        logs.append(f"G.T ADVANCE 20s wall: {t2 - t0:.2f}")
        # 单独体检：为什么采矿车不动？
        diag = page.evaluate("""() => {
            const h = G.units.filter(u => u.def.special === 'harvest');
            return h.map(u => ({
                p: u.p, tx: u.tx, ty: u.ty,
                state: u.harvState, ore: Math.round(u.ore*10)/10,
                dest: u.dest ? [Math.round(u.dest.x), Math.round(u.dest.y)] : null,
                pathLen: u.path ? u.path.length : null, pathI: u.pathI,
                hasOreTarget: !!u.oreTarget,
                nearOre: (() => { let best=null, bd=1e9; for (const o of G.ores.values()) { const d=Math.abs(o.x-u.tx)+Math.abs(o.y-u.ty); if(d<bd){bd=d;best=o;} } return best ? [best.x, best.y, best.amount, bd] : null; })()
            }));
        }""")
        logs.append("HARV-DIAG-START: " + json.dumps(diag))

        ai_state = page.evaluate("""() => ({
            build1: G.buildOrder[1], q1: G.unitOrder[1].length,
            cash1: G.cash[1], blds1: G.blds.filter(b=>b.p===1).map(b=>b.type),
            units1: G.units.filter(u=>u.p===1).length,
            oreSize: G.ores.size,
            harv: G.units.filter(u=>u.def.special==='harvest').map(u=>[u.p, Math.round(u.ore), u.harvState])
        })""")
        logs.append("AI-FRAME: " + json.dumps(ai_state))
        diag2 = page.evaluate("""() => G.units.filter(u => u.def.special === 'harvest').map(u => ({
            p: u.p, state: u.harvState, ore: Math.round(u.ore*10)/10,
            dest: u.dest ? [Math.round(u.dest.x), Math.round(u.dest.y)] : null,
            pathLen: u.path ? u.path.length : null, pathI: u.pathI,
            hasOreTarget: !!u.oreTarget, stuck: Math.round(u.stuckT*10)/10,
            pos: [Math.round(u.x), Math.round(u.y)]
        }))""")
        logs.append("HARV-DIAG-20S: " + json.dumps(diag2))

        # 快进模拟：把时间推 60s，观察 AI 是否出兵、战斗是否发生
        page.evaluate("""() => {
            for (let i = 0; i < 60*10; i++) { G.t += 0.1; simTick(0.1); if (G.over) break; }
        }""")
        page.wait_for_timeout(500)
        # 压力测试后的基地补回：可能有重复建筑（同型只补一次）
        page.evaluate("""() => {
            const sp = MAP.spawns[0];
            const force = (key, tx, ty) => {
                if (hasBld(0, key)) return;
                if (!canPlaceAtEx(tx, ty, BUILDINGS[key].w, BUILDINGS[key].h, 0, false)) return;
                doPlaceBuilding(0, key, tx, ty, true);
            };
            force('hq', sp.tx, sp.ty);
            force('reactor', sp.tx + 5, sp.ty + 1);
            force('refinery', sp.tx + 1, sp.ty + 5);
            force('barracks', sp.tx + 5, sp.ty + 5);
            force('factory', sp.tx + 1, sp.ty - 4);
            G.aiPending = {0: null, 1: G.aiPending ? G.aiPending[1] : null};
            G.pendingPlace = null;
            G.buildOrder[0] = null;
        }""")
        state = page.evaluate("""() => ({
            t: Math.round(G.t),
            units0: G.units.filter(u=>u.p===0).length,
            units1: G.units.filter(u=>u.p===1).length,
            blds0: G.blds.filter(b=>b.p===0).length,
            blds1: G.blds.filter(b=>b.p===1).length,
            bldTypes0: G.blds.filter(b=>b.p===0).map(b=>b.type),
            shots: G.shots.length,
            cash0: G.cash[0], cash1: G.cash[1],
            pow0: G.players[0], aiQ: G.unitOrder[1].length,
            build1: G.buildOrder[1],
            kills0: G.stats[0].kills, kills1: G.stats[1].kills,
            over: G.over
        })""")
        logs.append("STATE-B: " + json.dumps(state))
        page.screenshot(path=str(OUT / "06-after60s.png"))

        # 自由对战：给玩家同步爆兵，双方各打 150s，看战局是否来回拉锯
        for_round = page.evaluate("""() => {
            const snap = () => ({
                t: Math.round(G.t),
                u0: G.units.filter(u=>u.p===0&&u.def.atk>0).length,
                u1: G.units.filter(u=>u.p===1&&u.def.atk>0).length,
                b0: G.blds.filter(b=>b.p===0).length, b1: G.blds.filter(b=>b.p===1).length,
                k0: G.stats[0].kills, k1: G.stats[1].kills, over: G.over
            });
            const before = snap();
            // 补回玩家基地（前面的无操作压测已把它打掉）
            const sp = MAP.spawns[0];
            const force = (key, tx, ty) => { if (hasBld(0, key)) return; if (!canPlaceAtEx(tx, ty, BUILDINGS[key].w, BUILDINGS[key].h, 0, false)) return; doPlaceBuilding(0, key, tx, ty, true); };
            force('hq', sp.tx, sp.ty); force('reactor', sp.tx + 5, sp.ty + 1); force('refinery', sp.tx + 1, sp.ty + 5);
            force('barracks', sp.tx + 5, sp.ty + 5); force('factory', sp.tx + 1, sp.ty - 4);
            G.aiPending = {0: null, 1: G.aiPending ? G.aiPending[1] : null};
            G.pendingPlace = null; G.buildOrder[0] = null;
            G.over = false; G.running = true;
            const trace = [];
            for (let i = 0; i < 150*10; i++) {
                if (G.over) break;
                G.t += 0.1;
                if (i % 300 === 0) trace.push({ t: Math.round(G.t), b0: G.blds.filter(b=>b.p===0).length, u0: G.units.filter(u=>u.p===0).length, u1: G.units.filter(u=>u.p===1).length, onMission: G.units.filter(u=>u.p===1&&u.onMission).length, wave: AI.wave, nextWave: Math.round(AI.nextWaveT) });
                if (i % 25 === 0) {
                    startUnit(0, 'gi'); startUnit(0, 'rocket');
                    if (Math.floor(G.t) % 15 === 0) startUnit(0, 'heavytank');
                    if (i % 250 === 0) {
                        G.sel = G.units.filter(u => u.p === 0 && u.def.atk > 0);
                        const en = MAP.spawns[1];
                        if (G.sel.length) attackMoveTo(G.sel, en.tx * TILE + (Math.random()*400-200), en.ty * TILE + (Math.random()*400-200));
                    }
                }
                simTick(0.1);
            }
            return { before, after: snap(), trace };
        }""")
        logs.append("SKIRMISH: " + json.dumps(for_round))
        for tk in for_round.get('trace', []):
            logs.append("TRACE: " + json.dumps(tk))
        page.screenshot(path=str(OUT / "07b-skirmish.png"))

        # AI 运营快照（历史阶段保留）
        ops = page.evaluate("""() => {
            const p = 1, has = t => hasBld(p, t);
            let want = null;
            if (!has('reactor')) want = 'reactor';
            else if (!has('refinery')) want = 'refinery';
            else if (!has('barracks')) want = 'barracks';
            else if (G.players[p].powerCap - G.players[p].powerUse < 40) want = 'apower';
            else if (!has('factory')) want = 'factory';
            const wdef = want ? BUILDINGS[want] : null;
            const choices = [];
            if (has('barracks')) choices.push(['gi', 3], ['rocket', 2]);
            if (has('factory') && has('refinery')) choices.push(['heavytank', 3], ['buggy', 2]);
            return {
                t: Math.round(G.t),
                cash: G.cash[p],
                buildOrder: G.buildOrder[p],
                q: G.unitOrder[p],
                want, wantCost: wdef ? wdef.cost : null, wantReq: wdef ? wdef.req : null,
                hasReq: wdef && wdef.req ? has(wdef.req) : null,
                power: G.players[p],
                choices: choices.length,
                offline: G.players[p].offline,
                harvs: G.units.filter(u => !u.dead && u.p === 1 && u.def.special === 'harvest').length,
                blds: G.blds.filter(b => b.p === 1).map(b => b.type)
            };
        }""")
        logs.append("AI-OPS: " + json.dumps(ops))

        # ==== 真实攻防推演：挂机玩家（只摆开局自带的建筑）vs AI ====
        war = page.evaluate("""() => {
            // 重置战场
            const out = { events: [] };
            startGame('soviet', 1);
            let firstStrike = null, firstWave = null;
            const kills = [];
            G.statsHook = (kind, victim, killer) => {
                if (victim.p !== 0) return;
                if (kills.length >= 14) return;
                const sp0 = MAP.spawns[0];
                const near = [];
                for (const u of G.units) {
                    if (u.dead || u.p !== 1) continue;
                    const d = dist(u.x, u.y, sp0.tx * TILE, sp0.ty * TILE);
                    if (d < 16 * TILE) near.push([u.key, Math.round(d), Math.round(u.x / TILE), Math.round(u.y / TILE)]);
                }
                kills.push({ t: Math.round(G.t), victim: victim.kind === 'bld' ? victim.type : victim.key,
                    killer: killer ? (killer.key || killer.type || '?') : 'dot',
                    nearEnemy: near.slice(0, 5),
                    onMission: G.units.filter(u => u.p === 1 && u.onMission).length });
            };
            let lastB0 = G.blds.filter(b=>b.p===0).length;
            for (let i = 0; i < 300*10; i++) {
                G.t += 0.1; simTick(0.1);
                if (!firstWave && G.units.some(u=>u.p===1&&u.onMission)) firstWave = Math.round(G.t);
                const b0 = G.blds.filter(b=>b.p===0).length;
                if (b0 < lastB0 && !firstStrike) firstStrike = { t: Math.round(G.t), from: lastB0, to: b0 };
                lastB0 = b0;
                if (i % 300 === 0) out.events.push({ t: Math.round(G.t), b0, u0: G.units.filter(u=>u.p===0).length,
                    u1: G.units.filter(u=>u.p===1&&u.def.atk>0).length, wave: AI.wave, nextWave: Math.round(AI.nextWaveT),
                    onMission: G.units.filter(u=>u.p===1&&u.onMission).length, over: G.over });
                if (G.over) { out.events.push({ t: Math.round(G.t), over: true }); break; }
            }
            out.firstWave = firstWave; out.firstStrike = firstStrike;
            out.kills = kills;
            G.statsHook = null;
            out.final = { b0: G.blds.filter(b=>b.p===0).length, b1: G.blds.filter(b=>b.p===1).length,
                k0: G.stats[0].kills, k1: G.stats[1].kills, over: G.over, t: Math.round(G.t) };
            return out;
        }""")
        logs.append("WAR: " + json.dumps(war))
        for ev in war.get('events', []):
            logs.append("WAR-EV: " + json.dumps(ev))
        page.screenshot(path=str(OUT / "09-war.png"))

        # ==== 玩家反击推演：AI 首波后来，玩家（正常运营节奏）爆兵反推 ====
        counter = page.evaluate("""() => {
            startGame('soviet', 1);
            let attackedAt = null, won = false;
            const snap = () => ({ t: Math.round(G.t), b0: G.blds.filter(b=>b.p===0).length, b1: G.blds.filter(b=>b.p===1).length,
                u0: G.units.filter(u=>u.p===0&&u.def.atk>0).length, u1: G.units.filter(u=>u.p===1&&u.def.atk>0).length,
                cash0: Math.round(G.cash[0]), q0: G.unitOrder[0].length, pow: G.players[0].powerUse + '/' + G.players[0].powerCap,
                k0: G.stats[0].kills, k1: G.stats[1].kills, over: G.over });
            const timeline = [];
            // 像真人一样：造完的房子会拖到基地旁放下
            const placePending = () => {
                if (!G.pendingPlace) return false;
                const key = G.pendingPlace, def = BUILDINGS[key];
                const sp = MAP.spawns[0];
                for (let r = 0; r < 14; r++) {
                    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        const tx = sp.tx + dx, ty = sp.ty + dy;
                        if (!canPlaceAtEx(tx, ty, def.w, def.h, 0, true)) continue;
                        if (placeBuilding(0, key, tx, ty)) { G.pendingPlace = null; return true; }
                    }
                }
                return false;
            };
            for (let i = 0; i < 420*10; i++) {
                if (G.over) { won = G.blds.filter(b=>b.p===1).length === 0 || !G.units.some(u=>u.p===1); break; }
                G.t += 0.1;
                placePending();
                if (i % 20 === 0) {
                    // 玩家正常运营：像真人一样——电力不够先补电站，然后建筑链，再爆兵
                    const p0 = G.players[0];
                    if (!G.buildOrder[0] && !G.pendingPlace) {
                        if (p0.powerCap - p0.powerUse < 35 && G.cash[0] >= BUILDINGS.reactor.cost) startBuilding(0, 'reactor');
                        else if (!hasBld(0, 'barracks') && G.cash[0] >= BUILDINGS.barracks.cost) startBuilding(0, 'barracks');
                        else if (!hasBld(0, 'factory') && G.cash[0] >= BUILDINGS.factory.cost) startBuilding(0, 'factory');
                        else if (G.blds.filter(b=>b.p===0&&b.type==='defense').length < 1 && G.cash[0] >= BUILDINGS.defense.cost + 400) startBuilding(0, 'defense');
                        else if (G.blds.filter(b=>b.p===0&&b.type==='defense').length < 3 && G.cash[0] >= BUILDINGS.defense.cost + 900) startBuilding(0, 'defense');
                        else if (hasBld(0, 'factory') && G.cash[0] > 1600) { startUnit(0, 'heavytank'); startUnit(0, 'gi'); }
                        else if (hasBld(0, 'barracks') && G.cash[0] > 1000) { startUnit(0, 'gi'); startUnit(0, 'gi'); startUnit(0, 'rocket'); }
                    }
                }
                if (i % 400 === 0) {
                    const myArmy = G.units.filter(u => u.p === 0 && u.def.atk > 0);
                    if (myArmy.length >= 10 && G.t > 90) {
                        attackedAt = attackedAt || Math.round(G.t);
                        G.sel = myArmy;
                        const en = MAP.spawns[1];
                        attackMoveTo(G.sel, en.tx * TILE + (Math.random()*300-150), en.ty * TILE + (Math.random()*300-150));
                    }
                }
                simTick(0.1);
                if (i % 600 === 0) timeline.push(snap());
            }
            timeline.push(snap());
            return { attackedAt, won, over: G.over, timeline };
        }""")
        logs.append("COUNTER: " + json.dumps(counter))
        for tk in counter.get('timeline', []):
            logs.append("COUNTER-TL: " + json.dumps(tk))
        page.screenshot(path=str(OUT / "10-counter.png"))

        # 胜利 / 失败弹窗核验
        end_modal = page.evaluate("""() => ({
            visible: !document.getElementById('modal').classList.contains('hidden'),
            text: document.getElementById('modal-body').innerText.slice(0, 120)
        })""")
        logs.append("END-MODAL: " + json.dumps(end_modal, ensure_ascii=False))

        # 手动收尾：回主菜单
        try:
            if page.is_visible('#btnAgain'):
                page.click('#btnAgain')
                page.wait_for_timeout(800)
            elif page.is_visible('#btnQuit'):
                pass
        except Exception:
            pass

        # ==== 帮助弹窗 / 静音 / 暂停 快速回归 ====
        if page.is_visible('#modal') and page.is_visible('#btnStart'):
            page.click('#btnStart')
            page.wait_for_timeout(600)
        page.keyboard.press("F1")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "11-help.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        page.keyboard.press("m")
        page.keyboard.press("b")
        page.wait_for_timeout(200)

        # 底部建造栏四页遍历（截图留证）
        for tab in ['struct', 'inf', 'veh']:
            page.click(f'.bb-tab[data-tab="{tab}"]')
            page.wait_for_timeout(250)
        page.screenshot(path=str(OUT / "12-buildbar.png"))

        # 核弹 / 卫星按钮状态（新局里先给足电力再试）
        nuke = page.evaluate("""() => {
            if (!G.running) return { skipped: true };
            // 造两座电站凑出 120 电力盈余
            const sp = MAP.spawns[0];
            const force = (key, tx, ty) => { if (hasBld(0, key)) return; if (!canPlaceAtEx(tx, ty, BUILDINGS[key].w, BUILDINGS[key].h, 0, false)) return; doPlaceBuilding(0, key, tx, ty, true); };
            force('apower', sp.tx + 6, sp.ty + 4);
            force('apower', sp.tx + 6, sp.ty + 7);
            G.nukeCd = 0; G.satCd = 0;
            tryNuke();
            const aim = G.nukeAim;
            if (aim) { launchNuke(MAP.spawns[1].tx * TILE, MAP.spawns[1].ty * TILE); }
            trySat();
            return { aim, nukeCd: Math.round(G.nukeCd), satT: Math.round(G.satT), power: G.players[0] };
        }""")
        logs.append("NUKE/SAT: " + json.dumps(nuke))
        # 直接推演核弹落地
        nuke_impact = page.evaluate("""() => {
            const b0 = G.blds.filter(b=>b.p===1).length;
            for (let i = 0; i < 60*10; i++) { G.t += 0.1; simTick(0.1); }
            return { from: b0, to: G.blds.filter(b=>b.p===1).length, shots: G.shots.length };
        }""")
        logs.append("NUKE-IMPACT: " + json.dumps(nuke_impact))
        page.screenshot(path=str(OUT / "13-nuke.png"))

        stacks = page.evaluate("() => (window.__errs || []).slice(0, 6)")
        for s in stacks:
            logs.append("WIN-STACK: " + str(s))

        browser.close()

try:
    run()
except Exception as e:
    errors.append("SCRIPT: " + repr(e))

print("=== LOGS ===")
for l in logs:
    print(l)
print("=== ERRORS ===")
for e in errors:
    print(e)
print("ERROR_COUNT:", len(errors))
