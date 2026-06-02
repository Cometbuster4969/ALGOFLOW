# ============================================================================
# AlgoFlow — Secure Execution Sandbox Dockerfile
# ============================================================================
#
# Minimal Alpine image with compilers for C++, Python 3, and Java.
# Runs as non-root "sandbox" user with tight resource limits.
#
# Build:  docker build -t algoflow-sandbox .
# Run:    docker run --rm -p 3000:3000 \
#           --memory=512m --cpus=2 --network=none \
#           --cap-drop=ALL --security-opt=no-new-privileges \
#           algoflow-sandbox
# ============================================================================

# ── Stage 1: Build dependencies ──────────────────────────────────────────────

FROM alpine:3.19 AS deps

RUN apk add --no-cache \
    # Core runtimes
    nodejs \
    npm \
    # C++ compiler
    g++ \
    make \
    # Python 3
    python3 \
    py3-pip \
    # Java (headless JDK)
    openjdk17-jre-headless \
    openjdk17-jdk \
    # Utilities
    coreutils \
    procps \
    && rm -rf /var/cache/apk/*

# ── Stage 2: Production image ────────────────────────────────────────────────

FROM alpine:3.19

# Copy installed packages from deps stage
COPY --from=deps /usr /usr
COPY --from=deps /lib /lib
COPY --from=deps /etc /etc
COPY --from=deps /sbin /sbin
COPY --from=deps /bin /bin

# Verify compilers
RUN g++ --version && python3 --version && javac --version

# ── Non-privileged user ──────────────────────────────────────────────────────

RUN addgroup -S sandbox && \
    adduser -S sandbox -G sandbox -h /home/sandbox && \
    mkdir -p /home/sandbox/workspace /tmp/algoflow_sandbox && \
    chown -R sandbox:sandbox /home/sandbox /tmp/algoflow_sandbox

# ── App setup ─────────────────────────────────────────────────────────────────

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Create temp directory for sandboxed executions
RUN mkdir -p /tmp/algoflow_sandbox && \
    chmod 1777 /tmp/algoflow_sandbox

# ── Security hardening ───────────────────────────────────────────────────────

# Drop all capabilities, prevent privilege escalation
# (These are also enforced at `docker run` time)

# Set resource limits via /etc/security/limits.conf
RUN echo "sandbox  hard  nproc   64"     >> /etc/security/limits.conf && \
    echo "sandbox  hard  nofile  1024"   >> /etc/security/limits.conf && \
    echo "sandbox  hard  fsize   524288" >> /etc/security/limits.conf

# Switch to non-root user
USER sandbox:sandbox

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server/index.js"]
