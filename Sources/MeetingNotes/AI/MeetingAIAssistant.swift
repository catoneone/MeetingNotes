import Foundation

/// AI assistant that provides response suggestions and meeting summaries.
final class MeetingAIAssistant {
    private let llmService: LLMService

    private let suggestionSystemPrompt = """
        You are a meeting assistant for a Chinese speaker participating in an English meeting.

        Your job:
        1. Analyze the recent transcript to detect if a question was directed at the user or if the user needs to respond.
        2. If a response is needed, provide a suggested answer in BOTH English and Chinese.
        3. If no response is needed, return exactly: NO_RESPONSE_NEEDED

        Response format (when a suggestion is needed):
        QUESTION: <brief description of what was asked>
        ENGLISH: <suggested response in English>
        CHINESE: <suggested response in Chinese>

        Guidelines:
        - Keep suggestions concise and professional.
        - The user is labeled as "Me" in the transcript.
        - Other participants are labeled as "Speaker".
        - Only suggest responses when there's a clear question or when input is expected.
        - Make the suggested response natural and contextually appropriate.
        """

    private let summarySystemPrompt = """
        You are a meeting summarizer. Generate a comprehensive bilingual meeting summary.

        Output format (use exactly these headers):
        ## English Summary
        <2-4 paragraph summary in English>

        ## 中文摘要
        <2-4 paragraph summary in Chinese>

        ## Key Decisions / 关键决定
        - <decision 1 in English> / <中文>
        - <decision 2 in English> / <中文>

        ## Action Items / 待办事项
        - <action item 1 in English> / <中文>
        - <action item 2 in English> / <中文>

        ## Topics Discussed / 讨论话题
        - <topic 1 in English> / <中文>
        - <topic 2 in English> / <中文>

        Guidelines:
        - Be concise but comprehensive.
        - Identify speakers when possible ("Me" = the user, "Speaker" = other participants).
        - Highlight any tasks assigned to "Me".
        """

    init(llmService: LLMService) {
        self.llmService = llmService
    }

    /// Analyze recent transcript and generate a response suggestion if needed.
    func generateSuggestion(recentTranscript: String, latestText: String) async throws -> AISuggestion? {
        let prompt = """
            Recent meeting transcript:
            ---
            \(recentTranscript.suffix(2000))
            ---

            Latest statement: "\(latestText)"

            Does the user (labeled "Me") need to respond? If yes, suggest a response.
            """

        let response = try await llmService.chatCompletion(
            systemPrompt: suggestionSystemPrompt,
            messages: [ChatMessage(role: "user", content: prompt)]
        )

        if response.contains("NO_RESPONSE_NEEDED") {
            return nil
        }

        return parseSuggestion(response, context: latestText)
    }

    /// Generate a full meeting summary from the complete transcript.
    func generateSummary(transcript: String) async throws -> MeetingSummary {
        let prompt = """
            Please summarize this meeting transcript:

            ---
            \(transcript)
            ---
            """

        let response = try await llmService.chatCompletion(
            systemPrompt: summarySystemPrompt,
            messages: [ChatMessage(role: "user", content: prompt)],
            temperature: 0.2
        )

        return parseSummary(response)
    }

    // MARK: - Parsing

    private func parseSuggestion(_ response: String, context: String) -> AISuggestion {
        var english = ""
        var chinese = ""

        for line in response.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("ENGLISH:") {
                english = String(trimmed.dropFirst(8)).trimmingCharacters(in: .whitespaces)
            } else if trimmed.hasPrefix("CHINESE:") || trimmed.hasPrefix("中文:") {
                chinese = String(trimmed.dropFirst(trimmed.hasPrefix("CHINESE:") ? 8 : 3)).trimmingCharacters(in: .whitespaces)
            }
        }

        // Fallback: if parsing failed, use the whole response
        if english.isEmpty {
            english = response
            chinese = response
        }

        return AISuggestion(
            timestamp: Date(),
            englishSuggestion: english,
            chineseSuggestion: chinese,
            context: context
        )
    }

    private func parseSummary(_ response: String) -> MeetingSummary {
        let sections = response.components(separatedBy: "##")

        var englishSummary = ""
        var chineseSummary = ""
        var keyDecisions: [String] = []
        var actionItems: [String] = []
        var topics: [String] = []

        for section in sections {
            let trimmed = section.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("English Summary") {
                englishSummary = String(trimmed.dropFirst("English Summary".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if trimmed.hasPrefix("中文摘要") {
                chineseSummary = String(trimmed.dropFirst("中文摘要".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if trimmed.contains("Key Decisions") || trimmed.contains("关键决定") {
                keyDecisions = extractBulletPoints(from: trimmed)
            } else if trimmed.contains("Action Items") || trimmed.contains("待办事项") {
                actionItems = extractBulletPoints(from: trimmed)
            } else if trimmed.contains("Topics Discussed") || trimmed.contains("讨论话题") {
                topics = extractBulletPoints(from: trimmed)
            }
        }

        // Fallback
        if englishSummary.isEmpty && chineseSummary.isEmpty {
            englishSummary = response
            chineseSummary = response
        }

        return MeetingSummary(
            englishSummary: englishSummary,
            chineseSummary: chineseSummary,
            keyDecisions: keyDecisions,
            actionItems: actionItems,
            topicsDiscussed: topics
        )
    }

    private func extractBulletPoints(from section: String) -> [String] {
        section.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("-") || $0.hasPrefix("•") }
            .map { String($0.dropFirst(1)).trimmingCharacters(in: .whitespaces) }
    }
}
