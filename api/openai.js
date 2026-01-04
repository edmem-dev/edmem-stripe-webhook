import admin from "firebase-admin";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars");
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function requireFirebaseAuth(req) {
  initFirebaseAdmin();

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    const err = new Error("Missing auth token");
    err.statusCode = 401;
    throw err;
  }

  await admin.auth().verifyIdToken(token);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireFirebaseAuth(req);

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const contentType = req.headers["content-type"] || "";

    // -----------------------------
    // 1) CHAT (JSON) -> /chat/completions
    // -----------------------------
    if (contentType.includes("application/json")) {
      // Vercel peut parser req.body, sinon on lit le raw
      let body = req.body;
      if (!body || typeof body === "string") {
        const raw = await readRawBody(req);
        body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      }

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

    // -----------------------------
    // 2) TRANSCRIBE (multipart) -> /audio/transcriptions
    // -----------------------------
    if (contentType.includes("multipart/form-data")) {
      const raw = await readRawBody(req);

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": contentType, // garde le boundary d'origine
        },
        body: raw,
      });

      const json = await r.json();
      return res.status(r.status).json(json);
    }

    return res.status(400).json({ error: "Unsupported content-type" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ error: e?.message || "Server error" });
  }
}
