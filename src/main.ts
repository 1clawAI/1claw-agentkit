#!/usr/bin/env node
/**
 * @1claw/agentkit — MCP server entrypoint.
 *
 * Secure AgentKit MCP server for autonomous AI agents on Base. Bootstraps
 * credentials from 1Claw Vault and routes all signing through the Intents API
 * (TEE-backed, guardrail-enforced).
 *
 * Usage:
 *   ONECLAW_AGENT_API_KEY=ocv_xxx npx @1claw/agentkit
 *
 * The server resolves all required API keys from your 1Claw vault at startup,
 * injects them into the process environment, then starts the AgentKit MCP server
 * with the Intents wallet provider active.
 */

import { bootstrapSecrets, injectIntoEnv } from "./bootstrap.js";
import {
  OneclawIntentsWalletProvider,
  createBaseMainnetProvider,
  createBaseSepoliaProvider,
} from "./providers/intents-wallet.js";

export {
  bootstrapSecrets,
  injectIntoEnv,
  OneclawIntentsWalletProvider,
  createBaseMainnetProvider,
  createBaseSepoliaProvider,
};

export type { BaseMcpSecrets, BootstrapConfig } from "./bootstrap.js";
export type {
  IntentsWalletConfig,
  TransactionRequest,
  TransactionResult,
  SignMessageResult,
} from "./providers/intents-wallet.js";

async function main() {
  console.error("[1claw-agentkit] Starting with 1Claw Vault bootstrap...");

  try {
    const secrets = await bootstrapSecrets();
    injectIntoEnv(secrets);
    console.error("[1claw-agentkit] Secrets loaded into process memory (never written to disk)");
  } catch (err) {
    console.error("[1claw-agentkit] Bootstrap failed:", (err as Error).message);
    console.error(
      "[1claw-agentkit] Falling back to environment variables (if set)."
    );
  }

  const provider = process.env.ONECLAW_CHAIN_ID === "84532"
    ? createBaseSepoliaProvider()
    : createBaseMainnetProvider();

  const address = await provider.getAddress().catch(() => "unknown");
  console.error(`[1claw-agentkit] Intents wallet ready (address: ${address})`);
  console.error("[1claw-agentkit] All transactions route through 1Claw Intents API (TEE-signed)");
  console.error("[1claw-agentkit] Guardrails active: allowlists, value caps, daily limits, simulation");

  // Delegate to AgentKit's MCP server with our patched environment
  try {
    await import("@coinbase/agentkit/mcp");
  } catch {
    console.error(
      "[1claw-agentkit] @coinbase/agentkit not found. Install it as a peer dependency:"
    );
    console.error("  npm install @coinbase/agentkit @coinbase/coinbase-sdk");
    console.error("");
    console.error("Or use this package as a library:");
    console.error(
      '  import { bootstrapSecrets, OneclawIntentsWalletProvider } from "@1claw/agentkit"'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[1claw-agentkit] Fatal:", err);
  process.exit(1);
});
