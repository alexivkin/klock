FROM node:10.5-slim

WORKDIR /klock
ENV NODE_ENV development

COPY package.json /klock/package.json

RUN npm install --production

COPY cli.js /klock
COPY server.js /klock
COPY app/ /klock/app/
COPY lib/ /klock/lib/
COPY public/ /klock/public/
COPY extensions.csv /klock

EXPOSE 8080

ENTRYPOINT ["node","cli.js"]
