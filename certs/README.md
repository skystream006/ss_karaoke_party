# Trusted Certificates

Place only trusted public CA or self-signed certificates here, never private keys.
Docker mounts this directory read-only at `/app/certs`.
Set `SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem` to trust that certificate for ssMusic.
Local `.pem` and `.crt` files are ignored by Git.