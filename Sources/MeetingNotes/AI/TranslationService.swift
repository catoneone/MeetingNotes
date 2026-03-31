import Foundation

/// Translates English text to Chinese using the LLM API.
final class TranslationService {
    private let llmService: LLMService
    private let systemPrompt = """
        You are a professional translator. Translate the following English text to Simplified Chinese.
        Rules:
        - Output ONLY the Chinese translation, nothing else.
        - Maintain the original meaning and tone.
        - Use natural, conversational Chinese suitable for a meeting context.
        - If the text contains technical terms, keep common English acronyms (e.g., API, SDK) as-is.
        - Do not add explanations or notes.
        """

    init(llmService: LLMService) {
        self.llmService = llmService
    }

    /// Translate English text to Chinese.
    func translate(_ englishText: String) async throws -> String {
        let trimmed = englishText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        return try await llmService.chatCompletion(
            systemPrompt: systemPrompt,
            messages: [ChatMessage(role: "user", content: trimmed)],
            temperature: 0.1
        )
    }

    /// Translate with streaming for lower perceived latency.
    func translateStreaming(_ englishText: String, onChunk: @escaping (String) -> Void) async throws -> String {
        let trimmed = englishText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        return try await llmService.chatCompletionStream(
            systemPrompt: systemPrompt,
            messages: [ChatMessage(role: "user", content: trimmed)],
            temperature: 0.1,
            onChunk: onChunk
        )
    }
}
