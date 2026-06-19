# PostGIS + pgvector for local dev — spatial parcel geometry (PostGIS) AND
# RAG embeddings (pgvector) in one Postgres. Built FROM the vetted official
# postgis image + pgvector from PGDG (the apt repo the image already trusts),
# mirroring the CI `.github/actions/enable-pgvector` step so dev and CI match.
FROM postgis/postgis:16-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
