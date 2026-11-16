# Fastify API + WS gateway + worker image (Fly process groups share this image).
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

ENV PORT=8787
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8787

# Default CMD = web. Fly [processes] overrides CMD per group:
#   web    → npm run start
#   worker → npm run start:worker
# Runtime secrets: DATABASE_URL, REDIS_URL (+ optional DATABASE_SSL=true).
CMD ["npm", "run", "start"]
