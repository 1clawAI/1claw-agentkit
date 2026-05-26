# Migration Guide

> **Note:** The `base-mcp` npm package (`@coinbase/base-mcp`) has been deprecated and archived. If you were using it, you have two paths forward:
>
> - **[mcp.base.org](https://docs.base.org/ai-agents/quickstart)** — Remote hosted MCP with OAuth wallet and human approval per transaction. Best for interactive use in Claude, ChatGPT, or Cursor.
> - **@1claw/base-mcp-secure** — Self-hosted AgentKit MCP with TEE signing and programmatic guardrails. Best for autonomous agents that run without human-in-the-loop approval.
>
> This guide covers migrating to `@1claw/base-mcp-secure` for autonomous agent use cases.

## Before: Plaintext Secrets

If you were running AgentKit (or the old base-mcp) locally, your config likely looked like this:

```json
{
  "mcpServers": {
    "base-agent": {
      "command": "npx",
      "args": ["-y", "@coinbase/agentkit"],
      "env": {
        "SEED_PHRASE": "abandon ability able about above absent absorb ...",
        "COINBASE_API_KEY_NAME": "organizations/xxx/apiKeys/yyy",
        "COINBASE_API_PRIVATE_KEY": "-----BEGIN EC PRIVATE KEY-----\nMHQ...",
        "ALCHEMY_API_KEY": "abcdef123456",
        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "NEYNAR_API_KEY": "NEYNAR-..."
      }
    }
  }
}
```

**Problems:**
- Seed phrase in plaintext on disk
- Private keys readable by any process with file access
- No transaction limits — a prompt injection can drain the wallet
- No audit trail of agent actions
- No way to revoke access without deleting the config

## After: Secured Setup

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_agent_key"
      }
    }
  }
}
```

**One env var. Zero secrets on disk.**

## Migration Steps

### Step 1: Create a 1Claw Account (2 min)

```bash
# Sign up at https://1claw.xyz or use the CLI
npx @1claw/cli login
```

### Step 2: Create a Vault and Store Your Secrets (3 min)

```bash
# Create a vault for your agent secrets
1claw vault create --name "base-agent-keys"

# Store each secret (they get encrypted with HSM-backed envelope encryption)
1claw secret put agentkit/seed-phrase --value "your seed phrase here"
1claw secret put agentkit/coinbase-api-key-name --value "organizations/xxx/apiKeys/yyy"
1claw secret put agentkit/coinbase-api-private-key --value "-----BEGIN EC PRIVATE KEY-----..."
1claw secret put agentkit/alchemy-api-key --value "abcdef123456"
1claw secret put agentkit/openrouter-api-key --value "sk-or-v1-..."
1claw secret put agentkit/neynar-api-key --value "NEYNAR-..."
```

### Step 3: Register an Agent (2 min)

```bash
# Create an agent with Base-specific guardrails
npx @1claw/cli agent create \
  --name "base-mcp-agent" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.1" \
  --tx-daily-limit "1.0"
```

Save the `ocv_` API key that's returned — this is the only credential you put in your config.

### Step 4: Create an Access Policy (1 min)

```bash
1claw policy create \
  --vault-id YOUR_VAULT_ID \
  --principal-type agent \
  --principal-id YOUR_AGENT_ID \
  --paths "agentkit/*" \
  --permissions read
```

### Step 5: Update Your Config (1 min)

Replace your MCP config entry:

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_agent_key"
      }
    }
  }
}
```

### Step 6: Delete Your Old Secrets

```bash
# Once you've confirmed the secured setup works:
rm .env
# Remove secrets from claude_desktop_config.json or .cursor/mcp.json
```

## What Changed

| Aspect | Before | After |
|--------|--------|-------|
| Seed phrase location | `.env` file on disk | 1Claw Vault (HSM-encrypted, MPC optional) |
| Transaction signing | Local (unguarded) | TEE (guardrails enforced) |
| Daily spend limit | None | Configurable (default: 1 ETH) |
| Address allowlist | None | Configurable |
| Prompt injection defense | None | Shroud 11-layer pipeline |
| Audit trail | None | Full, hash-chained, tamper-evident |
| Access revocation | Delete config file | Instant via policy deletion or JWT revocation |
| Key rotation | Manual, risky | One CLI command |

## Optional: Enable Shroud LLM Proxy

For defense against prompt injection via tool results, user inputs, or malicious contexts:

```bash
npx @1claw/cli agent update YOUR_AGENT_ID --shroud true
```

This routes all LLM calls through Shroud's inspection pipeline before they reach the model, blocking injection attempts in real time.

## Or Use mcp.base.org Instead

If your use case is interactive (a human reviews each transaction), the new [Base MCP](https://docs.base.org/ai-agents/quickstart) at `mcp.base.org` is simpler to set up:

1. Connect the remote MCP server URL: `https://mcp.base.org`
2. Sign in with Base Account (OAuth)
3. Approve each transaction when prompted

No keys, no vault, no agent credentials needed. The trade-off is that every action requires human approval — there's no autonomous mode.

## Rollback

If you need to go back temporarily, just swap your MCP config entry back to a standard AgentKit setup with env vars. Your secrets remain safely stored in 1Claw for when you're ready to switch back.
