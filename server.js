import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { google } from "googleapis";

const app = express();
const PORT = process.env.PORT || 3000;

/* =======================
   ENV
======================= */
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "bot depo";
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;

if (!TELEGRAM_TOKEN || !SHEET_ID || !GOOGLE_CREDENTIALS) {
  console.error("❌ ENV belum lengkap");
  console.error("TELEGRAM_TOKEN:", !!TELEGRAM_TOKEN);
  console.error("SHEET_ID:", !!SHEET_ID);
  console.error("GOOGLE_CREDENTIALS:", !!GOOGLE_CREDENTIALS);
  process.exit(1);
}

/* =======================
   GOOGLE SHEETS
======================= */
let creds;
try {
  creds = JSON.parse(GOOGLE_CREDENTIALS);
} catch (e) {
  console.error("❌ GOOGLE_CREDENTIALS bukan JSON valid:", e?.message || e);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

/* =======================
   TELEGRAM BOT (WEBHOOK)
======================= */
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

/* =======================
   EXPRESS
======================= */
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) =>
  res.send("✅ Bot aktif (Group Only + Reply + Google Sheets)")
);

/**
 * ✅ Webhook endpoint HARUS /webhook
 * Karena webhook Telegram kamu sekarang mengarah ke .../webhook
 */
app.post("/webhook", (req, res) => {
  // ✅ balas cepat supaya Telegram tidak retry
  res.sendStatus(200);

  console.log("📩 UPDATE MASUK:", JSON.stringify(req.body));

  // proses update tanpa nahan response
  bot.processUpdate(req.body).catch((e) => {
    console.error("❌ processUpdate error:", e?.message || e);
  });
});

/* =======================
   HELPERS
======================= */
function isGroupChat(msg) {
  return msg.chat && (msg.chat.type === "group" || msg.chat.type === "supergroup");
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (e) {
    console.error("⚠️ Gagal kirim pesan:", e?.message || e);
    return null;
  }
}

// =======================
// WRITE QUEUE (ANTI TABRAKAN CHAT)
// =======================
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  writeQueue = writeQueue.then(fn).catch(() => {});
  return writeQueue;
}


/* =======================
   MESSAGE HANDLER
======================= */
bot.on("message", async (msg) => {
  if (!isGroupChat(msg)) return;

  const chatId = msg.chat.id;

  // ✅ cukup sekali saja
  const text = (msg.caption || msg.text || "").replace(/\s+/g, " ").trim();
  if (!text) return;

  // format:
  // sedekah12 T01 ndp
  // Koying12345 T02 rdp / rd
const m = text.match(/^(.+?)\s+\/?@?(T0[0-5])\s+(ndp|rdp|rd)$/i);
  if (!m) return;

 const namaValue = m[1].trim();        
const tKey = m[2].toLowerCase();      // jadi "t02"
const groupKey = m[3].toLowerCase();  // "rd" / "ndp" / "rdp"

  try {
  const appendRes = await enqueueWrite(async () => {
    return await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:C`, // ✅ A=nama, B=tKey, C=group
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[namaValue, tKey, groupKey]],
      },
    });
  });

  const updatedRange = appendRes.data.updates?.updatedRange || "";
  const rowNumber = Number((updatedRange.match(/(\d+)/) || [])[1]) || "-";

  await safeSendMessage(
    chatId,
    `✅ Disimpan!\nValue: ${namaValue}\nT: ${tKey}\nGrup: ${groupKey}\n📊 Baris: ${rowNumber}`,
    { reply_to_message_id: msg.message_id }
  );

  console.log(`✅ APPEND OK: ${namaValue}, ${tKey}, ${groupKey} -> ${updatedRange}`);
} catch (e) {
  console.error("❌ Sheets error:", e?.message || e);
  await safeSendMessage(chatId, "❌ Gagal simpan ke Google Sheets.", {
    reply_to_message_id: msg.message_id,
  });
}
});

/* =======================
   START
======================= */
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
  console.log("✅ Webhook endpoint: POST /webhook");
  console.log("✅ Sheet:", SHEET_NAME);
});







