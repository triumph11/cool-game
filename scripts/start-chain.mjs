import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const rpc = process.env.CHAIN_RPC ?? "http://127.0.0.1:8545";
const dataDir = join(root, "data");
const chainFile = join(dataDir, "chain.json");

async function rpcCall(method, params = []) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function waitForRpc(ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await rpcCall("eth_chainId");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error("Hardhat RPC did not come up on " + rpc);
}

function startNode() {
  const child = spawn(npx, ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    if (code) process.exit(code);
  });
  return child;
}

async function compile() {
  await new Promise((resolve, reject) => {
    const child = spawn(npx, ["hardhat", "compile"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("compile failed"))));
  });
}

async function deploy() {
  const require = createRequire(import.meta.url);
  const { JsonRpcProvider, Wallet, ContractFactory, formatEther } = require("ethers");
  const artifactPath = join(root, "artifacts/contracts/ClaimMark.sol/ClaimMark.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(
    process.env.CHAIN_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider,
  );
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const token = await contract.getAddress();
  const net = await provider.getNetwork();
  mkdirSync(dataDir, { recursive: true });
  const info = {
    rpc,
    chainId: Number(net.chainId),
    token,
    minter: wallet.address,
    ready: true,
  };
  writeFileSync(chainFile, JSON.stringify(info, null, 2));
  const bal = formatEther(await provider.getBalance(wallet.address));
  console.log(`Claim MARKS at ${token}`);
  console.log(`Minter ${wallet.address} (${bal} ETH on local chain)`);
  console.log(`Wrote ${chainFile}`);
}

let already = false;
try {
  await rpcCall("eth_chainId");
  already = true;
  console.log("Using existing chain at", rpc);
} catch {
  already = false;
}

if (!already) startNode();
await waitForRpc();
await compile();
if (!existsSync(chainFile) || process.env.CHAIN_REDEPLOY === "1") {
  await deploy();
} else {
  console.log("chain.json already present");
}

if (already) {
  setInterval(() => {}, 1 << 30);
}
