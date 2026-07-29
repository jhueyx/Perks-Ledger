#!/usr/bin/env bash
# Manually fires the send-push Edge Function. Prints HTTP status + JSON body.
set -e

APIKEY="sb_publishable_uLJlvYnd-7MiGHMK9SEaww_JwIBveov"
URL="https://rsbvddlhismetljqoqre.supabase.co/functions/v1/send-push"

curl -sS -i -X POST \
  -H "apikey: $APIKEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$URL"
echo
