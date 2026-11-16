FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787
# DATABASE_URL must be set at runtime (Neon or Fly MPG).
CMD ["npm", "run", "start"]
