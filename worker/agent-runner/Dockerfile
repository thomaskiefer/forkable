FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PATH="/root/.local/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssh-client \
    pipx \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.130.0 @insforge/cli@latest

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080

CMD ["npm", "start"]
