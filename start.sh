#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

is_termux() { [ -n "${PREFIX:-}" ] && [ -d "/data/data/com.termux" ]; }

if ! command -v bun >/dev/null 2>&1; then
  if is_termux; then
    cat <<'EOF'
Bun isn't installed yet.

Bun is a glibc binary and Android uses bionic, so it needs a wrapper.
Run these once, then start Hearth again:

  pkg install git curl clang make glibc-repo python
  pkg install glibc-runner
  touch ~/.bashrc
  curl -fsSL https://bun.sh/install | bash
  git clone https://github.com/Happ1ness-dev/bun-termux.git ~/.bun-termux
  cd ~/.bun-termux && make && make install
EOF
    exit 1
  fi
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Always sync dependencies. Checking only for node_modules meant a new package
# in an updated build was silently skipped. bun install is a no-op when current.
echo "Checking dependencies..."
if is_termux; then
  bun install --backend=copyfile
else
  bun install
fi

exec bun run src/serve.ts
