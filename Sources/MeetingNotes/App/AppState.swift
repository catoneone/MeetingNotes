import SwiftUI
import Combine

/// Global application state managing the meeting lifecycle and services.
@Observable
final class AppState {
    // MARK: - Meeting State
    var currentSession: MeetingSession?
    var isRecording: Bool = false
    var pastSessions: [MeetingSession] = []

    // MARK: - Transcript Display
    var currentEnglishText: String = ""
    var currentChineseText: String = ""
    var suggestions: [AISuggestion] = []
    var latestSuggestion: AISuggestion?

    // MARK: - Settings
    var llmConfig: LLMConfig {
        didSet { saveLLMConfig() }
    }
    var subtitleFontSize: Double = 18.0
    var overlayOpacity: Double = 0.85
    var showOverlay: Bool = false
    var autoTranslate: Bool = true
    var autoSuggest: Bool = true

    // MARK: - Speaker Diarization
    var currentSpeakerLabel: String = "Speaker"

    // MARK: - Services
    var audioCaptureManager: AudioCaptureManager?
    var speechRecognizer: SpeechRecognizer?
    var speakerDiarizer: SpeakerDiarizer?
    var llmService: LLMService?
    var translationService: TranslationService?
    var meetingAIAssistant: MeetingAIAssistant?

    // MARK: - Errors
    var lastError: String?

    init() {
        self.llmConfig = Self.loadLLMConfig()
    }

    // MARK: - Meeting Lifecycle

    func startMeeting() {
        let session = MeetingSession()
        currentSession = session
        isRecording = true
        showOverlay = true
        currentEnglishText = ""
        currentChineseText = ""
        suggestions = []
        latestSuggestion = nil
        lastError = nil

        // Initialize services
        let config = llmConfig
        llmService = LLMService(config: config)
        translationService = TranslationService(llmService: llmService!)
        meetingAIAssistant = MeetingAIAssistant(llmService: llmService!)

        speechRecognizer = SpeechRecognizer()
        audioCaptureManager = AudioCaptureManager()

        // Initialize speaker diarizer
        let diarizer = SpeakerDiarizer()
        diarizer.onSpeakerChange = { [weak self] speaker in
            Task { @MainActor in
                self?.currentSpeakerLabel = speaker.label
            }
        }
        speakerDiarizer = diarizer

        // Set up speech recognition callback
        speechRecognizer?.onTranscriptUpdate = { [weak self] text, isFinal, source in
            Task { @MainActor in
                self?.handleTranscriptUpdate(text: text, isFinal: isFinal, source: source)
            }
        }

        // Start audio capture and speech recognition
        Task {
            do {
                try await audioCaptureManager?.startCapture()
                audioCaptureManager?.onSystemAudioBuffer = { [weak self] buffer in
                    self?.speechRecognizer?.processAudioBuffer(buffer, source: .system)
                    // Feed system audio to speaker diarizer
                    self?.speakerDiarizer?.processBuffer(buffer)
                }
                audioCaptureManager?.onMicrophoneBuffer = { [weak self] buffer in
                    self?.speechRecognizer?.processAudioBuffer(buffer, source: .user)
                }
                try speechRecognizer?.startRecognition()
            } catch {
                await MainActor.run {
                    self.lastError = "Failed to start: \(error.localizedDescription)"
                }
            }
        }
    }

    func stopMeeting() {
        isRecording = false

        audioCaptureManager?.stopCapture()
        speechRecognizer?.stopRecognition()
        speakerDiarizer?.reset()

        currentSession?.endMeeting()

        // Generate summary
        if let session = currentSession, !session.fullTranscript.isEmpty {
            Task {
                await generateSummary(for: session)
            }
        }

        if let session = currentSession {
            pastSessions.insert(session, at: 0)
        }

        showOverlay = false
    }

    // MARK: - Transcript Handling

    @MainActor
    private func handleTranscriptUpdate(text: String, isFinal: Bool, source: TranscriptEntry.AudioSource) {
        let label = source == .user ? "Me" : currentSpeakerLabel
        currentSession?.updateLastEntry(english: text, isFinal: isFinal, source: source, speakerLabel: label)
        currentEnglishText = text

        if isFinal && autoTranslate {
            Task {
                await translateText(text)
            }
        }

        if isFinal && autoSuggest {
            Task {
                await checkForSuggestion(text)
            }
        }
    }

    private func translateText(_ text: String) async {
        guard let translationService else { return }
        do {
            let chinese = try await translationService.translate(text)
            await MainActor.run {
                self.currentChineseText = chinese
                // Update the latest final entry with translation
                if let lastFinalIndex = self.currentSession?.entries.lastIndex(where: { $0.isFinal && $0.chineseText == nil }) {
                    self.currentSession?.entries[lastFinalIndex].chineseText = chinese
                }
            }
        } catch {
            await MainActor.run {
                self.lastError = "Translation error: \(error.localizedDescription)"
            }
        }
    }

    private func checkForSuggestion(_ text: String) async {
        guard let meetingAIAssistant, let session = currentSession else { return }
        do {
            if let suggestion = try await meetingAIAssistant.generateSuggestion(
                recentTranscript: session.fullTranscript,
                latestText: text
            ) {
                await MainActor.run {
                    self.suggestions.append(suggestion)
                    self.latestSuggestion = suggestion
                }
            }
        } catch {
            // Suggestions are best-effort, don't show error
        }
    }

    private func generateSummary(for session: MeetingSession) async {
        guard let meetingAIAssistant else { return }
        do {
            let summary = try await meetingAIAssistant.generateSummary(transcript: session.fullTranscript)
            await MainActor.run {
                session.summary = summary
            }
        } catch {
            await MainActor.run {
                self.lastError = "Summary error: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Config Persistence

    private static func loadLLMConfig() -> LLMConfig {
        guard let data = UserDefaults.standard.data(forKey: "llmConfig"),
              let config = try? JSONDecoder().decode(LLMConfig.self, from: data) else {
            return .defaultOpenAI
        }
        return config
    }

    private func saveLLMConfig() {
        if let data = try? JSONEncoder().encode(llmConfig) {
            UserDefaults.standard.set(data, forKey: "llmConfig")
        }
    }
}
