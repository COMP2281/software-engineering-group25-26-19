-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ukprn" TEXT,
    "address" JSONB,
    "website" TEXT,
    "logoUrl" TEXT,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "ucasCourseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "applicationCode" TEXT,
    "summary" TEXT,
    "universityId" TEXT NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseOption" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "studyMode" TEXT,
    "duration" TEXT,
    "startDate" TEXT,
    "homeFee" DOUBLE PRECISION,
    "internationalFee" DOUBLE PRECISION,
    "aLevelGrade1" TEXT,
    "aLevelSubject1" TEXT,
    "aLevelGrade2" TEXT,
    "aLevelSubject2" TEXT,
    "aLevelGrade3" TEXT,
    "aLevelSubject3" TEXT,
    "aLevelGrade4" TEXT,
    "aLevelSubject4" TEXT,
    "englishSpeaking" TEXT,
    "englishListening" TEXT,
    "englishReading" TEXT,
    "englishWriting" TEXT,
    "englishOverall" TEXT,
    "outcomeQualification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "University_ukprn_key" ON "University"("ukprn");

-- CreateIndex
CREATE UNIQUE INDEX "Course_ucasCourseId_key" ON "Course"("ucasCourseId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseOption" ADD CONSTRAINT "CourseOption_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
