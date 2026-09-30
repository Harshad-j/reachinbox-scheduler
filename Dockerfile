FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
COPY frontend frontend
COPY scripts scripts
RUN npx prisma generate --schema backend/prisma/schema.prisma \
    && npm run build --workspace backend \
    && mkdir -p backend/dist/queue \
    && cp backend/src/queue/rateLimit.lua backend/dist/queue/rateLimit.lua \
    && npm run build --workspace frontend
EXPOSE 4000 5173
