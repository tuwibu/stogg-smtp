# Skills Installation

How to install external dependencies (Python packages, FFmpeg, Node CLIs, etc.) for skills that need them. Most skills run on Python stdlib only and need nothing.

## Quick start

```bash
# Linux/macOS
cd .agents/skills
./install.sh

# Windows (PowerShell as Administrator)
cd .agents\skills
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install.ps1
```

Env vars: copy `.codex/.env.example` → `.codex/.env` and fill in keys. **One file, single source of truth** — the resolver also supports `.agents/skills/.env` and `.agents/skills/<skill>/.env` as optional overrides, but you don't need them for normal use.

Debug resolution: `python .codex/scripts/resolve_env.py --show-hierarchy --skill <skill-name>`

## Per-skill setup

### ai-multimodal
- Requires `GEMINI_API_KEY` (https://aistudio.google.com/apikey)
- Optional: `OPENROUTER_API_KEY`, `MINIMAX_API_KEY`
- Python deps: `google-genai`, `pypdf`, `python-docx`, `Pillow`, `python-dotenv` (installed by installer)
- Windows-only: `docx2pdf` needs Microsoft Word installed locally

### media-processing
- FFmpeg + ImageMagick must be in PATH
- RMBG CLI: `npm install -g rmbg-cli`
- Verify: `ffmpeg -version`, `magick -version`, `rmbg --version`

### devops
- Cloudflare Wrangler: `npm install -g wrangler` + `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Docker daemon running
- GCloud: `GOOGLE_APPLICATION_CREDENTIALS` pointing to service account JSON

### databases
- PostgreSQL client (`psql`)
- MongoDB Shell + Tools (https://www.mongodb.com/try/download/shell)

### shopify
- Shopify CLI: `npm install -g @shopify/cli @shopify/theme`
- Auth: `shopify auth login` (needs Partner account)

### repomix
- `npm install -g repomix`

### web-frameworks, ui-styling
- Node.js 18+, `pnpm` (`npm install -g pnpm`)

## Minimal install (skip the bundled installer)

If you only need 1-2 skills, install just what you use.

**ai-multimodal only:**
```bash
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install google-genai pypdf python-docx Pillow python-dotenv
```

**media-processing only:**
```bash
# macOS
brew install ffmpeg imagemagick && npm install -g rmbg-cli

# Linux
sudo apt-get install -y ffmpeg imagemagick && npm install -g rmbg-cli

# Windows
choco install ffmpeg imagemagick && npm install -g rmbg-cli
```

## Troubleshooting

### `externally-managed-environment` on pip install
Modern Linux distros block system-wide pip. Use a venv:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r .agents/skills/ai-multimodal/scripts/requirements.txt
```

### `command not found` after install
Tool installed but not in PATH. Check + add to shell rc:
```bash
which ffmpeg && ffmpeg -version
which node && node --version
which docker && docker --version
```

### Permission denied on scripts
```bash
chmod +x .agents/skills/*/scripts/*.py
chmod +x .agents/skills/install.sh
```

### Windows: `install.ps1` blocked by execution policy
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install.ps1
```

### Windows: package manager missing
Installer auto-detects winget/scoop/choco. Force one:
```powershell
.\install.ps1 -PreferPackageManager winget
```

### Installer interrupted mid-way
```bash
./install.sh --resume         # Linux/macOS
.\install.ps1 -Resume         # Windows
```

### Retry only failed packages
```bash
./install.sh --retry-failed
.\install.ps1 -RetryFailed
```

## Verify install
```bash
python .agents/skills/ai-multimodal/scripts/check_setup.py
```
