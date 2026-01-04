/* ===================== NO IMPORTS BEFORE CORS ===================== */

/* ===================== CORS ===================== */
function handleCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

/* ===================== BODY READER ===================== */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/* ===================== HANDLER ===================== */
export default async function handler(req, res) {
  // 🔴 CORS MUST BE FIRST
  if (handleCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  const contentType = req.headers["content-type"] || "";

  try {
    /* ================= CHAT ================= */
    if (contentType.includes("application/json")) {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8"));

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await r.json();
      return res.status(r.status).json(json);
    }

    /* ================= AUDIO ================= */
    if (contentType.includes("multipart/form-data")) {
      const rawBody = await readBody(req);

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": contentType, // keep boundary
        },
        body: rawBody,
      });

      const json = await r.json();
      return res.status(r.status).json(json);
    }

    return res.status(400).json({ error: "Unsupported content type" });
  } catch (e) {
    console.error("❌ OpenAI proxy error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
