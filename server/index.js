import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import { createStore } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "../client/dist");

const PORT = Number(process.env.PORT) || 8787;
const allowed = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: allowed.length ? allowed : true,
  }),
);
app.use(express.json());

const store = createStore();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "khamen" });
});

if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

app.get("/api/rooms/:code", (req, res) => {
  const room = store.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "الغرفة غير موجودة" });
  res.json({
    code: room.code,
    phase: room.phase,
    playerCount: room.players.filter((p) => p.connected).length,
    totalRounds: room.totalRounds,
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowed.length ? allowed : true,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.on("create", (payload = {}, ack) => {
    const result = store.createRoom({
      name: payload.name,
      rounds: payload.rounds,
      socketId: socket.id,
    });
    if (result.error) return ack?.({ error: result.error });
    socket.data.code = result.room.code;
    socket.data.playerId = result.player.id;
    socket.join(result.room.code);
    store.emitRoom(io, result.room);
    ack?.({ ok: true, playerId: result.player.id, code: result.room.code });
  });

  socket.on("join", (payload = {}, ack) => {
    const result = store.joinRoom({
      code: payload.code,
      name: payload.name,
      playerId: payload.playerId,
      socketId: socket.id,
    });
    if (result.error) return ack?.({ error: result.error });
    socket.data.code = result.room.code;
    socket.data.playerId = result.player.id;
    socket.join(result.room.code);
    store.emitRoom(io, result.room);
    ack?.({ ok: true, playerId: result.player.id, code: result.room.code });
  });

  socket.on("start", (ack) => {
    const result = store.startGame(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
    });
    ack?.(result.error ? { error: result.error } : { ok: true });
  });

  socket.on("vote", (payload = {}, ack) => {
    const result = store.vote(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
      choiceId: payload.choiceId,
    });
    ack?.(result.error ? { error: result.error } : { ok: true });
  });

  socket.on("next", (ack) => {
    const result = store.nextFromResults(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
    });
    ack?.(result.error ? { error: result.error } : { ok: true });
  });

  socket.on("again", (ack) => {
    const result = store.playAgain(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
    });
    ack?.(result.error ? { error: result.error } : { ok: true });
  });

  socket.on("leave", (ack) => {
    const result = store.leaveRoom(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
    });
    if (result.error) return ack?.({ error: result.error });
    if (socket.data.code) socket.leave(socket.data.code);
    socket.data.code = null;
    socket.data.playerId = null;
    ack?.({ ok: true });
  });

  socket.on("kick", (payload = {}, ack) => {
    const result = store.kickPlayer(io, {
      code: socket.data.code,
      playerId: socket.data.playerId,
      targetId: payload.playerId,
    });
    ack?.(result.error ? { error: result.error } : { ok: true });
  });

  socket.on("watch", (payload = {}, ack) => {
    const result = store.watchRoom({
      code: payload.code,
      socketId: socket.id,
    });
    if (result.error) return ack?.({ error: result.error });
    socket.data.watch = true;
    socket.data.code = result.room.code;
    socket.join(`watch:${result.room.code}`);
    socket.emit("state", store.publicRoom(result.room, null, { watch: true }));
    ack?.({ ok: true, code: result.room.code });
  });

  socket.on("disconnect", () => {
    store.disconnect(io, socket.id);
  });
});

setInterval(() => store.tick(io), 400);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path === "/health" || req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
    return next();
  }
  const indexFile = path.join(clientDir, "index.html");
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }
  res.type("html").send(`<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8" />
<title>خامن</title>
<body style="font-family:sans-serif;padding:40px;background:#f6efe4;color:#1c1610">
  <h1>خادم اللعبة يعمل</h1>
  <p>العب من <a href="https://saleh4dev.github.io/khamen/">صفحة GitHub</a>.</p>
</body>
</html>`);
});

httpServer.listen(PORT, () => {
  console.log(`khamen server on ${PORT}`);
});
