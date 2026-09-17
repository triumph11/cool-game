export const MARK_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function minter() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function burn(uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Unwrap(address indexed from, uint256 amount)",
] as const;

export interface ChainInfo {
  rpc: string;
  chainId: number;
  token: string;
  minter: string;
  ready: boolean;
}
