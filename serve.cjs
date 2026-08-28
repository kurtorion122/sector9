/**
 * СЕКТОР-9 — локальный сервер раздачи.
 * Запуск:  node serve.cjs          (порт 3000)
 *          set PORT=8080 && node serve.cjs   (свой порт)
 * Раздаёт папку dist/ на localhost и в локальную сеть. Зависимостей не требует.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "dist");
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("");
  console.error("  ОШИБКА: папка dist/ не найдена.");
  console.error("  Сначала соберите игру:  npm run build");
  console.error("");
  process.exit(1);
}

function localIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath = path.normalize(path.join(ROOT, urlPath));
    // защита от выхода за пределы dist/
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("403 Forbidden");
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    // SPA-fallback: любой неизвестный путь отдаёт index.html
    if (!fs.existsSync(filePath)) filePath = path.join(ROOT, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end("500 Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ========================================");
  console.log("   СЕКТОР-9 // ТУМАН ВОЙНЫ — сервер запущен");
  console.log("  ========================================");
  console.log("");
  console.log("   На этом ПК:      http://localhost:" + PORT);
  const ips = localIPs();
  if (ips.length === 0) {
    console.log("   Для сети (LAN):  не найдено сетевых адресов");
  } else {
    for (const ip of ips) console.log("   Для сети (LAN):  http://" + ip + ":" + PORT);
  }
  console.log("");
  console.log("   Остановить сервер: Ctrl+C");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("  ОШИБКА: порт " + PORT + " уже занят.");
    console.error("  Запустите на другом:  set PORT=8080 && node serve.cjs");
  } else {
    console.error("  ОШИБКА: " + err.message);
  }
  process.exit(1);
});
