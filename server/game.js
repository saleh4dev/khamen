const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const VOTE_SECONDS = 25;
const RESULT_SECONDS = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const PHRASES = [
  "أنت المقصود",
  "العلامة الخضراء لك",
  "هذه الجولة عنك",
  "هم يبحثون عنك",
  "لا تخبر أحداً… أنت هو",
];

export function createStore() {
  const rooms = new Map();

  function now() {
    return Date.now();
  }

  function makeCode() {
    for (let i = 0; i < 20; i += 1) {
      let code = "";
      for (let j = 0; j < 5; j += 1) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
      if (!rooms.has(code)) return code;
    }
    return `R${now().toString(36).slice(-4).toUpperCase()}`;
  }

  function publicPlayers(room) {
    return room.players
      .filter((p) => !p.kicked)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        isHost: p.id === room.hostId,
      }));
  }

  function activePlayers(room) {
    return room.players.filter((p) => !p.kicked);
  }

  function connectedPlayers(room) {
    return activePlayers(room).filter((p) => p.connected);
  }

  function votedNames(room) {
    if (!room.round) return [];
    return [...room.round.votes.keys()]
      .map((id) => activePlayers(room).find((p) => p.id === id)?.name)
      .filter(Boolean);
  }

  function sortedScores(room) {
    return activePlayers(room)
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p, index) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        rank: index + 1,
      }));
  }

  function publicRoom(room, playerId, { watch = false } = {}) {
    const me = watch ? null : activePlayers(room).find((p) => p.id === playerId);
    const payload = {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      totalRounds: room.totalRounds,
      currentRound: room.currentRound,
      voteSeconds: VOTE_SECONDS,
      resultSeconds: RESULT_SECONDS,
      players: publicPlayers(room),
      scores: sortedScores(room),
      watch,
      you: me
        ? { id: me.id, name: me.name, score: me.score, isHost: me.id === room.hostId }
        : null,
    };

    if (room.phase === "voting" && room.round) {
      payload.round = {
        id: room.round.id,
        number: room.currentRound,
        endsAt: room.round.endsAt,
        votedCount: room.round.votes.size,
        voterCount: connectedPlayers(room).length,
        votedNames: votedNames(room),
        youVoted: Boolean(playerId) && room.round.votes.has(playerId),
        yourChoiceId: (playerId && room.round.votes.get(playerId)?.choiceId) || null,
        mark: !watch && playerId === room.round.targetId ? "check" : watch ? null : "cross",
        phrase: !watch && playerId === room.round.targetId ? room.round.phrase : null,
      };
    }

    if (room.phase === "results" && room.round) {
      payload.round = {
        id: room.round.id,
        number: room.currentRound,
        endsAt: room.round.revealUntil,
        targetId: room.round.targetId,
        targetName: activePlayers(room).find((p) => p.id === room.round.targetId)?.name || "",
        votes: [...room.round.votes.entries()].map(([voterId, vote]) => {
          const voter = activePlayers(room).find((p) => p.id === voterId);
          const picked = activePlayers(room).find((p) => p.id === vote.choiceId);
          return {
            voterId,
            voterName: voter?.name || "",
            choiceId: vote.choiceId,
            choiceName: picked?.name || "",
            correct: vote.choiceId === room.round.targetId,
            earned: vote.earned,
          };
        }),
        youVoted: Boolean(playerId) && room.round.votes.has(playerId),
        mark: !watch && playerId === room.round.targetId ? "check" : watch ? null : "cross",
        phrase: !watch && playerId === room.round.targetId ? room.round.phrase : null,
      };
    }

    if (room.phase === "finished") {
      payload.finalScores = sortedScores(room);
    }

    return payload;
  }

  function getRoom(code) {
    if (!code) return null;
    const room = rooms.get(String(code).trim().toUpperCase());
    if (!room) return null;
    if (now() - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(room.code);
      return null;
    }
    return room;
  }

  function touch(room) {
    room.updatedAt = now();
  }

  function emitRoom(io, room) {
    for (const player of activePlayers(room)) {
      if (!player.socketId) continue;
      io.to(player.socketId).emit("state", publicRoom(room, player.id));
    }
    io.to(`watch:${room.code}`).emit("state", publicRoom(room, null, { watch: true }));
  }

  function awardVote(room, voter, choiceId) {
    const elapsed = now() - room.round.startedAt;
    const remaining = Math.max(0, VOTE_SECONDS * 1000 - elapsed);
    const correct = choiceId === room.round.targetId;
    let earned = 0;
    if (correct) {
      const speedBonus = Math.round((remaining / (VOTE_SECONDS * 1000)) * 40);
      earned = 60 + speedBonus;
    }
    voter.score += earned;
    room.round.votes.set(voter.id, { choiceId, at: now(), earned });
    return earned;
  }

  function finishVoting(io, room) {
    if (room.phase !== "voting") return;
    room.phase = "results";
    room.round.revealUntil = now() + RESULT_SECONDS * 1000;
    touch(room);
    emitRoom(io, room);
  }

  function maybeFinishVoting(io, room) {
    const voters = connectedPlayers(room);
    if (voters.length > 0 && voters.every((p) => room.round.votes.has(p.id))) {
      finishVoting(io, room);
    }
  }

  function startRound(io, room) {
    const connected = connectedPlayers(room);
    if (connected.length < 2) {
      room.phase = "lobby";
      room.round = null;
      touch(room);
      emitRoom(io, room);
      return { error: "يلزم لاعبان متصلان على الأقل" };
    }
    const target = connected[Math.floor(Math.random() * connected.length)];
    room.phase = "voting";
    room.currentRound += 1;
    room.round = {
      id: crypto.randomUUID(),
      targetId: target.id,
      phrase: PHRASES[Math.floor(Math.random() * PHRASES.length)],
      startedAt: now(),
      endsAt: now() + VOTE_SECONDS * 1000,
      votes: new Map(),
      revealUntil: 0,
    };
    touch(room);
    emitRoom(io, room);
    return { ok: true };
  }

  function advanceAfterResults(io, room) {
    if (room.phase !== "results") return;
    if (room.currentRound >= room.totalRounds) {
      room.phase = "finished";
      room.round = null;
    } else {
      startRound(io, room);
      return;
    }
    touch(room);
    emitRoom(io, room);
  }

  function createRoom({ name, rounds, socketId }) {
    const totalRounds = Math.min(15, Math.max(1, Number(rounds) || 5));
    const playerName = String(name || "").trim().slice(0, 16);
    if (!playerName) return { error: "اكتب اسمك أولاً" };

    const code = makeCode();
    const player = {
      id: crypto.randomUUID(),
      name: playerName,
      score: 0,
      connected: true,
      kicked: false,
      socketId,
      joinedAt: now(),
    };
    const room = {
      code,
      hostId: player.id,
      totalRounds,
      currentRound: 0,
      phase: "lobby",
      players: [player],
      kickedIds: new Set(),
      round: null,
      createdAt: now(),
      updatedAt: now(),
    };
    rooms.set(code, room);
    return { room, player };
  }

  function joinRoom({ code, name, playerId, socketId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.phase === "finished") return { error: "انتهت هذه اللعبة" };

    if (playerId && room.kickedIds.has(playerId)) {
      return { error: "تم طردك من هذه الغرفة" };
    }

    if (playerId) {
      const existing = room.players.find((p) => p.id === playerId && !p.kicked);
      if (existing) {
        existing.connected = true;
        existing.socketId = socketId;
        if (name) existing.name = String(name).trim().slice(0, 16) || existing.name;
        touch(room);
        return { room, player: existing, rejoined: true };
      }
    }

    const playerName = String(name || "").trim().slice(0, 16);
    if (!playerName) return { error: "اكتب اسمك أولاً" };
    const sameName = activePlayers(room).find((p) => p.name === playerName);
    if (sameName && sameName.connected) {
      return { error: "هذا الاسم مستخدم في الغرفة" };
    }
    if (sameName && !sameName.connected) {
      sameName.connected = true;
      sameName.socketId = socketId;
      touch(room);
      return { room, player: sameName, rejoined: true };
    }
    if (connectedPlayers(room).length >= 16) {
      return { error: "الغرفة ممتلئة" };
    }

    const player = {
      id: crypto.randomUUID(),
      name: playerName,
      score: 0,
      connected: true,
      kicked: false,
      socketId,
      joinedAt: now(),
    };
    room.players.push(player);
    touch(room);
    return { room, player };
  }

  function startGame(io, { code, playerId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.hostId !== playerId) return { error: "المنشئ فقط يبدأ اللعبة" };
    if (room.phase !== "lobby") return { error: "اللعبة بدأت بالفعل" };
    const connected = connectedPlayers(room);
    if (connected.length < 2) return { error: "انتظر لاعباً آخر على الأقل" };
    return startRound(io, room);
  }

  function vote(io, { code, playerId, choiceId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.phase !== "voting") return { error: "التصويت غير متاح الآن" };
    const voter = activePlayers(room).find((p) => p.id === playerId);
    if (!voter) return { error: "لست في هذه الغرفة" };
    if (room.round.votes.has(playerId)) return { error: "لقد صوّت بالفعل" };
    if (!activePlayers(room).some((p) => p.id === choiceId)) return { error: "لاعب غير موجود" };
    if (now() > room.round.endsAt) {
      finishVoting(io, room);
      return { error: "انتهى الوقت" };
    }
    awardVote(room, voter, choiceId);
    touch(room);
    emitRoom(io, room);
    maybeFinishVoting(io, room);
    return { ok: true };
  }

  function nextFromResults(io, { code, playerId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.phase !== "results") return { error: "ليست مرحلة النتائج" };
    if (room.hostId !== playerId) return { error: "المنشئ فقط يتابع" };
    advanceAfterResults(io, room);
    return { ok: true };
  }

  function playAgain(io, { code, playerId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.hostId !== playerId) return { error: "المنشئ فقط يعيد اللعب" };
    if (room.phase !== "finished") return { error: "اللعبة لم تنته بعد" };
    for (const p of activePlayers(room)) p.score = 0;
    room.currentRound = 0;
    room.round = null;
    room.phase = "lobby";
    touch(room);
    emitRoom(io, room);
    return { ok: true };
  }

  function leaveRoom(io, { code, playerId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    const player = activePlayers(room).find((p) => p.id === playerId);
    if (!player) return { error: "لست في هذه الغرفة" };
    player.connected = false;
    player.socketId = null;
    if (room.phase === "voting" && room.round) {
      room.round.votes.delete(playerId);
    }
    touch(room);
    if (room.phase === "voting") maybeFinishVoting(io, room);
    else emitRoom(io, room);
    return { ok: true, room };
  }

  function kickPlayer(io, { code, playerId, targetId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    if (room.hostId !== playerId) return { error: "قائد الغرفة فقط يطرد اللاعبين" };
    if (targetId === room.hostId) return { error: "لا يمكن طرد قائد الغرفة" };
    const target = activePlayers(room).find((p) => p.id === targetId);
    if (!target) return { error: "اللاعب غير موجود" };
    const targetSocket = target.socketId;
    target.connected = false;
    target.kicked = true;
    target.socketId = null;
    room.kickedIds.add(target.id);
    if (room.round) {
      room.round.votes.delete(target.id);
      if (room.round.targetId === target.id && room.phase === "voting") {
        room.currentRound -= 1;
        if (targetSocket) io.to(targetSocket).emit("kicked");
        return startRound(io, room);
      }
    }
    if (targetSocket) io.to(targetSocket).emit("kicked");
    touch(room);
    if (room.phase === "voting") maybeFinishVoting(io, room);
    else emitRoom(io, room);
    return { ok: true };
  }

  function watchRoom({ code, socketId }) {
    const room = getRoom(code);
    if (!room) return { error: "الغرفة غير موجودة" };
    touch(room);
    return { room, socketId };
  }

  function disconnect(io, socketId) {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      touch(room);
      if (room.phase === "voting") maybeFinishVoting(io, room);
      else emitRoom(io, room);
    }
  }

  function tick(io) {
    const t = now();
    for (const room of rooms.values()) {
      if (t - room.updatedAt > ROOM_TTL_MS) {
        rooms.delete(room.code);
        continue;
      }
      if (room.phase === "voting" && room.round && t >= room.round.endsAt) {
        finishVoting(io, room);
      } else if (room.phase === "results" && room.round && t >= room.round.revealUntil) {
        advanceAfterResults(io, room);
      }
    }
  }

  return {
    createRoom,
    joinRoom,
    startGame,
    vote,
    nextFromResults,
    playAgain,
    leaveRoom,
    kickPlayer,
    watchRoom,
    disconnect,
    publicRoom,
    getRoom,
    emitRoom,
    tick,
  };
}
