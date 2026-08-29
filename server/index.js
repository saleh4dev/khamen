import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { createStore } from "./game.js";

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
  res.json({ ok: true, service: "who" });
});

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

  socket.on("disconnect", () => {
    store.disconnect(io, socket.id);
  });
});

setInterval(() => store.tick(io), 400);

httpServer.listen(PORT, () => {
  console.log(`who server on ${PORT}`);
});
