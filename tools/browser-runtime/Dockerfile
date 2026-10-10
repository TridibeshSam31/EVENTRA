FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DISPLAY=:99 \
    RESOLUTION=1280x800x24 \
    VIEWER_PORT=6080 \
    API_PORT=9223

WORKDIR /app

# Install X11 virtual display, window manager, VNC and noVNC websockify
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    net-tools \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy runtime code and entrypoint
COPY server.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 6080 9223

ENTRYPOINT ["/app/entrypoint.sh"]
