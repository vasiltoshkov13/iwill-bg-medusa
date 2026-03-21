FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn

RUN corepack enable && yarn install

COPY . .

RUN yarn build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app /app

EXPOSE 9000

CMD ["yarn", "medusa", "start"]
