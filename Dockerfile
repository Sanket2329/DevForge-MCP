FROM node:20-alpine

WORKDIR /app

# NOTE: this base image has Node + git only. trigger_build/the git_* tools need
# whatever toolchain your project actually uses (dotnet SDK, python, maven, go,
# etc.) installed in the image too — add the relevant apk/apt lines below, or
# just run this server directly on your dev machine (see DEPLOYMENT.md) where
# those toolchains are already installed. git is required for git_* tools.
RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
