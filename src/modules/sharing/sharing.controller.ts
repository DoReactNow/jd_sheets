// HTTP side of the sharing module. Imported only by src/app (architecture rule 2).
import type { z } from "zod";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import { clientIp } from "@/shared/http/clientIp";
import type { RouteContext } from "@/shared/http/route";
import * as schemas from "./sharing.schemas";
import { sharingService } from "./sharing.service";

export { schemas as sharingSchemas };

type Ctx<I = undefined, P = { id: string }> = RouteContext<I, P>;

function meta(request: Request) {
  const ip = clientIp(request.headers, getEnv().TRUSTED_PROXY_HOPS);
  return { ip: ip === "unknown" ? null : ip };
}

function principalOf<I, P>(context: RouteContext<I, P>) {
  if (!context.principal) throw new AppError("UNAUTHENTICATED");
  return context.principal;
}

const ok = { ok: true } as const;

export const sharingController = {
  /** GET /api/workbooks/:id/shares (share) */
  async get({ params }: Ctx) {
    return { data: await sharingService.get(params.id) };
  },
  /** PUT /api/workbooks/:id/shares (share) */
  async share(context: Ctx<z.output<typeof schemas.shareInput>>) {
    return {
      data: await sharingService.share(
        principalOf(context),
        context.params.id,
        context.input,
        meta(context.request),
      ),
    };
  },
  /** PATCH /api/workbooks/:id/shares/:grantId (share) */
  async changeGrant(
    context: Ctx<z.output<typeof schemas.changeGrantInput>, { id: string; grantId: string }>,
  ) {
    return {
      data: await sharingService.changeGrant(
        principalOf(context),
        context.params.id,
        context.params.grantId,
        context.input.role,
        meta(context.request),
      ),
    };
  },
  /** DELETE /api/workbooks/:id/shares/:grantId (share) */
  async removeGrant(context: Ctx<undefined, { id: string; grantId: string }>) {
    await sharingService.removeGrant(
      principalOf(context),
      context.params.id,
      context.params.grantId,
      meta(context.request),
    );
    return { data: ok };
  },
  /** PUT /api/workbooks/:id/link (share) */
  async setLink(context: Ctx<z.output<typeof schemas.linkInput>>) {
    await sharingService.setLink(
      principalOf(context),
      context.params.id,
      context.input.role,
      meta(context.request),
    );
    return { data: ok };
  },
  /** PUT /api/workbooks/:id/settings (share) */
  async setSettings(context: Ctx<z.output<typeof schemas.settingsInput>>) {
    await sharingService.setDownload(
      principalOf(context),
      context.params.id,
      context.input.allowDownloadForReaders,
      meta(context.request),
    );
    return { data: ok };
  },
  /** GET /api/share-targets?q= */
  async targets({
    input,
  }: Ctx<z.output<typeof schemas.shareTargetsInput>, Record<string, string>>) {
    return { data: await sharingService.targets(input.q) };
  },
  /** DELETE /api/admin/groups/:id[?confirm=1] (groups:manage) */
  async deleteGroup(context: Ctx) {
    const confirm = new URL(context.request.url).searchParams.get("confirm") === "1";
    await sharingService.deleteGroup(
      principalOf(context),
      context.params.id,
      confirm,
      meta(context.request),
    );
    return { data: ok };
  },
  /** POST /api/admin/workbooks/:id/transfer (workbooks:administer) */
  async transfer(context: Ctx<z.output<typeof schemas.transferInput>>) {
    await sharingService.transferOwnership(
      principalOf(context),
      context.params.id,
      context.input.newOwnerId,
      meta(context.request),
    );
    return { data: ok };
  },
};
