# MeetingNotes - Mac Meeting Assistant / Mac 会议助手

A native macOS application that helps Chinese speakers participate in English meetings with real-time subtitles, translation, AI-powered response suggestions, and post-meeting summaries.

一个原生 macOS 应用，帮助中文母语者参加英文会议，提供实时字幕、翻译、AI 回答建议和会后摘要。

## Features / 功能

- **Real-time English Subtitles / 实时英文字幕** - Captures meeting audio and displays live transcription
- **Chinese Translation / 中文翻译** - Automatically translates English subtitles to Chinese
- **AI Response Suggestions / AI 回答建议** - Detects when you need to respond and suggests answers in both English and Chinese
- **Meeting Summary / 会议摘要** - Generates a bilingual summary after the meeting ends
- **Floating Overlay / 悬浮字幕窗** - Non-intrusive subtitle bar that stays on top of meeting apps

## Requirements / 系统要求

- macOS 14 (Sonoma) or later
- An OpenAI-compatible API key (OpenAI, Claude via proxy, local LLM, etc.)

## Permissions / 权限

The app requires these permissions (you'll be prompted on first launch):

1. **Microphone** - To capture your voice
2. **Screen Recording** - To capture system audio from meeting apps (Zoom, Teams, etc.)
3. **Speech Recognition** - To transcribe audio to text

## Build & Run / 编译运行

```bash
# Build
swift build

# Run
swift run MeetingNotes

# Or open in Xcode
open Package.swift
```

## Configuration / 配置

1. Click the menu bar icon (microphone icon)
2. Go to Settings (gear icon)
3. Configure your API:
   - **API Base URL**: Your OpenAI-compatible API endpoint
     - OpenAI: `https://api.openai.com/v1`
     - Claude proxy: Your proxy URL
     - Ollama: `http://localhost:11434/v1`
   - **API Key**: Your API key
   - **Model**: The model name (e.g., `gpt-4o`, `claude-sonnet-4-20250514`)

## Usage / 使用方法

1. Launch the app (it appears in the menu bar)
2. Configure your API key in Settings
3. Join your English meeting (Zoom, Teams, Google Meet, etc.)
4. Click "Start Meeting" in the menu bar popup
5. The floating subtitle overlay appears at the bottom of your screen
6. English subtitles and Chinese translations appear in real-time
7. AI will suggest responses when questions are detected
8. Click "End Meeting" to generate the summary

## Architecture / 架构

```
Sources/MeetingNotes/
├── App/           - App entry point and state management
├── Views/         - SwiftUI views (MenuBar, Overlay, Settings, Summary)
├── Audio/         - System audio (ScreenCaptureKit) + Microphone (AVAudioEngine)
├── Speech/        - Apple Speech framework for real-time STT
├── AI/            - OpenAI-compatible LLM client, translation, suggestions
├── Models/        - Data models (TranscriptEntry, MeetingSession)
└── Utilities/     - Overlay window controller, permissions helper
```

## Tech Stack / 技术栈

| Component | Technology |
|-----------|-----------|
| UI | SwiftUI + AppKit (NSPanel for overlay) |
| System Audio | ScreenCaptureKit |
| Microphone | AVAudioEngine |
| Speech-to-Text | Apple Speech Framework |
| AI/Translation | OpenAI-compatible API |
| Min macOS | 14 (Sonoma) |
