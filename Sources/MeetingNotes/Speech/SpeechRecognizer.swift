import Foundation
import Speech
import AVFoundation

/// Real-time speech recognizer using Apple's Speech framework.
final class SpeechRecognizer {
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var systemRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var userRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var systemRecognitionTask: SFSpeechRecognitionTask?
    private var userRecognitionTask: SFSpeechRecognitionTask?

    /// Callback: (text, isFinal, source)
    var onTranscriptUpdate: ((String, Bool, TranscriptEntry.AudioSource) -> Void)?

    private var restartTimer: Timer?

    // MARK: - Authorization

    static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    // MARK: - Recognition Control

    func startRecognition() throws {
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            throw SpeechError.recognizerNotAvailable
        }

        startSystemRecognition()
        startUserRecognition()

        // Apple Speech has a ~60s limit per task. Restart periodically.
        restartTimer = Timer.scheduledTimer(withTimeInterval: 55, repeats: true) { [weak self] _ in
            self?.restartRecognition()
        }
    }

    func stopRecognition() {
        restartTimer?.invalidate()
        restartTimer = nil

        systemRecognitionTask?.cancel()
        userRecognitionTask?.cancel()
        systemRecognitionRequest?.endAudio()
        userRecognitionRequest?.endAudio()

        systemRecognitionTask = nil
        userRecognitionTask = nil
        systemRecognitionRequest = nil
        userRecognitionRequest = nil
    }

    // MARK: - Audio Buffer Processing

    func processAudioBuffer(_ buffer: AVAudioPCMBuffer, source: TranscriptEntry.AudioSource) {
        switch source {
        case .system:
            systemRecognitionRequest?.append(buffer)
        case .user:
            userRecognitionRequest?.append(buffer)
        }
    }

    // MARK: - Private Methods

    private func startSystemRecognition() {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true

        systemRecognitionRequest = request
        systemRecognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                let isFinal = result.isFinal
                self?.onTranscriptUpdate?(text, isFinal, .system)
            }

            if error != nil || result?.isFinal == true {
                // Task ended, will be restarted by timer
            }
        }
    }

    private func startUserRecognition() {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true

        userRecognitionRequest = request
        userRecognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                let isFinal = result.isFinal
                self?.onTranscriptUpdate?(text, isFinal, .user)
            }
        }
    }

    private func restartRecognition() {
        // Gracefully end current tasks and start new ones
        systemRecognitionRequest?.endAudio()
        userRecognitionRequest?.endAudio()

        // Brief delay to let the tasks finalize
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.systemRecognitionTask?.cancel()
            self?.userRecognitionTask?.cancel()
            self?.startSystemRecognition()
            self?.startUserRecognition()
        }
    }
}

enum SpeechError: LocalizedError {
    case recognizerNotAvailable
    case notAuthorized

    var errorDescription: String? {
        switch self {
        case .recognizerNotAvailable:
            return "Speech recognizer is not available. Please check your language settings."
        case .notAuthorized:
            return "Speech recognition not authorized. Please enable in System Settings > Privacy & Security > Speech Recognition."
        }
    }
}
