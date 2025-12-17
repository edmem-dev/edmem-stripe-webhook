import express from "express";
import Stripe from "stripe";
import admin from "firebase-admin";
import bodyParser from "body-parser";
import dotenv from "dotenv";

/* -----------------------------
   🌱 ENV
----------------------------- */
dotenv.config();

/* -----------------------------
   🔥 FIREBASE ADMIN
----------------------------- */
if (!admin.apps.length) {
  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error("❌ Missing Firebase environment variables");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

/* -----------------------------
   ⚡ STRIPE
----------------------------- */
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("❌ STRIPE_SECRET_KEY is missing");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* -----------------------------
   🔐 WEBHOOK SECRETS (TEST + PROD)
----------------------------- */
const webhookSecrets = [
  process.env.STRIPE_WEBHOOK_SECRET,
  process.env.STRIPE_WEBHOOK_SECRET_TEST,
].filter(Boolean);

if (webhookSecrets.length === 0) {
  throw new Error("❌ No Stripe webhook secret configured");
}

/* -----------------------------
   🎯 PRICE → ROLE
----------------------------- */
const PLAN_BY_PRICE = {
  // TEST
  price_1SfKHZP1mCgTuXtUMhCioSyC: "premium",
  price_1SfKIFP1mCgTuXtUVMe9Vewl: "premium",

  // PROD
  price_1SfJn1P1mCgTuXtUUrNs0bpU: "premium",
  price_1SFj04P1mCgTuXtUrB6xIJ87: "premium",
};

/* -----------------------------
   🚀 EXPRESS APP
----------------------------- */
const app = express();

/* -----------------------------
   🧪 HEALTH CHECK
----------------------------- */
app.get("/", (_req, res) => {
  res.json({ status: "Edmem webhook running 🚀" });
});

/* -----------------------------
   🔔 STRIPE WEBHOOK
   (route = /api/webhook)
----------------------------- */
app.post(
  "/",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    // 🔐 Vérification signature (test + prod)
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
        break;
      } catch {}
    }

    if (!event) {
      console.error("❌ Invalid Stripe signature");
      return res.status(400).send("Webhook Error");
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const email =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        if (!email || !session.subscription) {
          console.warn("⚠️ Missing email or subscription");
          return res.json({ received: true });
        }

        // 🔎 Récupération subscription
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        const priceId = subscription.items.data[0]?.price?.id;
        const role = PLAN_BY_PRICE[priceId];

        if (!role) {
          console.warn("⚠️ Unknown price:", priceId);
          return res.json({ received: true });
        }

        // 🔄 Firestore update
        const snap = await db
          .collection("users")
          .where("email", "==", email)
          .limit(1)
          .get();

        if (!snap.empty) {
          const doc = snap.docs[0];
          await doc.ref.update({
            role,
            stripePriceId: priceId,
            stripeSubscriptionId: subscription.id,
            lastPayment: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`🔥 ${email} devient ${role.toUpperCase()}`);
        } else {
          console.warn(`⚠️ Aucun user pour ${email}`);
        }
      }
    } catch (err) {
      console.error("❌ Webhook processing error:", err);
    }

    res.json({ received: true });
  }
);

/* -----------------------------
   ✅ EXPORT (Vercel Serverless)
----------------------------- */
export default app;
