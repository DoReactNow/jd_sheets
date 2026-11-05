import { route } from "@/shared/http/route";
import { AppError } from "@/shared/errors/AppError";

/** GET /api/me: who is signed in (the editor signs comments with this name). */
export const GET = route({
  access: "authenticated",
  handler: async ({ principal }) => {
    if (!principal) throw new AppError("UNAUTHENTICATED");
    return { data: { userId: principal.userId, displayName: principal.displayName } };
  },
});
