# Bastion Protocol — High-Performance Browser Tower Defense

A browser-based sci-fi tower defense game engineered with a multi-layer HTML5 Canvas 2D engine. Built from scratch with zero external dependencies, designed to deliver 60 FPS gameplay across 50 procedural waves and maintain real-time performance during mega-swarm combat scenarios of 5,000+ simultaneous enemies.

---

## 🎮 Play & Controls

### Live Interface
- **HUD Bar**: Real-time monitoring of Core Integrity (Lives), Credits, Wave Progression, Score, and Engine Diagnostics (FPS / Entity counts).
- **Control Bar**:
  - `⏸` Pause / Resume (`Space`)
  - `▶` 1× Standard Speed
  - `⏩` 2× Fast Forward
  - `⚡` 3× Turbo Acceleration
  - `↺` Restart Simulation
- **Tower Shop**: Hotkeys `1` through `5` for rapid placement.
- **Selection Panel**: Click any placed tower to view detailed specifications, upgrade to higher marks, or decommission for a 70% credit refund.

---

## 📐 Systems Architecture & Design Decisions

### 1. Multi-Layer Canvas Compositing
Instead of clearing and redrawing the entire screen every frame, the display is divided into independent canvas surfaces:
- **Background Layer (`#layer-bg`)**: Pre-renders the winding tactical conduit trench, spawn portal, defense core, and grid markings once. It is invalidated and redrawn only on resolution change or game restart.
- **Game Simulation Layer (`#layer-game`)**: Renders active units, towers, projectiles, lightning arcs, and hit bursts every frame.
- **DOM HUD & Modal Layer**: Renders UI panels and overlays in HTML/CSS with GPU compositing, eliminating canvas text-rendering bottlenecks.

### 2. Zero-Allocation Object Pooling (`spatial.js`)
Garbage collection (GC) pauses are the primary cause of stutter in high-entity browser games. `Bastion Protocol` uses a pre-allocated object pool architecture for enemies, projectiles, and visual particles:
- **Typed Free Stack**: Uses a contiguous `Int32Array` LIFO stack for instant $O(1)$ allocation without heap churn.
- **Dense Active List**: Active entity IDs are stored in a contiguous array with $O(1)$ swap-remove deallocation, ensuring cache-friendly iterations.
- Zero objects or arrays are instantiated in the hot game loop.

### 3. Static Linked-List Spatial Hashing (`spatial.js`)
Brute-force tower targeting with $N$ towers and $M$ enemies requires $O(N \times M)$ distance checks (e.g., $100 \times 5000 = 500,000$ checks per tick). To make range queries $O(1)$:
- The map is partitioned into a spatial grid ($64\text{px}$ cells).
- **Zero-GC Static Linked List**: Stored in flat typed arrays:
  - `cellHead = new Int32Array(cellCount)`: Stores the head entity index for each cell ($-1$ if empty).
  - `entityNext = new Int32Array(maxEntities)`: Stores the pointer to the next entity in the bucket.
- **Instant Clear**: Clearing the spatial hash requires only `cellHead.fill(-1)` ($<0.01\text{ms}$).
- **Target Acquisition**: Towers query only adjacent buckets and find the furthest enemy along the path using pure inlined scalar arithmetic without closures.

### 4. Target Stickiness & Cooldown Gating (`towers.js`)
In standard tower defense games, querying spatial structures for 100 towers every frame is wasteful:
- **Target Stickiness**: If a tower's current target is still active and within range, the lock is maintained, skipping spatial queries entirely.
- **Cooldown Gating**: Towers only query the spatial hash when their firing cooldown is ready ($cooldown \le 2 \cdot dt$), cutting spatial search frequency by over 80%.

### 5. Path-Batched Hardware Canvas Pipeline (`renderer.js`)
Canvas 2D curve tessellation (`ctx.arc()`) across thousands of units incurs massive GPU driver overhead. The rendering engine was optimized with:
- **Direct Rect & Vector Batching**: Entities are batched by type so canvas state (`fillStyle`, `strokeStyle`) is updated only once per group.
- **Two-Pass Electrical Arcs**: Traditional `shadowBlur` triggers multi-pass Gaussian convolution filters on the GPU ($15\text{ms}+$ frame cost). Tesla arcs use an ultra-fast two-pass hardware stroke (translucent glow pass + core white pass) taking $<0.05\text{ms}$.
- **Wounded-Only Health Bar Budgeting**: Health bars are drawn only for damaged units with an active list buffer, saving over $15,000$ redundant `fillRect` operations per frame in swarms.

### 6. Decoupled Fixed-Timestep Game Engine (`game.js`)
Game physics runs at a deterministic $60\text{Hz}$ fixed timestep (`GAME.fixedDt = 1/60`) with delta-time accumulation:
- Logic is completely decoupled from display refresh rates.
- Tight accumulator capping prevents spiral-of-death slowdowns if the host system experiences a background CPU spike.

---

## 🛡️ Tower Arsenal

| Tower | Cost | Range | RoF | Damage | Special Properties |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Blaster** | 50g | 128px | 3.0/s | 8 | Rapid single-target laser; high rate of fire. |
| **Sniper** | 100g | 260px | 0.65/s | 50 | Ultra-long range, armor-piercing kinetic dart. |
| **Frost** | 75g | 115px | 1.8/s | 5 | Cryo field slowing enemies by up to 45% (stacks). |
| **Cannon** | 125g | 135px | 0.9/s | 35 | High-explosive shell with 48px splash radius. |
| **Tesla** | 200g | 95px | 2.2/s | 18 | Arc lightning jumping between up to 3 nearby enemies. |

*Each tower features 3 upgrade tiers enhancing range, damage, rate of fire, and specialized effects (splash radius, chain count, slow intensity).*

---

## 👾 Enemy Forces

| Unit | HP | Speed | Armor | Reward | Strategic Behavior |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Scout** | 30 | 82 px/s | 0 | 5g | Fast, swarm-based reconnaissance unit. |
| **Soldier** | 85 | 48 px/s | 2 | 10g | Standard armored infantry; resists light attacks. |
| **Tank** | 320 | 28 px/s | 8 | 25g | Heavy armored dreadnought; requires piercing or concentrated fire. |
| **Healer** | 55 | 44 px/s | 0 | 20g | Emits periodic repair pulses restoring nearby damaged allies. |
| **Flyer** | 65 | 72 px/s | 0 | 15g | Agile aerial craft; immune to ground cryo-slow fields. |

---

## 🌊 Wave Progression (50 Waves)

Waves are procedurally calibrated with exponential health scaling ($1.082^{n-1}$) and progressive enemy introductions:
- **Waves 1–5**: Scouting incursions; establishing defensive perimeter.
- **Waves 6–15**: Armored Soldier and Tank deployments; testing armor penetration.
- **Waves 16–30**: Healer support squadrons and fast Flyers; requiring diverse tower positioning.
- **Waves 31–49**: Multi-squad combined arms assaults under high movement multipliers.
- **Wave 50 (Boss)**: Massive high-durability vanguard accompanied by elite healer escorts.

---

## ⚡ Stress Testing & Benchmarks

The game features an integrated stress test harness accessible via the `⚡ STRESS TEST` sidebar button:
- **Workload**: 5,000 active enemies, 100 tactical towers, and live projectile collisions simultaneously on screen.
- **Profiling Breakdown**:
  - `Enemy Movement`: ~0.5 ms
  - `Spatial Hash Rebuild`: ~0.2 ms
  - `Healer Status Auras`: ~0.3 ms
  - `Tower Target Acquisition`: ~0.4 ms
  - `Projectile Physics & Collision`: ~0.2 ms
  - `Canvas Multi-Layer Render`: ~3.5 ms
  - **Total Frame Execution Time**: **< 6.0 ms**
- **Sustained Framerate**: Runs smoothly at **60 FPS** on standard modern hardware.

---

## 🚀 Deployment

The project is built entirely on native web standards (ES Modules, Vanilla CSS, HTML5 Canvas) with zero build tools or bundling steps required.

### Local Development
```bash
# Serve static directory using any HTTP server
npx -y serve . -l 3000
```
Open `http://localhost:3000` in any modern web browser.

### Deploy to Vercel
A `vercel.json` configuration is included:
```bash
# Deploy with Vercel CLI
npx vercel --prod
```

### Deploy to Netlify / Cloudflare Pages / GitHub Pages
Simply connect the repository and set the publish directory to root (`.`). No build command needed.
