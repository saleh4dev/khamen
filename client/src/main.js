import "./style.css";
import { io } from "socket.io-client";
import QRCode from "qrcode";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : window.location.origin);
const SESSION_KEY = "who-session";
const app = document.getElementById("app");

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  autoConnect: true,
});

const params = new URLSearchParams(location.search);
const state = {
  screen: params.get("watch") ? "watch-join" : params.get("room") ? "join" : "home",
  name: "",
  rounds: 5,
  code: (params.get("room") || "").toUpperCase(),
  playerId: "",
  room: null,
  error: "",
  qr: "",
  choiceId: "",
  lastRoundId: "",
  copied: "",
  now: Date.now(),
  watch: params.get("watch") === "1",
  notice: "",
};

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(extra = {}) {
  if (!state.code || !state.playerId) return;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      code: state.code,
      playerId: state.playerId,
      name: state.name,
      left: false,
      ...extra,
    }),
  );
}

function roomUrl(code, extra = {}) {
  const url = new URL(location.href);
  const next = new URLSearchParams({ room: code, ...extra });
  url.search = `?${next.toString()}`;
  url.hash = "";
  return url.toString();
}

function watchUrl(code) {
  return roomUrl(code, { watch: "1" });
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function resetToHome(notice = "") {
  state.room = null;
  state.playerId = "";
  state.choiceId = "";
  state.lastRoundId = "";
  state.qr = "";
  state.watch = false;
  state.notice = notice;
  state.error = "";
  state.screen = "home";
  history.replaceState({}, "", location.pathname);
}

function ack(fn) {
  return (res = {}) => {
    if (res.error) {
      state.error = res.error;
      render();
      return;
    }
    state.error = "";
    fn?.(res);
  };
}

function createRoom() {
  state.error = "";
  socket.emit("create", { name: state.name, rounds: state.rounds }, ack((res) => {
    state.playerId = res.playerId;
    state.code = res.code;
    saveSession();
  }));
}

function joinRoom() {
  state.error = "";
  const session = loadSession();
  const playerId =
    state.playerId || (session?.code === state.code ? session.playerId : "");
  socket.emit(
    "join",
    { code: state.code, name: state.name, playerId },
    ack((res) => {
      state.playerId = res.playerId;
      state.code = res.code;
      saveSession();
    }),
  );
}

async function makeQr(code) {
  try {
    state.qr = await QRCode.toDataURL(roomUrl(code), {
      width: 360,
      margin: 1,
      color: { dark: "#1c1610", light: "#ffffff" },
    });
  } catch {
    state.qr = "";
  }
}

function remaining(endsAt) {
  return Math.max(0, Math.ceil((endsAt - state.now) / 1000));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function homeView() {
  return `
    <div class="shell">
      <div class="brand">
        <h1>مين؟</h1>
        <p>غرفة، باركود، وجولة تخمين سريعة</p>
      </div>
      <div class="card row">
        ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ""}
        <button class="btn btn-primary" data-go="create">أنشئ غرفة</button>
        <button class="btn btn-ghost" data-go="join">ادخل برمز الغرفة</button>
        <button class="btn btn-soft" data-go="watch-join">شاشة المتابعة</button>
      </div>
      <p class="footer-note">شارك الرابط أو الباركود، ثم ابدأ الجولات.</p>
    </div>
  `;
}

function createView() {
  return `
    <div class="shell">
      <div class="brand">
        <h1>غرفة جديدة</h1>
        <p>أنت المنشئ، والبقية يدخلون من الرابط</p>
      </div>
      <form class="card row" id="create-form">
        <div class="field">
          <label for="name">اسمك</label>
          <input id="name" name="name" maxlength="16" required value="${escapeHtml(state.name)}" />
        </div>
        <div class="field">
          <label for="rounds">عدد الجولات</label>
          <select id="rounds" name="rounds">
            ${[3, 5, 7, 10, 12, 15].map((n) => `<option value="${n}" ${Number(state.rounds) === n ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        <div class="actions">
          <button class="btn btn-primary" type="submit">إنشاء ونشر الرابط</button>
          <button class="btn btn-ghost" type="button" data-go="home">رجوع</button>
        </div>
      </form>
    </div>
  `;
}

function joinView() {
  return `
    <div class="shell">
      <div class="brand">
        <h1>دخول الغرفة</h1>
        <p>اكتب اسمك وانضم للّعب. يمكنك الخروج والعودة لاحقاً.</p>
      </div>
      <form class="card row" id="join-form">
        <div class="field">
          <label for="name">اسمك</label>
          <input id="name" name="name" maxlength="16" required value="${escapeHtml(state.name)}" />
        </div>
        <div class="field">
          <label for="code">رمز الغرفة</label>
          <input id="code" name="code" maxlength="8" required value="${escapeHtml(state.code)}" style="letter-spacing:.18em;text-transform:uppercase" />
        </div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        <div class="actions">
          <button class="btn btn-primary" type="submit">دخول</button>
          <button class="btn btn-ghost" type="button" data-go="home">رجوع</button>
        </div>
      </form>
    </div>
  `;
}

function watchJoinView() {
  return `
    <div class="shell">
      <div class="brand">
        <h1>شاشة المتابعة</h1>
        <p>اعرض الغرفة على تلفاز أو جهاز آخر بدون المشاركة</p>
      </div>
      <form class="card row" id="watch-form">
        <div class="field">
          <label for="code">رمز الغرفة</label>
          <input id="code" name="code" maxlength="8" required value="${escapeHtml(state.code)}" style="letter-spacing:.18em;text-transform:uppercase" />
        </div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        <div class="actions">
          <button class="btn btn-primary" type="submit">متابعة الغرفة</button>
          <button class="btn btn-ghost" type="button" data-go="home">رجوع</button>
        </div>
      </form>
    </div>
  `;
}

function playerRow(room, p) {
  const canKick = room.you?.isHost && !p.isHost;
  return `
    <div class="player">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div><span>${p.connected ? "متصل" : "خارج الغرفة"}</span></div>
      </div>
      <div class="player-actions">
        ${p.isHost ? `<em class="badge">القائد</em>` : ""}
        ${p.id === room.you?.id ? `<em class="badge">أنت</em>` : ""}
        ${canKick ? `<button class="btn btn-kick" data-kick="${p.id}">طرد</button>` : ""}
      </div>
    </div>
  `;
}

function leaveBar(room) {
  if (room.watch) return "";
  return `
    <div class="actions" style="margin-top:16px">
      <button class="btn btn-ghost" data-leave>خروج من الغرفة</button>
    </div>
  `;
}

function lobbyView(room) {
  const you = room.you;
  const play = roomUrl(room.code);
  const watch = watchUrl(room.code);
  return `
    <div class="shell">
      <div class="card">
        <div class="lobby-top">
          <p class="hint">امسح الباركود أو انسخ رابط اللعب</p>
          <p class="code">${escapeHtml(room.code)}</p>
          ${state.qr ? `<div class="qr"><img alt="باركود الغرفة" src="${state.qr}" /></div>` : ""}
          <div class="link">${escapeHtml(play)}</div>
          <div class="share-row">
            <button class="btn btn-soft" data-copy="play">${state.copied === "play" ? "تم النسخ" : "نسخ رابط اللعب"}</button>
            <button class="btn btn-soft" data-copy="watch">${state.copied === "watch" ? "تم النسخ" : "نسخ رابط المتابعة"}</button>
          </div>
          <div class="link">شاشة المتابعة: ${escapeHtml(watch)}</div>
        </div>
        <div class="meta">
          <span>الجولات: ${room.totalRounds}</span>
          <span>${room.players.filter((p) => p.connected).length} لاعبون</span>
        </div>
        <div class="players">
          ${room.players.map((p) => playerRow(room, p)).join("")}
        </div>
        ${state.error ? `<div class="error" style="margin-top:12px">${escapeHtml(state.error)}</div>` : ""}
        <div class="actions" style="margin-top:16px">
          ${you?.isHost ? `<button class="btn btn-primary" data-start>ابدأ اللعبة</button>` : `<p class="hint">انتظر القائد ليبدأ الجولة الأولى</p>`}
        </div>
        ${leaveBar(room)}
      </div>
    </div>
  `;
}

function votingView(room) {
  const round = room.round;
  const seconds = remaining(round.endsAt);
  const markClass = round.mark === "check" ? "check" : "cross";
  const mark = round.mark === "check" ? "✓" : "✕";
  return `
    <div class="shell">
      <div class="card">
        <div class="meta">
          <span>الجولة ${round.number} من ${room.totalRounds}</span>
          <span>صوّت ${round.votedCount} / ${round.voterCount}</span>
        </div>
        <div class="mark-wrap">
          <div class="mark ${markClass}">${mark}</div>
          ${round.phrase ? `<p class="phrase">${escapeHtml(round.phrase)}</p>` : `<p class="hint">ابحث عمن ظهرت عنده علامة الصح</p>`}
        </div>
        <p class="timer">${seconds} ثانية</p>
        ${round.youVoted ? `<p class="hint" style="text-align:center;margin-bottom:12px">تم تسجيل اختيارك</p>` : `<p class="hint" style="text-align:center;margin-bottom:12px">من تتوقع أن علامة الصح معه؟</p>`}
        <div class="row">
          ${room.players.filter((p) => p.connected).map((p) => `
            <div class="choice-row">
              <button class="choice ${state.choiceId === p.id ? "selected" : ""}" data-vote="${p.id}" ${round.youVoted ? "disabled" : ""}>
                ${escapeHtml(p.name)}${p.id === room.you?.id ? " (أنت)" : ""}
              </button>
              ${room.you?.isHost && !p.isHost ? `<button class="btn btn-kick" data-kick="${p.id}">طرد</button>` : ""}
            </div>
          `).join("")}
        </div>
        ${leaveBar(room)}
      </div>
    </div>
  `;
}

function resultsView(room) {
  const round = room.round;
  const seconds = remaining(round.endsAt);
  return `
    <div class="shell">
      <div class="card">
        <div class="meta">
          <span>نتيجة الجولة ${round.number}</span>
          <span>${seconds} ث</span>
        </div>
        <div class="mark-wrap">
          <div class="mark check">✓</div>
          <p class="phrase">المقصود: ${escapeHtml(round.targetName)}</p>
        </div>
        <div class="players" style="margin-top:0">
          ${round.votes.map((v) => `
            <div class="vote-line">
              <b>${escapeHtml(v.voterName)}</b> اختار <b>${escapeHtml(v.choiceName)}</b>
              ${v.correct ? `<span class="ok"> +${v.earned}</span>` : `<span class="no"> خطأ</span>`}
            </div>
          `).join("")}
        </div>
        <h3 style="margin:18px 0 10px;font-size:16px">النقاط حتى الآن</h3>
        ${scoreList(room.scores, room.you?.id)}
        ${room.you?.isHost ? `<div class="actions" style="margin-top:16px"><button class="btn btn-primary" data-next>${room.currentRound >= room.totalRounds ? "النتيجة النهائية" : "الجولة التالية"}</button></div>` : `<p class="hint" style="margin-top:14px;text-align:center">الانتقال للجولة التالية تلقائي</p>`}
        ${leaveBar(room)}
      </div>
    </div>
  `;
}

function finishedView(room) {
  return `
    <div class="shell">
      <div class="brand">
        <h1>انتهت اللعبة</h1>
        <p>ترتيب اللاعبين حسب النقاط</p>
      </div>
      <div class="card">
        ${scoreList(room.finalScores || room.scores, room.you?.id)}
        ${room.you?.isHost ? `<div class="actions" style="margin-top:16px"><button class="btn btn-primary" data-again>العب مرة أخرى</button></div>` : `<p class="hint" style="margin-top:14px;text-align:center">انتظر القائد لإعادة اللعب</p>`}
        ${leaveBar(room)}
      </div>
    </div>
  `;
}

function watchView(room) {
  const phaseLabel = {
    lobby: "في الانتظار",
    voting: "جاري التخمين",
    results: "نتيجة الجولة",
    finished: "انتهت اللعبة",
  }[room.phase] || "";
  const round = room.round;
  return `
    <div class="shell shell-wide">
      <div class="brand">
        <h1>متابعة ${escapeHtml(room.code)}</h1>
        <p>${phaseLabel} · الجولة ${room.currentRound || 0} من ${room.totalRounds}</p>
      </div>
      <div class="card">
        ${room.phase === "lobby" ? `
          <p class="hint" style="text-align:center">بانتظار القائد لبدء اللعبة</p>
          <div class="players">${room.players.map((p) => playerRow(room, p)).join("")}</div>
        ` : ""}
        ${room.phase === "voting" && round ? `
          <p class="timer">${remaining(round.endsAt)} ثانية</p>
          <p class="hint" style="text-align:center;margin-bottom:12px">صوّت ${round.votedCount} من ${round.voterCount}</p>
          <p class="hint" style="text-align:center">${(round.votedNames || []).length ? `اختار: ${round.votedNames.map(escapeHtml).join("، ")}` : "لم يختر أحد بعد"}</p>
          ${scoreList(room.scores)}
        ` : ""}
        ${room.phase === "results" && round ? `
          <div class="mark-wrap">
            <div class="mark check">✓</div>
            <p class="phrase">المقصود: ${escapeHtml(round.targetName)}</p>
          </div>
          ${(round.votes || []).map((v) => `
            <div class="vote-line">
              <b>${escapeHtml(v.voterName)}</b> اختار <b>${escapeHtml(v.choiceName)}</b>
              ${v.correct ? `<span class="ok"> +${v.earned}</span>` : `<span class="no"> خطأ</span>`}
            </div>
          `).join("")}
          <h3 style="margin:18px 0 10px;font-size:16px">النقاط</h3>
          ${scoreList(room.scores)}
        ` : ""}
        ${room.phase === "finished" ? scoreList(room.finalScores || room.scores) : ""}
      </div>
    </div>
  `;
}

function scoreList(scores, meId) {
  return `
    <div class="score-list">
      ${(scores || []).map((s) => `
        <div class="score ${s.id === meId ? "me" : ""}">
          <div class="rank">${s.rank}</div>
          <strong>${escapeHtml(s.name)}</strong>
          <span>${s.score}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function render() {
  const room = state.room;
  if (state.watch && room) {
    app.innerHTML = watchView(room);
    return;
  }
  if (room?.phase === "lobby") state.screen = "lobby";
  if (room?.phase === "voting") state.screen = "voting";
  if (room?.phase === "results") state.screen = "results";
  if (room?.phase === "finished") state.screen = "finished";

  if (state.screen === "home") app.innerHTML = homeView();
  else if (state.screen === "create") app.innerHTML = createView();
  else if (state.screen === "join") app.innerHTML = joinView();
  else if (state.screen === "watch-join") app.innerHTML = watchJoinView();
  else if (state.screen === "lobby" && room) app.innerHTML = lobbyView(room);
  else if (state.screen === "voting" && room) app.innerHTML = votingView(room);
  else if (state.screen === "results" && room) app.innerHTML = resultsView(room);
  else if (state.screen === "finished" && room) app.innerHTML = finishedView(room);
  else app.innerHTML = homeView();
}

app.addEventListener("click", async (event) => {
  const go = event.target.closest("[data-go]");
  if (go) {
    state.screen = go.dataset.go;
    state.error = "";
    state.notice = "";
    state.watch = go.dataset.go === "watch-join";
    render();
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy && state.room) {
    const kind = copy.dataset.copy || "play";
    const text = kind === "watch" ? watchUrl(state.room.code) : roomUrl(state.room.code);
    try {
      await navigator.clipboard.writeText(text);
      state.copied = kind;
      render();
      setTimeout(() => {
        state.copied = "";
        render();
      }, 1400);
    } catch {
      state.error = "تعذر نسخ الرابط";
      render();
    }
    return;
  }
  if (event.target.closest("[data-leave]")) {
    socket.emit("leave", ack(() => {
      saveSession({ left: true });
      resetToHome("خرجت من الغرفة. ادخل بنفس الاسم للعودة.");
      render();
    }));
    return;
  }
  const kick = event.target.closest("[data-kick]");
  if (kick) {
    socket.emit("kick", { playerId: kick.dataset.kick }, ack());
    return;
  }
  if (event.target.closest("[data-start]")) {
    socket.emit("start", ack());
    return;
  }
  if (event.target.closest("[data-next]")) {
    socket.emit("next", ack());
    return;
  }
  if (event.target.closest("[data-again]")) {
    socket.emit("again", ack());
    return;
  }
  const vote = event.target.closest("[data-vote]");
  if (vote) {
    state.choiceId = vote.dataset.vote;
    socket.emit("vote", { choiceId: state.choiceId }, ack());
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  state.name = String(data.get("name") || "").trim();
  if (form.id === "create-form") {
    state.rounds = Number(data.get("rounds")) || 5;
    createRoom();
  }
  if (form.id === "join-form") {
    state.code = String(data.get("code") || "").trim().toUpperCase();
    joinRoom();
  }
  if (form.id === "watch-form") {
    state.code = String(data.get("code") || "").trim().toUpperCase();
    state.watch = true;
    socket.emit("watch", { code: state.code }, ack((res) => {
      history.replaceState({}, "", `?room=${res.code}&watch=1`);
    }));
  }
});

socket.on("state", async (room) => {
  const previous = state.room?.phase;
  const previousRoundId = state.room?.round?.id || state.lastRoundId;
  state.room = room;
  state.code = room.code;
  if (room.watch) state.watch = true;
  if (room.you) {
    state.playerId = room.you.id;
    state.name = room.you.name;
    saveSession();
  }
  if (room.phase === "lobby" && previous !== "lobby" && !state.watch) {
    await makeQr(room.code);
    history.replaceState({}, "", `?room=${room.code}`);
  }
  if (room.phase === "voting") {
    const nextRoundId = room.round?.id || `${room.currentRound}`;
    if (nextRoundId !== previousRoundId) {
      state.choiceId = "";
      state.lastRoundId = nextRoundId;
    }
  }
  if (room.phase === "lobby" || room.phase === "finished") {
    state.choiceId = "";
    state.lastRoundId = "";
  }
  render();
});

socket.on("kicked", () => {
  clearSession();
  resetToHome("تم طردك من الغرفة.");
  render();
});

socket.on("connect", () => {
  const session = loadSession();
  const roomCode = (params.get("room") || session?.code || "").toUpperCase();
  if (state.watch && roomCode) {
    state.code = roomCode;
    socket.emit("watch", { code: roomCode }, ack());
    return;
  }
  if (session?.playerId && roomCode && session.code === roomCode && !session.left && !state.watch) {
    state.playerId = session.playerId;
    state.name = session.name || state.name;
    state.code = roomCode;
    socket.emit("join", { code: roomCode, name: state.name, playerId: session.playerId }, () => {});
  }
});

socket.on("connect_error", () => {
  state.error = "تعذر الاتصال بالخادم. تأكد من عنوان Render.";
  render();
});

setInterval(() => {
  state.now = Date.now();
  if (state.room?.phase === "voting" || state.room?.phase === "results") render();
}, 250);

render();
