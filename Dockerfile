FROM oven/bun:latest

WORKDIR /app

COPY package*.json bun.lockb* tsup.config.ts tsconfig*.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN bun install --frozen-lockfile
RUN bunx playwright install --with-deps chromium
RUN bun run prebuild && bunx tsup && chmod +x dist/videntia_figma_mcp/server.js dist/socket.js

EXPOSE 3055

CMD ["bun", "run", "dist/socket.js"]
