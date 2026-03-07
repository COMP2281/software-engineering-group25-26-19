/*
  Warnings:

  - The primary key for the `CourseOption` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `CourseOption` table. All the data in the column will be lost.
  - Made the column `studyMode` on table `CourseOption` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "CourseOption" DROP CONSTRAINT "CourseOption_pkey",
DROP COLUMN "id",
ALTER COLUMN "studyMode" SET NOT NULL,
ALTER COLUMN "studyMode" SET DEFAULT 'Full-time',
ADD CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("courseId", "year", "studyMode");
