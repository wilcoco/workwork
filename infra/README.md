# Railway Deployment

- Create a Railway project.
- Add a PostgreSQL service. Note the `DATABASE_URL`.
- Enable `pgvector` extension on the DB:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- Create a Web service from the GitHub repo, set env vars:
  - `PORT=3000`
  - `DATABASE_URL=...`
  - `USE_LLM=false`

- Build command (root): `npm install && npm run build`
- Start command (api): `npm run -w @workwork/api start`

Front-end can be served separately (e.g., static hosting) or via reverse proxy.
