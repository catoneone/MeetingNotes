import Foundation

/// OpenAI-compatible API client that works with any OpenAI-style endpoint
/// (OpenAI, Claude via proxy, Ollama, LM Studio, etc.)
final class LLMService: Sendable {
    private let config: LLMConfig

    init(config: LLMConfig) {
        self.config = config
    }

    /// Send a chat completion request and return the full response.
    func chatCompletion(
        systemPrompt: String,
        messages: [ChatMessage],
        temperature: Double = 0.3
    ) async throws -> String {
        let url = URL(string: "\(config.baseURL)/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")

        var allMessages: [[String: String]] = [
            ["role": "system", "content": systemPrompt]
        ]
        allMessages.append(contentsOf: messages.map { $0.toDictionary() })

        let body: [String: Any] = [
            "model": config.model,
            "messages": allMessages,
            "max_tokens": config.maxTokens,
            "temperature": temperature,
            "stream": false
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw LLMError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw LLMError.apiError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let firstChoice = choices.first,
              let message = firstChoice["message"] as? [String: Any],
              let content = message["content"] as? String else {
            throw LLMError.parseError
        }

        return content
    }

    /// Send a chat completion request with streaming response.
    func chatCompletionStream(
        systemPrompt: String,
        messages: [ChatMessage],
        temperature: Double = 0.3,
        onChunk: @escaping (String) -> Void
    ) async throws -> String {
        let url = URL(string: "\(config.baseURL)/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")

        var allMessages: [[String: String]] = [
            ["role": "system", "content": systemPrompt]
        ]
        allMessages.append(contentsOf: messages.map { $0.toDictionary() })

        let body: [String: Any] = [
            "model": config.model,
            "messages": allMessages,
            "max_tokens": config.maxTokens,
            "temperature": temperature,
            "stream": true
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw LLMError.invalidResponse
        }

        var fullContent = ""

        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let jsonString = String(line.dropFirst(6))
            if jsonString == "[DONE]" { break }

            guard let jsonData = jsonString.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let delta = choices.first?["delta"] as? [String: Any],
                  let content = delta["content"] as? String else {
                continue
            }

            fullContent += content
            onChunk(content)
        }

        return fullContent
    }
}

// MARK: - Supporting Types

struct ChatMessage {
    let role: String // "user" or "assistant"
    let content: String

    func toDictionary() -> [String: String] {
        ["role": role, "content": content]
    }
}

enum LLMError: LocalizedError {
    case invalidResponse
    case apiError(statusCode: Int, message: String)
    case parseError

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from LLM API."
        case .apiError(let statusCode, let message):
            return "API error (\(statusCode)): \(message)"
        case .parseError:
            return "Failed to parse LLM response."
        }
    }
}
