// BNB chain execution via PancakeSwap's V2 router. No API key required —
// this talks directly to the on-chain router contract via a public RPC.

import { ethers } from "ethers";
import { _internalGetEvmWallet } from "../wallet";

const ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024"; // PancakeSwap V2 router
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095";
export const USDC_ADDRESS_BNB = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
];
const ERC20_ABI = [
  "function approve(address spender, uint amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint)",
  "function decimals() view returns (uint8)",
];

export type PancakeQuote = {
  amountIn: bigint;
  amountOut: bigint;
  path: string[];
};

export async function getPancakeQuote(params: {
  tokenAddress: string;
  amountInWei: bigint;
  direction: "BUY" | "SELL";
}): Promise<PancakeQuote | null> {
  try {
    const wallet = _internalGetEvmWallet();
    if (!wallet?.provider) return null;
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet.provider);
    const path =
      params.direction === "BUY" ? [WBNB_ADDRESS, params.tokenAddress] : [params.tokenAddress, WBNB_ADDRESS];
    const amounts: bigint[] = await router.getAmountsOut(params.amountInWei, path);
    return { amountIn: params.amountInWei, amountOut: amounts[amounts.length - 1], path };
  } catch {
    return null;
  }
}

export type SwapResult =
  | { success: true; transactionId: string; amountOut: string }
  | { success: false; error: string };

export async function executePancakeSwap(params: {
  quote: PancakeQuote;
  direction: "BUY" | "SELL";
  tokenAddress: string;
  maxSlippageBps: number;
}): Promise<SwapResult> {
  const wallet = _internalGetEvmWallet();
  if (!wallet) return { success: false, error: "Burner wallet is not configured for BNB." };

  try {
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
    const minOut = (params.quote.amountOut * BigInt(10000 - params.maxSlippageBps)) / BigInt(10000);
    const deadline = Math.floor(Date.now() / 1000) + 120;

    let tx: ethers.ContractTransactionResponse;
    if (params.direction === "BUY") {
      tx = await router.swapExactETHForTokens(minOut, params.quote.path, wallet.address, deadline, {
        value: params.quote.amountIn,
      });
    } else {
      const erc20 = new ethers.Contract(params.tokenAddress, ERC20_ABI, wallet);
      const allowance: bigint = await erc20.allowance(wallet.address, ROUTER_ADDRESS);
      if (allowance < params.quote.amountIn) {
        const approveTx = await erc20.approve(ROUTER_ADDRESS, params.quote.amountIn);
        await approveTx.wait(1);
      }
      tx = await router.swapExactTokensForETH(
        params.quote.amountIn,
        minOut,
        params.quote.path,
        wallet.address,
        deadline
      );
    }

    return { success: true, transactionId: tx.hash, amountOut: params.quote.amountOut.toString() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown PancakeSwap execution error" };
  }
}

// Never blindly retried by the caller — confirmation status must be checked
// explicitly before a trade is reported as filled.
export async function confirmEvmTransaction(txHash: string): Promise<"CONFIRMED" | "FAILED" | "UNKNOWN"> {
  try {
    const wallet = _internalGetEvmWallet();
    if (!wallet?.provider) return "UNKNOWN";
    const receipt = await wallet.provider.waitForTransaction(txHash, 1, 45000);
    if (!receipt) return "UNKNOWN";
    return receipt.status === 1 ? "CONFIRMED" : "FAILED";
  } catch {
    return "UNKNOWN";
  }
}
