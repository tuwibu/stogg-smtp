# STOGG SMTP Server

NestJS application that receives emails via SMTP and forwards them to an API endpoint.

## Features

- SMTP server listening on configurable port (default: 25)
- Parse incoming emails with attachments
- Forward email data to API via axios
- No HTTP API needed - pure SMTP to API gateway

## Installation

```bash
yarn install
```

## Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# SMTP Server Configuration
SMTP_PORT=25
SMTP_HOST=0.0.0.0
SMTP_MAX_SIZE=10485760

# Multimail API
MULTIMAIL_API_URL=https://multimail.example.com
MULTIMAIL_API_KEY=your-system-api-key
```

## Running the app

```bash
# development
yarn start:dev

# production
yarn build
yarn start:prod
```

## Docker

The image uses Node.js 24 Alpine and runs as `node` on container port 2525.
Compose publishes it on `SMTP_PORT` (default: 25); `SMTP_HOST` is fixed to
`0.0.0.0` inside the container.

```bash
cp .env.example .env
# Set MULTIMAIL_API_URL and MULTIMAIL_API_KEY in .env.
docker login registry.upgo.io
docker compose pull
docker compose up -d
docker compose logs -f smtp
```

Set `IMAGE_TAG=sha-<full-commit-sha>` in `.env` to pin a release instead of `latest`.
To build locally:

```bash
docker build -t registry.upgo.io/stogg-smtp:local .
IMAGE_TAG=local docker compose up -d
```

## CI

`.github/workflows/ci.yml` builds pull requests without publishing. Pushes to
`master`, `v*` tags, and manual runs build and push to `registry.upgo.io/stogg-smtp`.
The default branch publishes `latest`; builds also publish `sha-<full-commit-sha>`
and version-tag builds publish the Git tag.
Actions use major-version tags to receive compatible minor and patch updates.

GitHub Actions requires repository secrets `REGISTRY_USERNAME` and
`REGISTRY_PASSWORD`. Registry credentials never enter the image build.

## How it works

1. SMTP server listens for incoming emails
2. Email is parsed using mailparser
3. Email data (from, to, subject, text, HTML and message ID) is sent to `MULTIMAIL_API_URL/api/emails` via axios POST request
4. API key is sent in `x-api-key` header

## Project Structure

```
src/
├── main.ts           # Application entry point (uses Application Context, not HTTP)
├── app.module.ts     # Root module with ConfigModule and SmtpModule
└── smtp/
    ├── smtp.module.ts   # SMTP module
    └── smtp.service.ts  # SMTP server implementation
```

## Notes

- This is NOT an HTTP server - no Express/Fastify endpoints
- Uses NestJS Application Context instead of HTTP platform
- Port 25 requires root/admin privileges on Linux/Windows
