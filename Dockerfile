FROM node:22-slim as build
WORKDIR /app

COPY package*.json .npmrc ./

# npm ci would compile better-sqlite3, which ships its binaries prebuilt; no other dependency needs
# its install script here
RUN npm ci --ignore-scripts

COPY . .

ARG VCS_BRANCH_SHA
RUN set -e; \
    echo "${VCS_BRANCH_SHA:-HEAD}" > ./static/vcs_branch_sha ; \
    npm run build

FROM node:22-slim
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/build ./build
COPY --from=build /app/migrations ./migrations

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && mkdir /data && chown node:node /data

# the SQLite database and its write-ahead log; mount a persistent volume here
ENV DATABASE_PATH=/data/parlaqui.db
# every request body is a few bytes of JSON or a login form
ENV BODY_SIZE_LIMIT=16K
VOLUME /data

# sharp and the image renders run on libuv's pool, which holds only four threads by default
ENV UV_THREADPOOL_SIZE=16

USER node

EXPOSE 3000

# without this the deploy swaps before the new container works; /healthz answers once the migrations
# are applied and the database answers, and the start period leaves the migrations time to run
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT [ "node", "build" ]
