import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther, type TransactionReceipt } from "ethers";
import { MARK_ABI, type ChainInfo } from "../shared/markAbi";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chainFile = join(root, "data", "chain.json");

const HARDHAT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function loadInfo(): ChainInfo | null {
  if (!existsSync(chainFile)) return null;
  try {
    return JSON.parse(readFileSync(chainFile, "utf8")) as ChainInfo;
  } catch {
    return null;
  }
}

export function chainInfo(): ChainInfo {
  return loadInfo() ?? { rpc: "", chainId: 0, token: "", minter: "", ready: false };
}

function connect() {
  const info = loadInfo();
  if (!info?.ready || !info.token) throw new Error("Local chain is not up yet. Wait for the chain process, then wrap.");
  const provider = new JsonRpcProvider(info.rpc);
  const wallet = new Wallet(process.env.CHAIN_KEY ?? HARDHAT_KEY, provider);
  const token = new Contract(info.token, MARK_ABI, wallet);
  return { info, provider, wallet, token };
}

export async function mintMarks(to: string, marks: number): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Wallet must be a 0x address (42 chars).");
  const { token } = connect();
  const tx = await token.mint(to, parseEther(String(marks)));
  const rec: TransactionReceipt = await tx.wait();
  if (!rec?.hash) throw new Error("Mint did not confirm.");
  return rec.hash;
}

export async function tokenBalance(address: string): Promise<string> {
  const { token } = connect();
  const bal = await token.balanceOf(address);
  return formatEther(bal);
}

export async function verifyBurnTx(txHash: string, expectedFrom: string): Promise<number> {
  const { provider, info } = connect();
  const rec = await provider.getTransactionReceipt(txHash);
  if (!rec || rec.status !== 1) throw new Error("Burn transaction not found or failed.");
  if (rec.to?.toLowerCase() !== info.token.toLowerCase()) throw new Error("That tx is not the MARKS token.");
  const iface = new Contract(info.token, MARK_ABI, provider).interface;
  let amount = 0n;
  let from = "";
  for (const log of rec.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "Unwrap") {
        from = String(parsed.args.from);
        amount = BigInt(parsed.args.amount);
      }
    } catch {
      /* not our event */
    }
  }
  if (!from || amount === 0n) throw new Error("No Unwrap event in that transaction. Call burn() on MARKS.");
  if (from.toLowerCase() !== expectedFrom.toLowerCase()) {
    throw new Error("Burn was not from your linked wallet.");
  }
  return Number(formatEther(amount));
}
