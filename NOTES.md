# NOTES · 开发踩坑与经验（给未来继续改这游戏的自己）

> 一次性记录开发过程中**真实踩过并修复**的坑，每条：现象 → 根因 → 对策。
> 只记会长期有效的，纯调试流水不记。日期：2026-10-16。

## 规则（Rules）

- **纯前端零依赖**：不引任何框架/构建，双击 `index.html` 或 `python -m http.server` 即跑；改完不需 build。
- **零素材、零版权**：美术全 Canvas 程序绘制，音效全 WebAudio 实时合成，数值全自产——**这是本项目的红线**，往里贴任何原作素材（EA/Westwood 的图/音乐/单位）都会踩著作权+商标。"红色警戒"只作描述性称呼。
- **凭据绝不进仓库**：token 只在 `%USERPROFILE%\.secrets\keys.env`（键 `GITHUB_TOKEN`），`.gitignore` 挡住 `secrets/*`、`*.env`；仓库走公开 Pages 也不放任何密钥。

## 架构决策（Architecture decisions）

- **实体用 `p`（0=玩家 / 1=敌方）标阵营**，`G` 是全局状态单例，`simTick(dt)` 是唯一推进入口（`loop` 每帧调它）。AI 逻辑全在 `ai.js`，`engine.js` 不含 AI。
- **放置校验走 `canPlaceAtEx(tx,ty,w,h,player,needFog)`**：把"迷雾限制"做成参数，因为——
  **玩家只能在已探明区放建筑，但 AI 必须绕过迷雾**，否则 AI 在自家黑区一栋楼都盖不起来（见下）。
- **卸矿判定按"半对角线+外圈"算**，不是 `max(w,h)/2`（见下）。

## 发现的持久知识（Discovered durable knowledge）

1. **AI 建筑"永远放不下去"** —— 现象：AI 攒了一堆钱，`buildOrder` 完成却进不了 `aiPending` 落地，永远 3 栋楼。
   根因：`canPlaceAt` 内部有 `fogAt(x,y)===0 → return false`，玩家出生点附近已探明、AI 基地是黑区，AI 被自己的放置校验挡死。
   对策：拆出 `canPlaceAtEx(..., needFog)`，AI 调用传 `needFog=false`、玩家传 `true`。

2. **采矿车经济"从第 20 秒归零"** —— 现象：玩家 `cash` 一度只进不出，矿车在精炼厂外反复抖（`harvState=toRef` 但不 `dump`）。
   根因：卸矿判定半径 `max(w,h)*TILE/2+14 = 62px` **小于** 3×3 建筑的半对角线 68px，矿车永远够不到。
   对策：改 `dropR = hypot(w,h)*TILE/2 + 44`（≈112px），覆盖外圈相邻格（含对角）的最大距离。

3. **AI 新兵"出厂即冲向敌方基地送死"** —— 现象：AI 没有任何战术就全军压上，第一波比设计早 3 倍。
   根因：`spawnUnit` 里给新单位的默认集结点写成了**敌方基地坐标**。
   对策：默认集结点改成"己方基地朝地图中心那一侧 6 格"，进攻只由 AI 的波次逻辑触发。

4. **AI 卡成"冷战"不再进攻** —— 现象：战局后期双方都不动，`onMission` 单位永远站桩。
   根因：出征部队打完目标后 `onMission=true` 永不释放，`army` 过滤 `!u.onMission` 导致 AI 永远攒不出下一波。
   对策：`aiProduce` 里超时未交战（>8s）就 `onMission=false` 放回预备队。

5. **PS 5.1 传 GitHub JSON body 必须 UTF-8 无 BOM 字节** —— 现象：`Invoke-RestMethod -Body $string` 报 `Problems parsing JSON`（400）。
   根因：PS 字符串转 body 带编码/引号问题。
   对策：`$bytes = [Text.Encoding]::UTF8.GetBytes($json); -Body $bytes -ContentType 'application/json'`。（`AGENTS.md`/`wrap-up` 均记过）

6. **Playwright 本机无 bundled chromium** —— 现象：`chromium.launch()` 报 `Executable doesn't exist`。
   对策：`executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe"`。
   另：验证脚本要 `page.on("pageerror")` + `console` 双监听抓栈，否则只看到"某处 null"。

7. **本地静态服务器别用 8437** —— 现象：8437 上 `Invoke-WebRequest` 偶发"连接被意外关闭"、Playwright `ERR_EMPTY_RESPONSE`。
   对策：换 **8765**（`python -m http.server 8765 --bind 127.0.0.1 --directory <项目>`）。

8. **开场 loading 是假的（纯装饰）** —— `style.css` 的 `.boot-bar i` 是固定 2.4s 的 CSS 动画，不加载任何东西；真正等的是**浏览器自动播放策略**（需用户点击/按键才 `Sfx.resume()` 解锁音频）。进度条与资源无关。

## 平衡调参备忘

- AI 津贴必须**低于**玩家 2~3 辆矿车实际收入且随时间封顶（`Math.min(G.t,240)`），否则滚雪球玩家无翻盘。
- AI `firstPushAt = [270,215,165][难度]`：开局只守家，给玩家发展期；`cap=[7,10,14]` 兵力上限随难度。
- 实测（普通）：AI 第一波 ≈200s 出动、≈260s 接触；挂机玩家 ≈4.8 分钟被推平。
