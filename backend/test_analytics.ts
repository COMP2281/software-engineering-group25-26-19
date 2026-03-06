import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const data = await prisma.course.findMany({
        take: 5,
        select: {
            id: true,
            title: true,
            university: { select: { name: true } },
            options: {
                select: {
                    homeFee: true,
                    internationalFee: true,
                    outcomeQualification: true,
                }
            }
        }
    });
    console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
