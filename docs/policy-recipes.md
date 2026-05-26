# Policy Recipes

Pre-built guardrail configurations for common Base MCP use cases. Copy-paste these into your agent setup.

## Conservative DeFi Bot

For yield farming, lending, and liquidity provision with strict safety rails.

```bash
1claw agent create \
  --name "defi-bot" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.05" \
  --tx-daily-limit "0.5" \
  --tx-to-allowlist "0xMorphoVault1,0xAavePool,0xUniswapRouter"
```

**Key constraints:**
- Max $125 per transaction (at $2,500/ETH)
- Max $1,250 per day total
- Only whitelisted DeFi protocol contracts
- Simulation required before every broadcast

## NFT Minting Agent

For minting and distributing NFTs with per-mint caps.

```bash
1claw agent create \
  --name "nft-minter" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.01" \
  --tx-daily-limit "0.1" \
  --tx-to-allowlist "0xYourNFTContract"
```

**Key constraints:**
- Max ~$25 per mint
- $250/day cap (covers gas for ~100 mints)
- Can only interact with your own NFT contract

## Farcaster Social Bot

For posting casts, following users, and resolving identities. No financial transactions needed.

```bash
1claw agent create \
  --name "farcaster-bot" \
  --shroud \
  --tx-allowed-chains "" \
  --tx-max-value "0" \
  --tx-daily-limit "0"
```

**Key constraints:**
- Zero transaction capability (social-only)
- Shroud inspects all LLM traffic for injection via Farcaster content
- Still needs vault access for Neynar API key

## Payment Relay

For accepting and forwarding payments with strict destination control.

```bash
1claw agent create \
  --name "payment-relay" \
  --intents-api \
  --tx-allowed-chains "base" \
  --tx-max-value "1.0" \
  --tx-daily-limit "10.0" \
  --tx-to-allowlist "0xTreasury,0xPayroll,0xVendor1,0xVendor2"
```

**Key constraints:**
- Higher per-tx limit for B2B payments
- Strict allowlist of approved recipients
- Consider enabling EIP-712 typed data signing for structured approvals

## Development / Testing (Base Sepolia)

Relaxed limits for testnet development.

```bash
1claw agent create \
  --name "base-dev" \
  --intents-api \
  --tx-allowed-chains "base" \
  --tx-max-value "10.0" \
  --tx-daily-limit "100.0"
```

Set `ONECLAW_CHAIN_ID=84532` in your MCP config to target Sepolia.

---

## Shroud Config Recipes

### High-Security (Financial Operations)

```json
{
  "pii_policy": "redact",
  "injection_threshold": 0.3,
  "enable_secret_redaction": true,
  "enable_response_filtering": true,
  "command_injection_detection": { "enabled": true, "action": "block" },
  "social_engineering_detection": { "enabled": true, "action": "block", "sensitivity": "high" },
  "network_detection": { "enabled": true, "action": "block" },
  "tool_call_inspection": {
    "enabled": true,
    "allowed_tool_names": ["get_balance", "get_morpho_vaults", "transfer_funds", "erc20_transfer"],
    "block_credential_exfil": true,
    "action": "block"
  },
  "output_policy": {
    "enabled": true,
    "block_harmful_content": true,
    "action": "block"
  }
}
```

### Medium-Security (Social + Limited Finance)

```json
{
  "pii_policy": "warn",
  "injection_threshold": 0.5,
  "enable_secret_redaction": true,
  "social_engineering_detection": { "enabled": true, "action": "warn" },
  "network_detection": { "enabled": true, "action": "warn" },
  "tool_call_inspection": {
    "enabled": true,
    "block_credential_exfil": true,
    "action": "warn"
  }
}
```

### Monitoring-Only (Development)

```json
{
  "pii_policy": "allow",
  "injection_threshold": 0.8,
  "enable_secret_redaction": true,
  "threat_logging": true,
  "sanitization_mode": "log_only"
}
```

---

## Vault Path Conventions

Recommended secret path layout for @1claw/agentkit:

```
agentkit/
├── seed-phrase              # BIP-39 mnemonic
├── coinbase-api-key-name   # Coinbase Developer Platform key name
├── coinbase-api-private-key # CDP private key (EC)
├── alchemy-api-key         # Alchemy RPC key
├── openrouter-api-key      # OpenRouter LLM key
└── neynar-api-key          # Neynar Farcaster API key
```

All stored under a single `agentkit/` prefix so one policy grants access to all:

```bash
1claw policy create \
  --paths "agentkit/*" \
  --permissions read
```

To restrict further (e.g., social bot only needs Neynar):

```bash
1claw policy create \
  --paths "agentkit/neynar-api-key" \
  --permissions read
```
