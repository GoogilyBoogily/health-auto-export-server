FROM oven/bun:1-alpine

# Install su-exec for dropping privileges in entrypoint
RUN apk add --no-cache su-exec

WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source code and config
COPY src/ ./src/
COPY tsconfig.json ./

# Create data directory (will be chowned by entrypoint)
RUN mkdir -p /data

# Copy entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1))" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "src/app.ts"]
