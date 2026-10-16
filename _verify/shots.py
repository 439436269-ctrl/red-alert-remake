import json, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
OUT = pathlib.Path(r"D:\codes\red-alert-remake\_verify")

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "shot-boot.png"))
    page.keyboard.press("Space")
    page.wait_for_timeout(800)
    page.click('.side-card[data-side="soviet"]')
    page.click('#btnStart')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / "shot-game.png"))

    # 快进 150s 造出战场规模（用真实渲染循环之外的模拟推进 + 等一帧渲染）
    page.evaluate("""() => {
        for (let i = 0; i < 150*10; i++) { G.t += 0.1; simTick(0.1); if (G.over) break; }
        // 给我方补一支部队并摆到前线，便于截图
        const sp = MAP.spawns[0];
        G.cash[0] = 9000;
        for (let i = 0; i < 6; i++) startUnit(0, 'gi');
        for (let i = 0; i < 3; i++) startUnit(0, 'rocket');
        startUnit(0, 'heavytank'); startUnit(0, 'v2');
        for (let i = 0; i < 40*10; i++) { G.t += 0.1; simTick(0.1); if (G.over) break; }
        // 相机移到中线
        G.cam.x = (MAP_W/2)*TILE - VIEW.w/2; G.cam.y = (MAP_H/2)*TILE - VIEW.h/2;
        G.cam.x = Math.max(0, Math.min(MAP_W*TILE - VIEW.w, G.cam.x));
        G.cam.y = Math.max(0, Math.min(MAP_H*TILE - VIEW.h, G.cam.y));
        // 选中一些单位触发信息面板
        G.sel = G.units.filter(u => u.p === 0 && u.def.atk > 0).slice(0, 5);
    }""")
    page.wait_for_timeout(1200)
    page.screenshot(path=str(OUT / "shot-battle.png"))

    # 建造栏三页
    for tab in ['struct', 'inf', 'veh']:
        page.click(f'.bb-tab[data-tab="{tab}"]')
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"shot-tab-{tab}.png"))

    # 帮助手册
    page.keyboard.press("F1")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "shot-help.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # 核弹瞄准
    page.evaluate("""() => {
        const sp = MAP.spawns[0];
        const force = (key, tx, ty) => { if (hasBld(0, key)) return; if (!canPlaceAtEx(tx, ty, BUILDINGS[key].w, BUILDINGS[key].h, 0, false)) return; doPlaceBuilding(0, key, tx, ty, true); };
        force('apower', sp.tx + 6, sp.ty + 6); force('apower', sp.tx + 6, sp.ty + 9);
        G.nukeCd = 0; G.satCd = 0;
    }""")
    page.keyboard.press("n")
    page.wait_for_timeout(400)
    page.mouse.move(720, 420)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "shot-nuke.png"))
    page.keyboard.press("Escape")

    # 移动端视口
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / "shot-mobile.png"))

    print("ERRS:", errs[:6])
    print("state:", json.dumps(page.evaluate("() => ({t: Math.round(G.t), b0: G.blds.filter(b=>b.p===0).length, u0: G.units.filter(u=>u.p===0).length, cash: Math.round(G.cash[0])})")))
    b.close()
