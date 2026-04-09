# Open Sage

A Next.js application for **AI-powered code repository analysis and chat**.

Add any public GitHub repository, let OpenSage index it, then ask questions about the codebase in natural language.

---

## Architecture

```
Browser (Next.js 16)
    ↓ REST API
API Routes  →  Redis / BullMQ Queue
                    ↓
┌───────────────────────────────────┐
│  Workers (Node.js/TypeScript)     │
│  ┌──────────────────────────────┐ │
│  │ clone-worker   – git clone   │ │
│  │ index-worker   – file scan   │ │
│  │ embedding-worker – HF embeds │ │
│  └──────────────────────────────┘ │
└───────────────────────────────────┘
                    ↓
       PostgreSQL + pgvector (HNSW)
                    ↑
              RAG Layer
       HuggingFace BAAI/bge-base-en-v1.5
              + Gemini 1.5 Flash
                    ↑
            Chat Streaming API
```

---

## Contributing

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL with pgvector + Redis)
- Git

### Setup

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd opensage
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the database and Redis**

   ```bash
   docker-compose up -d
   ```

4. **Run database migrations**

   ```bash
   npx prisma migrate dev
   ```

5. **Copy environment variables**

   Create a `.env` file in the project root. Required variables:

   ```env
   DATABASE_URL="postgresql://opensage:opensage_secret@localhost:5432/opensage_db"
   BETTER_AUTH_SECRET="<generate with: openssl rand -base64 32>"
   BETTER_AUTH_URL="http://localhost:3000"
   NEXT_PUBLIC_BETTER_AUTH_URL="http://localhost:3000"
   GITHUB_CLIENT_ID="<your GitHub OAuth App client ID>"
   GITHUB_CLIENT_SECRET="<your GitHub OAuth App client secret>"
   REDIS_URL="redis://localhost:6379"
   CLONES_DIR=".clones"
   HF_TOKEN="<your Hugging Face API token>"
   GEMINI_API_KEY="<your Google AI Studio API key>"
   ```

6. **Start the development server**

   ```bash
   npm run dev
   ```

7. **Start background workers** (in a separate terminal)

   ```bash
   # Start all three workers concurrently (cross-platform)
   npm run worker:all

   # Or individually:
   npm run worker:clone
   npm run worker:index
   npm run worker:embedding
   ```

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos` | List user's repositories |
| POST | `/api/repos` | Add a new repository |
| DELETE | `/api/repos/[id]` | Delete repo + local clone |
| POST | `/api/repos/[id]/clone` | Enqueue clone job |
| POST | `/api/repos/[id]/index` | Enqueue index job (retry) |
| GET | `/api/repos/[id]/status` | Get live clone/index status |
| GET | `/api/chat/[repoId]` | Fetch chat history |
| POST | `/api/chat/[repoId]` | Send question (streams response) |
| DELETE | `/api/chat/[repoId]` | Clear chat history |

---

## Project Structure

```
opensage/
├── app/
│   ├── (auth)/          # Sign-in / Sign-up pages
│   ├── api/
│   │   ├── auth/        # Better Auth API handler
│   │   ├── chat/        # Streaming RAG chat endpoint
│   │   └── repos/       # Repo CRUD + clone/index/status
│   ├── chat/[repoId]/   # Chat UI page
│   ├── page.tsx         # Dashboard (repo list)
│   └── globals.css      # Design system + all styles
├── lib/
│   ├── auth.ts          # Better Auth config
│   ├── auth-client.ts   # Client-side auth
│   ├── prisma.ts        # Prisma client singleton
│   ├── queue.ts         # BullMQ queues (clone/index/embed)
│   └── rag.ts           # Embedding + vector search + Gemini
├── workers/
│   ├── clone-worker.ts     # Git clone → triggers index
│   ├── index-worker.ts     # File scan + hash check → triggers embed
│   └── embedding-worker.ts # HuggingFace embeddings → pgvector
├── prisma/
│   ├── schema.prisma    # Full data model
│   └── migrations/      # All DB migrations incl. HNSW index
├── scripts/             # Queue inspection utilities
└── docker-compose.yml   # PostgreSQL + Redis
```

---

## Making Changes

1. Create a new branch: `git checkout -b feature/your-feature`
2. Make your changes following the existing code style
3. Check types: `npx tsc --noEmit --skipLibCheck`
4. Test locally
5. Submit a pull request

### Code Style

- TypeScript (strict mode) for all new code
- Vanilla CSS — add styles to `app/globals.css`
- ESLint + Prettier for formatting
