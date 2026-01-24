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
const SHEET_NAME = process.env.SHEET_NAME || "Sheet182";
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
app.post("/webhook", async (req, res) => {
  try {
    // log singkat biar gampang debug (boleh hapus kalau sudah stabil)
    // console.log("📩 WEBHOOK HIT", new Date().toISOString());

    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Webhook error:", e?.message || e);
    res.sendStatus(500);
  }
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

// Convert column index to letter (0=>A, 25=>Z, 26=>AA, dst)
function colToLetter(colIndex) {
  let temp = colIndex + 1;
  let letter = "";
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Cari baris kosong berikutnya pada kolom tertentu
 * Mulai scanning dari baris 2 (baris 1 header)
 */
async function findNextEmptyRowInColumn(spreadsheetId, sheetName, colIndex) {
  const colLetter = colToLetter(colIndex);

  const gridRes = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${sheetName}!${colLetter}2:${colLetter}`],
    includeGridData: true,
  });

  const rowData = gridRes.data.sheets?.[0]?.data?.[0]?.rowData || [];

  let targetRowIndex = rowData.findIndex((r) => {
    const cell = r.values?.[0];
    const val = cell?.formattedValue;
    return !val || val === "";
  });

  if (targetRowIndex === -1) targetRowIndex = rowData.length;

  return targetRowIndex + 2; // baris 2 = index 0
}

/* =======================
   MESSAGE HANDLER
======================= */
bot.on("message", async (msg) => {
  // ✅ hanya proses dari group/supergroup
  if (!isGroupChat(msg)) return;

  const chatId = msg.chat.id;
  const text = msg.caption || msg.text || "";

  // format: NAMA/ANGKA
  const match = text.match(/^(.+?)\/(\d+)$/);
  if (!match) return;

  const nama = match[1].trim().toUpperCase();
  const poin = match[2];

  try {
    // ambil header baris 1
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!1:1`,
    });

    const headers = headerRes.data.values
      ? headerRes.data.values[0].map((h) => (h || "").toString().toUpperCase())
      : [];

    const colIndex = headers.indexOf(nama);

    if (colIndex === -1) {
      await safeSendMessage(chatId, `⚠️ Nama "${nama}" belum ada di header!`, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    // cari baris kosong berikutnya (start baris 2)
    const rowNumber = await findNextEmptyRowInColumn(
      SHEET_ID,
      SHEET_NAME,
      colIndex
    );

    const colLetter = colToLetter(colIndex);

    // update cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${colLetter}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[poin]] },
    });

    // reply sukses seperti contoh kamu
    await safeSendMessage(
      chatId,
      `✅ Data disimpan!\nNama: ${nama}\nNilai: ${poin}\n📊 Baris ke-${rowNumber}`,
      { reply_to_message_id: msg.message_id }
    );

    console.log(`✅ INPUT OK: ${nama}/${poin} -> ${SHEET_NAME}!${colLetter}${rowNumber}`);
  } catch (e) {
    console.error("❌ Sheets error:", e?.message || e);
    await safeSendMessage(chatId, "❌ Gagal menyimpan ke Google Sheets.", {
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
