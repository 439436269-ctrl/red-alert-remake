import json, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
OUT = pathlib.Path(r"D:\codes\red-alert-remake\_verify")

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(400)
    page.keyboard.press("Space")
    page.wait_for_timeout(600)
    page.click('.side-card[data-side="soviet"]')
    page.click('#btnStart')
    page.wait_for_timeout(800)

    data = page.evaluate("""() => {
        const log = [];
        const p = 0;
        for (let i = 0; i < 90 * 10; i++) {
            G.t += 0.1; simTick(0.1);
            if (i % 50 === 0) {
                const ref = nearestBld(p, 'refinery', MAP.spawns[p].tx * TILE, MAP.spawns[p].ty * TILE);
                const hs = G.units.filter(u => u.p === p && u.def.special === 'harvest').map(u => ({
                    st: u.harvState, ore: Math.round(u.ore * 10) / 10,
                    d: ref ? Math.round(dist(u.x, u.y, ref.cx, ref.cy)) : -1,
                    dest: u.dest ? [Math.round(u.dest.x), Math.round(u.dest.y)] : null,
                    path: u.path ? u.path.length : null, pi: u.pathI,
                    stuck: Math.round(u.stuckT * 10) / 10,
                    tgt: u.oreTarget ? [u.oreTarget.x, u.oreTarget.y, Math.round(u.oreTarget.amount)] : null,
                    pos: [Math.round(u.x), Math.round(u.y)]
                }));
                log.push({ t: Math.round(G.t), cash: Math.round(G.cash[p]), earned: G.stats[p].earned,
                    ref: ref ? [ref.cx, ref.cy] : null, harv: hs });
            }
        }
        return log;
    }""")
    for row in data:
        print(json.dumps(row, ensure_ascii=False))
    print("ERRS:", errs[:5])
    b.close()
