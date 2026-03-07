/*
  Warnings:

  - The primary key for the `CourseOption` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `CourseOption` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "CourseOption" DROP CONSTRAINT "CourseOption_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ALTER COLUMN "studyMode" DROP NOT NULL,
ALTER COLUMN "studyMode" DROP DEFAULT,
ALTER COLUMN "duration" DROP NOT NULL,
ALTER COLUMN "duration" DROP DEFAULT,
ADD CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("id");
