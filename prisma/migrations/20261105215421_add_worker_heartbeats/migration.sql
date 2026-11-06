-- CreateTable
CREATE TABLE "system_worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_beat_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);
