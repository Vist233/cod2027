# AGENTS.md

给在这个仓库里工作的 Agent 和开发者的说明。先读 [README.md](README.md)，再读本文件。

## TL;DR

```bash
npm install
npm start                 # http://localhost:2027
npm run smoke             # 浏览器冒烟（需要 Chrome + Playwright）
npm run test:combat       # 两个 WebSocket 客户端的对战测试
```

- 运行时：Node.js 18+，ESM，无前端构建步骤。
- 技术栈：原生 DOM/CSS + Three.js + `ws`；测试用 Playwright。
- 主玩法：**第一人称 3D、服务端权威、每局 1v1 的 PvP**。
- 当前不包含剧情关卡；主菜单的“剧情战役”只是占位入口。

## 先搞清楚的三件事

1. **服务端说了算。** 移动、射击、命中、伤害、换弹、冲刺、重生和胜负都在 `server.js`
   计算。客户端只做输入、本地移动预测和表现。不要为了“手感”把命中判定搬到客户端。
2. **世界单位是厘米。** 地图 `1600 × 1000`，玩家半径 `20`、身高 `180`、视高 `165`。
   水平面在服务端叫 `x/y`；Three.js 里对应 `x/z`，`y` 是高度。改坐标前先确认在哪一层。
3. **每局只有两个人。** 快速匹配和私人房间都是 1v1。一台服务器可以并行开很多房间，
   但不是大逃杀。要支持更多人，是功能改造，不是改一个常量。

## 目录

```text
server.js                 HTTP 静态服务 + WebSocket 权威服务器 + 房间/匹配/AI
shared/game-config.js     地图、玩家、武器、模式、出生点、医疗包
shared/physics.js         水平圆形碰撞、墙体/拾取物
shared/raycast3d.js       3D 射线、墙体/玩家命中、视线
shared/nav.js             A* 网格寻路
public/index.html         菜单、HUD、结算 DOM
public/css/style.css      UI
public/js/main.js         入口、UI、网络事件、主循环、本地预测
public/js/game3d.js       Three.js 场景、相机、远端玩家、特效、小地图
public/js/world3d.js      地图几何、材质、士兵/武器模型、名牌
public/js/net.js          WebSocket 客户端
public/js/input.js        键鼠与指针锁定
public/js/audio.js        WebAudio 音效
public/vendor/            Three.js 静态文件（不要加构建步骤）
scripts/smoke.mjs         浏览器流程测试
scripts/combat-test.mjs   WS 对战测试
docs/media/               README 图片
docs/MULTIPLAYER.md      多端/局域网/公网联机指南
```

## 运行与验证

### 本地运行

```bash
npm start
# 换端口
PORT=3000 npm start
# 调试模式，window.__COD__ = { app, game, input }
open 'http://localhost:2027/?debug=1'
```

### 多端联机/部署

- 一台机器 `npm start` 当服务器，其他设备访问 `http://<房主局域网 IP>:2027`；
  不要让朋友用 `localhost`。
- 每个房间最多 2 人；同一服务器可以并行多个房间（多个 4 位房间码）。
- 跨网络优先 Tailscale 私有地址；临时公开可用 Cloudflare Tunnel/ngrok，
  HTTPS 下客户端自动使用 `wss://`。
- 没有鉴权/房间密码/反作弊，不要建议用户长期把端口暴露公网。
- 具体步骤和排障见 [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md)。

### 改完代码的最小检查

```bash
node --check server.js
for f in public/js/*.js shared/*.js scripts/*.mjs; do node --check "$f"; done
npm run smoke
npm run test:combat
```

脚本默认连接 `localhost:2027`；换端口时：
`BASE_URL=http://localhost:3000 npm run smoke`、`WS_URL=ws://localhost:3000/ws npm run test:combat`。

`smoke` 会检查：菜单加载、训练场、指针锁定、开火扣弹、ADS、切霰弹枪、移动、
双人私人房间。`test:combat` 会让两个 WS 客户端寻路、瞄准、互射，确认服务端能产生击杀。

如果页面有 JS 异常，先看浏览器 console；`smoke` 会把 `pageerror` 和 console error 汇总为
`errors` 字段。不要用“截图看起来正常”代替 console 检查。

### 多开测试

- 两个浏览器窗口（其中一个无痕）可以模拟两名玩家。
- 快速匹配需要两个客户端都进入队列。
- 私人房：一个 `create_room`，另一个用 4 位房间码 `join_room`。
- 用 `?debug=1` 后可直接读取服务端状态：

```js
const app = window.__COD__.app;
app.state.players;        // 服务端玩家：字段是 x / y，不是 x / z
app.selfId;
app.yaw = Math.atan2(enemy.y - self.y, enemy.x - self.x);
```

## 多人对战是怎么跑起来的

### 房间与匹配

- 每个浏览器建立一个 WebSocket：`ws(s)://<host>/ws`。
- 服务器内存里有 `rooms: Map<code, room>` 和 `matchQueue`。
- **快速匹配**：`queue` 入队；队列里已有等待者时，创建 `pvp` 房间并把两人放进去。
- **私人房间**：`create_room` 生成 4 位码；第二个人 `join_room` 后立即 `startMatch`。
- **训练场**：`practice` 创建单人类房间，加入一个 AI 玩家。
- 房主断线/离开由 `leaveRoom` 清理；对局对象 `dispose`，避免定时器泄漏。
- 等待中的空房间 30 分钟后回收。

### 握手与消息

客户端连接后发送：

```json
{ "t": "hello", "name": "NOVA" }
```

服务端回：

```json
{ "t": "welcome", "id": "op_1_abc", "name": "NOVA" }
```

常用上行消息：

| 类型 | 作用 |
| --- | --- |
| `queue` / `cancel_queue` | 快速匹配入队/取消 |
| `create_room` / `join_room` | 私人房间，`join_room` 带 `code` |
| `practice` | 单人训练场 |
| `input` | 每约 33ms 的移动/视角/射击状态 |
| `action` | `reload` / `dash` / `weapon`（`v: 1|2`） |
| `rematch` | 结算页投票重赛 |
| `leave` | 主动退出房间 |

输入字段：

```json
{ "t": "input", "mx": 0.7, "my": -0.2, "aim": 1.57, "pitch": 0.1, "ads": false, "shoot": true }
```

`mx/my` 已经是世界方向，服务端不再按视角旋转；`aim` 是水平朝向弧度，`pitch` 限制在
`[-1.32, 1.32]`。`action` 在倒计时阶段只允许换武器，换弹/冲刺需要 `phase === 'live'`。

常用下行消息：`room_created`、`room_joined`、`queued`、`state`、`event`、
`match_end`、`rematch_update`、`left`、`error`。

### 模拟与快照

- 服务器用 `setInterval(..., 16)` 驱动所有房间；单房间 `tick()` 用 `dt` 更新。
- `phase`：`countdown` → `live` → `ended`；`MATCH.countdown = 3.2s`，
  `duration = 240s`，`killLimit = 10`。
- 模拟频率目标 60Hz；快照 `MATCH.snapshotRate = 20` Hz。
- `serialize()` 输出玩家位置、朝向、血量、击杀/死亡、武器、弹药、换弹进度、
  冲刺冷却、重生倒计时、ADS 状态等；客户端据此渲染。
- 事件（开火、命中、击杀、换弹、冲刺、出生）通过 `events` 队列随快照发送，
  客户端只负责表现，比如弹道、粒子、击杀文字和屏幕震动。

### 命中与碰撞

- `castShot()` 在服务端从玩家眼睛位置出发，按 `aim/pitch` 生成射线。
- 先收集墙体命中距离，再检查玩家身体/头部包围盒；取最近命中。
- 头部区域为 `y >= PLAYER.height * 0.84`，命中倍率 `2.1`。
- 霰弹枪一次 7 个弹丸，每颗独立计算；扩散由武器 `spread + moveSpread` 决定。
- 客户端看到的弹道只是表现，真正的伤害以服务端事件为准。

### 重生、结算、重赛

- 阵亡后 `respawnAt = now + PLAYER.respawnTime * 1000`；到时回出生点并重置血量/弹药。
- 击杀数达到 `killLimit` 或时间耗尽时 `end()`，广播 `match_end`。
- 结算页点“再来一局”发送 `rematch`；训练场立即重开，PvP 需要双方都投票。

### 扩展到更多人？

当前代码把“每间房两人”写死在匹配、出生点、计分和 UI 里。要支持 3 人以上，至少需要：

1. 重新设计 `SPAWNS` 与出生保护；
2. 修改 `createRoom`/`join_room` 的容量与 `startMatch`；
3. 计分从“先到 10 杀”改为适合多人的规则；
4. 快照、HUD、击杀栏、观战/重生逻辑；
5. 压测广播与房间回收。

在这些完成前，不要对外宣称支持多人混战。

## 常见坑

- **士兵模型看起来只有 1.8cm 高**：模型内部按“米”建模，外层需要
  `group.scale.setScalar(100)`；不要把这个缩放当成世界单位错误删掉。
- **第一人称枪看不见**：ADS 位置不能正对枪管轴线，当前 AR 在
  `(0.13, -0.18, -0.78)` 附近，修改后要截图确认。
- **受击出现巨大红色方块**：粒子贴图/尺寸问题。近距离自身命中会跳过粒子，
  粒子使用圆形径向渐变贴图；改粒子参数后要实际中弹验证。
- **敌人名牌隔墙显示**：`enemyTagVisible()` 做了多高度/左右偏移的 3D 视线检查；
  不要简单改成 `depthTest: false` 全显。
- **换武器没反应**：检查按键是否在倒计时阶段、`action` 是否被服务端接受；
  当前倒计时允许换武器，但换弹/冲刺会被忽略。
- **结算/重赛测试**：临时把 `killLimit` 改成 1 后，**一定要改回 10**，并重启服务器。
- **端口占用**：`lsof -nP -iTCP:2027 -sTCP:LISTEN`，必要时 `kill <pid>`。
- **公网 HTTPS**：`net.js` 已按 `location.protocol` 自动选择 `ws/wss`；
  不要硬编码 `ws://`。

## 代码约定

- 保持 ESM；服务端与浏览器共享 `shared/` 中的纯函数。
- 不引入打包器，不把 Three.js 改成 CDN 依赖；`public/vendor/` 是离线可用的。
- 新增依赖前先确认是否真的需要；当前运行时依赖只有 `three` 和 `ws`。
- UI 文案用中文，代码标识符用英文；保持现有暗色青/琥珀风格。
- 服务端逻辑优先写成可测试的纯函数，再接到房间循环。
- 不要提交 `node_modules/`、`screenshots/`、日志或本地环境文件。
- 不要改 `shared/game-config.js` 的单位体系；如果必须改，同步更新碰撞、射线、模型缩放和文档。

## 完成标准

一次改动至少满足：

- [ ] `node --check` 通过
- [ ] `npm run smoke` 无 `errors`
- [ ] `npm run test:combat` 能产生命中/击杀，`phase: 'live'`
- [ ] 手动验证受影响的模式（训练场 / 快速匹配 / 私人房 / 结算）
- [ ] README 或 AGENTS.md 中相关说明已同步
- [ ] 没有提交测试用临时配置（尤其是 `killLimit`）

## License

MIT © 2026 Vist233。提交贡献即表示同意以 MIT 协议发布。
