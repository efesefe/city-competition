# Frontend Docker image build

`docker compose` builds the Next.js app with `npm run build` in [`frontend/Dockerfile`](../frontend/Dockerfile). Next type-checks during that step, so a missing TypeScript name fails the `frontend` image the same way a local `npm run build` does.

## Recent failure

PR #28 added tribe-ranking types in `frontend/lib/leaderboard-api.ts` and accidentally removed:

```ts
export type LeaderboardScope = "global" | "tribe" | "province" | "derby";
```

`fetchMyRank` still takes `LeaderboardScope`, so Docker `RUN npm run build` exited 1 with `Cannot find name 'LeaderboardScope'`. Same class of edit as the backend `DerbyKey` restore in `d2b191e`.

## How to test

```bash
cd frontend && npm run build
```
