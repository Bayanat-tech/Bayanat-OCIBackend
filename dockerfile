# FROM node:latest
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json .

RUN npm install --no audit --no-fund

RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip libaio1 libnsl2 \
    && rm -rf /var/lib/apt/lists/*

COPY oracle/instantclient-basic-linux.x64-19.31.0.0.0dbru.zip /tmp/instantclient.zip
RUN mkdir -p /opt/oracle \
 && unzip -q /tmp/instantclient.zip -d /opt/oracle \
    && rm /tmp/instantclient.zip \
    && echo /opt/oracle/instantclient_19_31 > /etc/ld.so.conf.d/oracle-instantclient.conf \
    && ldconfig

    
ENV ORACLE_INSTANT_CLIENT_PATH=/opt/oracle/instantclient_19_31
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_19_31

RUN npm install

COPY . .
RUN rm -rf build tsconfig.tsbuildinfo 
EXPOSE 8001

CMD [ "npm","run","start:prod" ]



