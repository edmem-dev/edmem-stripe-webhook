/* api/openai.js
   Vercel Serverless Function (Node 18+)
   - POST application/json:
       - si body.messages => chat completions (JSON)
       - si body.voice + body.input => TTS audio/speech (binary audio)
   - POST multipart/form-data => audio transcriptions (Whisper) (JSON)
   - CORS OK + OPTIONS 204
   - Firebase ID token verify (si env Firebase présents)
*/

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function verifyFirebaseTokenIfPossible(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    const err = new Error("Missing auth token");
    err.code = 401;
    throw err;
  }

  const adminMod = await import("firebase-admin");
  const admin = adminMod.default;

  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      console.warn("⚠️ Firebase Admin env manquants, verification skipped");
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  await admin.auth().verifyIdToken(token);
}

async function parseOpenAIResponse(r) {
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await r.json();
  const text = await r.text();
  return { text };
}

export default async function handler(req, res) {
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
    await verifyFirebaseTokenIfPossible(req);

    // =========================
    // JSON : CHAT ou TTS
    // =========================
    if (contentType.includes("application/json")) {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8"));

      // ---- TTS (audio/speech) ----
      if (body?.voice && body?.input && body?.model) {
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const ab = await r.arrayBuffer();
        const buf = Buffer.from(ab);
        const ct = r.headers.get("content-type") || "audio/mpeg";

        res.setHeader("Content-Type", ct);
        // inline pour lecture
        res.setHeader("Content-Disposition", 'inline; filename="speech.mp3"');

        return res.status(r.status).send(buf);
      }

      // ---- CHAT completions ----
      if (body?.messages) {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const data = await parseOpenAIResponse(r);
        return res.status(r.status).json(data);
      }

      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    // =========================
    // MULTIPART : WHISPER
    // =========================
    if (contentType.includes("multipart/form-data")) {
      const rawBody = await readBody(req);

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": contentType, // garder boundary
        },
        body: rawBody,
      });

      const data = await parseOpenAIResponse(r);
      return res.status(r.status).json(data);
    }

    return res.status(400).json({ error: "Unsupported content type" });
  } catch (e) {
    const status = e?.code === 401 ? 401 : 500;
    console.error("❌ /api/openai error:", e);
    return res.status(status).json({
      error: status === 401 ? "Unauthorized" : "Server error",
    });
  }
}
