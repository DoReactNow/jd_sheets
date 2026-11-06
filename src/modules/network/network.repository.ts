// Database access for the network module. Writes only network_* tables.
import { getPrisma } from "@/shared/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { instantFromEpochMs } from "@/shared/time";

export type Tx = Prisma.TransactionClient;

const ruleSelect = {
  id: true,
  cidr: true,
  label: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
} satisfies Prisma.IpRuleSelect;

export type RuleRow = Prisma.IpRuleGetPayload<{ select: typeof ruleSelect }>;

export const networkRepository = {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(fn);
  },
  listRules(tx?: Tx): Promise<RuleRow[]> {
    return (tx ?? getPrisma()).ipRule.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: ruleSelect,
    });
  },
  findRule(id: string, tx?: Tx) {
    return (tx ?? getPrisma()).ipRule.findUnique({ where: { id }, select: ruleSelect });
  },
  findRuleByCidr(cidr: string, tx: Tx) {
    return tx.ipRule.findUnique({ where: { cidr }, select: ruleSelect });
  },
  createRule(
    tx: Tx,
    data: { cidr: string; label: string; enabled: boolean; createdById: string | null },
  ) {
    return tx.ipRule.create({
      data: { ...data, updatedById: data.createdById },
      select: ruleSelect,
    });
  },
  updateRule(
    tx: Tx,
    id: string,
    data: { cidr?: string; label?: string; enabled?: boolean; updatedById: string | null },
  ) {
    return tx.ipRule.update({ where: { id }, data, select: ruleSelect });
  },
  deleteRule(tx: Tx, id: string) {
    return tx.ipRule.delete({ where: { id } });
  },
  deleteAllRules(tx: Tx) {
    return tx.ipRule.deleteMany({});
  },
  async lockRules(tx: Tx): Promise<void> {
    // Serialises rule changes, so two admins cannot together remove every allowed range.
    await tx.$executeRaw`LOCK TABLE network_ip_rules IN SHARE ROW EXCLUSIVE MODE`;
  },
  countRules: () => getPrisma().ipRule.count(),

  recordBlocked(data: { ip: string; method: string; path: string }) {
    return getPrisma().blockedRequest.create({ data });
  },
  recentBlocked(limit: number) {
    return getPrisma().blockedRequest.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  },
  pruneBlocked(now: Date, days: number) {
    return getPrisma().blockedRequest.deleteMany({
      where: { createdAt: { lt: instantFromEpochMs(now.getTime() - days * 86_400_000) } },
    });
  },
};
