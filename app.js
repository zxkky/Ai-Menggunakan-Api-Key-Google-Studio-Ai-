const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// KONFIGURASI DASAR
// ================================
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ================================
// KONFIGURASI MULTER
// ================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// ================================
// VARIABEL GLOBAL
// ================================
let chatHistory = [];

const GEMINI_API_URL =
  "Your Gemini Api URl";

// ================================
// ROUTE: /api/chat
// ================================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, image } = req.body;
    if (!message && !image)
      return res.status(400).json({ error: "Pesan atau gambar harus diisi." });

    chatHistory.push({ role: "user", message, image });

    const parts = [];
    if (message) parts.push({ text: message });
    if (image)
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: image,
        },
      });

    const response = await fetch(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("Error API:", data.error);
      return res.status(400).json({ error: data.error.message });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Tidak ada balasan dari model.";

    chatHistory.push({ role: "assistant", message: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Gagal menghubungi API." });
  }
});

// ================================
// ROUTE: /api/upload
// ================================
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "File tidak ditemukan." });

    const filePath = req.file.path;
    const mime = req.file.mimetype;
    let extractedText = "";

    if (mime === "application/pdf") {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        extractedText = pdfData.text || "";
      } catch (err) {
        console.warn("⚠️ PDF parsing gagal:", err.message);
        extractedText = "Gagal membaca isi PDF. File mungkin terenkripsi atau rusak.";
      }
    } else if (
      mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (mime.startsWith("text/")) {
      extractedText = fs.readFileSync(filePath, "utf8");
    } else if (
      mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
      });
      extractedText = data.map((row) => row.join(" | ")).join("\n");
    } else {
      return res.status(400).json({ error: "Tipe file tidak didukung." });
    }

    extractedText = extractedText.slice(0, 4000) || "Tidak ada teks terbaca.";

    const geminiResponse = await fetch(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Tolong jelaskan isi file berikut secara ringkas:\n\n${extractedText}`,
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await geminiResponse.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Tidak ada balasan dari model.";

    chatHistory.push({
      role: "user",
      message: `📎 File diupload: ${req.file.originalname}`,
    });
    chatHistory.push({ role: "assistant", message: reply });

    fs.unlink(filePath, (err) => {
      if (err) console.warn("Gagal hapus file:", err.message);
    });

    res.json({
      success: true,
      message: `✅ File "${req.file.originalname}" berhasil dianalisis!`,
      reply,
    });
  } catch (error) {
    console.error("❌ Error upload:", error);
    res.status(500).json({ error: "Gagal memproses file." });
  }
});

// ================================
// ROUTE: /api/history
// ================================
app.get("/api/history", (req, res) => res.json({ history: chatHistory }));

// ================================
// ROUTE: /api/clear
// ================================
app.delete("/api/clear", (req, res) => {
  chatHistory = [];
  res.json({ success: true, message: "History chat berhasil dihapus." });
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  console.log("🔑 Pastikan .env berisi GEMINI_API_KEY=AIzaSyXXXXXX");
});
