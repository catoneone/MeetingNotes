const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const rootDir = __dirname;
loadEnv(path.join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANALYSIS_MODEL = process.env.OPENAI_MEETING_MODEL || "gpt-5.4-mini";
const MIC_TRANSCRIBE_MODEL =
  process.env.OPENAI_MIC_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const SYSTEM_TRANSCRIBE_MODEL =
  process.env.OPENAI_SYSTEM_TRANSCRIBE_MODEL || "gpt-4o-transcribe-diarize";
const CODEX_BINARY_OVERRIDE = process.env.CODEX_BINARY || "";
const FFMPEG_BINARY = process.env.FFMPEG_BINARY || "ffmpeg";
const WHISPER_BINARY = process.env.WHISPER_BINARY || "whisper-cli";
const LOCAL_WHISPER_MODEL = path.resolve(
  rootDir,
  process.env.LOCAL_WHISPER_MODEL || path.join("models", "ggml-base.en.bin")
);
const LOCAL_WHISPER_LANGUAGE = process.env.LOCAL_WHISPER_LANGUAGE || "en";
const TRANSCRIPTION_PROVIDER = process.env.TRANSCRIPTION_PROVIDER || "auto";
const MAX_LOCAL_SPEAKERS = Number(process.env.MAX_LOCAL_SPEAKERS || 3);
const MEETING_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const LOCAL_SPEAKER_SINGLE_PROFILE_THRESHOLD = Number(
  process.env.LOCAL_SPEAKER_SINGLE_PROFILE_THRESHOLD || 0.15
);
const LOCAL_SPEAKER_MULTI_PROFILE_THRESHOLD = Number(
  process.env.LOCAL_SPEAKER_MULTI_PROFILE_THRESHOLD || 0.24
);
let cachedCodexStatus = null;
let cachedLocalSttStatus = null;
let cachedCodexBinary = undefined;
const meetingSessions = new Map();
const HAS_USABLE_OPENAI_KEY = Boolean(
  OPENAI_API_KEY &&
    OPENAI_API_KEY !== "sk-..." &&
    !OPENAI_API_KEY.includes("YOUR_KEY_HERE") &&
    !OPENAI_API_KEY.includes("paste")
);

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    card_mode: {
      type: "string",
      enum: ["listen", "respond"]
    },
    title: {
      type: "string"
    },
    blocks: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          content: { type: "string" }
        },
        required: ["title", "content"]
      }
    },
    line_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          chinese: { type: "string" }
        },
        required: ["id", "chinese"]
      }
    },
    detections: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisions: {
          type: "array",
          items: { type: "string" }
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              detail: { type: "string" }
            },
            required: ["title", "detail"]
          }
        },
        open_questions: {
          type: "array",
          items: { type: "string" }
        },
        highlights: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              speaker: { type: "string" },
              text: { type: "string" }
            },
            required: ["speaker", "text"]
          }
        },
        logs: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["decisions", "tasks", "open_questions", "highlights", "logs"]
    }
  },
  required: ["card_mode", "title", "blocks", "line_updates", "detections"]
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: { type: "string" }
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" }
        },
        required: ["title", "detail"]
      }
    },
    open_questions: {
      type: "array",
      items: { type: "string" }
    },
    highlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          text: { type: "string" }
        },
        required: ["speaker", "text"]
      }
    }
  },
  required: ["decisions", "tasks", "open_questions", "highlights"]
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/status") {
      const codexStatus = await getCodexStatus();
      const localSttStatus = await getLocalSttStatus();
      const transcriptionMode = resolveTranscriptionMode(localSttStatus);
      return sendJson(response, 200, {
        configured: HAS_USABLE_OPENAI_KEY,
        codex_logged_in: codexStatus.loggedIn,
        analysis_available: HAS_USABLE_OPENAI_KEY || codexStatus.loggedIn,
        transcription_available: transcriptionMode !== "none",
        transcription_mode: transcriptionMode,
        local_stt_ready: localSttStatus.ready,
        local_whisper_model: LOCAL_WHISPER_MODEL,
        analysis_model: ANALYSIS_MODEL,
        mic_transcribe_model: MIC_TRANSCRIBE_MODEL,
        system_transcribe_model: SYSTEM_TRANSCRIBE_MODEL
      });
    }

    if (request.method === "POST" && url.pathname === "/api/transcribe") {
      const body = await readJson(request);
      const localSttStatus = await getLocalSttStatus();
      const transcriptionMode = resolveTranscriptionMode(localSttStatus);
      if (transcriptionMode === "local") {
        const result = await transcribeAudioLocally(body);
        return sendJson(response, 200, result);
      }

      if (transcriptionMode === "none") {
        const codexStatus = await getCodexStatus();
        return sendJson(response, 503, {
          error: codexStatus.loggedIn
            ? "已检测到 ChatGPT/Codex 登录，可用于秘书分析；但音频转写还没准备好。请先执行本地 STT 安装，或者配置 OPENAI_API_KEY。"
            : "还没配置 OPENAI_API_KEY，实时转写暂时不能工作。"
        });
      }

      const result = await transcribeAudio(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJson(request);
      const codexStatus = await getCodexStatus();
      const result = HAS_USABLE_OPENAI_KEY
        ? await analyzeMeeting(body)
        : codexStatus.loggedIn
          ? await analyzeMeetingWithCodex(body)
          : fallbackAnalysis(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/summary") {
      const body = await readJson(request);
      const codexStatus = await getCodexStatus();
      const result = HAS_USABLE_OPENAI_KEY
        ? await summarizeMeeting(body)
        : codexStatus.loggedIn
          ? await summarizeMeetingWithCodex(body)
          : fallbackSummary(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname);
    }

    return sendJson(response, 404, {
      error: "Not found"
    });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, {
      error: error.message || "Unexpected server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`Meeting Copilot server listening on http://localhost:${PORT}`);
});

async function transcribeAudio(body) {
  const { audioBase64, mimeType = "audio/webm", source = "system" } = body || {};
  if (!audioBase64) {
    throw new Error("Missing audio payload");
  }

  const extension = getFileExtension(mimeType);
  const buffer = Buffer.from(audioBase64, "base64");
  const file = new File([buffer], `${source}-${Date.now()}.${extension}`, {
    type: mimeType
  });

  const form = new FormData();
  const isSystem = source === "system";
  form.append("file", file);
  form.append("model", isSystem ? SYSTEM_TRANSCRIBE_MODEL : MIC_TRANSCRIBE_MODEL);
  form.append("language", "en");
  form.append("response_format", isSystem ? "diarized_json" : "verbose_json");

  const apiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });
  const data = await apiResponse.json();
  if (!apiResponse.ok) {
    throw new Error(data.error?.message || "OpenAI transcription failed");
  }

  const segments = normalizeSegments(data, source);
  return {
    text: segments.map((segment) => segment.text).join(" ").trim(),
    segments
  };
}

async function transcribeAudioLocally(body) {
  const {
    audioBase64,
    mimeType = "audio/webm",
    source = "system",
    meetingId = ""
  } = body || {};
  if (!audioBase64) {
    throw new Error("Missing audio payload");
  }

  const tempId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputExtension = getFileExtension(mimeType);
  const inputPath = path.join(os.tmpdir(), `meeting-copilot-${tempId}-input.${inputExtension}`);
  const wavPath = path.join(os.tmpdir(), `meeting-copilot-${tempId}-converted.wav`);
  const outputPrefix = path.join(os.tmpdir(), `meeting-copilot-${tempId}`);
  const outputJson = `${outputPrefix}.json`;

  try {
    fs.writeFileSync(inputPath, Buffer.from(audioBase64, "base64"));

    await execFileAsync(
      FFMPEG_BINARY,
      [
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath
      ],
      {
        cwd: rootDir,
        maxBuffer: 8 * 1024 * 1024
      }
    );

    await execFileAsync(
      WHISPER_BINARY,
      [
        "-m",
        LOCAL_WHISPER_MODEL,
        "-l",
        LOCAL_WHISPER_LANGUAGE,
        "-oj",
        "-of",
        outputPrefix,
        wavPath
      ],
      {
        cwd: rootDir,
        maxBuffer: 8 * 1024 * 1024
      }
    );

    const raw = fs.readFileSync(outputJson, "utf8");
    const data = JSON.parse(raw);
    const transcriptionSegments = extractWhisperSegments(data);
    const segments =
      source === "mic"
        ? transcriptionSegments.map((segment) => ({
            text: segment.text,
            speakerHint: "me"
          }))
        : diarizeLocalSegments({
            wavPath,
            meetingId,
            transcriptionSegments
          });

    return {
      text: segments.map((segment) => segment.text).join(" ").trim(),
      segments
    };
  } finally {
    [inputPath, wavPath, outputJson].forEach(safeUnlink);
  }
}

function normalizeSegments(data, source) {
  if (source === "mic") {
    const micText = sanitizeTranscriptText(data.text || "");
    if (micText) {
      return [
        {
          text: micText,
          speakerHint: "me"
        }
      ];
    }

    if (Array.isArray(data.segments)) {
      return data.segments
        .map((segment) => ({
          text: sanitizeTranscriptText(segment.text || ""),
          speakerHint: "me"
        }))
        .filter((segment) => segment.text);
    }

    return [];
  }

  if (Array.isArray(data.segments) && data.segments.length) {
    const grouped = [];
    data.segments.forEach((segment) => {
      const text = sanitizeTranscriptText(segment.text || "");
      const speakerHint = segment.speaker || "speaker_0";
      if (!text) {
        return;
      }

      const previous = grouped[grouped.length - 1];
      if (previous && previous.speakerHint === speakerHint) {
        previous.text = `${previous.text} ${text}`.trim();
        return;
      }

      grouped.push({
        text,
        speakerHint
      });
    });
    return grouped;
  }

  if (Array.isArray(data.words) && data.words.some((item) => item.speaker)) {
    const grouped = [];
    data.words.forEach((word) => {
      const text = sanitizeTranscriptText(word.word || "");
      const speakerHint = word.speaker || "speaker_0";
      if (!text) {
        return;
      }

      const previous = grouped[grouped.length - 1];
      if (previous && previous.speakerHint === speakerHint) {
        previous.text = `${previous.text} ${text}`.trim();
      } else {
        grouped.push({
          text,
          speakerHint
        });
      }
    });
    return grouped;
  }

  const systemText = sanitizeTranscriptText(data.text || "");
  return systemText
    ? [
        {
          text: systemText,
          speakerHint: "speaker_0"
        }
      ]
    : [];
}

async function analyzeMeeting(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const forceMode = body?.forceMode === "response" ? "response" : "listen";
  const contextLines = entries.map((entry) => `${entry.label}: ${entry.english}`);

  const prompt = [
    "You are a meeting copilot for a Chinese-native speaker in an English meeting.",
    "Respond in strict JSON matching the schema.",
    "Keep the UI copy concise and practical. Do not translate line by line.",
    "Set title to 中文内容.",
    "Always return line_updates as an empty array.",
    "If the latest turn sounds like the team is waiting for the user to answer, set card_mode to respond.",
    "Block 1 must be titled 中文理解 and summarize the latest exchange in 1-2 natural Chinese sentences.",
    "Block 2 must be titled 现在重点 and explain the current focus in one short Chinese line.",
    "Block 3 should be titled 建议接话 when card_mode is respond, otherwise 下一步方向.",
    "When you provide 建议接话, make the content a short English sentence the user can say immediately.",
    "When you provide 下一步方向, make the content one short Chinese suggestion.",
    "Detect decisions, follow-ups, open questions, and highlight-worthy moments only when they are genuinely present.",
    "",
    `Preferred card mode: ${forceMode}`,
    "",
    "Recent transcript:",
    contextLines.join("\n")
  ].join("\n");

  return createStructuredResponse({
    schemaName: "meeting_copilot_analysis",
    schema: ANALYSIS_SCHEMA,
    systemPrompt:
      "You write calm, secretary-like meeting assistance. Keep responses short, concrete, and high-confidence.",
    userPrompt: prompt
  });
}

async function summarizeMeeting(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const prompt = [
    "Summarize the meeting for the participant.",
    "Extract decisions, my follow-up tasks, open questions, and highlight moments.",
    "Use Chinese for decisions and open questions. Keep task titles short and task details actionable.",
    "",
    "Transcript:",
    entries.map((entry) => `${entry.label}: ${entry.english}`).join("\n")
  ].join("\n");

  return createStructuredResponse({
    schemaName: "meeting_copilot_summary",
    schema: SUMMARY_SCHEMA,
    systemPrompt:
      "You are a concise meeting secretary. Only include items that are supported by the transcript.",
    userPrompt: prompt
  });
}

async function analyzeMeetingWithCodex(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const forceMode = body?.forceMode === "response" ? "response" : "listen";

  const prompt = [
    "You are a meeting copilot for a Chinese-native speaker in an English meeting.",
    "Return strict JSON matching the provided schema.",
    "Keep the UI copy short, calm, and practical. Do not translate line by line.",
    "Set title to 中文内容.",
    "Always return line_updates as an empty array.",
    "Block 1 title: 中文理解. Summarize the latest exchange in 1-2 natural Chinese sentences.",
    "Block 2 title: 现在重点. One short Chinese line.",
    "Block 3 title: 建议接话 when card_mode is respond, otherwise 下一步方向.",
    "When you provide 建议接话, make the content a short English sentence the user can say immediately.",
    "When you provide 下一步方向, make the content one short Chinese suggestion.",
    "If the latest turn sounds like the team is waiting for the user to answer, card_mode should be respond.",
    "",
    `Preferred card mode: ${forceMode}`,
    "",
    "Recent transcript:",
    entries.map((entry) => `${entry.label}: ${entry.english}`).join("\n")
  ].join("\n");

  return runCodexStructured({
    schema: ANALYSIS_SCHEMA,
    prompt
  });
}

async function summarizeMeetingWithCodex(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const prompt = [
    "Summarize this meeting for a Chinese-native participant.",
    "Return strict JSON matching the schema.",
    "Use Chinese for decisions and open questions.",
    "Tasks must have a short title and an actionable detail.",
    "",
    "Transcript:",
    entries.map((entry) => `${entry.label}: ${entry.english}`).join("\n")
  ].join("\n");

  return runCodexStructured({
    schema: SUMMARY_SCHEMA,
    prompt
  });
}

async function createStructuredResponse({ schemaName, schema, systemPrompt, userPrompt }) {
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      reasoning: {
        effort: "low"
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema,
          strict: true
        }
      }
    })
  });
  const data = await apiResponse.json();
  if (!apiResponse.ok) {
    throw new Error(data.error?.message || "OpenAI response generation failed");
  }

  const outputText = extractResponseText(data);
  return JSON.parse(outputText);
}

async function runCodexStructured({ schema, prompt }) {
  const codexBinary = await resolveCodexBinary();
  if (!codexBinary) {
    throw new Error("未找到可用的 Codex 可执行文件。");
  }

  const tempId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const schemaPath = path.join(os.tmpdir(), `meeting-copilot-schema-${tempId}.json`);
  const outputPath = path.join(os.tmpdir(), `meeting-copilot-output-${tempId}.json`);
  fs.writeFileSync(schemaPath, JSON.stringify(schema));

  try {
    await execFileAsync(
      codexBinary,
      [
        "exec",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        prompt
      ],
      {
        cwd: rootDir,
        maxBuffer: 8 * 1024 * 1024
      }
    );

    const raw = fs.readFileSync(outputPath, "utf8").trim();
    return JSON.parse(raw);
  } finally {
    safeUnlink(schemaPath);
    safeUnlink(outputPath);
  }
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  (data.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    });
  });

  const joined = parts.join("\n").trim();
  if (!joined) {
    throw new Error("No structured output returned");
  }

  return joined.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
}

async function getCodexStatus() {
  if (cachedCodexStatus) {
    return cachedCodexStatus;
  }

  try {
    const codexBinary = await resolveCodexBinary();
    if (!codexBinary) {
      cachedCodexStatus = {
        loggedIn: false
      };
      return cachedCodexStatus;
    }

    const { stdout, stderr } = await execFileAsync(codexBinary, ["login", "status"], {
      cwd: rootDir,
      maxBuffer: 64 * 1024
    });
    const combined = `${stdout || ""}\n${stderr || ""}`;
    cachedCodexStatus = {
      loggedIn: /Logged in/i.test(combined)
    };
  } catch (error) {
    cachedCodexStatus = {
      loggedIn: false
    };
  }

  return cachedCodexStatus;
}

async function getLocalSttStatus() {
  if (cachedLocalSttStatus) {
    return cachedLocalSttStatus;
  }

  const modelExists = fs.existsSync(LOCAL_WHISPER_MODEL);
  const ffmpegOk = await isCommandAvailable(FFMPEG_BINARY);
  const whisperOk = await isCommandAvailable(WHISPER_BINARY);

  cachedLocalSttStatus = {
    ready: modelExists && ffmpegOk && whisperOk,
    modelExists,
    ffmpegOk,
    whisperOk
  };
  return cachedLocalSttStatus;
}

function diarizeLocalSegments({ wavPath, meetingId, transcriptionSegments }) {
  if (!transcriptionSegments.length) {
    return [];
  }

  const wavData = readWavFile(wavPath);
  if (!wavData.samples.length) {
    return transcriptionSegments.map((segment) => ({
      text: segment.text,
      speakerHint: "speaker_0"
    }));
  }

  const meetingState = getMeetingState(meetingId);
  const voiceRegions = detectVoiceRegions(wavData.samples, wavData.sampleRate);
  const speakerRegions = (voiceRegions.length ? voiceRegions : [
    { startMs: 0, endMs: wavData.durationMs }
  ])
    .map((region) => ({
      ...region,
      speakerHint: assignSpeakerHint(
        meetingState,
        extractSpeakerFeatures(
          wavData.samples.subarray(
            msToSample(region.startMs, wavData.sampleRate),
            msToSample(region.endMs, wavData.sampleRate)
          ),
          wavData.sampleRate
        )
      )
    }))
    .filter((region) => region.speakerHint);

  return mergeSpeakerText(
    mapTranscriptionToSpeakerRegions(transcriptionSegments, speakerRegions)
  );
}

function extractWhisperSegments(data) {
  return Array.isArray(data.transcription)
    ? data.transcription
        .map((segment) => ({
          text: sanitizeTranscriptText(segment.text || ""),
          fromMs: Number(segment.offsets?.from ?? parseTimestamp(segment.timestamps?.from)),
          toMs: Number(segment.offsets?.to ?? parseTimestamp(segment.timestamps?.to))
        }))
        .filter((segment) => segment.text)
    : [];
}

function sanitizeTranscriptText(text) {
  const input = String(text || "").trim();
  if (!input) {
    return "";
  }

  let cleaned = input
    .replace(
      /[\[(]\s*(keyboard clicking|typing|clicking|music|applause|laughter|background noise|noise|static|silence|inaudible|crosstalk|beeping|door opens?|door closes?)\s*[\])]/gi,
      " "
    )
    .replace(/^[\[(]\s*[^\])]{0,40}\s*[\])]$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (
    /^(keyboard clicking|typing|clicking|music|applause|laughter|background noise|noise|static|silence|inaudible|crosstalk|beeping|door opens?|door closes?)$/i.test(
      cleaned
    )
  ) {
    return "";
  }

  if (/^[^a-zA-Z0-9\u00C0-\u024F]+$/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function getMeetingState(meetingId) {
  cleanupMeetingSessions();

  if (!meetingId) {
    return {
      speakerProfiles: []
    };
  }

  const now = Date.now();
  if (!meetingSessions.has(meetingId)) {
    meetingSessions.set(meetingId, {
      id: meetingId,
      createdAt: now,
      updatedAt: now,
      speakerProfiles: []
    });
  }

  const state = meetingSessions.get(meetingId);
  state.updatedAt = now;
  return state;
}

function cleanupMeetingSessions() {
  const now = Date.now();
  for (const [meetingId, state] of meetingSessions.entries()) {
    if (!state || now - state.updatedAt > MEETING_SESSION_TTL_MS) {
      meetingSessions.delete(meetingId);
    }
  }
}

function readWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Unsupported WAV format");
  }

  let offset = 12;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let channels = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    throw new Error("Unsupported WAV data chunk");
  }

  const sampleCount = Math.floor(dataSize / 2 / channels);
  const samples = new Float32Array(sampleCount);
  let cursor = dataOffset;
  for (let index = 0; index < sampleCount; index += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      mixed += buffer.readInt16LE(cursor) / 32768;
      cursor += 2;
    }
    samples[index] = mixed / channels;
  }

  return {
    sampleRate,
    samples,
    durationMs: Math.round((samples.length / sampleRate) * 1000)
  };
}

function detectVoiceRegions(samples, sampleRate) {
  const frameSize = Math.max(256, Math.round(sampleRate * 0.02));
  const hopSize = Math.max(128, Math.round(sampleRate * 0.01));
  const frameEnergy = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const value = samples[start + index];
      sum += value * value;
    }
    frameEnergy.push({
      start,
      end: start + frameSize,
      rms: Math.sqrt(sum / frameSize)
    });
  }

  if (!frameEnergy.length) {
    return [];
  }

  const sortedEnergy = frameEnergy.map((frame) => frame.rms).sort((a, b) => a - b);
  const noiseFloor = sortedEnergy[Math.floor(sortedEnergy.length * 0.2)] || 0;
  const threshold = Math.max(0.008, noiseFloor * 2.4);
  const minFrames = 14;
  const mergeGapFrames = 12;

  const ranges = [];
  let activeStart = -1;
  let activeEnd = -1;
  let silentFrames = 0;

  frameEnergy.forEach((frame, frameIndex) => {
    const voiced = frame.rms >= threshold;
    if (voiced) {
      if (activeStart < 0) {
        activeStart = frame.start;
      }
      activeEnd = frame.end;
      silentFrames = 0;
      return;
    }

    if (activeStart >= 0) {
      silentFrames += 1;
      if (silentFrames >= mergeGapFrames) {
        const startFrameIndex = Math.max(0, frameIndex - silentFrames - minFrames);
        const start = Math.max(0, activeStart - hopSize * 2);
        const end = Math.min(samples.length, activeEnd + hopSize * 2);
        if ((end - start) / hopSize >= minFrames) {
          ranges.push({
            startMs: sampleToMs(start, sampleRate),
            endMs: sampleToMs(end, sampleRate)
          });
        }
        activeStart = -1;
        activeEnd = -1;
        silentFrames = 0;
      }
    }
  });

  if (activeStart >= 0 && activeEnd > activeStart) {
    const start = Math.max(0, activeStart - hopSize * 2);
    const end = Math.min(samples.length, activeEnd + hopSize * 2);
    if ((end - start) / hopSize >= minFrames) {
      ranges.push({
        startMs: sampleToMs(start, sampleRate),
        endMs: sampleToMs(end, sampleRate)
      });
    }
  }

  return mergeNearbyRegions(ranges);
}

function mergeNearbyRegions(regions) {
  if (!regions.length) {
    return [];
  }

  const merged = [regions[0]];
  for (let index = 1; index < regions.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = regions[index];
    if (current.startMs - previous.endMs <= 180) {
      previous.endMs = Math.max(previous.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged.filter((region) => region.endMs - region.startMs >= 280);
}

function extractSpeakerFeatures(samples, sampleRate) {
  if (!samples.length) {
    return null;
  }

  const rms = computeRms(samples);
  const zcr = computeZeroCrossingRate(samples);
  const pitch = estimatePitch(samples, sampleRate);
  const spectral = computeSpectralFeatures(samples, sampleRate);

  return {
    rms,
    zcr,
    pitchHz: pitch.pitchHz,
    pitchConfidence: pitch.confidence,
    centroidHz: spectral.centroidHz,
    bands: spectral.bands
  };
}

function computeRms(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

function computeZeroCrossingRate(samples) {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index - 1] >= 0 && samples[index] < 0) || (samples[index - 1] < 0 && samples[index] >= 0)) {
      crossings += 1;
    }
  }
  return crossings / Math.max(1, samples.length - 1);
}

function estimatePitch(samples, sampleRate) {
  const frameSize = Math.min(samples.length, 2048);
  if (frameSize < 256) {
    return {
      pitchHz: 0,
      confidence: 0
    };
  }

  const starts = [0.25, 0.5, 0.75]
    .map((ratio) => Math.max(0, Math.floor((samples.length - frameSize) * ratio)))
    .filter((value, index, list) => list.indexOf(value) === index);
  const observations = [];

  starts.forEach((start) => {
    const frame = samples.subarray(start, start + frameSize);
    const observation = estimatePitchForFrame(frame, sampleRate);
    if (observation.confidence > 0.18 && observation.pitchHz > 0) {
      observations.push(observation);
    }
  });

  if (!observations.length) {
    return estimatePitchForFrame(
      samples.subarray(Math.max(0, Math.floor((samples.length - frameSize) / 2)), Math.max(0, Math.floor((samples.length - frameSize) / 2)) + frameSize),
      sampleRate
    );
  }

  const pitches = observations.map((item) => item.pitchHz).sort((a, b) => a - b);
  const medianPitch = pitches[Math.floor(pitches.length / 2)];
  const confidence =
    observations.reduce((sum, item) => sum + item.confidence, 0) / observations.length;

  return {
    pitchHz: medianPitch,
    confidence
  };
}

function estimatePitchForFrame(frame, sampleRate) {
  const minLag = Math.floor(sampleRate / 320);
  const maxLag = Math.min(frame.length - 2, Math.floor(sampleRate / 70));
  let bestLag = 0;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index + lag < frame.length; index += 1) {
      const a = frame[index];
      const b = frame[index + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denom = Math.sqrt(energyA * energyB) || 1;
    const score = sum / denom;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return {
    pitchHz: bestLag ? sampleRate / bestLag : 0,
    confidence: bestScore
  };
}

function computeSpectralFeatures(samples, sampleRate) {
  const windowSize = Math.min(512, Math.pow(2, Math.floor(Math.log2(samples.length))));
  if (windowSize < 128) {
    return {
      centroidHz: 0,
      bands: [0.2, 0.2, 0.2, 0.2, 0.2]
    };
  }

  const positions = [0.15, 0.35, 0.55, 0.75]
    .map((ratio) => Math.max(0, Math.floor((samples.length - windowSize) * ratio)))
    .filter((value, index, list) => list.indexOf(value) === index);
  const bandEdges = [120, 220, 340, 500, 720, 1000, 1400, 1900, 2500, 3300, 4300];
  const bands = new Array(bandEdges.length - 1).fill(0);
  let centroidSum = 0;
  let centroidWeight = 0;

  positions.forEach((start) => {
    const frame = applyHammingWindow(samples.subarray(start, start + windowSize));
    const magnitudes = computeMagnitudeSpectrum(frame);
    let frameEnergy = 0;
    let weightedFrequency = 0;

    magnitudes.forEach((magnitude, bin) => {
      const frequency = (bin * sampleRate) / windowSize;
      frameEnergy += magnitude;
      weightedFrequency += magnitude * frequency;
      for (let bandIndex = 0; bandIndex < bandEdges.length - 1; bandIndex += 1) {
        if (frequency >= bandEdges[bandIndex] && frequency < bandEdges[bandIndex + 1]) {
          bands[bandIndex] += magnitude;
          break;
        }
      }
    });

    if (frameEnergy > 0) {
      centroidSum += weightedFrequency / frameEnergy;
      centroidWeight += 1;
    }
  });

  const loggedBands = bands.map((value) => Math.log1p(value));
  const totalBandEnergy = loggedBands.reduce((sum, value) => sum + value, 0) || 1;
  return {
    centroidHz: centroidWeight ? centroidSum / centroidWeight : 0,
    bands: loggedBands.map((value) => value / totalBandEnergy)
  };
}

function applyHammingWindow(samples) {
  const output = new Float32Array(samples.length);
  const denominator = Math.max(1, samples.length - 1);
  for (let index = 0; index < samples.length; index += 1) {
    const multiplier = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / denominator);
    output[index] = samples[index] * multiplier;
  }
  return output;
}

function computeMagnitudeSpectrum(frame) {
  const half = Math.floor(frame.length / 2);
  const magnitudes = new Array(half).fill(0);

  for (let bin = 0; bin < half; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < frame.length; index += 1) {
      const angle = (2 * Math.PI * bin * index) / frame.length;
      real += frame[index] * Math.cos(angle);
      imaginary -= frame[index] * Math.sin(angle);
    }
    magnitudes[bin] = Math.sqrt(real * real + imaginary * imaginary);
  }

  return magnitudes;
}

function assignSpeakerHint(meetingState, features) {
  if (!features) {
    return "speaker_0";
  }

  const profiles = meetingState.speakerProfiles;
  if (!profiles.length) {
    profiles.push(createSpeakerProfile("speaker_0", features));
    return "speaker_0";
  }

  let bestProfile = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  profiles.forEach((profile) => {
    const distance = speakerDistance(profile.features, features);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestProfile = profile;
    }
  });

  const matchThreshold =
    profiles.length <= 1
      ? LOCAL_SPEAKER_SINGLE_PROFILE_THRESHOLD
      : LOCAL_SPEAKER_MULTI_PROFILE_THRESHOLD;
  const splitSignalCount =
    profiles.length === 1 && bestProfile
      ? countSecondSpeakerSignals(bestProfile.features, features)
      : 0;
  const confidentMatch = bestDistance < matchThreshold;
  if ((confidentMatch && splitSignalCount < 2) || profiles.length >= MAX_LOCAL_SPEAKERS) {
    updateSpeakerProfile(bestProfile, features);
    return bestProfile.id;
  }

  const newSpeakerId = `speaker_${profiles.length}`;
  profiles.push(createSpeakerProfile(newSpeakerId, features));
  return newSpeakerId;
}

function createSpeakerProfile(id, features) {
  return {
    id,
    count: 1,
    features: {
      ...features,
      bands: [...features.bands]
    }
  };
}

function updateSpeakerProfile(profile, features) {
  if (!profile) {
    return;
  }

  const nextCount = profile.count + 1;
  profile.features.rms = runningAverage(profile.features.rms, features.rms, profile.count, nextCount);
  profile.features.zcr = runningAverage(profile.features.zcr, features.zcr, profile.count, nextCount);
  profile.features.pitchHz = runningAverage(
    profile.features.pitchHz || features.pitchHz,
    features.pitchHz || profile.features.pitchHz,
    profile.count,
    nextCount
  );
  profile.features.pitchConfidence = runningAverage(
    profile.features.pitchConfidence || features.pitchConfidence,
    features.pitchConfidence || profile.features.pitchConfidence,
    profile.count,
    nextCount
  );
  profile.features.centroidHz = runningAverage(
    profile.features.centroidHz,
    features.centroidHz,
    profile.count,
    nextCount
  );
  profile.features.bands = profile.features.bands.map((value, index) =>
    runningAverage(value, features.bands[index], profile.count, nextCount)
  );
  profile.count = nextCount;
}

function runningAverage(previous, next, count, nextCount) {
  return (previous * count + next) / nextCount;
}

function speakerDistance(a, b) {
  const bandDistance = cosineDistance(a.bands, b.bands);
  const pitchComponent = Math.abs((a.pitchHz || 0) - (b.pitchHz || 0)) / 180;
  const centroidComponent = Math.abs(a.centroidHz - b.centroidHz) / 2400;
  const zcrComponent = Math.abs(a.zcr - b.zcr) / 0.12;
  const rmsComponent = Math.abs(a.rms - b.rms) / 0.18;
  const confidenceBoost = Math.min(a.pitchConfidence || 0, b.pitchConfidence || 0);
  const weightedPitch = pitchComponent * (0.6 + confidenceBoost * 0.8);

  return (
    bandDistance * 0.5 +
    weightedPitch * 0.24 +
    centroidComponent * 0.16 +
    zcrComponent * 0.08 +
    rmsComponent * 0.04
  );
}

function cosineDistance(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1;
  return 1 - dot / denominator;
}

function countSecondSpeakerSignals(reference, candidate) {
  const pitchGap = Math.abs((reference.pitchHz || 0) - (candidate.pitchHz || 0));
  const centroidGap = Math.abs(reference.centroidHz - candidate.centroidHz);
  const bandGap = cosineDistance(reference.bands, candidate.bands);
  const zcrGap = Math.abs(reference.zcr - candidate.zcr);

  return [
    pitchGap > 45,
    centroidGap > 320,
    bandGap > 0.1,
    zcrGap > 0.025
  ].filter(Boolean).length;
}

function mapTranscriptionToSpeakerRegions(transcriptionSegments, speakerRegions) {
  if (!speakerRegions.length) {
    return transcriptionSegments.map((segment) => ({
      text: segment.text,
      speakerHint: "speaker_0"
    }));
  }

  const mapped = [];
  transcriptionSegments.forEach((segment) => {
    const overlaps = speakerRegions.filter(
      (region) => Math.min(region.endMs, segment.toMs) - Math.max(region.startMs, segment.fromMs) > 90
    );
    const targetRegions = overlaps.length ? overlaps : [nearestRegionForSegment(segment, speakerRegions)];
    const textParts = splitTextIntoParts(segment.text, targetRegions.length);

    targetRegions.forEach((region, index) => {
      const text = (textParts[index] || "").trim();
      if (!text) {
        return;
      }
      mapped.push({
        text,
        speakerHint: region.speakerHint
      });
    });
  });

  return mapped;
}

function nearestRegionForSegment(segment, speakerRegions) {
  let best = speakerRegions[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  speakerRegions.forEach((region) => {
    const segmentMid = (segment.fromMs + segment.toMs) / 2;
    const regionMid = (region.startMs + region.endMs) / 2;
    const distance = Math.abs(segmentMid - regionMid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  });
  return best;
}

function splitTextIntoParts(text, count) {
  if (count <= 1) {
    return [normalizeText(text)];
  }

  let parts = normalizeText(text)
    .match(/[^.!?]+[.!?]?/g)
    ?.map((item) => item.trim())
    .filter(Boolean) || [];

  if (parts.length < count) {
    parts = parts.flatMap((item) =>
      item
        .split(/[,;:]/)
        .map((piece) => piece.trim())
        .filter(Boolean)
    );
  }

  if (!parts.length) {
    return new Array(count).fill("");
  }

  if (parts.length === count) {
    return parts;
  }

  if (parts.length > count) {
    const compact = [];
    const bucketSize = Math.ceil(parts.length / count);
    for (let index = 0; index < parts.length; index += bucketSize) {
      compact.push(parts.slice(index, index + bucketSize).join(" "));
    }
    return splitTextIntoParts(compact.join(" "), count);
  }

  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const perBucket = Math.ceil(words.length / count);
  return Array.from({ length: count }, (_, index) =>
    words.slice(index * perBucket, (index + 1) * perBucket).join(" ")
  );
}

function mergeSpeakerText(segments) {
  const merged = [];
  segments.forEach((segment) => {
    const text = normalizeText(segment.text);
    if (!text) {
      return;
    }

    const previous = merged[merged.length - 1];
    if (previous && previous.speakerHint === segment.speakerHint) {
      previous.text = `${previous.text} ${text}`.trim();
      return;
    }

    merged.push({
      text,
      speakerHint: segment.speakerHint || "speaker_0"
    });
  });
  return merged;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sampleToMs(sampleIndex, sampleRate) {
  return Math.round((sampleIndex / sampleRate) * 1000);
}

function msToSample(ms, sampleRate) {
  return Math.max(0, Math.floor((ms / 1000) * sampleRate));
}

function parseTimestamp(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }

  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) {
    return 0;
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(milliseconds.padEnd(3, "0").slice(0, 3))
  );
}

async function resolveCodexBinary() {
  if (cachedCodexBinary !== undefined) {
    return cachedCodexBinary;
  }

  const candidates = [
    CODEX_BINARY_OVERRIDE,
    "codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(os.homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = await resolveBinary(candidate);
    if (resolved) {
      cachedCodexBinary = resolved;
      return cachedCodexBinary;
    }
  }

  cachedCodexBinary = null;
  return cachedCodexBinary;
}

function resolveTranscriptionMode(localSttStatus) {
  if (TRANSCRIPTION_PROVIDER === "local") {
    return localSttStatus.ready ? "local" : "none";
  }

  if (TRANSCRIPTION_PROVIDER === "openai") {
    return HAS_USABLE_OPENAI_KEY ? "openai" : "none";
  }

  if (localSttStatus.ready) {
    return "local";
  }

  if (HAS_USABLE_OPENAI_KEY) {
    return "openai";
  }

  return "none";
}

async function isCommandAvailable(command) {
  const resolved = await resolveBinary(command);
  return Boolean(resolved);
}

async function resolveBinary(command) {
  if (!command) {
    return null;
  }

  if (looksLikePath(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return command;
    } catch (_error) {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync("which", [command], {
      cwd: rootDir,
      maxBuffer: 64 * 1024
    });
    const resolved = (stdout || "")
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean);
    return resolved || null;
  } catch (_error) {
    return null;
  }
}

function looksLikePath(command) {
  return path.isAbsolute(command) || command.includes(path.sep);
}

function fallbackAnalysis(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const latest = entries[entries.length - 1] || {
    english: "No transcript yet.",
    label: "Meeting"
  };
  const recentLines = entries.slice(-3).map((entry) => `${entry.label}: ${entry.english}`);
  const responseMode =
    body?.forceMode === "response" ||
    /\?$|can you|could you|what do you think|does your team|would you/i.test(latest.english);

  const detections = detectFromEntries(entries);

  return {
    card_mode: responseMode ? "respond" : "listen",
    title: "中文内容",
    blocks: responseMode
      ? [
          {
            title: "中文理解",
            content: `最近几句主要在说：${recentLines.join(" / ")}`
          },
          {
            title: "现在重点",
            content: "对方在等你确认范围、时间或是否能接住这个请求。"
          },
          {
            title: "建议接话",
            content: "Let me confirm I understood the request correctly first."
          }
        ]
      : [
          {
            title: "中文理解",
            content: `最近几句主要在说：${recentLines.join(" / ")}`
          },
          {
            title: "现在重点",
            content: "先继续看英文字幕；中文理解会在分析后按最近几句一起更新。"
          },
          {
            title: "下一步方向",
            content: "如果你准备发言，优先确认 scope、timeline 或 owner。"
          }
        ],
    line_updates: [],
    detections
  };
}

function fallbackSummary(body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  const detections = detectFromEntries(entries);

  return {
    decisions: detections.decisions,
    tasks: detections.tasks,
    open_questions: detections.open_questions,
    highlights: detections.highlights
  };
}

function detectFromEntries(entries) {
  const decisions = [];
  const tasks = [];
  const openQuestions = [];
  const highlights = [];
  const logs = [];

  entries.forEach((entry) => {
    if (!entry || !entry.english) {
      return;
    }

    const english = entry.english.trim();
    if (!english) {
      return;
    }

    if (/let's|we will|we'll|decide|leave .* out|ship|launch/i.test(english)) {
      pushUnique(decisions, english);
      pushUnique(logs, `已记录结论：${english}`);
    }

    if (/send|follow up|prepare|draft|by (monday|tuesday|wednesday|thursday|friday)|tomorrow/i.test(english)) {
      pushTask(tasks, {
        title: "会后跟进",
        detail: english
      });
      pushUnique(logs, "已记录一条待跟进事项。");
    }

    if (/\?/.test(english)) {
      pushUnique(openQuestions, english);
    }

    if (highlights.length < 4) {
      pushHighlight(highlights, {
        speaker: entry.label || "Meeting",
        text: english
      });
    }
  });

  return {
    decisions,
    tasks,
    open_questions: openQuestions,
    highlights,
    logs
  };
}

function pushUnique(list, item) {
  if (item && !list.includes(item)) {
    list.push(item);
  }
}

function pushTask(list, task) {
  if (!task || !task.title || !task.detail) {
    return;
  }
  const exists = list.some(
    (entry) => entry.title === task.title && entry.detail === task.detail
  );
  if (!exists) {
    list.push(task);
  }
}

function pushHighlight(list, item) {
  if (!item || !item.speaker || !item.text) {
    return;
  }
  const exists = list.some(
    (entry) => entry.speaker === item.speaker && entry.text === item.text
  );
  if (!exists) {
    list.push(item);
  }
}

function getFileExtension(mimeType) {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  if (mimeType.includes("mpeg")) {
    return "mp3";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  return "webm";
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Best-effort cleanup for temp files.
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function serveStatic(response, pathname) {
  const relativePath =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(rootDir, relativePath);
  if (!filePath.startsWith(rootDir)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "File not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": getContentType(filePath)
    });
    response.end(data);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
