#!/bin/sh
set -eu

# Creates the uploads bucket and makes it readable by anyone, then exits.
#
# A one-shot job rather than something the API does at startup, for the same
# reason migrations are a job: several API replicas racing to create the same
# bucket and set the same policy is a race with no upside, and an application
# that provisions its own infrastructure needs credentials to do so.
#
# Idempotent — `mc mb --ignore-existing` and re-applying the same policy are
# both no-ops on a second run, so `docker compose up` is safe to repeat.
#
# See docs/adr/0022-object-storage-for-uploads.md

BUCKET="${S3_BUCKET:-kintsugi-uploads}"

# `local` is just an alias name for this endpoint in mc's config.
mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /dev/null

mc mb --ignore-existing "local/${BUCKET}"

# ------------------------------------------------------------------
# Anonymous GetObject, and NOTHING else.
#
# NOT `mc anonymous set download`, which is the obvious one-liner and is wrong.
# It also grants `s3:ListBucket` to `*`:
#
#   {"Action":["s3:GetBucketLocation","s3:ListBucket"],
#    "Principal":{"AWS":["*"]},"Resource":["arn:aws:s3:::kintsugi-uploads"]}
#
# That makes the bucket enumerable by anyone — every listing photo and every
# avatar any user has ever uploaded, walkable from a browser. The whole reason
# unsigned public reads are defensible here is that keys are 128 bits of
# randomness and therefore unguessable; an index hands that away for free.
#
# Caught by tests/api/storage.ts, which asserts a bucket listing is refused.
#
# Public read on the OBJECTS is still correct for what is in here: listing
# photos and avatars on a public marketplace, already visible to anyone who can
# load a product page. Serving them unsigned is also what lets a CDN cache them
# — presigned URLs would put an expiring signature in every <img> tag, defeating
# caching and making a stored URL something that stops working.
#
# Writes and deletes still require the credentials the API holds. Anything
# genuinely private does not belong in this bucket.
# ------------------------------------------------------------------
cat > /tmp/public-read.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${BUCKET}/*"]
    }
  ]
}
JSON

mc anonymous set-json /tmp/public-read.json "local/${BUCKET}"

echo "minio-init: bucket '${BUCKET}' ready — anonymous GetObject only, not listable"
