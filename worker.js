
import bcrypt from "bcryptjs";

const COOKIE_NAME = "aiworld.sid";
const SESSION_DAYS = 7;

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Cache-Control": "no-store",
            ...headers
        }
    });
}

function cookieOptions(maxAge) {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function decodeBase64url(value) {
    const base64 = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);

    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function getSigningKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function createSession(userId, secret) {
    const payload = {
        userId,
        exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
    };

    const encoded = base64url(
        new TextEncoder().encode(JSON.stringify(payload))
    );

    const key = await getSigningKey(secret);

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(encoded)
    );

    return `${encoded}.${base64url(new Uint8Array(signature))}`;
}

async function getSession(request, secret) {
    if (!secret) return null;

    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(
        new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );

    if (!match) return null;

    try {
        const [encoded, signature] = match[1].split(".");
        if (!encoded || !signature) return null;

        const key = await getSigningKey(secret);

        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            decodeBase64url(signature),
            new TextEncoder().encode(encoded)
        );

        if (!valid) return null;

        const payload = JSON.parse(
            new TextDecoder().decode(decodeBase64url(encoded))
        );

        if (!payload.userId || payload.exp < Date.now() / 1000) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

async function currentUser(request, env) {
    const session = await getSession(
        request,
        env.SESSION_SECRET
    );

    if (!session) return null;

    return await env.DB.prepare(
        "SELECT id, username, email FROM users WHERE id = ?"
    ).bind(session.userId).first();
}

async function readBody(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

async function register(request, env) {
    const body = await readBody(request);

    if (!body) {
        return json({ success: false, error: "Invalid request." }, 400);
    }

    const { username, email, password } = body;

    if (!username || !email || !password) {
        return json({
            success: false,
            error: "Please fill in all fields."
        }, 400);
    }

    const cleanUsername = String(username).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
        return json({
            success: false,
            error: "Username must be between 3 and 30 characters."
        }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return json({
            success: false,
            error: "Please enter a valid email."
        }, 400);
    }

    if (typeof password !== "string" || password.length < 8) {
        return json({
            success: false,
            error: "Password must be at least 8 characters."
        }, 400);
    }

    if (password.length > 72) {
        return json({
            success: false,
            error: "Password is too long."
        }, 400);
    }

    const existing = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ?"
    ).bind(cleanEmail).first();

    if (existing) {
        return json({
            success: false,
            error: "This email is already registered."
        }, 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await env.DB.prepare(`
        INSERT INTO users (username, email, password_hash)
        VALUES (?, ?, ?)
    `).bind(cleanUsername, cleanEmail, passwordHash).run();

    const userId = result.meta.last_row_id;

    const token = await createSession(
        userId,
        env.SESSION_SECRET
    );

    return json({
        success: true,
        user: {
            id: userId,
            username: cleanUsername,
            email: cleanEmail
        }
    }, 201, {
        "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
    });
}

async function login(request, env) {
    const body = await readBody(request);

    if (!body) {
        return json({ success: false, error: "Invalid request." }, 400);
    }

    const { email, password } = body;

    if (!email || !password) {
        return json({
            success: false,
            error: "Please enter your email and password."
        }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const user = await env.DB.prepare(
        "SELECT * FROM users WHERE email = ?"
    ).bind(cleanEmail).first();

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return json({
            success: false,
            error: "Incorrect email or password."
        }, 401);
    }

    const token = await createSession(
        user.id,
        env.SESSION_SECRET
    );

    return json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            email: user.email
        }
    }, 200, {
        "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
    });
}

async function getMe(request, env) {
    const user = await currentUser(request, env);

    if (!user) {
        return json({
            success: false,
            error: "Not logged in."
        }, 401);
    }

    return json({ success: true, user });
}

async function logout() {
    return json({
        success: true,
        message: "Logged out successfully."
    }, 200, {
        "Set-Cookie": cookieOptions(0)
    });
}

async function chat(request, env) {
    const body = await readBody(request);

    if (!body || typeof body.message !== "string" || !body.message.trim()) {
        return json({
            success: false,
            error: "Please enter a message."
        }, 400);
    }

    if (!env.GEMINI_API_KEY) {
        return json({
            success: false,
            error: "AI service is not configured."
        }, 503);
    }

    const mode = body.mode === "teacher" ? "teacher" : "general";

    const systemPrompt = mode === "teacher"
        ? "You are AI WORLD Teacher. Explain lessons simply and clearly. Reply in the same language as the user."
        : "You are AI WORLD Assistant. Be helpful, friendly, and reply in the same language as the user.";

    const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [{
                    role: "user",
                    parts: [{ text: body.message.trim().slice(0, 10000) }]
                }]
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error("Gemini error:", data);

        return json({
            success: false,
            error: "AI request failed."
        }, 502);
    }

    const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
        return json({
            success: false,
            error: "AI returned an empty response."
        }, 502);
    }

    return json({
        success: true,
        reply
    });
}

async function searchWeb(request, env) {
    const body = await readBody(request);

    if (!body || typeof body.query !== "string" || !body.query.trim()) {
        return json({
            success: false,
            error: "Please enter a search query."
        }, 400);
    }

    if (!env.FIRECRAWL_API_KEY) {
        return json({
            success: false,
            error: "Web search is not configured."
        }, 503);
    }

    const response = await fetch(
        "https://api.firecrawl.dev/v2/search",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify({
                query: body.query.trim().slice(0, 300),
                limit: 5
            })
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        console.error("Firecrawl error:", data);

        return json({
            success: false,
            error: "Web search failed."
        }, 502);
    }

    const rawResults = Array.isArray(data.data?.web)
        ? data.data.web
        : [];

    return json({
        success: true,
        results: rawResults.map(item => ({
            title: item.title || "Untitled",
            description: item.description || item.markdown || "",
            url: item.url || ""
        }))
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            if (path === "/api/status" && method === "GET") {
                return json({
                    success: true,
                    message: "AI WORLD Server is running!"
                });
            }

            if (path === "/api/auth/register" && method === "POST") {
                if (!env.SESSION_SECRET) {
                    return json({
                        success: false,
                        error: "Session configuration is missing."
                    }, 500);
                }

                return await register(request, env);
            }

            if (path === "/api/auth/login" && method === "POST") {
                if (!env.SESSION_SECRET) {
                    return json({
                        success: false,
                        error: "Session configuration is missing."
                    }, 500);
                }

                return await login(request, env);
            }

            if (path === "/api/auth/me" && method === "GET") {
                return await getMe(request, env);
            }

            if (path === "/api/auth/logout" && method === "POST") {
                return await logout();
            }

            if (path === "/api/chat" && method === "POST") {
                return await chat(request, env);
            }

            if (path === "/api/search" && method === "POST") {
                return await searchWeb(request, env);
            }

            if (path.startsWith("/api/")) {
                return json({
                    success: false,
                    error: "API endpoint not found."
                }, 404);
            }

            return await env.ASSETS.fetch(request);

        } catch (error) {
            console.error("Worker error:", error);

            return json({
                success: false,
                error: "An unexpected server error occurred."
            }, 500);
        }
    }
};
