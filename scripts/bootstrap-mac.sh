#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it first: https://nodejs.org/"
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the local STT setup on macOS: https://brew.sh/"
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created .env from .env.example"
fi

chmod +x "$ROOT_DIR/scripts/setup-local-stt.sh"
"$ROOT_DIR/scripts/setup-local-stt.sh"

cat <<EOF

Setup complete.

Next steps:
  cd "$ROOT_DIR"
  node server.js

Then open:
  http://localhost:3000

Optional:
  - If you want official OpenAI API access, fill OPENAI_API_KEY in .env
  - If you already use ChatGPT with Codex locally, analysis can run without an API key
EOF
