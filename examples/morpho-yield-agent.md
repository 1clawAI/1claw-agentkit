# Autonomous Morpho Yield Agent

A 24-hour autonomous agent that monitors Morpho USDC vault rates on Base, rebalances when spreads exceed a threshold, and posts updates to Farcaster — all with a $50 daily value cap enforced by the 1Claw Intents API.

## Architecture

```
Claude/Cursor
    │
    ├─► @1claw/mcp (vault tools: read rates, check balances)
    │
    └─► base-mcp-secure (Intents-backed)
         ├── get_morpho_vaults (read rates)
         ├── erc20_transfer (rebalance USDC between vaults)
         └── post to Farcaster (share updates)
```

## Agent Setup

### 1. Create the agent with guardrails

```bash
1claw agent create \
  --name "morpho-yield-bot" \
  --shroud \
  --intents-api \
  --tx-allowed-chains "base" \
  --tx-daily-limit "0.02" \
  --tx-max-value "0.01" \
  --tx-to-allowlist "0xMorphoVault1,0xMorphoVault2,0xUSDC"
```

### 2. Store secrets in the vault

```bash
1claw secret put agentkit/seed-phrase --value "your twelve word seed phrase here"
1claw secret put agentkit/alchemy-api-key --value "your_alchemy_key"
1claw secret put agentkit/neynar-api-key --value "your_neynar_key"
```

### 3. Create an access policy

```bash
1claw policy create \
  --vault-id $VAULT_ID \
  --principal-type agent \
  --principal-id $AGENT_ID \
  --paths "agentkit/*" \
  --permissions read
```

### 4. Run the agent

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_morpho_bot_key"
      }
    }
  }
}
```

## System Prompt

```
You are an autonomous yield optimization agent managing a USDC position on Base via Morpho.

Every hour:
1. Call get_morpho_vaults to check current APY rates
2. If the spread between your current vault and the best vault exceeds 0.5%, rebalance
3. Post a Farcaster update with your current position and APY

Constraints (enforced by 1Claw Intents API — you cannot override these):
- Maximum $50/day total transaction value
- Maximum $10 per individual transaction
- Only allowed to interact with whitelisted Morpho vault contracts
- Only Base chain (cannot pivot to mainnet or other L2s)
- Every transaction is simulated via Tenderly before broadcast

If you encounter an error or anomalous rate (>100% APY), STOP and report rather than transact.
```

## Security Guarantees

| Threat | Mitigation |
|--------|-----------|
| Seed phrase exfiltration | Never on disk. MPC client custody (Pro+) means even a 1Claw breach can't reconstruct it. |
| Prompt injection via Farcaster bio | Shroud's 11-layer pipeline detects and blocks injection attempts before the model processes them. |
| Unlimited spend | `tx_daily_limit_eth: 0.02` (~$50) hard cap, enforced server-side in TEE. |
| Rug-pull contract interaction | `tx_to_allowlist` restricts destinations to known Morpho vaults only. |
| Replay attack | Idempotency keys on every transaction prevent duplicate broadcasts. |
| Cross-chain pivot | `tx_allowed_chains: ["base"]` — cannot be overridden by the agent. |

## Livestream Challenge

Leave this agent running on a public livestream for 7 days with $5K USDC in the wallet:

- All transactions visible on Basescan
- Shroud activity dashboard open (threats tab)
- Daily P&L reporting via Farcaster

If the wallet isn't drained after a week of being publicly targeted, the security story tells itself.
