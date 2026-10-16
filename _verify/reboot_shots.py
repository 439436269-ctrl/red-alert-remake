import json, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
OUT = pathlib.Path(r"D:\codes\red-alert-remake\_verify")

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    p = b.new_page(viewport={"width":1440,"height":900}, device_scale_factor=2)
    errs=[]
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(URL, wait_until="load"); p.wait_for_timeout(600)
    p.screenshot(path=str(OUT/"reboot-1-boot.png"))
    p.keyboard.press("Space"); p.wait_for_timeout(800)
    p.screenshot(path=str(OUT/"reboot-2-menu.png"))
    p.click('.side-card[data-side="soviet"]'); p.click('#btnStart'); p.wait_for_timeout(1500)

    # 造出一支像样的部队 + 摆到交战线，截一张"有画面感"的战场
    p.evaluate("""() => {
        G.cash[0] = 12000;
        for (let i=0;i<8;i++) startUnit(0,'gi');
        for (let i=0;i<4;i++) startUnit(0,'rocket');
        startUnit(0,'heavytank'); startUnit(0,'heavytank'); startUnit(0,'v2');
        for (let i=0;i<60*10;i++){ G.t+=0.1; simTick(0.1); if(G.over) break; }
        G.sel = G.units.filter(u=>u.p===0&&u.def.atk>0).slice(0,8);
        const sp = MAP.spawns[0];
        G.cam.x = (sp.tx+4)*TILE - VIEW.w/2; G.cam.y = (sp.ty+4)*TILE - VIEW.h/2;
        G.cam.x = Math.max(0, Math.min(MAP_W*TILE-VIEW.w, G.cam.x));
        G.cam.y = Math.max(0, Math.min(MAP_H*TILE-VIEW.h, G.cam.y));
    }""")
    p.wait_for_timeout(1200)
    p.screenshot(path=str(OUT/"reboot-3-base.png"))

    # 中线交战视角
    p.evaluate("""() => {
        G.cam.x = MAP_W/2*TILE - VIEW.w/2; G.cam.y = MAP_H/2*TILE - VIEW.h/2;
        G.cam.x = Math.max(0, Math.min(MAP_W*TILE-VIEW.w, G.cam.x));
        G.cam.y = Math.max(0, Math.min(MAP_H*TILE-VIEW.h, G.cam.y));
        for (let i=0;i<30*10;i++){ G.t+=0.1; simTick(0.1); if(G.over) break; }
    }""")
    p.wait_for_timeout(1200)
    p.screenshot(path=str(OUT/"reboot-4-mid.png"))

    print("ERRS:", errs[:5])
    print("state:", json.dumps(p.evaluate("() => ({t:Math.round(G.t), b0:G.blds.filter(b=>b.p===0).length, u0:G.units.filter(u=>u.p===0).length, u1:G.units.filter(u=>u.p===1).length})")))
    b.close()
