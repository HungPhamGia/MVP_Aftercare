/* =========================================================================
   AfterCare · chatbot.js — "Demo cuộc gọi AI", speech-to-speech.
   Pick a patient → GPT drives the call via the server BFF (/bff/conversation),
   asking the patient's approved questions. Bot text is read aloud (SmartVoice
   TTS /bff/tts when wired, else browser speechSynthesis); when it finishes the
   mic opens automatically, the patient's speech is transcribed live into the
   panel (SmartVoice STT /bff/stt or browser Web Speech) and auto-submitted on
   silence. Typing stays as a fallback when the mic fails. Creds server-side.
   On hang-up the transcript is saved and GPT summarises + classifies the tier.
   ========================================================================= */

function demoId() { return new URLSearchParams(location.search).get("id") || ""; }

const DEMO = {
  maHoSo: demoId(), patient: null, session: null, lastQ: null,
  phase: "setup", transcript: [], answers: [], interim: "",
  awaiting: false, ttsOn: true, startTs: 0, timerId: null, rec: null,
  sttOn: false, ttsOnSV: false, audio: null, recCtx: null, micDead: false,
  misses: 0, // consecutive turns where STT heard nothing usable
};

// Which SmartVoice services are wired on the server? (STT/TTS keyed separately.)
API.get("/bff/voice-config").then(c => {
  DEMO.sttOn = !!(c && c.stt); DEMO.ttsOnSV = !!(c && c.tts);
}).catch(() => {});

/* ---- helpers ---------------------------------------------------------- */
function isBot(t) { return /trợ lý/i.test(t.who); }
function stopSpeak() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (DEMO.audio) { try { DEMO.audio.pause(); } catch (e) {} DEMO.audio = null; }
}
/* Speak `text`, then call onEnd exactly once (immediately when TTS is off or
   unavailable) — onEnd is what re-opens the mic for the speech-to-speech loop. */
function speak(text, onEnd) {
  let called = false;
  const done = () => { if (!called) { called = true; if (onEnd) onEnd(); } };
  if (!DEMO.ttsOn || !text) { done(); return; }
  stopSpeak();
  if (DEMO.ttsOnSV) {
    // SmartVoice TTS: server returns a public wav link; play it directly.
    API.post("/bff/tts", { text }).then(r => {
      if (r && r.audio_link && DEMO.ttsOn && DEMO.phase === "calling") {
        DEMO.audio = new Audio(r.audio_link);
        DEMO.audio.onended = done;
        DEMO.audio.onerror = done;
        DEMO.audio.play().catch(done);
      } else done();
    }).catch(done);
    return;
  }
  if (!window.speechSynthesis) { done(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "vi-VN"; u.rate = 1;
  const v = (window.speechSynthesis.getVoices() || []).find(x => /vi/i.test(x.lang));
  if (v) u.voice = v;
  u.onend = done; u.onerror = done;
  window.speechSynthesis.speak(u);
}
function fmtTimer(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ---- 1) setup screen -------------------------------------------------- */
function renderSetup() {
  DEMO.phase = "setup";
  const opts = PATIENTS.map(p => `<option value="${esc(p.mrn)}">${esc(p.name)} (${esc(p.mrn)})</option>`).join("");
  $("#demoRoot").innerHTML = `
    <section class="card demo-setup">
      <h2>Chọn bệnh nhân để demo</h2>
      <p class="muted-note">Trợ lý AI sẽ gọi và hỏi theo bộ câu hỏi của bệnh nhân (bản đã duyệt, hoặc bản mẫu nếu chưa duyệt).</p>
      <label class="f"><span>Bệnh nhân</span>
        <select class="select" id="demoPick"><option value="">— Chọn bệnh nhân —</option>${opts}</select></label>
      <label class="check"><input type="checkbox" id="demoTts" checked> Bot đọc câu hỏi thành tiếng</label>
      <button class="btn btn-leaf" id="demoStart" disabled>▶ Bắt đầu demo cuộc gọi</button>
    </section>`;
  const pick = $("#demoPick");
  if (getPatient(DEMO.maHoSo)) pick.value = DEMO.maHoSo;
  const sync = () => { $("#demoStart").disabled = !pick.value; };
  sync();
  pick.addEventListener("change", sync);
  $("#demoStart").addEventListener("click", () => startCall(pick.value));
}

/* ---- 2) in-call screen ------------------------------------------------ */
async function startCall(mrn) {
  DEMO.maHoSo = mrn;
  DEMO.patient = getPatient(mrn);
  DEMO.ttsOn = $("#demoTts") ? $("#demoTts").checked : true;
  DEMO.transcript = []; DEMO.answers = []; DEMO.awaiting = false; DEMO.lastQ = null;
  DEMO.interim = ""; DEMO.micDead = false; DEMO.misses = 0;
  DEMO.session = crypto.randomUUID ? crypto.randomUUID() : "s" + Date.now() + Math.random();
  history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(mrn));

  DEMO.phase = "calling";
  renderCall();
  startTimer();
  // First turn: server seeds ma_ho_so via metadata.button_variables.
  botAsk("alo", true);
}

function renderCall() {
  const p = DEMO.patient || { name: DEMO.maHoSo, mrn: DEMO.maHoSo, surgery: "" };
  $("#demoRoot").innerHTML = `
    <div class="demo-call">
      <section class="phone">
        <div class="phone-notch"></div>
        <div class="phone-screen">
          <div class="ph-status" id="phStatus">Đang gọi…</div>
          <div class="ph-avatar">${esc(avatarInitials(p.name || "BN"))}</div>
          <div class="ph-name">${esc(p.name || "")}</div>
          <div class="ph-sub">${esc(p.mrn || "")}${p.surgery ? " · " + esc(p.surgery) : ""}</div>
          <div class="ph-timer" id="phTimer">00:00</div>
          <div class="ph-controls">
            <button class="ph-btn mic" id="micBtn" type="button" title="Nói (giữ để trả lời)">🎙</button>
            <button class="ph-btn end" id="endBtn" type="button" title="Kết thúc cuộc gọi">✕</button>
          </div>
        </div>
      </section>

      <section class="transcript-panel card">
        <div class="tp-head"><span class="live-dot"></span> Bản ghi trực tiếp</div>
        <div id="tpLog" class="tp-log" aria-live="polite"></div>
        <form id="answerForm" class="tp-input">
          <input id="answerText" class="input" type="text" autocomplete="off"
                 placeholder="Gõ câu trả lời (dự phòng khi micro lỗi)…">
          <button class="btn btn-leaf" type="submit">Gửi</button>
        </form>
      </section>
    </div>`;
  renderTranscript();
  $("#endBtn").addEventListener("click", () => endCall());
  $("#micBtn").addEventListener("click", toggleMic);
  $("#answerForm").addEventListener("submit", e => { e.preventDefault(); submitAnswer($("#answerText").value); });
}

function renderTranscript() {
  const log = $("#tpLog");
  if (!log) return;
  // Live interim bubble: what the patient is saying into the mic right now.
  const who = DEMO.patient ? DEMO.patient.name : "Bệnh nhân";
  const interim = DEMO.interim
    ? `<div class="chat-msg user interim"><span class="spk">${esc(who)} 🎙</span>${esc(DEMO.interim)}</div>`
    : "";
  log.innerHTML = (DEMO.transcript.map(t =>
    `<div class="chat-msg ${isBot(t) ? "bot" : "user"}"><span class="spk">${esc(t.who)}</span>${esc(t.text)}</div>`
  ).join("") + interim) || `<div class="chat-msg sys">Cuộc gọi đang bắt đầu…</div>`;
  log.scrollTop = log.scrollHeight;
}

function setInterim(t) { DEMO.interim = t || ""; renderTranscript(); }

function botTurn(text, isQuestion) {
  DEMO.transcript.push({ who: "Trợ lý", text }); // bot lines live in the chat panel only
  renderTranscript();
  DEMO.awaiting = !!isQuestion;
  const st = $("#phStatus");
  if (st) st.textContent = isQuestion ? "Đang chờ bệnh nhân trả lời…" : "Đang gọi…";
  // Speech-to-speech: once the bot finishes talking, open the mic.
  speak(text, () => { if (isQuestion) startListening(); });
}

/* Auto-open the mic (SmartVoice or Web Speech) while an answer is expected. */
function startListening() {
  if (DEMO.phase !== "calling" || !DEMO.awaiting || DEMO.micDead) return;
  if (DEMO.rec || DEMO.recCtx) return; // already listening
  DEMO.sttOn ? svStartMic() : webStartMic();
}

/* STT heard nothing / couldn't recognize → the bot SAYS it didn't hear
   (a toast is invisible on a phone call), then reopens the mic. Rotating
   phrasings so it sounds human; after 3 misses just keep the line open
   silently instead of nagging. */
const RETRY_LINES = [
  "Dạ cháu xin lỗi, cháu chưa nghe rõ, mình có thể nhắc lại được không ạ?",
  "Alo, cháu chưa nghe được mình nói ạ, mình nói lại giúp cháu với ạ.",
  "Dạ mình nói lại giúp cháu một lần nữa được không ạ? Cháu nghe chưa được rõ.",
];
function askRepeat() {
  if (DEMO.phase !== "calling" || !DEMO.awaiting) return;
  DEMO.misses += 1;
  if (DEMO.misses > RETRY_LINES.length) { startListening(); return; }
  botTurn(RETRY_LINES[DEMO.misses - 1], true);
}

/* Send one turn to the Smartbot BFF and render its reply. */
async function botAsk(text, firstTurn) {
  const st = $("#phStatus"); if (st) st.textContent = "Trợ lý đang xử lý…";
  let r;
  try {
    r = await API.post("/bff/conversation", {
      text, session_id: DEMO.session, ma_ho_so: DEMO.maHoSo, first_turn: !!firstTurn,
    });
  } catch (e) {
    toast("Lỗi kết nối trợ lý: " + e.message);
    DEMO.awaiting = true;
    return;
  }
  if (DEMO.phase !== "calling") return; // hung up while waiting
  if (r.text) { DEMO.lastQ = r.text; botTurn(r.text, !r.done && !r.handoff); }
  if (r.handoff) {
    botTurn("⚠ Cuộc gọi được chuyển cho điều dưỡng trực.", false);
    setTimeout(() => endCall(), 2200);
  } else if (r.done) {
    // Bot said goodbye (refusal, wrong number, or all questions done) → hang up.
    const st = $("#phStatus"); if (st) st.textContent = "Cuộc gọi kết thúc…";
    setTimeout(() => endCall(), 3500);
  }
}

function submitAnswer(text) {
  text = (text || "").trim();
  if (!text || DEMO.phase !== "calling" || !DEMO.awaiting) return;
  stopMics(); // typed answers may arrive while the mic is open
  DEMO.interim = "";
  DEMO.misses = 0;
  DEMO.transcript.push({ who: DEMO.patient ? DEMO.patient.name : "Bệnh nhân", text });
  DEMO.answers.push({ question: DEMO.lastQ, answer: text });
  DEMO.awaiting = false;
  const inp = $("#answerText"); if (inp) inp.value = "";
  renderTranscript();
  botAsk(text, false);
}

/* Silently drop any open mic without submitting what it heard. */
function stopMics() {
  if (DEMO.rec) {
    const rec = DEMO.rec; DEMO.rec = null;
    try { (rec.abort || rec.stop).call(rec); } catch (e) {}
    setMic(false);
  }
  if (DEMO.recCtx) {
    const r = DEMO.recCtx; DEMO.recCtx = null;
    try {
      r.proc.disconnect(); r.source.disconnect(); r.sink.disconnect();
      r.stream.getTracks().forEach(t => t.stop()); r.ctx.close();
    } catch (e) {}
    setMic(false);
  }
}

/* ---- mic: SmartVoice STT when wired, else browser Web Speech ---------- */
function setMic(on) { const b = $("#micBtn"); if (b) b.classList.toggle("on", on); }
// Manual override: tap = talk now / stop; the loop reopens it after each turn.
function toggleMic() {
  if (DEMO.rec) { DEMO.rec.stop(); return; }
  if (DEMO.recCtx) { svStopAndSend(); return; }
  DEMO.micDead = false; // user insists — retry even after an earlier failure
  DEMO.sttOn ? svStartMic() : webStartMic();
}

/* Browser Web Speech STT (fallback when SmartVoice creds aren't set).
   Live words go to the interim transcript bubble; auto-submits when the
   patient stops talking, re-arms on silence so the line stays open. */
function webStartMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    DEMO.micDead = true;
    toast("Trình duyệt chưa hỗ trợ nhận giọng nói — hãy gõ câu trả lời.");
    $("#answerText").focus(); return;
  }
  const rec = new SR();
  rec.lang = "vi-VN"; rec.interimResults = true; rec.continuous = false;
  DEMO.rec = rec; setMic(true);
  let finalText = "";
  rec.onresult = e => {
    let interim = "";
    for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    setInterim((finalText + " " + interim).trim());
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      DEMO.micDead = true;
      toast("Không truy cập được micro — hãy gõ câu trả lời.");
    }
  };
  rec.onend = () => {
    if (DEMO.rec !== rec) return; // aborted by stopMics()
    setMic(false); DEMO.rec = null;
    const t = (finalText || DEMO.interim || "").trim();
    setInterim("");
    if (t) submitAnswer(t);
    else askRepeat(); // heard nothing — say so, then keep the line open
  };
  rec.start();
}

// ponytail: RMS gate + trailing-silence window; tune if auto-stop misfires per mic.
const SV_RMS = 0.015, SV_SILENCE_MS = 1800;

/* SmartVoice STT: record mic as PCM16 mono WAV in-browser (no libs), POST to
   /bff/stt which forwards to VNPT. Auto-stops after trailing silence once the
   patient has spoken (tap 🎙 also stops & sends immediately). */
async function svStartMic() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { DEMO.micDead = true; toast("Không truy cập được micro — hãy gõ câu trả lời."); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain(); sink.gain.value = 0; // silence: no mic echo
  const chunks = [];
  proc.onaudioprocess = e => {
    const buf = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(buf));
    const r = DEMO.recCtx; if (!r) return;
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    if (Math.sqrt(sum / buf.length) > SV_RMS) { r.spoke = true; r.lastVoice = Date.now(); }
    else if (r.spoke && Date.now() - r.lastVoice > SV_SILENCE_MS) svStopAndSend();
  };
  source.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  DEMO.recCtx = { stream, ctx, source, proc, sink, chunks, rate: ctx.sampleRate,
                  spoke: false, lastVoice: 0 };
  setMic(true);
  setInterim("🎙 Đang nghe…");
}

async function svStopAndSend() {
  const r = DEMO.recCtx; if (!r) return;
  DEMO.recCtx = null; setMic(false);
  r.proc.disconnect(); r.source.disconnect(); r.sink.disconnect();
  r.stream.getTracks().forEach(t => t.stop());
  const wav = encodeWav(r.chunks, r.rate);
  r.ctx.close();
  if (!wav.byteLength) { setInterim(""); askRepeat(); return; }

  setInterim("Đang nhận dạng giọng nói…");
  const fd = new FormData();
  fd.append("audio", new Blob([wav], { type: "audio/wav" }), "answer.wav");
  fd.append("client_session", DEMO.session || "sess");
  try {
    const resp = await fetch("/bff/stt", { method: "POST", body: fd });
    if (!resp.ok) throw new Error("STT " + resp.status);
    const t = ((await resp.json()).text || "").trim();
    setInterim("");
    if (t) submitAnswer(t);
    else askRepeat(); // STT returned nothing — bot asks the patient to repeat
  } catch (e) {
    setInterim("");
    toast("Lỗi nhận dạng giọng nói: " + e.message);
    askRepeat(); // keep the call alive; typing still works
  }
}

/* Float32 PCM chunks → 16-bit mono WAV bytes at the given sample rate. */
function encodeWav(chunks, rate) {
  let len = 0; for (const c of chunks) len += c.length;
  const buf = new ArrayBuffer(44 + len * 2);
  const view = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); view.setUint32(4, 36 + len * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  wstr(36, "data"); view.setUint32(40, len * 2, true);
  let off = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, c[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/* ---- timer ------------------------------------------------------------ */
function startTimer() {
  DEMO.startTs = Date.now();
  DEMO.timerId = setInterval(() => {
    const el = $("#phTimer");
    if (el) el.textContent = fmtTimer(Math.floor((Date.now() - DEMO.startTs) / 1000));
  }, 1000);
}
function stopTimer() { if (DEMO.timerId) { clearInterval(DEMO.timerId); DEMO.timerId = null; } }

/* ---- 3) end + save ---------------------------------------------------- */
async function endCall() {
  if (DEMO.phase === "ended") return;
  DEMO.phase = "ended";
  const duration = fmtTimer(Math.floor((Date.now() - DEMO.startTs) / 1000));
  stopTimer();
  stopMics();
  DEMO.interim = "";
  stopSpeak();

  $("#demoRoot").innerHTML = `
    <section class="card demo-result">
      <div class="dr-icon">⏳</div>
      <h2>Đang lưu & phân tích cuộc gọi…</h2>
      <p class="muted-note">Hệ thống đang tóm tắt và phân loại mức nguy cơ.</p>
    </section>`;

  let res;
  try {
    res = await API.post("/his/call-demo/save", {
      ma_ho_so: DEMO.maHoSo, transcript: DEMO.transcript, answers: DEMO.answers,
    });
  } catch (e) {
    $("#demoRoot").innerHTML = `
      <section class="card demo-result">
        <div class="dr-icon">✕</div>
        <h2>Đã kết thúc cuộc gọi</h2>
        <p class="muted-note">Không lưu được vào hồ sơ: ${esc(e.message)}</p>
        <div class="dr-actions"><button class="btn btn-leaf" onclick="renderSetup()">Demo lại</button></div>
      </section>`;
    return;
  }

  const p = DEMO.patient || { name: DEMO.maHoSo, mrn: DEMO.maHoSo };

  // failed call (refused / no answer): no tier, no collected data — the patient
  // stays "chưa đánh giá"; only the transcript + reason were saved.
  if (res.call_status === "refused" || res.call_status === "no_answer") {
    const reason = res.call_status === "refused"
      ? "Bệnh nhân từ chối nhận cuộc gọi." : "Không nhận được câu trả lời từ bệnh nhân.";
    $("#demoRoot").innerHTML = `
      <section class="card demo-result">
        <div class="dr-icon">📵</div>
        <h2>Cuộc gọi không thành công</h2>
        <p class="dr-meta">${esc(p.name)} · ${esc(p.mrn)} · ${duration}</p>
        <span class="badge unknown">Chưa đánh giá</span>
        <div class="summary-block"><h4>Lý do</h4>
          <p>${esc(res.summary || reason)}</p></div>
        <div class="dr-actions">
          <a class="btn btn-leaf" href="case.html?id=${esc(DEMO.maHoSo)}">Xem chi tiết ca</a>
          <button class="btn" onclick="renderSetup()">Demo lại</button>
        </div>
      </section>`;
    return;
  }

  const tierLabel = { red: "Nguy cơ cao", amber: "Cần theo dõi", green: "Ổn định" }[res.tier] || res.tier;
  const tierIcon = { red: "⚠", amber: "!", green: "✓" }[res.tier] || "✓";
  $("#demoRoot").innerHTML = `
    <section class="card demo-result">
      <div class="dr-icon ${esc(res.tier)}">${tierIcon}</div>
      <h2>Đã kết thúc & lưu vào hồ sơ ca</h2>
      <p class="dr-meta">${esc(p.name)} · ${esc(p.mrn)} · ${duration}</p>
      <span class="badge ${esc(res.tier)}">${esc(tierLabel)}</span>
      ${res.escalated ? `<div class="callout red"><b>⚠ Đã nâng cảnh báo</b> — cần bác sĩ phụ trách xem sớm.</div>` : ""}
      <div class="summary-block"><h4>Tóm tắt cuộc gọi ${res.source === "gpt" ? "(GPT)" : "(tự động)"}</h4>
        <p>${esc(res.summary)}</p></div>
      <div class="dr-actions">
        <a class="btn btn-leaf" href="case.html?id=${esc(DEMO.maHoSo)}">Xem chi tiết ca</a>
        <button class="btn" onclick="renderSetup()">Demo lại</button>
      </div>
    </section>`;
}

AfterCare.ready(renderSetup);
