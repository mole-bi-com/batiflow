#!/bin/bash

# Navigate to the batiflow project directory
cd "$(dirname "$0")"

echo "Starting Hermes Gateway, the sole owner of BatiFlow Telegram polling..."
hermes gateway start
hermes gateway status
