/**
 * Vault Bootstrap — resolves secrets from 1Claw Vault at MCP server startup.
 *
 * Replaces the .env file and claude_desktop_config.json plaintext secrets with
 * short-lived, in-memory credentials fetched via authenticated Vault API calls.
 */

import { OneclawClient } from "@1claw/sdk";

export interface BaseMcpSecrets {
  SEED_PHRASE?: string;
  COINBASE_API_KEY_NAME?: string;
  COINBASE_API_PRIVATE_KEY?: string;
  ALCHEMY_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  NEYNAR_API_KEY?: string;
}

export interface BootstrapConfig {
  apiUrl?: string;
  agentId?: string;
  agentApiKey?: string;
  vaultId?: string;
  /** Secret path prefix in the vault (default: "base-mcp/") */
  pathPrefix?: string;
}

const DEFAULT_SECRET_MAP: Record<keyof BaseMcpSecrets, string> = {
  SEED_PHRASE: "seed-phrase",
  COINBASE_API_KEY_NAME: "coinbase-api-key-name",
  COINBASE_API_PRIVATE_KEY: "coinbase-api-private-key",
  ALCHEMY_API_KEY: "alchemy-api-key",
  OPENROUTER_API_KEY: "openrouter-api-key",
  NEYNAR_API_KEY: "neynar-api-key",
};

function resolveConfig(): BootstrapConfig {
  return {
    apiUrl: process.env.ONECLAW_API_URL || "https://api.1claw.xyz",
    agentId: process.env.ONECLAW_AGENT_ID,
    agentApiKey: process.env.ONECLAW_AGENT_API_KEY,
    vaultId: process.env.ONECLAW_VAULT_ID,
    pathPrefix: process.env.ONECLAW_SECRET_PREFIX || "base-mcp/",
  };
}

export async function bootstrapSecrets(
  config?: Partial<BootstrapConfig>
): Promise<BaseMcpSecrets> {
  const cfg = { ...resolveConfig(), ...config };

  if (!cfg.agentApiKey) {
    throw new Error(
      "Missing ONECLAW_AGENT_API_KEY. Set it as an environment variable or pass in config."
    );
  }

  const client = new OneclawClient({
    baseUrl: cfg.apiUrl!,
    agentId: cfg.agentId,
    apiKey: cfg.agentApiKey,
  });

  const vaultId = cfg.vaultId || (await resolveVaultId(client));
  const prefix = cfg.pathPrefix || "base-mcp/";
  const secrets: BaseMcpSecrets = {};

  const entries = Object.entries(DEFAULT_SECRET_MAP) as [
    keyof BaseMcpSecrets,
    string,
  ][];

  const results = await Promise.allSettled(
    entries.map(async ([key, path]) => {
      try {
        const resp = await client.secrets.get(vaultId, `${prefix}${path}`);
        return { key, value: resp.data?.value };
      } catch {
        return { key, value: undefined };
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.value) {
      secrets[result.value.key] = result.value.value;
    }
  }

  const resolved = Object.keys(secrets).length;
  if (resolved === 0) {
    throw new Error(
      `No secrets resolved from vault ${vaultId} at prefix "${prefix}". ` +
        `Ensure secrets exist at paths like "${prefix}seed-phrase".`
    );
  }

  console.error(
    `[1claw] Bootstrapped ${resolved} secret(s) from vault (prefix: "${prefix}")`
  );
  return secrets;
}

async function resolveVaultId(client: OneclawClient): Promise<string> {
  const resp = await client.vault.list();
  const v = resp.data?.vaults?.[0];
  if (!v) {
    throw new Error(
      "No vaults found for this agent. Create a vault and store your Base MCP secrets."
    );
  }
  return v.id;
}

export function injectIntoEnv(secrets: BaseMcpSecrets): void {
  for (const [key, value] of Object.entries(secrets)) {
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
