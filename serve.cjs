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

/* ================= МУЛЬТИПЛЕЕР (комнаты, до 4 игроков) ================= */
let WebSocketServer = null;
try {
  ({ WebSocketServer } = require("ws"));
} catch (e) {
  WebSocketServer = null;
}

if (WebSocketServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const rooms = new Map(); // code -> { code, host: ws, nextId, clients: Map<ws,{id,name}> }
  const clientRoom = new Map(); // ws -> { code, id }

  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const genCode = () => {
    let c = "";
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return rooms.has(c) ? genCode() : c;
  };

  const send = (ws, obj) => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { /* noop */ }
  };
  const roomPlayers = (room) =>
    [...room.clients.entries()].map(([, info]) => ({ id: info.id, name: info.name }));
  const sendRoomUpdate = (room) => {
    const players = roomPlayers(room);
    for (const [ws, info] of room.clients) send(ws, { t: "room", code: room.code, you: info.id, host: 0, players });
  };
  const removeFromRoom = (ws) => {
    const cur = clientRoom.get(ws);
    if (!cur) return;
    clientRoom.delete(ws);
    const room = rooms.get(cur.code);
    if (!room) return;
    if (room.host === ws) {
      // host left -> close room, tell everyone
      rooms.delete(cur.code);
      for (const [other] of room.clients) {
        if (other !== ws) {
          clientRoom.delete(other);
          send(other, { t: "err", msg: "Хост покинул комнату" });
        }
      }
      return;
    }
    room.clients.delete(ws);
    send(room.host, { t: "peerleft", id: cur.id });
    sendRoomUpdate(room);
  };

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      const cur = clientRoom.get(ws);

      if (m.t === "create") {
        if (cur) removeFromRoom(ws);
        const code = genCode();
        const room = { code, host: ws, nextId: 1, clients: new Map() };
        room.clients.set(ws, { id: 0, name: String(m.name || "ХОСТ").slice(0, 14) });
        rooms.set(code, room);
        clientRoom.set(ws, { code, id: 0 });
        sendRoomUpdate(room);
        return;
      }

      if (m.t === "join") {
        const code = String(m.code || "").toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { send(ws, { t: "err", msg: "Комната не найдена" }); return; }
        if (room.clients.size >= 4) { send(ws, { t: "err", msg: "Комната заполнена (4)" }); return; }
        if (cur) removeFromRoom(ws);
        const id = room.nextId++;
        room.clients.set(ws, { id, name: String(m.name || "БОЕЦ").slice(0, 14) });
        clientRoom.set(ws, { code, id });
        sendRoomUpdate(room);
        return;
      }

      if (m.t === "leave") { removeFromRoom(ws); return; }

      if (m.t === "start") {
        if (!cur) return;
        const room = rooms.get(cur.code);
        if (!room || room.host !== ws) return;
        const seed = (Math.random() * 1e9) | 0;
        const players = roomPlayers(room);
        for (const [cws, info] of room.clients) send(cws, { t: "begin", seed, players, host: 0, you: info.id });
        return;
      }

      // in-game traffic
      if (m.t === "in") {
        if (!cur) return;
        const room = rooms.get(cur.code);
        if (!room || room.host === ws) return;
        send(room.host, Object.assign({}, m, { from: cur.id }));
        return;
      }

      // host broadcasts: snap / fx / banner / over
      if (cur && ["snap", "fx", "banner", "over"].includes(m.t)) {
        const room = rooms.get(cur.code);
        if (room && room.host === ws) {
          for (const [other] of room.clients) if (other !== ws) send(other, m);
        }
      }
    });

    ws.on("close", () => removeFromRoom(ws));
    ws.on("error", () => removeFromRoom(ws));
  });

  console.log("  Мультиплеер: активен (ws://…:" + PORT + "/ws, до 4 игроков)");
} else {
  console.log("  Мультиплеер: НЕДОСТУПЕН (модуль 'ws' не установлен — выполните npm install)");
}

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
