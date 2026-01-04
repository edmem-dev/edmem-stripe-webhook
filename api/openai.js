import admin from "firebase-admin";

/* ===================== CORS ===================== */

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // 🔴 PRE-FLIGHT CORS (CRITIQUE)
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true; // stop execution
  }

  return false;
}

/* ===================== FIREBASE ===================== */

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("⚠️ Firebase Admin not configured (auth skipped)");
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

async function verifyAuth(req) {
  initFirebaseAdmin();
  if (!admin.apps.length) return;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return;

  const token = auth.slice(7);
  await admin.auth().verifyIdToken(token);
}

/* ===================== HANDLER ===================== */

export default async function handler(req, res) {
  // ✅ CORS FIRST — ALWAYS
  if (applyCors(req, res)) return;

  // ❌ ONLY POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyAuth(req);

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const contentType = req.headers["content-type"] || "";

    /* ========== CHAT ========= */
    if (contentType.includes("application/json")) {
      const body = req.body;

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

    /* ========== AUDIO ========= */
    if (contentType.includes("multipart/form-data")) {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const rawBody = Buffer.concat(buffers);

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": contentType, // ⚠️ keep boundary
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
