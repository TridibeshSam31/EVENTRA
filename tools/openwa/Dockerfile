FROM openwa/wa-automate:latest
USER root
RUN rm -f /etc/apt/sources.list.d/google-chrome.list && apt-get update && apt-get install -y procps psmisc && rm -rf /var/lib/apt/lists/*
COPY patch.cjs /usr/src/app/patch.cjs
RUN node /usr/src/app/patch.cjs
RUN mkdir -p /sessions && chown -R owauser:owauser /sessions
USER owauser

