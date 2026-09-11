FROM oven/bun:1-alpine

# Install su-exec for dropping privileges in entrypoint
RUN apk add --no-cache su-exec

WORKDIR /app

# Copy package files and install dependencies.
# --ignore-scripts because `prepare` runs husky, a dev-only git-hook installer that is not present
# under --production and has nothing to do in a container. Runtime deps need no lifecycle scripts.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Copy source code and config
COPY src/ ./src/
COPY tsconfig.json ./

# Copy entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "src/app.ts"]
