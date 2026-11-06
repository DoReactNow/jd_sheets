// Background jobs of the identity module (Decision 31).
import { z } from "zod";
import { defineJob, getJobQueue, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { getMailer } from "@/shared/mail";
import { systemClock } from "@/shared/time";
import { identityRepository } from "./identity.repository";
import { sendOtpMail } from "./identity.signup";

/** Makes and emails a sign-up code. Idempotent: a second run sends nothing (X-JOB-01). */
export const sendOtpJob = defineJob({
  name: "identity.sendOtp",
  payload: z.object({ otpId: z.uuid() }),
  retry: { limit: 3, delaySeconds: 20, backoff: true },
  async handler({ otpId }, { logger }) {
    const result = await sendOtpMail(otpId, getMailer());
    logger.info("sign-up code mail", { otpId, result });
  },
});

/** Removes old sign-up codes, ended sessions and rate-limit windows. */
export const cleanupExpiredJob = defineJob({
  name: "identity.cleanupExpired",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 300, backoff: false },
  async handler(_payload, { logger }) {
    logger.info("identity cleanup", await identityRepository.cleanup(systemClock.now()));
  },
});

export const identityJobs: AnyJobDefinition[] = [sendOtpJob, cleanupExpiredJob];
export const identitySchedules: JobSchedule[] = [
  { job: cleanupExpiredJob, cron: "11 * * * *", payload: {} },
];

/** Used by the sign-up service; the singleton key makes a repeated enqueue a no-op. */
export async function enqueueOtpMail(otpId: string): Promise<void> {
  const queue = await getJobQueue();
  await queue.enqueue(sendOtpJob, { otpId }, { singletonKey: otpId });
}
