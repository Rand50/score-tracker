#!/bin/bash
# Local PG17 harness for v25 (binaries extracted from the Debian deb under /tmp/pgdeb if the system has no server)
set -e
cd "$(dirname "$0")/.."
B=${PGBIN:-/usr/lib/postgresql/17/bin}; [ -x "$B/initdb" ] || B=/tmp/pgdeb/root/usr/lib/postgresql/17/bin
D=/tmp/pgv25; PORT=54330; P="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$B/pg_ctl -D $D stop -m immediate >/dev/null 2>&1 || true
rm -rf $D; $B/initdb -D $D -A trust -U postgres >/dev/null
$B/pg_ctl -D $D -o "-p $PORT -k /tmp -c listen_addresses=''" -l /tmp/pgv25.log -w start >/dev/null
trap '$B/pg_ctl -D $D stop -m immediate >/dev/null 2>&1; echo "[cluster stopped]"' EXIT
$P -c "create database v25" postgres
P="$P -d v25"
for f in tests/supabase_auth_stub.sql supabase_social_migration.sql supabase_v20_features_migration.sql supabase_v22_migration.sql supabase_v24_player_linking.sql supabase_v24_1_linked_games_sync.sql; do echo "apply $f"; $P -f $f >/dev/null; done
echo "apply v25 (1st)"; $P -f supabase_v25_admin_drilldown.sql >/dev/null
echo "apply v25 (2nd, idempotency)"; $P -f supabase_v25_admin_drilldown.sql >/dev/null
echo "apply v25 (3rd)"; $P -f supabase_v25_admin_drilldown.sql >/dev/null
echo "--- scenarios"
psql -h /tmp -p $PORT -U postgres -d v25 -v ON_ERROR_STOP=1 -f tests/v25_sql_scenarios.sql 2>&1 | tee /tmp/v25_sql_out.txt
echo "PASS=$(grep -cE "^(psql:.*NOTICE:  )?PASS: " /tmp/v25_sql_out.txt) FAIL=$(grep -cE "^(psql:.*NOTICE:  )?FAIL: " /tmp/v25_sql_out.txt)"
