# Trusted Certificates

Place only trusted public CA or self-signed certificates here, never private keys.
Docker mounts this directory read-only at `/app/certs`.
Set `SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem` to trust that certificate for ssMusic.
Local `.pem` and `.crt` files are ignored by Git.

This directory is for outbound ssMusic trust, not the frontend's TLS private key.
The HTTPS frontend stores generated certificates in the `frontend_tls` Docker
volume. For a certificate you supply, use the separate, Git-ignored `tls/`
directory (or `HTTPS_CERTS_DIR`) and configure `HTTPS_CERT_PATH` together with
`HTTPS_KEY_PATH`. See [../README.md](../README.md#https-and-reverse-proxy).