import Foundation

/// A single transcript entry representing a recognized speech segment.
struct TranscriptEntry: Identifiable, Codable {
    let id: UUID
    let timestamp: Date
    var englishText: String
    var chineseText: String?
    var isFinal: Bool
    /// "system" for meeting audio, "user" for microphone
    var source: AudioSource
    /// Speaker label for diarization (e.g., "Speaker 1", "Speaker 2", or "Me")
    var speakerLabel: String

    enum AudioSource: String, Codable {
        case system
        case user
    }

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        englishText: String,
        chineseText: String? = nil,
        isFinal: Bool = false,
        source: AudioSource = .system,
        speakerLabel: String? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.englishText = englishText
        self.chineseText = chineseText
        self.isFinal = isFinal
        self.source = source
        self.speakerLabel = speakerLabel ?? (source == .user ? "Me" : "Speaker")
    }
}
