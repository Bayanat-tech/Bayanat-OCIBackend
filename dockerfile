FROM node:20-bookworm-slim

ENV PORT=3505 \
    ORACLE_INSTANT_CLIENT_PATH=/opt/oracle/instantclient_19_31 \
    LD_LIBRARY_PATH=/opt/oracle/instantclient_19_31

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip libaio1 libnsl2 \
    && rm -rf /var/lib/apt/lists/*

COPY oracle/instantclient-basic-linux.x64-19.31.0.0.0dbru.zip /tmp/instantclient.zip
RUN mkdir -p /opt/oracle \
    && unzip -q /tmp/instantclient.zip -d /opt/oracle \
    && rm /tmp/instantclient.zip \
    && echo /opt/oracle/instantclient_19_31 > /etc/ld.so.conf.d/oracle-instantclient.conf \
    && ldconfig

COPY package.json yarn.lock ./
COPY src/shims/sequelize ./src/shims/sequelize
RUN yarn install --frozen-lockfile --non-interactive

COPY . .
RUN rm -rf build tsconfig.tsbuildinfo \
    && yarn build \
    && yarn cache clean

EXPOSE 3505

CMD ["yarn", "start:prod"]