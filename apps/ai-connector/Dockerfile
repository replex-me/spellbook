FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/ai-connector/package.json ./apps/ai-connector/
RUN pnpm install --frozen-lockfile --filter @spellbook/ai-connector...
COPY contracts ./contracts
COPY apps/ai-connector ./apps/ai-connector
RUN pnpm --filter @spellbook/ai-connector build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    SPELLBOOK_CONTRACTS_DIR=/app/contracts
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data /ai-auth && chown node:node /data /ai-auth
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/ai-connector/node_modules ./apps/ai-connector/node_modules
COPY --from=build /workspace/apps/ai-connector/dist ./apps/ai-connector/dist
COPY --from=build /workspace/contracts ./contracts
USER node
EXPOSE 8080
CMD ["node", "apps/ai-connector/dist/server.js"]
