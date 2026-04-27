# Chrona

Chrona is an AI-native control plane for turning intent into scheduled execution.

It is designed around two product pillars:
- **Schedule creation and arrangement**
- **Automatic task completion**

The project focuses on making planning and execution feel like one connected system: users create work, shape it into time, and let agents carry tasks forward with continuously updated plans.

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start (EN)](./docs/en/quick-start.md) | Setup and first run |
| [快速开始（中文）](./docs/zh/quick-start.md) | Chinese quick start |
| [Architecture](./docs/architecture.md) | System design and data flow |
| [Data Model](./docs/data-model.md) | Database schema reference |
| [API Reference](./docs/api-reference.md) | REST API endpoints |
| [Roadmap (EN)](./docs/en/roadmap.md) / [路线图](./docs/zh/roadmap.md) | Product roadmap |

## Quick Start

> For full setup details, see [./docs/en/quick-start.md](./docs/en/quick-start.md).

```bash
# Clone and install (auto-generates Prisma client via postinstall)
git clone https://github.com/your-org/Chrona.git
cd Chrona
bun install

# Configure environment
cp .env.example .env
# Edit .env to set API keys (AI_PROVIDER_API_KEY, etc.)

# Initialize database and seed sample data
bun run setup

# Start dev servers
bun run dev
```

Open http://localhost:3100.

Development ports:
- SPA dev server: `http://localhost:3100`
- Local API server: `http://localhost:3101`

Production:

```bash
bun run build
bun run start
```

## Project Structure

```
apps/
  web/          — Vite React SPA (React Router)
  server/       — Hono API server + static SPA host
packages/
  common/       — AI features, CLI, runtime core
  contracts/    — Shared DTOs, Zod schemas
  db/           — Prisma bootstrap, repositories
  domain/       — Pure business rules
  runtime/      — Commands, queries, projections
  providers/    — Provider bridges (OpenClaw, Hermes)
```

## Product Roadmap

### 1. Schedule Creation and Arrangement

- Intelligent task suggestions while creating schedule items
- AI-assisted task planning before execution
- Turning loose ideas into structured task plans
- Fast schedule creation, review, and adjustment

### 2. Automatic Task Completion

- Run agents according to schedule
- Execute tasks with runtime configuration
- Automatically update task plans as work progresses
- Keep execution status and planning status synchronized

### Backend Runtime Direction

Chrona supports multiple runtime backends behind one product surface:
- OpenClaw
- Hermes (planned)
- Bare LLM (planned)

The scheduling and task model stays stable while different runtime providers power planning, execution, and follow-up updates.
