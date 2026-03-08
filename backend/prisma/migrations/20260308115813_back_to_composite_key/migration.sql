/*
  Warnings:

  - The primary key for the `CourseOption` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Made the column `studyMode` on table `CourseOption` required. This step will fail if there are existing NULL values in that column.
  - Made the column `duration` on table `CourseOption` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "CourseOption" DROP CONSTRAINT "CourseOption_pkey",
ALTER COLUMN "studyMode" SET NOT NULL,
ALTER COLUMN "duration" SET NOT NULL,
ADD CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("courseId", "year", "studyMode", "duration");
