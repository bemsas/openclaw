import { describe, expect, it } from "vitest";
import {
  pushAgentCapabilityChanges,
  pushResolvedAgentCapabilityChanges,
} from "./update-capability-changes.js";

describe("pushAgentCapabilityChanges", () => {
  it("classifies effective sandbox and heartbeat changes", () => {
    const changes: Parameters<typeof pushAgentCapabilityChanges>[0]["changes"] = [];
    pushAgentCapabilityChanges({
      changes,
      agentId: "worker",
      currentAgent: { sandbox: { mode: "all" }, heartbeat: { every: "1h" } },
      desiredAgent: { sandbox: { mode: "off" }, heartbeat: { every: "5m" } },
      currentSandbox: { mode: "all" },
      desiredSandbox: { mode: "off" },
      currentHeartbeat: { every: "1h" },
      desiredHeartbeat: { every: "5m" },
    });
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "agent.sandbox.mode",
          classification: "escalation",
          requiresDistinctConsent: true,
        }),
        expect.objectContaining({
          path: "agent.heartbeat.every",
          classification: "escalation",
          requiresDistinctConsent: true,
        }),
      ]),
    );

    const inherited: typeof changes = [];
    pushAgentCapabilityChanges({
      changes: inherited,
      agentId: "worker",
      currentAgent: { sandbox: { mode: "all" }, heartbeat: { every: "1h" } },
      desiredAgent: {},
      currentSandbox: { mode: "all" },
      desiredSandbox: { mode: "off" },
      currentHeartbeat: { every: "1h" },
      desiredHeartbeat: { every: "5m" },
    });
    expect(inherited).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "agent.sandbox.mode",
          classification: "escalation",
          requiresDistinctConsent: true,
          desired: expect.objectContaining({ summary: "off" }),
        }),
        expect.objectContaining({
          path: "agent.heartbeat.every",
          classification: "escalation",
          requiresDistinctConsent: true,
          current: expect.objectContaining({ summary: "1h" }),
          desired: expect.objectContaining({ summary: "5m" }),
        }),
      ]),
    );
  });

  it("resolves the implicit heartbeat interval", () => {
    const changes: Parameters<typeof pushAgentCapabilityChanges>[0]["changes"] = [];
    pushResolvedAgentCapabilityChanges({
      changes,
      agentId: "main",
      config: {
        agents: { list: [{ id: "main", heartbeat: { every: "1h" } }] },
      },
      desiredAgent: { id: "main" },
    });
    expect(changes).toContainEqual(
      expect.objectContaining({
        path: "agent.heartbeat.every",
        classification: "escalation",
        requiresDistinctConsent: true,
        current: expect.objectContaining({ summary: "1h" }),
        desired: expect.objectContaining({ summary: "30m" }),
      }),
    );
  });

  it("ranks sandbox mode and sharing scope", () => {
    const changes: Parameters<typeof pushAgentCapabilityChanges>[0]["changes"] = [];
    pushAgentCapabilityChanges({
      changes,
      agentId: "worker",
      currentAgent: { sandbox: { mode: "off", scope: "shared" } },
      desiredAgent: { sandbox: { mode: "all", scope: "session" } },
      currentSandbox: { mode: "off", scope: "shared" },
      desiredSandbox: { mode: "all", scope: "session" },
    });
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "agent.sandbox.mode",
          classification: "reduction",
          requiresDistinctConsent: false,
        }),
        expect.objectContaining({
          path: "agent.sandbox.scope",
          classification: "reduction",
          requiresDistinctConsent: false,
        }),
      ]),
    );

    const widened: typeof changes = [];
    pushAgentCapabilityChanges({
      changes: widened,
      agentId: "worker",
      currentAgent: { sandbox: { scope: "session" } },
      desiredAgent: { sandbox: { scope: "shared" } },
      currentSandbox: { scope: "session" },
      desiredSandbox: { scope: "shared" },
    });
    expect(widened).toContainEqual(
      expect.objectContaining({
        path: "agent.sandbox.scope",
        classification: "escalation",
        requiresDistinctConsent: true,
      }),
    );
  });

  it("classifies tool restrictions by effective set membership", () => {
    const substituted: Parameters<typeof pushAgentCapabilityChanges>[0]["changes"] = [];
    pushAgentCapabilityChanges({
      changes: substituted,
      agentId: "worker",
      currentAgent: { tools: { deny: ["exec"] } },
      desiredAgent: { tools: { deny: ["read", "write"] } },
    });
    expect(substituted).toContainEqual(
      expect.objectContaining({
        path: "agent.tools.deny",
        classification: "escalation",
        requiresDistinctConsent: true,
      }),
    );

    for (const field of ["allow", "deny"] as const) {
      const added: typeof substituted = [];
      pushAgentCapabilityChanges({
        changes: added,
        agentId: "worker",
        currentAgent: {},
        desiredAgent: { tools: { [field]: ["exec"] } },
      });
      expect(added).toContainEqual(
        expect.objectContaining({
          path: `agent.tools.${field}`,
          classification: "reduction",
          requiresDistinctConsent: false,
        }),
      );

      const removed: typeof substituted = [];
      pushAgentCapabilityChanges({
        changes: removed,
        agentId: "worker",
        currentAgent: { tools: { [field]: ["exec"] } },
        desiredAgent: {},
      });
      expect(removed).toContainEqual(
        expect.objectContaining({
          path: `agent.tools.${field}`,
          classification: "escalation",
          requiresDistinctConsent: true,
        }),
      );
    }
  });
});
