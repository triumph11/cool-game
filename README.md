# Claim

Browser industrial RTS. Shared pixel world, player economy, you run a company from above.

Playable now:

- Account + wallet (Marks)
- Shared map of plots, RTS camera, hire workers, mine, build
- Building designer (including smelter / lab) + patents
- Frontier Depot (limited stock) and a **player market**
- Chemistry lab: known recipes plus invented materials
- Mail, player loans, LLCs, licenses with a kill switch
- Pave roads on your land; Government proposals to cross neighbors
- Cargo trucks with click-to-set routes
- Land tax and bankruptcy if debt runs too high

Still later: electronics scripting, bank deposits / bank-runs, chain bridge.

## Run

Needs Node 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

Create an account, buy a cheap plot, hire a couple of workers, open the Depot, mine your land, design a shack, place it.

## Controls

- Right-drag or WASD to pan, wheel to zoom
- **Select** — click workers, click ground to walk
- **Buy plot** — click unclaimed land
- **Hire** — spend Marks for a worker (need land first)
- **Mine** — click a resource tile on your land
- **Blueprints** — paint an 8×8 building, save, then **Place** on your land

## Stack

TypeScript, Vite, Canvas, Node WebSocket server, JSON world file in `data/`.
