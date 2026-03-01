import express from "express";
import session from "express-session";
import { PrismaSessionStore } from "@quixo3/prisma-session-store";
import prisma from "./db";
import path from "path";
import router from "./routes";

// Extend express-session to include user info
declare module "express-session" {
  interface SessionData {
    user: string;
  }
}

const app = express();
const PORT = process.env["PORT"] || 5001;

app.use(express.json());

// Session Middleware
app.use(
  session({
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    },
    secret: process.env["SESSION_SECRET"] || "development_secret_key_change_me",
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000, // Process 2 minutes
      dbRecordIdIsSessionId: true,
    }),
  })
);

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
