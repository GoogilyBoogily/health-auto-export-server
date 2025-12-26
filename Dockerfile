FROM oven/bun:1-alpine

# Create non-root user
RUN addgroup -g 1001 bunjs && adduser -S -u 1001 -G bunjs bunjs

WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source code and config
COPY src/ ./src/
COPY tsconfig.json ./

# Set ownership
RUN chown -R bunjs:bunjs /app
USER bunjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1))" || exit 1

CMD ["bun", "run", "src/app.ts"]
