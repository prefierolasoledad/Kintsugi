#!/bin/sh
set -eu

# Brings up a streaming standby.
#
# A standby is not a Postgres that was told to follow something. It is a
# byte-for-byte copy of the primary's data directory, replaying the primary's
# write-ahead log forever. So the first start is a clone, and every start after
# that is an ordinary boot that happens to find `standby.signal` on disk.
#
# Replaces the image's entrypoint, does the clone when there is nothing to boot,
# and then hands over to the real entrypoint rather than reimplementing it.
#
# See docs/adr/0020-replication-and-backups.md

PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPL_USER="${POSTGRES_REPLICATION_USER:-replicator}"
SLOT="${REPLICATION_SLOT:-standby1}"

# ------------------------------------------------------------------
# First start only.
#
# PG_VERSION is written by initdb and by pg_basebackup, so its presence is the
# question "is there a data directory here?" answered without guessing. A
# restart must NOT re-clone: that would throw away everything the standby has
# replayed and, worse, mask a broken replication link behind a fresh copy that
# looks healthy.
# ------------------------------------------------------------------
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "standby: no data directory — cloning from ${PRIMARY_HOST}:${PRIMARY_PORT}"

  # The primary's healthcheck gates this service, but healthy means "accepting
  # connections", and the replication role is created by an init script that
  # runs in that same window. So wait for the thing actually needed rather than
  # the thing compose can observe.
  until PGPASSWORD="$PGPASSWORD" pg_isready \
      -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$REPL_USER" -q; do
    echo "standby: waiting for the primary to accept replication logins…"
    sleep 2
  done

  # -R  writes standby.signal and primary_conninfo, so this directory boots as
  #     a standby with no further configuration.
  # -C -S creates a physical replication SLOT named $SLOT. Without one the
  #     primary is free to recycle WAL the standby has not consumed yet, and a
  #     standby that falls behind during a restart never catches up — it fails
  #     with "requested WAL segment has already been removed" and has to be
  #     rebuilt from scratch. The slot makes the primary keep that WAL instead.
  # -Xs streams WAL during the copy, so a long clone cannot outrun its own
  #     starting point.
  PGPASSWORD="$PGPASSWORD" pg_basebackup \
    --host="$PRIMARY_HOST" \
    --port="$PRIMARY_PORT" \
    --username="$REPL_USER" \
    --pgdata="$PGDATA" \
    --format=plain \
    --wal-method=stream \
    --write-recovery-conf \
    --create-slot --slot="$SLOT" \
    --checkpoint=fast \
    --progress \
    --verbose

  # pg_basebackup writes as whoever ran it; the server refuses to start on a
  # data directory it does not own, with permissions 0700 required.
  chmod 0700 "$PGDATA"

  echo "standby: clone complete, booting as a standby"
else
  echo "standby: data directory present — booting and resuming replay"
fi

# The image's own entrypoint from here: it handles the postgres user, signal
# forwarding and shutdown properly, and none of that is worth reimplementing.
exec docker-entrypoint.sh postgres
