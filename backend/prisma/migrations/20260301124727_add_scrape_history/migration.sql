-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "Scrape" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "ScrapeStatus" NOT NULL DEFAULT 'PENDING',
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scrape_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeIssue" (
    "id" TEXT NOT NULL,
    "scrapeId" TEXT NOT NULL,
    "courseId" TEXT,
    "universityId" TEXT,
    "message" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeIssue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScrapeIssue" ADD CONSTRAINT "ScrapeIssue_scrapeId_fkey" FOREIGN KEY ("scrapeId") REFERENCES "Scrape"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
