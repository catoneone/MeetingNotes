import Foundation

/// A suggested response from the AI assistant.
struct AISuggestion: Identifiable {
    let id = UUID()
    let timestamp: Date
    let englishSuggestion: String
    let chineseSuggestion: String
    let context: String  // The question or context that triggered this suggestion
}

/// Represents a streaming chunk from the LLM API.
struct LLMStreamChunk {
    let content: String
    let isFinished: Bool
}

/// Configuration for the LLM API connection.
struct LLMConfig: Codable {
    var apiKey: String
    var baseURL: String
    var model: String
    var maxTokens: Int

    static let defaultOpenAI = LLMConfig(
        apiKey: "",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4o",
        maxTokens: 2048
    )

    static let defaultClaude = LLMConfig(
        apiKey: "",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        maxTokens: 2048
    )
}
