/*
  Warnings:

  - A unique constraint covering the columns `[id]` on the table `CourseOption` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "CourseOption_id_key" ON "CourseOption"("id");
