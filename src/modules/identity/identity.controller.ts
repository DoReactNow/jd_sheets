// HTTP side of the identity module. Imported only by src/app (architecture rule 2).
import type { z } from "zod";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import { clientIp } from "@/shared/http/clientIp";
import type { HandlerResult, RouteContext } from "@/shared/http/route";
import { readSessionToken, SESSION_COOKIE } from "@/shared/http/sessionCookie";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { adminService, type AdminUserDto } from "./identity.admin";
import { authService } from "./identity.auth";
import { enqueueOtpMail } from "./identity.jobs";
import * as schemas from "./identity.schemas";
import { createSignupService } from "./identity.signup";
import { groupsService } from "./identity.groups";

export { schemas as identitySchemas };

type Ctx<I = undefined, P = Record<string, string>> = RouteContext<I, P>;

const signupService = createSignupService({ enqueueOtpMail });

function meta(request: Request) {
  const ip = clientIp(request.headers, getEnv().TRUSTED_PROXY_HOPS);
  return { ip: ip === "unknown" ? null : ip, userAgent: request.headers.get("user-agent") };
}

function principalOf<I, P>(context: RouteContext<I, P>) {
  if (!context.principal) throw new AppError("UNAUTHENTICATED");
  return context.principal;
}

const secureCookies = () => getEnv().APP_ENV === "production";

export function sessionCookie(token: string): string {
  const maxAge = APP_CONFIG.auth.sessionMaxDays * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}; Max-Age=${maxAge}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}; Max-Age=0`;
}

const ok = { ok: true } as const;

export const identityController = {
  // --- auth ----------------------------------------------------------------------------------
  async signIn({
    input,
    request,
  }: Ctx<z.output<typeof schemas.signInInput>>): Promise<
    HandlerResult<{ mustChangePassword: boolean }>
  > {
    const { token, mustChangePassword } = await authService.signIn(input, meta(request));
    return { data: { mustChangePassword }, headers: { "set-cookie": sessionCookie(token) } };
  },

  async signOut({ request }: Ctx): Promise<HandlerResult<typeof ok>> {
    await authService.signOut(readSessionToken(request.headers), meta(request));
    return { data: ok, headers: { "set-cookie": clearedSessionCookie() } };
  },

  async me(context: Ctx) {
    const principal = principalOf(context);
    return {
      data: {
        userId: principal.userId,
        displayName: principal.displayName,
        email: principal.email,
        role: principal.roleCode,
        mustChangePassword: principal.mustChangePassword,
        permissions: principal.bypassesAccess ? ["*"] : [...principal.permissions],
      },
    };
  },

  async changePassword(
    context: Ctx<z.output<typeof schemas.changePasswordInput>>,
  ): Promise<HandlerResult<typeof ok>> {
    await authService.changePassword(principalOf(context), context.input, meta(context.request));
    return { data: ok };
  },

  // --- sign-up -------------------------------------------------------------------------------
  async signupRequest({ input, request }: Ctx<z.output<typeof schemas.signupRequestInput>>) {
    await signupService.requestCode(input.email, meta(request));
    return { data: ok };
  },
  async signupVerify({ input }: Ctx<z.output<typeof schemas.signupVerifyInput>>) {
    return { data: await signupService.verifyCode(input.email, input.code) };
  },
  async signupComplete({ input, request }: Ctx<z.output<typeof schemas.signupCompleteInput>>) {
    await signupService.complete(input, meta(request));
    return { status: 201, data: ok };
  },

  // --- approvals -----------------------------------------------------------------------------
  async listPending(): Promise<HandlerResult<{ users: AdminUserDto[] }>> {
    return { data: { users: await adminService.listPending() } };
  },
  async countPending() {
    return { data: { count: await adminService.countPending() } };
  },
  async approve(context: Ctx<z.output<typeof schemas.approveInput>, { id: string }>) {
    await adminService.approve(
      principalOf(context),
      context.params.id,
      context.input.role,
      meta(context.request),
    );
    return { data: ok };
  },
  async reject(context: Ctx<undefined, { id: string }>) {
    await adminService.reject(principalOf(context), context.params.id, meta(context.request));
    return { data: ok };
  },

  // --- users ---------------------------------------------------------------------------------
  async listUsers({ input }: Ctx<z.output<typeof schemas.userListInput>>) {
    return {
      data: {
        users: await adminService.list({
          status: input.status,
          roleKey: input.role,
          search: input.q,
        }),
      },
    };
  },
  async getUser({ params }: Ctx<undefined, { id: string }>) {
    return { data: await adminService.get(params.id) };
  },
  async createUser(context: Ctx<z.output<typeof schemas.createUserInput>>) {
    const { input } = context;
    const result = await adminService.create(
      principalOf(context),
      {
        email: input.email,
        displayName: input.displayName,
        roleKey: input.role,
        temporaryPassword: input.temporaryPassword,
      },
      meta(context.request),
    );
    return { status: 201, data: result };
  },
  async updateUser(context: Ctx<z.output<typeof schemas.updateUserInput>, { id: string }>) {
    return {
      data: await adminService.update(
        principalOf(context),
        context.params.id,
        { displayName: context.input.displayName, roleKey: context.input.role },
        meta(context.request),
      ),
    };
  },
  async deactivate(context: Ctx<undefined, { id: string }>) {
    return {
      data: await adminService.setActive(
        principalOf(context),
        context.params.id,
        false,
        meta(context.request),
      ),
    };
  },
  async reactivate(context: Ctx<undefined, { id: string }>) {
    return {
      data: await adminService.setActive(
        principalOf(context),
        context.params.id,
        true,
        meta(context.request),
      ),
    };
  },
  async resetPassword(context: Ctx<z.output<typeof schemas.resetPasswordInput>, { id: string }>) {
    return {
      data: await adminService.resetPassword(
        principalOf(context),
        context.params.id,
        context.input,
        meta(context.request),
      ),
    };
  },

  // --- groups (Phase 2) ----------------------------------------------------------------------
  async listGroups({ input }: Ctx<z.output<typeof schemas.groupListInput>>) {
    return { data: { groups: await groupsService.list(input.q) } };
  },
  async getGroup({ params }: Ctx<undefined, { id: string }>) {
    return { data: await groupsService.get(params.id) };
  },
  async createGroup(context: Ctx<z.output<typeof schemas.groupInput>>) {
    return {
      status: 201,
      data: await groupsService.create(
        principalOf(context),
        context.input.name,
        meta(context.request),
      ),
    };
  },
  async renameGroup(context: Ctx<z.output<typeof schemas.groupInput>, { id: string }>) {
    return {
      data: await groupsService.rename(
        principalOf(context),
        context.params.id,
        context.input.name,
        meta(context.request),
      ),
    };
  },
  async addGroupMembers(context: Ctx<z.output<typeof schemas.addMembersInput>, { id: string }>) {
    const added = await groupsService.addMembers(
      principalOf(context),
      context.params.id,
      context.input.userIds,
      meta(context.request),
    );
    return { data: { added } };
  },
  async removeGroupMember(context: Ctx<undefined, { id: string; userId: string }>) {
    await groupsService.removeMember(
      principalOf(context),
      context.params.id,
      context.params.userId,
      meta(context.request),
    );
    return { data: ok };
  },
};
