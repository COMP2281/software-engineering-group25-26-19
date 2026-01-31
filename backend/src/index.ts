import express from "express";
import path from "path";
import router from "./routes";

const app = express();
const PORT = process.env["PORT"] || 5001;

app.use(express.json());

// API Routes
app.use("/api", router);

// Serve static files in production
// The static files will come from ../frontend/dist/ relative to the backend folder structure
if (process.env["NODE_ENV"] === "production") {
    const staticPath = path.join(__dirname, "../../frontend/dist");

    app.use(express.static(staticPath));

    app.get("*", (_, res) => {
        res.sendFile(path.join(staticPath, "index.html"));
    });
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
