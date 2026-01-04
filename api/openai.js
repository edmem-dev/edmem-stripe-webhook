/* api/openai.js
   Vercel Serverless Function (Node 18+)
   - POST JSON -> /v1/chat/completions
   - POST multipart -> /v1/audio/transcriptions
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

async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    const err = new Error("Missing auth token");
    err.code = 401;
    throw err;
  }

  // Import dynamique pour ne jamais casser le CORS preflight
  const adminMod = await import("firebase-admin");
  const admin = adminMod.default;

  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      // Si tu veux rendre Firebase obligatoire, remplace par throw 500
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

export default async function handler(req, res) {
  // ✅ CORS d’abord, toujours
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
    // 🔐 Auth Firebase (comme ton ChatBot)
    await verifyFirebaseToken(req);

    // ====== CHAT (JSON) ======
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

    // ====== AUDIO (multipart/form-data) ======
    if (contentType.includes("multipart/form-data")) {
      const rawBody = await readBody(req);

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": contentType, // garder le boundary !
        },
        body: rawBody,
      });

      const json = await r.json();
      return res.status(r.status).json(json);
    }

    return res.status(400).json({ error: "Unsupported content type" });
  } catch (e) {
    const code = e?.code === 401 ? 401 : 500;
    console.error("❌ /api/openai error:", e);
    return res.status(code).json({ error: code === 401 ? "Unauthorized" : "Server error" });
  }
}
