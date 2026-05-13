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
 * Provider / model: Google Gemini.
 * - Google retires or renames model IDs over time (e.g. gemini-1.5-flash may
 *   disappear from v1beta for new keys). We use a small fallback chain when
 *   GEMINI_MODEL is unset, or a single explicit model when it is set.
 * - JSON mode keeps parsing reliable.
 */

/**
 * When GEMINI_MODEL is not set, try these in order until one succeeds.
 * Tune via env if Google changes availability (see README: ListModels curl).
 */
const MODEL_FALLBACK_CHAIN = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

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

/** True if trying another model id might help (wrong model id vs exhausted quota). */
function shouldTryNextModel(httpStatus, message) {
  const msg = (message || "").toLowerCase();
  if (httpStatus === 404) return true;
  if (msg.includes("not found") && msg.includes("model")) return true;
  if (msg.includes("not supported for generatecontent")) return true;
  if (httpStatus === 429) return true;
  if (/quota|resource_exhausted|free_tier|limit:\s*0/i.test(message || "")) return true;
  return false;
}

async function callGemini(apiKey, modelId, geminiPayload) {
  const url = `${geminiGenerateUrl(modelId)}?key=${encodeURIComponent(apiKey)}`;
  const geminiRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiPayload),
  });
  const rawText = await geminiRes.text();
  let geminiJson;
  try {
    geminiJson = JSON.parse(rawText);
  } catch {
    return {
      parseHttpJsonFailed: true,
      httpStatus: geminiRes.status,
      rawText: rawText.slice(0, 500),
      modelId,
    };
  }
  const errMsg = geminiJson?.error?.message || geminiJson?.error?.status || "";
  return {
    parseHttpJsonFailed: false,
    ok: geminiRes.ok,
    httpStatus: geminiRes.status,
    geminiJson,
    errMsg: errMsg || "Gemini request failed",
    modelId,
  };
}

module.exports = async (req, res) => {
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

  const explicit = (process.env.GEMINI_MODEL || "").trim();
  const candidates = explicit ? [explicit] : MODEL_FALLBACK_CHAIN;

  for (const mid of candidates) {
    if (!mid || mid.length > 80) {
      return jsonResponse(res, 500, { error: "Invalid GEMINI_MODEL configuration" });
    }
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

  let lastFailure = null;

  for (const modelId of candidates) {
    let result;
    try {
      result = await callGemini(apiKey, modelId, geminiPayload);
    } catch (err) {
      console.error("Gemini network error:", err);
      return jsonResponse(res, 502, {
        error: "Could not reach the AI provider",
        detail: "Network error when calling Gemini.",
      });
    }

    if (result.parseHttpJsonFailed) {
      console.error("Non-JSON Gemini response:", result.rawText);
      return jsonResponse(res, 502, {
        error: "Unexpected response from AI provider",
        detail: result.rawText.slice(0, 200),
        model: result.modelId,
      });
    }

    if (!result.ok) {
      const msg = result.errMsg;
      console.error("Gemini error:", result.httpStatus, modelId, msg);
      lastFailure = { httpStatus: result.httpStatus, msg, modelId };

      const tryNext =
        candidates.length > 1 && shouldTryNextModel(result.httpStatus, msg);
      if (tryNext) {
        continue;
      }

      const status =
        result.httpStatus === 429 ? 429 : result.httpStatus >= 500 ? 502 : 400;
      const quotaHint =
        /quota|RESOURCE_EXHAUSTED|billing|free_tier/i.test(msg) && !explicit
          ? " This server already tried multiple models; set GEMINI_MODEL to a model your key supports (curl ListModels — see README), enable billing, or wait and retry."
          : /quota|RESOURCE_EXHAUSTED|billing|free_tier/i.test(msg)
            ? " Check GEMINI_MODEL, billing, or rate limits in Google AI Studio."
            : "";
      return jsonResponse(res, status, {
        error: "AI provider returned an error",
        detail: msg + quotaHint,
        model: modelId,
        triedModels: explicit ? [explicit] : MODEL_FALLBACK_CHAIN,
      });
    }

    const geminiJson = result.geminiJson;
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
        model: modelId,
      });
    }

    return jsonResponse(res, 200, { questions, model: modelId });
  }

  const lf = lastFailure || { httpStatus: 502, msg: "All model attempts failed", modelId: "unknown" };
  return jsonResponse(res, lf.httpStatus >= 500 ? 502 : lf.httpStatus, {
    error: "AI provider returned an error",
    detail: lf.msg,
    model: lf.modelId,
    triedModels: explicit ? [explicit] : MODEL_FALLBACK_CHAIN,
  });
};
