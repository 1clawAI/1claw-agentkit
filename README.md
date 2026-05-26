# @1claw/agentkit

**Secure AgentKit wallet for autonomous AI agents on Base.**

A hardened MCP server built on [Coinbase AgentKit](https://github.com/coinbase/agentkit) that lets autonomous agents operate on Base with TEE-backed signing, programmatic guardrails, and zero secrets on disk.

> Your agent gets the full onchain toolkit. 1Claw makes sure it never actually holds the keys.

## Which Should I Use?

| | [mcp.base.org](https://docs.base.org/ai-agents/quickstart) | @1claw/agentkit |
|--|--|--|
| **Use case** | Interactive (human in the loop) | Autonomous (no human per-tx) |
| **Signing** | OAuth via Base Account, you approve each tx | TEE-backed Intents API, guardrails approve |
| **Setup** | Connect remote MCP, sign in once | One agent key, programmatic config |
| **Keys** | None needed (Base Account manages them) | Stored in 1Claw Vault (HSM + MPC) |
| **Best for** | Claude Desktop, ChatGPT, Cursor chat | Cron jobs, multi-agent systems, background workers, trading bots |
| **Limits** | Human reviews every action | Programmable: per-tx caps, daily limits, address allowlists |

**TL;DR:** If a human approves every transaction, use `mcp.base.org`. If your agent runs unattended, use this.

## The Problem

AgentKit gives agents powerful onchain tools — transfers, contract calls, DeFi interactions. But running AgentKit autonomously means storing seed phrases or API keys somewhere, and trusting the agent (or whatever prompts it) not to drain the wallet.

Without guardrails:
- A prompt injection through a poisoned input can trigger unlimited transfers
- Seed phrases sit in `.env` files or config JSON in plaintext
- No per-transaction or daily spend limits
- No audit trail of what the agent did or why
- No way to instantly revoke access

## The Solution

```
Agent ─► Shroud TEE ─► LLM ─► 1claw-agentkit (AgentKit + Vault) ─► Intents API ─► Base
```

| Surface | What it does | How |
|---------|-------------|-----|
| **Vault** | Eliminates secrets on disk | Credentials resolved from HSM-encrypted vault at boot. Never touch disk. MPC optional. |
| **Intents API** | Replaces local signing | All signing happens in a TEE with per-agent guardrails enforced server-side. |
| **Shroud** | Blocks prompt injection | 11-layer inspection pipeline scores and blocks attacks before the model acts. |
| **Policy Engine** | Fine-grained access | Agents only see secrets they're explicitly granted by a human. |

## Quick Start

### Option A: One-Command Setup (Recommended)

```bash
git clone https://github.com/1clawAI/1claw-agentkit.git
cd 1claw-agentkit
npm install
npm run setup
```

The setup wizard asks for your 1Claw human API key (`1ck_...`) and automatically creates:
- A vault for your agent's secrets
- An agent with Intents API + Shroud + Base guardrails
- A signing key on Base chain
- An access policy granting the agent read on `base-mcp/*`

It outputs a ready-to-paste MCP config with both `1claw-agentkit` and the `1claw` MCP server paired together.

> Get your API key at [1claw.xyz → Settings → API Keys](https://1claw.xyz/settings/api-keys)

### Option B: Manual Setup

<details>
<summary>Click to expand manual steps</summary>

#### 1. Install

```bash
npm install @1claw/agentkit
```

#### 2. Store your secrets in 1Claw

```bash
npx @1claw/cli login
npx @1claw/cli vault create --name "base-agent-keys"
npx @1claw/cli secret put base-mcp/seed-phrase --value "your seed phrase"
npx @1claw/cli secret put base-mcp/coinbase-api-private-key --value "-----BEGIN EC..."
npx @1claw/cli secret put base-mcp/alchemy-api-key --value "your_key"
```

#### 3. Create a secured agent

```bash
npx @1claw/cli agent create \
  --name "my-base-agent" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.1" \
  --tx-daily-limit "1.0"
```

</details>

### 4. Update your MCP config

The setup script outputs this for you, but here's the config manually. **Both MCPs share the same agent key** — they compose into one unified toolset:

```json
{
  "mcpServers": {
    "1claw-agentkit": {
      "command": "npx",
      "args": ["@1claw/agentkit"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_key_here"
      }
    },
    "1claw": {
      "command": "npx",
      "args": ["@1claw/mcp"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_key_here"
      }
    }
  }
}
```

**That's it.** One env var. Zero secrets on disk. Two MCPs, one agent.

## Why Both MCPs?

The `1claw-agentkit` and `1claw` MCP servers use the **same agent credentials** and complement each other:

| MCP Server | What it provides |
|-----------|-----------------|
| **1claw-agentkit** | All AgentKit onchain tools (transfers, contract calls, ERC-20, Morpho, NFTs, Farcaster) — but TEE-signed and guardrail-enforced |
| **1claw** | 27+ vault management tools (put_secret, get_secret, rotate_and_store, simulate_transaction, sign_message, sign_typed_data, grant_access, share_secret, platform tools, etc.) |

Together they enable flows like:
- *"Store my new Alchemy key in the vault, then check my Base wallet balance"* — uses both MCPs in one conversation
- *"Rotate my Coinbase API key and update it in the vault"* — 1claw MCP handles the rotation
- *"Simulate this Morpho deposit, then execute it if profitable"* — simulate via 1claw, execute via 1claw-agentkit
- *"Share read access to my neynar key with my teammate's agent"* — 1claw MCP handles sharing

## How It Works

### Boot sequence

1. MCP server starts
2. Authenticates to 1Claw with a short-lived JWT (from the `ocv_` API key)
3. Resolves `SEED_PHRASE`, `COINBASE_API_PRIVATE_KEY`, `ALCHEMY_API_KEY`, etc. from the vault
4. Injects credentials into process memory (never written to disk)
5. Starts the AgentKit MCP server with the Intents wallet provider active

### Transaction flow

1. LLM emits a tool call (transfer, swap, contract interaction)
2. Shroud inspects the request (injection scoring, PII detection, exfil blocking)
3. `OneclawIntentsWalletProvider` converts it to an Intents API call
4. Server-side guardrails enforce: chain allowlist, address allowlist, value cap, daily limit
5. Tenderly simulation runs (optional, default: on)
6. Transaction is signed in the TEE and broadcast to Base
7. Full audit trail recorded with hash-chain integrity

### What the agent CAN'T do (even if prompt-injected)

- Transfer to unlisted addresses (blocked by `tx_to_allowlist`)
- Exceed daily spend (blocked by `tx_daily_limit_eth`)
- Move to another chain (blocked by `tx_allowed_chains`)
- Read the seed phrase (blocked by Intents API private key gating)
- Replay a transaction (blocked by idempotency keys)

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONECLAW_AGENT_API_KEY` | Yes | Agent API key (`ocv_` prefix) |
| `ONECLAW_AGENT_ID` | No | Explicit agent ID (auto-resolved from key if omitted) |
| `ONECLAW_API_URL` | No | API URL (default: `https://api.1claw.xyz`) |
| `ONECLAW_VAULT_ID` | No | Explicit vault ID (auto-resolved if omitted) |
| `ONECLAW_SECRET_PREFIX` | No | Vault path prefix (default: `base-mcp/`) |
| `ONECLAW_CHAIN_ID` | No | Chain ID — `84532` for Base Sepolia (default: `8453` Base mainnet) |

### Vault Secret Paths

Store secrets under `base-mcp/` (configurable via `ONECLAW_SECRET_PREFIX`):

```
base-mcp/seed-phrase
base-mcp/coinbase-api-key-name
base-mcp/coinbase-api-private-key
base-mcp/alchemy-api-key
base-mcp/openrouter-api-key
base-mcp/neynar-api-key
```

## Use as a Library

```typescript
import {
  bootstrapSecrets,
  OneclawIntentsWalletProvider,
  createBaseMainnetProvider,
} from "@1claw/agentkit";

// Resolve secrets from vault
const secrets = await bootstrapSecrets({
  agentApiKey: "ocv_...",
});

// Create a wallet provider backed by Intents API
const wallet = createBaseMainnetProvider({
  agentApiKey: "ocv_...",
  agentId: "your-agent-id",
});

// Send a transaction (TEE-signed, guardrail-enforced)
const result = await wallet.sendTransaction({
  to: "0xRecipient",
  value: "0.001", // ETH
});

console.log(`TX: ${result.txHash} (${result.status})`);

// Sign a message (EIP-191, key never leaves TEE)
const sig = await wallet.signMessage("Hello from my agent");
console.log(`Signature: ${sig.signature}`);

// Sign without broadcasting (agent submits to its own RPC)
const signedTx = await wallet.signTransaction({
  to: "0xContract",
  value: "0",
  data: "0xabcdef...",
});
```

## Examples

- [`examples/claude-desktop.json`](examples/claude-desktop.json) — Claude Desktop config with zero secrets
- [`examples/cursor.json`](examples/cursor.json) — Cursor IDE MCP config
- [`examples/morpho-yield-agent.md`](examples/morpho-yield-agent.md) — Autonomous Morpho yield agent with $50/day cap

## Docs

- [Migration Guide](docs/migration-from-base-mcp.md) — Moving from plaintext secrets to 1Claw
- [Policy Recipes](docs/policy-recipes.md) — Pre-built guardrail configs for common use cases

## Security Comparison

| Threat Vector | Unguarded AgentKit | @1claw/agentkit |
|--------------|----------|-----------------|
| Seed phrase on disk | `.env` / config JSON | Never touches disk (Vault + MPC) |
| Prompt injection → drain | Unguarded | Shroud blocks + guardrails cap |
| Unlimited transfers | No limits | Per-tx and daily caps |
| Cross-chain pivot | Possible | `tx_allowed_chains` enforced |
| Replay attacks | No protection | Idempotency keys |
| Credential exfil via tool result | Possible | Shroud redaction + output policy |
| Audit trail | None | Hash-chained, tamper-evident |
| Access revocation | Delete files | Instant (policy delete / JWT revoke) |
| Key rotation | Manual seed replacement | One CLI command |

## Relationship to mcp.base.org

The new [Base MCP](https://docs.base.org/ai-agents/quickstart) at `mcp.base.org` is a hosted remote server designed for interactive use. It uses OAuth and Base Account wallets — a human approves every transaction. It's the right choice for conversational use in Claude, ChatGPT, or Cursor.

This package serves a different need: agents that run autonomously without human-in-the-loop approval. Think trading bots, automated treasury management, multi-agent workflows, CI/CD pipelines. The guardrails are programmatic (value caps, allowlists, daily limits, simulation) rather than requiring a human to click "approve" each time.

They are alternatives, not companions — both expose the same AgentKit tools (transfers, Morpho, NFTs, Farcaster) but with different trust models. Pick one based on whether a human is present to approve actions.

## x402 Integration

This package works with 1Claw's x402 micropayment system. The agent pays per-request in USDC on Base via the Coinbase CDP facilitator. The whole loop is circular and on-chain:

```
Agent uses AgentKit to act onchain
  → pays 1Claw per-request in USDC on Base
  → signs via Intents API on Base
  → everything is on Base
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [1Claw](https://1claw.xyz) — AI Agent Secrets Management.
