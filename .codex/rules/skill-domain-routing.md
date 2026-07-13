# Skill Domain Routing

When a user's task involves a specific domain, use these decision trees to pick the RIGHT skill based on user intent.

## Frontend / UI

```
User wants to...
├── Replicate a mockup, screenshot, or video    → /frontend-design
├── Build React/TS components with best practices → /frontend-development
├── Style with Tailwind CSS + shadcn/ui          → /ui-styling
├── Choose colors, fonts, layout, design system  → /ui-ux-pro-max
├── Audit existing UI for accessibility/UX       → /web-design-guidelines
├── Apply React performance patterns             → /react-best-practices
```

## Codebase Understanding

```
User wants to...
├── Quick file search, locate specific code     → /scout
├── Onboard a new repo / dump codebase for LLM  → /repomix
├── Build a queryable knowledge graph from code → /graphify
└── Go-to-def / find-usages / impact / arch graph (IDE-like) → /gkg
```

## Backend / API

```
User wants to...
└── Build REST/GraphQL API (NestJS, FastAPI, Django) → /backend-development
```

## Database

```
User wants to...
├── Design schemas, write SQL/NoSQL queries     → /databases
├── Optimize indexes, migrations, replication   → /databases
```

## Infrastructure / Deployment

```
User wants to...
├── Deploy to Vercel, Netlify, Railway, Fly.io   → /deploy
└── Docker, Kubernetes, CI/CD pipelines, GitOps   → /devops
```

## Security

```
User wants to...
├── STRIDE/OWASP security audit with auto-fix    → /security
└── Scan for secrets, vulnerabilities, OWASP patterns → /security --quick
```

## AI / LLM

```
User wants to...
└── Generate/analyze images, audio, video with AI → /ai-multimodal
```

## MCP (Model Context Protocol)

```
User wants to...
├── Convert existing code into CLI/MCP server    → /agentize
└── Discover and execute MCP tools               → /use-mcp
```

## Testing / Browser

```
User wants to...
├── Run test suites, coverage reports, TDD          → /test
├── Test strategy + Playwright/Vitest/k6 runner     → /web-testing
└── Browser automation/testing without real user cookies → /browser
```

## Media

```
User wants to...
└── Process video/audio (FFmpeg), images (ImageMagick) → /media-processing
```

## Documentation

```
User wants to...
├── Update project docs (codebase-summary, PDR)   → /docs
├── Search library/framework docs (context7)      → /docs-seeker
├── Inline doc diagrams (Mermaid v11)             → /mermaidjs-v11
├── Generate session hand-off / EOD summary       → /watzup
└── Sprint retrospective from git history         → /retro
```

## Documents / Office Files

```
User wants to...
├── Create / edit / extract from .docx (Word)         → /docx
├── Create / edit / extract from .pdf (forms, tables) → /pdf
├── Create / edit / extract from .pptx (PowerPoint)   → /pptx
└── Create / edit / extract from .xlsx (spreadsheets) → /xlsx
```

## Content / Copy

```
User wants to...
├── Brand identity, logos, banners               → /ckm:design
```

## Frameworks

```
User wants to...
├── Next.js App Router, RSC, Turborepo           → /web-frameworks
├── TanStack Start/Form/AI                       → /tanstack
├── React Native, Flutter, SwiftUI               → /mobile-development
└── Shopify apps, Polaris, Liquid templates       → /shopify
```

## Usage Notes

- Pick ONE skill per distinct user intent
- If a task spans two domains (e.g. "build + deploy"), suggest the primary skill and mention the secondary
- Domain skills combine with core workflow: `/plan` → domain skill → `/cook`
- Skills not listed here are either core workflow skills (see `skill-workflow-routing.md`) or utility skills activated on demand (e.g. `/brainstorm --quick`, `/preview`)
