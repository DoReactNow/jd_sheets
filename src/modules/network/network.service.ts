// The app's IP allowlist (Decisions 18, 46). The rules are cached for a few seconds in each process
// and the cache is cleared on every change. A change that would lock out the person making it,
// or leave no enabled range, is refused.
import { recentAuditEvents, recordAudit } from "@/modules/audit";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import { clientIpFromForwarded } from "@/shared/http/clientIp";
import type { NetworkDecision, NetworkRequest } from "@/shared/http/networkGuard";
import { logger } from "@/shared/logger";
import type { Principal } from "@/shared/rbac/principal";
import { systemClock, toIsoInstant, type Clock } from "@/shared/time";
import { anyContains, parseCidr, type Cidr } from "./network.cidr";
import { networkRepository, type RuleRow } from "./network.repository";

export interface RuleDto {
  id: string;
  cidr: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  cidr: string;
  label: string;
  enabled: boolean;
}

const toDto = (row: RuleRow): RuleDto => ({
  id: row.id,
  cidr: parseCidr(row.cidr)?.text ?? row.cidr,
  label: row.label,
  enabled: row.enabled,
  createdAt: toIsoInstant(row.createdAt),
  updatedAt: toIsoInstant(row.updatedAt),
});

function fieldError(field: string, message: string): AppError {
  return new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });
}

export function parseRuleCidr(text: string): Cidr {
  const cidr = parseCidr(text);
  if (!cidr)
    throw fieldError("cidr", "Enter an address or range, like 203.0.113.7 or 203.0.113.0/24.");
  return cidr;
}

/** The caller's address, read the same way as the Rust service reads it. */
export function requestIp(headers: Headers): string | null {
  return clientIpFromForwarded(headers.get("x-forwarded-for"), getEnv().TRUSTED_PROXY_HOPS);
}

let enforcementForTests: boolean | null = null;

/** Test-only: turn enforcement on or off regardless of the env file (null restores it). */
export function setNetworkEnforcementForTests(value: boolean | null): void {
  if (getEnv().APP_ENV !== "test") throw new Error("only when APP_ENV=test");
  enforcementForTests = value;
}

/** How often one person's outside access from one address is audited (Decision 57). */
const OUTSIDE_AUDIT_EVERY_MS = 10 * 60 * 1000;
const outsideSeen = new Map<string, number>();

export function createNetworkService({
  clock = systemClock,
  enforced = () => enforcementForTests ?? getEnv().NETWORK_ENFORCEMENT === "on",
}: { clock?: Clock; enforced?: () => boolean } = {}) {
  let cache: { cidrs: Cidr[]; at: number } | null = null;
  const ttlMs = APP_CONFIG.network.cacheSeconds * 1000;

  async function enabledCidrs(): Promise<Cidr[]> {
    const now = clock.now().getTime();
    if (cache && now - cache.at < ttlMs) return cache.cidrs;
    const rules = await networkRepository.listRules();
    const cidrs = rules
      .filter((rule) => rule.enabled)
      .flatMap((rule) => parseCidr(rule.cidr) ?? []);
    cache = { cidrs, at: now };
    return cidrs;
  }

  const invalidate = () => {
    cache = null;
  };

  /** Checks a would-be rule set against the person's own address and refuses empty sets. */
  function assertSafe(resulting: RuleInput[], ownIp: string | null) {
    const enabled = resulting
      .filter((rule) => rule.enabled)
      .flatMap((rule) => parseCidr(rule.cidr) ?? []);
    if (enabled.length === 0) {
      throw new AppError("CONFLICT", {
        fieldErrors: [{ field: "_root", message: "Keep at least one allowed range enabled." }],
      });
    }
    if (enforced() && !anyContains(enabled, ownIp)) {
      throw new AppError("CONFLICT", {
        fieldErrors: [
          {
            field: "_root",
            message: `This would block your own address (${ownIp ?? "unknown"}). Add a range that includes it first.`,
          },
        ],
      });
    }
  }

  async function change(
    actor: Principal,
    ownIp: string | null,
    action: string,
    apply: (rules: RuleRow[]) => {
      next: RuleInput[];
      write: (
        tx: Parameters<Parameters<typeof networkRepository.transaction>[0]>[0],
      ) => Promise<RuleRow | null>;
    },
  ): Promise<RuleDto | null> {
    const result = await networkRepository.transaction(async (tx) => {
      await networkRepository.lockRules(tx);
      const rules = await networkRepository.listRules(tx);
      const { next, write } = apply(rules);
      assertSafe(next, ownIp);
      const row = await write(tx);
      await recordAudit(tx, {
        action,
        targetType: "ipRule",
        targetId: row?.id ?? null,
        actorId: actor.userId,
        ip: ownIp,
        details: row
          ? { cidr: parseCidr(row.cidr)?.text, label: row.label, enabled: row.enabled }
          : {},
      });
      return row;
    });
    invalidate();
    return result ? toDto(result) : null;
  }

  const asInput = (rule: RuleRow): RuleInput => ({
    cidr: rule.cidr,
    label: rule.label,
    enabled: rule.enabled,
  });

  return {
    /** The guard installed for every page and API route (P1-NET-01, -02, -12). */
    async check(request: NetworkRequest): Promise<NetworkDecision> {
      if (!enforced()) return { allowed: true };
      const ip = requestIp(request.headers);
      if (anyContains(await enabledCidrs(), ip)) return { allowed: true };
      networkRepository
        .recordBlocked({
          ip: ip ?? "unknown",
          method: request.method.slice(0, 10),
          path: request.path.slice(0, 300),
        })
        .catch((error: unknown) =>
          logger.warn("could not record a blocked request", { err: error }),
        );
      logger.warn("request blocked by the network rules", { ip, path: request.path });
      return { allowed: false, ip };
    },

    async list(): Promise<RuleDto[]> {
      return (await networkRepository.listRules()).map(toDto);
    },

    /**
     * A Super Admin working from outside the allowed networks (Decision 57): audited at most once
     * per person and address every 10 minutes, so the trail shows it without flooding.
     */
    async recordOutsideAccess(input: { userId: string; ip: string | null; path: string }) {
      const key = `${input.userId}|${input.ip ?? "unknown"}`;
      const now = clock.now().getTime();
      const last = outsideSeen.get(key);
      if (last !== undefined && now - last < OUTSIDE_AUDIT_EVERY_MS) return;
      outsideSeen.set(key, now);
      await networkRepository.transaction((tx) =>
        recordAudit(tx, {
          action: "network.outsideAccess",
          targetType: "user",
          targetId: input.userId,
          actorId: input.userId,
          ip: input.ip,
          details: { kind: "request", path: input.path.slice(0, 200) },
        }),
      );
    },

    /** The newest outside-access events, for the Network page. */
    async recentOutsideAccess(limit = 20) {
      return (await recentAuditEvents("network.outsideAccess", limit)).map((row) => ({
        id: row.id,
        ip: row.ip,
        who: row.actor?.displayName ?? "",
        email: row.actor?.email ?? "",
        kind: (row.details as { kind?: string }).kind ?? "request",
        at: toIsoInstant(row.createdAt),
      }));
    },

    async recentBlocked(limit = 50) {
      return (await networkRepository.recentBlocked(limit)).map((row) => ({
        id: String(row.id),
        ip: row.ip,
        method: row.method,
        path: row.path,
        at: toIsoInstant(row.createdAt),
      }));
    },

    async create(actor: Principal, ownIp: string | null, input: RuleInput): Promise<RuleDto> {
      const cidr = parseRuleCidr(input.cidr);
      const created = await change(actor, ownIp, "network.rule_created", (rules) => {
        if (rules.some((rule) => parseCidr(rule.cidr)?.text === cidr.text)) {
          throw new AppError("CONFLICT", {
            fieldErrors: [{ field: "cidr", message: "This range is already in the list." }],
          });
        }
        return {
          next: [...rules.map(asInput), { ...input, cidr: cidr.text }],
          write: (tx) =>
            networkRepository.createRule(tx, {
              cidr: cidr.text,
              label: input.label,
              enabled: input.enabled,
              createdById: actor.userId,
            }),
        };
      });
      return created!;
    },

    async update(
      actor: Principal,
      ownIp: string | null,
      id: string,
      input: Partial<RuleInput>,
    ): Promise<RuleDto> {
      const cidr = input.cidr !== undefined ? parseRuleCidr(input.cidr) : undefined;
      const updated = await change(actor, ownIp, "network.rule_updated", (rules) => {
        const current = rules.find((rule) => rule.id === id);
        if (!current) throw new AppError("NOT_FOUND");
        if (
          cidr &&
          rules.some((rule) => rule.id !== id && parseCidr(rule.cidr)?.text === cidr.text)
        ) {
          throw new AppError("CONFLICT", {
            fieldErrors: [{ field: "cidr", message: "This range is already in the list." }],
          });
        }
        const replacement: RuleInput = {
          cidr: cidr?.text ?? current.cidr,
          label: input.label ?? current.label,
          enabled: input.enabled ?? current.enabled,
        };
        return {
          next: rules.map((rule) => (rule.id === id ? replacement : asInput(rule))),
          write: (tx) =>
            networkRepository.updateRule(tx, id, { ...replacement, updatedById: actor.userId }),
        };
      });
      return updated!;
    },

    async remove(actor: Principal, ownIp: string | null, id: string): Promise<void> {
      await change(actor, ownIp, "network.rule_deleted", (rules) => {
        const current = rules.find((rule) => rule.id === id);
        if (!current) throw new AppError("NOT_FOUND");
        return {
          next: rules.filter((rule) => rule.id !== id).map(asInput),
          write: async (tx) => {
            await networkRepository.deleteRule(tx, id);
            return current;
          },
        };
      });
    },

    /** First start: write BOOTSTRAP_ALLOWED_CIDRS when there are no rules at all (P1-NET-15). */
    async bootstrap(): Promise<number> {
      if ((await networkRepository.countRules()) > 0) return 0;
      const cidrs = getEnv()
        .BOOTSTRAP_ALLOWED_CIDRS.split(/[\s,]+/)
        .filter(Boolean)
        .map((text) => parseCidr(text))
        .filter((cidr): cidr is Cidr => cidr !== null);
      if (cidrs.length === 0) return 0;
      await networkRepository.transaction(async (tx) => {
        await networkRepository.lockRules(tx);
        if ((await networkRepository.listRules(tx)).length > 0) return;
        for (const cidr of cidrs) {
          await networkRepository.createRule(tx, {
            cidr: cidr.text,
            label: "Initial range",
            enabled: true,
            createdById: null,
          });
        }
        await recordAudit(tx, {
          action: "network.bootstrapped",
          targetType: "ipRule",
          actorId: null,
          actorKind: "SYSTEM",
          details: { ranges: cidrs.map((c) => c.text) },
        });
      });
      invalidate();
      return cidrs.length;
    },

    /** Recovery command: replace every rule with one range (P1-NET-14). */
    async resetTo(text: string): Promise<string> {
      const cidr = parseCidr(text);
      if (!cidr) throw new Error(`not an address or range: ${text}`);
      await networkRepository.transaction(async (tx) => {
        await networkRepository.lockRules(tx);
        await networkRepository.deleteAllRules(tx);
        await networkRepository.createRule(tx, {
          cidr: cidr.text,
          label: "Recovery",
          enabled: true,
          createdById: null,
        });
        await recordAudit(tx, {
          action: "network.reset",
          targetType: "ipRule",
          actorId: null,
          actorKind: "SYSTEM",
          details: { cidr: cidr.text, via: "recovery command" },
        });
      });
      invalidate();
      return cidr.text;
    },

    invalidate,
  };
}

export const networkService = createNetworkService();
