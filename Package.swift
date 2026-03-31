// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MeetingNotes",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "MeetingNotes",
            path: "Sources/MeetingNotes",
            exclude: ["Info.plist", "MeetingNotes.entitlements"],
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
            ]
        )
    ]
)
