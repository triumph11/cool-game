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
- Compute: logic gates, wiring, scripts (`IF STOCK timber > 8 THEN START smelter`)
- Player banks: deposits, interest, bank runs
- Living land: pollution from machines, neighbor bleed, trees grow back if clean
- Ledger wrap: simulated wallet receipt only — no real token

Real on-chain minting is intentionally not in this build.

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
- **Blueprints** — paint an 8×8, save as building / smelter / lab, then **Place**
- **Pave / Work / Route** — roads, run machines, truck stops
- **Wire / Compute** — place gates, connect them, save a script
- Sheets: Depot, Market, Lab, Mail, LLC, Bank, Government, Trucks, Compute, Ledger wrap

## Stack

TypeScript, Vite, Canvas, Node WebSocket server, JSON world file in `data/`.
