#!/bin/bash

# Generate self-signed SSL certificate for development/testing
# For production, use certificates from a trusted CA like Let's Encrypt

SSL_DIR="ssl"
KEY_FILE="$SSL_DIR/server.key"
CERT_FILE="$SSL_DIR/server.crt"

echo "🔒 Generating self-signed SSL certificates..."

# Create SSL directory if it doesn't exist
mkdir -p $SSL_DIR

# Generate private key
openssl genrsa -out $KEY_FILE 2048

# Generate certificate signing request
openssl req -new -key $KEY_FILE -out $SSL_DIR/server.csr -subj "/C=US/ST=State/L=City/O=KeepItBased/OU=IT/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -days 365 -in $SSL_DIR/server.csr -signkey $KEY_FILE -out $CERT_FILE

# Remove CSR file
rm $SSL_DIR/server.csr

echo "✅ SSL certificates generated:"
echo "   Private key: $KEY_FILE"
echo "   Certificate: $CERT_FILE"
echo ""
echo "⚠️  These are self-signed certificates for development only."
echo "   For production, use certificates from a trusted CA."