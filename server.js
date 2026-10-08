require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, "..");
const DB_FILE = path.join(__dirname, "data", "store.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { orders: [], users: [], products: [] };
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
function normalizePhone(value) {
  const raw = String(value || "").replace(/\s+/g, "").replace(/^\+/, "");
  if (/^07\d{8}$/.test(raw)) return "254" + raw.slice(1);
  if (/^01\d{8}$/.test(raw)) return "254" + raw.slice(1);
  if (/^2547\d{8}$/.test(raw) || /^2541\d{8}$/.test(raw)) return raw;
  return null;
}
function validAmount(amount) {
  const n = Number(amount);
  return Number.isInteger(n) && n >= 1 && n <= 150000;
}

async function mpesaToken() {
  const base = process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const r = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  if (!r.ok) throw new Error(`M-Pesa token request failed: ${r.status}`);
  const body = await r.json();
  return { token: body.access_token, base };
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function stkPassword(shortcode, passkey, time) {
  return Buffer.from(`${shortcode}${passkey}${time}`).toString("base64");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Money Arena", payments: "M-Pesa STK Push" });
});

app.post("/api/orders", (req, res) => {
  const { customer, items, amount, currency = "KES" } = req.body || {};
  if (!customer?.name || !customer?.email || !normalizePhone(customer.phone)) {
    return res.status(400).json({ error: "Valid customer name, email and Kenyan M-Pesa phone are required." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Your cart is empty." });
  }
  if (currency !== "KES" || !validAmount(amount)) {
    return res.status(400).json({ error: "Invalid payment amount." });
  }

  const order = {
    id: id("ORD"),
    customer: {
      name: String(customer.name).slice(0, 100),
      email: String(customer.email).slice(0, 160),
      phone: normalizePhone(customer.phone)
    },
    items: items.map(x => ({
      id: String(x.id || ""),
      name: String(x.name || "").slice(0, 160),
      price: Number(x.price) || 0,
      quantity: Math.max(1, Number(x.quantity) || 1)
    })),
    amount: Number(amount),
    currency,
    status: "pending",
    paymentMethod: null,
    checkoutRequestId: null,
    mpesaReceipt: null,
    createdAt: new Date().toISOString()
  };

  const db = readDB();
  db.orders.push(order);
  writeDB(db);
  res.status(201).json({ order });
});

app.get("/api/orders/:id", (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ order });
});

app.post("/api/payments/mpesa/stk-push", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    const db = readDB();
    const order = db.orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.status === "paid") return res.json({ ok: true, status: "paid", order });

    const phone = normalizePhone(order.customer.phone);
    if (!phone) return res.status(400).json({ error: "Invalid M-Pesa phone number." });
    if (!validAmount(order.amount)) return res.status(400).json({ error: "Invalid amount." });

    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_SHORTCODE","MPESA_PASSKEY","PUBLIC_BASE_URL"]) {
      if (!process.env[key] || process.env[key].startsWith("YOUR_")) {
        return res.status(500).json({ error: `Server payment configuration is missing: ${key}` });
      }
    }

    const { token, base } = await mpesaToken();
    const time = timestamp();
    const callback = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/payments/mpesa/callback`;

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: stkPassword(process.env.MPESA_SHORTCODE, process.env.MPESA_PASSKEY, time),
      Timestamp: time,
      TransactionType: "CustomerPayBillOnline",
      Amount: order.amount,
      PartyA: phone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: callback,
      AccountReference: `${process.env.MPESA_ACCOUNT_NAME || "MONEYARENA"}-${order.id}`.slice(0, 20),
      TransactionDesc: `Money Arena order ${order.id}`.slice(0, 100)
    };

    const r = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.ResponseCode !== "0") {
      return res.status(502).json({
        error: body.errorMessage || body.ResponseDescription || "M-Pesa STK Push failed.",
        provider: body
      });
    }

    order.paymentMethod = "M-Pesa";
    order.checkoutRequestId = body.CheckoutRequestID || null;
    order.merchantRequestId = body.MerchantRequestID || null;
    order.status = "awaiting_payment";
    order.stkResponse = body.ResponseDescription || "STK Push sent.";
    writeDB(db);

    res.json({
      ok: true,
      status: order.status,
      orderId: order.id,
      checkoutRequestId: order.checkoutRequestId,
      message: body.CustomerMessage || "Check your phone and enter your M-Pesa PIN."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to start M-Pesa payment." });
  }
});

app.post("/api/payments/mpesa/callback", (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.status(400).json({ error: "Invalid callback." });

    const checkoutId = callback.CheckoutRequestID;
    const resultCode = Number(callback.ResultCode);
    const db = readDB();
    const order = db.orders.find(o => o.checkoutRequestId === checkoutId);

    // Always acknowledge the callback; unknown callbacks are logged rather than
    // creating or crediting an order.
    if (!order) return res.json({ ResultCode: 0, ResultDesc: "Accepted" });

    order.callbackReceivedAt = new Date().toISOString();
    order.mpesaResultCode = resultCode;
    order.mpesaResultDesc = callback.ResultDesc || "";

    if (resultCode === 0) {
      const params = {};
      for (const p of (callback.CallbackMetadata?.Item || [])) {
        params[p.Name] = p.Value;
      }
      order.status = "paid";
      order.mpesaReceipt = params.MpesaReceiptNumber || null;
      order.paidAmount = Number(params.Amount || order.amount);
      order.paidPhone = params.PhoneNumber || order.customer.phone;
      order.transactionDate = params.TransactionDate || null;
    } else {
      order.status = "failed";
    }

    writeDB(db);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

// Demo download gate. Replace with private object storage + signed URLs before production.
app.get("/api/download/:orderId/:productId", (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.orderId);
  if (!order || order.status !== "paid") {
    return res.status(403).json({ error: "Payment is not confirmed." });
  }
  const item = order.items.find(i => i.id === req.params.productId);
  if (!item) return res.status(404).json({ error: "Product is not part of this order." });
  res.json({
    ok: true,
    message: "Payment verified. Connect this endpoint to private storage for the actual product file.",
    productId: item.id,
    productName: item.name
  });
});

app.use(express.static(ROOT));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found." });
  res.sendFile(path.join(ROOT, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Money Arena running on http://localhost:${PORT}`);
});
