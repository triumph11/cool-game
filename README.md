# Claim

Browser industrial RTS. Shared pixel world, player economy, you run a company from above.

This repo is the first playable slice:

- Account + wallet (Marks)
- Shared map of plots
- Buy land, hire workers, click jobs
- Building designer + bill of materials
- Frontier Depot with limited stock and moving prices
- Mine timber / stone / ore / clay / sand and sell it

Later: chemistry, machines, trucks, LLCs, patents, player banks, government roads.

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
