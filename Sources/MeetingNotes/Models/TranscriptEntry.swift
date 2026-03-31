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
        source: AudioSource = .system
    ) {
        self.id = id
        self.timestamp = timestamp
        self.englishText = englishText
        self.chineseText = chineseText
        self.isFinal = isFinal
        self.source = source
    }
}
