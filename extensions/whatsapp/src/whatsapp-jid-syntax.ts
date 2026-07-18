// Whatsapp plugin module owns dependency-free JID syntax checks.

// Baileys encodes direct JIDs as user[_agent][:device]@server. Validate every
// numeric component before its normalizer strips agent and device metadata.
const DIRECT_LOCAL_PART_RE = /^(\d+)(?:_\d+)?(?::\d+)?$/;
const GROUP_LOCAL_PART_RE = /^[0-9]+(?:-[0-9]+)*$/;
const NUMERIC_LOCAL_PART_RE = /^\d+$/;

type WhatsAppDirectJidSyntaxServer = "s.whatsapp.net" | "c.us" | "hosted" | "lid" | "hosted.lid";

const DIRECT_JID_SERVERS = new Set<WhatsAppDirectJidSyntaxServer>([
  "s.whatsapp.net",
  "c.us",
  "hosted",
  "lid",
  "hosted.lid",
]);

type WhatsAppJidSyntax = {
  kind: "pn" | "lid" | "group" | "newsletter";
  user: string;
  server: WhatsAppDirectJidSyntaxServer | "g.us" | "newsletter";
  input: string;
};

export function parseWhatsAppJidSyntax(value: string | null | undefined): WhatsAppJidSyntax | null {
  const trimmed = value?.trim();
  const separatorIndex = trimmed?.indexOf("@") ?? -1;
  if (!trimmed || separatorIndex <= 0 || separatorIndex !== trimmed.lastIndexOf("@")) {
    return null;
  }

  const localPart = trimmed.slice(0, separatorIndex);
  const server = trimmed.slice(separatorIndex + 1).toLowerCase();
  if (DIRECT_JID_SERVERS.has(server as WhatsAppDirectJidSyntaxServer)) {
    const user = DIRECT_LOCAL_PART_RE.exec(localPart)?.[1];
    if (!user) {
      return null;
    }
    return {
      kind: server === "lid" || server === "hosted.lid" ? "lid" : "pn",
      user,
      server: server as WhatsAppDirectJidSyntaxServer,
      input: `${localPart}@${server}`,
    };
  }
  if (server === "g.us" && GROUP_LOCAL_PART_RE.test(localPart)) {
    return { kind: "group", user: localPart, server, input: `${localPart}@${server}` };
  }
  if (server === "newsletter" && NUMERIC_LOCAL_PART_RE.test(localPart)) {
    return { kind: "newsletter", user: localPart, server, input: `${localPart}@${server}` };
  }
  return null;
}

export function parseWhatsAppDirectJidSyntax(
  value: string | null | undefined,
): { user: string; server: WhatsAppDirectJidSyntaxServer } | null {
  const parsed = parseWhatsAppJidSyntax(value);
  return parsed?.kind === "pn" || parsed?.kind === "lid"
    ? { user: parsed.user, server: parsed.server as WhatsAppDirectJidSyntaxServer }
    : null;
}

export function stripWhatsAppTargetPrefixes(value: string): string {
  let candidate = value.trim();
  for (;;) {
    const before = candidate;
    candidate = candidate.replace(/^whatsapp:/i, "").trim();
    if (candidate === before) {
      return candidate;
    }
  }
}

export function canonicalizeWhatsAppGroupJid(value: string | null | undefined): string | null {
  const parsed = parseWhatsAppJidSyntax(value);
  return parsed?.kind === "group" ? parsed.input : null;
}
