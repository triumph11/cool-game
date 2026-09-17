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
- Ledger wrap: ERC-20 MARKS on a local Hardhat chain (wrap in-game Marks ⇄ burn on-chain)

Factory ticks and plot sim stay off-chain. Point `CHAIN_RPC` at a testnet later if you want.

## Run

Needs Node 20+.

```bash
npm install
npm run dev
```

That starts the local chain, deploys MARKS, then the game. Open [http://127.0.0.1:5173](http://127.0.0.1:5173)

Hardhat account 0 (for MetaMask import / tests):

`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

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
