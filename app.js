const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const speakerClasses = ["speaker-a", "speaker-b", "speaker-c"];

const elements = {
  newMeeting: document.getElementById("new-meeting"),
  sessionCount: document.getElementById("session-count"),
  meetingList: document.getElementById("meeting-list"),
  analysisPill: document.getElementById("analysis-pill"),
  transcribePill: document.getElementById("transcribe-pill"),
  micPill: document.getElementById("mic-pill"),
  systemPill: document.getElementById("system-pill"),
  meetingTitle: document.getElementById("meeting-title"),
  meetingStatus: document.getElementById("meeting-status"),
  meetingMeta: document.getElementById("meeting-meta"),
  startSession: document.getElementById("start-session"),
  stopSession: document.getElementById("stop-session"),
  workspaceNotice: document.getElementById("workspace-notice"),
  documentScroll: document.getElementById("document-scroll"),
  transcriptCount: document.getElementById("transcript-count"),
  transcriptDocument: document.getElementById("transcript-document"),
  summaryBlock: document.getElementById("summary-block"),
  summaryStatus: document.getElementById("summary-status"),
  refreshSummary: document.getElementById("refresh-summary"),
  copyNote: document.getElementById("copy-note"),
  summaryContainer: document.getElementById("summary-container"),
  noteSection: document.getElementById("note-section"),
  meetingNote: document.getElementById("meeting-note"),
  playerDock: document.getElementById("player-dock"),
  playerMeta: document.getElementById("player-meta"),
  linePlayer: document.getElementById("line-player"),
  assistantTitle: document.getElementById("assistant-title"),
  assistantMode: document.getElementById("assistant-mode"),
  assistantBlocks: document.getElementById("assistant-blocks"),
  refreshUnderstanding: document.getElementById("refresh-understanding"),
  suggestReply: document.getElementById("suggest-reply"),
  autoLogList: document.getElementById("auto-log-list")
};

const appState = {
  backend: {
    checked: false,
    configured: false,
    analysisAvailable: false,
    transcriptionAvailable: false,
    codexLoggedIn: false,
    transcriptionMode: "none"
  },
  sessions: [],
  activeSessionId: null,
  ui: {
    notice: "",
    startPending: false,
    selectedLineId: "",
    selectedChunkId: "",
    shouldStickToBottom: false
  },
  media: {
    micStream: null,
    systemStream: null,
    recorders: {},
    queues: {
      mic: Promise.resolve(),
      system: Promise.resolve()
    }
  }
};

function cloneDefaultAssistant() {
  return {
    mode: "listen",
    title: "AI",
    blocks: [
      {
        title: "理解",
        content: "等内容进来后更新。"
      }
    ]
  };
}

function createEmptySummary() {
  return {
    decisions: [],
    tasks: [],
    openQuestions: [],
    highlights: [],
    finalized: false,
    generating: false,
    updatedAt: ""
  };
}

function createEmptyRecordings() {
  return {
    chunks: {},
    order: []
  };
}

function createMeetingId() {
  return `meeting-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createSession() {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: createDefaultMeetingTitle(),
    createdAt: now,
    updatedAt: now,
    status: "idle",
    transcriptEntries: [],
    assistant: cloneDefaultAssistant(),
    summary: createEmptySummary(),
    note: {
      draft: "",
      edited: false
    },
    logs: [],
    recordings: createEmptyRecordings(),
    meetingId: createMeetingId(),
    runtime: {
      lineCounter: 0,
      speakerMap: new Map(),
      analysisTimer: null,
      analysisInFlight: false,
      analysisDirty: false,
      forcedAssistantMode: null,
      lastAnalysisEntryCount: 0
    }
  };
}

function createDefaultMeetingTitle() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `Meeting ${formatter.format(new Date())}`;
}

function getActiveSession() {
  return appState.sessions.find((session) => session.id === appState.activeSessionId) || null;
}

function getSession(sessionId) {
  return appState.sessions.find((session) => session.id === sessionId) || null;
}

function getLiveSession() {
  return appState.sessions.find((session) => session.status === "live" || session.status === "stopping") || null;
}

function addSession(session) {
  appState.sessions.unshift(session);
  appState.activeSessionId = session.id;
}

function moveSessionToTop(sessionId) {
  const index = appState.sessions.findIndex((session) => session.id === sessionId);
  if (index <= 0) {
    return;
  }
  const [session] = appState.sessions.splice(index, 1);
  appState.sessions.unshift(session);
}

function touchSession(session) {
  session.updatedAt = new Date().toISOString();
  moveSessionToTop(session.id);
}

function setNotice(text) {
  appState.ui.notice = text;
  renderWorkspace();
}

function clearNotice() {
  appState.ui.notice = "";
  renderWorkspace();
}

function setPill(target, label, tone = "neutral") {
  target.textContent = label;
  target.classList.remove("is-ok", "is-warn", "is-bad");
  if (tone === "ok") {
    target.classList.add("is-ok");
  } else if (tone === "warn") {
    target.classList.add("is-warn");
  } else if (tone === "bad") {
    target.classList.add("is-bad");
  }
}

function renderApp() {
  renderSidebar();
  renderWorkspace();
  renderAssistant();
  renderAutoLog();
  renderSystemStatus();
}

function renderSidebar() {
  elements.sessionCount.textContent = String(appState.sessions.length);
  elements.meetingList.innerHTML = "";

  if (!appState.sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "左侧会积累每次会议。点击上方按钮，就能新开一次。";
    elements.meetingList.appendChild(empty);
    return;
  }

  appState.sessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "meeting-item";
    button.dataset.sessionId = session.id;
    if (session.id === appState.activeSessionId) {
      button.classList.add("is-active");
    }

    const head = document.createElement("div");
    head.className = "meeting-item-head";

    const title = document.createElement("div");
    title.className = "meeting-item-title";
    title.textContent = session.title || "Untitled meeting";

    const badge = document.createElement("span");
    badge.className = `session-badge ${getStatusClass(session.status)}`;
    badge.textContent = getStatusLabel(session.status);

    head.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "meeting-item-meta";
    meta.textContent = buildSessionListMeta(session);

    button.append(head, meta);
    elements.meetingList.appendChild(button);
  });
}

function renderWorkspace() {
  const session = getActiveSession();
  if (!session) {
    return;
  }

  const titleChanged = elements.meetingTitle.dataset.sessionId !== session.id;
  if (titleChanged || document.activeElement !== elements.meetingTitle) {
    elements.meetingTitle.value = session.title;
  }
  elements.meetingTitle.dataset.sessionId = session.id;

  elements.meetingStatus.textContent = getStatusLabel(session.status);
  elements.meetingStatus.className = `meeting-status ${getStatusClass(session.status)}`;
  elements.meetingMeta.textContent = buildSessionMeta(session);
  elements.transcriptCount.textContent = `${session.transcriptEntries.length} 条`;
  elements.summaryBlock.hidden = !(session.status === "done" || session.status === "stopping");
  elements.playerDock.hidden = !session.transcriptEntries.length;

  const hasLiveElsewhere = Boolean(getLiveSession() && getLiveSession()?.id !== session.id);
  elements.startSession.disabled =
    appState.ui.startPending ||
    session.status === "live" ||
    session.status === "stopping" ||
    hasLiveElsewhere ||
    !appState.backend.transcriptionAvailable;
  elements.startSession.textContent = appState.ui.startPending ? "连接中…" : "开始会议";

  elements.stopSession.disabled = !(session.status === "live" || session.status === "stopping");
  elements.stopSession.textContent = session.status === "stopping" ? "整理中…" : "结束会议";

  elements.workspaceNotice.textContent = buildWorkspaceNotice(session);

  renderTranscript(session);
  renderSummary(session);

  if (appState.ui.shouldStickToBottom && session.id === appState.activeSessionId) {
    window.requestAnimationFrame(() => {
      elements.documentScroll.scrollTop = elements.documentScroll.scrollHeight;
      appState.ui.shouldStickToBottom = false;
    });
  }
}

function renderTranscript(session) {
  elements.transcriptDocument.innerHTML = "";

  if (!session.transcriptEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent =
      session.status === "live"
        ? "等待内容…"
        : "开始后会记录在这里。";
    elements.transcriptDocument.appendChild(empty);
    updatePlayerMeta(session);
    return;
  }

  session.transcriptEntries.forEach((entry, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "transcript-row";
    row.dataset.lineId = entry.id;
    if (entry.id === appState.ui.selectedLineId) {
      row.classList.add("is-selected");
    }
    if (index === session.transcriptEntries.length - 1 && session.status === "live") {
      row.classList.add("is-live");
    }

    const head = document.createElement("div");
    head.className = "transcript-row-head";

    const metaRow = document.createElement("div");
    metaRow.className = "transcript-meta-row";

    const speaker = document.createElement("span");
    speaker.className = `speaker-tag ${entry.cssClass}`;
    speaker.textContent = entry.label;

    const time = document.createElement("span");
    time.className = "transcript-submeta";
    time.textContent = formatClock(entry.timestamp);

    const replay = document.createElement("span");
    replay.className = "muted-chip";
    replay.textContent = entry.audioChunkId ? "点击回听" : "录音未就绪";

    metaRow.append(speaker, time, replay);
    head.append(metaRow);

    const text = document.createElement("p");
    text.className = "transcript-text";
    text.textContent = entry.english;

    row.append(head, text);
    elements.transcriptDocument.appendChild(row);
  });

  updatePlayerMeta(session);
}

function renderSummary(session) {
  elements.summaryBlock.hidden = !(session.status === "done" || session.status === "stopping");
  if (elements.summaryBlock.hidden) {
    elements.noteSection.hidden = true;
    return;
  }

  elements.summaryContainer.innerHTML = "";

  const isFinished = session.status === "done" || session.status === "stopping";
  const showDraft = isFinished || session.note.edited || Boolean(session.note.draft.trim());

  if (!isFinished) {
    const empty = document.createElement("div");
    empty.className = "empty-card summary-empty";
    empty.textContent = "结束后会整理在这里。";
    elements.summaryContainer.appendChild(empty);
    elements.summaryStatus.textContent = "结束后自动整理";
    elements.noteSection.hidden = true;
    elements.refreshSummary.disabled = true;
    elements.copyNote.disabled = true;
    return;
  }

  if (session.status === "stopping" || session.summary.generating) {
    const waiting = document.createElement("div");
    waiting.className = "empty-card summary-empty";
    waiting.textContent = "整理中…";
    elements.summaryContainer.appendChild(waiting);
    elements.summaryStatus.textContent = "整理中…";
    elements.noteSection.hidden = true;
    elements.refreshSummary.disabled = true;
    elements.copyNote.disabled = true;
    return;
  }

  const sections = buildSummarySections(session);
  sections.forEach((section) => elements.summaryContainer.appendChild(section));

  elements.summaryStatus.textContent = session.summary.updatedAt
    ? `已更新 ${formatClock(session.summary.updatedAt)}`
    : "已整理";
  elements.noteSection.hidden = !showDraft;
  elements.refreshSummary.disabled = !session.transcriptEntries.length;
  elements.copyNote.disabled = !session.note.draft.trim();

  if (showDraft) {
    const sessionChanged = elements.meetingNote.dataset.sessionId !== session.id;
    if (sessionChanged || document.activeElement !== elements.meetingNote) {
      elements.meetingNote.value = session.note.draft;
    }
    elements.meetingNote.dataset.sessionId = session.id;
  }
}

function buildSummarySections(session) {
  const sections = [];

  const overview = document.createElement("section");
  overview.className = "summary-section";
  const overviewTitle = document.createElement("h3");
  overviewTitle.textContent = "会议概览";
  const overviewBody = document.createElement("p");
  overviewBody.className = "summary-empty";
  overviewBody.textContent = buildSummaryOverview(session);
  overview.append(overviewTitle, overviewBody);
  sections.push(overview);

  sections.push(
    createListSection(
      "主要结论",
      session.summary.decisions,
      "这次会议里还没有明显的拍板结论。"
    )
  );

  sections.push(
    createListSection(
      "待跟进事项",
      session.summary.tasks.map((task) => `${task.title}：${task.detail}`),
      "还没有提炼出明确的 follow-up。"
    )
  );

  sections.push(
    createListSection(
      "未决问题",
      session.summary.openQuestions,
      "当前没有明显未决问题。"
    )
  );

  const highlights = document.createElement("section");
  highlights.className = "summary-section";
  const highlightsTitle = document.createElement("h3");
  highlightsTitle.textContent = "关键英文原文";
  highlights.appendChild(highlightsTitle);

  if (!session.summary.highlights.length) {
    const empty = document.createElement("p");
    empty.className = "summary-empty";
    empty.textContent = "AI 还没有挑出关键片段。";
    highlights.appendChild(empty);
  } else {
    session.summary.highlights.forEach((item) => {
      const block = document.createElement("div");
      block.className = "summary-highlight";
      const speaker = document.createElement("strong");
      speaker.textContent = item.speaker;
      const text = document.createElement("p");
      text.textContent = item.text;
      block.append(speaker, text);
      highlights.appendChild(block);
    });
  }
  sections.push(highlights);

  return sections;
}

function createListSection(title, items, emptyText) {
  const section = document.createElement("section");
  section.className = "summary-section";

  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "summary-empty";
    empty.textContent = emptyText;
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "summary-list";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

function renderAssistant() {
  const session = getActiveSession();
  const assistant = session?.assistant || cloneDefaultAssistant();
  const visibleBlocks =
    assistant.mode === "respond"
      ? [assistant.blocks[0], assistant.blocks[assistant.blocks.length - 1]].filter(Boolean)
      : [assistant.blocks[0]].filter(Boolean);

  elements.assistantTitle.textContent = "AI";
  elements.assistantMode.textContent = assistant.mode === "respond" ? "该你回应" : "跟听中";
  elements.assistantMode.className = `assistant-mode ${assistant.mode === "respond" ? "respond" : ""}`;

  elements.assistantBlocks.innerHTML = "";
  visibleBlocks.forEach((block) => {
    const node = document.createElement("section");
    node.className = "assistant-block";
    const title = document.createElement("h3");
    title.textContent = simplifyAssistantTitle(block.title);
    const content = document.createElement("p");
    content.textContent = block.content;
    node.append(title, content);
    elements.assistantBlocks.appendChild(node);
  });

  const hasTranscript = Boolean(session?.transcriptEntries.length);
  elements.refreshUnderstanding.disabled = !hasTranscript || !appState.backend.analysisAvailable;
  elements.suggestReply.disabled = !hasTranscript || !appState.backend.analysisAvailable;
}

function renderAutoLog() {
  if (!elements.autoLogList) {
    return;
  }
  const session = getActiveSession();
  elements.autoLogList.innerHTML = "";

  if (!session || !session.logs.length) {
    const li = document.createElement("li");
    li.textContent = "AI 会把识别到的结论、待跟进和会中提醒记录在这里。";
    elements.autoLogList.appendChild(li);
    return;
  }

  session.logs.forEach((log) => {
    const li = document.createElement("li");
    li.textContent = log;
    elements.autoLogList.appendChild(li);
  });
}

function renderSystemStatus() {
  if (!appState.backend.checked) {
    setPill(elements.analysisPill, "分析检查中", "warn");
    setPill(elements.transcribePill, "转写检查中", "warn");
  } else if (appState.backend.analysisAvailable) {
    const analysisLabel = appState.backend.codexLoggedIn ? "分析已连接" : "AI 已连接";
    setPill(elements.analysisPill, analysisLabel, "ok");
  } else {
    setPill(elements.analysisPill, "分析未就绪", "bad");
  }

  if (appState.backend.transcriptionAvailable) {
    const transcribeLabel = appState.backend.transcriptionMode === "local" ? "本地转写" : "实时转写";
    setPill(elements.transcribePill, transcribeLabel, "ok");
  } else {
    setPill(elements.transcribePill, "转写不可用", "bad");
  }

  setPill(
    elements.micPill,
    hasLiveAudioTrack(appState.media.micStream) ? "麦克风" : "麦克风未连",
    hasLiveAudioTrack(appState.media.micStream) ? "ok" : "warn"
  );
  setPill(
    elements.systemPill,
    hasLiveAudioTrack(appState.media.systemStream) ? "会议声音" : "会议声音未连",
    hasLiveAudioTrack(appState.media.systemStream) ? "ok" : "warn"
  );
}

function buildWorkspaceNotice(session) {
  if (appState.ui.notice) {
    return appState.ui.notice;
  }
  if (session.status === "live") {
    return "会议进行中";
  }
  if (session.status === "stopping") {
    return "正在整理";
  }
  if (session.status === "done") {
    return "已结束";
  }
  if (!appState.backend.transcriptionAvailable) {
    return appState.backend.analysisAvailable
      ? "转写未就绪"
      : "服务未就绪";
  }
  return "准备好后点开始";
}

function buildSessionMeta(session) {
  const audioChunks = session.recordings.order.length;
  const parts = [`${session.transcriptEntries.length} 条`, formatClock(session.updatedAt)];
  if (audioChunks) {
    parts.push(`${audioChunks} 段`);
  }
  return parts.join(" · ");
}

function buildSessionListMeta(session) {
  const status = getStatusLabel(session.status);
  return `${status} · ${formatDayTime(session.updatedAt)} · ${session.transcriptEntries.length} 条`;
}

function getStatusLabel(status) {
  if (status === "live") {
    return "进行中";
  }
  if (status === "stopping") {
    return "整理中";
  }
  if (status === "done") {
    return "已结束";
  }
  return "未开始";
}

function getStatusClass(status) {
  if (status === "live") {
    return "live";
  }
  if (status === "stopping") {
    return "stopping";
  }
  if (status === "done") {
    return "done";
  }
  return "idle";
}

function formatClock(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDayTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function truncate(text, length) {
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, Math.max(0, length - 1)).trim()}…`;
}

function simplifyAssistantTitle(title) {
  const normalized = String(title || "");
  if (normalized.includes("接")) {
    return "接话";
  }
  if (normalized.includes("重点")) {
    return "重点";
  }
  return "理解";
}

function hasLiveAudioTrack(stream) {
  return Boolean(stream?.getAudioTracks().some((track) => track.readyState === "live"));
}

function cleanupStream(kind) {
  const streamKey = kind === "mic" ? "micStream" : "systemStream";
  const existingStream = appState.media[streamKey];
  if (existingStream) {
    existingStream.getTracks().forEach((track) => track.stop());
  }
  appState.media[streamKey] = null;
}

function watchStream(kind, stream) {
  stream.getTracks().forEach((track) => {
    track.addEventListener(
      "ended",
      () => {
        appState.media[kind === "mic" ? "micStream" : "systemStream"] = null;
        if (getLiveSession()) {
          setNotice(
            kind === "mic"
              ? "麦克风已断开"
              : "会议声音已断开"
          );
        }
        renderSystemStatus();
      },
      { once: true }
    );
  });
}

async function connectInput(kind) {
  try {
    if (kind === "mic") {
      cleanupStream("mic");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      appState.media.micStream = stream;
      watchStream("mic", stream);
      renderSystemStatus();
      return true;
    }

    cleanupStream("system");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    appState.media.systemStream = stream;
    watchStream("system", stream);
    const hasAudio = stream.getAudioTracks().length > 0;
    if (!hasAudio) {
      setNotice("没拿到会议声音");
      renderSystemStatus();
      return false;
    }

    renderSystemStatus();
    return true;
  } catch (error) {
    setNotice("音频连接失败");
    renderSystemStatus();
    return false;
  }
}

function getSupportedMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) {
    return "";
  }
  return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return window.btoa(binary);
  });
}

function startRecorderForSource(source, stream, sessionId) {
  if (!stream || !stream.getAudioTracks().length) {
    return;
  }

  const recordingStream = new MediaStream(stream.getAudioTracks());
  const session = {
    source,
    sessionId,
    chunkMs: source === "system" ? 6500 : 5000,
    mimeType: getSupportedMimeType(),
    stream: recordingStream,
    recorder: null,
    restartTimer: null,
    stopped: false,
    resolveStop: null,
    stopPromise: null
  };
  session.stopPromise = new Promise((resolve) => {
    session.resolveStop = resolve;
  });
  appState.media.recorders[source] = session;
  startRecorderCycle(source);
}

function startRecorderCycle(source) {
  const recorderSession = appState.media.recorders[source];
  if (!recorderSession || recorderSession.stopped) {
    return;
  }

  const recorder = recorderSession.mimeType
    ? new MediaRecorder(recorderSession.stream, { mimeType: recorderSession.mimeType })
    : new MediaRecorder(recorderSession.stream);

  const chunks = [];
  recorderSession.recorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    if (recorderSession.restartTimer) {
      window.clearTimeout(recorderSession.restartTimer);
      recorderSession.restartTimer = null;
    }

    if (chunks.length) {
      const blob = new Blob(chunks, {
        type: recorder.mimeType || recorderSession.mimeType || "audio/webm"
      });
      const session = getSession(recorderSession.sessionId);
      if (session) {
        const chunkRecord = archiveRecordingChunk(session, source, blob);
        if (chunkRecord && blob.size >= 5000) {
          enqueueChunk(recorderSession.sessionId, source, chunkRecord);
        }
      }
    }

    const stillLive =
      !recorderSession.stopped &&
      getSession(recorderSession.sessionId)?.status === "live" &&
      recorderSession.stream.getTracks().some((track) => track.readyState === "live");

    if (stillLive) {
      window.setTimeout(() => startRecorderCycle(source), 40);
      return;
    }

    delete appState.media.recorders[source];
    recorderSession.resolveStop?.();
    renderApp();
  });

  recorder.start();
  recorderSession.restartTimer = window.setTimeout(() => {
    if (recorder.state === "recording") {
      recorder.stop();
    }
  }, recorderSession.chunkMs);
}

function stopAllRecorders() {
  const activeRecorders = Object.values(appState.media.recorders);
  if (!activeRecorders.length) {
    return Promise.resolve();
  }

  activeRecorders.forEach((recorderSession) => {
    recorderSession.stopped = true;
    if (recorderSession.restartTimer) {
      window.clearTimeout(recorderSession.restartTimer);
      recorderSession.restartTimer = null;
    }
    if (recorderSession.recorder && recorderSession.recorder.state !== "inactive") {
      recorderSession.recorder.stop();
    } else {
      delete appState.media.recorders[recorderSession.source];
      recorderSession.resolveStop?.();
    }
  });

  return Promise.allSettled(activeRecorders.map((recorderSession) => recorderSession.stopPromise));
}

function archiveRecordingChunk(session, source, blob) {
  if (!blob || blob.size < 2000) {
    return null;
  }

  const chunkId = `chunk-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  session.recordings.chunks[chunkId] = {
    id: chunkId,
    source,
    blob,
    url: "",
    size: blob.size,
    mimeType: blob.type || "audio/webm",
    createdAt: new Date().toISOString()
  };
  session.recordings.order.push(chunkId);
  touchSession(session);
  return session.recordings.chunks[chunkId];
}

function ensureChunkUrl(chunk) {
  if (!chunk) {
    return "";
  }
  if (!chunk.url) {
    chunk.url = URL.createObjectURL(
      new Blob([chunk.blob], {
        type: chunk.mimeType || chunk.blob.type || "audio/webm"
      })
    );
  }
  return chunk.url;
}

async function transcribeChunk(sessionId, source, chunkRecord) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  const response = await postJson("/api/transcribe", {
    meetingId: session.meetingId,
    source,
    mimeType: chunkRecord.mimeType,
    audioBase64: await blobToBase64(chunkRecord.blob)
  });

  const rawSegments = Array.isArray(response.segments) && response.segments.length
    ? response.segments
    : response.text
      ? [{ text: response.text }]
      : [];

  const segments = rawSegments.map((segment) => ({
    ...segment,
    source
  }));

  ingestSegments(sessionId, segments, { chunkId: chunkRecord.id });
}

function enqueueChunk(sessionId, source, chunkRecord) {
  appState.media.queues[source] = appState.media.queues[source]
    .then(() => transcribeChunk(sessionId, source, chunkRecord))
    .catch((error) => {
      const session = getSession(sessionId);
      if (session) {
        pushLog(session, `转写失败：${error.message}`);
      }
      setNotice(`实时转写遇到问题：${error.message}`);
    });
}

function getSpeakerPresentation(session, source, speakerHint) {
  if (source === "mic") {
    return {
      label: "Me",
      cssClass: "me"
    };
  }

  const normalized = speakerHint || `speaker_${session.runtime.speakerMap.size}`;
  if (!session.runtime.speakerMap.has(normalized)) {
    const index = session.runtime.speakerMap.size;
    const letter = String.fromCharCode(65 + Math.min(index, 25));
    session.runtime.speakerMap.set(normalized, {
      label: `Speaker ${letter}`,
      cssClass: speakerClasses[index] || speakerClasses[speakerClasses.length - 1]
    });
  }

  return session.runtime.speakerMap.get(normalized);
}

function mergeOrAppendEntry(session, entry) {
  const lastEntry = session.transcriptEntries[session.transcriptEntries.length - 1];
  const incoming = entry.english.trim();
  if (!incoming) {
    return false;
  }

  if (lastEntry && lastEntry.label === entry.label && lastEntry.source === entry.source) {
    const previous = lastEntry.english.trim();
    if (previous === incoming || previous.endsWith(incoming)) {
      return false;
    }
    if (incoming.includes(previous) && previous.length > 12) {
      lastEntry.english = incoming;
      lastEntry.timestamp = entry.timestamp;
      lastEntry.audioChunkId = entry.audioChunkId || lastEntry.audioChunkId;
      return true;
    }
  }

  session.transcriptEntries.push(entry);
  return true;
}

function ingestSegments(sessionId, segments, options = {}) {
  const session = getSession(sessionId);
  if (!session || !Array.isArray(segments) || !segments.length) {
    return;
  }

  let changed = false;
  let responseCue = false;

  segments.forEach((segment) => {
    const english = String(segment.text || "").trim();
    if (!english) {
      return;
    }

    const presentation = getSpeakerPresentation(session, segment.source, segment.speakerHint);
    const entry = {
      id: `line-${++session.runtime.lineCounter}`,
      source: segment.source,
      label: presentation.label,
      cssClass: presentation.cssClass,
      english,
      timestamp: new Date().toISOString(),
      audioChunkId: options.chunkId || ""
    };

    changed = mergeOrAppendEntry(session, entry) || changed;
    responseCue = responseCue || isResponseCue(english);
  });

  if (!changed) {
    return;
  }

  touchSession(session);
  appState.ui.shouldStickToBottom = session.id === appState.activeSessionId;
  if (appState.backend.analysisAvailable) {
    scheduleAnalysis(session.id, responseCue ? "response" : null);
  }
  renderApp();
}

function isResponseCue(text) {
  return /\?$|can you|could you|what do you think|does your team|would you|are you able|do you have/i.test(
    String(text || "")
  );
}

function scheduleAnalysis(sessionId, forceMode) {
  const session = getSession(sessionId);
  if (!session || !appState.backend.analysisAvailable || !session.transcriptEntries.length) {
    return;
  }

  const runtime = session.runtime;
  if (forceMode) {
    runtime.forcedAssistantMode = forceMode;
  }

  const latest = session.transcriptEntries[session.transcriptEntries.length - 1];
  const responseCue = isResponseCue(latest?.english);
  const newEntryCount = session.transcriptEntries.length - runtime.lastAnalysisEntryCount;

  if (!forceMode && !responseCue && newEntryCount < 2) {
    return;
  }

  if (runtime.analysisTimer) {
    window.clearTimeout(runtime.analysisTimer);
  }

  runtime.analysisTimer = window.setTimeout(() => {
    requestAssistant(sessionId, forceMode);
  }, forceMode ? 200 : responseCue ? 900 : 2600);
}

function requestAssistant(sessionId, forceMode) {
  const session = getSession(sessionId);
  if (!session || !session.transcriptEntries.length || !appState.backend.analysisAvailable) {
    return;
  }

  const runtime = session.runtime;
  if (runtime.analysisInFlight) {
    runtime.analysisDirty = true;
    if (forceMode) {
      runtime.forcedAssistantMode = forceMode;
    }
    return;
  }

  runtime.analysisInFlight = true;

  postJson("/api/analyze", {
    forceMode: forceMode || runtime.forcedAssistantMode,
    entries: session.transcriptEntries.slice(-6).map((entry) => ({
      id: entry.id,
      label: entry.label,
      english: entry.english
    }))
  })
    .then((data) => {
      if (data.title && Array.isArray(data.blocks)) {
        session.assistant = {
          mode: data.card_mode === "respond" ? "respond" : "listen",
          title: data.title,
          blocks: data.blocks
        };
      }
      applyDetections(session, data.detections || {});
      syncMeetingNoteDraft(session);
      touchSession(session);
      renderApp();
    })
    .catch((error) => {
      pushLog(session, `秘书分析失败：${error.message}`);
      renderAutoLog();
    })
    .finally(() => {
      runtime.lastAnalysisEntryCount = session.transcriptEntries.length;
      runtime.analysisInFlight = false;
      const nextMode = runtime.forcedAssistantMode;
      runtime.forcedAssistantMode = null;
      if (runtime.analysisDirty) {
        runtime.analysisDirty = false;
        scheduleAnalysis(sessionId, nextMode);
      }
    });
}

function applyDetections(session, detections) {
  (detections.decisions || []).forEach((item) => addDecision(session, item));
  (detections.tasks || []).forEach((task) => addTask(session, task));
  (detections.open_questions || []).forEach((item) => addOpenQuestion(session, item));
  (detections.highlights || []).forEach((item) => addHighlight(session, item));
  (detections.logs || []).forEach((item) => pushLog(session, item));
}

function addDecision(session, text) {
  if (!text || session.summary.decisions.includes(text)) {
    return;
  }
  session.summary.decisions.push(text);
}

function addTask(session, task) {
  if (!task?.title || !task?.detail) {
    return;
  }
  const exists = session.summary.tasks.some(
    (item) => item.title === task.title && item.detail === task.detail
  );
  if (!exists) {
    session.summary.tasks.push(task);
  }
}

function addOpenQuestion(session, text) {
  if (!text || session.summary.openQuestions.includes(text)) {
    return;
  }
  session.summary.openQuestions.push(text);
}

function addHighlight(session, item) {
  if (!item?.speaker || !item?.text) {
    return;
  }
  const exists = session.summary.highlights.some(
    (highlight) => highlight.speaker === item.speaker && highlight.text === item.text
  );
  if (!exists) {
    session.summary.highlights.push(item);
  }
}

function pushLog(session, message) {
  if (!message) {
    return;
  }
  session.logs.unshift(message);
  session.logs = session.logs.slice(0, 8);
  touchSession(session);
}

async function requestSummary(sessionId, options = {}) {
  const session = getSession(sessionId);
  if (!session || !session.transcriptEntries.length) {
    return;
  }

  session.summary.generating = true;
  if (session.id === appState.activeSessionId) {
    renderSummary(session);
  }

  try {
    const data = await postJson("/api/summary", {
      entries: session.transcriptEntries.map((entry) => ({
        label: entry.label,
        english: entry.english
      }))
    });

    session.summary.decisions = Array.isArray(data.decisions) ? data.decisions : [];
    session.summary.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    session.summary.openQuestions = Array.isArray(data.open_questions) ? data.open_questions : [];
    session.summary.highlights = Array.isArray(data.highlights) ? data.highlights : [];
    session.summary.finalized = true;
    session.summary.updatedAt = new Date().toISOString();

    syncMeetingNoteDraft(session, options.overwriteNote === true);
    touchSession(session);
    renderApp();
  } catch (error) {
    pushLog(session, `会后总结失败：${error.message}`);
    if (!session.note.draft) {
      syncMeetingNoteDraft(session);
    }
    renderApp();
  } finally {
    session.summary.generating = false;
    renderApp();
  }
}

function syncMeetingNoteDraft(session, force = false) {
  if (force) {
    session.note.edited = false;
  }

  if (session.note.edited && !force) {
    return;
  }

  session.note.draft = buildMeetingNoteDraft(session);
}

function buildMeetingNoteDraft(session) {
  const lines = [];
  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push("## 中文概览");
  lines.push(buildSummaryOverview(session) || "暂无会议概览");
  lines.push("");
  lines.push("## 主要结论");
  lines.push(formatBulletSection(session.summary.decisions, "- 暂无明确结论"));
  lines.push("");
  lines.push("## 我的待跟进");
  lines.push(
    formatBulletSection(
      session.summary.tasks.map((task) => `${task.title}：${task.detail}`),
      "- 暂无待跟进事项"
    )
  );
  lines.push("");
  lines.push("## 未决问题");
  lines.push(formatBulletSection(session.summary.openQuestions, "- 暂无未决问题"));
  lines.push("");
  lines.push("## 关键英文原文");
  lines.push(
    formatBulletSection(
      (session.summary.highlights.length ? session.summary.highlights : session.transcriptEntries.slice(-6)).map(
        (item) => {
          if (item.label) {
            return `${item.label}: ${item.english}`;
          }
          return `${item.speaker}: ${item.text}`;
        }
      ),
      "- 暂无关键片段"
    )
  );
  return lines.join("\n").trim();
}

function buildSummaryOverview(session) {
  const parts = [];
  if (session.summary.decisions.length) {
    parts.push(`这场会议先确认了：${session.summary.decisions.slice(0, 2).join("；")}`);
  }
  if (session.summary.tasks.length) {
    parts.push(
      `后续需要跟进：${session.summary.tasks
        .slice(0, 2)
        .map((task) => `${task.title}（${task.detail}）`)
        .join("；")}`
    );
  }
  if (session.summary.openQuestions.length) {
    parts.push(`还没定下来的点包括：${session.summary.openQuestions.slice(0, 2).join("；")}`);
  }
  if (parts.length) {
    return parts.join(" ");
  }

  const chineseBlock = session.assistant.blocks.find((block) => block.title.includes("中文"));
  if (chineseBlock?.content) {
    return chineseBlock.content;
  }

  if (!session.transcriptEntries.length) {
    return "会议还没有内容。";
  }

  return session.transcriptEntries
    .slice(-4)
    .map((entry) => `${entry.label} 提到 ${entry.english}`)
    .join(" ");
}

function formatBulletSection(items, emptyText) {
  if (!items.length) {
    return emptyText;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

async function startLiveSession() {
  if (appState.ui.startPending) {
    return;
  }

  if (!appState.backend.transcriptionAvailable) {
    setNotice(
      appState.backend.analysisAvailable
        ? "转写未就绪"
        : "服务未就绪"
    );
    return;
  }

  const existingLive = getLiveSession();
  if (existingLive && existingLive.id !== appState.activeSessionId) {
    appState.activeSessionId = existingLive.id;
    setNotice("已有进行中的会议");
    renderApp();
    return;
  }

  let session = getActiveSession();
  if (!session) {
    session = createSession();
    addSession(session);
  }

  if (session.status === "done" && session.transcriptEntries.length) {
    session = createSession();
    addSession(session);
    appState.ui.notice = "已新开会议";
  }

  appState.ui.startPending = true;
  renderWorkspace();

  try {
    await stopAllRecorders();
    const micReady = hasLiveAudioTrack(appState.media.micStream)
      ? true
      : await connectInput("mic");
    const systemReady = hasLiveAudioTrack(appState.media.systemStream)
      ? true
      : await connectInput("system");

    if (!micReady && !systemReady) {
      setNotice("没有连上音频");
      return;
    }

    session.status = "live";
    session.summary.finalized = false;
    session.summary.generating = false;
    session.meetingId = createMeetingId();
    touchSession(session);
    pushLog(session, "会议开始记录，英文原文会持续累积在中间文档里。");

    if (micReady && systemReady) {
      appState.ui.notice = "会议已开始";
    } else if (systemReady) {
      appState.ui.notice = "已开始，仅会议声音";
    } else {
      appState.ui.notice = "已开始，仅麦克风";
    }

    startRecorderForSource("mic", appState.media.micStream, session.id);
    startRecorderForSource("system", appState.media.systemStream, session.id);
    renderApp();
  } finally {
    appState.ui.startPending = false;
    renderWorkspace();
  }
}

async function finishMeeting() {
  const session = getActiveSession();
  if (!session || session.status !== "live") {
    return;
  }

  session.status = "stopping";
  touchSession(session);
  appState.ui.notice = "正在整理";
  renderApp();

  await stopAllRecorders();
  await delay(120);
  await Promise.allSettled([appState.media.queues.mic, appState.media.queues.system]);

  session.status = "done";
  session.summary.finalized = true;
  session.summary.updatedAt = new Date().toISOString();
  syncMeetingNoteDraft(session);
  renderApp();

  if (appState.backend.analysisAvailable) {
    await requestSummary(session.id, { overwriteNote: false });
  }

  appState.ui.notice = "已结束";
  renderApp();
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function playTranscriptLine(lineId) {
  const session = getActiveSession();
  if (!session) {
    return;
  }

  const entry = session.transcriptEntries.find((item) => item.id === lineId);
  if (!entry?.audioChunkId) {
    setNotice("录音未就绪");
    return;
  }

  const chunk = session.recordings.chunks[entry.audioChunkId];
  if (!chunk) {
    setNotice("录音不可用");
    return;
  }

  const url = ensureChunkUrl(chunk);
  appState.ui.selectedLineId = entry.id;
  appState.ui.selectedChunkId = chunk.id;
  elements.linePlayer.src = url;
  elements.playerMeta.textContent = `${entry.label} · ${formatClock(entry.timestamp)} · ${
    chunk.source === "system" ? "会议声音" : "我的麦克风"
  }`;
  elements.linePlayer.currentTime = 0;
  elements.linePlayer.play().catch(() => {
    setNotice("点播放器播放");
  });
  renderTranscript(session);
}

function updatePlayerMeta(session) {
  const entry = session.transcriptEntries.find((item) => item.id === appState.ui.selectedLineId);
  if (!entry) {
    elements.playerMeta.textContent = "点一行回听";
    return;
  }

  const chunk = session.recordings.chunks[entry.audioChunkId];
  if (!chunk) {
    elements.playerMeta.textContent = `${entry.label} · 录音未就绪`;
    return;
  }

  elements.playerMeta.textContent = `${entry.label} · ${formatClock(entry.timestamp)} · ${
    chunk.source === "system" ? "会议声音" : "我的麦克风"
  }`;
}

function clearPlayerSelection() {
  appState.ui.selectedLineId = "";
  appState.ui.selectedChunkId = "";
  elements.linePlayer.pause();
  elements.linePlayer.removeAttribute("src");
  elements.linePlayer.load();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

async function fetchBackendStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();

    appState.backend.checked = true;
    appState.backend.configured = Boolean(data.configured);
    appState.backend.analysisAvailable = Boolean(data.analysis_available);
    appState.backend.transcriptionAvailable = Boolean(data.transcription_available);
    appState.backend.codexLoggedIn = Boolean(data.codex_logged_in);
    appState.backend.transcriptionMode = data.transcription_mode || "none";

    if (appState.backend.transcriptionAvailable) {
      appState.ui.notice =
        appState.backend.transcriptionMode === "local"
          ? "本地转写已就绪"
          : "后端已就绪";
    } else if (appState.backend.analysisAvailable) {
      appState.ui.notice = "分析可用，转写未就绪";
    } else {
      appState.ui.notice = "服务未就绪";
    }
  } catch (_error) {
    appState.backend.checked = true;
    appState.backend.analysisAvailable = false;
    appState.backend.transcriptionAvailable = false;
    appState.backend.codexLoggedIn = false;
    appState.backend.transcriptionMode = "none";
    appState.ui.notice = "服务未启动";
  }

  renderApp();
}

function handleNewMeeting() {
  if (getLiveSession()) {
    setNotice("先结束当前会议");
    return;
  }

  clearPlayerSelection();
  appState.ui.notice = "";
  const session = createSession();
  addSession(session);
  renderApp();
}

function handleMeetingSelection(sessionId) {
  const liveSession = getLiveSession();
  if (liveSession && liveSession.id !== sessionId) {
    setNotice("先结束当前会议");
    return;
  }

  if (sessionId === appState.activeSessionId) {
    return;
  }

  clearPlayerSelection();
  appState.activeSessionId = sessionId;
  clearNotice();
  renderApp();
}

function handleTitleInput() {
  const session = getActiveSession();
  if (!session) {
    return;
  }
  session.title = elements.meetingTitle.value.trim() || createDefaultMeetingTitle();
  touchSession(session);
  renderSidebar();
}

function handleMeetingNoteInput() {
  const session = getActiveSession();
  if (!session) {
    return;
  }
  session.note.draft = elements.meetingNote.value;
  session.note.edited = true;
  touchSession(session);
  elements.summaryStatus.textContent = "已手动修改";
  renderSidebar();
}

async function copyMeetingNote() {
  const session = getActiveSession();
  if (!session || !session.note.draft.trim()) {
    setNotice("没有可复制的笔记");
    return;
  }

  try {
    await navigator.clipboard.writeText(session.note.draft);
    setNotice("已复制");
  } catch (_error) {
    setNotice("复制失败");
  }
}

async function refreshSummary() {
  const session = getActiveSession();
  if (!session || !session.transcriptEntries.length) {
    return;
  }
  if (session.status === "live" || session.status === "stopping") {
    setNotice("结束后再刷新");
    return;
  }

  appState.ui.notice = "正在刷新总结";
  renderWorkspace();
  await requestSummary(session.id, { overwriteNote: true });
  appState.ui.notice = "总结已更新";
  renderWorkspace();
}

function initializeApp() {
  if (!appState.sessions.length) {
    addSession(createSession());
  }
  renderApp();
  fetchBackendStatus();
}

elements.newMeeting.addEventListener("click", handleNewMeeting);
elements.meetingList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (!button) {
    return;
  }
  handleMeetingSelection(button.dataset.sessionId);
});
elements.meetingTitle.addEventListener("input", handleTitleInput);
elements.startSession.addEventListener("click", startLiveSession);
elements.stopSession.addEventListener("click", finishMeeting);
elements.transcriptDocument.addEventListener("click", (event) => {
  const row = event.target.closest("[data-line-id]");
  if (!row) {
    return;
  }
  playTranscriptLine(row.dataset.lineId);
});
elements.refreshUnderstanding.addEventListener("click", () => {
  const session = getActiveSession();
  if (!session) {
    return;
  }
  if (!appState.backend.analysisAvailable) {
    setNotice("AI 分析目前还没连上。");
    return;
  }
  scheduleAnalysis(session.id, "listen");
});
elements.suggestReply.addEventListener("click", () => {
  const session = getActiveSession();
  if (!session) {
    return;
  }
  if (!appState.backend.analysisAvailable) {
    setNotice("AI 分析目前还没连上。");
    return;
  }
  scheduleAnalysis(session.id, "response");
});
elements.refreshSummary.addEventListener("click", refreshSummary);
elements.copyNote.addEventListener("click", copyMeetingNote);
elements.meetingNote.addEventListener("input", handleMeetingNoteInput);

initializeApp();
