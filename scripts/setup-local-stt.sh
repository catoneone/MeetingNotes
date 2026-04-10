#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_NAME="${1:-base.en}"
MODEL_PATH="$ROOT_DIR/models/ggml-${MODEL_NAME}.bin"
TMP_REPO="/tmp/whisper.cpp-setup"

echo "Installing local STT dependencies with Homebrew..."
brew install ffmpeg whisper-cpp

mkdir -p "$ROOT_DIR/models"

if [[ -f "$MODEL_PATH" ]]; then
  echo "Model already exists at $MODEL_PATH"
  exit 0
fi

echo "Downloading whisper.cpp model '$MODEL_NAME' via official script..."
rm -rf "$TMP_REPO"
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$TMP_REPO"
/bin/sh "$TMP_REPO/models/download-ggml-model.sh" "$MODEL_NAME"
cp "$TMP_REPO/models/ggml-${MODEL_NAME}.bin" "$MODEL_PATH"

echo "Local STT setup complete."
echo "Model saved to: $MODEL_PATH"
