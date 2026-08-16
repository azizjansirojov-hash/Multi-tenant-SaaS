-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING';

-- Existing rows were already visible to clients — treat as confirmed uploads
UPDATE "Attachment" SET "status" = 'CONFIRMED';

-- CreateIndex
CREATE INDEX "Attachment_status_createdAt_idx" ON "Attachment"("status", "createdAt");
