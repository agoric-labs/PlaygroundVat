FROM node:lts

WORKDIR /usr/src/app
COPY . .

# node:lts-slim doesn't provide git, let alone stuff to compile secp256k1
RUN npm install

WORKDIR /usr/src/app/examples/quorum/

ENV PATH=/usr/src/app/bin:$PATH
