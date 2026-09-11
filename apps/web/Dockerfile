FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @spellbook/web...
COPY contracts ./contracts
COPY apps/web ./apps/web
RUN pnpm --filter @spellbook/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
