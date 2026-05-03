FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn

RUN corepack enable && yarn install

COPY . .

RUN yarn build

# Install production deps inside the built server output
RUN cd .medusa/server && npm install --omit=dev --legacy-peer-deps

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/.medusa/server /app

RUN corepack enable

EXPOSE 9000

CMD ["sh", "-c", "npx medusa db:migrate && npm run start"]
