
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("./database");

const router = express.Router();

// Create a new account
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: "Please fill in all fields."
            });
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (cleanUsername.length < 3 || cleanUsername.length > 30) {
            return res.status(400).json({
                success: false,
                error: "Username must be between 3 and 30 characters."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                error: "Please enter a valid email."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: "Password must be at least 8 characters."
            });
        }

        const existingUser = db.prepare(
            "SELECT id FROM users WHERE email = ?"
        ).get(cleanEmail);

        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: "This email is already registered."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = db.prepare(`
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        `).run(cleanUsername, cleanEmail, passwordHash);

        req.session.userId = result.lastInsertRowid;

        req.session.save((error) => {
            if (error) {
                console.error(error);
                return res.status(500).json({
                    success: false,
                    error: "Could not create login session."
                });
            }

            res.status(201).json({
                success: true,
                user: {
                    id: result.lastInsertRowid,
                    username: cleanUsername,
                    email: cleanEmail
                }
            });
        });

    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({
            success: false,
            error: "Account creation failed."
        });
    }
});


// Sign in
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: "Please enter your email and password."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const user = db.prepare(
            "SELECT * FROM users WHERE email = ?"
        ).get(cleanEmail);

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({
                success: false,
                error: "Incorrect email or password."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                return res.status(500).json({
                    success: false,
                    error: "Login failed."
                });
            }

            req.session.userId = user.id;

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({
                        success: false,
                        error: "Could not save login session."
                    });
                }

                res.json({
                    success: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email
                    }
                });
            });
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            error: "Login failed."
        });
    }
});


// Get current user
router.get("/me", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            error: "Not logged in."
        });
    }

    const user = db.prepare(
        "SELECT id, username, email FROM users WHERE id = ?"
    ).get(req.session.userId);

    if (!user) {
        return res.status(401).json({
            success: false,
            error: "Account not found."
        });
    }

    res.json({ success: true, user });
});


// Sign out
router.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                error: "Logout failed."
            });
        }

        res.clearCookie("aiworld.sid");

        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

module.exports = router;
