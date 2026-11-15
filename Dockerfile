FROM python:3.12-alpine
WORKDIR /app
COPY server.py default-apps.json ./
COPY site/ ./site/
ENV DATA_DIR=/data PORT=8080 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8080
CMD ["python", "server.py"]
