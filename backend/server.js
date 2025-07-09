const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 3000;

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, "recordings");
fs.mkdirSync(recordingsDir, { recursive: true });

// Multer configuration for file uploads (fallback)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, recordingsDir);
  },
  filename: (req, file, cb) => {
    const filename = `recording-${Date.now()}.webm`;
    cb(null, filename);
  },
});
const upload = multer({ storage });

app.use(express.static("public"));

// Global recording state sync
let isListening = false;
let currentListener = null;

wss.on("connection", (ws) => {
  console.log("🔌 WebSocket connection established");

  // Send initial state
  ws.send(JSON.stringify({ status: isListening ? "Listening..." : "", userId: currentListener }));

  // Create a write stream if user sends binary audio
  const audioFilename = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 5)}.webm`;
  const filePath = path.join(recordingsDir, audioFilename);
  const audioStream = fs.createWriteStream(filePath);

  ws.on("message", (data) => {
    // Detect whether it's a control message or binary audio
    if (typeof data === "string") {
      let message;
      try {
        message = JSON.parse(data);
      } catch (err) {
        console.error("❌ Invalid JSON message:", err);
        return;
      }

      if (message.type === "toggle-listen") {
        isListening = message.status === "Listening...";
        currentListener = isListening ? message.userId : null;

        // Broadcast updated state
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ status: message.status, userId: message.userId }));
          }
        });
      }
    } else if (Buffer.isBuffer(data)) {
      audioStream.write(data);
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket connection closed");
    audioStream.end(); // Finish writing audio file
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
    audioStream.end();
  });
});

// POST fallback: file upload endpoint
app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided" });
  }
  const stats = fs.statSync(req.file.path);
  console.log(`✅ File uploaded: ${req.file.filename} (${(stats.size / 1024).toFixed(2)} KB)`);
  res.json({ message: "File uploaded successfully", filename: req.file.filename });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
