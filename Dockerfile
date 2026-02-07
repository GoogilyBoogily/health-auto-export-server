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

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "src/app.ts"]
