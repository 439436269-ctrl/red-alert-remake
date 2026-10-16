import json
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    p = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto("http://127.0.0.1:8765/index.html", wait_until="load")
    p.wait_for_timeout(400)
    p.keyboard.press("Space"); p.wait_for_timeout(600)
    p.click('.side-card[data-side="allied"]'); p.click('#btnStart'); p.wait_for_timeout(800)

    # 玩家主动打赢：给足资源、爆兵、推平敌方
    res = p.evaluate("""() => {
        const log = [];
        const placePending = () => {
            if (!G.pendingPlace) return;
            const key = G.pendingPlace, def = BUILDINGS[key], sp = MAP.spawns[0];
            for (let r = 0; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const tx = sp.tx + dx, ty = sp.ty + dy;
                if (!canPlaceAtEx(tx, ty, def.w, def.h, 0, true)) continue;
                if (placeBuilding(0, key, tx, ty)) { G.pendingPlace = null; return; }
            }
        };
        for (let i = 0; i < 600*10; i++) {
            if (G.over) break;
            G.t += 0.1;
            placePending();
            if (i % 20 === 0) {
                const p0 = G.players[0];
                if (!G.buildOrder[0] && !G.pendingPlace) {
                    if (p0.powerCap - p0.powerUse < 35 && G.cash[0] >= BUILDINGS.reactor.cost) startBuilding(0, 'reactor');
                    else if (!hasBld(0, 'barracks') && G.cash[0] >= BUILDINGS.barracks.cost) startBuilding(0, 'barracks');
                    else if (!hasBld(0, 'factory') && G.cash[0] >= BUILDINGS.factory.cost) startBuilding(0, 'factory');
                    else if (!hasBld(0, 'prism') && G.cash[0] >= BUILDINGS.prism.cost + 300) startBuilding(0, 'prism');
                    else if (G.blds.filter(b=>b.p===0&&b.type==='prism').length < 3 && G.cash[0] >= BUILDINGS.prism.cost + 900) startBuilding(0, 'prism');
                    else if (G.units.filter(u=>u.p===0&&u.def.special==='harvest').length < 3 && G.cash[0] >= 2200) startUnit(0, 'harvester');
                    else if (hasBld(0, 'factory') && G.cash[0] > 2600) { startUnit(0, 'mastiff'); startUnit(0, 'conscript'); startUnit(0, 'conscript'); }
                    else if (hasBld(0, 'barracks') && G.cash[0] > 1600) { startUnit(0, 'conscript'); startUnit(0, 'rocket'); }
                }
            }
            // 攒够 12 人就全军压上（并且持续补兵）
            if (i % 300 === 0) {
                const army = G.units.filter(u => u.p === 0 && u.def.atk > 0);
                if (army.length >= 12) {
                    G.sel = army;
                    const en = MAP.spawns[1];
                    attackMoveTo(G.sel, en.tx * TILE, en.ty * TILE);
                }
            }
            simTick(0.1);
            if (i % 600 === 0) log.push({ t: Math.round(G.t), k0: G.stats[0].kills, k1: G.stats[1].kills,
                b1: G.blds.filter(b=>b.p===1).length, u0: G.units.filter(u=>u.p===0&&u.def.atk>0).length,
                u1: G.units.filter(u=>u.p===1&&u.def.atk>0).length, cash0: Math.round(G.cash[0]) });
        }
        return { over: G.over, log,
            modalVisible: !document.getElementById('modal').classList.contains('hidden'),
            modalText: document.getElementById('modal-body').innerText.slice(0, 60),
            enemyLeft: G.blds.filter(b=>b.p===1).length + G.units.filter(u=>u.p===1).length };
    }""")
    print(json.dumps(res, ensure_ascii=False, indent=1))
    p.screenshot(path=r"D:\codes\red-alert-remake\_verify\shot-win.png")
    print("ERRS:", errs[:5])
    b.close()
