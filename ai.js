
async function generateAIResponse(message, mode = "general") {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("Gemini API key is missing from server/.env");
    }

    const systemPrompt = mode === "teacher"
        ? "You are AI WORLD Teacher. Explain lessons simply and clearly. Reply in the same language as the user."
        : "You are AI WORLD Assistant. Be helpful, friendly, and reply in the same language as the user.";

    try {
        const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.-flash:generateContent",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: message }]
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Gemini API Error:", data);
            throw new Error(
                data.error?.message || `Gemini returned HTTP ${response.status}`
            );
        }

        const reply = data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

        if (!reply) {
            throw new Error("Gemini returned an empty response.");
        }

        return reply;

    } catch (error) {
        console.error("AI Error:", error.message);
        throw error;
    }
}

module.exports = { generateAIResponse };
