FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/ai-connector/package.json ./apps/ai-connector/
RUN pnpm install --frozen-lockfile --filter @spellbook/ai-connector...
COPY contracts ./contracts
COPY apps/ai-connector ./apps/ai-connector
RUN pnpm --filter @spellbook/ai-connector build \
    && pnpm --filter @spellbook/ai-connector deploy --prod --legacy /out/connector

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
LABEL org.spellbook.component="ai-connector"
ENV NODE_ENV=production \
    PORT=8080 \
    SPELLBOOK_CONTRACTS_DIR=/app/contracts
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade --yes \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf \
      /var/lib/apt/lists/* \
      /opt/yarn-v1.22.22 \
      /usr/local/lib/node_modules/corepack \
      /usr/local/lib/node_modules/npm \
    && rm -f \
      /usr/local/bin/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/pnpm \
      /usr/local/bin/pnpx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg
WORKDIR /app
RUN mkdir -p /data /ai-auth && chown node:node /data /ai-auth
COPY --from=build /out/connector/node_modules ./apps/ai-connector/node_modules
COPY --from=build /out/connector/dist ./apps/ai-connector/dist
COPY --from=build /workspace/contracts ./contracts
USER node
EXPOSE 8080
CMD ["node", "apps/ai-connector/dist/server.js"]
