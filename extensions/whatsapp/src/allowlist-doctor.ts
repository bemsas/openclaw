// Whatsapp plugin module migrates shipped LID-form allowlist entries.
import { DEFAULT_ACCOUNT_ID, resolveAccountEntry } from "openclaw/plugin-sdk/account-core";
import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { asObjectRecord } from "openclaw/plugin-sdk/runtime-doctor";
import { listWhatsAppAccountIds, resolveWhatsAppAuthDir } from "./accounts.js";
import { readWhatsAppLidToPnMappings } from "./lid-mapping-files.js";
import {
  parseWhatsAppDirectJidSyntax,
  stripWhatsAppTargetPrefixes,
} from "./whatsapp-jid-syntax.js";

function parseLidAllowFromEntry(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = parseWhatsAppDirectJidSyntax(stripWhatsAppTargetPrefixes(value));
  return parsed?.server === "lid" || parsed?.server === "hosted.lid" ? parsed : null;
}

function containsLidAllowFrom(value: unknown): boolean {
  const entry = asObjectRecord(value);
  return Array.isArray(entry?.allowFrom) && entry.allowFrom.some(parseLidAllowFromEntry);
}

export const whatsAppLidAllowFromLegacyRules: ChannelDoctorLegacyConfigRule[] = [
  {
    path: ["channels", "whatsapp"],
    message:
      "WhatsApp allowFrom contains LID JIDs. Run doctor --fix to migrate entries backed by verified LID→PN mappings; replace any unresolved entries with E.164 numbers.",
    match: containsLidAllowFrom,
  },
  {
    path: ["channels", "whatsapp", "accounts"],
    message:
      "A WhatsApp account allowFrom contains LID JIDs. Run doctor --fix to migrate entries backed by verified LID→PN mappings; replace any unresolved entries with E.164 numbers.",
    match: (value) => {
      const accounts = asObjectRecord(value);
      return Boolean(accounts && Object.values(accounts).some(containsLidAllowFrom));
    },
  },
];

function migrateLidAllowFrom(params: {
  allowFrom: unknown[];
  configPath: string;
  mappingScopes: readonly (readonly string[])[];
  changes: string[];
  warnings: string[];
}): unknown[] | null {
  let changed = false;
  const allowFrom = params.allowFrom.map((entry) => {
    const parsed = parseLidAllowFromEntry(entry);
    if (!parsed) {
      return entry;
    }
    const mappingsByScope = params.mappingScopes.map((mappingDirs) =>
      readWhatsAppLidToPnMappings({ lid: parsed.user, mappingDirs }),
    );
    const mappings = new Set(mappingsByScope.flat());
    const everyScopeMapped = mappingsByScope.every((scopeMappings) => scopeMappings.length === 1);
    if (!everyScopeMapped || mappings.size !== 1) {
      const reason =
        mappings.size <= 1
          ? "no verified LID→PN mapping was found"
          : "conflicting LID→PN mappings were found";
      params.warnings.push(
        `${params.configPath} entry "${String(entry).trim()}" was not migrated because ${reason}; replace it with the sender's E.164 number.`,
      );
      return entry;
    }
    const phoneDigits = [...mappings][0]?.slice(1);
    if (!phoneDigits) {
      return entry;
    }
    changed = true;
    params.changes.push(
      `Migrated ${params.configPath} entry "${String(entry).trim()}" → "${phoneDigits}" using its verified LID→PN mapping.`,
    );
    return phoneDigits;
  });
  return changed ? allowFrom : null;
}

function resolveRootAllowFromMappingScopes(params: {
  cfg: OpenClawConfig;
  accounts: Record<string, unknown> | null;
}): string[][] {
  const defaultEntry = asObjectRecord(
    resolveAccountEntry(params.accounts ?? undefined, DEFAULT_ACCOUNT_ID),
  );
  const defaultOverridesRoot = Array.isArray(defaultEntry?.allowFrom);
  return listWhatsAppAccountIds(params.cfg).flatMap((accountId) => {
    const accountEntry = asObjectRecord(
      resolveAccountEntry(params.accounts ?? undefined, accountId),
    );
    const accountOverridesRoot = Array.isArray(accountEntry?.allowFrom);
    if (
      accountOverridesRoot ||
      (accountId.trim().toLowerCase() !== DEFAULT_ACCOUNT_ID && defaultOverridesRoot)
    ) {
      return [];
    }
    return [[resolveWhatsAppAuthDir({ cfg: params.cfg, accountId }).authDir]];
  });
}

export function migrateWhatsAppLidAllowFromConfig(
  cfg: OpenClawConfig,
): ChannelDoctorConfigMutation {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const entry = asObjectRecord(channels?.whatsapp);
  if (!entry) {
    return { config: cfg, changes: [], warnings: [] };
  }

  const changes: string[] = [];
  const warnings: string[] = [];
  let nextEntry = entry;
  const accounts = asObjectRecord(entry.accounts);
  const rootAllowFrom = entry.allowFrom;
  if (Array.isArray(rootAllowFrom)) {
    const migrated = migrateLidAllowFrom({
      allowFrom: rootAllowFrom,
      configPath: "channels.whatsapp.allowFrom",
      mappingScopes: resolveRootAllowFromMappingScopes({ cfg, accounts }),
      changes,
      warnings,
    });
    if (migrated) {
      nextEntry = { ...nextEntry, allowFrom: migrated };
    }
  }

  let accountsChanged = false;
  const nextAccounts = accounts
    ? Object.fromEntries(
        Object.entries(accounts).map(([accountId, rawAccount]) => {
          const account = asObjectRecord(rawAccount);
          if (!account || !Array.isArray(account.allowFrom)) {
            return [accountId, rawAccount];
          }
          const migrated = migrateLidAllowFrom({
            allowFrom: account.allowFrom,
            configPath: `channels.whatsapp.accounts.${accountId}.allowFrom`,
            // LIDs are account-scoped. A mapping from another account must never
            // authorize a sender in this account's allowlist.
            mappingScopes: [[resolveWhatsAppAuthDir({ cfg, accountId }).authDir]],
            changes,
            warnings,
          });
          if (!migrated) {
            return [accountId, rawAccount];
          }
          accountsChanged = true;
          return [accountId, { ...account, allowFrom: migrated }];
        }),
      )
    : accounts;
  if (accountsChanged) {
    nextEntry = { ...nextEntry, accounts: nextAccounts };
  }
  if (nextEntry === entry) {
    return { config: cfg, changes, warnings: [...new Set(warnings)] };
  }
  return {
    config: {
      ...cfg,
      channels: {
        ...channels,
        whatsapp: nextEntry,
      },
    } as OpenClawConfig,
    changes,
    warnings: [...new Set(warnings)],
  };
}
