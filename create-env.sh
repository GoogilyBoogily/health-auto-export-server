#!/bin/bash

# Default values
ENVIRONMENT="production"

# Generate random token for authentication
API_TOKEN=sk-$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

echo "Creating .env file..."
cat > .env << EOF
NODE_ENV=${ENVIRONMENT}
API_TOKEN=${API_TOKEN}
OBSIDIAN_VAULT_PATH=/path/to/your/obsidian/vault
EOF

echo "Environment configuration saved to .env file"
echo "Generated API_TOKEN: ${API_TOKEN}"
echo "Store this token securely!"
echo ""
echo "IMPORTANT: Update OBSIDIAN_VAULT_PATH in .env to point to your Obsidian vault"
