# Two targets. `dev` runs from source with hot reload (compose mounts the
# working tree over /app); `prod` runs compiled dist with production deps only.
#
# The app is containerised so its memory can actually be capped: a host process
# gets no cgroup, so mem_limit here is what bounds RSS. NODE_OPTIONS bounds the
# V8 heap inside that — the two are different ceilings and you need both, since
# RSS runs roughly 1.8x the heap (code, stacks, native buffers live outside it).

FROM docker.io/library/node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- dev ----------
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
# node_modules stays the image's copy even with the source bind-mounted over
# /app — the anonymous volume in compose protects it from being shadowed.
CMD ["npm", "run", "dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build

# ---------- prod ----------
FROM docker.io/library/node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["npm", "start"]
