#!/usr/bin/env node
/**
 * @1claw/base-mcp-secure — One-command setup.
 *
 * Provide your 1Claw human API key and this script creates:
 *   1. A vault ("base-mcp-keys")
 *   2. An agent ("base-mcp-agent") with Intents API + Shroud + Base guardrails
 *   3. A signing key for Base chain
 *   4. An access policy granting the agent read on "base-mcp/*"
 *   5. Outputs the agent API key + ready-to-paste MCP configs
 *
 * Usage:
 *   npx tsx scripts/setup.ts
 *   npx tsx scripts/setup.ts --api-key 1ck_your_key
 *   ONECLAW_API_KEY=1ck_... npx tsx scripts/setup.ts
 */

import { OneclawClient } from "@1claw/sdk";
import * as readline from "readline";

const API_URL = process.env.ONECLAW_API_URL || "https://api.1claw.xyz";

interface SetupResult {
  vaultId: string;
  agentId: string;
  agentApiKey: string;
  agentAddress?: string;
  policyId: string;
}

function prompt(question: string, hide = false): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.resolve("");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function setup(): Promise<void> {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     @1claw/base-mcp-secure — Setup Wizard              ║");
  console.log("║     Run Base MCP without the .env file                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  // Resolve API key
  let apiKey =
    process.argv.find((a) => a.startsWith("--api-key="))?.split("=")[1] ||
    process.argv[process.argv.indexOf("--api-key") + 1] ||
    process.env.ONECLAW_API_KEY ||
    "";

  if (!apiKey) {
    console.log("This script provisions the 1Claw infrastructure for @1claw/agentkit:");
    console.log("  • Vault (encrypted secret storage)");
    console.log("  • Agent (with Intents API + Shroud + Base guardrails)");
    console.log("  • Signing key (Base chain, TEE-backed)");
    console.log("  • Access policy (agent can read agentkit/* secrets)");
    console.log("");
    console.log("You need a 1Claw human API key (starts with 1ck_).");
    console.log("Get one at: https://1claw.xyz → Settings → API Keys");
    console.log("");
    apiKey = await prompt("Enter your 1Claw API key (1ck_...): ");
  }

  if (!apiKey.startsWith("1ck_")) {
    console.error("Error: API key must start with '1ck_' (human API key).");
    console.error("Agent keys (ocv_) cannot create resources. Use a human key.");
    process.exit(1);
  }

  console.log("");
  console.log("Connecting to 1Claw API...");

  // Authenticate with the human API key
  const authResp = await fetch(`${API_URL}/v1/auth/api-key-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!authResp.ok) {
    const err = await authResp.text();
    throw new Error(`Authentication failed (${authResp.status}): ${err}`);
  }
  const { access_token } = (await authResp.json()) as { access_token: string };

  const client = new OneclawClient({
    baseUrl: API_URL,
    token: access_token,
  });

  // Ask for optional guardrail config
  const dailyLimit = await prompt(
    "Daily ETH spend limit for the agent [default: 0.05 ≈ $125]: "
  );
  const maxTx = await prompt(
    "Max ETH per transaction [default: 0.01 ≈ $25]: "
  );
  const network = await prompt(
    "Network — mainnet or sepolia [default: mainnet]: "
  );

  const isTestnet = network.toLowerCase().includes("sepolia");
  const chainId = isTestnet ? 84532 : 8453;

  console.log("");
  console.log("─── Creating resources ───");

  // 1. Create vault
  console.log("  [1/4] Creating vault...");
  let vault: { id: string; name: string } | undefined;
  try {
    const resp = await client.vault.list();
    const existing = resp.data?.vaults?.find(
      (v: { name: string }) => v.name === "base-mcp-keys"
    );
    if (existing) {
      vault = existing;
      console.log(`        → Using existing vault "${vault!.name}" (${vault!.id})`);
    }
  } catch {
    // ignore, create fresh
  }

  if (!vault) {
    const resp = await client.vault.create({
      name: "base-mcp-keys",
      description: "Secrets for @1claw/base-mcp-secure (Base MCP + 1Claw integration)",
    });
    if (!resp.data) throw new Error(resp.error?.message || "Failed to create vault");
    vault = resp.data;
    console.log(`        → Created vault "${vault.name}" (${vault.id})`);
  }

  // 2. Create agent
  console.log("  [2/4] Creating agent with guardrails...");
  const agentResp = await client.agents.create({
    name: "base-mcp-agent",
    description:
      "Secured Base MCP agent — TEE signing, Shroud inspection, guardrail-enforced",
    intents_api_enabled: true,
    shroud_enabled: true,
    tx_allowed_chains: ["base"],
    tx_max_value_eth: maxTx || "0.01",
    tx_daily_limit_eth: dailyLimit || "0.05",
    vault_ids: [vault.id],
    shroud_config: {
      pii_policy: "redact",
      injection_threshold: 0.4,
      enable_secret_redaction: true,
      enable_response_filtering: true,
      command_injection_detection: { enabled: true, action: "block" },
      social_engineering_detection: {
        enabled: true,
        action: "block",
        sensitivity: "high",
      },
      network_detection: { enabled: true, action: "block" },
      tool_call_inspection: {
        enabled: true,
        block_credential_exfil: true,
        action: "block",
      },
    },
  } as any);
  if (!agentResp.data) throw new Error(agentResp.error?.message || "Failed to create agent");
  const agent = agentResp.data.agent;
  const agentApiKey = agentResp.data.api_key || "";
  console.log(`        → Created agent "${agent.name}" (${agent.id})`);
  console.log(`        → Agent API key: ${agentApiKey}`);

  // 3. Provision signing key
  console.log("  [3/4] Provisioning Base signing key...");
  let signingAddress = "";
  try {
    const skResp = await fetch(`${API_URL}/v1/agents/${agent.id}/signing-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ chain: "ethereum" }),
    });
    if (skResp.ok) {
      const sk = (await skResp.json()) as { address?: string };
      signingAddress = sk.address || "";
      console.log(`        → Signing key ready (address: ${signingAddress})`);
    } else {
      const errText = await skResp.text();
      console.log(`        → Signing key: ${errText || skResp.statusText}`);
    }
  } catch (err) {
    console.log(
      `        → Signing key: ${(err as Error).message || "skipped"}`
    );
  }

  // 4. Create access policy
  console.log("  [4/4] Creating access policy...");
  const policyResp = await client.access.grantAgent(
    vault.id,
    agent.id,
    ["read"],
    { secretPathPattern: "agentkit/*" },
  );
  if (!policyResp.data) throw new Error(policyResp.error?.message || "Failed to create policy");
  const policy = policyResp.data;
  console.log(`        → Policy created (${policy.id})`);

  // Done — output results
  const result: SetupResult = {
    vaultId: vault.id,
    agentId: agent.id,
    agentApiKey: agentApiKey,
    agentAddress: signingAddress,
    policyId: policy.id,
  };

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✓ Setup complete!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("Agent API Key (save this — shown only once):");
  console.log(`  ${result.agentApiKey}`);
  if (result.agentAddress) {
    console.log("");
    console.log(`Signing address (fund this for transactions on Base${isTestnet ? " Sepolia" : ""}):`);
    console.log(`  ${result.agentAddress}`);
  }
  console.log("");
  console.log("─── Next: Store your secrets ───");
  console.log("");
  console.log("Install the CLI and store the secrets your agent needs:");
  console.log("");
  console.log(`  npm install -g @1claw/cli`);
  console.log(`  1claw login`);
  console.log("");
  console.log(
    `  1claw secret put agentkit/seed-phrase --vault ${vault.id} --value "your seed phrase"`
  );
  console.log(
    `  1claw secret put agentkit/alchemy-api-key --vault ${vault.id} --value "your_key"`
  );
  console.log(
    `  1claw secret put agentkit/coinbase-api-private-key --vault ${vault.id} --value "..."`
  );
  console.log(
    `  1claw secret put agentkit/neynar-api-key --vault ${vault.id} --value "..."`
  );
  console.log(
    `  1claw secret put agentkit/openrouter-api-key --vault ${vault.id} --value "..."`
  );

  console.log("");
  console.log("─── MCP Config (paste into claude_desktop_config.json or .cursor/mcp.json) ───");
  console.log("");

  const mcpConfig = {
    mcpServers: {
      "1claw-agentkit": {
        command: "npx",
        args: ["@1claw/agentkit"],
        env: {
          ONECLAW_AGENT_API_KEY: result.agentApiKey,
          ...(isTestnet ? { ONECLAW_CHAIN_ID: "84532" } : {}),
        },
      },
      "1claw": {
        command: "npx",
        args: ["@1claw/mcp"],
        env: {
          ONECLAW_AGENT_API_KEY: result.agentApiKey,
        },
      },
    },
  };

  console.log(JSON.stringify(mcpConfig, null, 2));
  console.log("");
  console.log("─── What you get with both MCPs ───");
  console.log("");
  console.log("  1claw-agentkit:");
  console.log("    • transfer_funds, erc20_transfer, deploy_contract (TEE-signed)");
  console.log("    • get_balance, get_morpho_vaults, mint_nft, onramp");
  console.log("    • Farcaster (resolve_basename, get_farcaster_user)");
  console.log("");
  console.log("  1claw (27+ tools):");
  console.log("    • list_vaults, get_secret, put_secret, rotate_and_store");
  console.log("    • submit_transaction, sign_transaction, simulate_transaction");
  console.log("    • grant_access, share_secret, inspect_content");
  console.log("    • list_signing_keys, sign_message, sign_typed_data");
  console.log("    • platform_list_apps, platform_bootstrap_user");
  console.log("");
  console.log("  Together: Full onchain agent with zero secrets on disk.");
  console.log("");
}

setup().catch((err) => {
  console.error("");
  console.error("Setup failed:", (err as Error).message || err);
  console.error("");
  console.error("Common issues:");
  console.error("  • Invalid API key — make sure it starts with 1ck_");
  console.error("  • Expired key — generate a new one at https://1claw.xyz/settings/api-keys");
  console.error("  • Plan limit — Free tier allows 2 agents; upgrade for more");
  process.exit(1);
});
