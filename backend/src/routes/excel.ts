import { Router } from "express";
import { exportCoursesToExcel } from "../excel";

const router = Router();

// GET /excel/courses? q=&universityIds=&year=&minFee=&maxFee=&feeType=&level=
router.get("/courses", async (req, res) => {
    try {
        const {
            q,
            courseIds,
            universityIds,
            year,
            minFee,
            maxFee,
            feeType = "home",
            level = "all",
        } = req.query as Record<string, string>;

        console.log(req.query)

        // Parse filters similarly to courses route
        let courseIdsArr: string[] | undefined;
        if (courseIds) {
            courseIdsArr = courseIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        }

        let uniIdsArr: string[] | undefined;
        if (universityIds) {
            uniIdsArr = universityIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        }

        const min =
            minFee !== undefined && minFee !== ""
                ? parseFloat(minFee)
                : undefined;
        const max =
            maxFee !== undefined && maxFee !== ""
                ? parseFloat(maxFee)
                : undefined;
        const yearInt =
            year !== undefined && year !== "" ? parseInt(year, 10) : undefined;

        console.log("Generating Excel export with filters:", {
            q,
            courseIdsArr,
            uniIdsArr,
            yearInt,
            min,
            max,
            feeType,
            level,
        });

        const workbook = await exportCoursesToExcel({
            q,
            courseIds: courseIdsArr,
            universityIds: uniIdsArr,
            year: yearInt,
            minFee: min,
            maxFee: max,
            feeType: feeType as "home" | "international",
            level: level as "undergraduate" | "postgraduate" | "all",
        });

        // Set headers for file download
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=" + "courses_export.xlsx",
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Error exporting excel:", err);
        res.status(500).json({ error: "Failed to export excel file" });
    }
});

export default router;
