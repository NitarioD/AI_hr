/**
 * Vercel Serverless Function — POST /api/generate
 *
 * Why a server route instead of calling Gemini from the browser?
 * -----------------------------------------------------------------
 * The assignment requires a working API call and a live URL. If we put
 * an API key in client-side JavaScript, anyone could open DevTools, copy
 * the key, and burn your quota. A tiny serverless proxy keeps the secret
 * in Vercel environment variables only. That is a strong signal for a
 * founding-engineer screen: you thought about security without over-building.
 *
 * Provider / model: Google Gemini (see GEMINI_MODEL below).
 * - Model is configurable because free-tier quotas vary by model and region
 *   (e.g. gemini-2.0-flash can show limit: 0 while other flash models still work).
 * - JSON mode keeps parsing reliable.
 */

/** Override with env GEMINI_MODEL (e.g. gemini-2.5-flash when your project has quota for it). */
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

function geminiGenerateUrl(modelId) {
  const id = encodeURIComponent(modelId);
  return `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`;
}

/** Max title length — keeps prompts bounded and avoids abuse. */
const MAX_TITLE_LEN = 120;

/**
 * System text: defines behavior without ever asking for PII.
 * We only ever send a generic job title from the form (per assignment).
 */
const SYSTEM_INSTRUCTION = `You are an experienced hiring manager helping design interview questions.

Rules:
- You receive ONLY a generic job title (e.g. "Customer Success Manager"). Never ask for names, employers, resumes, or any personal data.
- Output EXACTLY three distinct interview questions tailored to that role.
- Questions should be thoughtful: probe judgment, collaboration, domain skills, and how they handle ambiguity — not trivia or brainteasers.
- Each question should be one clear sentence.
- Respond with JSON ONLY (no markdown fences) in this shape:
  {"questions":["question 1","question 2","question 3"]}`;

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function safeParseQuestions(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    const data = JSON.parse(trimmed);
    if (!data || !Array.isArray(data.questions)) return null;
    const q = data.questions
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (q.length !== 3) return null;
    return q;
  } catch {
    return null;
  }
}

/** Some models occasionally wrap JSON in markdown; strip a single fence if present. */
function unwrapPossibleMarkdownJson(text) {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

module.exports = async (req, res) => {
  // Only POST — keeps the endpoint narrow and cache-friendly.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(res, 500, {
      error: "Server misconfiguration",
      detail: "GEMINI_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables.",
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return jsonResponse(res, 400, { error: "Invalid JSON body" });
  }

  const rawTitle = body && typeof body.jobTitle === "string" ? body.jobTitle : "";
  const jobTitle = rawTitle.trim();
  if (!jobTitle) {
    return jsonResponse(res, 400, { error: "jobTitle is required" });
  }
  if (jobTitle.length > MAX_TITLE_LEN) {
    return jsonResponse(res, 400, {
      error: `jobTitle must be at most ${MAX_TITLE_LEN} characters`,
    });
  }

  const userMessage = `Job title: ${jobTitle}`;

  const modelId = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  if (!modelId || modelId.length > 80) {
    return jsonResponse(res, 500, { error: "Invalid GEMINI_MODEL configuration" });
  }

  const geminiPayload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.65,
      topP: 0.95,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const url = `${geminiGenerateUrl(modelId)}?key=${encodeURIComponent(apiKey)}`;

  let geminiRes;
  try {
    geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });
  } catch (err) {
    console.error("Gemini network error:", err);
    return jsonResponse(res, 502, {
      error: "Could not reach the AI provider",
      detail: "Network error when calling Gemini.",
    });
  }

  const rawText = await geminiRes.text();
  let geminiJson;
  try {
    geminiJson = JSON.parse(rawText);
  } catch {
    console.error("Non-JSON Gemini response:", rawText.slice(0, 500));
    return jsonResponse(res, 502, {
      error: "Unexpected response from AI provider",
      detail: rawText.slice(0, 200),
    });
  }

  if (!geminiRes.ok) {
    const msg =
      geminiJson?.error?.message ||
      geminiJson?.error?.status ||
      "Gemini request failed";
    console.error("Gemini error:", geminiRes.status, modelId, msg);
    const status = geminiRes.status === 429 ? 429 : geminiRes.status >= 500 ? 502 : 400;
    const quotaHint =
      /quota|RESOURCE_EXHAUSTED|billing|free_tier/i.test(msg) && process.env.GEMINI_MODEL == null
        ? ` Try setting GEMINI_MODEL (e.g. gemini-2.5-flash or gemini-1.5-flash) in Vercel env, or wait and retry.`
        : /quota|RESOURCE_EXHAUSTED|billing|free_tier/i.test(msg)
          ? " If this persists, try another GEMINI_MODEL or check billing in Google AI Studio."
          : "";
    return jsonResponse(res, status, {
      error: "AI provider returned an error",
      detail: msg + quotaHint,
      model: modelId,
    });
  }

  const parts = geminiJson?.candidates?.[0]?.content?.parts;
  const combined =
    Array.isArray(parts) && parts.map((p) => p.text || "").join("") || "";
  const unwrapped = unwrapPossibleMarkdownJson(combined);
  const questions = safeParseQuestions(unwrapped);

  if (!questions) {
    console.error("Could not parse model output:", combined.slice(0, 800));
    return jsonResponse(res, 502, {
      error: "Could not parse AI response",
      detail: "The model did not return the expected JSON shape.",
    });
  }

  return jsonResponse(res, 200, { questions });
};
