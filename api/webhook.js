import express from "express";
import Stripe from "stripe";
import admin from "firebase-admin";
import bodyParser from "body-parser";

/* -----------------------------
   FIREBASE ADMIN
----------------------------- */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

/* -----------------------------
   STRIPE
----------------------------- */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* -----------------------------
   EXPRESS SERVER
----------------------------- */
const app = express();

/* -----------------------------
   WEBHOOK SECRETS (TEST + PROD)
----------------------------- */
const webhookSecrets = [
  process.env.STRIPE_WEBHOOK_SECRET,
  process.env.STRIPE_WEBHOOK_SECRET_TEST,
].filter(Boolean);

/* -----------------------------
   STRIPE PRICE → ROLE MAPPING
   (tu rempliras les IDs après)
----------------------------- */
const PLAN_BY_PRICE = {
  // TEST
  "price_1SfKHZP1mCgTuXtUMhCioSyC": "premium",
  "price_1SfKIFP1mCgTuXtUVMe9Vewl": "premium",

  // PROD
  "price_1SfJn1P1mCgTuXtUUrNs0bpU": "premium",
  "price_1SFj04P1mCgTuXtUrB6xIJ87": "premium",
};


/* -----------------------------
   STRIPE WEBHOOK
----------------------------- */
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event = null;

    // 🔐 Essaye tous les secrets (test + prod)
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
        break;
      } catch (e) {}
    }

    if (!event) {
      console.error("❌ Webhook signature invalid (test + prod failed)");
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
          return res.sendStatus(200);
        }

        // 🔎 Récupère la subscription pour avoir le price réel
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        const priceId =
          subscription.items.data[0]?.price?.id || null;

        if (!priceId) {
          console.warn("⚠️ No priceId found in subscription");
          return res.sendStatus(200);
        }

        const role = PLAN_BY_PRICE[priceId];

        if (!role) {
          console.warn("⚠️ Unknown Stripe price:", priceId);
          return res.sendStatus(200);
        }

        // 🔄 Update Firestore user
        const snap = await db
          .collection("users")
          .where("email", "==", email)
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
          console.warn(`⚠️ Aucun user trouvé pour ${email}`);
        }
      }
    } catch (e) {
      console.error("❌ Webhook handling error:", e);
    }

    res.sendStatus(200);
  }
);

/* -----------------------------
   SERVER
----------------------------- */
app.listen(4242, () =>
  console.log("🚀 Webhook serveur running on port 4242")
);
