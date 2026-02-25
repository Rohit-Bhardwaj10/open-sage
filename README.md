# Open Sage

A Next.js application for code repository analysis and chat.

## Contributing

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL with pgvector)

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

3. **Start the database**

   ```bash
   docker-compose up -d
   ```

4. **Run database migrations**

   ```bash
   npx prisma migrate dev
   ```

5. **Start the development server**

   ```bash
   npm run dev
   ```

6. **Start background workers** (in separate terminals)
   ```bash
   npm run worker:clone
   npm run worker:index
   npm run worker:embedding
   ```

### Project Structure

- `/app` - Next.js App Router pages and API routes
- `/lib` - Shared libraries (auth, database, queue, RAG)
- `/prisma` - Database schema and migrations
- `/workers` - Background job processors
- `/scripts` - Utility scripts

### Making Changes

1. Create a new branch for your feature/fix
2. Make your changes following the existing code style
3. Test your changes locally
4. Submit a pull request

### Code Style

- Use TypeScript for all new code
- Follow the existing ESLint configuration
- Use Prettier for formatting

### Running Tests

```bash
npm test
```
