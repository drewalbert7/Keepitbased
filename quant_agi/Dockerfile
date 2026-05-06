# Build: cd quant_agi && docker build -t quant-agi .

FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
        --extra-index-url https://download.pytorch.org/whl/cpu

COPY . /app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8844

CMD ["python", "main.py", "serve", "--host", "0.0.0.0", "--port", "8844"]
