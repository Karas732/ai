
const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const session = require("express-session");

dotenv.config({ path: path.join(__dirname, ".env") });

const { generateAIResponse } = require("./ai");
const authRoutes = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing from server/.env");
}

// Middleware
app.use(express.json());

// Session
app.use(session({
    name: "aiworld.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

// Authentication
app.use("/api/auth", authRoutes);

// Main HTML Page
app.get("/", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Static files
app.use(express.static(path.join(__dirname, "../public")));

// Server status
app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        message: "AI WORLD Server is running!"
    });
});

// Firecrawl Web Search
app.post("/api/search", async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== "string" || !query.trim()) {
            return res.status(400).json({
                success: false,
                error: "Please enter a search query."
            });
        }

        console.log("FIRECRAWL SEARCH:", query);

        const response = await fetch(
            "https://api.firecrawl.dev/v2/search",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    query: query.trim().slice(0, 300),
                    limit: 5
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            console.error("Firecrawl API Error:", data);
            return res.status(response.status || 500).json({
                success: false,
                error: data.error || "Firecrawl search failed."
            });
        }

        const rawResults = Array.isArray(data.data?.web)
            ? data.data.web
            : [];

        const results = rawResults.map(item => ({
            title: item.title || "Untitled",
            description: item.description || item.markdown || "",
            url: item.url || ""
        }));

        console.log("FIRECRAWL RESULTS:", results.length);

        res.json({
            success: true,
            results
        });

    } catch (error) {
        console.error("Firecrawl Error:", error);

        res.status(500).json({
            success: false,
            error: error.message || "Web search failed."
        });
    }
});

// AI Chat
app.post("/api/chat", async (req, res) => {
    console.log("CHAT REQUEST RECEIVED");

    try {
        const { message, mode } = req.body;

        if (!message || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: "Please enter a message."
            });
        }

        const reply = await generateAIResponse(
            message.trim(),
            mode === "teacher" ? "teacher" : "general"
        );

        res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("AI Error:", error.message);

        res.status(500).json({
            success: false,
            error: "AI request failed."
        });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`AI WORLD is running at http://localhost:${PORT}`);
});
