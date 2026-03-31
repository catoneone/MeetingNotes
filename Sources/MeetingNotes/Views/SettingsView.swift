import SwiftUI

/// Settings view for configuring the LLM API, audio, and overlay preferences.
struct SettingsView: View {
    @Bindable var appState: AppState
    @State private var selectedTab = "api"

    var body: some View {
        TabView(selection: $selectedTab) {
            apiSettingsTab
                .tabItem {
                    Label("API", systemImage: "network")
                }
                .tag("api")

            overlaySettingsTab
                .tabItem {
                    Label("Overlay", systemImage: "rectangle.on.rectangle")
                }
                .tag("overlay")

            aboutTab
                .tabItem {
                    Label("About", systemImage: "info.circle")
                }
                .tag("about")
        }
        .frame(width: 480, height: 360)
    }

    // MARK: - API Settings

    private var apiSettingsTab: some View {
        Form {
            Section("LLM API Configuration (OpenAI-compatible)") {
                TextField("API Base URL", text: Binding(
                    get: { appState.llmConfig.baseURL },
                    set: { appState.llmConfig.baseURL = $0 }
                ))
                .textFieldStyle(.roundedBorder)

                SecureField("API Key", text: Binding(
                    get: { appState.llmConfig.apiKey },
                    set: { appState.llmConfig.apiKey = $0 }
                ))
                .textFieldStyle(.roundedBorder)

                TextField("Model", text: Binding(
                    get: { appState.llmConfig.model },
                    set: { appState.llmConfig.model = $0 }
                ))
                .textFieldStyle(.roundedBorder)

                Stepper("Max Tokens: \(appState.llmConfig.maxTokens)",
                        value: Binding(
                            get: { appState.llmConfig.maxTokens },
                            set: { appState.llmConfig.maxTokens = $0 }
                        ),
                        in: 256...8192,
                        step: 256)
            }

            Section("Presets") {
                HStack {
                    Button("OpenAI") {
                        let key = appState.llmConfig.apiKey
                        appState.llmConfig = .defaultOpenAI
                        appState.llmConfig.apiKey = key
                    }
                    .buttonStyle(.bordered)

                    Button("Claude (via proxy)") {
                        let key = appState.llmConfig.apiKey
                        appState.llmConfig = .defaultClaude
                        appState.llmConfig.apiKey = key
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                }
            }

            Section("Features") {
                Toggle("Auto-translate to Chinese", isOn: $appState.autoTranslate)
                Toggle("AI response suggestions", isOn: $appState.autoSuggest)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    // MARK: - Overlay Settings

    private var overlaySettingsTab: some View {
        Form {
            Section("Subtitle Appearance") {
                HStack {
                    Text("Font Size")
                    Slider(value: $appState.subtitleFontSize, in: 12...32, step: 1)
                    Text("\(Int(appState.subtitleFontSize))pt")
                        .monospacedDigit()
                        .frame(width: 40)
                }

                HStack {
                    Text("Background Opacity")
                    Slider(value: $appState.overlayOpacity, in: 0.3...1.0, step: 0.05)
                    Text("\(Int(appState.overlayOpacity * 100))%")
                        .monospacedDigit()
                        .frame(width: 40)
                }
            }

            Section("Preview") {
                ZStack {
                    Color.gray.opacity(0.3)

                    VStack(spacing: 4) {
                        Text("This is a sample English subtitle")
                            .font(.system(size: appState.subtitleFontSize, weight: .medium))
                            .foregroundStyle(.white)

                        Text("这是一个示例中文字幕")
                            .font(.system(size: appState.subtitleFontSize - 2))
                            .foregroundStyle(.cyan)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.black.opacity(appState.overlayOpacity))
                    )
                }
                .frame(height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    // MARK: - About

    private var aboutTab: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.accentColor)

            Text("MeetingNotes")
                .font(.title.bold())

            Text("Your AI-powered meeting assistant")
                .foregroundStyle(.secondary)

            Text("智能会议助手")
                .foregroundStyle(.tertiary)

            Divider()
                .frame(width: 200)

            VStack(spacing: 4) {
                Text("Features:")
                    .font(.caption.bold())
                Text("Real-time English subtitles · Chinese translation")
                    .font(.caption)
                Text("AI response suggestions · Meeting summaries")
                    .font(.caption)
            }
            .foregroundStyle(.secondary)

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}
