import { Router } from "express";
import bcrypt from "bcryptjs";

const router = Router();

// POST /auth/login
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body as { username?: string; password?: string };

        if (!username || !password) return res.status(400).json({ error: "Missing credentials" });

        if (username !== "admin") return res.status(401).json({ error: "Invalid credentials" });

        const hash = process.env["ADMIN_PASSWORD_HASH"];
        if (!hash) return res.status(500).json({ error: "Server misconfigured" });

        const match = await bcrypt.compare(password, hash);
        if (!match) return res.status(401).json({ error: "Invalid credentials" });

        // Authentication successful.
        req.session.user = "admin";
        req.session.save((err) => {
            if (err) {
                console.error("Session save error:", err);
                return res.status(500).json({ error: "Login failed" });
            }
            return res.status(200).json({ authenticated: true, user: "admin" });
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Login failed" });
    }
    return;
});

router.get("/me", (req, res) => {
    if (req.session && req.session.user) {
        return res.status(200).json({ authenticated: true, user: req.session.user });
    }
    return res.status(401).json({ authenticated: false });
});

router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).json({ error: "Logout failed" });
        }
        res.clearCookie("connect.sid");
        return res.status(200).json({ message: "Logged out" });
    });
});

export default router;
