FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  curl \
  python3 \
  python3-pip \
  python3-venv \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build

RUN mkdir -p /app/data/servers

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "exec npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
