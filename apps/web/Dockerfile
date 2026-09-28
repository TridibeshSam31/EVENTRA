FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

# Copy workspace manifests
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/

# Install dependencies using pnpm workspace
RUN pnpm install

# Copy web source code
COPY apps/web/ ./apps/web/
COPY tsconfig.json* ./

WORKDIR /app/apps/web

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["pnpm", "run", "dev"]
