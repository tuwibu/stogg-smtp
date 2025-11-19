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

# API Configuration
API_URL=https://api.example.com/email
API_KEY=your-api-key-here
```

## Running the app

```bash
# development
yarn start:dev

# production
yarn build
yarn start:prod
```

## How it works

1. SMTP server listens for incoming emails
2. Email is parsed using mailparser
3. Email data (from, to, subject, body, html, attachments) is sent to API via axios PUT request
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
