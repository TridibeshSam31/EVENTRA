FROM openwa/wa-automate:latest
USER root
RUN rm -f /etc/apt/sources.list.d/google-chrome.list && apt-get update && apt-get install -y procps psmisc && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /sessions && chown -R owauser:owauser /sessions
USER owauser
