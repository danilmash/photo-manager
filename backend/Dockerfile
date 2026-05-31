FROM python:3.11-slim

# ImageMagick 7 + LibRaw для декодирования CR2/NEF/ARW/DNG и др.
# libmagickcore-*-extra подключает дополнительные coders, включая RAW.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        imagemagick \
        libmagickcore-7.q16-10-extra \
        libraw23t64 \
    && sed -i \
        -e 's/name="memory" value="[^"]*"/name="memory" value="2GiB"/' \
        -e 's/name="map" value="[^"]*"/name="map" value="4GiB"/' \
        /etc/ImageMagick-7/policy.xml \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
