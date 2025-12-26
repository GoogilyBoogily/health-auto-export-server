#!/bin/bash

# Default values
ENVIRONMENT="production"
DATA_DIR="./data"

# Generate random token for authentication
WRITE_TOKEN=sk-$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

echo "Creating .env file..."
cat > .env << EOF
NODE_ENV=${ENVIRONMENT}
DATA_DIR=${DATA_DIR}
WRITE_TOKEN=${WRITE_TOKEN}
EOF

echo "Environment configuration saved to .env file"
echo "Generated WRITE_TOKEN: ${WRITE_TOKEN}"
echo "Store this token securely!"
