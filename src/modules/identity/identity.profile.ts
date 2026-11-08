// Your own profile (Decision 66): change your own name. Only the name; role, email and status are
// never touched here.
import { recordAudit } from "@/modules/audit";
import type { Principal } from "@/shared/rbac/principal";
import { identityRepository } from "./identity.repository";

export const profileService = {
  async rename(
    principal: Principal,
    displayName: string,
    meta: { ip: string | null },
  ): Promise<{ displayName: string }> {
    await identityRepository.transaction(async (tx) => {
      await identityRepository.updateUser(tx, principal.userId, { displayName });
      await recordAudit(tx, {
        action: "user.renamed",
        targetType: "user",
        targetId: principal.userId,
        actorId: principal.userId,
        ip: meta.ip,
        details: { from: principal.displayName, to: displayName },
      });
    });
    return { displayName };
  },
};
