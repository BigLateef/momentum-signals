// Restricted burner-wallet loader for automated trading.
//
// HARD RULE: the private key loaded here must never be returned from any API
// route, logged, written to the database, or passed to client code. Every
// function in this module that touches the raw key keeps it in a local
// variable and returns only public data (addresses, signed-tx signatures/hashes).
//
// This module is only ever imported from server-side code (API routes under
// src/app/api and the cron/lib/trading orchestrator) — never from a
// "use client" component.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ethers } from "ethers";

let solanaKeypair: Keypair | null | undefined;
let evmWallet: ethers.Wallet | null | undefined;

function loadSolanaKeypair(): Keypair | null {
  if (solanaKeypair !== undefined) return solanaKeypair;
  const raw = process.env.AUTO_TRADE_WALLET_PRIVATE_KEY;
  if (!raw) {
    solanaKeypair = null;
    return null;
  }
  try {
    solanaKeypair = Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    solanaKeypair = null;
  }
  return solanaKeypair;
}

function loadEvmWallet(): ethers.Wallet | null {
  if (evmWallet !== undefined) return evmWallet;
  const raw = process.env.AUTO_TRADE_WALLET_PRIVATE_KEY;
  if (!raw) {
    evmWallet = null;
    return null;
  }
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org");
    evmWallet = new ethers.Wallet(raw.startsWith("0x") ? raw : `0x${raw}`, provider);
  } catch {
    evmWallet = null;
  }
  return evmWallet;
}

export function isWalletConfigured(chain: "SOLANA" | "BNB"): boolean {
  return chain === "SOLANA" ? loadSolanaKeypair() != null : loadEvmWallet() != null;
}

// Safe to expose — the public address, not the key.
export function getWalletPublicAddress(chain: "SOLANA" | "BNB"): string | null {
  if (chain === "SOLANA") return loadSolanaKeypair()?.publicKey.toBase58() ?? null;
  return loadEvmWallet()?.address ?? null;
}

export function getSolanaConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
}

// Internal accessors — used ONLY by src/lib/trading/dex/*.ts to sign
// transactions. Not exported from the package's public surface (index.ts
// doesn't re-export these) and never called from an API route directly.
export function _internalGetSolanaKeypair(): Keypair | null {
  return loadSolanaKeypair();
}

export function _internalGetEvmWallet(): ethers.Wallet | null {
  return loadEvmWallet();
}

export async function getSolanaTokenBalance(mint: string): Promise<number> {
  const kp = loadSolanaKeypair();
  if (!kp) return 0;
  try {
    const connection = getSolanaConnection();
    const resp = await connection.getParsedTokenAccountsByOwner(kp.publicKey, {
      mint: new PublicKey(mint),
    });
    return resp.value.reduce(
      (sum, acc) => sum + (acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
      0
    );
  } catch {
    return 0;
  }
}

export async function getEvmTokenBalance(tokenAddress: string): Promise<number> {
  const wallet = loadEvmWallet();
  if (!wallet) return 0;
  try {
    const erc20 = new ethers.Contract(
      tokenAddress,
      ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
      wallet.provider
    );
    const [balance, decimals] = await Promise.all([erc20.balanceOf(wallet.address), erc20.decimals()]);
    return Number(ethers.formatUnits(balance, decimals));
  } catch {
    return 0;
  }
}
