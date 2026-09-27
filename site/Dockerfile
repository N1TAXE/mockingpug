# Docs site (fumadocs / Next standalone). Context — the site/ folder.
# Built and pushed to GHCR by CI; the VPS only pulls + runs it (Caddy proxies
# DOCS_DOMAIN → docs:3000 in the app's docker-compose.prod.yml).
FROM node:22-alpine AS deps
WORKDIR /site
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall (fumadocs-mdx) needs source.config.ts,
# which isn't copied yet; it runs in the build stage instead.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /site
COPY --from=deps /site/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are baked into the build. Defaults to docs.mockingpug.com via
# lib/shared.ts when the arg is empty.
ARG NEXT_PUBLIC_SITE_URL=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
  NEXT_TELEMETRY_DISABLED=1
RUN npx fumadocs-mdx && npx next build

FROM node:22-alpine AS prod
WORKDIR /site
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /site/.next/standalone ./
COPY --from=build /site/.next/static ./.next/static
COPY --from=build /site/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/robots.txt || exit 1
CMD ["node", "server.js"]
